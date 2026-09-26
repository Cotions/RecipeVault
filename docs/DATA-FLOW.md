# Data flow — input, validate, save, index

Draft 2. Companion to `RECIPE-SCHEMA.md` and `VOCAB.md`.

Principle: **`recipes/*.md` on disk is the source of truth. SQLite is a derived
cache that can be deleted and rebuilt.** Nothing may live only in the database.

All paths are relative to the vault folder (`vault_directory` in the config), which
lives outside the app repository. The app never writes inside its own repository.

## Two inputs, one save path

```
me:  paste raw markdown ──┐
                          ├──> parse ──> validate ──> preview ──> SAVE
her: form UI ─────────────┘
```

The form does not write to the database directly. It builds a recipe object,
serializes it to markdown in the recipe's language, and enters the same pipeline a
paste does. One parser, one validator, one writer. The form therefore cannot
produce a file the parser fails to read, and a fix to validation improves both
paths at once.

### SAVE, in order

1. Serialize to markdown (if coming from the form).
2. Write `recipes/<slug>.md` to disk.
3. Commit to the vault's git repository — `add: <title>` or `edit: <title>`,
   author tagged with whoever saved it. Push to its private remote in the
   background; a failed push is retried later and never blocks the save.
4. Upsert index rows in one transaction.
5. Generate thumbnails for any new images.

Order is not arbitrary. File write fails → nothing indexed. Index write fails →
the file exists and `vault sync` recovers it. Never the reverse.

### Delete

Never unlink. Move the file to `_trash/<slug>.md` and its `media/<slug>/` folder alongside it, commit, remove the
index rows. A trash view restores it. Combined with the git history this means no
single click she makes is unrecoverable.

### Concurrent edit

Files mean last-write-wins, which silently eats an edit. Cheap guard: the edit
form carries the `updated` timestamp it loaded; if the file on disk is newer,
refuse and show what changed. Two users at this scale will rarely collide, but the
one time they do it should not be silent.

## Validation

Hard errors — refuse to save:
- malformed YAML frontmatter (paste path only; the form cannot produce this)
- missing `title`
- `slug` already exists → offer overwrite, or a suffixed slug
- `family` set without `variant`, or `variant` without `family`

Warnings — save anyway, mark the recipe `needs-review`:
- no ingredients section or no method section
- ingredient lines whose quantity failed to parse (list them explicitly)
- a tag not in the vocabulary → suggest closest canonical, else store `pending`
- a `family` close to an existing one (catches `lasagne` vs `lasagna`)
- another recipe has a near-identical title (duplicate paste — expected at 5000)
- no `servings`, no `times`, no photo

Conveniences:
- `slug` absent → derive from `title`: lowercase, strip accents, hyphenate
- `lang` absent → `fr`
- `added` absent → today; `updated` → always now
- `status` absent → `draft` if any warning fired, else `verified`
- `extracted_by` absent → `hand`

Her form never shows a raw error. Invalid states are prevented structurally —
required fields marked, ingredient rows added by a button, family chosen from a
picker, tags from an autocomplete over the vocabulary.

## Index schema (SQLite)

Derived. Regenerable. Not precious. Lives at `cache/index.db` inside the vault, excluded from git and backup. See `STORAGE.md`.

