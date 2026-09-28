# Plan 03 — P1.5, ingredients

Status: **draft. The open questions at the end must be answered first.** Written
2026-09-27 for a fresh agent session.
Previous plan: `02-read-app.md` (done: the vault, save path, index, paste box,
browse, recipe page, kitchen mode).

## Context in one paragraph

RecipeVault is a self-hosted archive of a family's recipe collection (500–5000
recipes, mostly old handwritten cards). Plan 02 built the read app. In that app an
ingredient is still just the string written in the recipe: the index stores
`item` = the folded name (`DATA-FLOW.md`, Index schema). This plan makes
ingredients first-class, as `docs/INGREDIENTS.md` describes. It adds a registry
of ingredient files, resolution of written names to registry slugs with a
resolve queue, prices in `prices.csv`, a cost line on the recipe page, an
ingredient view, an ingredient index with inline price editing, and pantry
search ("qu'est-ce que je peux faire avec ce que j'ai"). It also turns on the
checker codes deferred until the registry and vocabularies existed
(`src/lib/vault/rules/deferred.ts`).

`PLANNING.md` put P1.5 after the read app because "resolution quality depends on
having a few hundred real recipes to resolve against". The owner decided not to
wait. An invented corpus of ~300 Québécois handwritten-card recipes from
1990–2000 stands in for the real ones: `tests/fixtures/corpus/`, with
`tests/fixtures/corpus/expected-ingredients.yaml` as ground truth (canonical id ←
the written name variants). The resolution metrics and speed targets below are
measured on that corpus and on the generated 5000-recipe vault
(`scripts/gen-vault.ts`).

## Read first

| Doc | Why |
|---|---|
| `CLAUDE.md` | privacy rule, conventions |
| `docs/INGREDIENTS.md` | **the spec for this plan**: registry, resolution, cost, pantry search, the two views |
| `docs/STORAGE.md` | `ingredients/`, `prices.csv` format, "Ingredient resolution is not stored in recipe files", `vocab/` is data |
| `docs/DATA-FLOW.md` | save order, stale-write guard, index schema, `vault sync`, file watcher (already watches `ingredients/`, `vocab/`, `prices.csv`) |
| `docs/RECIPE-SCHEMA.md` | ingredient item fields (`or`, `alt`, `to_taste`, `optional`, `recipe`, `buy_instead`, `item`), optional groups, sub-recipes, `yield` |
| `docs/VOCAB.md` | units, the regional names table, "no mass for tbsp/tsp without a per-ingredient table" |
| `docs/VALIDATION.md` | W302–W305, W501, W502, W606, W607 and their fixers |
| `docs/AI-TEMPLATE.md` | rules 5–15 (how the AI writes ingredient entries) |
| `PLANNING.md` | Cost, Search, P1.5, open questions 2 and 3 |
| `docs/plans/02-read-app.md` | conventions this plan follows (phases, tests, the save path) |

The docs are the source of truth. Each behaviour below names the doc line it
comes from (→ `DOC` §section). Where the docs are silent or contradict each other,
the behaviour is an open question (Qn) at the end. **Do not start a phase until
the questions it depends on are answered.** Record each answer in the doc named
in that question, in the same commit as the code.

## Privacy rule — non-negotiable

This repository is **public**. Never read, copy, quote or paraphrase anything
from `/home/cotions/RecipeVault-vault/`. This plan has no real-vault phase: the
owner runs `vault sync` on the real vault himself once P1.5 ships. All fixtures
are invented, including `tests/fixtures/corpus/`, the seed registry, test
prices, and the shop names used in tests. Screenshots go to `/tmp`.

## Decisions given by the owner

