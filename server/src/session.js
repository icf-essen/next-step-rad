import { config } from "./config.js";
import { query } from "./db.js";
import { SESSION_COOKIE } from "./errors.js";
import { hashToken, newSessionToken } from "./security.js";

/**
 * Neue Sitzung anlegen und als Cookie setzen.
 * isAdmin nur bei SSO-Anmeldung mit Admin-Gruppe; gilt für genau diese Sitzung.
 */
export async function createSession(reply, userId, days = config.sessionDays, { isAdmin = false } = {}) {
  const token = newSessionToken();
  const maxAgeSeconds = days * 24 * 60 * 60;
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, is_admin)
     VALUES ($1, $2, now() + make_interval(secs => $3), $4)`,
    [userId, hashToken(token), maxAgeSeconds, isAdmin]
  );
  reply.setCookie(SESSION_COOKIE, token, {
    path: config.cookiePath,
    httpOnly: true, // für JavaScript im Browser unsichtbar (Schutz bei XSS)
    secure: config.cookieSecure,
    sameSite: "strict", // wird bei Anfragen von fremden Seiten nicht mitgeschickt (Schutz vor CSRF)
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(reply) {
  reply.clearCookie(SESSION_COOKIE, { path: config.cookiePath });
}

/** Abgelaufene Sitzungen regelmäßig entfernen. */
export function startSessionCleanup(log) {
  const run = () =>
    query(
      `WITH s AS (DELETE FROM sessions WHERE expires_at < now() RETURNING 1),
            r AS (DELETE FROM password_resets WHERE expires_at < now() RETURNING 1)
       SELECT (SELECT count(*) FROM s) + (SELECT count(*) FROM r) AS "rowCount"`
    ).then((r) => ({ rowCount: Number(r.rows[0].rowCount) }))
      .then((r) => r.rowCount && log.info({ removed: r.rowCount }, "Abgelaufene Sitzungen/Reset-Links entfernt"))
      .catch((err) => log.error(err, "Sitzungs-Bereinigung fehlgeschlagen"));
  run();
  return setInterval(run, 60 * 60 * 1000).unref();
}
