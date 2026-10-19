import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { query } from "./db.js";
import { clientIp, hashToken } from "./security.js";
import { HttpError, SESSION_COOKIE } from "./errors.js";
import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import checkinRoutes from "./routes/checkins.js";
import groupRoutes from "./routes/groups.js";

export async function buildApp(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? { level: config.logLevel },
    bodyLimit: 16 * 1024, // 16 KB reichen für jeden Request dieser App
    trustProxy: false, // Client-IP wird gezielt über clientIp() bestimmt
    // Unbekannte Felder ablehnen statt sie stillschweigend zu entfernen (Fastify-Standard).
    ajv: { customOptions: { removeAdditional: false } },
  });

  await app.register(cookie);

  // Globales Limit gegen Missbrauch; strengere Limits pro Route (Login, Join …).
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: clientIp,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: `Zu viele Anfragen. Bitte in ${Math.ceil(ctx.ttl / 1000)} Sekunden erneut versuchen.`,
    }),
  });

  // CSRF-Schutz, zusätzlich zu SameSite=Strict am Cookie: Schreibende Requests
  // von fremden Webseiten werden abgewiesen.
  app.addHook("onRequest", async (request) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      throw new HttpError(403, "Ungültige Herkunft der Anfrage.");
    }
  });

  // Login-Prüfung, als preHandler pro Route einsetzbar.
  app.decorateRequest("user", null);
  app.decorate("authenticate", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw new HttpError(401, "Nicht angemeldet.");
    const { rows } = await query(
      `SELECT s.id AS session_id, u.id, u.email, u.display_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)]
    );
    if (rows.length === 0) throw new HttpError(401, "Sitzung abgelaufen. Bitte neu anmelden.");
    request.user = rows[0];
  });

  app.setErrorHandler((err, request, reply) => {
    // Eingabe passt nicht zum JSON-Schema der Route
    if (err.validation) {
      return reply.code(400).send({ error: "Ungültige Eingabe.", details: err.message });
    }
    if (err.statusCode === 429) return reply.code(429).send(err);
    if (err.expose || (err.statusCode && err.statusCode < 500)) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    // Verletzte Datenbank-Constraints als Client-Fehler melden, ohne Interna preiszugeben.
    switch (err.code) {
      case "23505":
        return reply.code(409).send({ error: "Eintrag existiert bereits." });
      case "23503":
      case "23514":
      case "22P02":
        return reply.code(400).send({ error: "Ungültige Daten." });
    }
    request.log.error(err);
    return reply.code(500).send({ error: "Interner Fehler." });
  });

  app.register(
    async (api) => {
      api.get("/health", { config: { rateLimit: false } }, async () => {
        await query("SELECT 1");
        return { ok: true };
      });
      await api.register(authRoutes);
      await api.register(meRoutes);
      await api.register(checkinRoutes);
      await api.register(groupRoutes);
    },
    { prefix: config.apiPrefix }
  );

  return app;
}
