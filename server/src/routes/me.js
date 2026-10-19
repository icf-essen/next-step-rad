import { query, withTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { hashPassword, verifyPassword } from "../security.js";
import { ANY_PASSWORD, AREA_KEY, DISPLAY_NAME, HEX_COLOR, PASSWORD } from "../schemas.js";
import { clearSessionCookie } from "../session.js";
import { leaveGroupTx } from "./groups.js";

/** Alles, was das Frontend nach dem Login über den Nutzer wissen muss. */
export async function loadMe(userId) {
  const [user, colors, group] = await Promise.all([
    query("SELECT id, email, display_name FROM users WHERE id = $1", [userId]),
    query("SELECT area_key, color_hex FROM user_area_colors WHERE user_id = $1", [userId]),
    query(
      `SELECT g.id, g.code, g.name, m.role
         FROM group_members m JOIN groups g ON g.id = m.group_id
        WHERE m.user_id = $1`,
      [userId]
    ),
  ]);
  const u = user.rows[0];
  if (!u) throw new HttpError(401, "Nicht angemeldet.");
  const g = group.rows[0];
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    colors: Object.fromEntries(colors.rows.map((r) => [r.area_key, r.color_hex])),
    group: g ? { id: g.id, code: g.code, name: g.name, role: g.role } : null,
  };
}

export default async function meRoutes(app) {
  // Bereiche sind öffentlich (Stammdaten), alles andere nur angemeldet.
  app.get("/areas", async () => {
    const { rows } = await query(
      "SELECT key, label, default_color, sort_order FROM areas ORDER BY sort_order"
    );
    return rows.map((r) => ({ key: r.key, label: r.label, defaultColor: r.default_color, sortOrder: r.sort_order }));
  });

  app.get("/me", { preHandler: app.authenticate }, async (request) => loadMe(request.user.id));

  app.patch(
    "/me",
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          type: "object",
          required: ["displayName"],
          additionalProperties: false,
          properties: { displayName: DISPLAY_NAME },
        },
      },
    },
    async (request) => {
      await query("UPDATE users SET display_name = $2 WHERE id = $1", [
        request.user.id,
        request.body.displayName.trim(),
      ]);
      return loadMe(request.user.id);
    }
  );

  // Ersetzt die eigenen Farben komplett. Nicht genannte Bereiche fallen auf die Standardfarbe zurück.
  app.put(
    "/me/colors",
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          type: "object",
          required: ["colors"],
          additionalProperties: false,
          properties: {
            colors: {
              type: "object",
              maxProperties: 20,
              propertyNames: AREA_KEY,
              additionalProperties: HEX_COLOR,
            },
          },
        },
      },
    },
    async (request) => {
      const userId = request.user.id;
      await withTransaction(async (client) => {
        await client.query("DELETE FROM user_area_colors WHERE user_id = $1", [userId]);
        for (const [areaKey, color] of Object.entries(request.body.colors)) {
          await client.query(
            "INSERT INTO user_area_colors (user_id, area_key, color_hex) VALUES ($1, $2, $3)",
            [userId, areaKey, color]
          );
        }
      });
      return loadMe(userId);
    }
  );

  // Passwort ändern. Alle anderen Sitzungen (z. B. auf verlorenen Geräten) werden beendet.
  app.post(
    "/me/password",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          additionalProperties: false,
          properties: { currentPassword: ANY_PASSWORD, newPassword: PASSWORD },
        },
      },
    },
    async (request, reply) => {
      const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [request.user.id]);
      if (!(await verifyPassword(rows[0].password_hash, request.body.currentPassword))) {
        throw new HttpError(403, "Das aktuelle Passwort ist falsch.");
      }
      const newHash = await hashPassword(request.body.newPassword);
      await withTransaction(async (client) => {
        await client.query("UPDATE users SET password_hash = $2 WHERE id = $1", [request.user.id, newHash]);
        await client.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [
          request.user.id,
          request.user.session_id,
        ]);
      });
      return reply.code(204).send();
    }
  );

  // Konto endgültig löschen. Check-ins, Farben und Sitzungen fallen per ON DELETE CASCADE weg.
  app.delete(
    "/me",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["password"],
          additionalProperties: false,
          properties: { password: ANY_PASSWORD },
        },
      },
    },
    async (request, reply) => {
      const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [request.user.id]);
      if (!(await verifyPassword(rows[0].password_hash, request.body.password))) {
        throw new HttpError(403, "Das Passwort ist falsch.");
      }
      await withTransaction(async (client) => {
        // Zuerst sauber aus der Gruppe austreten, damit ein Admin-Nachfolger bestimmt wird.
        await leaveGroupTx(client, request.user.id, null);
        await client.query("DELETE FROM users WHERE id = $1", [request.user.id]);
      });
      clearSessionCookie(reply);
      return reply.code(204).send();
    }
  );
}
