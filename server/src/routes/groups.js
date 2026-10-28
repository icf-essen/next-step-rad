import { query, withTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { GROUP_NAME, UUID } from "../schemas.js";
import { generateGroupCode, normalizeCode } from "../security.js";

// Gruppen gibt es in zwei Arten:
//  - eigene Gruppen: von Nutzern erstellt, Beitritt per Code, Leitung verwaltet sie in der App
//  - Team-Gruppen: aus Authentik übernommen (external_source gesetzt), Mitglieder und Leitung
//    kommen ausschließlich aus Authentik; in der App sind sie schreibgeschützt.

const GROUP_ID_PARAMS = {
  type: "object",
  required: ["groupId"],
  properties: { groupId: UUID },
};

function isManaged(row) {
  return row.external_source !== null && row.external_source !== undefined;
}

/** Mitgliedschaft des Nutzers in einer bestimmten Gruppe, oder null. */
async function getMembership(db, groupId, userId, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT m.group_id, m.role, g.code, g.name, g.external_source
       FROM group_members m JOIN groups g ON g.id = m.group_id
      WHERE m.group_id = $1 AND m.user_id = $2 ${lock ? "FOR UPDATE OF m" : ""}`,
    [groupId, userId]
  );
  return rows[0] || null;
}

async function requireMembership(groupId, userId) {
  const m = await getMembership({ query }, groupId, userId);
  // Bewusst 404 statt 403: Außenstehende erfahren nicht, ob es die Gruppe gibt.
  if (!m) throw new HttpError(404, "Gruppe nicht gefunden.");
  return m;
}

function requireEditable(m) {
  if (isManaged(m)) {
    throw new HttpError(403, "Diese Team-Gruppe wird über Authentik verwaltet und kann hier nicht geändert werden.");
  }
}

async function requireAdmin(groupId, userId) {
  const m = await requireMembership(groupId, userId);
  requireEditable(m);
  if (m.role !== "admin") throw new HttpError(403, "Nur die Gruppenleitung darf das.");
  return m;
}

/** Gruppenübersicht für /me und GET /groups. Codes nur für eigene Gruppen. */
export async function listGroupsForUser(db, userId) {
  const { rows } = await db.query(
    `SELECT g.id, g.code, g.name, g.external_source, m.role,
            (SELECT count(*) FROM group_members x WHERE x.group_id = g.id)::int AS member_count
       FROM group_members m JOIN groups g ON g.id = m.group_id
      WHERE m.user_id = $1
      ORDER BY (g.external_source IS NULL), lower(g.name), g.id`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: isManaged(r) ? null : r.code,
    role: r.role,
    managed: isManaged(r),
    memberCount: r.member_count,
  }));
}

/**
 * Nutzer aus einer eigenen Gruppe entfernen (innerhalb einer Transaktion).
 * Geht die letzte Leitung, wird der gewählte Nachfolger oder das am längsten
 * dabei gewesene Mitglied Leitung. Ist niemand mehr übrig, wird die Gruppe gelöscht.
 */
export async function leaveGroupTx(client, groupId, userId, successorId) {
  const m = await getMembership(client, groupId, userId, { lock: true });
  if (!m) return null;
  requireEditable(m);

  await client.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [groupId, userId]);

  if (m.role === "admin") {
    const { rows: remaining } = await client.query(
      `SELECT user_id, role FROM group_members WHERE group_id = $1
        ORDER BY joined_at, user_id FOR UPDATE`,
      [groupId]
    );
    if (remaining.length === 0) {
      await client.query("DELETE FROM groups WHERE id = $1", [groupId]);
    } else if (!remaining.some((r) => r.role === "admin")) {
      const next = remaining.find((r) => r.user_id === successorId) || remaining[0];
      await client.query("UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2", [
        groupId,
        next.user_id,
      ]);
    }
  }
  return m;
}

/** Vor dem Löschen eines Kontos: aus allen eigenen Gruppen sauber austreten. */
export async function leaveAllOwnGroupsTx(client, userId) {
  const { rows } = await client.query(
    `SELECT m.group_id FROM group_members m JOIN groups g ON g.id = m.group_id
      WHERE m.user_id = $1 AND g.external_source IS NULL`,
    [userId]
  );
  for (const r of rows) await leaveGroupTx(client, r.group_id, userId, null);
}

export default async function groupRoutes(app) {
  const auth = { preHandler: app.authenticate };

  /* ------------------------------ Übersicht ------------------------------ */

  app.get("/groups", auth, async (request) => listGroupsForUser({ query }, request.user.id));

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
        // Code-Kollisionen sind selten; ON CONFLICT vermeidet einen Transaktionsabbruch.
        for (let attempt = 0; attempt < 10; attempt++) {
          const { rows } = await client.query(
            `INSERT INTO groups (code, name) VALUES ($1, $2)
             ON CONFLICT (code) DO NOTHING RETURNING id, code, name`,
            [generateGroupCode(), name]
          );
          if (rows[0]) {
            await client.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')", [
              rows[0].id,
              request.user.id,
            ]);
            return rows[0];
          }
        }
        throw new Error("Kein freier Gruppen-Code gefunden");
      });
      return reply.code(201).send({ ...group, role: "admin", managed: false, memberCount: 1 });
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
        // Team-Gruppen haben intern auch einen Code, sind aber nicht per Code betretbar.
        const { rows } = /^[A-Z0-9]{6}$/.test(code)
          ? await client.query("SELECT id, code, name FROM groups WHERE code = $1 AND external_source IS NULL", [code])
          : { rows: [] };
        if (!rows[0]) throw new HttpError(404, "Keine Gruppe mit diesem Code gefunden.");
        const { rowCount } = await client.query(
          `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)
           ON CONFLICT (group_id, user_id) DO NOTHING`,
          [rows[0].id, request.user.id]
        );
        if (rowCount === 0) throw new HttpError(409, "Du bist bereits in dieser Gruppe.");
        return { ...rows[0], role: "member", managed: false };
      });
    }
  );

  /* ------------------------------ Gruppe im Detail ------------------------------ */

  // Gruppe mit Mitgliedern und deren letztem geteilten Check-in.
  // Die View latest_shared_checkins enthält ALLE Nutzer, deshalb wird hier
  // ausdrücklich auf die Mitglieder dieser Gruppe gefiltert.
  app.get("/groups/:groupId", { ...auth, schema: { params: GROUP_ID_PARAMS } }, async (request) => {
    const m = await requireMembership(request.params.groupId, request.user.id);
    const { rows } = await query(
      `SELECT gm.user_id, u.display_name, gm.role, gm.joined_at,
              l.checkin_id, l.week_id, l.next_step_area, l.next_step_text, l.updated_at
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         LEFT JOIN latest_shared_checkins l ON l.user_id = gm.user_id
        WHERE gm.group_id = $1
        ORDER BY (gm.role <> 'admin'), gm.joined_at, gm.user_id`,
      [m.group_id]
    );
    const checkinIds = rows.map((r) => r.checkin_id).filter(Boolean);
    const scoresByCheckin = {};
    if (checkinIds.length) {
      const scores = await query(
        "SELECT checkin_id, area_key, score FROM checkin_scores WHERE checkin_id = ANY($1::uuid[])",
        [checkinIds]
      );
      for (const s of scores.rows) (scoresByCheckin[s.checkin_id] ||= {})[s.area_key] = s.score;
    }
    return {
      id: m.group_id,
      code: isManaged(m) ? null : m.code,
      name: m.name,
      role: m.role,
      managed: isManaged(m),
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
    "/groups/:groupId",
    {
      ...auth,
      schema: {
        params: GROUP_ID_PARAMS,
        body: { type: "object", required: ["name"], additionalProperties: false, properties: { name: GROUP_NAME } },
      },
    },
    async (request) => {
      const m = await requireAdmin(request.params.groupId, request.user.id);
      const name = request.body.name.trim();
      if (!name) throw new HttpError(400, "Der Gruppenname darf nicht leer sein.");
      await query("UPDATE groups SET name = $2 WHERE id = $1", [m.group_id, name]);
      return { id: m.group_id, code: m.code, name, role: m.role, managed: false };
    }
  );

  // Leitung an eine andere Person übergeben; man selbst wird normales Mitglied.
  app.post(
    "/groups/:groupId/transfer",
    {
      ...auth,
      schema: {
        params: GROUP_ID_PARAMS,
        body: { type: "object", required: ["userId"], additionalProperties: false, properties: { userId: UUID } },
      },
    },
    async (request, reply) => {
      const m = await requireAdmin(request.params.groupId, request.user.id);
      const targetId = request.body.userId;
      if (targetId === request.user.id) throw new HttpError(400, "Du leitest diese Gruppe bereits.");
      await withTransaction(async (client) => {
        const { rowCount } = await client.query(
          "SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 FOR UPDATE",
          [m.group_id, targetId]
        );
        if (rowCount === 0) throw new HttpError(404, "Diese Person ist nicht in der Gruppe.");
        await client.query("UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2", [
          m.group_id,
          targetId,
        ]);
        await client.query("UPDATE group_members SET role = 'member' WHERE group_id = $1 AND user_id = $2", [
          m.group_id,
          request.user.id,
        ]);
      });
      return reply.code(204).send();
    }
  );

  // Selbst austreten. Leitungen können optional einen Nachfolger bestimmen.
  app.post(
    "/groups/:groupId/leave",
    {
      ...auth,
      schema: {
        params: GROUP_ID_PARAMS,
        body: { type: "object", additionalProperties: false, properties: { successorId: UUID } },
      },
    },
    async (request, reply) => {
      const left = await withTransaction((client) =>
        leaveGroupTx(client, request.params.groupId, request.user.id, request.body?.successorId || null)
      );
      if (!left) throw new HttpError(404, "Gruppe nicht gefunden.");
      return reply.code(204).send();
    }
  );

  // Mitglied entfernen (nur Leitung, nicht sich selbst – dafür /leave).
  app.delete(
    "/groups/:groupId/members/:userId",
    {
      ...auth,
      schema: {
        params: {
          type: "object",
          required: ["groupId", "userId"],
          properties: { groupId: UUID, userId: UUID },
        },
      },
    },
    async (request, reply) => {
      const m = await requireAdmin(request.params.groupId, request.user.id);
      if (request.params.userId === request.user.id) {
        throw new HttpError(400, "Zum Austreten bitte /leave verwenden.");
      }
      const { rowCount } = await query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [
        m.group_id,
        request.params.userId,
      ]);
      if (rowCount === 0) throw new HttpError(404, "Diese Person ist nicht in der Gruppe.");
      return reply.code(204).send();
    }
  );

  /* ---------------------------------- Chat ------------------------------------ */

  // Ohne "after": die letzten 200 Nachrichten. Mit "after": nur neuere (für Polling).
  app.get(
    "/groups/:groupId/messages",
    {
      ...auth,
      schema: {
        params: GROUP_ID_PARAMS,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { after: { type: "integer", minimum: 0 } },
        },
      },
    },
    async (request) => {
      const m = await requireMembership(request.params.groupId, request.user.id);
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
    "/groups/:groupId/messages",
    {
      ...auth,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        params: GROUP_ID_PARAMS,
        body: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: { text: { type: "string", minLength: 1, maxLength: 2000 } },
        },
      },
    },
    async (request, reply) => {
      const m = await requireMembership(request.params.groupId, request.user.id);
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
