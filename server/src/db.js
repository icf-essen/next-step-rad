import pg from "pg";
import { config } from "./config.js";

// smallint/bigint als Zahlen zurückgeben statt als Strings.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  application_name: "next-step-rad-api",
});

/** Einfache Abfrage. IMMER mit Platzhaltern ($1, $2 …), nie mit String-Verkettung. */
export function query(text, params) {
  return pool.query(text, params);
}

/** Führt fn(client) in einer Transaktion aus. Bei einem Fehler wird alles zurückgerollt. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
