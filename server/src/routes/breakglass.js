import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { breakGlassMail, mailEnabled, sendMail } from "../mail.js";
import { ANY_PASSWORD } from "../schemas.js";
import { clientIp, verifyPassword } from "../security.js";
import { decryptSecret, encryptSecret, isInternalIp, newTotpSecret, otpauthUrl, verifyTotp } from "../totp.js";
import { loadMe } from "./me.js";

// Break-Glass: lokale Admins (ohne Authentik) schalten die Verwaltung frei.
//
// Voraussetzungen, alle gleichzeitig:
//   - Konto ist von einem Admin als "lokaler Admin" markiert
//   - Anfrage kommt aus dem internen Netz (nie über Cloudflare von außen)
//   - gültiger, noch nicht benutzter 6-stelliger Code aus der Authenticator-App
// Die Freischaltung gilt für diese eine Sitzung und höchstens BREAKGLASS_HOURS.

const CODE = { type: "string", pattern: "^[0-9]{6}$" };

async function requireLocalAdmin(request) {
  const { rows } = await query(
    "SELECT is_local_admin, password_hash, totp_secret_enc, totp_enabled_at, totp_last_step FROM users WHERE id = $1",
    [request.user.id]
  );
  const u = rows[0];
  if (!u?.is_local_admin) throw new HttpError(403, "Dieses Konto ist kein lokaler Admin.");
  if (!config.secretKey) throw new HttpError(503, "Break-Glass ist nicht eingerichtet (APP_SECRET_KEY fehlt).");
  return u;
}

function requireInternal(request) {
  if (!isInternalIp(clientIp(request))) {
    throw new HttpError(403, "Die Verwaltung lässt sich mit einem lokalen Konto nur aus dem internen Netz freischalten.");
  }
}

/** Code prüfen und das benutzte Zeitfenster sperren (atomar gegen parallele Nutzung). */
async function consumeCode(client, userId, u, code) {
  const step = verifyTotp(decryptSecret(u.totp_secret_enc), code, u.totp_last_step === null ? null : Number(u.totp_last_step));
  if (step === null) return false;
  const { rowCount } = await client.query(
    "UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)",
    [userId, step]
  );
  return rowCount === 1;
}

export default async function breakGlassRoutes(app) {
  const auth = { preHandler: app.authenticate };

  // Schritt 1 der Einrichtung: neues Geheimnis erzeugen (Passwort zur Bestätigung).
  app.post(
    "/me/totp/setup",
    {
      ...auth,
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        body: { type: "object", required: ["password"], additionalProperties: false, properties: { password: ANY_PASSWORD } },
      },
    },
    async (request) => {
      const u = await requireLocalAdmin(request);
      requireInternal(request);
      if (!u.password_hash || !(await verifyPassword(u.password_hash, request.body.password))) {
        throw new HttpError(403, "Das Passwort ist falsch.");
      }
      const secret = newTotpSecret();
      // Bis zur Bestätigung ist das Geheimnis gespeichert, aber nicht aktiv.
      await query(
        "UPDATE users SET totp_secret_enc = $2, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1",
        [request.user.id, encryptSecret(secret)]
      );
      request.log.info({ userId: request.user.id }, "TOTP-Einrichtung gestartet");
      return { secret, otpauthUrl: otpauthUrl(secret, request.user.email) };
    }
  );

  // Schritt 2: mit einem ersten Code bestätigen – erst dann ist TOTP aktiv.
  app.post(
    "/me/totp/confirm",
    {
      ...auth,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: { body: { type: "object", required: ["code"], additionalProperties: false, properties: { code: CODE } } },
    },
    async (request) => {
      const u = await requireLocalAdmin(request);
      requireInternal(request);
      if (!u.totp_secret_enc) throw new HttpError(400, "Bitte zuerst die Einrichtung starten.");
      const ok = await withTransaction(async (client) => {
        if (!(await consumeCode(client, request.user.id, u, request.body.code))) return false;
        await client.query("UPDATE users SET totp_enabled_at = now() WHERE id = $1", [request.user.id]);
        return true;
      });
      if (!ok) throw new HttpError(400, "Der Code stimmt nicht. Prüfe die Uhrzeit des Handys und versuch es erneut.");
      request.log.info({ userId: request.user.id }, "TOTP eingerichtet");
      return loadMe(request.user.id, { isAdmin: request.user.session_admin, internal: true });
    }
  );

  // Verwaltung freischalten (Break-Glass).
  app.post(
    "/auth/elevate",
    {
      ...auth,
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: { body: { type: "object", required: ["code"], additionalProperties: false, properties: { code: CODE } } },
    },
    async (request) => {
      const u = await requireLocalAdmin(request);
      const ip = clientIp(request);
      if (!isInternalIp(ip)) {
        request.log.warn({ userId: request.user.id, ip }, "Break-Glass von außerhalb abgelehnt");
      }
      requireInternal(request);
      if (!u.totp_enabled_at) throw new HttpError(400, "Bitte zuerst die Authenticator-App einrichten.");

      const until = await withTransaction(async (client) => {
        if (!(await consumeCode(client, request.user.id, u, request.body.code))) return null;
        // Admin-Recht für diese Sitzung, und die Sitzung endet spätestens nach BREAKGLASS_HOURS.
        const { rows } = await client.query(
          `UPDATE sessions
              SET is_admin = true, admin_via = 'local',
                  expires_at = least(expires_at, now() + make_interval(hours => $2))
            WHERE id = $1 RETURNING expires_at`,
          [request.user.session_id, config.breakGlassHours]
        );
        return rows[0].expires_at;
      });
      if (!until) {
        request.log.warn({ userId: request.user.id, ip }, "Break-Glass: falscher Code");
        throw new HttpError(403, "Der Code stimmt nicht.");
      }

      request.log.warn({ userId: request.user.id, email: request.user.email, ip, until }, "BREAK-GLASS: Verwaltung freigeschaltet");
      if (config.breakGlassNotify && mailEnabled()) {
        const untilText = new Date(until).toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
        const mail = breakGlassMail(request.user.email, ip, untilText);
        sendMail(config.breakGlassNotify, mail.subject, mail.body).catch((err) =>
          request.log.error({ err: err.message }, "Break-Glass-Benachrichtigung fehlgeschlagen")
        );
      }
      return loadMe(request.user.id, { isAdmin: true, internal: true });
    }
  );
}
