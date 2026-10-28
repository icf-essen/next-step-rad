BEGIN;

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- password_hash enthält nicht das Passwort selbst, sondern nur einen Hash, den das Backend erzeugt.
CREATE TABLE users (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text        NOT NULL CHECK (email = btrim(email) AND position('@' IN email) > 1),
  password_hash  text        NOT NULL,
  display_name   text        NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 60),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);


CREATE TABLE areas (
  key            text     PRIMARY KEY,
  label          text     NOT NULL,
  default_color  text     NOT NULL CHECK (default_color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order     smallint NOT NULL UNIQUE
);

INSERT INTO areas (key, label, default_color, sort_order) VALUES
  ('glaube',      'Glaube',      '#C9906B', 1),
  ('beziehungen', 'Beziehungen', '#A13D3D', 2),
  ('gesundheit',  'Gesundheit',  '#3F6A52', 3),
  ('ressourcen',  'Ressourcen',  '#C97D3B', 4),
  ('arbeit',      'Arbeit',      '#2C6E68', 5);


CREATE TABLE user_area_colors (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  area_key   text NOT NULL REFERENCES areas (key),
  color_hex  text NOT NULL CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  PRIMARY KEY (user_id, area_key)
);


CREATE TABLE checkins (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week_id            text        NOT NULL CHECK (week_id ~ '^[0-9]{4}-W[0-9]{2}$'),
  next_step_area     text        NOT NULL REFERENCES areas (key),
  next_step_text     text        NOT NULL CHECK (char_length(btrim(next_step_text)) BETWEEN 1 AND 1000),
  shared_with_group  boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_id)
);

CREATE TRIGGER checkins_set_updated_at
  BEFORE UPDATE ON checkins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE checkin_scores (
  checkin_id  uuid     NOT NULL REFERENCES checkins (id) ON DELETE CASCADE,
  area_key    text     NOT NULL REFERENCES areas (key),
  score       smallint NOT NULL CHECK (score BETWEEN 0 AND 10),
  PRIMARY KEY (checkin_id, area_key)
);

CREATE TABLE groups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6}$'),
  name        text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- group_members: Zugehörigkeit + Rolle
--   * UNIQUE (user_id)  -> ein Nutzer ist in höchstens EINER Gruppe
--   * Teil-Index        -> pro Gruppe höchstens EIN Admin
--
-- Admin-Wechsel:
--   1) bisherigen Admin entfernen bzw. auf 'member' setzen
--   2) Nachfolger auf 'admin' setzen
-- Hat eine Gruppe keine Mitglieder mehr, kann das Backend sie löschen.
-- ---------------------------------------------------------------------
CREATE TABLE group_members (
  group_id   uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE UNIQUE INDEX group_members_one_admin_per_group
  ON group_members (group_id) WHERE role = 'admin';


CREATE TABLE group_messages (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id    uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  text        text        NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX group_messages_group_created_idx ON group_messages (group_id, created_at);

CREATE VIEW latest_shared_checkins AS
SELECT DISTINCT ON (c.user_id)
       c.id AS checkin_id,
       c.user_id,
       c.week_id,
       c.next_step_area,
       c.next_step_text,
       c.updated_at
FROM checkins c
WHERE c.shared_with_group
ORDER BY c.user_id, c.week_id DESC;

COMMIT;
