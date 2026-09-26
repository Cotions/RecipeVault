# RecipeVault — Planning

Status: design phase, nothing built. Last updated 2026-09-26.

## Goal

Digitize mother's paper recipe collection (scattered around the house) into a
durable, searchable, browsable archive. 500 to 5000 recipes.

Two users, different needs:
- **Mother** (retired, non-technical): browses, cooks from it, and **adds and
  edits her own recipes**. Never sees markdown.
- **Me**: bulk input, corrections, maintenance. Happy with raw markdown.

## Decisions settled

| Question | Answer |
|---|---|
| Mealie or own build | Own build |
| Source of truth | `recipes/*.md` on disk, frontmatter + body |
| Code vs data | Separate, same pattern as ChannelVault. This repo is app + docs only. Recipes live in a vault folder set by `vault_directory` in the config, with their own git repo. |
| Index | SQLite, derived, regenerable |
| Stack | SvelteKit + better-sqlite3 + FTS5 |
| Volume | 500–5000 recipes |
| Language | Mixed French and English |
| Her access | Full read and write, via a form UI |
| Ingredient lines | Structured in frontmatter, not prose |
| Ingredients | First-class objects in `ingredients/<slug>.md` |
| Cost tracking | Yes — price per ingredient pack, cost computed per recipe |

### Why own build, not Mealie

1. **Variant families.** Core to the vision: "lasagna, all types" — bolognaise,
   courgette, végétarienne, Mamie's version — grouped, with a view of *what
   differs*. Mealie has a flat recipe list and tags; tags tell you two recipes
   share a word, not that they are siblings.
2. **Data outlives the app.** Plain `.md` files: readable in 20 years, greppable,
   diffable, no server needed to read a recipe. Mealie's truth lives in its
   database; export exists but is a second-class path.
3. **Custom fields.** Provenance (who it came from, book and page), the scan of
   the original paper, review status. Mealie's `extras` bag can hold these but
   treats them as second-class in the UI.

Given up: meal planner, shopping list, ingredient scaling, URL import — all
already built in Mealie. Accepted; some are cheap to add later.

Mealie stays a fallback. MD is the truth, so a sync script could push into it if
its features ever outweigh the loss of the family model.

### Why SvelteKit + SQLite

- One process, one thing to run and back up. No separate API and frontend.
- The pieces that dominate this UI — live preview, a form with repeatable
  ingredient and step rows, a filter sidebar, a virtualized 5000-item list — all
  want genuine client-side reactivity. Svelte does that with the least ceremony,
  and no React re-render pitfalls to fight in the ingredient editor.
- `better-sqlite3` is synchronous and in-process: no connection pool, no second
  container, queries measured in microseconds.
- FTS5 ships inside SQLite. No Elasticsearch, no separate search service.
- Server-side rendering for the read views, so recipes load fast on a phone in a
  kitchen with weak wifi.
- Batch ingest (P2) can be a TypeScript script against the same code — one
  runtime, one set of parsing logic, no Python/Node split.

FastAPI + HTMX would be less total code and is a fine alternative; the deciding
factor was the ingredient/step form editor, which is genuinely nicer in Svelte.

## Data model

### Code and data are separate

This repository holds the app, the docs, and test fixtures — nothing real. It can
be public. The recipes live in a **vault folder** somewhere else, located the same
way ChannelVault locates its data:

| Thing | Path |
|---|---|
| Config (installed) | `~/.config/recipevault/config.json` |
| Config (from source) | `config.json` at repo root, gitignored |
| Recipes, ingredients, media, index | whatever `vault_directory` points at |

```json
{
  "vault_directory": "/home/cotions/RecipeVault-vault",
  "port": 3370
}
```

Environment overrides: `RECIPEVAULT_CONFIG`, `RECIPEVAULT_PORT`. To run against
throwaway data instead of the real vault:

```bash
RECIPEVAULT_CONFIG=/tmp/rv.json RECIPEVAULT_PORT=3399 npm run dev
```

with `/tmp/rv.json` pointing `vault_directory` at a copy of `tests/fixtures/vault`.

The app never writes inside its own repository. Consequences:
- Updating the app (`git pull`, new container) never touches a recipe.
- The repo can be public; her recipes, notes, and provenance never are.
- The vault is backed up as one folder (see Backup).
- A missing `vault_directory` on startup is an error, not a silent new empty
  vault — otherwise a typo in the path looks exactly like losing everything.

