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
| Media | scans, dish photos | written once, never modified | original files, untouched |
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
│   ├── tomates-concassees.md        # aliases, category, substitutes — NO price
│   └── ...
├── vocab/
│   ├── families.yaml                # canonical family slugs + labels fr/en
│   ├── tags.yaml                    # canonical tags + aliases
│   └── units.yaml                   # canonical units + aliases
├── prices.csv                       # append-only price history
├── media/
│   ├── lasagna-bolognaise/
│   │   ├── scan-1.jpg               # originals, exactly as uploaded
│   │   ├── scan-2.jpg
│   │   └── final.heic
│   └── ...
├── _trash/                          # soft-deleted recipes AND their media folder
├── cache/                           # DELETABLE. excluded from git and backup
│   ├── index.db                     # SQLite search/filter index
│   └── img/                         # thumbnails + web-friendly copies
├── .obsidian/                       # only if opened in Obsidian; optional
├── .gitignore                       # written by the app: media/ cache/ .obsidian/workspace*.json
└── .git/                            # pushed to private Cotions/RecipeVault-recipes
```

Outside the vault, next to the config:

```
~/.config/recipevault/
├── config.json                      # vault_directory, port
└── users.json                       # accounts, argon2id hashes
```

## Decisions and why

### Recipes: Markdown + YAML frontmatter, one file each

Kept. It is the right format: an AI produces it reliably, a human can read and fix
it in any editor, the prose body stays prose, and git diffs are readable. Pure
JSON would lose the readable body; a database would lose the portability.

Details that matter at 5000 files:

- **Flat directory.** ext4 and git both handle 5000 entries in one directory
  without complaint. Sharding into `recipes/l/lasagna-...` adds complexity for no
  gain at this scale.
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

`item:` may still appear in a recipe entry, but only as a deliberate **manual
override** for a genuinely ambiguous name in one specific recipe ("farine" here
means `farine-t45`). Rare, intentional, and visible in the diff.

### Prices are an append-only log, not a field

```csv
date,ingredient,amount,currency,pack_qty,pack_unit,shop,note
2026-09-26,tomates-concassees,0.89,EUR,400,g,Leclerc,
2026-09-26,oeuf,2.10,EUR,6,piece,Leclerc,calibre moyen
2026-11-02,tomates-concassees,0.95,EUR,400,g,Leclerc,
```

- Current price = latest row per ingredient. History and trends come free, and so
  does staleness ("last priced 14 months ago").
- Pack size lives on the price row, because pack size is a property of what was
  bought — the same tomatoes come in 400 g and 800 g tins at different unit prices.
- Entering a price is appending one line: no file rewritten, trivial diffs, no
  lost history. Correcting a typo is a new row, or an edit to the last line.
- One CSV for the whole vault — a few thousand rows over years. Opens in any
  spreadsheet, which matters if prices are ever entered in bulk from receipts.

### Vocabularies are data, not docs

Tags, families, and units grow as she uses the app — a new family is created every
time she adds the first tarte. That is data, so it lives in `vocab/` in the vault,
edited by the app. `docs/VOCAB.md` becomes the seed: the starting lists copied into
a new vault, plus the rules.

### Media: per-recipe folder, originals never modified

- `media/<slug>/` keeps a recipe and its images together. Deleting a recipe moves
  the file and its folder to `_trash/` together; renaming moves both.
- **Originals are stored exactly as uploaded.** Never resized, never recompressed,
  EXIF kept. A scan is the archival object; every lossy re-save degrades it.
- Everything displayed is derived into `cache/img/`: thumbnails, and web-friendly
  copies. This matters for iPhone photos — HEIC does not display in most browsers,
  so the cache holds a JPEG or WebP copy while the original HEIC stays untouched.
- Rotation from EXIF is applied to the derived copies only.
- Media is not in git (gigabytes, and git keeps every deleted version forever). It
  is backed up with `restic` along with the rest of the vault folder.

Frontmatter references media by filename within the recipe's own folder:

```yaml
media:
  final: final.heic
  scans: [scan-1.jpg, scan-2.jpg]
```

Short, and it survives a slug rename untouched because it is relative.

### SQLite is a cache, and lives in `cache/`

`cache/index.db` holds the search, filter, pantry, and cost indexes. Deleting all of
`cache/` loses nothing: `vault sync` rebuilds it from text files, and thumbnails
regenerate on demand. It is excluded from both git and backup — backing up a cache
wastes space and, worse, a restored stale index can disagree with restored files.

### Accounts are not vault data

Users and password hashes live in `~/.config/recipevault/users.json`, beside the
config, not in the vault. The vault's git repo is pushed to GitHub; password
hashes, even private and hashed, do not belong in a remote whose purpose is sharing
recipe history. Sessions are in memory or in the cache: losing them costs a re-login,
nothing else.

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
  commits external edits as `edit (external): <title>`.

## What goes where — backup view

| Path | In vault git (→ GitHub private) | In restic backup | If lost |
|---|---|---|---|
| `recipes/` | yes | yes | recovered from either |
| `ingredients/` | yes | yes | recovered from either |
| `vocab/` | yes | yes | recovered from either |
| `prices.csv` | yes | yes | recovered from either |
| `media/` | no | yes | **only restic has it** |
| `_trash/` | yes (text) | yes | recovered from either |
| `cache/` | no | no | rebuilt by `vault sync` |
| `~/.config/recipevault/` | no | yes (separate path) | re-create accounts |

Media is the one path with a single backup, and it is the irreplaceable part. That
is why restic must keep an offsite copy, and why the restore test is not optional.

## Size estimate at 5000 recipes

- Recipe text: ~3 KB each → ~15 MB. Git history over decades: well under 1 GB.
- Ingredients, vocab, prices: a few MB total.
- Media: ~2 scans + 1 photo per recipe at 2–4 MB → **30–60 GB of originals.** This
  dominates everything; plan the disk and the offsite backup around it.
- Cache: index ~50 MB, image cache a few GB.
