import { query } from "./db.js";

/**
 * Zustand des Backends für Monitoring und Statusseite.
 *
 * Geprüft wird nicht nur, ob PostgreSQL antwortet, sondern auch, ob das Schema
 * zum Code passt: Die Abfrage nennt Spalten aus der neuesten Migration. Fehlt
 * eine Migration, schlägt sie fehl (wie beim Einspielen von 005, als die App
 * 500er lieferte, ein reines "SELECT 1" aber weiter OK gemeldet hätte).
 * LIMIT 0 liest keine Zeilen; PostgreSQL prüft trotzdem Tabellen, Spalten und Rechte.
 *
 * Nach außen geht nur "ok" oder "down", keine Fehlermeldung, keine Version.
 */
const CHECK_SQL = `
  SELECT u.email_verified_at, u.is_local_admin, u.totp_last_step, s.admin_via, m.opted_out
  FROM users u, sessions s, group_members m
  LIMIT 0`;

const TIMEOUT_MS = 3_000; // länger wartet ein Monitor nicht; hängende DB = down
const CACHE_MS = 5_000; // höchstens eine DB-Abfrage alle 5 s, egal wie oft gefragt wird

let cached = null; // { ok, at }
let inFlight = null;
let lastLoggedOk = true;

async function runCheck(log) {
  let timer;
  try {
    await Promise.race([
      query(CHECK_SQL),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Health-Check: Zeitüberschreitung nach ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
      }),
    ]);
    if (!lastLoggedOk) log.warn("Health-Check: Datenbank wieder erreichbar");
    lastLoggedOk = true;
    return true;
  } catch (err) {
    // Nur beim Wechsel loggen, sonst füllt jeder Monitor-Aufruf das Journal.
    if (lastLoggedOk) log.error({ err }, "Health-Check fehlgeschlagen");
    lastLoggedOk = false;
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(log) {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.ok;
  inFlight ??= runCheck(log).then((ok) => {
    cached = { ok, at: Date.now() };
    inFlight = null;
    return ok;
  });
  return inFlight;
}

export default async function healthRoutes(api) {
  api.get("/health", { config: { rateLimit: false } }, async (request, reply) => {
    const ok = await checkHealth(request.log);
    reply.header("Cache-Control", "no-store"); // weder Browser noch Cloudflare dürfen das zwischenspeichern
    return reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "down" });
  });
}
