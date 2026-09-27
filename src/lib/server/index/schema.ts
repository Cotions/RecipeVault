// The SQLite index (docs/DATA-FLOW.md, "Index schema"). A cache: on a schema
// version change the whole database is dropped and rebuilt from the files.
// Kept as a TS string rather than a .sql file so the CLI (tsx) and the app
// (Vite) load it the same way.

/** Bump on any change below: the index is then rebuilt from scratch. */
export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
CREATE TABLE recipes (
  id            INTEGER PRIMARY KEY,   -- rowid of recipes_fts
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  title_sort    TEXT NOT NULL,         -- folded (no accents, lowercase, markers stripped)
  lang          TEXT NOT NULL DEFAULT 'fr',
  family        TEXT,
  variant       TEXT,
  source_type   TEXT,
  author        TEXT,
  source_url    TEXT,
  source_title  TEXT,
  source_page   TEXT,
  prep_s        INTEGER,               -- durations in seconds (upper bound of a range)
  cook_s        INTEGER,
  rest_s        INTEGER,
  total_s       INTEGER,               -- given, else prep+cook+rest
  servings      INTEGER,
  servings_max  INTEGER,
  difficulty    INTEGER,
  rating        INTEGER,
  status        TEXT,
  added         TEXT,
  updated       TEXT,
  extracted_by  TEXT,
  photo         TEXT,                  -- media.final filename, if any
  uncertain     INTEGER NOT NULL DEFAULT 0,  -- count of [?], [?: …], [illisible]
  file_path     TEXT NOT NULL,         -- relative to the vault
  file_hash     TEXT NOT NULL,         -- sha256 of the file; sync skips unchanged files
  body_md       TEXT NOT NULL,
  data_json     TEXT NOT NULL,         -- the parsed Recipe, for rendering without a disk read
  broken_json   TEXT                   -- diagnostics while the file on disk fails to parse
);

-- Files that fail the checker. Their last good rows (if any) stay in recipes.
CREATE TABLE problems (
  file_path   TEXT PRIMARY KEY,
  slug        TEXT,
  file_hash   TEXT NOT NULL,
  diagnostics TEXT NOT NULL             -- JSON list of { code, path, message }
);

-- Index bookkeeping: tags_hash = sha256 of vocab/tags.yaml at the last retag.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE families (
  slug     TEXT PRIMARY KEY,
  label_fr TEXT,
  label_en TEXT
);

CREATE TABLE tags (
  slug    TEXT NOT NULL,                -- recipe slug
  tag     TEXT NOT NULL,                -- canonical form when the vocabulary knows it
  pending INTEGER NOT NULL DEFAULT 0,   -- 1: not in vocab/tags.yaml
  PRIMARY KEY (slug, tag)
);

CREATE TABLE seasons (slug TEXT NOT NULL, season TEXT NOT NULL, PRIMARY KEY (slug, season));

CREATE TABLE ingredients (
  slug       TEXT NOT NULL,
  position   INTEGER NOT NULL,          -- order in the recipe, across groups
  group_idx  INTEGER NOT NULL,
  group_name TEXT,
  group_optional INTEGER NOT NULL DEFAULT 0,
  qty        REAL,
  qty_max    REAL,
  unit       TEXT,
  name       TEXT NOT NULL,             -- as written
  optional   INTEGER NOT NULL DEFAULT 0,
  recipe     TEXT,                      -- sub-recipe slug
  item       TEXT NOT NULL,             -- normalized name (P1.5: registry resolution)
  PRIMARY KEY (slug, position)
);

CREATE TABLE media (
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- final | step
  path TEXT NOT NULL,
  PRIMARY KEY (slug, kind, path)
);

-- A regular FTS5 table keyed by recipes.id. A contentless table (content='')
-- cannot return its columns and needs the old values to delete a row; a
-- regular one costs a copy of the text, a few MB at 5000 recipes. Text is
-- folded before it goes in (œ → oe, which unicode61 does not do by itself).
CREATE VIRTUAL TABLE recipes_fts USING fts5(
  title, body, ingredients, author, tags,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE INDEX idx_recipes_family  ON recipes(family);
CREATE INDEX idx_recipes_total   ON recipes(total_s);
CREATE INDEX idx_recipes_rating  ON recipes(rating);
CREATE INDEX idx_recipes_status  ON recipes(status);
CREATE INDEX idx_recipes_title   ON recipes(title_sort);
CREATE INDEX idx_recipes_added   ON recipes(added);
CREATE INDEX idx_recipes_updated ON recipes(updated);
CREATE INDEX idx_tags_tag        ON tags(tag);
CREATE INDEX idx_ingredients_item ON ingredients(item);
CREATE INDEX idx_ingredients_recipe ON ingredients(recipe);
`;
