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

### The paste box

`/ajouter`. The browser checks every change live with the checker library; the
server re-checks with the vault (`E103`, `W306`, `W503`, `W608`) and is the only
judge on save. Several fences in one paste are saved in one commit; files that
fail stay in the box. A collision (`E103`) is settled inline: "Remplacer" (an
edit, with the hash guard below) or the suffixed slug; a same title (`W608`)
offers to set `family`/`variant` on the new file (the existing file is left
untouched in P1). The fix-request block holds only `ai` codes.

**Web import.** A URL typed above the box is fetched by the server — `http`/`https`
only, 10 s, 5 MB, redirects re-checked, and never a host resolving to a private,
loopback, link-local or CGNAT address (checked on the address actually
connected to). The page's schema.org `Recipe` JSON-LD is mapped to the schema
(`extracted_by: web`, `source.type: website`, `source.url`); ingredient lines go
through the quantity and unit parser, and a line that does not read cleanly
becomes `{ name: "<the whole line> [?]" }` so the checker flags it. The result
lands in the box for review; it is never saved directly. No JSON-LD → the page
says to use the AI path.

**Paste log.** Every save attempt, and every copy of the fix-request block,
appends one JSON line to `cache/paste-log.jsonl`: time, number of files, and per
file the codes and the outcome (`saved`, `rejected`, `collision`, `stale`,
`fixed-after-N-attempts`). No title, no content: attempts at the same recipe are
matched by a 12-character hash of the slug. `vault stats` prints the code
frequency with the fixer of each code — which prompt rules the AI breaks in
real use. Losing the log is fine.

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

The authoritative schema is `src/lib/server/index/schema.ts`; its version is
stored in `PRAGMA user_version`, and an index from another version is dropped
and rebuilt (it is a cache). In outline:

| Table | One row per | Notes |
|---|---|---|
| `recipes` | recipe | the columns below, plus `data_json` (the parsed recipe, so a page renders without a disk read), `body_md`, `file_hash`, `uncertain` (count of `[?]`/`[?: …]`/`[illisible]`), `photo`, and `broken_json` while the file on disk fails the checker |
| `problems` | file failing the checker | codes and paths; the file's last good `recipes` rows, if any, stay searchable |
| `families` | family in use or in `vocab/families.yaml` | labels from the vocabulary |
| `tags` | recipe × tag | canonical via `vocab/tags.yaml` aliases at index time; unknown tags stored folded with `pending = 1`. The file is never rewritten |
| `seasons` | recipe × season | |
| `ingredients` | ingredient item | `group_idx`, `group_name`, `group_optional`, `qty`, `qty_max` (numeric), `unit`, `name` (as written), `optional`, `recipe` (sub-recipe slug), `item` (normalized name: lowercase, NFC, no accents, markers stripped — registry resolution replaces it in P1.5) |
| `media` | recipe × media file | |
| `recipes_fts` | recipe | FTS5 over title, body, ingredient names, author, tags |

Durations are stored in seconds, the upper bound of a range; `total_s` is
`times.total` if given, else prep + cook + rest.

**Full-text search.** `recipes_fts` is a regular FTS5 table keyed by
`recipes.id` (its rowid), not a contentless one: `content=''` cannot return its
columns and needs the old values to delete a row. It costs a copy of the text,
a few MB at 5000 recipes. Tokenizer `unicode61 remove_diacritics 2`, and text is
**folded before it is indexed and before it is queried** (accents stripped, `œ`
→ `oe`, `æ` → `ae`, lowercase, markers removed): `remove_diacritics` alone does
not map the ligature `œ` to `oe`, so `boeuf` would not find `bœuf`. Each word of
a query becomes a prefix term (`"lasag"*`), all words required, so results
update as you type. Ranked with bm25, title weighted highest.

Measured on a generated vault of 5000 recipes (`scripts/gen-vault.ts --bench`):
full `sync --force` ~5 s, no-op sync ~1.3 s, FTS query ~1 ms, a browse page
with all facet counts ~10–13 ms.

## vault sync

```
vault sync [--force]
```

Walk `recipes/*.md`. Hash each file, compare to the stored `file_hash`, skip if
unchanged unless `--force`. Reparse new and changed files. Drop index rows whose
file no longer exists. Report counts plus every file that failed to parse. A file
that fails keeps its last good rows, flagged with its codes; the recipe page shows
them in a banner. A file whose `slug` differs from its file name is not indexed
(the slug is the file name). `vault reindex` deletes the index and rebuilds it.

With hashing, a no-op sync over 5000 files is a couple of seconds. Run it on app
startup so hand-edits in a text editor are always picked up.

## File watcher — edits from outside the app

The files are the truth, so they can be edited by anything: a text editor, Obsidian,
`git revert` in the vault. Same pattern as ChannelVault watching its download folder
in real time. While the app runs, it watches `recipes/`, `ingredients/`, `vocab/`,
and `prices.csv`:

- Debounce ~1 s after the last change — editors save in several writes.
- Re-parse and re-index only the changed file.
- If it parses: commit it to the vault repo as `edit (external): <title>`
  (`delete (external): <title>` when the file was removed). Files under
  `ingredients/`, `vocab/` and `prices.csv` are committed as
  `edit (external): <path>` when they still read as Markdown with frontmatter,
  YAML, or text respectively; a vocabulary change re-derives the tag and family
  rows.
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
