import { config } from "./config.js";
import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { startSessionCleanup } from "./session.js";

const app = await buildApp();
startSessionCleanup(app.log);

// Sauber herunterfahren, wenn systemd den Dienst stoppt.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    app.log.info(`${signal} empfangen, fahre herunter`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
