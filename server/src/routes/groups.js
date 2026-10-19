import { query, withTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { GROUP_NAME, UUID } from "../schemas.js";
import { generateGroupCode, normalizeCode } from "../security.js";

/** Gruppe des Nutzers inkl. Rolle, oder null. */
async function getMembership(db, userId, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT m.group_id, m.role, g.code, g.name
       FROM group_members m JOIN groups g ON g.id = m.group_id
      WHERE m.user_id = $1 ${lock ? "FOR UPDATE OF m" : ""}`,
    [userId]
  );
  return rows[0] || null;
}

async function requireMembership(userId) {
  const m = await getMembership({ query }, userId);
  if (!m) throw new HttpError(404, "Du bist in keiner Gruppe.");
  return m;
}

async function requireAdmin(userId) {
  const m = await requireMembership(userId);
  if (m.role !== "admin") throw new HttpError(403, "Nur die Gruppenleitung darf das.");
  return m;
}

/**
 * Nutzer aus seiner Gruppe entfernen (innerhalb einer Transaktion).
 * War er Admin, wird der gewählte Nachfolger oder das am längsten dabei
 * gewesene Mitglied Admin. Ist niemand mehr übrig, wird die Gruppe gelöscht.
 */
export async function leaveGroupTx(client, userId, successorId) {
  const m = await getMembership(client, userId, { lock: true });
  if (!m) return null;

  await client.query("DELETE FROM group_members WHERE user_id = $1", [userId]);

  if (m.role === "admin") {
    const { rows: remaining } = await client.query(
      `SELECT user_id FROM group_members WHERE group_id = $1
        ORDER BY joined_at, user_id FOR UPDATE`,
      [m.group_id]
    );
    if (remaining.length === 0) {
      await client.query("DELETE FROM groups WHERE id = $1", [m.group_id]);
    } else {
      const next = remaining.find((r) => r.user_id === successorId) || remaining[0];
      await client.query("UPDATE group_members SET role = 'admin' WHERE user_id = $1", [next.user_id]);
    }
  }
  return m;
}

export default async function groupRoutes(app) {
  const auth = { preHandler: app.authenticate };

  /* ------------------------- Gruppe anlegen / beitreten ------------------------- */

  app.post(
    "/groups",
    {
      ...auth,
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
      schema: {
        body: { type: "object", required: ["name"], additionalProperties: false, properties: { name: GROUP_NAME } },
      },
    },
    async (request, reply) => {
      const name = request.body.name.trim();
      if (!name) throw new HttpError(400, "Der Gruppenname darf nicht leer sein.");
      const group = await withTransaction(async (client) => {
        if (await getMembership(client, request.user.id)) {
          throw new HttpError(409, "Du bist bereits in einer Gruppe.");
        }
        // Code-Kollisionen sind selten; ON CONFLICT vermeidet einen Transaktionsabbruch.
        for (let attempt = 0; attempt < 10; attempt++) {
          const { rows } = await client.query(
            `INSERT INTO groups (code, name) VALUES ($1, $2)
             ON CONFLICT (code) DO NOTHING RETURNING id, code, name`,
            [generateGroupCode(), name]
          );
          if (rows[0]) {
            await client.query(
              "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')",
              [rows[0].id, request.user.id]
            );
            return rows[0];
          }
        }
        throw new Error("Kein freier Gruppen-Code gefunden");
      });
      return reply.code(201).send({ ...group, role: "admin" });
    }
  );

  app.post(
    "/groups/join",
    {
      ...auth,
      // Begrenzt das Durchprobieren von Gruppen-Codes.
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: { code: { type: "string", maxLength: 20 } },
        },
      },
    },
    async (request) => {
      const code = normalizeCode(request.body.code);
      return withTransaction(async (client) => {
        if (await getMembership(client, request.user.id)) {
          throw new HttpError(409, "Du bist bereits in einer Gruppe. Bitte zuerst austreten.");
        }
        const { rows } = /^[A-Z0-9]{6}$/.test(code)
          ? await client.query("SELECT id, code, name FROM groups WHERE code = $1", [code])
          : { rows: [] };
        if (!rows[0]) throw new HttpError(404, "Keine Gruppe mit diesem Code gefunden.");
        await client.query("INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)", [
          rows[0].id,
          request.user.id,
        ]);
        return { ...rows[0], role: "member" };
      });
    }
  );

  /* -------------------------------- Übersicht --------------------------------- */

  // Eigene Gruppe mit Mitgliedern und deren letztem geteilten Check-in.
  // Die View latest_shared_checkins enthält ALLE Nutzer, deshalb wird hier
  // ausdrücklich auf die Mitglieder der eigenen Gruppe gefiltert.
  app.get("/group", auth, async (request) => {
    const m = await requireMembership(request.user.id);
    const { rows } = await query(
      `SELECT gm.user_id, u.display_name, gm.role, gm.joined_at,
              l.checkin_id, l.week_id, l.next_step_area, l.next_step_text, l.updated_at
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         LEFT JOIN latest_shared_checkins l ON l.user_id = gm.user_id
        WHERE gm.group_id = $1
        ORDER BY gm.joined_at, gm.user_id`,
      [m.group_id]
    );
    const checkinIds = rows.map((r) => r.checkin_id).filter(Boolean);
    const scoresByCheckin = {};
    if (checkinIds.length) {
      const scores = await query(
        "SELECT checkin_id, area_key, score FROM checkin_scores WHERE checkin_id = ANY($1::uuid[])",
        [checkinIds]
      );
      for (const s of scores.rows) {
        (scoresByCheckin[s.checkin_id] ||= {})[s.area_key] = s.score;
      }
    }
    return {
      id: m.group_id,
      code: m.code,
      name: m.name,
      role: m.role,
      members: rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        role: r.role,
        joinedAt: r.joined_at,
        isMe: r.user_id === request.user.id,
        latestCheckin: r.checkin_id
          ? {
              weekId: r.week_id,
              nextStepArea: r.next_step_area,
              nextStepText: r.next_step_text,
              scores: scoresByCheckin[r.checkin_id] || {},
              updatedAt: r.updated_at,
            }
          : null,
      })),
    };
  });

  /* ------------------------------ Verwaltung ---------------------------------- */

  app.patch(
    "/group",
    {
      ...auth,
      schema: {
        body: { type: "object", required: ["name"], additionalProperties: false, properties: { name: GROUP_NAME } },
      },
    },
    async (request) => {
      const m = await requireAdmin(request.user.id);
      const name = request.body.name.trim();
      if (!name) throw new HttpError(400, "Der Gruppenname darf nicht leer sein.");
      await query("UPDATE groups SET name = $2 WHERE id = $1", [m.group_id, name]);
      return { id: m.group_id, code: m.code, name, role: m.role };
    }
  );

  // Admin-Rolle abgeben. Reihenfolge wichtig: Der Teil-Index erlaubt nur einen Admin pro Gruppe.
  app.post(
    "/group/transfer",
    {
      ...auth,
      schema: {
        body: { type: "object", required: ["userId"], additionalProperties: false, properties: { userId: UUID } },
      },
    },
    async (request, reply) => {
      const m = await requireAdmin(request.user.id);
      const targetId = request.body.userId;
      if (targetId === request.user.id) throw new HttpError(400, "Du bist bereits Gruppenleitung.");
      await withTransaction(async (client) => {
        const { rowCount } = await client.query(
          "SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 FOR UPDATE",
          [m.group_id, targetId]
        );
        if (rowCount === 0) throw new HttpError(404, "Diese Person ist nicht in deiner Gruppe.");
        await client.query("UPDATE group_members SET role = 'member' WHERE user_id = $1", [request.user.id]);
        await client.query("UPDATE group_members SET role = 'admin' WHERE user_id = $1", [targetId]);
      });
      return reply.code(204).send();
    }
  );

  // Selbst austreten. Admins können optional einen Nachfolger bestimmen.
  app.post(
    "/group/leave",
    {
      ...auth,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { successorId: UUID },
        },
      },
    },
    async (request, reply) => {
      const left = await withTransaction((client) =>
        leaveGroupTx(client, request.user.id, request.body?.successorId || null)
      );
      if (!left) throw new HttpError(404, "Du bist in keiner Gruppe.");
      return reply.code(204).send();
    }
  );

  // Mitglied entfernen (nur Admin, nicht sich selbst – dafür /group/leave).
  app.delete(
    "/group/members/:userId",
    {
      ...auth,
      schema: { params: { type: "object", required: ["userId"], properties: { userId: UUID } } },
    },
    async (request, reply) => {
      const m = await requireAdmin(request.user.id);
      if (request.params.userId === request.user.id) {
        throw new HttpError(400, "Zum Austreten bitte /group/leave verwenden.");
      }
      const { rowCount } = await query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [
        m.group_id,
        request.params.userId,
      ]);
      if (rowCount === 0) throw new HttpError(404, "Diese Person ist nicht in deiner Gruppe.");
      return reply.code(204).send();
    }
  );

  /* ---------------------------------- Chat ------------------------------------ */

  // Ohne "after": die letzten 200 Nachrichten. Mit "after": nur neuere (für Polling).
  app.get(
    "/group/messages",
    {
      ...auth,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { after: { type: "integer", minimum: 0 } },
        },
      },
    },
    async (request) => {
      const m = await requireMembership(request.user.id);
      const after = request.query.after;
      const { rows } = await query(
        after !== undefined
          ? `SELECT gm.id, gm.user_id, u.display_name, gm.text, gm.created_at
               FROM group_messages gm JOIN users u ON u.id = gm.user_id
              WHERE gm.group_id = $1 AND gm.id > $2
              ORDER BY gm.id LIMIT 200`
          : `SELECT * FROM (
               SELECT gm.id, gm.user_id, u.display_name, gm.text, gm.created_at
                 FROM group_messages gm JOIN users u ON u.id = gm.user_id
                WHERE gm.group_id = $1
                ORDER BY gm.id DESC LIMIT 200
             ) last ORDER BY id`,
        after !== undefined ? [m.group_id, after] : [m.group_id]
      );
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        displayName: r.display_name,
        text: r.text,
        createdAt: r.created_at,
        isMine: r.user_id === request.user.id,
      }));
    }
  );

  app.post(
    "/group/messages",
    {
      ...auth,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: { text: { type: "string", minLength: 1, maxLength: 2000 } },
        },
      },
    },
    async (request, reply) => {
      const m = await requireMembership(request.user.id);
      const text = request.body.text.trim();
      if (!text) throw new HttpError(400, "Leere Nachrichten sind nicht erlaubt.");
      const { rows } = await query(
        `INSERT INTO group_messages (group_id, user_id, text) VALUES ($1, $2, $3)
         RETURNING id, created_at`,
        [m.group_id, request.user.id, text]
      );
      return reply.code(201).send({
        id: rows[0].id,
        userId: request.user.id,
        displayName: request.user.display_name,
        text,
        createdAt: rows[0].created_at,
        isMine: true,
      });
    }
  );
}