```sql
CREATE TABLE recipes (
  slug         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  lang         TEXT NOT NULL DEFAULT 'fr',
  family       TEXT,
  variant      TEXT,
  source_type  TEXT,
  author       TEXT,
  source_url   TEXT,
  source_title TEXT,
  source_page  TEXT,
  prep_s       INTEGER,        -- durations normalized to seconds, for sorting
  cook_s       INTEGER,
  rest_s       INTEGER,
  total_s      INTEGER,        -- given, else prep+cook+rest
  servings     INTEGER,
  difficulty   INTEGER,
  rating       INTEGER,
  status       TEXT,
  added        TEXT,
  updated      TEXT,
  file_path    TEXT NOT NULL,
  file_hash    TEXT NOT NULL,  -- lets sync skip unchanged files
  body_md      TEXT NOT NULL   -- cached so rendering needs no disk read
);

CREATE TABLE families (
  slug        TEXT PRIMARY KEY,
  label_fr    TEXT,
  label_en    TEXT
);

CREATE TABLE tags (
  slug        TEXT,            -- recipe slug
  tag         TEXT,            -- canonical form, see VOCAB.md
  pending     INTEGER DEFAULT 0,
  PRIMARY KEY (slug, tag)
);

CREATE TABLE seasons (slug TEXT, season TEXT, PRIMARY KEY (slug, season));

CREATE TABLE ingredients (
  slug       TEXT,
  position   INTEGER,
  group_name TEXT,             -- "Pour la sauce", NULL if ungrouped
  raw        TEXT NOT NULL,    -- the line as written, always kept
  qty        REAL,             -- NULL when parsing failed
  unit       TEXT,             -- canonical unit, see VOCAB.md
  item       TEXT,             -- normalized, for the reverse index
  PRIMARY KEY (slug, position)
);

CREATE TABLE media (
  slug  TEXT,
  kind  TEXT,                  -- final | step | scan
  path  TEXT,
  thumb TEXT,
  w     INTEGER,
  h     INTEGER,
  PRIMARY KEY (slug, kind, path)
);

CREATE VIRTUAL TABLE recipes_fts USING fts5(
  title, body, ingredient_text,
  content='', tokenize='unicode61 remove_diacritics 2'
);

CREATE INDEX idx_recipes_family  ON recipes(family);
CREATE INDEX idx_recipes_total   ON recipes(total_s);
CREATE INDEX idx_recipes_rating  ON recipes(rating);
CREATE INDEX idx_recipes_status  ON recipes(status);
CREATE INDEX idx_ingredients_item ON ingredients(item);
```

`remove_diacritics 2` matters for a French vault: `boeuf` must find `bœuf`,
`creme` must find `crème`.

## vault sync

```
vault sync [--force]
```

Walk `recipes/*.md`. Hash each file, compare to the stored `file_hash`, skip if
unchanged unless `--force`. Reparse new and changed files. Drop index rows whose
file no longer exists. Report counts plus every file that failed to parse.

With hashing, a no-op sync over 5000 files is a couple of seconds. Run it on app
startup so hand-edits in a text editor are always picked up.

## Family diff table

For a given `family`, select every variant, then compute:
- ingredient `item` values unique to each variant — the actual differentiator
- items common to all variants, shown once and collapsed
- differing `total_s`, `servings`, `difficulty`, `rating`

That table is the "lasagna, all types" view. It answers *what is different*, not
just *what exists*.

## Authentication

Two accounts minimum, since edits should be attributable in the git history and
deletes should not be anonymous.

The right model depends on an unresolved question — whether the app is reachable
only on the home network or from the open internet:

**LAN-only.** A single shared password over HTTP is defensible, with a name picker
so commits are attributed. Note honestly that this protects against nothing but
accidents; anyone on the network can read and write.

**Internet-reachable.** This needs real handling, because a public write endpoint
will be found by automated scanners within days:
- per-user accounts with passwords hashed using argon2id or bcrypt, never plain
  or fast hashes
- HTTPS only, via a reverse proxy with a real certificate — a login over plain
  HTTP exposes the password on every request
- rate limiting and lockout on the login endpoint
- session cookies marked `HttpOnly`, `Secure`, `SameSite=Lax`
- uploads restricted by type and size, stored outside the web root, served
  through the app rather than directly, and never executed
- the recipes directory and `.git` never served as static files

Simplest safe answer, and the recommendation: keep it LAN-only, and reach it from
outside over a WireGuard or Tailscale tunnel. That removes the public attack
surface entirely and makes the in-app auth a convenience rather than the only
thing standing between the vault and the internet.
