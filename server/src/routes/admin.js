import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { hashPassword, hashToken } from "../security.js";
import { createResetLink } from "../tokens.js";
import { PASSWORD, UUID } from "../schemas.js";

// Verwaltung und Passwort zurücksetzen.
//
// Ablauf beim Zurücksetzen:
//   1. Admin sucht das Konto und erzeugt einen Einmal-Link (gültig 24 h).
//   2. Admin gibt den Link persönlich weiter (z. B. per Signal).
//   3. Die Person öffnet den Link und legt selbst ein neues Passwort fest.
// Der Admin kennt das neue Passwort nie. In der Datenbank liegt nur der Hash
// des Tokens; im Link steht das Token im Fragment (#…), damit es weder in
// Server-Logs noch im Referer auftaucht.

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (c) => "\\" + c);
}

export default async function adminRoutes(app) {
  const admin = { preHandler: app.requireAdmin };

  // Konten suchen (E-Mail oder Name enthält den Suchtext).
  app.get(
    "/admin/users",
    {
      ...admin,
      schema: {
        querystring: {
          type: "object",
          required: ["q"],
          additionalProperties: false,
          properties: { q: { type: "string", minLength: 2, maxLength: 100 } },
        },
      },
    },
    async (request) => {
      const pattern = "%" + escapeLike(request.query.q.trim()) + "%";
      const { rows } = await query(
        `SELECT u.id, u.email, u.display_name, u.created_at,
                u.password_hash IS NOT NULL AS has_password,
                u.email_verified_at IS NOT NULL AS email_verified,
                u.is_local_admin, u.totp_enabled_at IS NOT NULL AS totp_enabled,
                EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id) AS sso_linked
           FROM users u
          WHERE u.email ILIKE $1 ESCAPE '\\' OR u.display_name ILIKE $1 ESCAPE '\\'
          ORDER BY lower(u.email)
          LIMIT 25`,
        [pattern]
      );
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        createdAt: r.created_at,
        hasPassword: r.has_password,
        ssoLinked: r.sso_linked,
        emailVerified: r.email_verified,
        localAdmin: r.is_local_admin,
        totpEnabled: r.totp_enabled,
        isMe: r.id === request.user.id,
      }));
    }
  );

  // Einmal-Link zum Festlegen eines neuen Passworts erzeugen.
  app.post(
    "/admin/users/:userId/password-reset",
    {
      ...admin,
      config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
      schema: { params: { type: "object", required: ["userId"], properties: { userId: UUID } } },
    },
    async (request, reply) => {
      const { userId } = request.params;
      const { rows } = await query("SELECT email, password_hash IS NOT NULL AS has_password FROM users WHERE id = $1", [
        userId,
      ]);
      if (!rows[0]) throw new HttpError(404, "Konto nicht gefunden.");
      if (!rows[0].has_password) {
        throw new HttpError(400, "Dieses Konto meldet sich nur über das ICF-Konto an und hat kein Passwort.");
      }
      const result = await createResetLink({ query }, userId, request.user.id, config.passwordResetHours);
      request.log.info({ adminId: request.user.id, userId }, "Passwort-Reset-Link erzeugt");
      return reply.code(201).send({
        url: result.url,
        expiresAt: result.expiresAt,
        email: rows[0].email,
      });
    }
  );

  // Konto ändern: lokalen Admin (Break-Glass) setzen/entziehen, E-Mail als bestätigt markieren.
  app.patch(
    "/admin/users/:userId",
    {
      ...admin,
      config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
      schema: {
        params: { type: "object", required: ["userId"], properties: { userId: UUID } },
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: { localAdmin: { type: "boolean" }, emailVerified: { const: true } },
        },
      },
    },
    async (request) => {
      const { userId } = request.params;
      const { localAdmin, emailVerified } = request.body;
      await withTransaction(async (client) => {
        const { rows } = await client.query(
          "SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = $1 FOR UPDATE",
          [userId]
        );
        if (!rows[0]) throw new HttpError(404, "Konto nicht gefunden.");
        if (localAdmin === true && !rows[0].has_password) {
          throw new HttpError(400, "Lokale Admins brauchen ein Passwort-Konto (für den Fall, dass Authentik ausfällt).");
        }
        if (localAdmin !== undefined) {
          await client.query("UPDATE users SET is_local_admin = $2 WHERE id = $1", [userId, localAdmin]);
          if (!localAdmin) {
            // Laufende Break-Glass-Freischaltungen sofort beenden.
            await client.query(
              "UPDATE sessions SET is_admin = false, admin_via = NULL WHERE user_id = $1 AND admin_via = 'local'",
              [userId]
            );
          }
        }
        if (emailVerified) {
          await client.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [userId]);
          await client.query("DELETE FROM email_verifications WHERE user_id = $1", [userId]);
        }
      });
      request.log.warn({ adminId: request.user.id, userId, localAdmin, emailVerified }, "Konto durch Admin geändert");
      const { rows } = await query(
        `SELECT id, email, is_local_admin, email_verified_at IS NOT NULL AS email_verified FROM users WHERE id = $1`,
        [userId]
      );
      return { id: rows[0].id, localAdmin: rows[0].is_local_admin, emailVerified: rows[0].email_verified };
    }
  );

  // Öffentlich: neues Passwort mit einem Einmal-Link festlegen.
  app.post(
    "/auth/password-reset",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["token", "newPassword"],
          additionalProperties: false,
          properties: { token: { type: "string", minLength: 20, maxLength: 100 }, newPassword: PASSWORD },
        },
      },
    },
    async (request, reply) => {
      const newHash = await hashPassword(request.body.newPassword);
      const userId = await withTransaction(async (client) => {
        // DELETE … RETURNING löst den Link genau einmal ein, auch bei parallelen Anfragen.
        const { rows } = await client.query(
          `DELETE FROM password_resets WHERE token_hash = $1 AND expires_at > now() RETURNING user_id`,
          [hashToken(request.body.token)]
        );
        if (!rows[0]) throw new HttpError(400, "Dieser Link ist ungültig, abgelaufen oder wurde schon benutzt.");
        const id = rows[0].user_id;
        // Wer den Link aus der Mail benutzt, hat Zugriff auf das Postfach: gilt als bestätigt.
        await client.query(
          "UPDATE users SET password_hash = $2, email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1",
          [id, newHash]
        );
        // Alle bestehenden Sitzungen beenden (z. B. falls jemand anderes eingeloggt war).
        await client.query("DELETE FROM sessions WHERE user_id = $1", [id]);
        await client.query("DELETE FROM password_resets WHERE user_id = $1", [id]);
        return id;
      });
      request.log.info({ userId }, "Passwort über Reset-Link neu gesetzt");
      return reply.code(204).send();
    }
  );
}
