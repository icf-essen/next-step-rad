import { query, withTransaction } from "../db.js";
import { HttpError, SESSION_COOKIE } from "../errors.js";
import { dummyVerify, hashPassword, hashToken, verifyPassword } from "../security.js";
import { ANY_PASSWORD, DISPLAY_NAME, EMAIL, PASSWORD } from "../schemas.js";
import { clearSessionCookie, createSession } from "../session.js";
import {
  alreadyRegisteredMail,
  mailEnabled,
  resetMail,
  sendMail,
  ssoOnlyMail,
  verificationMail,
} from "../mail.js";
import { createResetLink, createVerificationLink } from "../tokens.js";
import { loadMe } from "./me.js";

// Antwort auf Registrierung und "Passwort vergessen" ist immer gleich – egal ob
// es die Adresse schon gibt. So lässt sich nicht ausprobieren, wer ein Konto hat.
const PENDING = { pendingVerification: true };

/** Mail im Hintergrund verschicken; Fehler nur protokollieren (Antwortzeit verrät nichts). */
function sendInBackground(log, to, mail) {
  sendMail(to, mail.subject, mail.body).catch((err) =>
    log.error({ err: err.message, to }, "Mailversand fehlgeschlagen")
  );
}

function requireMail() {
  if (!mailEnabled()) {
    throw new HttpError(503, "Registrierung ist gerade nicht möglich (kein Mailversand eingerichtet).");
  }
}

export default async function authRoutes(app) {
  /* ------------------------------ Registrierung ----------------------------- */

  app.post(
    "/auth/register",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: { email: EMAIL, password: PASSWORD, displayName: DISPLAY_NAME },
        },
      },
    },
    async (request, reply) => {
      requireMail();
      const email = request.body.email.trim();
      const displayName = (request.body.displayName || "").trim();
      const passwordHash = await hashPassword(request.body.password);

      const result = await withTransaction(async (client) => {
        const existing = await client.query("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
        if (existing.rows[0]) {
          // Gibt es die Adresse schon (bestätigt oder nicht), wird nichts verändert.
          // Wer das Postfach hat, bekommt einen Link zum Neu-Festlegen des Passworts –
          // so kann auch niemand eine fremde Adresse dauerhaft "besetzen".
          const link = await createResetLink(client, existing.rows[0].id);
          return { mail: alreadyRegisteredMail(link.url) };
        }
        const { rows } = await client.query(
          `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id`,
          [email, passwordHash, displayName]
        );
        const link = await createVerificationLink(client, rows[0].id);
        return { mail: verificationMail(displayName, link) };
      });
      sendInBackground(request.log, email, result.mail);
      return reply.code(201).send(PENDING);
    }
  );

  // Bestätigungslink einlösen. Wer den Link hat, hat Zugriff auf das Postfach:
  // Danach ist man direkt angemeldet.
  app.post(
    "/auth/verify-email",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["token"],
          additionalProperties: false,
          properties: { token: { type: "string", minLength: 20, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const userId = await withTransaction(async (client) => {
        const { rows } = await client.query(
          "DELETE FROM email_verifications WHERE token_hash = $1 AND expires_at > now() RETURNING user_id",
          [hashToken(request.body.token)]
        );
        if (!rows[0]) {
          throw new HttpError(400, "Dieser Bestätigungslink ist ungültig, abgelaufen oder wurde schon benutzt.");
        }
        await client.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [
          rows[0].user_id,
        ]);
        return rows[0].user_id;
      });
      await createSession(reply, userId);
      request.log.info({ userId }, "E-Mail bestätigt");
      return loadMe(userId);
    }
  );

  // Neuen Bestätigungslink anfordern – nur mit korrektem Passwort, damit niemand
  // fremde Postfächer mit Mails flutet.
  app.post(
    "/auth/resend-verification",
    {
      config: { rateLimit: { max: 3, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: { email: EMAIL, password: ANY_PASSWORD },
        },
      },
    },
    async (request, reply) => {
      requireMail();
      const { rows } = await query(
        "SELECT id, password_hash, display_name, email_verified_at FROM users WHERE lower(email) = lower($1)",
        [request.body.email.trim()]
      );
      const user = rows[0];
      const ok = user?.password_hash
        ? await verifyPassword(user.password_hash, request.body.password)
        : (await dummyVerify(request.body.password)) && false;
      if (!user || !ok) throw new HttpError(401, "E-Mail oder Passwort ist falsch.");
      if (!user.email_verified_at) {
        const link = await createVerificationLink({ query }, user.id);
        sendInBackground(request.log, request.body.email.trim(), verificationMail(user.display_name, link));
      }
      return reply.code(202).send(PENDING);
    }
  );

  /* -------------------------------- Anmeldung ------------------------------- */

  app.post(
    "/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "5 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: { email: EMAIL, password: ANY_PASSWORD },
        },
      },
    },
    async (request, reply) => {
      const { rows } = await query(
        "SELECT id, password_hash, email_verified_at FROM users WHERE lower(email) = lower($1)",
        [request.body.email.trim()]
      );
      const user = rows[0];
      // Unbekannte E-Mail und Konten ohne Passwort (reine SSO-Konten) werden mit
      // gleichem Rechenaufwand abgelehnt, damit die Antwortzeit nichts verrät.
      const ok = user?.password_hash
        ? await verifyPassword(user.password_hash, request.body.password)
        : (await dummyVerify(request.body.password)) && false;
      // Bewusst dieselbe Meldung für "unbekannt", "falsches Passwort" und "nur SSO".
      if (!user || !ok) throw new HttpError(401, "E-Mail oder Passwort ist falsch.");
      // Erst nach korrektem Passwort verraten, dass die Bestätigung fehlt.
      if (!user.email_verified_at) {
        throw new HttpError(
          403,
          "Bitte bestätige zuerst deine E-Mail-Adresse. Den Link haben wir dir bei der Registrierung geschickt.",
          "email_unverified"
        );
      }
      await createSession(reply, user.id);
      return loadMe(user.id);
    }
  );

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  /* ---------------------------- Passwort vergessen --------------------------- */

  app.post(
    "/auth/forgot-password",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        body: { type: "object", required: ["email"], additionalProperties: false, properties: { email: EMAIL } },
      },
    },
    async (request, reply) => {
      requireMail();
      const email = request.body.email.trim();
      const { rows } = await query(
        `SELECT u.id, u.password_hash IS NOT NULL AS has_password,
                EXISTS (SELECT 1 FROM password_resets r
                         WHERE r.user_id = u.id AND r.created_at > now() - interval '2 minutes') AS recent
           FROM users u WHERE lower(u.email) = lower($1)`,
        [email]
      );
      const user = rows[0];
      // Pro Konto höchstens alle 2 Minuten eine Mail, egal von wie vielen IPs.
      if (user && !user.recent) {
        if (user.has_password) {
          const link = await createResetLink({ query }, user.id);
          sendInBackground(request.log, email, resetMail(link.url));
        } else {
          sendInBackground(request.log, email, ssoOnlyMail());
        }
      }
      return reply.code(202).send(PENDING);
    }
  );
}
