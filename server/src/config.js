// Zentrale Konfiguration. Alle Werte kommen aus Umgebungsvariablen
// (auf dem Server: /etc/next-step-rad/api.env, geladen von systemd).

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Fehlende Umgebungsvariable: ${name}`);
    process.exit(1);
  }
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    console.error(`Ungültige Zahl in ${name}: ${raw}`);
    process.exit(1);
  }
  return n;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  host: process.env.HOST || "127.0.0.1",
  port: int("PORT", 3000),

  // Pfad, unter dem Caddy die API weiterreicht. Muss zum Vite-"base" passen.
  apiPrefix: process.env.API_PREFIX || "/next-step-rad/api",
  cookiePath: process.env.COOKIE_PATH || "/next-step-rad/",

  // Nur im lokalen Test über http auf "false" setzen.
  cookieSecure: process.env.COOKIE_SECURE !== "false",
  sessionDays: int("SESSION_DAYS", 30),

  // Erlaubte Origins für schreibende Requests (kommasepariert).
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "https://nextstep.icf-essen.de")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  logLevel: process.env.LOG_LEVEL || "info",
};
