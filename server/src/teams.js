import { config } from "./config.js";
import { generateGroupCode } from "./security.js";

// Abgleich der Team-Gruppen mit den Gruppen aus Authentik.
//
//   Authentik-Gruppe "video-team"           -> Next-Step-Gruppe "Video Team"
//   Authentik-Gruppe "video-team-leitung"   -> Leitung in "Video Team"
//
// Authentik ist für Team-Gruppen die einzige Quelle: Wer dort nicht (mehr) im
// Team ist, wird beim nächsten SSO-Login auch hier entfernt.

const SOURCE = "authentik";

export function prettyTeamName(externalId) {
  const name = externalId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return (name || externalId).slice(0, 40);
}

/** Welche Teams und welche Rolle ergeben sich aus der Gruppenliste aus Authentik? */
export function teamsFromGroups(groupNames) {
  const { teamGroupPattern, leaderSuffix } = config.oidc;
  const names = new Set(groupNames.filter((g) => typeof g === "string" && g.length > 0 && g.length <= 200));
  const teams = new Map();
  for (const name of names) {
    if (teamGroupPattern.test(name)) {
      teams.set(name, names.has(name + leaderSuffix) ? "admin" : "member");
    }
  }
  return teams;
}

async function ensureTeamGroup(client, externalId) {
  const name = prettyTeamName(externalId);
  for (let attempt = 0; attempt < 10; attempt++) {
    const existing = await client.query(
      "SELECT id FROM groups WHERE external_source = $1 AND external_id = $2",
      [SOURCE, externalId]
    );
    if (existing.rows[0]) {
      await client.query("UPDATE groups SET name = $2 WHERE id = $1 AND name <> $2", [existing.rows[0].id, name]);
      return existing.rows[0].id;
    }
    // Ohne Konfliktziel fängt DO NOTHING sowohl eine parallele Anlage desselben
    // Teams als auch eine (seltene) Kollision beim internen Code ab.
    const inserted = await client.query(
      `INSERT INTO groups (code, name, external_source, external_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id`,
      [generateGroupCode(), name, SOURCE, externalId]
    );
    if (inserted.rows[0]) return inserted.rows[0].id;
  }
  throw new Error("Team-Gruppe konnte nicht angelegt werden: " + externalId);
}

/** Mitgliedschaften des Nutzers in Team-Gruppen an Authentik angleichen (innerhalb einer Transaktion). */
export async function syncTeamsTx(client, userId, groupNames) {
  const desired = teamsFromGroups(groupNames);

  const ids = new Map();
  for (const externalId of desired.keys()) ids.set(externalId, await ensureTeamGroup(client, externalId));

  const current = await client.query(
    `SELECT m.group_id, g.external_id
       FROM group_members m JOIN groups g ON g.id = m.group_id
      WHERE m.user_id = $1 AND g.external_source = $2`,
    [userId, SOURCE]
  );
  for (const row of current.rows) {
    if (!desired.has(row.external_id)) {
      await client.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [row.group_id, userId]);
    }
  }

  for (const [externalId, role] of desired) {
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role
       WHERE group_members.role IS DISTINCT FROM EXCLUDED.role`,
      [ids.get(externalId), userId, role]
    );
  }
  return desired;
}
