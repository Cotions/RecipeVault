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
index rows. A trash view (`/corbeille`) restores it — refused if the slug has been
taken again. A slug in the trash counts as taken for a new paste (`E103`, offered
only the suffixed slug), so a deleted slug is never silently reused. Combined
with the git history this means no single click she makes is unrecoverable.

### Concurrent edit

Files mean last-write-wins, which silently eats an edit. Cheap guard: every
edit carries the hash of the file it was based on — the paste box's
"Remplacer", the "Vérifié" button, delete — and the save refuses when the file
on disk no longer has that hash. (A hash rather than `updated`: `updated` is a
date, too coarse to see two edits on the same day.) Two users at this scale will
rarely collide, but the one time they do it should not be silent.

## Validation

The full list, with codes, is `VALIDATION.md`; this is the summary.

Hard errors — refuse to save:
- malformed YAML frontmatter (paste path only; the form cannot produce this)
- missing `title`
- `ingredients` missing or empty (`E200`), or any malformed ingredient entry —
  bad unit, qty without unit, quantity inside the name, and the rest of `E2xx`
- `slug` already exists → offer overwrite, or a suffixed slug
- `family` set without `variant`, or `variant` without `family`

Warnings — save anyway, mark the recipe `needs-review`:
- no method section
- a tag not in the vocabulary → suggest closest canonical, else store `pending`
- a `family` close to an existing one (catches `lasagne` vs `lasagna`)
- another recipe has a near-identical title (duplicate paste — expected at 5000)
- no `servings`, no `times`, no photo

Conveniences:
- `slug` absent → derive from `title`: lowercase, strip accents, hyphenate
- `lang` absent → `fr`
- `added` → today on a new recipe, kept on an edit; `updated` → today on every save
- `status` → set by the app on every paste, never taken from the file: an AI file
  is never auto-`verified`. `needs-review` if any `[?]`, `[?: …]` or
  `[illisible]` remains (W605), otherwise `draft`. `verified` is set only by a
  person, with the "Vérifié" button on the recipe page — a one-field edit
  through the normal save path, committed as `verify: <title>`, refused while an
  uncertain marker remains.
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
  kind  TEXT,                  -- final | step
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

## File watcher — edits from outside the app

The files are the truth, so they can be edited by anything: a text editor, Obsidian,
`git revert` in the vault. Same pattern as ChannelVault watching its download folder
in real time. While the app runs, it watches `recipes/`, `ingredients/`, `vocab/`,
and `prices.csv`:

- Debounce ~1 s after the last change — editors save in several writes.
- Re-parse and re-index only the changed file.
- If it parses: commit it to the vault repo as `edit (external): <title>`.
- If it does not: keep the last good index rows, flag the recipe in the UI with the
  validation errors, and do not commit. A half-typed edit in Obsidian must never
  knock a recipe out of search.
- Ignore the app's own writes (it knows the hash it just wrote), or every save would
  echo back as an external edit.

`vault sync` on startup still covers edits made while the app was stopped.

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
