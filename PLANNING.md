# RecipeVault — Planning

Status: P1 (read app), P1.5 (ingredients) and P2 (her write path) built — see
Phases. Last updated 2026-09-28.

## Goal

Digitize mother's paper recipe collection (scattered around the house) into a
durable, searchable, browsable archive. 500 to 5000 recipes.

Input workflow, kept deliberately simple: photograph a paper recipe, give the
photo to any chat AI (ChatGPT free tier, Claude, anything) along with the prompt
from `docs/AI-TEMPLATE.md`, paste the markdown it returns into the app. The app
checks it, saves it, displays it. If the file is not compliant, the app produces a
copy-paste error block to send back to the same chat. **Photos of the old recipes
never enter the app** — they stay on the user's side.

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
3. **Custom fields.** Provenance (who it came from, book and page), review
   status. Mealie's `extras` bag can hold these but
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

Full layout, formats, and reasoning: `docs/STORAGE.md`. The vault is also a valid
Obsidian vault — optional power-user view, same files, see `STORAGE.md`. In short — anything
precious is plain text in the vault's git repo; anything in SQLite is rebuildable.

```
recipes/<slug>.md          one file per recipe, Markdown + YAML frontmatter
ingredients/<slug>.md      aliases, category, substitutes — no price
vocab/                     families, tags, units — grows as she uses it
prices.csv                 append-only price history
media/<slug>/              optional dish photo, original never modified
_trash/                    soft-deleted recipes with their media
cache/                     SQLite index + image cache, deletable
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

Specs: `docs/STORAGE.md` · `docs/RECIPE-SCHEMA.md` · `docs/INGREDIENTS.md` · `docs/VOCAB.md` ·
`docs/AI-TEMPLATE.md` · `docs/VALIDATION.md` · `docs/DATA-FLOW.md`.

## Architecture

Files are the truth. SQLite is a cache that can be deleted.

```
 me: paste MD from AI ─┐
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
incident. All text is tracked; `media/` and `cache/` are excluded by the vault's
own `.gitignore`, which the app writes when creating a vault. Deletes move the file
and its media folder to `_trash/` rather than unlinking
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

Ingredient prices are stored per pack (`400 g for $0.89`), and recipe cost is
computed. Two numbers, never conflated: **consumed cost** (pro-rata, what the
recipe uses) and **shopping cost** (whole packs, what you must buy). Consumed cost
per serving is the headline on a recipe page.

Partial pricing is the normal state, so totals always show coverage —
`≈ $4.20 · 9 of 12 ingredients priced` — and never a number that looks complete
when it is not. Mass-to-volume conversion only happens with an explicit density;
otherwise the ingredient counts as unpriceable. A wrong price is worse than an
absent one, because an absent price is visibly absent.

## AI-generated files

Most recipes will be produced by a chat AI from a photo, outside the app — any
provider, including free tiers. So the prompt is a first-class artifact, not
something retyped per session: `docs/AI-TEMPLATE.md`. The app renders it with a copy
button. There is no AI integration inside the app, no API key, and no per-recipe
cost.

When a pasted file fails validation, the error output is designed as **input to the
next AI turn**, not as a message for a human: stable error codes, a path rather than
a line number for every fault, the corrected form shown alongside each complaint,
the whole rejected file included, and a restatement of "return the complete
corrected file, one fence, no explanation". One copy button, paste it back, get a
fixed file. Codes and format: `docs/VALIDATION.md`.

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
  as in the recipe (sauce, béchamel, montage). Ticks stay on the device
  (`localStorage`) and are never sent to the server.
- **One step at a time.** Current step large, previous and next dimmed. Large
  tap zones: right half of the screen advances, left half goes back — no small
  buttons to hit. Swipe works too.
- **Step's ingredients shown with the step.** "Ajouter l'ail, puis le bœuf" shows
  `2 gousses ail · 500 g bœuf haché` underneath, so she never scrolls back to the
  list. Matched by ingredient name appearing in the step text; best-effort, and a
  miss just shows nothing.
