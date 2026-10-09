// The SQLite index (docs/DATA-FLOW.md, "Index schema"). A cache: on a schema
// version change the whole database is dropped and rebuilt from the files.
// Kept as a TS string rather than a .sql file so the CLI (tsx) and the app
// (Vite) load it the same way.

/** Bump on any change below: the index is then rebuilt from scratch. */
export const SCHEMA_VERSION = 8;

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

-- Index bookkeeping: tags_hash = sha256 of vocab/tags.yaml at the last retag;
-- registry_hash = sha256 over the ingredient files and the vocab they depend on;
-- prices_hash = sha256 of prices.csv and the config's currency at the last load.
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
  qty_s      TEXT,                      -- qty as written ("1 1/2"), for display
  unit       TEXT,
  name       TEXT NOT NULL,             -- as written
  optional   INTEGER NOT NULL DEFAULT 0,
  to_taste   INTEGER NOT NULL DEFAULT 0,
  recipe     TEXT,                      -- sub-recipe slug
  buy_instead INTEGER NOT NULL DEFAULT 0,
  key        TEXT NOT NULL,             -- lookup key (docs/INGREDIENTS.md, Resolution 1)
  item       TEXT,                      -- the resolved registry slug, NULL when unresolved
  resolution TEXT NOT NULL,             -- override | alias | plural | none | ambiguous | recipe
  PRIMARY KEY (slug, position)
);

-- The \`or\` options of an ingredient entry, resolved the same way.
CREATE TABLE ingredient_or (
  slug       TEXT NOT NULL,
  position   INTEGER NOT NULL,          -- the entry's position in ingredients
  alt_idx    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  recipe     TEXT,
  key        TEXT NOT NULL,
  item       TEXT,
  resolution TEXT NOT NULL,
  PRIMARY KEY (slug, position, alt_idx)
);

-- The ingredient registry, ingredients/<slug>.md (docs/INGREDIENTS.md). A file
-- that stops passing its check keeps its last good row, flagged in registry_problems.
CREATE TABLE registry (
  slug         TEXT PRIMARY KEY,
  file_path    TEXT NOT NULL UNIQUE,
  file_hash    TEXT NOT NULL,
  name         TEXT NOT NULL,           -- display name: first French name, else first English
  category     TEXT NOT NULL,
  staple       INTEGER NOT NULL DEFAULT 0,
  au_gout      INTEGER NOT NULL DEFAULT 0,
  density      REAL,
  default_unit TEXT,
  entry_json   TEXT NOT NULL,           -- the parsed entry (names, weights, substitutes, allergens…)
  warnings_json TEXT NOT NULL DEFAULT '[]', -- the file's own warnings (W809, W811)
  body         TEXT NOT NULL
);

-- Every alias of every entry, by lookup key (docs/INGREDIENTS.md, Resolution 2).
-- skey: the key with the plural rules of vocab/normalize.yaml applied.
CREATE TABLE ingredient_names (
  key   TEXT NOT NULL,
  skey  TEXT NOT NULL,
  slug  TEXT NOT NULL,
  lang  TEXT NOT NULL,
  name  TEXT NOT NULL,                  -- as written in the entry
  PRIMARY KEY (slug, lang, name)
);

CREATE TABLE substitutes (slug TEXT NOT NULL, substitute TEXT NOT NULL, PRIMARY KEY (slug, substitute));
CREATE TABLE ingredient_allergens (slug TEXT NOT NULL, allergen TEXT NOT NULL, PRIMARY KEY (slug, allergen));

-- Ingredient files with diagnostics: broken = 1 when the file has errors (its
-- last good registry row, if any, is kept); warnings alone leave broken = 0.
CREATE TABLE registry_problems (
  file_path   TEXT PRIMARY KEY,
  slug        TEXT,
  file_hash   TEXT NOT NULL,
  broken      INTEGER NOT NULL DEFAULT 0,
  diagnostics TEXT NOT NULL             -- JSON list of { code, severity, path, message, fix? }
);

-- prices.csv (docs/STORAGE.md, "Prices"): every row that reads. usable = 1 when
-- the row is in the config's currency (a row in another one is shown, never costed).
CREATE TABLE prices (
  line       INTEGER PRIMARY KEY,       -- line number in prices.csv
  date       TEXT NOT NULL,             -- YYYY-MM-DD
  ingredient TEXT NOT NULL,             -- registry slug (may name no entry: W814)
  amount     REAL NOT NULL,
  currency   TEXT NOT NULL,
  pack_qty   REAL NOT NULL,
  pack_unit  TEXT NOT NULL,
  shop       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  usable     INTEGER NOT NULL
);

-- prices.csv lines that do not read (E812, E813): skipped, listed with their line.
CREATE TABLE price_problems (
  line    INTEGER NOT NULL,
  code    TEXT NOT NULL,
  message TEXT NOT NULL,
  fix     TEXT
);

-- The current price of an ingredient: its latest usable row, a same-day tie
-- going to the later line (plan 03, Q7: one price, whatever the shop).
CREATE VIEW current_price AS
  SELECT p.* FROM prices p
  WHERE p.usable = 1 AND NOT EXISTS (
    SELECT 1 FROM prices q
    WHERE q.ingredient = p.ingredient AND q.usable = 1 AND (q.date > p.date OR (q.date = p.date AND q.line > p.line))
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

-- The vault's git history (index/commits.ts): every non-merge commit reachable
-- from HEAD, and the paths it changed, renames detected over the whole tree.
-- meta commits_head = the HEAD they were read up to. Rebuilt from git when missing.
CREATE TABLE commits (
  seq     INTEGER PRIMARY KEY,         -- git log order (default, by date): higher = newer
  hash    TEXT NOT NULL UNIQUE,
  author  TEXT NOT NULL,               -- %an
  date    TEXT NOT NULL,               -- %aI, the author's offset
  subject TEXT NOT NULL
);

CREATE TABLE commit_files (
  seq       INTEGER NOT NULL,          -- commits.seq
  pos       INTEGER NOT NULL,          -- order in git's name-status output
  status    TEXT NOT NULL,             -- A M D T R (name-status, score dropped)
  path      TEXT NOT NULL,             -- the path after (the removed path for D)
  from_path TEXT,                      -- R: the path before
  PRIMARY KEY (seq, path)
) WITHOUT ROWID;

CREATE INDEX idx_commit_files_path ON commit_files(path, seq);
CREATE INDEX idx_commit_files_from ON commit_files(from_path, seq) WHERE from_path IS NOT NULL;

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
CREATE INDEX idx_ingredients_key ON ingredients(key);
-- The resolve queue and its nav count: unresolved rows only.
CREATE INDEX idx_ingredients_unresolved ON ingredients(key) WHERE resolution IN ('none', 'ambiguous');
CREATE INDEX idx_or_unresolved ON ingredient_or(key) WHERE resolution IN ('none', 'ambiguous');
CREATE INDEX idx_or_item ON ingredient_or(item);
CREATE INDEX idx_or_key  ON ingredient_or(key);
CREATE INDEX idx_names_key  ON ingredient_names(key);
CREATE INDEX idx_names_skey ON ingredient_names(skey);
CREATE INDEX idx_substitutes_sub ON substitutes(substitute);
CREATE INDEX idx_prices_current ON prices(ingredient, usable, date, line);
`;
