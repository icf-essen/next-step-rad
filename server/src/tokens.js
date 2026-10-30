import { config } from "./config.js";
import { hashToken, newSessionToken } from "./security.js";

// Einmal-Links (Passwort neu festlegen, E-Mail bestätigen). In der Datenbank
// liegt nur der Hash; das Token steht im URL-Fragment (#…), damit es weder in
// Server-Logs noch im Referer auftaucht.

const appUrl = (fragment) => `${config.publicUrl}${config.cookiePath}#${fragment}`;

/** Neuer Reset-Link; ältere Links dieses Kontos werden ungültig. */
export async function createResetLink(db, userId, createdBy = null, hours = 24) {
  const token = newSessionToken();
  await db.query("DELETE FROM password_resets WHERE user_id = $1", [userId]);
  const { rows } = await db.query(
    `INSERT INTO password_resets (token_hash, user_id, created_by, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4)) RETURNING expires_at`,
    [hashToken(token), userId, createdBy, hours]
  );
  return { url: appUrl("reset=" + token), expiresAt: rows[0].expires_at };
}

/** Neuer Bestätigungslink; ältere Links dieses Kontos werden ungültig. */
export async function createVerificationLink(db, userId) {
  const token = newSessionToken();
  await db.query("DELETE FROM email_verifications WHERE user_id = $1", [userId]);
  await db.query(
    `INSERT INTO email_verifications (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [hashToken(token), userId, config.emailVerifyHours]
  );
  return appUrl("verify=" + token);
}