- **Servings adjuster at the top,** before starting. Quantities rescale everywhere,
  including in the per-step ingredient lines. Free, because quantities are
  structured. Built in plan 05: amounts a cook can measure, sub-recipes at
  the amount the line needs, amounts written in steps shown scaled beside the
  original (`DATA-FLOW.md`, "Scaling").
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
- **Oven temperature in both units.** Old Quebec cards are all °F (`oven:` field);
  kitchen mode shows `350 °F · 180 °C`.
- **Fractions displayed as fractions.** `"2/3"` shows as ⅔ tasse, never 0.667.

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
- **Images** — optional dish photos only, up to ~5000. Thumbnails generated on
  upload, cached to disk, lazy loaded. Full-size phone photos in a
  grid is unusable. Handle EXIF rotation — phone photos arrive sideways.
- **Duplicates** — the same recipe gets pasted twice, guaranteed. Slug collision
  is a hard block; a near-identical title is a warning.
- **Families get big** — 30 variants of tarte is plausible. Family pages need
  their own filtering, not just a list.
- **`vault sync`** — hash files, reparse only what changed. A no-op sync over 5000
  files is then a couple of seconds. Run it on startup.
- **Paste speed matters.** Every recipe goes through the paste box, so the loop
  must be fast: paste, see it valid, save, next — one keyboard shortcut each, the
  box cleared and focused again after saving. When invalid, the fix block is one
  click to copy.

## Phases

**P0 — schema validation**
Run 10-15 real recipes through the chat AI with the template and check the output
with the validator (the first code built, as a command line tool). Pick awkward ones on
purpose: a handwritten card, one with sub-recipes (sauce + pasta), a page that is
really three variants, one from a book, one clipped from a magazine, one in
English, one with vague quantities. The schema was designed in a vacuum, so it is
wrong somewhere; real recipes say where. More important at 5000 recipes, not less — a schema mistake found at
recipe 400 is a migration.

**P1 — read app** — *built 2026-09-27 (`docs/plans/02-read-app.md`).*
Browse, search, filter, sort. Family pages with the variant diff table. Recipe
page. Print view (she will want paper in the kitchen). Mobile first. Plus the
paste box with validation and the fix-request block, and `vault sync`. Kitchen
mode — see its section above. Also: web import (schema.org JSON-LD), the
"Vérifié" button (an AI file is never auto-verified), soft delete and the
trash, a codes-only paste log with `vault stats`, and an offline service worker
for kitchen mode. The UI is in French, all strings in `src/lib/i18n/fr.ts`.

**P1.5 — ingredients** — *built 2026-09-27 (`docs/plans/03-ingredients.md`).*
Registry, name resolution with the resolve queue, ingredient view, ingredient index
with inline price editing, pantry search, cost on the recipe page. Planned for
after the read app, because resolution quality depends on having a few hundred
real recipes to resolve against. The owner chose not to wait: an invented corpus
of 320 Québécois cards (`tests/fixtures/corpus/`) with an answer key stood in,
and the owner runs `vault sync` on the real vault. Built: a seed registry of 268
entries (`docs/INGREDIENTS-SEED.yaml`, `vault ingredients seed`), resolution by
alias, plural rules and disambiguation rules (never by fuzzy match), the resolve
queue (`/resoudre`, `vault queue`), `prices.csv` with inline entry
(`/ingredients`), consumed cost with coverage, the ingredient view
(`/ingredients/<slug>`, with "Fusionner dans…"), pantry search
(`/garde-manger`), and the checker codes that waited for the registry and
vocabularies (W302–W305, W501, W502, W606, W607). All 26 open questions of the
plan were decided; each is recorded in the doc it concerns.

Soft delete and the trash (`/corbeille`) come forward from P2 into P1: a paste
box without delete forces hand-editing the vault for every mistake.

