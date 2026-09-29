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
5. Generate thumbnails for any new images (the derived copies of `STORAGE.md`
   §Media; a failure here costs nothing, they are made again on demand).

Order is not arbitrary. File write fails → nothing indexed. Index write fails →
the file exists and `vault sync` recovers it. Never the reverse. A failed write
or commit (a `.git/index.lock` left by another git command, say) puts every file
back as it was — a new file removed, an edited one restored — and the save
reports that nothing was saved: a file the app wrote but git never recorded
would otherwise sit uncommitted, and the watcher, which ignores the app's own
writes, would never commit it. Delete and restore roll back the same way.

### The paste box

`/ajouter`. The browser checks every change live with the checker library; the
server re-checks with the vault (`E103`, `W306`, `W503`, `W608`) and is the only
judge on save. Several fences in one paste are saved in one commit; files that
fail stay in the box. A collision (`E103`) is settled inline: "Remplacer" (an
edit, with the hash guard below) or the suffixed slug. Two files in one paste with the same new slug: the first
is saved, only the later one waits for that choice. A same title (`W608`)
offers to set `family`/`variant` on the new file (the paste box leaves the
existing file untouched; the form puts both in the family in one commit, below).
The fix-request block holds only `ai` codes.

**Web import.** A URL typed above the box is fetched by the server — `http`/`https`
only, 10 s for the whole fetch (redirects and body included, not only while
idle), 5 MB, redirects re-checked, and never a host resolving to a private,
loopback, link-local or CGNAT address (checked on the address actually
connected to; an IPv4 address inside an IPv6 one — `::ffff:7f00:1`, NAT64,
6to4 — is checked as IPv4). The page's schema.org `Recipe` JSON-LD is mapped to the schema
(`extracted_by: web`, `source.type: website`, `source.url`); ingredient lines go
through the quantity and unit parser, and a line that does not read cleanly
becomes `{ name: "<the whole line> [?]" }` so the checker flags it — including
a quantity followed by a unit word the vocabulary does not know
(`2 cuillères à soupe …`), which is never read as `piece`. The result
lands in the box for review; it is never saved directly. No JSON-LD → the page
says to use the AI path.

**Paste log.** Every save attempt, and every copy of the fix-request block,
appends one JSON line to `cache/paste-log.jsonl`: time, number of files, and per
file the codes and the outcome (`saved`, `rejected`, `collision`, `stale`,
`fixed-after-N-attempts`). No title, no content: attempts at the same recipe are
matched by a 12-character hash of the slug. `vault stats` prints the code
frequency with the fixer of each code — which prompt rules the AI breaks in
real use. Losing the log is fine.

### Her form

**Decided (plan 04, Phases 2–5).** `/nouvelle` (a new recipe) and
`/r/<slug>/modifier` (an edit; offered only for a file that passes the checker,
Q3 A) — both sign-in pages. The form edits a form model (`src/lib/form/`,
browser-safe) built by `toForm` from the parsed file; `fromForm` turns it back
into a recipe object and a body, `serialize` into the canonical text, and
`POST /api/form/save` enters the paste's own save (`formSave` → `saveLocked`).
Opening a recipe and saving without a change writes nothing and commits nothing
(the text is compared with the file as the app would write it); the round trip
is byte-identical over the fixture vault and the 320-card corpus.

- **Slug.** A new recipe's slug comes from its title, the first free `-N` against
  the index, the trash and the disk, chosen under the lock: `E103` never reaches
  her. An edit never changes the slug, whatever the title becomes.
- **What the form does not model** (Q4 A) is carried: the preamble, sections
  other than method / notes / variants / alternatives, `item:`, other `media`
  keys. YAML comments and unknown keys are dropped, as by any app save. An
  untouched method section is written back as its original text; a changed one
  is rewritten canonically (`1.` numbering across sub-headings).
- **Checks.** The browser runs the checker on exactly what Save would write;
  every error blocks Save on its row and field, in French. Warnings are hints
  (Q9 A): the name-word ones (`W302`, `W304`, `W607`) live in the browser, the
  vault ones from `POST /api/form/check` (debounced while she types, never
  blocking). An error the server check still returns is a bug in the form:
  logged with its codes, and she reads one sentence ("rien n'a changé").
- **Family** (Q10 A): a new family's French label, as she typed it, goes into
  `vocab/families.yaml` in the recipe's commit — only when the family has no
  label yet, so her save needs no hash of that file. `W608` "En faire deux
  versions" puts the other recipe in the family too, in the same commit
  (`add: <title>; edit: <other title>`), guarded by that file's hash.