### Vault layout

Paths in every doc (`recipes/`, `scans/`, ...) are relative to `vault_directory`.
One file per recipe, flat directory:

```
recipes/lasagna-bolognaise.md
recipes/lasagna-courgette.md
recipes/tarte-tatin.md
recipes/_trash/               # soft-deleted, recoverable
ingredients/tomates-concassees.md  # ingredient registry: names, pack, price
ingredients/oeuf.md
scans/lasagna-bolognaise-p1.jpg    # the original paper, kept forever
photos/lasagna-bolognaise.jpg      # the finished dish
photos/.thumbs/                    # generated
data/vault.db                      # derived index, excluded from vault git
.git/                              # vault's own local history — see below
```

Flat over nested: renames stay cheap, one file is one recipe, git diffs stay
readable, no directory churn when a recipe joins or leaves a family.

**Families come from frontmatter, not the filesystem:**

```yaml
family: lasagna
variant: bolognaise
```

The app groups by `family` and generates a family page listing every variant with
a diff table — the ingredients unique to each, and the differing times.

**Variant vs. inline note:**
- Separate file when ingredients differ substantially or the method changes.
- Inline `## Variantes` note when it is a swap ("butter instead of oil").

### Ingredients are structured, not prose

Draft 2 of the schema had ingredients as prose bullets, parsed best-effort. That
was wrong. Real lines break it: `huile d'olive, sel, poivre` is three ingredients
on one line with no quantities; `1 gros oignon, émincé` mixes a size descriptor and
a preparation into the name; `2 gousses d'ail` is ambiguous about what the unit is.

Three features depend on getting this exactly right — cost per recipe, pantry
search, ingredient scaling. A 90%-accurate parser means a wrong price and a wrong
search result on one recipe in ten, permanently. So ingredients live in frontmatter
as explicit `{ qty, unit, name, note, prep }` entries, and the pretty prose list is
rendered from them. The "prose is nicer to write" argument does not survive the fact
that an AI writes most of these files and her form writes the rest.

### Ingredients are objects

`ingredients/<slug>.md` per ingredient: every alias in both languages, category,
pack size, price, substitutes, allergens, and a `staple` flag. Recipes reference
ingredients by written `name`; the app resolves that to a canonical slug on save,
and unresolved names go to a queue rather than blocking the save.

This registry is what makes cost, pantry search, and the ingredient view possible
at all. Details: `docs/INGREDIENTS.md`.

Specs: `docs/RECIPE-SCHEMA.md` · `docs/INGREDIENTS.md` · `docs/VOCAB.md` ·
`docs/AI-TEMPLATE.md` · `docs/VALIDATION.md` · `docs/DATA-FLOW.md`.

## Architecture

Files are the truth. SQLite is a cache that can be deleted.

```
 me: paste raw MD ─────┐
                       ├──> parse ──> validate ──> preview ──> save
 her: form UI ─────────┘                                        │
                                  ┌─────────────────────────────┴────┐
                                  v                                  v
                     recipes/<slug>.md on disk            SQLite index row
                        + git commit (undo)                  (derived)
                                  │                                  │
                                  └────── vault sync rebuilds ───────┘
                                                                     │
                                                   browse / search / filter / families
```

Two input paths, **one parser and one validator**. The form builds a recipe
object, serializes it to markdown, and then runs the exact same save path as a
paste. No second code path to keep in sync, and the form can never produce a file
the parser cannot read.

Save order is not arbitrary: write the file, commit, then index. If the file write
fails nothing is indexed; if the index write fails the file still exists and
`vault sync` recovers it. Never the reverse.

Why the index exists: at 5000 recipes you want instant sort, filter, and full-text
search. SQLite FTS5 answers in under a millisecond. Reading 5000 markdown files
per page load does not.

Why the vault has its own git history: she can edit and delete. The vault folder is
its own git repository, separate from the app's, pushed to a **private** GitHub
repo (`Cotions/RecipeVault-recipes`) as an offsite copy of the text. Every save is a
commit there, which gives version history and a real undo —
"restore what it looked like last Tuesday" becomes a `git show`, not a support
incident. Only `recipes/` and `ingredients/` are tracked; `scans/`, `photos/` and
`data/` are excluded by the vault's own `.gitignore`, which the app writes when
creating a vault. Deletes move the file to `recipes/_trash/` rather than unlinking
it.