**P2 — her write path** — *built 2026-09-28 (`docs/plans/04-write-path.md`).*
Form UI: repeatable ingredient and step rows, family picker showing existing
families, photo upload from a phone, no markdown anywhere. Undo via git. Auth. This is a substantial chunk of work — it is deliberately after the read
app so the data model is proven before building forms on top of it.
Built: an account per person (`vault user add`, `users.json` beside the
config, argon2id; sessions in `cache/sessions.db`), reading open and every
write signed in and committed under that person's name; the form
(`/nouvelle`, `/r/<slug>/modifier`) over a form model that round-trips every
fixture and corpus file byte for byte, entering the paste's save path, with
hints instead of codes, drafts in the browser and a side-by-side view when the
recipe changed meanwhile; one dish photo per recipe (original untouched in
`media/`, derived WebP copies in `cache/img/`, never the original served);
"Annuler" after every save and a per-recipe history with "Revenir à cette
version", both as new commits; pending tags settled on `/etiquettes`, with
labels in `vocab/tag-labels.yaml`. All 18 open questions of the plan took the
recommended option; each is recorded in the doc it concerns.

**P3 — only if actually wanted**
Ingredient scaling (the structured quantities already make this nearly free),
meal planner, price history charts. Scaling is planned in
`docs/plans/05-scaling-duplicates.md`; the shopping list was declined (see
"Deliberately out of scope").

## Open questions

1. **Hosting** — *decided 2026-09-27 (plan 02):* home network plus Tailscale.
   The app listens on the LAN; outside access and HTTPS come from
   `tailscale serve` (HTTPS is also what makes Wake Lock work in kitchen mode).
   No public exposure. No login in P1 — acceptable only because the network is
   the boundary; commits are attributed to `git_author` from the config.
   Accounts came in P2 (plan 04, Q1 A, Q2 B): one per person, reading open,
   every write signed in and attributed. See `docs/DEPLOY.md` and
   `docs/DATA-FLOW.md`.
2. **Currency and shop** — *decided 2026-09-27 (plan 03, Q7 and decision 2):*
   one current price per ingredient, the latest row of `prices.csv` whatever the
   shop; the shop is a label shown next to it. Comparing shops is a different
   app. Currency and shops come from the config, not the code: `currency`
   (default `CAD`) is the one prices are costed in (a row in another currency is
   kept and shown, never costed), `locale` (default `fr-CA`) formats money, and
   shop names are free text, suggested from those already in `prices.csv` plus
   an optional `shops` list. Taxes are not modelled: basic groceries are
   zero-rated. See `docs/STORAGE.md` ("Prices") and `docs/DEPLOY.md`.
3. **Who prices ingredients?** — *decided 2026-09-27 (plan 03, Q8 and Q9):* she
   does, by hand, inline on the ingredient index (`/ingredients`), sorted by
   "used in most recipes, not priced" — the first 50 entries give most of the
   value. One row appended and one commit per price. No scraping (fragile and
   shop-dependent). Hand-editing `prices.csv` in a spreadsheet also works; a
   bulk "receipt" mode can come later if entry proves tedious.
4. **Does she want her own tags?** — *decided 2026-09-28 (plan 04, Q11 B):* the
   middle ground. A controlled vocabulary keeps filters usable but means she
   cannot invent a tag freely, so she proposes: the form writes her tag as typed,
   the index holds it as pending, and it is settled on `/etiquettes` — a new
   canonical tag with its label, an alias of an existing one, or removed
   (`VOCAB.md`, "Tags").
5. **Photo per recipe, or several?** — *decided 2026-09-28 (plan 04, Q12 A):*
   one, `media.final`. Processed with `sharp` (thumbnail and display copy, WebP,
   rotated, metadata stripped); HEIC is stored but shown as a placeholder. The
   schema still allows more `media` keys, which the form keeps
   (`STORAGE.md`, "Media").

## P0 findings — 2026-09-27

Ten real recipes run through a free chat AI with template draft 1: handwritten
family cards (some 35+ years old), a magazine clipping, a printed recipe website
page, a printed TV show page. The AI mostly followed the template correctly; the
template was wrong.