- **Tags** (Q11 B): autocomplete over the canonical tags, their labels and
  aliases; a tag not in the vocabulary is written as typed and indexed as
  pending (below, "Pending tags").
- **Status** (Q14 A): see Conveniences. `extracted_by` absent → `hand`, kept on
  an edit.
- **Drafts** (Q17 A): the form is kept in the browser's `localStorage` (per
  recipe, one slot for a new one) and offered back on reopening; offline, Save
  says so and keeps it. No server-side draft, no queued save.
- **Stale** (Q18 A): "Concurrent edit", below.
- **Photo**: sent to `/api/photo` after the recipe's save, with the slug and
  hash that save returned ("Dish photos", below).
- **Annuler** in the toast after a save: `POST /api/form/undo` (`commit`,
  `slug`) — "Undo and history", below.

### Delete

Never unlink. Move the file to `_trash/<slug>.md` and its `media/<slug>/` folder alongside it, commit, remove the
index rows (a file git never tracked is moved and committed all the same). A trash view (`/corbeille`) restores it — refused if the slug has been
taken again. A slug in the trash counts as taken for a new paste (`E103`, offered
only the suffixed slug), so a deleted slug is never silently reused. Combined
with the git history this means no single click she makes is unrecoverable.

### Undo and history

Plan 04, Q16 A. Every save is a commit, so undo is a `git show`, never a
rewrite: no `git revert`, no reset, no amend. Both actions write an old text
back as a **new** commit by the signed-in person, byte for byte (its `status`
and `updated` included: undo means "as it was"), through the save's steps:
today's checker with the vault's entries, the hash guard, one commit, the index
rows, the push. An old text the checker now refuses is not written; she is told
in one sentence and the owner can take it back by hand (`git show`).

- **Annuler** (the toast after a save, and after a restore or an undo — undo of
  an undo is a redo), `POST /api/form/undo` from the form's toast or
  `/r/<slug>/historique?/annuler` from the history page, with the commit:
  `undo: <title>`. Each recipe the commit changed goes back to its text before
  it, refused unless the file is still exactly as that commit left it. A recipe
  the commit created goes to the trash (`delete:`); a trash move is undone by
  the trash's own restore or delete, media folder included. A
  `vocab/families.yaml` change in the same commit (a label written with the
  recipe) is undone with it when unchanged since, else kept; a new recipe's
  label is kept. A commit touching anything else (prices, the registry) is not
  undone from here.
- **Historique** (`/r/<slug>/historique`): the commits of the recipe's file
  as `git log --follow -M` lists them (through `_trash/` and back, and a slug
  renamed by hand), read from the commit index (below, "Commit index") rather
  than from git on each visit; it stops where this recipe began — its creation,
  or before the removal of an earlier file under the same slug. Newest first:
  date, author, and what changed in plain French, computed by parsing both
  versions into the form model (title, ingredients added / removed / changed,
  steps, tags, photo, fields, "Vérifié", readings settled) — never a diff of
  Markdown. **Revenir à cette version** shows what going back would change,
  then writes `restore: <title> (version du <date>)`, guarded by the hash of
  the file the page showed. The restore finds the commit among the recipe's
  versions in the commit index and reads that one text (`<commit>:<path>`),
  not the whole history. A version under another slug, or that fails
  today's checker, is shown but not offered. A recipe in the trash shows its
  history without the button: it comes back through `/corbeille` first.

### Commit index

Issue #10 (option A). `git log --follow -- recipes/<slug>.md` walks every
commit of the vault — ~2–7 s at 20 000 commits in the flat `recipes/`
directory — so the history page reads the index instead: `commits` and
`commit_files` in `cache/index.db` (below, "Index schema") hold every
non-merge commit reachable from HEAD, in `git log` order, with the paths it
changed (`git log -M --name-status`, renames detected over the whole tree).
A recipe's history is a walk over those rows that does what `--follow` does:
a commit shows the path as it would alone (a file renamed away reads as
deleted), and a path created by a rename goes on under its old name.

