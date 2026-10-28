-- Migration 005: E-Mail-Bestätigung, Passwort vergessen per Mail, lokale Admins (Break-Glass)
--
-- Ausführen als Datenbank-Eigentümer (nicht als App-Rolle):
--   sudo -u postgres psql -d nextstep -v ON_ERROR_STOP=1 -f 005_email_bestaetigung_und_break_glass.sql

BEGIN;

-- ---------------------------------------------------------------------
-- E-Mail-Bestätigung
-- ---------------------------------------------------------------------
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- Bestehende Konten gelten als bestätigt (vor Einführung angelegt bzw. über Authentik).
UPDATE users SET email_verified_at = now();

-- Einmal-Links zur Bestätigung. Gespeichert wird nur der Hash des Tokens.
CREATE TABLE email_verifications (
  token_hash  text        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX email_verifications_user_id_idx ON email_verifications (user_id);
CREATE INDEX email_verifications_expires_at_idx ON email_verifications (expires_at);

-- ---------------------------------------------------------------------
-- Lokale Admins (Break-Glass, falls Authentik nicht erreichbar ist)
-- ---------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN is_local_admin   boolean NOT NULL DEFAULT false,
  -- TOTP-Geheimnis, verschlüsselt mit APP_SECRET_KEY (AES-256-GCM)
  ADD COLUMN totp_secret_enc  text,
  ADD COLUMN totp_enabled_at  timestamptz,
  -- zuletzt verwendetes 30-Sekunden-Fenster: ein Code gilt nur einmal
  ADD COLUMN totp_last_step   bigint;

-- Woher stammt das Admin-Recht einer Sitzung? 'sso' (Authentik-Gruppe) oder 'local' (Break-Glass)
ALTER TABLE sessions
  ADD COLUMN admin_via text CHECK (admin_via IN ('sso', 'local'));
UPDATE sessions SET admin_via = 'sso' WHERE is_admin;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_admin_via_matches CHECK ((admin_via IS NOT NULL) = is_admin);

GRANT SELECT, INSERT, UPDATE, DELETE ON email_verifications TO nextstep_app;

COMMIT;
