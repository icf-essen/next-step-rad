-- Migration 004: Team-Gruppen abwählen
--
-- Ausführen als Datenbank-Eigentümer (nicht als App-Rolle):
--   sudo -u postgres psql -d nextstep -v ON_ERROR_STOP=1 -f 004_team_gruppen_abwaehlen.sql
--
-- Die Mitgliedschaft in Team-Gruppen kommt weiter aus Authentik. opted_out hält nur
-- fest, dass die Person selbst nicht teilnehmen möchte. Der Abgleich beim SSO-Login
-- lässt diesen Wert unverändert, deshalb bleibt die Entscheidung bestehen.

BEGIN;

ALTER TABLE group_members ADD COLUMN opted_out boolean NOT NULL DEFAULT false;

COMMIT;
