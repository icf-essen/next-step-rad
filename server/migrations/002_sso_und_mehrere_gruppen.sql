-- Migration 002: Anmeldung über Authentik (OIDC) und mehrere Gruppen pro Person
--
-- Ausführen als Datenbank-Eigentümer (nicht als App-Rolle):
--   sudo -u postgres psql -d nextstep -v ON_ERROR_STOP=1 -f 002_sso_und_mehrere_gruppen.sql
--
-- Läuft in einer Transaktion: Bei einem Fehler bleibt die Datenbank unverändert.

BEGIN;

-- ---------------------------------------------------------------------
-- Konten ohne Passwort (reine SSO-Konten)
-- ---------------------------------------------------------------------
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Verknüpfung eines Kontos mit einer externen Identität (Authentik).
-- Verknüpft wird ausschließlich über die unveränderliche ID des Anbieters
-- ("sub"), nie über die E-Mail-Adresse.
CREATE TABLE user_identities (
  provider    text        NOT NULL CHECK (provider ~ '^[a-z0-9_-]{1,40}$'),
  subject     text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  UNIQUE (user_id, provider)
);

-- ---------------------------------------------------------------------
-- Mehrere Gruppen pro Person, mehrere Leitungen pro Gruppe
-- ---------------------------------------------------------------------
ALTER TABLE group_members DROP CONSTRAINT group_members_user_id_key;
CREATE INDEX group_members_user_id_idx ON group_members (user_id);

DROP INDEX group_members_one_admin_per_group;

-- ---------------------------------------------------------------------
-- Team-Gruppen, die aus Authentik übernommen werden
-- ---------------------------------------------------------------------
-- external_source/external_id gesetzt  -> Gruppe wird von Authentik verwaltet
-- beide NULL                            -> eigene Gruppe (wie bisher, per Code)
ALTER TABLE groups
  ADD COLUMN external_source text,
  ADD COLUMN external_id     text,
  ADD CONSTRAINT groups_external_pair CHECK ((external_source IS NULL) = (external_id IS NULL));

CREATE UNIQUE INDEX groups_external_unique
  ON groups (external_source, external_id)
  WHERE external_source IS NOT NULL;

-- Neue Tabellen für die App-Rolle freigeben
GRANT SELECT, INSERT, UPDATE, DELETE ON user_identities TO nextstep_app;

-- Künftige Tabellen automatisch freigeben (spart GRANTs bei weiteren Migrationen)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nextstep_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nextstep_app;

COMMIT;