1. **Nothing regional is hard-coded.** Registry, resolution, price and cost logic
   is generic. Regional knowledge (Québec names such as *piment vert*, *fèves*,
   *blé d'Inde*, unit words, terms) lives in **data**: registry alias lists
   (→ `VOCAB.md` §Regional ingredient names: "this lives in the ingredient
   registry's alias lists"), `vocab/` files, and the seed data copied into a new
   vault. What the AI can normalize belongs in the prompt (`AI-TEMPLATE.md`). No
   resolver special case for a word or a dialect.
2. **Currency and shops come from config or data, not from code.** New config key
   `currency` (default `"CAD"`) and `locale` (default `"fr-CA"`, used for money
   formatting). The shop field is free text. Suggestions come from the shops
   already in `prices.csv`, plus an optional `shops` list in the config. The
   defaults are the owner's: CAD, Québec grocery chains, metric packages.
3. **Taxes are not modelled.** A price is the amount paid for the pack. Basic
   groceries are zero-rated, so the cost of a dish is the sum of shelf prices.
4. **UI text in Québécois French**, every string in `src/lib/i18n/fr.ts`
   (→ plan 02, decision 5). Diagnostic texts for new codes go in
   `src/lib/i18n/diagnostics.ts`, which has a test requiring one entry per code.

## Where it fits in the existing code

Read these before Phase 1. Another agent is editing several of them now: rebase
on its commits first.

- `src/lib/server/index/schema.ts`: `ingredients` has one row per item, and
  `item` is the folded name. Bump `SCHEMA_VERSION`; the index rebuilds itself
  (→ `DATA-FLOW.md` §Index schema).
- `src/lib/server/index/build.ts`: `upsertRecipe` writes the ingredient rows.
  `retag` + `meta.tags_hash` is the pattern for "a vocabulary changed, so
  recompute rows without reading recipe files". Re-resolution copies it
  (`meta.registry_hash`, `meta.prices_hash`).
- `src/lib/server/index/sync.ts`: `syncVault` also loads the registry and prices
  and re-resolves when their hash changed.
- `src/lib/server/watcher.ts`: already watches `ingredients/` and `prices.csv`
  and commits them as `edit (external): <path>`. Add: reload the registry or
  prices, and re-resolve.
- `src/lib/server/save.ts`: `writeCommitIndex` (write → commit → index, with
  rollback) is recipe-specific. Generalize it into a helper that writes any vault
  text file, including an append to `prices.csv`, rolls back on a failed write
  or commit, and records `ownWrites`. Ingredient edits and price rows go through
  it (→ `DATA-FLOW.md` §SAVE, order and rollback).
- `src/lib/server/index/query.ts` `familyDiff`: groups by `item`. It keeps
  working once `item` is the resolved slug; unresolved rows fall back to the
  folded name (see Phase 2).
- `src/lib/server/vocab.ts`: loads `vocab/tags.yaml` and `families.yaml`. It
  gains the new vocab files (Q2, Q20, Q22).
- `src/lib/vault/` stays browser-safe. The new browser-safe code (registry
  parsing, normalization, unit conversion, cost arithmetic) goes in
  `src/lib/ingredients/`. SQLite, files and git stay in `src/lib/server/`.

## Module layout (target)

```
src/lib/ingredients/          # browser-safe
  registry.ts     # parse / check / serialize one ingredients/<slug>.md
  normalize.ts    # name → lookup key (fold + data-driven plural rules, Q2)
  resolve.ts      # key → slug | ambiguous | none; fuzzy candidates (trigram)
  units.ts        # conversion: mass, volume, density, per-unit weights (Q10–Q13)
  prices.ts       # parse prices.csv rows, current price, staleness
  cost.ts         # consumed cost + coverage for one recipe (recursive)
  pantry.ts       # tier rules, shared by server query and tests
src/lib/server/
  registry.ts     # load ingredients/, write entries (add alias, create, merge)
  prices.ts       # load / append prices.csv
  files.ts        # generalized write → commit → rollback helper (from save.ts)
  index/resolve.ts  # (re)resolve ingredient rows, registry tables
  index/pantry.ts   # the pantry query
src/routes/
  ingredients/+page         # the ingredient index, inline price editing
  ingredients/[slug]/+page  # the ingredient view
  resoudre/+page            # the resolve queue
  garde-manger/+page        # pantry search
```

Adjust names if something reads better. Keep the server/browser split.

## Phases

Commit at the end of each phase with a conventional message. All tests and
`npm run check` must pass before each commit. Each phase lists the questions it
depends on.

### Phase 0 — corpus harness (no product code)

Depends on: nothing. Needs `tests/fixtures/corpus/` to exist. If it does not yet,
stop and report.

1. `tests/helpers/corpus.ts` loads the corpus recipes through `checkFile` and
   loads `expected-ingredients.yaml`. Adapt the loader to the file's actual shape
   (expected: canonical id → list of written name variants). Assert that every
   item name in the corpus appears in the ground truth exactly once, and report
   the ones missing, so a gap in the answer key is not mistaken for a resolver
   failure.
2. `tests/fixtures/resolve-traps.yaml` holds invented pairs that must never
   resolve to the same slug, even though they fold or de-pluralize alike. Traps:
   a singular that is a different product from its plural (the *pâte* / *pâtes*
   kind), percentages (*crème 15 %* / *crème 35 %*), and a colour or kind word
   that changes the product (*piment vert* / *piment fort*). These are test data,
   not resolver rules (decision 1).
3. `tests/ingredients-corpus.test.ts` holds the metrics below, marked `todo`
   until Phase 2. Unlike `tests/corpus.test.ts`, it runs in the normal suite:
   the corpus is public.

Tests: the loader, and ground-truth consistency (no variant listed under two ids).

**Implementation notes (Phase 0, done after Phase 2).** The corpus landed after
the Phase 2 code, so the harness and the metric bodies came together
(`tests/helpers/corpus.ts`, `tests/ingredients-corpus.test.ts`), with no `todo`
stage. The answer key's shape: `ingredients` (id → variants), `ambiguous`
(written form → candidate ids) and `confusables`. Every occurrence is resolved on
its name alone (`resolveKey(lookupKey(name))`), sub-recipe lines included: the
metric is about names. An ambiguous form counts as correct when it stays
unresolved, and as wrong when it resolves to anything. `resolve-traps.yaml`
sits at `tests/fixtures/resolve-traps.yaml` (outside the generated corpus
folder). Only the hard gates are asserted (R0 complete, 0 wrong, 0 seed merge,
no ambiguous form auto-resolved, T = 0); R1 and R2 print their verdict.

### Phase 1 — the registry

Depends on: Q5 (seed), Q6 (codes), Q12 (unit-weight field), Q20 (allergens),
Q21 (W606 flag), Q26 (`default_unit`).

1. **Format** (→ `INGREDIENTS.md` §The registry): `ingredients/<slug>.md`,
   frontmatter `slug`, `category` (fixed list of 12), `names: { fr: [...], en:
   [...] }`, `default_unit`, `staple`, `density` (g per ml), `substitutes`,
   `allergens`, prose body, plus the fields the questions add. YAML 1.2, NFC, LF.
2. `registry.ts`: parse and check, with stable codes (Q6). Checks: the slug
   matches the file name (same rule as E113 for recipes), `category` is in the
   list, at least one name, `density` > 0, `default_unit` is a canonical unit,
   `substitutes` point at existing entries (a warning), allergens are in the
   list. **Alias collision:** one lookup key (Phase 2) under two entries is a
   registry warning, and resolution treats that key as ambiguous. Serializer:
   fixed key order following the `INGREDIENTS.md` example, names in flow lists;
   round-trip test as for recipes (→ plan 02 Phase 1.2).
3. **Index**: tables `registry` (slug, category, staple, density, default_unit,
   the extra fields as JSON, file_hash, body), `ingredient_names` (key, slug,
   lang, written form; → `INGREDIENTS.md` §Resolution 2 names this table),
   `substitutes` (slug, substitute), `registry_problems` (file, codes).
   `meta.registry_hash` holds a hash over the sorted list of (file, sha256).
4. Sync and watcher: load `ingredients/*.md` at sync time. A broken ingredient
   file keeps its last good rows and is listed with its codes (the same rule as
   recipes, → `DATA-FLOW.md` §File watcher). The watcher reloads and re-resolves
   (Phase 2), then commits as it already does.
5. **Seed** (Q5): `vault init` copies the seed registry, and
   `vault ingredients seed` adds it to an existing vault without overwriting an
   entry. The seed is invented data written independently of the corpus answer
   key, so the metrics stay honest.
6. Fixture vault: grow `tests/fixtures/vault/ingredients/` from 2 to ~30 invented
   entries covering every category, staples, a density, per-unit weights, a
   substitute pair, an alias collision, and a broken file.
7. CLI: `vault check --dir <vault>` also checks `ingredients/`.

Tests: parse/serialize round-trip, every registry code has a fixture, sync with a
broken entry, watcher reload.

**Implementation notes (Phase 1, done).**
- Codes: `E801`–`E807` (file, slug, category, names, density/weights,
  default_unit, field shape), `W808` (substitute missing or itself), `W809`
  (allergen not in the list), `W810` (alias collision), `W811` (unknown key).
  All `app`. Recorded in `VALIDATION.md`, "Registry codes".
- Field names: `au_gout` (Q21) and `weights` (Q12). Only `slug`, `category`
  and one name are required; `default_unit`, `au_gout`, `density`, `weights`
  are omitted when unset.
- The lookup key also drops the space before `%` (`crème 35 %` = `crème 35%`),
  a typographic variant like the apostrophes; it keeps the number, so 15 % and
  35 % stay apart.
- Allergen slugs (Q20): `oeuf`, `lait`, `moutarde`, `arachide`, `crustaces`,
  `poisson`, `sesame`, `soya`, `sulfites`, `noix`, `gluten` in
  `vocab/allergens.yaml` (`VOCAB.md`, "Allergens"). Plural rules in
  `vocab/normalize.yaml` (`VOCAB.md`, "Plurals").
- The seed is `docs/INGREDIENTS-SEED.yaml` (243 entries). `vault ingredients
  seed` also writes `vocab/normalize.yaml` and `vocab/allergens.yaml` when a
  vault lacks them (an older vault), never overwriting.
- The watcher does not commit an ingredient file with an error (the recipe
  rule), where `DATA-FLOW.md` said "when it still reads as Markdown with
  frontmatter". `DATA-FLOW.md` updated.
- `vault check --dir <dir>`: when `<dir>` holds `recipes/`, it is taken as a
  vault and both `recipes/` and `ingredients/` are checked.
- `SyncReport.registry` carries the registry counts and problems apart from
  the recipe `problems`, so `vault sync` still exits 1 only on errors.

### Phase 2 — resolution

Depends on: Q1 (fuzzy auto or not), Q2 (plurals), Q3 (status), Q4 (override UI).

1. **Lookup key** (`normalize.ts`, → `INGREDIENTS.md` §Resolution 1): markers
   stripped (→ `RECIPE-SCHEMA.md` §Markers: "stripped before … resolution"),
   `fold` (NFC, lowercase, accents and ligatures, whitespace; the existing
   `src/lib/vault/normalize.ts`), apostrophe and hyphen variants unified, then
   the plural step from Q2. `brand`, `note` and `prep` are never part of the key
   (→ `RECIPE-SCHEMA.md`: `brand` "ignored by … resolution").
2. **Order** (`resolve.ts`), first match wins:
   1. `item:` in the entry: a manual override, taken as is. It is a warning if the
      slug is not in the registry (→ `STORAGE.md` §Ingredient resolution).
   2. Exact key among all aliases, when it maps to exactly one slug
      (→ `INGREDIENTS.md` §Resolution 3).
   3. The de-pluralized key, when it maps to exactly one slug (Q2).
   4. Otherwise unresolved. Keep the top 3 trigram candidates for the queue
      (→ §Resolution 4). Whether a candidate is ever taken automatically: Q1.
   A key that maps to two slugs is **ambiguous** and never auto-resolved, because
   a wrong resolution poisons every total that includes it (→ `INGREDIENTS.md`
   §Unit conversion: "Wrong prices are worse than absent prices").
3. `or` entries resolve the same way, into a side table
   `ingredient_or (slug, position, alt_idx, name, key, item)`. Pantry search
   accepts any of them (→ `RECIPE-SCHEMA.md` `or`).
4. **Index columns**: `ingredients.key` (lookup key), `ingredients.item` (the
   resolved slug, or NULL), `ingredients.resolution` (`override` | `alias` |
   `plural` | `none` | `ambiguous`), plus `to_taste`, `buy_instead`, `qty_s`
   (the raw fraction string, for display). `familyDiff` groups by
   `COALESCE(item, 'k:' || key)` so the family table still works on unresolved
   rows.
5. Resolution happens at index time and is never written back to the recipe
   (→ `STORAGE.md` §Ingredient resolution; `INGREDIENTS.md` §Resolution 3). A
   registry change re-resolves every ingredient row from `data_json` with no
   recipe file read, the same way `retag` works. Sync does it when
   `registry_hash` changed.
6. **W303 / W305** (`app` fixer, → `VALIDATION.md`) are computed from the index
   rows. They show on the recipe page and in the server check (`/api/check`, the
   save result), never in the fix-request block. Their exact meaning follows Q1.
   Remove them from `DEFERRED_RULES`.
7. Unresolved names never block a save (→ `INGREDIENTS.md` §Resolution: "must
   never block saving a recipe"). What an unresolved name does to `status`: Q3.

**Resolution metrics** (the `tests/ingredients-corpus.test.ts` bodies; the
numbers are printed and kept in the final report):

| Id | Registry used | Measure | Gate |
|---|---|---|---|
| R0 | every variant from `expected-ingredients.yaml` as an alias | share of corpus item occurrences resolved to their expected id | 100 %, 0 wrong |
| R1 | **one** name per expected id (its first variant) | share of the other distinct variants auto-resolved to their expected id, by normalization alone | ≥ 60 % of distinct variants and ≥ 75 % of occurrences; **0 wrong** |
| R2 | same as R1 | for each variant R1 left unresolved, the expected id is among the top 3 fuzzy candidates | ≥ 85 % |
| R3 | the shipped seed registry | occurrences auto-resolved; **merges**: two different expected ids resolving to one seed slug | report coverage; merges **0** |
| R4 | empty, then built by simulating the queue (resolve the most frequent entry, check the answer key, repeat) | queue actions needed to cover 90 % of occurrences, against the distinct-name count | report |
| T | fixture registry + `resolve-traps.yaml` | trap pairs resolved to the same slug | **0** |

"Wrong" means auto-resolved to a slug other than the expected one. It is a hard
gate: if a coverage target cannot be met without a wrong resolution, keep
precision, report the coverage reached, and list the variants that caused it.
The fix may be a template change (Q24) rather than a resolver rule
(decision 1). R1 and R2 are the only tunable numbers (trigram threshold, number
of candidates). Tune them on the corpus and record the chosen values in
`INGREDIENTS.md`.

Tests: normalization unit tests (markers, ligatures, apostrophes, plural rules
from data), resolution order, ambiguity, the `item:` override, re-resolution
after an alias edit without reading recipe files, the family diff on
unresolved rows, and the corpus metrics.

**Implementation notes (Phase 2).**

- A sub-recipe line (`recipe:`) gets `resolution = recipe` and `item` NULL: it is
  not an ingredient to buy, and it must not show as unresolved. Not in the plan's
  list of values; smallest consistent choice.
- An `item:` naming no registry entry is a new code, **W307** (`app`, warning),
  on path `…item`, rather than reusing W303, whose meaning (no match, nothing
  close) is about the name.
- A singular key shared by two entries resolves to neither (`none`, with
  candidates), as step 2's ambiguity rule applied to step 3. Only an exact key
  shared by two entries is stored as `ambiguous`.
- Re-resolution reads the stored `ingredients.key` / `ingredient_or.key`, not
  `data_json`: the key is all resolution needs, and it is set-based (one
  temp-table update per table). Overrides and sub-recipe rows are left alone.
- W303 / W305 / W307 are computed with the resolver of the indexed registry
  (`unresolvedDiagnostics`), not read from index rows: candidates are not stored.
- Q3 A in the UI: an "Ingrédients non reliés (N)" section on the recipe page
  (not printed) and a browse facet *Ingrédients → Non reliés au registre*
  (`?relies=non`).

**Measured (corpus of 320 recipes, 2927 names, 169 ids).**

| Id | Result | Gate |
|---|---|---|
| R0 | 2881/2881 resolved, 0 wrong; the 46 ambiguous occurrences stay unresolved | met |
| R1 | 26/310 distinct other variants (8.4 %), 190/1132 of their occurrences (16.8 %); 67.3 % of all occurrences; **0 wrong** | coverage **not met**; 0 wrong met |
| R2 | 165/284 (58.1 %) with the expected id in the top 3 at min score 0.15 (46.1 % at the first value, 0.3) | **not met** |
| R3 | seed of 243 entries: 2512/2927 occurrences (85.8 %), 141/169 ids; merges 0; ambiguous forms auto-resolved 0 | met, after a seed fix |
| R4 | 254 queue actions cover 90 % (50 % after 35, 75 % after 120), against 489 distinct lookup keys; 0 wrong | report |
| T | 0 of 20 trap pairs | met |

Why R1 and R2 miss: of the 284 variants R1 leaves unresolved, 137 are on
English cards (*flour*, *brown sugar*), and most of the rest are synonyms or
older words (*sucre brun*, *gruau*, *abaisse*, *lait Carnation*) or descriptors
(*eau bouillante*, *pommes McIntosh*). No normalization or trigram measure links
*sucre brun* to *cassonade*; only aliases do (the seed, then the queue). Reaching
the targets would take a translation table or looser matching, which decision 1
and the 0-wrong gate rule out. Precision kept, coverage reported. Min score
tuned on R2: 0.05 → 60.2 % hits with 3.00 candidates shown on average; 0.1 →
59.5 %, 2.69; **0.15 → 58.1 %, 1.94**; 0.2 → 53.9 %, 1.51; 0.3 → 46.1 %, 0.93.
0.15 is the knee.

R3 at first found 1 merge (English *shallots* in `echalote-francaise`, while the
Québec cards use it for green onions) and 35 auto-resolved ambiguous occurrences
(*tomates*/*tomatoes* → `tomate`, *champignons*/*mushrooms* → `champignons`,
English *lard* → `saindoux` matching French *lard*). The resolver was right
given the data; the seed was not. Those bare aliases were removed from the seed
(its header and `INGREDIENTS.md` "The seed" now state the rule), not special-cased
in code.

### Phase 3 — the resolve queue (`/resoudre`)

Depends on: Q1, Q4, Q25 (merge).

1. One row per unresolved or ambiguous **key** across the vault, most frequent
   first (→ `INGREDIENTS.md` §Resolution: "most frequent first. Resolving
   `farine T55` once fixes it in 200 recipes"). Shown per row: the written forms
   and their counts, the number of recipes (a link to a filtered browse), and
   the top 3 candidates with one-tap "C'est ça".
2. Actions:
   - **Relier à un ingrédient existant**: adds the written form to that entry's
     `names.<lang>`, where `<lang>` is the language of most of the recipes using
     it (→ `RECIPE-SCHEMA.md`: `name` is "in the recipe's language"). Commit
     `ingredient: <slug> + "<written form>"`.
   - **Créer un ingrédient**: slug proposed from the name, category required,
     `staple` checkbox, the written form as the first alias. Commit
     `ingredient: add <slug>`.
   - Ambiguous keys: the same actions, plus "retirer l'alias de …" to settle
     the collision.
   Each action writes one ingredient file through the generalized helper, commits
   it, re-resolves, and moves to the next row with no page reload. No recipe file
   is touched (→ `STORAGE.md`).
3. Stale guard: every ingredient edit carries the hash of the file it was based
   on (→ `DATA-FLOW.md` §Concurrent edit).
4. Nav: a "À relier (N)" entry appears once N > 0.
5. `vault queue [--limit N]` prints the queue: keys, counts, candidates. It is
   the CLI way to check progress.

Tests: server (link, create, ambiguous, stale refusal, commit messages,
re-resolution). E2E: resolve the top row, then the recipes using it lose W303.

**Implementation notes (Phase 3).**

- Merge ("Fusionner dans…", Q25 B) is left to Phase 6, where the plan lists
  it under the ingredient view; Phase 3 has link, create and remove-alias.
- The queue groups by lookup key alone, across languages; the alias goes under
  the language of most recipes using the key, and is the key's most frequent
  written form (markers stripped). Other forms with the same key match it anyway.
- A link picked by name from the full entry list carries no hash (the person
  saw no file); a candidate's "C'est ça" and "Retirer" carry the entry's hash.
- The frontmatter is edited as a YAML document (`withName` / `withoutKey` in
  `src/lib/ingredients/registry.ts`), so hand comments survive; a new entry is
  written by `serializeIngredient`. Either must pass `parseIngredient` first.
- The removal commit message, not given by the plan: `ingredient: <slug> - "<form>"`.
- `writeCommitIndex` (save.ts) and the family label writer now go through
  `src/lib/server/files.ts` (`writeAndCommit`), which also deletes files (for
  the Phase 6 merge).
- The recipe-count link of a row opens `/?q=<form>&relies=non` (full-text
  search on the name, restricted to recipes with unlinked names): there is no
  browse filter by lookup key.

### Phase 4 — prices and the ingredient index (`/ingredients`)

Depends on: Q7 (price model), Q8 (entry), Q9 (commits), Q26.

1. `prices.csv` (→ `STORAGE.md` §Prices): columns `date, ingredient, amount,
   currency, pack_qty, pack_unit, shop, note`. The file is append-only through
   the app. The current price is the latest row per ingredient; a same-day tie
   goes to the later line. A row is flagged **stale** after a year
   (→ `INGREDIENTS.md` §Price history). A row whose `currency` is not the
   config's currency is kept and shown, but not used for cost. A row for an
   unknown ingredient slug is listed as a problem. A malformed CSV line is
   skipped and reported with its line number (the file is data, not a recipe,
   so it has no paths).
2. Index table `prices` (every row) and view `current_price`.
   `meta.prices_hash` is set, and the watcher reloads on change.
3. **The ingredient index** (→ `INGREDIENTS.md` §Two views, Ingredient index):
   a table of every ingredient with name, category, current price and pack,
   number of recipes, and a priced flag. Sortable. The default sort is "used in
   the most recipes, not priced", the order the doc gives for entering prices.
   Filters: category, priced or not, staple.
4. **Inline price entry** on each row: amount, pack qty, pack unit (default from
   Q26), shop (autocomplete: the shops already in the CSV plus config `shops`),
   and date (default today). Saving appends one row and commits it (Q9). Money is
   formatted with `Intl.NumberFormat(locale, { style: 'currency', currency })`
   (decision 2). Keyboard-first: Tab moves between fields, Enter saves and moves
   down a row.

Tests: CSV parsing (ties, stale, foreign currency, unknown slug, bad lines),
append with rollback on a failed commit, sort orders. E2E: enter a price inline,
reload, the price is there and `prices.csv` gained one line.

**Implementation notes (Phase 4).**

- Codes (Q6): `E812` (no header, or a required column missing: nothing read),
  `E813` (a line that does not read: skipped), `W814` (a slug with no registry
  entry: kept), `W815` (another currency: shown, not costed). All `app`,
  reported with the line number instead of a path. `VALIDATION.md`, "Price
  codes". `W814` and `W815` are derived at query time, so creating the entry or
  changing the config's currency clears them without a reload.
- Parsing: columns found by the header's names; RFC 4180 quoting; an empty
  `currency` is the config's; a decimal comma is read (in a quoted cell);
  `pack_unit` must be canonical (no aliases). `amount` and `pack_qty` > 0.
- Current price: the latest row **in the config's currency** (a later row in
  another currency does not hide an earlier usable one). View `current_price`
  over `prices.usable`; the `prices` table is rebuilt whole when
  `meta.prices_hash` (file + currency) changes.
- Config: `currency` (default `CAD`), `locale` (`fr-CA`), `shops` (`[]`),
  documented in `DEPLOY.md`. The currency travels on the `VaultContext` and as
  a `syncVault` option; `vault` CLI reads it from the config when there is one.
- "Number of recipes" counts recipes where the entry is a main line
  (`ingredients.item`); an `or` option is not costed, so it does not raise the
  entry's priority for pricing.
- Sorts: `a-saisir` (default: unpriced first, most recipes, name), `nom`,
  `categorie`, `recettes`, `date` (oldest price first, so stale ones surface;
  unpriced last). Clicking the current column's header reverses it. Filters:
  category, priced, staple, and a text search over every alias (folded). State
  in the URL.
- Inline entry: one editor open at a time (a row's "Saisir un prix"), not a
  form per row, so 1000 rows stay light. Pack unit defaults to `default_unit`,
  else the last price's unit; pack size to the last price's; shop to the one
  typed last in this sitting, else the last price's; date to today. Enter saves
  and opens the next row (of the list as it was before the save); Escape
  closes. Amounts accept `0,89`.
- No stale guard for a price: the file is only appended to, read under the
  lock at write time. Commit: `price: farine 4.99 / 2.5 kg`.
- The watcher reloads `prices.csv` and commits it even with a bad line (data,
  not a document; the line is listed); `vault sync` prints the price summary
  and exits 1 when a line was skipped; `vault check --dir <vault>` checks it.
- Rows carry an anchor (`/ingredients#i-<slug>`); the ingredient view
  (`/ingredients/<slug>`) is Phase 6.

### Phase 5 — unit conversion and cost on the recipe page

Depends on: Q10–Q18.

1. `units.ts` (→ `INGREDIENTS.md` §Unit conversion; `VOCAB.md` §Units):
   - Within mass and within volume, conversion is always safe. `cup` = 250 ml
     (→ `VOCAB.md`). The other volume factors come from data (Q10).
   - Mass ↔ volume only with the ingredient's `density`. It is never guessed.
   - `tbsp`/`tsp` → mass: Q11. `pinch`, `piece`, `clove`, `slice` and the other
     count units convert only through the per-ingredient weights (Q12) or a price
     row in the same unit (→ `INGREDIENTS.md`: "`piece`: needs a price row with
     `pack_unit: piece`, or an explicit average weight").
   - Container units (`can`, `packet`, `jar`, `bottle`, `bag`): Q13.
   - When nothing applies the item is **unpriceable**, never estimated.
   - `alt` is "the same amount in another measure" (→ `RECIPE-SCHEMA.md`), so
     when `qty`/`unit` cannot be converted and `alt` can, `alt` is used.
2. `cost.ts`: **consumed cost** (pro-rata, fractional packs) per recipe and per
   serving (→ `INGREDIENTS.md` §Cost). Shopping cost is P3 (it belongs on a
   shopping list). `or` → the main entry is costed (→ `RECIPE-SCHEMA.md` `or`).
   Optional groups are excluded (→ `RECIPE-SCHEMA.md`). Item-level `optional`:
   Q18. Ranges: Q15. Sub-recipes recurse, scaled by `qty` against the
   sub-recipe's `yield` or `servings` (→ `RECIPE-SCHEMA.md` §Sub-recipes); the
   details are Q16.
3. **Coverage** (→ `INGREDIENTS.md` §Partial pricing): `priced / counted`, where
   `counted` excludes `to_taste` and staple items. An entry with no quantity
   that is not `to_taste` counts, and it is unpriced unless its unit can be
   priced. Priced staples: Q17. Below the threshold (~70 %): Q14. The line reads
   `≈ 4,20 $ · 9 ingrédients sur 12 ont un prix` (the wording goes in `fr.ts`).
4. **Recipe page** (→ `INGREDIENTS.md` §Two views, Recipe view): the cost line
   under the servings. Each ingredient name links to `/ingredients/<slug>` when
   resolved, and is marked "non relié" with a link to the queue row when not.
   The server sends per-item costs at the base servings. The browser scales the
   total with the servings adjuster; the cost per serving does not change. Print
   view: the cost line is left out (it is not part of the recipe). Kitchen mode
   is unchanged.

Tests: the doc's worked example as a fixture (800 g of tomatoes at 0.89 $ per
400 g = 1.78 $), every conversion path including a refused one, coverage with
staples and `to_taste`, below-threshold display, sub-recipe recursion with
`yield`, a cycle guard (E213 already blocks cycles; stay defensive), servings
scaling in the browser.

### Phase 6 — the ingredient view (`/ingredients/[slug]`)

Depends on: Q25 (merge action), Q26.

Everything `INGREDIENTS.md` §Two views, Ingredient view lists:
- canonical name, every alias by language, category, allergens, staple, density
  and per-unit weights;
- pack and current price, the price history as a dated list with the change
  from the previous row, and a staleness warning. Charts are P3 (→ `PLANNING.md`
  P3: "price history charts");
- every recipe using it, sorted by quantity used, converted to `default_unit`
  where possible, with unconvertible quantities after the rest (→ "sorted by how
  much it uses");
- total quantity consumed across the vault (same conversion);
- substitutes, and what it substitutes for (the reverse lookup);
- the unresolved written names whose fuzzy candidates include this entry, each
  with "Relier ici" (→ "unresolved written names mapped onto it, so drift is
  visible");
- edit: aliases, category, staple, density, weights, substitutes, allergens,
  through the same file helper and stale guard as Phase 3. Merge: Q25.

Tests: server queries. E2E: add an alias from the view, and a recipe using it
becomes resolved.

### Phase 7 — pantry search (`/garde-manger`)

Depends on: Q19, Q20.

1. The query (→ `INGREDIENTS.md` §Pantry search): `required` = items that are
   not optional, not `to_taste`, not staple, and not in an optional group. An
   entry with `or` matches if any option is in `have`. `matched`, `missing` and
   `coverage` follow the formula in the doc.
   - Sub-recipes recurse: missing flour for the pastry means missing it for the
     tarte, unless `buy_instead`, in which case a registry ingredient with the
     sub-recipe's slug also matches (→ `RECIPE-SCHEMA.md` §Sub-recipes).
   - Unresolved items are left out of `required` (→ `INGREDIENTS.md`: "missing
     from … pantry search until resolved"). The result says so (Q19).
2. Tiers, in order (→ `INGREDIENTS.md` table and §Substitutions;
   `PLANNING.md` §Search): **Prêt à cuisiner** (`missing = 0`), **Avec une
   substitution** (every missing item has a substitute in `have`; directional,
   using the missing item's `substitutes`), **Presque** (`missing ≤ 2`),
   **Idées** (`matched ≥ 1`). Within a tier: coverage descending, then fewest
   missing, then highest `rating`, then shortest `total_s`. Every result shows
   its missing items inline, and the substitution tier names the swap.
3. Filters (→ §Negative and required filters): **doit contenir** (pin
   ingredients) and **à éviter** (an ingredient, or an allergen, Q20).
4. Input: an autocomplete over registry names in both languages that picks
   slugs. The "supposer les essentiels" toggle is Q19. State lives in the URL
   (`?have=oeuf,penne&must=&avoid=`) so the back button and bookmarks work
   (→ plan 02 Phase 4 convention). The last set is also kept on the device.
5. The query is a join over `ingredients(item)` grouped by recipe, plus the
   `ingredient_or` table and the recursion done in SQL or in memory, whichever
   meets the target (→ `INGREDIENTS.md` §It stays fast: "single-digit
   milliseconds").

Tests: a fixture vault with a hand-computed expected tier for each recipe, `or`,
optional groups, `buy_instead`, substitution direction, must/avoid, allergen
avoid. E2E: pick two ingredients, see the tiers, open a result.

### Phase 8 — the deferred checker codes and the AI template

Depends on: Q21, Q22, Q23, Q24.

1. **W302, W304, W607** (`ai` fixer): need the participle, size-descriptor and
   brand word lists (Q22). The browser's live check and `/api/check` must give
   the same result, so the lists travel with the check (Q22).
2. **W501** (tag not in `vocab/tags.yaml`, closest canonical suggested) and
   **W502** (`family` within edit distance 2 of an existing family): `app`
   fixer. Both are vault-context warnings computed in the server check and at
   save time, like W306/W608 (→ `VALIDATION.md`). W502 compares against
   `vocab/families.yaml` plus the families in use. The other agent is writing
   `families.yaml` handling now: build on it. Q23 decides where else they show.
3. **W606** (`to_taste` on something the registry does not class as seasoning or
   fat, `ai` fixer): needs a registry field (Q21). It comes from the server
   check. `ai` codes that need the vault reach the fix-request block through
   `/api/check`'s diagnostics, which the paste box already merges.
4. W603 (no photo) stays deferred until upload (P2); its reason is already in
   `deferred.ts`. `DEFERRED_RULES` keeps only W603.
5. **AI template** (Q24): apply the chosen changes to `docs/AI-TEMPLATE.md`,
   re-run the prompt fixtures (`tests/fixtures/prompt/sources/`) as the
   template's changelog asks, and add a row to its findings table.
6. French texts for every new code in `src/lib/i18n/diagnostics.ts`.

Tests: a fixture per code (valid and invalid), the test that every code has a
fixer and a French text, and one check that the browser and server results
agree on W302/W304/W607.

### Phase 9 — scale, docs, report

1. `scripts/gen-vault.ts` also writes an invented registry of ~1000 entries
   (aliases, staples, densities, substitutes), ~3000 price rows, and makes ~10 %
   of generated item names unresolvable. `--bench` measures the targets below.
2. `scripts/fixture-vault.ts --corpus` builds a temp vault from the corpus plus
   the seed registry, to use the app on realistic data.
3. Docs: record every answered question in its doc. `DATA-FLOW.md` gets the new
   tables and meta keys. `INGREDIENTS.md` gets the resolution order, the tuned
   thresholds, the unit rules, and the coverage rules. `STORAGE.md` gets
   `prices.csv` behaviour. `VALIDATION.md` gets the registry codes.
   `PLANNING.md` gets the P1.5 status and open questions 2 and 3 marked decided.
   `README.md` gets the new CLI commands.

## Speed targets

Measured by `gen-vault.ts --bench` at 5000 recipes (~60 000 ingredient rows),
~1000 registry entries and ~3000 price rows, on this machine. Record the numbers
in the final report and in `DATA-FLOW.md` next to the plan 02 figures.

| Operation | Target | Why |
|---|---|---|
| `sync --force`, with resolution | < 30 s (plan 02 target; today ~5 s, report the delta) | startup and `vault reindex` |
| no-op sync | < 3 s | run on every start |
| re-resolve every row after one registry edit | < 1.5 s | each resolve-queue click waits on it |
| fuzzy candidates for one name | < 5 ms | the queue computes them for every row |
| resolve queue page | < 100 ms | |
| ingredient index page (1000 rows, any sort) | < 50 ms | the price-entry screen |
| ingredient view | < 50 ms | |
| cost of one recipe, with sub-recipes | < 5 ms | on every recipe page load |
| pantry query, all tiers | < 10 ms (→ `INGREDIENTS.md`: "single-digit milliseconds") | |
| append one price row and commit | < 500 ms | inline entry must feel instant; git dominates |

## Testing summary

- Unit: registry parse/serialize/check, normalization, resolution order and
  ambiguity, unit conversion (including the refusals), cost and coverage, price
  CSV rules, pantry tiers.
- Corpus: the R0–R4 and trap metrics above, run in the normal suite (invented
  data).
- Server: re-resolution on registry change (sync, watcher, queue action), file
  writes with rollback and stale guard, commit messages, W501/W502/W606 in the
  server check.
- E2E (Playwright, temp fixture vault, own port): resolve from the queue; enter
  a price inline, then the recipe's cost line changes; pantry search with a
  substitution; ingredient view alias edit.
- `npm run check` clean.

## Done when

- Every ingredient item in the index has a resolution state. Unresolved names are
  in the queue, most frequent first, and never block a save.
- R0 = 100 %, R1 ≥ targets with 0 wrong, R2 ≥ 85 %, R3 merges = 0, traps = 0,
  or a report of why a coverage target was not reached without losing precision.
- No recipe file is written by resolution, queue actions, price entry or cost.
- The cost line shows coverage and never a figure that looks complete when it
  is not.
- Pantry search answers the four tiers with missing items inline.
- Prices entered inline are one commit each (or as Q9 decides) in `prices.csv`.
- Deleting `cache/` and restarting loses nothing.
- W302, W303, W304, W305, W501, W502, W606, W607 are live; only W603 is deferred.
- Speed targets met, or measured and reported.
- Docs updated for every answered question; all tests and `svelte-check` pass.

## Final report

1. What was built, per phase, with commit hashes.
2. Corpus metrics R0–R4 and traps, with the tuned thresholds.
3. Speed numbers at 5000 recipes.
4. Doc contradictions or undefined cases found beyond the questions below, each
   with a proposed doc change.
5. Anything deferred, and why.

## Out of scope

Shopping cost and shopping list, meal planner, price charts (P3). Nutrition
(→ `PLANNING.md`: deliberately out of scope). Multi-shop price comparison
(→ `PLANNING.md`: "a different app"). Price scraping. Ingredient slug rename.
Edit form, photo upload, accounts (P2). The real vault: the owner runs it.

---

## Open questions

**Decided 2026-09-27: the owner took the recommended option on every question,
Q1–Q26.** Implement the "Recommended" bullet of each; where a phase says
"depends on Qn", that dependency is now settled. Doc changes that follow from a
decision (for example Q1's rewording of W305/W303 in `VALIDATION.md`) are part
of the phase that implements it.

The docs leave each of these open or contradict themselves. For each one, the
options are listed, and the last bullet gives the recommendation with a one-line reason. Q-numbers are
referenced from the phases.

### Resolution

**Q1 — Does a fuzzy match ever resolve automatically?**
`INGREDIENTS.md` says a miss offers fuzzy candidates in the UI. `VALIDATION.md`
W305 says "resolved by fuzzy match rather than exact alias — confirm", which
implies automatic fuzzy resolution.
- A. Never. Fuzzy only suggests: W305 becomes "a candidate is waiting in the
  resolve queue" and W303 "no candidate at all". Update VALIDATION.md.
- B. Automatic above a high similarity, but provisional: counted in pantry
  search, excluded from cost, W305 until confirmed.
- C. Automatic above a threshold and counted everywhere, W305 until confirmed.
- **Recommended: A.** A wrong match silently corrupts cost and pantry results
  (→ "wrong prices are worse than absent"). The queue makes confirming one tap,
  and one tap fixes every recipe using that name.

**Q2 — How are plurals handled?** `INGREDIENTS.md` says "strip plurals", but
plural rules depend on the language, and nothing regional may be hard-coded.
- A. No stemming. Aliases list every form (`œuf`, `œufs`); the key is only
  folded. The queue picks up each new plural once.
- B. Suffix rules as data, one list per language, in `vocab/normalize.yaml`
  (seed: `fr`/`en` `-s`, `-x`, a minimum word length). They apply to both the
  alias and the name, and only as a fallback after an exact match, and only when
  the result maps to exactly one slug.
- C. A built-in French/English stemmer in code.
- **Recommended: B.** It keeps the doc's "strip plurals", stays generic (the
  rules are data), and exact-first plus uniqueness keeps *pâte*/*pâtes*-type
  pairs apart.

**Q3 — Does an unresolved ingredient set the recipe to `needs-review`?**
`INGREDIENTS.md` says "recipe flagged `needs-review`". `DATA-FLOW.md` derives
`status` from markers only. Resolution is never written to the file, and
`status` is in the file.
- A. No. The status in the file is untouched. The index marks the recipe
  "ingrédients non reliés (N)" (a badge, a browse filter, W303 on the page).
- B. Yes. Save writes `needs-review` while any name is unresolved.
- C. Both: a badge, and `needs-review` written at the next save.
- **Recommended: A.** With B, a registry edit would change what a recipe's
  status should be without touching the file, which is exactly the coupling
  `STORAGE.md` rejects.

**Q4 — Does the app ever write `item:` into a recipe?** `STORAGE.md` allows `item:`
as a rare manual override; nothing says whether the app offers it.
- A. No UI in P1.5. An override is a hand edit, or the P2 form later.
- B. A "seulement pour cette recette" action in the queue and on the recipe page,
  writing `item:` through the save path (an `edit:` commit).
- **Recommended: A.** It is rare by design, and the queue then never touches a
  recipe file, so its commits stay small.

**Q5 — Where does the first registry come from?**
- A. Empty. Everything goes through the queue.
- B. A seed data file (for example `docs/INGREDIENTS-SEED.yaml`, ~150 common
  entries with staples, categories, and densities for flours and sugars),
  copied by `vault init` and added to an existing vault by
  `vault ingredients seed`. The defaults are the owner's (Québec names as
  aliases).
- C. Bootstrap from the vault: one entry per distinct name used in 2+ recipes,
  category `autre`, to clean up afterwards.
- **Recommended: B.** The queue then starts with the long tail, not with *sel*
  and *farine* on 300 recipes. It is data, not code (decision 1), the same
  pattern as the vocab seed.

**Q6 — Do ingredient-file and `prices.csv` problems get stable codes?**
- A. Yes, a new range in `VALIDATION.md` (for example `E8xx`/`W8xx`, all with
  the `app` fixer), shown in `vault check` and on the ingredient pages.
- B. Plain messages, no codes. The AI never writes these files.
- **Recommended: A.** `CLAUDE.md` asks for stable codes from `VALIDATION.md`,
  and the diagnostics UI, the French texts and `vault check` then need no second
  mechanism.

### Prices (PLANNING open questions 2 and 3)

**Q7 — One price per ingredient, or per shop?** `STORAGE.md` has a `shop`
column and "current price = latest row"; `PLANNING.md` Q2 leaves it open.
- A. One current price: the latest row, whatever the shop. The shop is a label
  shown next to the price.
- B. A current price per shop; cost uses the cheapest shop's price.
- C. A current price per shop; cost uses a preferred shop from the config,
  falling back to the latest row.
- **Recommended: A.** It is what `STORAGE.md` already says, and
  `PLANNING.md` rules multi-shop comparison out of scope.

**Q8 — Who enters prices, and how?** (`PLANNING.md` Q3)
- A. By hand, inline in the ingredient index sorted by "most used, not priced"
  (hand-editing `prices.csv` in a spreadsheet also works).
- B. A, plus a "reçu" bulk mode: one line per item (ingredient, amount, pack) for
  a whole receipt, with one date and shop.
- C. Scraping grocery flyers or websites.
- **Recommended: A.** The doc's own estimate is that the first 50 entries give
  most of the value. B can come later if entering prices proves tedious. C is
  fragile and depends on the shop.

**Q9 — One commit per price row?**
- A. Yes: `price: <slug> <amount> / <pack>`, pushed in the background like every
  save.
- B. Batched: rows entered in one sitting are committed together after ~2 min
  idle or on leaving the page.
- **Recommended: A.** "Every save is a commit" holds everywhere else, the
  rollback stays simple, and git handles hundreds of small commits.

### Units and cost

**Q10 — Where do unit conversion factors live, and what are `qt`, `pint`,
`tbsp` and `tsp` worth?** `VOCAB.md` fixes `cup` = 250 ml only. The other factors
are regional, so they are data.
- A. Factors in `vocab/units.yaml` (seeded from `VOCAB.md`): `tbsp` 15 ml,
  `tsp` 5 ml (Canadian metric, consistent with the 250 ml cup), `qt` 1136 ml,
  `pint` 568 ml (imperial), `oz` 28.35 g, `lb` 453.6 g.
- B. The same file, but `qt` 946 ml and `pint` 473 ml (US).
- C. The same file, but `qt` 1000 ml and `pint` 500 ml (metric round).
- **Recommended: A.** Old Canadian cards use imperial pintes and chopines. The
  values are data the owner can change, and `VOCAB.md` already treats
  differences under ~15 % as irrelevant to cost.

**Q11 — Do `tbsp`/`tsp` convert to mass through `density`?** `INGREDIENTS.md`
says mass↔volume works "with an explicit density", but also that tbsp/tsp
convert "only via a per-ingredient table".
- A. Yes. tbsp/tsp are volumes (Q10), so `density` applies; a per-ingredient
  weight (Q12) overrides it when present.
- B. No. tbsp/tsp → mass only through the per-ingredient table, even when a
  density exists.
- **Recommended: A.** Density is exactly the "flour ≠ honey" fact the doc worries
  about, so requiring a second table for the same fact only adds unpriced items.

**Q12 — How is "an explicit average weight" stored?** `INGREDIENTS.md` asks for
per-ingredient weights for `piece` (one egg ≈ 55 g) and for `pinch`, but the
registry example has no field for them.
- A. `weights:` in the ingredient file, mapping a canonical unit to grams:
  `{ piece: 55, clove: 5, pinch: 0.4 }`.
- B. A single `piece_weight` only.
- C. None: count units are priced only by a price row in the same unit.
- **Recommended: A.** One generic field covers `piece`, `clove`, `slice`,
  `stalk` and `pinch`, which is what makes cards written in counts priceable
  against metric packages.

**Q13 — Container units (`can`, `packet`, `jar`, `bottle`, `bag`) in cost.**
- A. Priced only by a price row with the same `pack_unit` (a can at 1.29 $ per
  can).
- B. A, and also read the single size already allowed in `note` (`796 ml`,
  `19 oz (540 ml)`, the E216 grammar) to convert against a price per g or ml.
- **Recommended: B.** Cards write "1 boîte" while shops price by size. The note
  grammar is already generic and parsed, and a note that does not parse leaves
  the item unpriced.

**Q14 — What does the cost line show below the coverage threshold (~70 %)?**
`INGREDIENTS.md` says "a range or a 'not enough prices yet' state".
- A. No figure: `Pas assez de prix · 5 ingrédients sur 12`, with a link to the
  unpriced ones.
- B. A lower bound: `au moins 3,10 $ · 5 sur 12`.
- C. Always a figure, with coverage next to it.
- **Recommended: A.** A lower bound on a recipe that is mostly unpriced is not a
  useful number, and C is what the doc forbids. The link turns the gap into a
  next step.

**Q15 — Ranges (`qty_max`, `servings_max`) in cost.**
- A. One number: upper `qty`, per serving divided by `servings` (the lower
  bound). This never under-states cost and matches the index's "upper bound"
  convention for durations.
- B. The midpoint of each range.
- C. A cost range (`1,80–2,40 $ par portion`).
- **Recommended: A.** It is one honest, conservative figure, and a range on
  every line would clutter the page she cooks from.

**Q16 — Sub-recipes in cost and coverage.** `RECIPE-SCHEMA.md` says cost recurses,
"scaled by `qty` against its `servings` (or `yield`)". The case where the units
do not match is undefined, and so is `buy_instead`.
- A. Flatten: the sub-recipe's items, scaled, count in the parent's cost and
  coverage. Scaling uses `yield` when its unit equals the item's unit, else
  `servings` when the item is in `piece`; otherwise the sub-recipe is one
  unpriced item. `buy_instead` does not change cost (homemade is costed).
- B. The sub-recipe is one line, priced only if its own coverage passes the
  threshold.
- **Recommended: A.** Coverage then means the same thing at every level, and an
  undefined scaling stays visibly unpriced instead of guessed.

**Q17 — Priced staples.** Staples are out of the coverage denominator.
- A. When priced, they add to the cost but never count for or against coverage.
- B. Staples never enter the cost.
- **Recommended: A.** Butter and sugar are real money in desserts. Excluding them
  from coverage keeps it from looking permanently broken, which is the doc's
  only reason for the exclusion.

**Q18 — Items marked `optional: true` (not a whole optional group) in cost.**
- A. Excluded from the total and from coverage, like optional groups.
- B. Included.
- **Recommended: A.** This is consistent with optional groups and with pantry
  search, which already excludes them.

### Pantry search

**Q19 — Defaults and presentation.**
- A. "Supposer les essentiels" is on by default. One page with the four tiers as
  sections in order, each capped at ~20 with "voir plus". A result with
  unresolved items says "+ N ingrédients non reliés".
- B. The same, but staples are off by default.
- C. One tier at a time, as tabs.
- **Recommended: A.** Without staples every result reads "missing salt"
  (→ `INGREDIENTS.md`: "the feature is worthless"). One scrolling page is fewer
  taps on a phone. The unresolved note keeps "prêt à cuisiner" honest.

**Q20 — The allergen list** ("from a fixed list", never given).
- A. A data list in `vocab/allergens.yaml`, seeded with the owner's default (the
  Health Canada priority allergens: œufs, lait, moutarde, arachides, crustacés
  et mollusques, poisson, sésame, soya, sulfites, noix, blé et gluten).
- B. Free text per ingredient.
- C. No allergens in P1.5; "à éviter" takes ingredients only.
- **Recommended: A.** A fixed list is what makes "à éviter : arachides" reliable.
  As data it satisfies decision 1, and the seed is the owner's own regulator's
  list.

### Checker codes and the AI template

**Q21 — What classes an ingredient as "seasoning or fat" for W606?** The 12
categories include `epice` but nothing for fats.
- A. A registry flag `au_gout: true` ("may be to taste"), seeded on salt,
  pepper, oils, butter and the like.
- B. A new category `matiere-grasse`, and W606 accepts `epice` and
  `matiere-grasse`.
- C. Drop W606.
- **Recommended: A.** Categories describe where you shop. The flag describes how
  a recipe uses the item, so it adds nothing to the category list, and it is
  data.

**Q22 — Where do the W302 (participles), W304 (size descriptors) and W607
(brands) word lists live?** `deferred.ts` says "from vocab/"; `VOCAB.md` has no
such lists.
- A. Seed lists in `VOCAB.md`, copied to `vocab/participles.yaml`,
  `vocab/descriptors.yaml` and `vocab/brands.yaml`. The checker receives them as
  options. The paste page loads them with the page, so the live browser check
  equals the server check.
- B. Built into the checker code, like the unit list.
- **Recommended: A.** These are language and regional words, which decision 1
  puts in data. The unit list stays in code because it is the prompt's contract.

**Q23 — Where do W501/W502 show besides the paste box?**
- A. The paste box, and the recipe page, computed at index time (a vocabulary
  change re-derives them, like tags).
- B. The paste box only.
- **Recommended: A.** Tags and families drift through outside edits and
  vocabulary changes too, and the recipe page is where the owner would fix them.

**Q24 — Should the AI template change?** The AI does not know the registry;
regional normalization belongs in the prompt (decision 1).
- A. No change; measure first (queue size, R3 on the corpus).
- B. Add one rule to 10: "`name`: the source's own words, lowercase, without
  article (*farine*, not *de la farine*); do not translate or modernize a
  regional name (*piment vert* stays *piment vert*); singular or plural as
  written". Re-run the prompt fixtures.
- C. B, and also ask the AI to add a guessed `item:`.
- **Recommended: B.** Stray articles and "corrected" names are the variations the
  resolver cannot fold safely. C misuses `item:`, which `STORAGE.md` reserves
  for deliberate overrides.

### Registry maintenance

**Q25 — Merging two ingredients** (`STORAGE.md` describes a merge as "edit one
alias list"; `prices.csv` rows name the old slug).
- A. Out of scope: merge by hand.
- B. A "Fusionner dans…" action: moves aliases and substitutes, deletes the
  absorbed file, one commit. Refused when the absorbed entry has price rows.
- C. B, and rewrite the old slug in `prices.csv`.
- **Recommended: B.** Duplicates will appear as the queue is worked. Refusing
  when price rows exist keeps `prices.csv` append-only (C would break that).

**Q26 — What is `default_unit` for?** It is in the registry example, never
explained.
- A. The unit for vault-wide totals and "sorted by quantity used" on the
  ingredient view, and the default `pack_unit` when entering a price.
- B. Drop the field.
- **Recommended: A.** Both screens need one unit to add quantities in, and the
  field already exists in the fixtures.