Details — database schema, paste and form flows, validation, auth:
`docs/DATA-FLOW.md`.

## Search

Four distinct ways in, all served by the same SQLite index:

1. **Full text** — FTS5 over title, body, and ingredient names.
2. **Faceted filter** — family, tags, season, time, servings, difficulty, rating,
   source, author, status.
3. **Pantry search** — "I have eggs and penne, what can I make". Ranked by coverage,
   in three tiers: cookable now, cookable with a substitution, missing one or two
   things. Staple ingredients are excluded from "missing" or every result reads
   "missing salt" and the feature is useless.
4. **By ingredient** — the ingredient view lists every recipe using it, sorted by
   quantity used. The answer to "I have a kilo of courgettes, now what".

Ranking, tiers, and the substitution logic: `docs/INGREDIENTS.md`.

## Cost

Ingredient prices are stored per pack (`400 g for €0.89`), and recipe cost is
computed. Two numbers, never conflated: **consumed cost** (pro-rata, what the
recipe uses) and **shopping cost** (whole packs, what you must buy). Consumed cost
per serving is the headline on a recipe page.

Partial pricing is the normal state, so totals always show coverage —
`≈ €4.20 · 9 of 12 ingredients priced` — and never a number that looks complete
when it is not. Mass-to-volume conversion only happens with an explicit density;
otherwise the ingredient counts as unpriceable. A wrong price is worse than an
absent one, because an absent price is visibly absent.

## AI-generated files

Most recipes will be produced by an AI from a photo, so the prompt is a
first-class artifact, not something retyped per session: `docs/AI-TEMPLATE.md`. The
app renders it with a copy button.

When a pasted file fails validation, the error output is designed as **input to the
next AI turn**, not as a message for a human: stable error codes, a path rather than
a line number for every fault, the corrected form shown alongside each complaint,
the whole rejected file included, and a restatement of "return the complete
corrected file, one fence, no explanation". One copy button, paste it back, get a
fixed file. Codes and format: `docs/VALIDATION.md`.

Batch validation sorts errors by frequency rather than emitting one block per file.
200 files failing on the same code means the prompt needs one extra line, not 200
fix requests.

## Kitchen mode

The view she will actually cook from, on a phone or tablet propped against the
backsplash. Everything is designed for wet or floury hands, a glance from a metre
away, and not touching the screen much.

- **Screen stays on.** Wake Lock API while kitchen mode is open. Without this the
  screen locks mid-recipe and she has to unlock with dirty hands — the single most
  annoying failure, and the reason this is a mode rather than a font size.
- **Big type.** Readable at arm's length. Nothing else on screen — no navigation,
  no sidebar, no tags.
- **Ingredients first, as a checklist.** Tap to tick off while gathering. Grouped
  as in the recipe (sauce, béchamel, montage). Ticks are local to the session and
  never saved.
- **One step at a time.** Current step large, previous and next dimmed. Large
  tap zones: right half of the screen advances, left half goes back — no small
  buttons to hit. Swipe works too.
- **Step's ingredients shown with the step.** "Ajouter l'ail, puis le bœuf" shows
  `2 gousses ail · 500 g bœuf haché` underneath, so she never scrolls back to the
  list. Matched by ingredient name appearing in the step text; best-effort, and a
  miss just shows nothing.
- **Servings adjuster at the top,** before starting. Quantities rescale everywhere,
  including in the per-step ingredient lines. Free, because quantities are
  structured.
- **Timers.** Durations in step text (`25 min`, `1 h`) become tappable. Several can
  run at once, each labelled with its step, visible at the top, with an alarm
  sound when done. Survives the screen changing steps.
- **Sub-recipes inline.** A step using pâte brisée can expand the pastry recipe in
  place instead of navigating away.
- **Resumes where she left off** if the tab reloads or the phone switches apps —
  current step and running timers kept in local storage.
- **Works offline** once opened. Kitchen wifi is often the worst in the house; the
  recipe and its images are cached on open.
- **Dark mode option,** high contrast either way.

Wake Lock needs HTTPS (or `localhost`) to work in browsers. On a LAN-only setup
over plain HTTP it silently does nothing — one more reason for the reverse proxy
with a certificate, or reaching the app through Tailscale, which provides HTTPS
names.

## Bilingual handling

