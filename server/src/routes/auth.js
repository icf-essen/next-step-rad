import { query } from "../db.js";
import { HttpError, SESSION_COOKIE } from "../errors.js";
import { dummyVerify, hashPassword, hashToken, verifyPassword } from "../security.js";
import { ANY_PASSWORD, DISPLAY_NAME, EMAIL, PASSWORD } from "../schemas.js";
import { clearSessionCookie, createSession } from "../session.js";
import { loadMe } from "./me.js";

export default async function authRoutes(app) {
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
      const email = request.body.email.trim();
      const displayName = (request.body.displayName || "").trim();
      const passwordHash = await hashPassword(request.body.password);
      let user;
      try {
        const { rows } = await query(
          `INSERT INTO users (email, password_hash, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [email, passwordHash, displayName]
        );
        user = rows[0];
      } catch (err) {
        if (err.code === "23505") throw new HttpError(409, "Für diese E-Mail-Adresse gibt es bereits ein Konto.");
        throw err;
      }
      await createSession(reply, user.id);
      return reply.code(201).send(await loadMe(user.id));
    }
  );

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
        "SELECT id, password_hash FROM users WHERE lower(email) = lower($1)",
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
}
