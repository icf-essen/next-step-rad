import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { hashPassword, hashToken, newSessionToken } from "../security.js";
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
      const token = newSessionToken();
      const hours = config.passwordResetHours;
      const result = await withTransaction(async (client) => {
        // Ein neuer Link macht ältere Links für dieses Konto ungültig.
        await client.query("DELETE FROM password_resets WHERE user_id = $1", [userId]);
        const ins = await client.query(
          `INSERT INTO password_resets (token_hash, user_id, created_by, expires_at)
           VALUES ($1, $2, $3, now() + make_interval(hours => $4)) RETURNING expires_at`,
          [hashToken(token), userId, request.user.id, hours]
        );
        return ins.rows[0];
      });
      request.log.info({ adminId: request.user.id, userId }, "Passwort-Reset-Link erzeugt");
      return reply.code(201).send({
        url: `${config.publicUrl}${config.cookiePath}#reset=${token}`,
        expiresAt: result.expires_at,
        email: rows[0].email,
      });
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
        await client.query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, newHash]);
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