Recipes will be a mix of French and English. Decisions:

- Frontmatter **keys** stay English always. Values may be either language.
- `lang: fr | en` per recipe, default `fr`. Drives which UI labels render
  alongside it and which heading names the serializer writes back.
- The parser accepts heading aliases in both languages
  (`## Ingrédients` or `## Ingredients`, `## Préparation` or `## Instructions`).
  See `docs/RECIPE-SCHEMA.md`.
- FTS5 with `remove_diacritics 2`, so `boeuf` finds `bœuf` and `creme` finds
  `crème`.
- **Tags and families need a controlled vocabulary with aliases.** Free-text tags
  across two languages at 5000 recipes fragments into `four` / `oven` / `baked`
  describing one thing, and the filter sidebar becomes useless. Canonical term
  plus alias list, defined in `docs/VOCAB.md`; input maps to canonical, display
  uses the reader's language.

## What 5000 recipes changes

Numbers to design against:

- **List views** — never render 5000 cards. Paginate or virtualize from day one.
- **Images** — ~5000 dish photos plus 5000+ scans, several GB. Thumbnails
  generated on upload, cached to disk, lazy loaded. Full-size phone photos in a
  grid is unusable. Handle EXIF rotation — phone photos arrive sideways.
- **Duplicates** — the same recipe gets pasted twice, guaranteed. Slug collision
  is a hard block; a near-identical title is a warning.
- **Families get big** — 30 variants of tarte is plausible. Family pages need
  their own filtering, not just a list.
- **`vault sync`** — hash files, reparse only what changed. A no-op sync over 5000
  files is then a couple of seconds. Run it on startup.
- **Manual input does not scale to 5000.** Photo, chat, copy, paste, times 5000 is
  hundreds of hours. The form and paste box are right for v1 and for corrections
  forever, but batch ingest is necessary, not optional. Build them first anyway —
  they define the parser and validator the batch path reuses.

## Phases

**P0 — schema validation, by hand**
Transcribe 10-15 real recipes manually into the vault's `recipes/`. Pick awkward ones on
purpose: a handwritten card, one with sub-recipes (sauce + pasta), a page that is
really three variants, one from a book, one clipped from a magazine, one in
English. The schema was designed in a vacuum, so it is wrong somewhere; real paper
says where. More important at 5000 recipes, not less — a schema mistake found at
recipe 400 is a migration.

**P1 — read app**
Browse, search, filter, sort. Family pages with the variant diff table. Recipe
page. Print view (she will want paper in the kitchen). Mobile first. Plus the
paste box with validation and the fix-request block, and `vault sync`. Kitchen
mode — see its section above.

**P1.5 — ingredients**
Registry, name resolution with the resolve queue, ingredient view, ingredient index
with inline price editing, pantry search, cost on the recipe page. Deliberately
after the read app: resolution quality depends on having a few hundred real recipes
to resolve against, and the resolve queue is worth building only once there is a
backlog to work through.

**P2 — her write path**
Form UI: repeatable ingredient and step rows, family picker showing existing
families, photo upload from a phone, no markdown anywhere. Soft delete, undo via
git. Auth. This is a substantial chunk of work — it is deliberately after the read
app so the data model is proven before building forms on top of it.

**P3 — batch ingest**
Directory of photos, Claude API structured output, reusing P1's parser and
validator. Everything lands in a review queue rather than straight into the vault:
handwriting and stained paper produce errors, so review is not optional.

**P4 — only if actually wanted**
Ingredient scaling (the structured quantities already make this nearly free),
shopping list with whole-pack costs, meal planner, price history charts.

## Open questions

1. **Hosting** — local network only, or reachable from her house over the
   internet? She is a writer now, so this decides the auth model: LAN-only can be
   a single shared password, internet-facing needs real accounts, HTTPS, and
   rate limiting on the login. See `docs/DATA-FLOW.md`.
2. **Currency and shop** — EUR assumed. Prices are shop-specific; one price per
   ingredient, or per shop? One price with a `source` label is the simple answer,
   and probably right — comparing shops is a different app.
3. **Who prices ingredients?** Entering a few hundred prices is tedious. Her, from
   receipts, as a low-effort ongoing thing? Or scraped, which is fragile and
   shop-dependent? Manual entry sorted by "used in most recipes, unpriced" gets
   most of the value from the first 50 entries.
