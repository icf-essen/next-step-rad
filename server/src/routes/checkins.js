import { query, withTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { AREA_KEY, WEEK_ID } from "../schemas.js";

function toCheckin(r) {
  return {
    weekId: r.week_id,
    nextStepArea: r.next_step_area,
    nextStepText: r.next_step_text,
    sharedWithGroup: r.shared_with_group,
    scores: r.scores || {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export default async function checkinRoutes(app) {
  // Eigener Verlauf, älteste Woche zuerst. Jede Abfrage ist auf request.user.id beschränkt.
  app.get("/checkins", { preHandler: app.authenticate }, async (request) => {
    const { rows } = await query(
      `SELECT c.week_id, c.next_step_area, c.next_step_text, c.shared_with_group,
              c.created_at, c.updated_at,
              COALESCE(json_object_agg(s.area_key, s.score) FILTER (WHERE s.area_key IS NOT NULL), '{}') AS scores
         FROM checkins c
         LEFT JOIN checkin_scores s ON s.checkin_id = c.id
        WHERE c.user_id = $1
        GROUP BY c.id
        ORDER BY c.week_id`,
      [request.user.id]
    );
    return rows.map(toCheckin);
  });

  // Check-in einer Woche anlegen oder überschreiben (eine Woche = ein Check-in).
  app.put(
    "/checkins/:weekId",
    {
      preHandler: app.authenticate,
      schema: {
        params: {
          type: "object",
          required: ["weekId"],
          properties: { weekId: WEEK_ID },
        },
        body: {
          type: "object",
          required: ["scores", "nextStepArea", "nextStepText", "sharedWithGroup"],
          additionalProperties: false,
          properties: {
            scores: {
              type: "object",
              minProperties: 1,
              maxProperties: 20,
              propertyNames: AREA_KEY,
              additionalProperties: { type: "integer", minimum: 0, maximum: 10 },
            },
            nextStepArea: AREA_KEY,
            nextStepText: { type: "string", minLength: 1, maxLength: 1000 },
            sharedWithGroup: { type: "boolean" },
          },
        },
      },
    },
    async (request) => {
      const userId = request.user.id;
      const { weekId } = request.params;
      const { scores, nextStepArea, sharedWithGroup } = request.body;
      const nextStepText = request.body.nextStepText.trim();
      if (!nextStepText) throw new HttpError(400, "Der nächste Schritt darf nicht leer sein.");

      await withTransaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO checkins (user_id, week_id, next_step_area, next_step_text, shared_with_group)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, week_id) DO UPDATE
             SET next_step_area = EXCLUDED.next_step_area,
                 next_step_text = EXCLUDED.next_step_text,
                 shared_with_group = EXCLUDED.shared_with_group
           RETURNING id`,
          [userId, weekId, nextStepArea, nextStepText, sharedWithGroup]
        );
        const checkinId = rows[0].id;
        await client.query("DELETE FROM checkin_scores WHERE checkin_id = $1", [checkinId]);
        for (const [areaKey, score] of Object.entries(scores)) {
          await client.query(
            "INSERT INTO checkin_scores (checkin_id, area_key, score) VALUES ($1, $2, $3)",
            [checkinId, areaKey, score]
          );
        }
        // Bei identischem UPDATE würde der Trigger nicht feuern; Scores zählen aber als Änderung.
        await client.query("UPDATE checkins SET updated_at = now() WHERE id = $1", [checkinId]);
      });

      const { rows } = await query(
        `SELECT c.week_id, c.next_step_area, c.next_step_text, c.shared_with_group,
                c.created_at, c.updated_at,
                COALESCE(json_object_agg(s.area_key, s.score) FILTER (WHERE s.area_key IS NOT NULL), '{}') AS scores
           FROM checkins c
           LEFT JOIN checkin_scores s ON s.checkin_id = c.id
          WHERE c.user_id = $1 AND c.week_id = $2
          GROUP BY c.id`,
        [userId, weekId]
      );
      return toCheckin(rows[0]);
    }
  );

  app.delete(
    "/checkins/:weekId",
    {
      preHandler: app.authenticate,
      schema: { params: { type: "object", required: ["weekId"], properties: { weekId: WEEK_ID } } },
    },
    async (request, reply) => {
      const { rowCount } = await query("DELETE FROM checkins WHERE user_id = $1 AND week_id = $2", [
        request.user.id,
        request.params.weekId,
      ]);
      if (rowCount === 0) throw new HttpError(404, "Kein Check-in für diese Woche.");
      return reply.code(204).send();
    }
  );
}