**The collection is Québécois, and the template was written for France.** Cups,
pounds, °F, *c. à thé*, *piment vert*, *fèves*, brand-name products (St-Hubert,
Minute Rice, Cool Whip). With no `cup` or `lb` unit, most quantities on the cards
ended up as text in `note` — invisible to cost, scaling, and pantry search.
Currency is CAD.

Everything found, and the fix for each, is the table at the end of
`docs/AI-TEMPLATE.md`. Headlines:

- Imperial units added; Quebec abbreviations spelled out in the prompt.
- Fractions stay as written (`"1 1/2"`), not converted to decimals by the AI.
- Uncertainty as four fixed markers — `[?]`, `[?: other]`, `[illisible]`, `[+]` —
  instead of free prose. The app highlights them and derives `needs-review`.
- **Inference policy.** Cards skip obvious steps ("mix everything") and name
  ingredients only in the steps. The AI may fill in the obvious, marked `[+]`,
  shown in a distinct style so her original is always visible as original. It may
  never invent quantities, times, temperatures, or people — it asks instead, in a
  `QUESTIONS` section after the fences, which the paste box ignores.
- New fields: `brand`, `or`, `alt`, optional groups, `oven`, `servings_max`,
  `yield`. One duration format.
- The app, not the AI, sets `status`, `added`, and family membership — the AI
  sees one card, the app sees the whole vault.

Readings to confirm (a person or a name) are for her, not for the template.

**Round 2** — the same ten re-run with template draft 2: roughly 90% clean. Units,
fractions, times, oven temperatures, markers, and dual measures all came back
right. Six small remaining issues fixed in template draft 3 (alternatives with
their own amounts, over-eager brand splitting, `[+]` on moved ingredients — see
the round 2 table in `docs/AI-TEMPLATE.md`). The format is considered settled;
changes from here are additive.

The twenty inbox files (both rounds) stay in the private vault inbox as the
checker's first real test corpus. They never go into this public repository;
the public fixtures are invented.

## Gaps review — 2026-09-26

Found on a pass over the whole plan. Tier 1 either changes the file format or
risks losing data, so it is settled now. Tier 2 is cheap to add later.

### Tier 1 — decided now

**Backup. Git is history, not a backup.** One dead disk loses every recipe.
Decision:
- Nothing real is in the app repository.
- The vault's git repo is pushed to a private GitHub repo — an offsite copy of every
  recipe and ingredient with full history. Push after each save, or on a timer;
  a failed push must never block a save.
- Dish photos are not in git (git keeps every deleted version forever). The vault
  folder is backed up with `restic` (or similar): deduplicated, encrypted,
  versioned. One folder, one backup job, which covers the photos the GitHub copy
  does not. Losing the photos is annoying; losing the text is not possible while
  the GitHub copy exists.
- `cache/` is excluded from the backup; `vault sync` rebuilds it.
- 3-2-1: the live copy, a local second copy (external disk or NAS), one offsite
  (cloud bucket, or a disk at a sibling's house).
- A scheduled restore test. A backup never restored is a hope, not a backup.

**Sub-recipes.** Pâte brisée in forty tartes should not be forty copies. An
ingredient can reference another recipe with `recipe: <slug>`; cost and pantry
search recurse. Added to schema draft 4. Retrofitting this across thousands of
files would have been a migration.

**Multi-page and multi-recipe photos.** Real sources are not one-card-one-recipe:
a card has a back, a magazine page has three recipes. Template now says: several
images may be one recipe, one image may be several. The paste box therefore accepts
several fenced files in one paste and saves them as separate recipes.

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
- **Where it runs.** Still open under Hosting. Candidates: a NAS, a Raspberry Pi
  5, an old laptop. One Docker container plus the vault folder makes any
  of them fine.

### Deliberately out of scope

- **Nutrition.** Needs per-ingredient nutrition data and reliable gram weights for
  every unit. Large effort, and not what this archive is for.
- **Multi-shop price comparison.** A different app.
- **Public sharing / social features.** Private family archive.
- **Shopping list.** Declined by the owner (2026-09-29): no list built from
  chosen recipes, no whole-pack shopping cost, no aggregation across recipes.
  Consumed cost and pantry search cover what is needed.

