import { query, withTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { clientIp, hashPassword, verifyPassword } from "../security.js";
import { isInternalIp } from "../totp.js";
import { ANY_PASSWORD, AREA_KEY, DISPLAY_NAME, HEX_COLOR, PASSWORD } from "../schemas.js";
import { clearSessionCookie } from "../session.js";
import { leaveAllOwnGroupsTx, listGroupsForUser } from "./groups.js";

/** Bestätigungswort für das Löschen von Konten ohne Passwort (reine SSO-Konten). */
const DELETE_CONFIRM_WORD = "LÖSCHEN";

/** Alles, was das Frontend nach dem Login über den Nutzer wissen muss. */
export async function loadMe(userId, { isAdmin = false, internal = false } = {}) {
  const db = { query };
  const [user, colors, groups, identities] = await Promise.all([
    query(
      `SELECT id, email, display_name, password_hash IS NOT NULL AS has_password,
              is_local_admin, totp_enabled_at IS NOT NULL AS totp_enabled
         FROM users WHERE id = $1`,
      [userId]
    ),
    query("SELECT area_key, color_hex FROM user_area_colors WHERE user_id = $1", [userId]),
    listGroupsForUser(db, userId),
    query("SELECT provider FROM user_identities WHERE user_id = $1", [userId]),
  ]);
  const u = user.rows[0];
  if (!u) throw new HttpError(401, "Nicht angemeldet.");
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    hasPassword: u.has_password,
    isAdmin: !!isAdmin,
    // Break-Glass: lokaler Admin? TOTP eingerichtet? Kommt die Anfrage aus dem internen Netz?
    localAdmin: u.is_local_admin
      ? { totpEnabled: u.totp_enabled, fromInternalNetwork: !!internal }
      : null,
    ssoLinked: identities.rows.some((r) => r.provider === "authentik"),
    colors: Object.fromEntries(colors.rows.map((r) => [r.area_key, r.color_hex])),
    groups,
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

  const meFor = (request) =>
    loadMe(request.user.id, { isAdmin: request.user.session_admin, internal: isInternalIp(clientIp(request)) });

  app.get("/me", { preHandler: app.authenticate }, async (request) => meFor(request));

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
      return meFor(request);
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
      return meFor(request);
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
      if (!rows[0].password_hash) {
        throw new HttpError(400, "Dieses Konto meldet sich über das ICF-Konto an und hat kein eigenes Passwort.");
      }
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

  // Konto endgültig löschen. Check-ins, Farben, Sitzungen und Verknüpfungen fallen per
  // ON DELETE CASCADE weg. Bestätigung: Passwort, bei reinen SSO-Konten das Wort "LÖSCHEN".
  app.delete(
    "/me",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { password: ANY_PASSWORD, confirm: { type: "string", maxLength: 20 } },
        },
      },
    },
    async (request, reply) => {
      const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [request.user.id]);
      const body = request.body || {};
      if (rows[0].password_hash) {
        if (!(await verifyPassword(rows[0].password_hash, body.password || ""))) {
          throw new HttpError(403, "Das Passwort ist falsch.");
        }
      } else if ((body.confirm || "").trim().toUpperCase() !== DELETE_CONFIRM_WORD) {
        throw new HttpError(403, `Bitte zur Bestätigung „${DELETE_CONFIRM_WORD}“ eingeben.`);
      }
      await withTransaction(async (client) => {
        // Zuerst sauber aus eigenen Gruppen austreten, damit dort eine Leitung bleibt.
        await leaveAllOwnGroupsTx(client, request.user.id);
        await client.query("DELETE FROM users WHERE id = $1", [request.user.id]);
      });
      clearSessionCookie(reply);
      return reply.code(204).send();
    }
  );

  // Verbindung zum ICF-Konto trennen. Nur möglich, wenn ein Passwort existiert,
  // sonst könnte man sich danach nicht mehr anmelden.
  app.delete("/me/sso", { preHandler: app.authenticate }, async (request, reply) => {
    const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [request.user.id]);
    if (!rows[0].password_hash) {
      throw new HttpError(400, "Lege zuerst ein Passwort fest – sonst kannst du dich danach nicht mehr anmelden.");
    }
    await withTransaction(async (client) => {
      await client.query("DELETE FROM user_identities WHERE user_id = $1 AND provider = 'authentik'", [request.user.id]);
      // Admin-Rechte stammen aus Authentik und enden mit der Verbindung.
      await client.query(
        "UPDATE sessions SET is_admin = false, admin_via = NULL WHERE user_id = $1 AND admin_via = 'sso'",
        [request.user.id]
      );
      // Team-Gruppen hängen an der Authentik-Identität und entfallen mit ihr.
      await client.query(
        `DELETE FROM group_members m USING groups g
          WHERE g.id = m.group_id AND m.user_id = $1 AND g.external_source = 'authentik'`,
        [request.user.id]
      );
    });
    return loadMe(request.user.id, { isAdmin: false });
  });
}
