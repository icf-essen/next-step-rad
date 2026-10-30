-- Migration 003: Verwaltung (Admins aus Authentik) und Links zum Zurücksetzen von Passwörtern
--
-- Ausführen als Datenbank-Eigentümer (nicht als App-Rolle):
--   sudo -u postgres psql -d nextstep -v ON_ERROR_STOP=1 -f 003_admin_und_passwort_reset.sql

BEGIN;

-- Admin-Rechte hängen an der Sitzung, nicht am Konto: Sie gelten nur für eine
-- Anmeldung über Authentik, bei der die Person in der Admin-Gruppe war, und
-- enden mit dieser Sitzung. Eine Passwort-Anmeldung ist nie eine Admin-Sitzung.
ALTER TABLE sessions ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

-- Einmal-Links zum Festlegen eines neuen Passworts. Gespeichert wird nur der
-- Hash des Tokens; der Link selbst existiert nur beim Admin und beim Nutzer.
CREATE TABLE password_resets (
  token_hash  text        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX password_resets_user_id_idx ON password_resets (user_id);
CREATE INDEX password_resets_expires_at_idx ON password_resets (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON password_resets TO nextstep_app;

COMMIT;
