# Storage — how the vault is laid out on disk

Draft 1. Authoritative for file locations; other docs defer to this one.

## The rule

> **Anything precious is plain text, tracked in the vault's git repo.
> Anything in SQLite is either rebuildable or cheap to lose.**

Every storage decision below follows from that one sentence. It is what makes the
vault survive the app: in twenty years, with the app long dead, a text editor still
opens every recipe, every ingredient, and every price ever paid.

Data splits by how it changes, because each kind wants a different format:

| Kind | Examples | Changes | Format |
|---|---|---|---|
| Authored content | recipes | rarely, by hand or AI | one Markdown file each |
| Reference data | ingredients, families, tags, units | occasionally, by the app | one small text file per entry, or one YAML list |
| Event history | prices paid | append only | CSV, one row per event |
| Media | dish photos (optional) | written once, never modified | original files, untouched |
| Derived | search index, thumbnails | rebuilt at will | SQLite, image cache |
| App state | accounts, sessions | app-owned | outside the vault entirely |

## Layout

```
<vault_directory>/
├── recipes/
│   ├── lasagna-bolognaise.md
│   ├── pate-brisee.md
│   └── ...                          # flat; 5000 files in one directory is fine
├── ingredients/
│   ├── tomates-concassees.md        # aliases, disambiguation rules, category, substitutes — NO price
│   └── ...
├── vocab/
│   ├── allergens.yaml               # allergen slug → { fr, en } labels
│   ├── brands.yaml                  # brand words for W607
│   ├── conversions.yaml             # unit factors for cost: g per mass unit, ml per volume unit
│   ├── descriptors.yaml             # size words for W304
│   ├── distinct.yaml                # recipe pairs settled as different recipes on /doublons (not seeded)
│   ├── families.yaml                # family slug → { fr, en } labels, set on the family page
│   ├── normalize.yaml               # plural rules for ingredient lookup
│   ├── participles.yaml             # preparation words for W302
│   ├── scaling.yaml                 # how scaled amounts show: fractions per unit, kitchen ladder, metric steps
│   ├── tag-labels.yaml              # tag slug → { fr, en } labels, seeded, set on /etiquettes
│   ├── tags.yaml                    # canonical tags + aliases
│   ├── unit-labels.yaml             # unit → { fr, en } display words (tasse / tasses, c. à thé)
│   └── units.yaml                   # canonical units + aliases
├── prices.csv                       # append-only price history
├── media/
│   ├── lasagna-bolognaise/
│   │   └── final-2026-09-28-1.jpg   # original, exactly as uploaded (a new name per upload)
│   └── ...
├── _trash/                          # soft-deleted recipes AND their media folder
├── cache/                           # DELETABLE. excluded from git and backup
│   ├── index.db                     # SQLite search/filter index
│   ├── sessions.db                  # sign-in sessions (hashed tokens); its own file, see Accounts
│   └── img/<slug>/                  # derived copies: <file>.thumb.webp, <file>.display.webp
├── .obsidian/                       # only if opened in Obsidian; optional
├── .gitignore                       # written by `vault init`: media/ _trash/*/ cache/ inbox/ .obsidian/workspace*.json
└── .git/                            # pushed to private Cotions/RecipeVault-recipes
```

Outside the vault, next to the config:

```
~/.config/recipevault/
├── config.json                      # vault_directory, port, git, currency, locale, shops
└── users.json                       # accounts, argon2id hashes (0600; `vault user …`)
```

## Decisions and why

### Recipes: Markdown + YAML frontmatter, one file each

Kept. It is the right format: an AI produces it reliably, a human can read and fix
it in any editor, the prose body stays prose, and git diffs are readable. Pure
JSON would lose the readable body; a database would lose the portability.

Details that matter at 5000 files:

- **Flat directory.** ext4 and git both handle 5000 entries in one directory
  without complaint. Sharding into `recipes/l/lasagna-...` adds complexity for no
  gain at this scale. One cost measured since (plan 04, Phase 9): the history
  of *one* file (`git log -- recipes/<slug>.md`, the history page) walks every
  commit of the vault, and in a flat 5000-entry directory each step costs more
  the later the name sorts — 2 to 9 s at 20 000 commits. Fixed on the app
  side, not the layout (issue #10): the history page reads a commit index in
  `cache/index.db`, caught up from git (`DATA-FLOW.md`, "Commit index").
- **Canonical serialization.** Every save rewrites the file in one fixed key order
  and formatting, whatever the AI pasted. Diffs then show only real changes, and
  two files with the same content are byte-identical — which makes duplicate
  detection and hashing reliable.
- **YAML 1.2, not 1.1.** YAML 1.1 parses `no` as `false`, `1:30` as the number
  5400, and `010` as octal. A recipe with `note: no` becomes `note: false`. The
  parser must be a 1.2 one (the `yaml` npm package is by default), and the
  serializer quotes any string that could be misread.
- **UTF-8, LF line endings, NFC-normalized.** `é` typed on one device and pasted
  from another can be two different byte sequences that look identical; NFC makes
  them one, or `crème` silently fails to match `crème` in search and resolution.

### Slugs are permanent

The slug is the recipe's identity: filename, URL, and the target of every
`recipe:` sub-recipe reference and every media folder. So:

- The **title** can change freely. The **slug** does not change when the title does.
- Renaming a slug is an explicit, rare operation in the app that moves the file,
  moves the media folder, rewrites every reference to it, and commits all of that
  as one commit.
- A deleted slug is never reused, so an old link or an old git commit can never
  point at a different recipe.

Random IDs (ULIDs) were considered and rejected: an AI writing
`recipe: pate-brisee` from a photo cannot know an opaque ID, and a human reading
`recipe: 01J9ZQ...` learns nothing. Permanent slugs give the same stability.

### Ingredient resolution is not stored in recipe files

Draft schema had the app write `item: <slug>` into each recipe's ingredient entries
on save. That couples every recipe file to the current state of the registry:
merging `farine` into `farine-t55` would rewrite 2000 recipes and bury real edits
in a 2000-file commit.

Instead: recipe files contain only what was written — `name`. The registry's alias
lists are the mapping. Resolution happens when building the index, every time. Merge
two ingredients → edit one alias list, one small commit, re-index. Recipes untouched.
The app's "Fusionner dans…" does exactly that (`DATA-FLOW.md`, "Ingredient
edits: the ingredient view"), and refuses while `prices.csv`, an `item:`
override or a bought-instead sub-recipe line (`recipe:` with `buy_instead: true`)
names the absorbed slug.

`item:` may still appear in a recipe entry, but only as a deliberate **manual
override** for a genuinely ambiguous name in one specific recipe ("farine" here
means `farine-t45`). Rare, intentional, and visible in the diff.

A name whose meaning depends on the line rather than the recipe (*tomates* by the
can are canned, by the pound fresh; *bœuf* with prep *haché* is ground beef) is
settled in the registry too, not with an `item:` in every recipe: an ingredient
file may carry **disambiguation rules**, `when:`, a list of
`{ names, lang?, unit?, words? }` — "these names mean this entry when the
recipe's language is `lang`, the line's unit is one of `unit` (canonical units or
the classes `mass`, `volume`, `count`, `container`), and its `prep` or `note`
holds one of `words`" (`INGREDIENTS.md`, "Disambiguation rules"). Like an alias,
a rule is one line in one ingredient file, one small commit, and every recipe
using the name is re-resolved; no recipe file changes.

### Prices are an append-only log, not a field

```csv
date,ingredient,amount,currency,pack_qty,pack_unit,shop,note
2026-09-26,tomates-concassees,0.89,CAD,400,g,IGA,
2026-09-26,oeuf,2.10,CAD,6,piece,IGA,calibre moyen
2026-11-02,tomates-concassees,0.95,CAD,400,g,IGA,
```

- Current price = latest row per ingredient. History and trends come free, and so
  does staleness ("last priced 14 months ago").
- Pack size lives on the price row, because pack size is a property of what was
  bought — the same tomatoes come in 400 g and 800 g tins at different unit prices.
- Entering a price is appending one line: no file rewritten, trivial diffs, no
  lost history. Correcting a typo is a new row, or an edit to the last line.
- One CSV for the whole vault — a few thousand rows over years. Opens in any
  spreadsheet, which matters if prices are ever entered in bulk from receipts.

Behaviour (plan 03, Phase 4, Q7–Q9):

- The first line is the header; columns are found by name. `shop`, `note` and
  `currency` may be empty (an empty `currency` is the config's). Numbers use a
  dot (a decimal comma is read in a quoted cell); `pack_unit` is a canonical
  unit (`VOCAB.md`); text holding a comma is quoted.
- **One current price per ingredient** (Q7): the latest row by `date`
  whatever the shop, a same-day tie going to the later line, among the rows in
  the config's `currency`. The shop is a label shown next to the price: free
  text, suggested from the shops already in the file plus the config's optional
  `shops` list (plan 03, decision 2; `DEPLOY.md`).
- `amount` is what was paid for the pack. Taxes are not modelled: basic
  groceries are zero-rated, so a dish costs the sum of shelf prices.
- A row in another currency than the config's `currency` is kept and shown,
  never used for cost. A row whose `ingredient` names no registry entry is kept
  and used once the entry exists. A line that does not read is skipped and
  reported with its line number. Codes `E812`–`W815` (`VALIDATION.md`, "Price
  codes").
- A price is **stale** once it is more than a year old: still used, flagged.
- The app writes a new row in the order of the file's own header (a column it
  does not know gets an empty cell; a missing `currency` column is the
  config's). It refuses, writing nothing, when the header lacks a required
  column, when a shop or note was typed and the header has no column for it,
  or when the line would not read back as the row entered. A new or empty file
  gets the header above.
- The app only appends, one line and one commit per price (Q9):
  `price: <slug> <amount> / <pack_qty> <pack_unit>`, rolled back if the commit
  fails. Prices are entered inline on the ingredient index, `/ingredients`
  (Q8). A hand edit is picked up by the watcher or the next sync and committed
  as `edit (external): prices.csv`.

### Vocabularies are data, not docs

Tags, families, and units grow as she uses the app — a new family is created every
time she adds the first tarte. That is data, so it lives in `vocab/` in the vault,
edited by the app. `docs/VOCAB.md` becomes the seed: the starting lists copied into
a new vault, plus the rules.

The same holds for everything regional the ingredient features need (plan 03,
decision 1): plural rules, allergens, unit conversion factors, and the word
lists of W302, W304 and W607, tag labels, the unit display words and the
scaling rules (plan 05), are `vocab/` files seeded from `VOCAB.md`; regional
ingredient names are aliases and rules in `ingredients/`. The code holds no
word of a language or a region beyond the canonical unit list and the UI
strings of `fr.ts`. `vault init`
writes them all; `vault ingredients seed` adds the ones an older vault lacks,
never overwriting a file or an entry.

### Media: per-recipe folder, originals never modified

- `media/<slug>/` keeps a recipe and its images together. Deleting a recipe moves
  the file and its folder to `_trash/` together; renaming moves both. A
  `_trash/<slug>/` folder already there without its file (the file removed by
  hand) is moved aside to `_trash/<slug>~1/` first, never merged nor restored
  with the new delete.
- **Originals are stored exactly as uploaded.** Never resized, never recompressed,
  EXIF kept. Every lossy re-save degrades a photo.
- Everything displayed is derived into `cache/img/`: thumbnails, and web-friendly
  copies. This matters for iPhone photos — HEIC does not display in most browsers,
  so the cache would hold a WebP copy while the original HEIC stays untouched
  (not yet: the app's image library cannot decode HEIC, see below; a browser
  upload from an iPhone is usually JPEG already).
- Rotation from EXIF is applied to the derived copies only.
- Media is not in git (gigabytes, and git keeps every deleted version forever). It
  is backed up with `restic` along with the rest of the vault folder.

Frontmatter references media by filename within the recipe's own folder:

```yaml
media:
  final: final-2026-09-28-1.jpg
```

Short, and it survives a slug rename untouched because it is relative.

**Decided (plan 04, Phase 6; Q12 A).** One photo per recipe, `media.final`.

- **Upload** (`POST /api/photo`, signed in): 25 MB cap; the type is read from
  the file's first bytes, never its name or the browser's MIME type — JPEG,
  PNG, WebP, AVIF, HEIC/HEIF. Anything else is refused and nothing is written.
- **Originals** are written as received to `media/<slug>/final-<date>-<n>.<ext>`
  (the extension from the content; `n` the first free number). A new upload
  never overwrites a file: replacing a photo adds a file and moves
  `media.final`, "Retirer la photo" only unsets `media.final`. The app never
  deletes an original (only the trash moves the folder), so an older version
  of the recipe in git still finds its photo. Files already in the vault keep
  their names (`final.jpg` is fine).
- **One commit.** `media/` is git-ignored, so the commit is the recipe file's
  `media.final` change alone (`edit: <title>`, the signed-in person as author,
  status kept). The original is written under the save lock just before it and
  removed again if the recipe was changed meanwhile (hash guard) or the commit
  fails.
- **Derived copies** in `cache/img/<slug>/<file>.thumb.webp` (longest side
  400 px, cards) and `<file>.display.webp` (1600 px, recipe page and kitchen
  mode): EXIF orientation applied, WebP, **no metadata** (EXIF, GPS, XMP, ICC
  dropped), never enlarged. Made by `sharp` (libvips, prebuilt: no system
  package) right after the commit, and again on demand when missing or older
  than their original (a deleted `cache/`, a file replaced by hand). Deleting a
  recipe drops its copies; they come back on demand after a restore.
- **Serving**: `/media/<slug>/<file>?v=thumb|display` (default `display`)
  serves derived copies only. The original — and the location a phone writes
  into its EXIF — never leaves the server.
- **HEIC** is stored and kept but not decoded (the prebuilt `sharp` has no HEVC
  decoder): no derived copy, the page shows a placeholder. A HEIC-capable
  libvips would only need the `isHeic` short-cut removed.

### SQLite is a cache, and lives in `cache/`

`cache/index.db` holds the search, filter, pantry, and cost indexes. Deleting all of
`cache/` loses nothing but sign-ins (`sessions.db`, see Accounts): `vault sync`
rebuilds it from text files (and its commit index, used by the history page,
from the vault's git history), and thumbnails regenerate on demand. It is excluded from both git and backup — backing up a cache
wastes space and, worse, a restored stale index can disagree with restored files.

### Accounts are not vault data

Users and password hashes live in `~/.config/recipevault/users.json`, beside the
config, not in the vault. The vault's git repo is pushed to GitHub; password
hashes, even private and hashed, do not belong in a remote whose purpose is sharing
recipe history. Sessions are in memory or in the cache: losing them costs a re-login,
nothing else.

**Decided (plan 04, Phase 1).** `users.json` is found next to whichever config
file was read (`dirname(config)/users.json`); the app and `vault user` refuse to
use one inside the vault folder. Written by `vault user add | passwd | remove`
only, atomically (temp file + rename), mode `0600`:

```json
{ "users": [
  { "login": "maman", "name": "Son Nom", "hash": "$argon2id$v=19$m=65536,t=3,p=1$…$…" },
  { "login": "moi", "name": "Votre Nom", "email": "you@example.com", "markdown": true, "hash": "…" }
] }
```

`login`: lowercase letters, digits, `. _ -`. `name` is the git author name;
`email` the git author email (absent: `<login>@recipevault.invalid`).
`markdown: true` shows the paste box, "Voir le fichier", the resolve queue and
the pending-tags count ("Étiquettes (N)") in the nav (plan 04, Q2 B: one level of rights, the server allows every write to every
account). `hash` is argon2id (node:crypto) as a PHC string holding its own
parameters (64 MiB, 3 passes, 1 lane today), so they can be raised without
invalidating older hashes. The app rereads the file when it changes.

Sessions are in `cache/sessions.db`, a SQLite file of its own so that an index
rebuild (`index.db` dropped on a schema change) signs nobody out. A row holds the
sha256 of the 32-byte random token (the token itself exists only in the
browser's cookie), the login, a fingerprint of the account's password hash
(a password change ends older sessions even if the database was not reachable),
and the expiry. Deleting `cache/` signs everyone out, nothing else.

## Obsidian compatibility

The vault folder is a valid Obsidian vault as-is: recipes are Markdown files with
YAML frontmatter, which is Obsidian's native format. Opening it in Obsidian gives a
second, power-user way in — browsing, graph view, quick hand edits — alongside the
app. Obsidian is optional and never required; the app remains the interface for her
(pantry search, cost, kitchen mode, and the form do not exist in Obsidian).

Rules that keep the two from fighting:

- **Obsidian's Properties panel does not handle nested YAML well.** `ingredients`,
  `source`, and `times` are nested objects; the panel shows them as raw values, and
  editing through it can reformat or mangle them. Edit those in source mode. Simple
  top-level keys (`title`, `tags`, `rating`, `servings`) are fine in the panel.
- **Obsidian may reformat frontmatter** (flow style `{ qty: 500 }` to block style).
  Harmless — the parser reads both, and the app's canonical serialization restores
  the house style on the next save through the app. It shows up as diff noise in the
  vault's history, nothing worse.
- **Links.** Body text may link recipes with Obsidian wikilinks: `voir [[pate-brisee]]`.
  Obsidian renders them and draws them in the graph; the app renders them as links
  to the recipe. In frontmatter, `recipe: pate-brisee` stays plain — an AI writes it
  reliably that way — and the app also accepts `recipe: "[[pate-brisee]]"`,
  stripping the brackets, in case it is edited from Obsidian.
- **Images do not show in Obsidian** by default, because they are referenced from
  frontmatter, not embedded in the body. Deliberate: embedding every image in the
  body would duplicate the frontmatter reference. Acceptable for a power-user view.
- **Hide app folders from Obsidian:** add `cache/` and `_trash/` to Settings →
  Files and links → Excluded files, so search and graph ignore them.
- **`.obsidian/` in the vault's git:** settings can be tracked; the workspace files
  change on every click and must not be. The vault `.gitignore` the app writes
  includes `.obsidian/workspace*.json`.
- **Edits made in Obsidian while the app runs** are picked up by the app's file
  watcher (see `DATA-FLOW.md`). Not committed until the app sees them — the watcher
  commits external edits as `edit (external): <title>`. Edits made while the app
  was stopped are committed at its next start, in one `edit (external): …`
  commit; a file that fails the checker stays uncommitted and flagged.

## What goes where — backup view

| Path | In vault git (→ GitHub private) | In restic backup | If lost |
|---|---|---|---|
| `recipes/` | yes | yes | recovered from either |
| `ingredients/` | yes | yes | recovered from either |
| `vocab/` | yes | yes | recovered from either |
| `prices.csv` | yes | yes | recovered from either |
| `media/` | no | yes | **only restic has it** |
| `_trash/` | yes (text; trashed media folders `_trash/*/` are ignored) | yes | recovered from either |
| `cache/` | no | no | rebuilt by `vault sync` |
| `~/.config/recipevault/` | no | yes (separate path) | re-create accounts |

Media is the one path with a single backup. Photos of the old paper recipes are
not stored in the vault at all — they stay with the user — so what is here is
dish photos only: nice to keep, not irreplaceable.

## Size estimate at 5000 recipes

- Recipe text: ~3 KB each → ~15 MB. Git history over decades: well under 1 GB.
- Ingredients, vocab, prices: a few MB total.
- Media: optional dish photos, at most one per recipe at 2–4 MB → **up to ~15 GB**
  if every recipe gets one, realistically far less.
- Cache: index ~50 MB, image cache a few GB.