4. **Does she want her own tags?** A controlled vocabulary keeps filters usable
   but means she cannot invent a tag freely. Middle ground: she proposes, it lands
   as `pending` until mapped.
6. **Photo per recipe, or several?** Schema allows several; the form is simpler
   with one. Start with one, schema already supports more.

## Gaps review — 2026-09-26

Found on a pass over the whole plan. Tier 1 either changes the file format or
risks losing data, so it is settled now. Tier 2 is cheap to add later.

### Tier 1 — decided now

**Backup. Git is history, not a backup.** One dead disk loses every recipe and
every scan, and the scans are the irreplaceable part — the paper may be gone by
then. Decision:
- Nothing real is in the app repository.
- The vault's git repo is pushed to a private GitHub repo — an offsite copy of every
  recipe and ingredient with full history. Push after each save, or on a timer;
  a failed push must never block a save.
- Scans and photos are not in any git repo (several GB, and git keeps every
  deleted version forever). The whole vault folder is backed up with `restic`
  (or similar): deduplicated, encrypted, versioned. One folder, one backup job,
  which covers the media the GitHub copy does not.
- `data/` can be excluded from the backup; `vault sync` rebuilds it.
- 3-2-1: the live copy, a local second copy (external disk or NAS), one offsite
  (cloud bucket, or a disk at a sibling's house).
- A scheduled restore test. A backup never restored is a hope, not a backup.

**Review is the real bottleneck.** 5000 AI drafts each need a human to compare
against the scan. At two minutes each that is ~170 hours. Needs a dedicated screen,
built with the batch ingest (P3), not after:
- scan on the left, zoomable; rendered recipe on the right, editable in place
- one key to verify and advance, one to flag and advance
- queue ordered by risk: `[illisible]` present, unresolved ingredients, and any
  warnings first; clean parses last
- the ability to verify in bulk once a batch has proven reliable — honest spot
  checks of clean parses rather than pretending all 5000 get read closely

**Sub-recipes.** Pâte brisée in forty tartes should not be forty copies. An
ingredient can reference another recipe with `recipe: <slug>`; cost and pantry
search recurse. Added to schema draft 4. Retrofitting this across thousands of
files would have been a migration.

**Multi-page and multi-recipe photos.** Real sources are not one-card-one-recipe:
a card has a back, a magazine page has three recipes. Template now says: several
images may be one recipe, one image may be several. The ingest script needs a
grouping step before it calls the AI (P3).

**Schema version.** `schema: 3` on every file. A future migration must know what
it is reading. Now required (`E110`).

**Web import via schema.org.** Most recipe sites embed a `Recipe` JSON-LD block.
Paste a URL, parse the JSON-LD, map it to the schema, fill `source.url`. More
accurate than an AI reading a screenshot, and nearly free. Fall back to the AI
path only when a site lacks the markup. Goes in P1 alongside the paste box.

### Tier 2 — noted, later

- **Family cookbook export.** Siblings will want a copy. PDF book of a selection:
  a family, a tag, "Mamie Jeanne's recipes". The print view does most of this.
- **Cook log and her own notes.** "Made 2026-10-12, too salty, less sel next time."
  A `log` list in frontmatter: date, rating, note. Gives "last made" and "never
  made" sorts for free.
- **Duplicate detection by ingredient set.** Titles lie — "Lasagnes de maman" and
  "Lasagnes bolo" can be one recipe. Structured ingredients make Jaccard similarity
  on ingredient sets trivial. Flag pairs above ~0.8.
- **Parser test fixtures.** The validator is the contract with every AI and the
  form. A `tests/fixtures/` folder of good files and deliberately broken files,
  each asserting its exact error codes. Every real-world failure found becomes a
  fixture.
- **Batch ingest cost estimate.** 5000 images through the Claude API is a real
  bill. Estimate from current pricing before running, use the Message Batches API
  for the discount, and run a 50-image pilot first — it also tunes the prompt.
- **Where it runs.** Still open under Hosting. Candidates: a NAS, a Raspberry Pi
  5, an old laptop. One Docker container plus the two data directories makes any
  of them fine.

### Deliberately out of scope

- **Nutrition.** Needs per-ingredient nutrition data and reliable gram weights for
  every unit. Large effort, and not what this archive is for.
- **Multi-shop price comparison.** A different app.
- **Public sharing / social features.** Private family archive.