- **Caught up**, never trusted blindly: `meta.commits_head` is the HEAD it was
  read up to. Every history read, restore and undo first compares it with HEAD
  (read from `.git` without running git; `git rev-parse` for an unusual
  layout) and reads only `<last>..HEAD` — the app's own
  commits (also read in the background right after each one), a pull, a
  commit made by hand. When HEAD no longer descends from the last commit read
  (an amend, a reset, a rebase, another branch), or the new commits hold a
  merge (git's date order could then interleave them with older ones), the
  whole history is read again. App startup and `vault sync` catch up too.
- **Undo and restore** use it too: a restore finds its commit among the
  recipe's versions there and reads the one text; an undo reads what the
  commit changed from `commit_files` (what `git diff-tree -M` gives), falling
  back to git for a commit the index does not hold (a merge — refused anyway —
  or one not on HEAD's line).
- **Rebuildable**: deleting `cache/` loses nothing — the next read (or the
  startup) reads the whole history again, ~5 s at 20 000 commits, once.
- **One difference from `git log --follow`, on purpose**: when a path is
  created, `--follow` also looks for a file it could have been *copied* from
  (git turns on `--find-copies-harder` to follow) and, if one is similar
  enough, goes on in that other recipe's history — a variant made from
  another recipe (the W608 "En faire deux versions" pair) would list the other
  recipe's versions as its own. The index counts a copy as a creation: the
  history of a recipe starts where that recipe began. Renames (the source
  removed in the same commit) are followed as before.

### Dish photos

`POST /api/photo` (signed in; multipart `slug`, `hash`, `photo`), from the
recipe page's "Ajouter une photo" prompt (shown when a recipe has no photo —
`W603` stays deferred, plan 04 Q13 A) and from the form (after the recipe's
own save, with the hash it returned). Same order as a
save, around the recipe file: size (25 MB) and type by content checked, the
image decoded into its two derived copies in memory (a file that does not
decode is refused) — all before the lock, writing nothing. Then, under the
lock: the original is written to `media/<slug>/final-<date>-<n>.<ext>`, the
recipe file — only if it still has the hash the page showed — gets
`media.final`, is serialized and committed as `edit: <title>` (status kept),
and indexed; a stale hash or a failed commit removes the new original. Then
the copies go to `cache/img/`. `DELETE /api/photo` (`{ slug, hash }`) unsets
`media.final` the same way and keeps the file. Refusals come back as 409
(changed, gone, or a file that fails the checker), 413 (too big), 415 (not a
photo, unreadable), each with a French message. `bin/serve.js` raises
adapter-node's body limit to 26 MB for it (`BODY_SIZE_LIMIT`, default 512 KB).
`/media/<slug>/<file>?v=thumb|display` serves the derived copies only (made on
demand when missing), with an ETag; the kitchen-mode service worker keeps the
display copy, not the card thumbnails. Measured: see "Final figures for P2"
below.

### Family labels

`/famille/<slug>` sets a family's French display label in
`vocab/families.yaml` (`VOCAB.md`, "Families"). Same order as a save: the
page carries the hash of `families.yaml` it was rendered from and the write is
refused if the file changed since; the file is rewritten atomically (comments
and other entries kept), committed alone as `family: <slug> → <label>` (or
`family: <slug> (label removed)`), then the `families` index rows are refreshed
and the push scheduled. A failed commit puts the file back. The watcher
ignores the write by its hash, like a recipe save. A `families.yaml` that no
longer reads as YAML is not overwritten: the page says to fix it first.

### Pending tags

`/etiquettes` (plan 04, Phase 8) lists the tags the index holds as pending,
with their recipes, and settles each one in one commit by the signed-in person,
hash-guarded on `vocab/tags.yaml` and `vocab/tag-labels.yaml` (one version
string for both): "Nouvelle étiquette" (`tag: new <slug> → <label>`, both
files), "C'est comme…" (`tag: <pending> → <canonical>`, `tags.yaml` alone),
then a retag of the index. `tags.yaml` is edited as text, one line, so its
comments and alignment stay. "Retirer" (`tag: drop <pending>`) rewrites every
recipe holding the tag in one commit, guarded by each file's hash and by the
set of recipes the page listed; a recipe with errors stops it.

### Ingredient edits: the resolve queue

`/resoudre` (plan 03, Phase 3) lists every unresolved or ambiguous lookup key
across the vault, most frequent first, with its written forms, counts, the
recipes using it (a browse link) and its candidates. Three actions, each one
ingredient file in one commit, and never a recipe file:

- **Relier** ("C'est ça" on a candidate, or any entry by name): the key's most
  frequent written form is added to the entry's `names.<lang>`, `<lang>` being
  the language of most recipes using it. Commit `ingredient: <slug> + "<form>"`.
- **Créer**: a new `ingredients/<slug>.md` (slug proposed from the name,
  category required, `staple` optional) whose first name is that form. Commit
  `ingredient: add <slug>`. Refused if the slug is taken.
- **Retirer** (an ambiguous key): the alias is taken off one of the entries that
  share it. Commit `ingredient: <slug> - "<form>"`.

Same order and guards as a save: a candidate carries the hash of its entry file
and the edit is refused if the file changed since; the frontmatter is edited as
YAML (comments, order and body kept) and must still pass its own check; the
file is written atomically and committed, a failed write or commit puts it
back; then the registry is reloaded and every row re-resolved from its key.
Writes of every kind (recipes, family labels, ingredients) go through one helper,
`src/lib/server/files.ts`. The nav shows "À relier (N)" while N > 0; `vault
queue [--limit N]` prints the same queue.

### Ingredient edits: the ingredient view

`/ingredients/<slug>` (plan 03, Phase 6) shows one entry — names and rules,
allergens, density and weights, the current price and the price history (with
the change of the unit price from the previous row when the packs compare), the
recipes using it sorted by quantity in its `default_unit` (else the current
pack's unit, else the unit most used; quantities that do not convert come after,
out of the total), the vault total, substitutes both ways, and the unresolved
names whose queue candidates include it. Its edits go through the same path and
guards as the queue (entry hash, YAML edit, own check, one commit, re-resolve):

- **Ajouter un nom**: commit `ingredient: <slug> + "<name>"`. **Relier ici** on
  a drifting name is the queue's Relier.
- **Modifier**: names, category, `default_unit`, `staple`, `au_gout`,
  `density`, `weights`, `substitutes` (existing entries only), `allergens`
  (from `vocab/allergens.yaml`). Commit `ingredient: edit <slug>`.
- **Fusionner dans…** (Q25 B): the absorbed entry's names, rules, substitutes
  and allergens join the target, its notes are appended, entries naming it as a
  substitute name the target, and its file is deleted: one commit,
  `ingredient: merge <from> into <into>`. Refused when `prices.csv` has rows
  for it (the file stays append-only) or a recipe names it in `item:` (the
  app does not rewrite recipes for ingredient edits).

### Price entry: the ingredient index

`/ingredients` (plan 03, Phase 4) lists every registry entry with its category,
the recipes using it as a main ingredient line, and its current price. The
default order is the order to enter prices in: unpriced first, then the most
recipes. Each row opens an inline editor (amount, pack size and unit — the
entry's `default_unit` by default —, shop, date — today by default). Saving
appends one line to `prices.csv` and commits it alone as `price: <slug>
<amount> / <pack_qty> <pack_unit>`, through the same helper (atomic write,
rollback on a failed commit, recorded as the app's own write); then the
`prices` rows are reloaded. Enter saves and opens the next row.

### Cost on the recipe page

The recipe page (plan 03, Phase 5) computes the recipe's consumed cost on each
load, from the index only: the parsed recipe and its sub-recipes (`recipes`),
the resolved entry of each line (`ingredients.item`, by slug and position — so
a change to resolution changes the cost with no cost code involved), the
entry's `density` and `weights` (`registry`), the `current_price` view, and the
factors in `vocab/conversions.yaml`. Nothing is stored: a new price or a new
link shows on the next load. The server sends the totals at the base servings
and every line's cost; the browser multiplies the total by the servings
adjuster. The rules are `INGREDIENTS.md`, "Cost".

### Pantry search

`/garde-manger` (plan 03, Phase 7) is read-only. The first search builds every
recipe's needs from the index (`ingredients.item`, `ingredient_or`, sub-recipes
flattened, `registry.staple`, `substitutes`, `ingredient_allergens`) and keeps
them in memory; any later write to the index (a save, a sync, a registry edit)
rebuilds them on the next search. The state is the URL
(`?have=…&must=…&avoid=…&allergenes=…&essentiels=non`); the last one is also
kept in the browser's `localStorage`. The rules are `INGREDIENTS.md`,
"Pantry search".

### Concurrent edit

Files mean last-write-wins, which silently eats an edit. Cheap guard: every
edit carries the hash of the file it was based on — the paste box's
"Remplacer", the "Vérifié" button, delete, a family label — and the save refuses when the file
on disk no longer has that hash. (A hash rather than `updated`: `updated` is a
date, too coarse to see two edits on the same day.) Two users at this scale will
rarely collide, but the one time they do it should not be silent.

The form (plan 04, Q18 A) carries the hash too. Refused as stale, it shows
"Cette recette a été modifiée entre-temps" with the other version beside hers,
the fields that differ highlighted; her form stays (and its draft, Q17).
"Garder ma version" saves her form again against the new hash; "Prendre
l'autre version" loads the other one into the form.

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
- no `servings`, no `times` (no photo is `W603`, not emitted: plan 04, Q13 A)

Conveniences:
- `slug` absent → derive from `title`: lowercase, strip accents, hyphenate
- `lang` absent → `fr`
- `added` → today on a new recipe, kept on an edit; `updated` → today on every save
- `status` → set by the app on every paste, never taken from the file: an AI file
  is never auto-`verified`. `needs-review` if any `[?]`, `[?: …]` or
  `[illisible]` remains (W605), otherwise `draft`. `verified` is set only by a
  person, with the "Vérifié" button on the recipe page — a one-field edit
  through the normal save path, committed as `verify: <title>`, refused while an
  uncertain marker remains. A **form edit** (plan 04, Q14 A) keeps the
  recipe's status instead — `verified` stays `verified` — except that a
  remaining uncertain marker means `needs-review`, and a `needs-review` with
  none left becomes `draft`. A new recipe from the form is `draft`.
- `extracted_by` absent → `hand`

Her form never shows a raw error. Invalid states are prevented structurally —
required fields marked, ingredient rows added by a button, family chosen from a
picker, tags from an autocomplete over the vocabulary (her own tag kept as
pending, Q11 B) — and the checker runs behind Save in the browser, blocking on
the field an error comes from ("Her form", above).

## Index schema (SQLite)

Derived. Regenerable. Not precious. Lives at `cache/index.db` inside the vault, excluded from git and backup. See `STORAGE.md`.

The authoritative schema is `src/lib/server/index/schema.ts`; its version is
stored in `PRAGMA user_version`, and an index from another version is dropped
and rebuilt (it is a cache). In outline:

| Table | One row per | Notes |
|---|---|---|
| `recipes` | recipe | the columns below, plus `data_json` (the parsed recipe, so a page renders without a disk read), `body_md`, `file_hash`, `uncertain` (count of `[?]`/`[?: …]`/`[illisible]`), `photo`, and `broken_json` while the file on disk fails the checker |
| `problems` | file failing the checker | codes and paths; the file's last good `recipes` rows, if any, stay searchable |
| `families` | family in use or in `vocab/families.yaml` | labels from the vocabulary; refreshed on every save, delete, restore, outside edit and sync |
| `tags` | recipe × tag | canonical via `vocab/tags.yaml` aliases at index time; unknown tags stored folded with `pending = 1`. The file is never rewritten (except by an explicit "Retirer" on `/etiquettes`). A vocabulary change recomputes every row and the FTS `tags` column |
| `seasons` | recipe × season | canonical value (`printemps`, `ete`, `automne`, `hiver`); aliases from `VOCAB.md` mapped at index time |
| `meta` | key | index bookkeeping: `tags_hash`, the hash of `vocab/tags.yaml` at the last retag; `registry_hash`, over every ingredient file's hash plus `vocab/normalize.yaml` and `vocab/allergens.yaml`; `prices_hash`, over `prices.csv` and the config's `currency` |
| `ingredients` | ingredient item | `group_idx`, `group_name`, `group_optional`, `qty`, `qty_max` (numeric), `qty_s` (as written), `unit`, `name` (as written), `optional`, `to_taste`, `recipe` (sub-recipe slug), `buy_instead`, `key` (lookup key), `item` (registry slug, NULL when unresolved), `resolution` (`override`, `rule`, `alias`, `plural`, `none`, `ambiguous`, `recipe`; `INGREDIENTS.md` "Resolution") |
| `ingredient_or` | `or` option of an ingredient item | `position` (the item's), `alt_idx`, `name`, `recipe`, `key`, `item`, `resolution`, resolved like an item |
| `media` | recipe × media file | |
| `registry` | ingredient file (`ingredients/<slug>.md`) | `name` (display), `category`, `staple`, `au_gout`, `density`, `default_unit`, `entry_json` (the parsed entry), `file_hash`; a file that stops passing its check keeps its last good row |
| `ingredient_names` | alias of an entry | `key` (lookup key, `INGREDIENTS.md` "Resolution"), `skey` (the key with the plural rules of `vocab/normalize.yaml`), `slug`, `lang`, `name` as written |
| `substitutes`, `ingredient_allergens` | entry × substitute, entry × allergen | |
| `prices` | `prices.csv` row that reads | `line` (its line number), `date`, `ingredient`, `amount`, `currency`, `pack_qty`, `pack_unit`, `shop`, `note`, `usable` (1 when in the config's `currency`); rebuilt whole when the file or the currency changed |
| `price_problems` | `prices.csv` line that does not read | `line`, `code` (`E812`, `E813`), message |
| `current_price` (view) | ingredient with a usable row | its latest usable row, a same-day tie going to the later line |
| `registry_problems` | ingredient file with diagnostics | codes `E801`–`W811`; `broken = 1` when it has an error |
| `recipes_fts` | recipe | FTS5 over title, body, ingredient names, author, tags |
| `commits` | non-merge commit reachable from HEAD | `seq` (`git log` order, higher is newer), `hash`, `author` (`%an`), `date` (`%aI`), `subject`; read from git, not from the files ("Commit index" above); `meta.commits_head` is the HEAD it was read up to |
| `commit_files` | commit × path it changed | `status` (`A`, `M`, `D`, `T`, `R`), `path` (after), `from_path` (before, for a rename); indexed by `path` and `from_path` for the history walk |

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
with all facet counts ~10–13 ms. With ingredient resolution and a registry of
1000 entries (plan 03, Phase 2): `sync --force` ~6.5 s, no-op sync ~1.35 s,
browse with facets ~16–19 ms (the *non reliés* facet added), re-resolving all
~33 000 ingredient rows ~30 ms, one alias edit picked up by a full sync ~1.5 s
(the recipe-file walk dominates; a queue action reloads the registry only), fuzzy candidates for one name ~0.1 ms, the
resolve queue page (30 rows) ~9 ms, its nav count ~0.3 ms. With ~3000 price
rows and 10 % of recipes using an earlier one as a sub-recipe (plan 03, Phases
4–5): `sync --force` ~6.4 s, no-op sync ~1.3 s, the ingredient index page (999
rows) ~14 ms whatever the sort, the cost of one recipe ~0.4 ms (~1 ms with a
chain of 4 sub-recipes, 36 lines), appending one price and committing it
~200 ms (git dominates).

Final figures for P1.5 (plan 03, Phase 9; AMD Ryzen 5 5600X), on 5000
recipes (~33 000 ingredient rows, 15 % of them unresolved or ambiguous), a
registry of 1000 entries (the seed plus invented ones with staples, densities,
weights, substitutes and allergens, used by 30 % of the lines) and 3000 price
rows:

| Operation | Measured | Target |
|---|---|---|
| `sync --force`, with resolution | ~6.5 s (~5 s before P1.5) | < 30 s |
| no-op sync | ~1.4 s | < 3 s |
| re-resolve every row | ~60 ms | — |
| one alias edit: registry reload + re-resolve (queue action, watcher) | ~120 ms | < 1.5 s |
| one alias edit picked up by `vault sync` (every recipe file hashed) | ~1.4 s | — |
| a queue "Relier" click, commit included | ~290 ms | — |
| fuzzy candidates for one name | ~0.1 ms | < 5 ms |
| resolve queue page (30 rows) | ~10 ms | < 100 ms |
| ingredient index page (1000 rows, worst sort) | ~15 ms | < 50 ms |
| ingredient view (most used entry, 882 recipes) | ~14–19 ms | < 50 ms |
| cost of one recipe (3 nested sub-recipes / none) | ~0.8 ms / ~0.4 ms | < 5 ms |
| pantry search (3 picked / 8 picked + avoid + allergen) | ~4 ms / ~5 ms; ~50 ms for the first, which builds the model | < 10 ms |
| append one price and commit | ~170 ms | < 500 ms |

A queue action or an outside edit of one ingredient file reloads the registry
alone (the changed files, then the names tables) and re-resolves from stored
keys; only `vault sync` walks the recipe files.

Final figures for P2 (plan 04, Phase 9; same machine, under desktop load —
load average 7–9, which made a price append ~1.6× slower than the P1.5 figure
above), on the same 5000-recipe vault grown to ~20 000 commits, one recipe with
50 versions:

| Operation | Measured | Target |
|---|---|---|
| open the edit form (server load, 74-line recipe) | ~12 ms; ~46 ms the first time after a write (vault stats recomputed) | < 100 ms |
| suggestions for one keystroke: ingredient names + "relié" / authors / sub-recipes | ~3 ms / ~1.6 ms / ~16 ms | < 10 ms (names) |
| name-word hint for one field (browser code, timed in Node) | ~0.03 ms | < 5 ms |
| the form's debounced server check (whole form) | ~200 ms | — |
| form save: edit / new recipe (check, serialize, write, commit, index) | ~450 ms / ~490 ms | < 500 ms |
| unchanged form save | ~12 ms, no write, no commit | no commit |
| photo upload, 12 MP JPEG (7.5 MB): store + both copies + commit | ~0.8 s | < 2 s |
| derived copy on demand: thumbnail / display | ~70 ms / ~350 ms | < 1 s each |
| history page, 50 versions | ~260 ms with the commit index (issue #10; ~2.1 s before, `git log --follow` ~1.7 s) | < 300 ms |
| history page, an ordinary recipe (6–10 versions) | ~80–90 ms (~4–12 s before, depending on the file name) | < 300 ms |
| undo the last save | ~420 ms (~620 ms before) | < 500 ms |
| "Revenir à cette version" | ~410 ms (~2.8 s before: it read the whole history first) | < 500 ms |
| commit index: catch up one new commit / already at HEAD / read all ~20 000 commits | ~46 ms / ~0.1 ms / ~5 s (once, after `cache/` is deleted or an upgrade) | — |
| `/etiquettes` page (22 pending tags, two on ~800 recipes) | ~37 ms | — |
| accept a pending tag, commit included | ~3.8 s (the retag of every recipe) | — |
| sign in (argon2id verify; unknown login the same) | ~160 ms | 100–500 ms |
| session lookup per request | ~0.05 ms | < 0.5 ms |

The history page first missed its target by an order of magnitude: `git log`
of one path walks all ~20 000 commits, each step costing more the later the
file name sorts in the flat `recipes/` directory, and `--follow` cannot use
git's changed-path Bloom filters. Issue #10 (option A) replaced that walk by the
commit index ("Commit index", above); the history figures, undo and restore
above are after it (re-measured 2026-09-28, load average ~4; the same run gave
form saves of ~380 / ~480 ms). What is left of a history page is one `git
cat-file --batch` for every version's text and parsing each version (~3 ms
each): a 50-version page is mostly parsing. Undo and restore are now a save
plus a couple of git reads; a git spawn from the server process costs tens of
ms, so HEAD is read from `.git` directly and a commit's changes come from the
index.

## vault sync

```
vault sync [--force]
```

Walk `recipes/*.md`. Hash each file, compare to the stored `file_hash`, skip if
unchanged unless `--force`. Reparse new and changed files. Drop index rows whose
file no longer exists. Report counts plus every file that failed to parse. A file
that fails keeps its last good rows, flagged with its codes; the recipe page shows
them in a banner. A file whose `slug` differs from its file name is not indexed
(the slug is the file name). When `vocab/tags.yaml` differs from the one the
index last used (its hash is kept in `meta`), every tag row is recomputed even
though no recipe file changed — a `git pull` of the vocabulary while the app was
down. The ingredient registry (`ingredients/*.md`) is loaded the same way, by
hash, before the recipes: skipped when `meta.registry_hash` matches, else the
changed files are re-read (all of them when the plural rules or the allergen
list changed), and the report lists the ingredient files with errors or
warnings. When the registry changed, every `ingredients` and `ingredient_or`
row is re-resolved from its stored `key` (set-based, no recipe file read), like
a retag. Rows whose key a disambiguation rule names (`INGREDIENTS.md`,
"Disambiguation rules") also need the line's unit, prep and note: they are
re-resolved one by one from the recipe's stored parse (`data_json`), still
without reading a recipe file. `prices.csv` is reloaded whole when it or the
config's `currency` changed (`meta.prices_hash`); lines that do not read are
listed. Last, the commit index reads the commits made since the last one it
read (all of them after a history rewrite; "Commit index"). `vault reindex`
deletes the index and rebuilds it, the commit index included.

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
  `edit (external): <path>` when they still read: an ingredient file that
  passes its check (no `E8xx` error; one that fails keeps its last good rows,
  is flagged and is not committed, like a recipe), YAML, or text respectively.
  A vocabulary change re-derives the tag and family rows; an ingredient file,
  `vocab/normalize.yaml` or `vocab/allergens.yaml` change reloads the registry;
  a `prices.csv` change reloads the prices (a line that does not read is
  skipped and listed; the file is still committed).
- If it does not: keep the last good index rows, flag the recipe in the UI with the
  validation errors, and do not commit. A half-typed edit in Obsidian must never
  knock a recipe out of search.
- Ignore the app's own writes (it knows the hash it just wrote), or every save would
  echo back as an external edit.

`vault sync` on startup still covers edits made while the app was stopped, and
the app then commits every recipe file git shows as changed, new or deleted,
if it reads cleanly, as `edit (external): <title>` (several in one commit) —
the watcher only sees live events. A file that fails the checker stays
uncommitted and flagged, as it would live.

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

The right model depended on a question since decided (below: LAN plus
Tailscale, plan 02; accounts, plan 04) — whether the app is reachable only on
the home network or from the open internet:

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

**Decided (plan 02): LAN plus Tailscale, no login in P1** (accounts: plan 04, below). The app listens on the
home network; outside access and HTTPS come from `tailscale serve`
(`docs/DEPLOY.md`). Until accounts arrive in P2, every commit is attributed to
`git_author` from the config. What P1 still guarantees: the vault folder, `.git`
and `cache/` are never served (photos go through `/media/…`, images only), and a
writing request is refused unless its `Origin` names the host it was sent to
(CSRF), which works for both the LAN address and the Tailscale name.

Because the Origin check compares two headers a page controls, it does not stop
**DNS rebinding**: a page on `evil.example` whose name is re-pointed at the LAN
address becomes same-origin with the app. So every request, reads included, must
carry a `Host` the app is served on, else `421`: `localhost`, any IP literal
(v4 or v6 — rebinding needs a name), the machine's own name and `<name>.local`,
any `*.ts.net` name (Tailscale's DNS, not the attacker's), and the names listed
in the config's `hosts` (`DEPLOY.md`).

**Decided (plan 04, Q1 A, Q2 B): an account per person, reading open, every
write signed in.** Accounts are made by the owner (`vault user add`, stored in
`users.json` beside the config, `STORAGE.md` §Accounts); passwords are argon2id.
Each request, in this order (`src/hooks.server.ts`):

1. the host allowlist (`421`), then the Origin check on anything but
   GET/HEAD/OPTIONS (`403`) — both before the cookie is even read, so a
   cross-site POST carrying a valid session is still refused;
2. the session cookie → the signed-in person (`locals.user`), or nobody. A
   session whose account was removed, or whose password changed since sign-in,
   ends here;
3. the guard: GET/HEAD/OPTIONS pass (browse, recipe page, kitchen mode, pantry
   search, the family and ingredient pages, the trash list, a recipe's history,
   `/etiquettes`), except pages that exist only to write (`/ajouter`,
   `/nouvelle`, `/r/<slug>/modifier`), which send to `/connexion`. Every other
   method needs a session, with no list of write routes to keep in sync: an API
   call answers `401`; a form action goes to `/connexion?suite=<page>` (a 303,
   or SvelteKit's JSON redirect for an enhanced form). The sign-in page's own
   actions are the only exception.

Every write then commits as the signed-in person (`withAuthor(ctx, user)`,
author and committer both); the CLI and the watcher's `edit (external)`
commits keep `git_author`. Rights are the same for every account (Q2 B); the
per-account `markdown` preference only shows or hides the Markdown tools.

Sign-in (`/connexion`): login and password; "Rester connectée sur cet appareil",
checked by default, gives a cookie of one year renewed on use (at most once a
day), unchecked a browser-session cookie (a day on the server, renewed on use).
The same answer, after the same argon2id work, for an unknown login and a wrong
password. After 5 failures for a login, or from an address, one try per 30 s per
key, said in words; a failure is counted before the password check so parallel
tries cannot slip through, a success clears the count, an hour of quiet forgets
it. Behind `tailscale serve` every request comes from loopback, so the address
is the proxy's `X-Forwarded-For` — believed only from loopback. The session
token is 32 random bytes, stored as its sha256 (`cache/sessions.db`). The cookie
is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when the request came over
HTTPS (`DEPLOY.md` §4: `X-Forwarded-Proto` from `tailscale serve`). "Se
déconnecter" ends the device's session; `vault user passwd` and `vault user
remove` end all of the account's.
