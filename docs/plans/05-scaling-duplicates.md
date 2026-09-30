# Plan 05 — P3 scaling, Tier 2 duplicate detection

Status: **draft, questions open.** Written 2026-09-29 for a fresh agent
session. Previous plans: `02-read-app.md` (done: vault, save path, index, paste
box, browse, recipe page, kitchen mode, trash), `03-ingredients.md` (done:
registry, resolution and queue, prices, cost, pantry search),
`04-write-path.md` (done: accounts, the form, photos, undo and history,
pending tags).

## Context in one paragraph

RecipeVault is a self-hosted archive of a family's recipe collection (500–5000
recipes, mostly old handwritten Québec cards). Two people use it
(`PLANNING.md`, Goal): the owner, who bulk-adds recipes by pasting Markdown from
a chat AI, and his retired mother — "her" in every doc — who browses, cooks
from a tablet or phone, and adds and edits her own recipes through a form. The
owner chose two pieces of work next. **Scaling** (`PLANNING.md`, P3: "the
structured quantities already make this nearly free"): a servings adjuster
already exists on the recipe page and in kitchen mode, but it multiplies and
prints whatever number comes out (`0,83 tasse`, `1,67 œuf`), leaves sub-recipes
and the quantities written inside steps untouched, and forgets the amount when
the page is shared or reloaded. This plan makes a scaled recipe read the way a
cook would write it. **Duplicate detection by ingredient set**
(`PLANNING.md`, Gaps review, Tier 2): "Titles lie — 'Lasagnes de maman' and
'Lasagnes bolo' can be one recipe. Structured ingredients make Jaccard
similarity on ingredient sets trivial. Flag pairs above ~0.8." At 5000 pasted
cards the same recipe arrives twice, under two titles, and the title check
(`W503`/`W608`) cannot see it. Nothing in this plan writes a scaled quantity to
a file; duplicate detection writes only what a person decides about a pair.

## Read first

| Doc | Why |
|---|---|
| `CLAUDE.md` | privacy rule, conventions |
| `PLANNING.md` | Kitchen mode (servings adjuster, fractions as fractions, oven in both units), P3, Gaps review Tier 2 (duplicates), "What 5000 recipes changes" (duplicates are guaranteed), Deliberately out of scope |
| `docs/RECIPE-SCHEMA.md` | `qty` (fractions stay as written), `qty_max`, `alt`, `or`, `to_taste`, `optional`, optional groups, `servings`/`servings_max`, `yield` (text or object), sub-recipes and `buy_instead`, markers on number fields |
| `docs/VOCAB.md` | Units (the Canadian 250 ml cup, `T`/`t`), Conversions (`vocab/conversions.yaml`), the rule that regional data is a `vocab/` file |
| `docs/INGREDIENTS.md` | Resolution (what an ingredient *is*: `ingredients.item`, else the lookup key), `staple`, Cost (sub-recipe scaling rule, Q16 of plan 03), Unit conversion |
| `docs/DATA-FLOW.md` | Cost on the recipe page (the browser multiplies by the factor), Family diff table (`COALESCE(item, 'k:' || key)`), Pantry search (a model kept in memory per index state), the paste box and her form (where warnings appear), Index schema |
| `docs/VALIDATION.md` | W503/W608 (titles), "Adding a code means choosing its fixer" and writing its French line, `formHintText` |
| `docs/STORAGE.md` | "Anything precious is plain text", `vocab/` is data, the layout |
| `docs/plans/03-ingredients.md`, `04-write-path.md` | conventions this plan follows (phases, tests, bench, report) |

The docs are the source of truth. Each behaviour below names the doc line it
comes from (→ `DOC` §section). Where the docs are silent or contradict each
other, the behaviour is an open question (Qn) at the end. **Do not start a
phase until the questions it depends on are answered.** Record each answer in
the doc named in that question, in the same commit as the code.

## Privacy rule — non-negotiable

This repository is **public**. Never read, copy, quote or paraphrase anything
from `/home/cotions/RecipeVault-vault/` or `~/.config/recipevault/`. This plan
has no real-vault phase: the owner looks at the duplicate page on the real
vault himself. All fixtures are invented: the 320-card corpus
(`tests/fixtures/corpus`), the fixture vault (`tests/fixtures/vault`), the
generated bench vault (`scripts/gen-vault.ts`), and every scaling table and
planted duplicate written for this plan. Screenshots go to `/tmp`.

## Decisions given by the owner

1. **Nothing regional is hard-coded** (→ plan 03, decision 1; plan 04,
   decision 1; `STORAGE.md` "Vocabularies are data"). Which fractions a cup or a
   spoon may show, how many teaspoons make a tablespoon, how metric amounts are
   rounded, which pairs are "not duplicates": data in the vault (`vocab/`, the
   registry) or config, seeded from `VOCAB.md`. The code holds the mechanism.
2. **UI in Québécois French.** Every string in `src/lib/i18n/fr.ts`; the French
   text of a new code in `src/lib/i18n/diagnostics.ts` (and `formHintText` if
   the form shows it).
3. **Review policy.** One review per piece of work, at the end; no re-review
   after the fixes; leftovers go to GitHub issues.
4. **Build now, test on invented data.** The corpus and generated vaults stand
   in for the real vault.
5. **Scope.** Scaling on the recipe page and in kitchen mode, and duplicate
   detection by ingredient set. **The shopping list is declined** (2026-09-29):
   no list, no whole-pack "shopping cost", no aggregation across recipes —
   moved to `PLANNING.md` "Deliberately out of scope" with this plan. Also not
   in this plan: meal planner, price history charts, cook log, PDF / cookbook
   export.

## What exists to reuse

**Scaling — already built** (plan 02, Phase 6; plan 03, Phase 5):

- `src/lib/render/scale.ts`: `scaleFactor(recipe, target)` and `MULTIPLIERS`
  (`0.5, 1, 1.5, 2, 3`, offered when a recipe has no `servings`).
- `src/lib/render/fraction.ts`: `formatNumber(n, lang)` — whole part plus a
  glyph (`⅛ ¼ ⅓ ⅜ ½ ⅝ ⅔ ¾ ⅞`) when within **2 %**, only below 20; otherwise a
  decimal with 2 / 1 / 0 digits and a decimal comma in French.
- `src/lib/render/ingredient.ts`: `formatAmount`, `ingredientParts`,
  `ingredientText` take a `factor` and scale `qty`, `qty_max`, `alt` and the
  amounts of `or` objects; `unitLabel` gives *tasse / tasses*, *c. à thé*,
  *gousse(s)*… (French plural from 2).
- `src/lib/components/RecipeView.svelte`: the servings stepper (±1, min 1,
  "Réinitialiser") or the multiplier select; `factor = servings /
  recipe.servings` else `multiplier`; the yield object scaled; print shows
  `× factor`; the cost snippet receives the factor.
- `src/routes/r/[slug=slug]/+page.svelte`: scaling state is component state,
  reset on each new recipe; the kitchen link carries it as `?portions=` or
  `?fois=`.
- `src/routes/r/[slug=slug]/cuisine/+page.svelte`: its own stepper; reads
  `?portions` / `?fois` once and drops them (`replaceState`); keeps servings,
  multiplier, ticks, step and timers in `localStorage` (`rv-kitchen:<slug>`,
  12 h, keyed by a fingerprint of the ingredients and steps); the per-step
  ingredient lines (`stepIngredients`) are scaled.
- `src/lib/components/CostLine.svelte`: the total follows the factor, the cost
  per serving does not (→ `DATA-FLOW.md` §Cost on the recipe page).
- `src/lib/render/temperature.ts` (°F ↔ °C) and `timers.ts` (durations in step
  text): never scaled, correctly.
- `src/lib/ingredients/units.ts`: `parseConversions`, `measure` — the vault's
  factors (`cup` 250 ml, `tbsp` 15 ml, `tsp` 5 ml, `lb` 453.6 g…);
  `UNIT_CLASS_OF` (`mass`, `volume`, `count`, `container`) in `types.ts`.
- `src/lib/vault/vocab.ts`: `findAllQtyUnits(text)` — the "amount + unit word"
  grammar `E216` uses, which can find `2 tasses` inside a step.
- `src/lib/ingredients/cost.ts`: the sub-recipe rule (plan 03, Q16 A) — a line
  scales a sub-recipe by `amount / yield` when the `yield` object is in the same
  unit or class; otherwise unscalable (`no-scale`).

**Duplicates — the pieces exist:**

- The index already holds every line's identity: `ingredients.item` (registry
  slug) or `ingredients.key` (lookup key) for unresolved ones, with
  `optional`, `group_optional`, `to_taste`, `recipe`; `registry.staple`.
  `familyDiff` already groups by `COALESCE(item, 'k:' || key)`.
- `src/lib/server/index/pantry.ts` builds a per-recipe model from those rows
  and keeps it in memory per index state; `src/lib/server/index/memo.ts`
  (`indexMemo`) is the general form. A duplicate model is the same shape.
- `src/lib/vault/rules/batch.ts`: W503 (near-identical title, edit distance 2)
  and W608 (same title) — the title side of "duplicate", in the checker.
- W608's "En faire deux versions" (plan 04, Q10 A): both recipes put in one
  family in one commit (`formsave.ts` `pair`), and the paste box's "Mettre en
  famille" — the "these are versions" action already exists.
- `src/lib/server/trash.ts`: "these are the same recipe" is a delete of one of
  them, already undoable (`/corbeille`, undo).
- `src/lib/server/index/resolve.ts` `getResolver` / `unresolvedDiagnostics`:
  vault-context warnings computed server-side on the paste check, the form's
  check and the save result — where a new warning plugs in.
- `src/lib/server/files.ts` `writeAndCommit`: every vault file write (atomic,
  rollback, own-write), for the "not duplicates" file.

## Findings from reading the code

### Scaling: what is easy

- Every quantity is structured and `factor` already flows through every line,
  `alt`, `or` object, range and the yield object, on the page, in print, in
  kitchen mode and into the cost line. Nothing needs the server: scaling stays
  browser-side, and so it can never write a file.
- `to_taste` lines, lines with no `qty` (noodles to serve), `note` (including
  a can's size, `796 ml`: it describes one can, and must not scale), `prep`,
  the oven and every time are already left alone.
- A marker on a quantity (`qty: "250 [?]"`) already stays visible after the
  scaled number.

### Scaling: what is hard, and the edge cases

- **Numbers a cook cannot measure.** `formatNumber` snaps only within 2 %, so
  most factors other than ×2 or ×½ produce decimals: `⅔ tasse` for 4 → 5
  servings is `0,83 tasse`, `¾ c. à thé` × ⅔ is `½` (fine) but × 5/6 is
  `0,63 c. à thé`, `1 œuf` × 1.5 is `1 ½` (fine) but × 4/3 is `1,33`. It also
  offers `⅜` and `⅝` for any unit, which no cup set measures. What may show is
  per unit, and regional (a Québec kitchen has ¼ ⅓ ½ ⅔ ¾ cups and ⅛ ¼ ½ 1
  spoons; another has other sets): data, not code (Q2).
- **Units that should change with the amount.** `⅛ tasse` is `2 c. à table`;
  `6 c. à thé` is `2 c. à table`; `20 c. à table` is `1 ¼ tasse`. The vault's
  `conversions.yaml` says `cup` 250, `tbsp` 15, `tsp` 5 — so 1 cup is **16 ⅔**
  tablespoons there, while every kitchen reckons 16. A restating ladder cannot
  be derived from the cost factors; it needs its own small table (Q3). Mass and
  volume never cross (no density on the recipe page), and metric amounts need
  their own rounding (`333,3 g` → `335 g`) (Q2).
- **Counts and containers.** `1,33 œuf`, `1 ½ boîte (796 ml)`, `2,5 gousses`:
  halves are usable, thirds of an egg are not, and rounding to whole changes
  the recipe's proportions silently (Q4).
- **`alt` and the main amount round separately.** `250 ml (1 tasse)` × 1.5 is
  `375 ml (1 ½ tasse)`: fine; × 1.33 could read `335 ml (1 ⅓ tasse)`. Each is
  rounded in its own unit, so the two may disagree by the tolerance; that is
  acceptable and the test says so.
- **Ranges** (`qty_max`) scale both ends; two ends may snap to the same value
  (`1 à 2` × ¼ → `¼ à ½`), then one value shows.
- **Servings ranges.** `servings: 6, servings_max: 8`: the factor is from the
  lower bound (as cost, plan 03 Q15 A), and today the range disappears as soon
  as the stepper moves (`servingsMax && servings === recipe.servings`) (Q7).
- **Text yields** (`yield: "24 biscuits"`) are not scaled at all; object yields
  are (Q7).
- **Sub-recipes.** The line scales (`1 abaisse` → `2 abaisses`), but kitchen
  mode's inline expansion shows the sub-recipe's own ingredients **unscaled at
  every factor** — at ×1 already, a tarte using one of a pastry's two crusts
  shows the pastry for two (Q5). The cost rule (line amount / `yield` object in
  the same unit or class) applies; the corpus's pastry sub-recipes carry
  `yield: { qty: 2, unit: piece, note: abaisses }` since plan 03 Phase 8.
- **Quantities inside steps** ("Ajouter 1 tasse de lait chaud") are prose, not
  structure: never scaled today. In kitchen mode the scaled ingredient line
  shows under that step and contradicts it at ×2 (Q6). `findAllQtyUnits` finds
  them with the vocabulary's unit words; temperatures (`350 °F`), durations
  (`25 min`) and pan sizes (`9 x 13 po`) use no recipe unit and are not found
  — this is the guard against scaling what must not scale.
- **Times and oven are never scaled** (a doubled cake in the same pan is not a
  doubled bake time; nothing in a file says how it changes). The page may say
  so when the factor is not 1 (Q6).
- **Where the amount lives.** On the recipe page it is component state: a
  reload, the back button or a link sent to a sibling loses it; kitchen mode
  remembers it per device (Q1). Pantry search already keeps its state in the
  URL (plan 03, Phase 7) — the convention to follow.
- **Setting the amount.** The stepper moves by one serving: 24 → 60 cookies is
  36 taps; "j'ai seulement 3 œufs" has no way in (Q8).
- **Factor 1 must not change a single character** of today's display: a
  recipe read at its own amount shows the card as written. This is a test
  over the whole corpus.
- **⚑ Flagged — unit labels are code.** `STORAGE.md` says "The code holds no
  word of a language or a region beyond the canonical unit list", yet the
  display words (*tasse*, *c. à table*, *c. à thé*, *pinte*, *chopine*) are
  tables in `src/lib/render/ingredient.ts`, and `render/steps.ts` hard-codes an
  `s`/`x` plural stem. They are UI language, like `fr.ts`, and this plan does
  not move them; the scaling *rules* it adds are data. Proposed doc change:
  `STORAGE.md` names the unit display labels as UI strings (with `fr.ts`), or a
  later plan moves them to `vocab/units.yaml`. For the owner to choose; not
  part of this plan.

### Duplicates: what is easy

- An ingredient set per recipe is one query over `ingredients`, already
  resolved; recomputed from the index on any change, never stored.
- Two recipes that are the same card pasted twice under two titles have (nearly)
  the same resolved set whatever the titles, languages aside.
- The actions after a match exist: family both (W608 pair), trash one (undoable),
  open both.

### Duplicates: what is hard

- **Staples dominate small sets.** Cookies are flour, sugar, butter, eggs,
  baking soda, vanilla + one thing; every dessert shares five of those.
  Plain Jaccard over whole sets calls most desserts near-duplicates; dropping
  staples leaves sets of two or three, where one differing line swings the
  score from 1.0 to 0.5 (Q10, Q11).
- **Sub-recipes.** Flattening every tarte's `pâte brisée` into its set makes
  *tarte au sucre* and *tarte aux pommes* share six lines out of ten (Q10).
- **Unresolved names** (15 % of lines on the bench vault, more on a young real
  vault) are identity by lookup key only; a typo (`beouf`) is then a different
  ingredient. English cards resolve less (plan 03, R1): a French card and its
  English copy may score low until the queue is worked.
- **Versions are not duplicates.** Most high-similarity pairs in a
  Québec card box are the same dish from two aunts: a family, not a mistake.
  The pair view must offer "versions" as well as "same recipe" and "not
  related", and pairs already in one family are expected (Q16).
- **Scale.** 5000 recipes are 12.5 million pairs. A threshold makes candidate
  generation cheap (two sets with similarity ≥ t must share one of their
  rarest elements — prefix filtering over an inverted index), so the whole
  vault is one pass of a few hundred milliseconds, memoised per index state
  like the pantry model.
- **A decision about a pair is precious** (a person looked at both): it cannot
  live only in the cache (→ `STORAGE.md` "The rule") (Q14).
- **The bench vault has no duplicates**: `gen-vault.ts` draws lines at random.
  The bench must plant pairs to measure anything but speed.
- **The corpus has an answer key waiting to be written**: its 320 cards come
  from 57 dish archetypes (`scripts/corpus/dishes.ts`), about 5–6 cards each
  from different "matantes", books and English neighbours. Same archetype =
  same dish. The generator knows each card's archetype; it only has to write it
  down (Phase 0).

## Where it fits in the existing code

- `src/lib/render/scale.ts` — gains the scaled-amount function of Q2–Q4
  (value, unit after the ladder, `approx` flag), given the scaling rules;
  `MULTIPLIERS` stays for recipes without servings.
- `src/lib/render/fraction.ts` — `formatNumber` keeps its behaviour for the
  unscaled display (factor 1); scaled amounts are formatted from the snapped
  value.
- `src/lib/render/ingredient.ts` — `formatAmount` / `ingredientParts` take the
  rules alongside `factor`; the `≈` mark is a part of its own (styled, with a
  French title "arrondi").
- `src/lib/ingredients/units.ts` — `parseConversions` is the model for parsing
  `vocab/scaling.yaml` (a broken or missing file gives today's display, never
  a failed page).
- `src/lib/server/seed.ts` — `seedVocab` / `writeMissingVocab` write the new
  vocab file (`vault init`, `vault ingredients seed`), never overwriting.
- `src/lib/server/pages.ts` and the kitchen `+page.server.ts` — load the rules
  with the page (they are small), as the paste page loads the word lists.
- `RecipeView.svelte`, the recipe page, kitchen mode — the amount in the URL
  (Q1), the ways to set it (Q8), the sub-recipe expansion (Q5), step amounts
  (Q6).
- `src/service-worker.ts` — already caches kitchen pages "under the path alone:
  ?portions … do not make another page"; the recipe page's new parameter must
  not create cache entries either.
- `src/lib/server/index/` — a new `similar.ts`: the duplicate model from the
  index (`indexMemo`), all pairs above the threshold, and "pairs of one recipe
  not yet saved".
- `src/lib/ingredients/similar.ts` (browser-safe, pure): set building rules
  (Q10), the similarity (Q11), candidate generation. Tested without a database.
- `src/lib/server/save.ts`, `paste.ts`, `formsave.ts` — the new warning (Q12)
  beside `unresolvedDiagnostics`: server check, save result, form check.
- `src/lib/vault/codes.ts` (fixer), `src/lib/i18n/diagnostics.ts` (French line,
  `formHintText`), `src/lib/form/hints.ts` (`FORM_HINT_CODES`, the other
  recipe as a link), `docs/VALIDATION.md` (the row).
- A new route for the pair list (Q12), its actions through `trash.ts`, the W608
  pair writer, and `writeAndCommit` for the dismiss file (Q14).
- `tests/fixtures/corpus/` + `scripts/gen-corpus.ts` — the dish answer key.
- `scripts/gen-vault.ts --bench` — planted duplicates, the timings below.

## Module layout (target)

```
src/lib/render/
  scale.ts          # + scaleAmount(q, unit, factor, rules) → { value, unit, approx }; parseScaling
  stepamounts.ts    # amounts found in step text (findAllQtyUnits), scaled per Q6
src/lib/ingredients/
  similar.ts        # recipe → element set (Q10), weights, similarity (Q11), prefix-filter candidates
src/lib/server/
  index/similar.ts  # the model from the index, memoised; allPairs(db), pairsFor(db, recipe)
  duplicates.ts     # dismiss / undismiss a pair (vault file, Q14); the page's actions
src/routes/
  doublons/+page    # the pair list and its actions (Q12, Q13)
docs/VOCAB.md       # + "Scaling" seed block (→ vocab/scaling.yaml), + the dismiss file's shape
```

Adjust names if something reads better. Keep the server/browser split.

## Phases

Commit at the end of each phase with a conventional message. All tests and
`npm run check` pass before each commit. Each phase lists the questions it
depends on and ends with "Done when".

### Phase 0 — answer keys and harnesses (no product code)

Depends on: nothing.

1. **Dish answer key.** `scripts/gen-corpus.ts` also writes
   `tests/fixtures/corpus/expected-dishes.yaml`: slug → dish archetype key
   (`dishes.ts` `key`), for every generated card; the hand cards get theirs in
   `scripts/corpus/` beside their `hand` ingredient ids (a hand card that is no
   archetype's gets its own key). Regenerating must leave every recipe file
   byte-identical (`tests/unit/corpus-fixture.test.ts` already compares) — only
   the new file and the README's section change.
2. **Planted duplicates** (built in the test, never committed as corpus files,
   so plan 03's corpus figures stay as they are): for a fixed sample of corpus
   recipes, (a) the same file under another title and slug, (b) the same with
   its lines reordered and one written form swapped for another of the same id
   (from the answer key), (c) the same with one line removed. Each must be found.
3. **Scaling table** `tests/fixtures/scaling.yaml`: invented cases — `(qty,
   qty_max?, unit, factor) → expected text` — covering every unit class, the
   ladder, halves of counts, ranges, markers, `alt`, and factor 1. Written by
   hand from the answers to Q2–Q4, reviewed by the owner before Phase 2.
4. `tests/scaling-corpus.test.ts` and `tests/duplicates-corpus.test.ts`, their
   bodies filled in Phases 2 and 5. Both run in the normal suite (the corpus is
   public).

Done when: `expected-dishes.yaml` covers all 320 cards and the corpus
regenerates unchanged otherwise; the harness loads it and the planted pairs;
the scaling table exists and the owner has read it.

Built (scaling side), with these decisions:

- **Display baseline.** `tests/fixtures/scaling-baseline.txt`, written once by
  `scripts/gen-scaling-baseline.ts` from the code as it was before this plan:
  every line's parts (kind and text), the servings, the yield, a digest of the
  method's HTML, and every unit word, for the 320 corpus cards and the fixture
  vault. The factor-1 gate compares against this file, not against a copy of
  the old code. Regenerate only for a display change that is meant.
- **Table.** `tests/fixtures/scaling.yaml`: 58 amount cases and 8 whole lines,
  written by hand from Q2 A / Q3 B / Q4 A and the seed of Phase 1. Owner
  reviewed the scaling table 2026-09-30 (issue #13): approved (`≈ ½` for tiny
  counts stays), with two changes — `¾ tasse × 1,5` shows `18 c. à table`, not
  `≈ 1 tasse` (the cup only when it measures the amount: stepping down past
  "as many as make one of the next" is allowed when that next unit is beyond
  the tolerance), and `1 pinte × ⅞` shows `3 ½ tasses`, not `0,88 pinte` (new
  seed rungs `cup → qt` ×4 and `cup → pint` ×2, steps down only, `up: false`,
  so cups never climb into quarts; `vault ingredients seed` adds them to an
  existing ladder, never over a rung into those units). Cases added for both
  (68 amount cases now; there were 64, not 58).

**Built (duplicates side).** `expected-dishes.yaml` is a flat `slug: key` map,
generated; the hand cards’ keys are in `scripts/corpus/hand-dishes.ts` (16 hand
cards are dishes of their own: `chili`, `brownies`, `scalloped-potatoes`, …;
*Relish aux tomates vertes* is `ketchup-vert`, whose own titles include
"Marinade de tomates vertes"; *Salade de pâtes du méchoui* is its own dish, not
the mayonnaise `salade-macaroni`). The planted pairs are built by
`tests/helpers/duplicates.ts`: every 12th card (by slug) with at least 4
counted lines, three copies each. Decisions: a copy drops the card's
`family`/`variant` (a pasted transcription has none, AI-TEMPLATE rule 19; a
copy inside the card's family would be a Q16 family pair, not a paste
mistake); (b) reverses each group's lines and swaps the first line whose id
has another written form **that the vault's resolver maps to the same entry**
(a swap to a form the registry does not know is a resolution miss, measured by
plan 03, not a duplicate-model miss); (c) removes the card's last counted line
(a fixed choice, not the easiest).

### Phase 1 — scaling rules as data

Depends on: Q2, Q3, Q4.

1. **`vocab/scaling.yaml`**, seeded from a new `VOCAB.md` "Scaling" block: the
   fractions each unit (or unit class) may show, the snapping tolerance, the
   restating ladder (Q3), metric rounding steps (Q2), what counts and containers
   snap to (Q4). Illustrative shape, the answers decide the content:

   ```yaml
   tolerance: 0.1               # snap within 10 %; beyond it, the next rule
   fractions:                   # what a scaled amount may show, per unit or class
     cup: [1/4, 1/3, 1/2, 2/3, 3/4]
     tbsp: [1/2]
     tsp: [1/8, 1/4, 1/2]
     count: [1/2]
     container: [1/2]
     default: [1/4, 1/3, 1/2, 2/3, 3/4]
   ladder:                      # kitchen equivalences, not the cost factors
     - { unit: tsp, into: tbsp, per: 3 }
     - { unit: tbsp, into: cup, per: 16 }
     - { unit: g, into: kg, per: 1000 }
     - { unit: ml, into: l, per: 1000 }
   metric:                      # g and ml: round to this step from this amount up
     - { from: 0, step: 1 }
     - { from: 100, step: 5 }
     - { from: 1000, step: 25 }
   ```

2. `parseScaling(data)` in `render/scale.ts`, browser-safe; only canonical units
   and classes, positive numbers, known fractions are kept. **A missing or
   broken file gives today's display exactly** (the 2 % glyph rule, decimals),
   never an error on a recipe page.
3. `vault init` writes it; `vault ingredients seed` adds it to an older vault
   (`writeMissingVocab`), never overwriting. The file watcher already watches
   `vocab/` and commits it as `edit (external): <path>`; pages read it per
   load (it is a few hundred bytes).
4. `STORAGE.md` layout gains the file; `VOCAB.md` gains the block and its rules.

Tests: parse (good, partial, broken, missing → today's behaviour); the seed
block parses to exactly what `vault init` writes.

Done when: a new vault and a seeded older vault both hold `vocab/scaling.yaml`;
the recipe page and kitchen page receive the rules; nothing displayed changes yet.

Built, with these decisions:

- **Seed content** (`VOCAB.md` "Scaling"). Beyond the illustrative shape:
  `approx: 0.02` (the ≈ threshold, data too); `factor: { min: 0.1, max: 20 }`
  (Q8's cap); `tsp` gains ¾ (cards write it); `lb: [1/4, 1/2, 3/4]`; `kg` and
  `l` whole only (so `500 g` never becomes `½ kg`); `pinch`, `drop` whole;
  `metric` names its units (`g`, `ml`) beside the steps. **`always`** lists the
  units and classes that snap whatever the distance (cups, spoons, pinches,
  drops, counts, containers): without it the Phase 2 gate "no decimal on a cup
  or spoon line" cannot hold at 10 % (a ¼ tsp at ×⅔ is 33 % from any spoon), and
  Q4 A's "halves" for counts is a snap whatever the distance. The 10 %
  tolerance then governs the other units (`lb`, `oz`, `qt`…), which show a
  short decimal beyond it, as Q2 A says.
- **Partial file.** A mapping keeps every entry that reads; missing numbers get
  the seed's (`tolerance` 0.1, `approx` 0.02, the cap); a unit with no
  fractions entry (own, class or `default`) shows its exact value as before.
  Not a mapping → `null` → today's display.
- **Unit words** move to `vocab/unit-labels.yaml` (`VOCAB.md` "Unit labels"):
  `unit: { fr: word | [singular, plural], en: … }`. `piece` has no word and is
  not in the file (a bare count is the schema's, not a region's). The plural
  rule (French from 2, English above 1) stays code: grammar, like `fr.ts`. The
  words reach the browser through the root layout, which installs them in
  `render/unitwords.ts` before any page renders (server and browser): every
  caller of `unitLabel` (ingredient lines, money, the form, the ingredient
  page) keeps its signature. A unit without a word shows its code. `vault
  ingredients seed` adds the file, or only the units and languages an older
  copy lacks, never rewriting a word (as tag labels, plan 04 #11).
- Tests run with the seed words installed (`tests/setup/unit-words.ts`);
  `tests/unit/scaling-rules.test.ts` covers a vault without them.
- `STORAGE.md`: layout gains both files; "the code holds no word…" now says
  "beyond the canonical unit list and the UI strings of `fr.ts`".

### Phase 2 — the scaled amount

Depends on: Q2, Q3, Q4, Q7.

1. `scaleAmount`: exact value × factor → the ladder (Q3) → snap to the unit's
   fractions within the tolerance (Q2) or the metric step → `{ value, unit,
   approx }`, `approx` when the shown value differs from the exact one by more
   than 2 % (Q2). Counts and containers per Q4. Only within the written unit's
   class; never mass ↔ volume, never through a density.
2. `formatAmount` / `ingredientParts` use it for `qty`, `qty_max`, `alt`, `or`
   amounts and the yield object; `≈` as its own part. The unit word follows the
   shown amount (`1 tasse`, `2 tasses`, via `unitLabel`).
3. **Factor 1 is exact**: no snapping, no ladder, no `≈` — the display of every
   corpus and fixture line at factor 1 equals today's, character for character.
4. **Ranges**: both ends scaled; equal after snapping → one value.
5. **Servings and yield** per Q7: the servings range scaled with the factor; a
   text yield's leading number scaled if Q7 says so.
6. Untouched, with a test each: `to_taste`, no-`qty` lines, `note` (a can's
   size), `prep`, markers after the number, the oven, times, timers.

Tests: the Phase 0 table; `alt` and main amount rounded separately (and within
the tolerance of each other); ranges collapsing; a marker after a scaled
number. Corpus sweep (`tests/scaling-corpus.test.ts`): every line of the 320
cards at factors ½, ⅔, 1, 4/3, 1.5, 2, 3 — at 1 identical to today; otherwise
every shown value within the tolerance of the exact one (or flagged `≈`), no
decimal on a cup or spoon line, no fraction outside the unit's list. Counts of
`≈`, ladder moves and decimals per unit class are printed for the report.

Done when: the table passes, the corpus sweep holds, factor 1 is byte-identical.

Built (`scaleValues` in `render/scale.ts`, `amountView` / `formatAmount` /
`ingredientParts` in `render/ingredient.ts`), with these decisions:

- **Choosing the unit.** Q3 B read literally ("step up when the amount reaches
  the next unit's smallest fraction") turns `6 c. à table` into `0,38 tasse`,
  which breaks the "no decimal on a cup line" gate. So each eligible unit is
  tried and ranked: exact (≤ 2 %) before rounded within the tolerance before
  snapped beyond it (`always` units) before a decimal; among exact results the
  largest unit, otherwise the closest. Up: from the rung's `from` (new, data:
  `tsp → tbsp` from 1, so `1 ½ c. à thé` stays), else the larger unit's
  smallest value. Down: below the written unit's smallest value, or when
  nothing is within the tolerance; never to as many of the smaller unit as make
  one of the next (`8 c. à thé` → `≈ 2 ½ c. à table`) — unless that next unit
  is beyond the tolerance too (owner, 2026-09-30: `18 c. à table` of a written
  `¾ tasse × 1,5` stays tablespoons; it showed `≈ 1 tasse` before). A range
  is ranked on its worse end, one unit for both.
- **Seed additions** from the sweep: `oz → lb` (16) on the ladder and
  `oz: [1/2]`, so `¼ lb × ⅔` shows `≈ 2 ½ oz` rather than `0,17 lb`. Imperial
  never reaches grams.
- **`≈`** is its own part (`kind: 'approx'`), rendered as an `<abbr>` titled
  « Arrondi … »; inside `alt` and `or` it is part of the text. Plain-text
  outputs (`formatAmount`, `ingredientText`) write `≈ ` before the amount.
- **Q7.** Servings: both ends × factor (`formatNumber`), shown with markers at
  every factor (they were hidden once scaled). Text yield: a leading plain
  number or fraction scaled as a count (halves, `≈`), the rest kept; a range
  (`2 à 3 douzaines`) or no leading number shows as written with `(× f)`.
  Known limit: the word after the number keeps its written number
  (`1 moule` × 2 → `2 moule`).
- **Sweep** (seed rules, 2807 amounts × 6 factors, ~0.1 s): counts ≈ 903 of
  3192, containers ≈ 324 of 972, mass ≈ 166 / ladder 157 / decimal 10 (`lb`,
  `oz` beyond the tolerance), volume ≈ 1735 / ladder 1117 / decimal 14
  (`qt`, `pint`, `cl`; none on a cup or spoon). 20 125 lines render in
  ~130 ms (≈ 6 µs a line: a 60-line recipe well under 1 ms).

### Phase 3 — setting the amount

Depends on: Q1, Q8.

1. **State** per Q1: the amount in the recipe page's URL (`?portions=8` or
   `?fois=1.5`, as the kitchen link already writes it), updated with
   `replaceState` as she taps, read on load; kitchen mode's `localStorage`
   session unchanged (a resume keeps what was set there, the parameter still
   wins when present, → the existing comment in `load()`).
2. **Ways in** per Q8: the stepper; tapping an ingredient's amount to type "j'ai
   3" (factor = typed / written, from the lower bound of a range; a line with
   no `qty`, `to_taste` or a count of zero is not tappable); a free factor for
   recipes with servings too. "Réinitialiser" returns to the card's amount.
3. Print and the cost line keep following the factor (they already do); the
   print shows the chosen servings and `≈` marks.
4. The service worker still caches kitchen pages under the path alone; the
   recipe page's parameter adds no cache entry.

Tests: URL round trip (load with `?portions=8`, tap +, reload → 9); a bad
parameter (`?portions=0`, `?fois=abc`, `?portions=1e9`) is ignored with a cap
(Q8); scale by an ingredient in a range and in `alt`; no request other than the
page load leaves the browser when scaling. E2E (phone, tablet): scale on the
recipe page, open kitchen mode, same amounts; reload both; `git` HEAD and every
vault file unchanged afterwards.

Done when: the amount survives reload and sharing, and can be set from any
ingredient (per Q8).

Decisions (done): one `factor` replaces the page's `servings`/`multiplier`
pair, on the recipe page and in kitchen mode. The page reads it with
`factorFromParams` (`?portions=` wins when the recipe has servings, then
`?fois=`; digits only, so `1e9`, `0x10` and signs are ignored; outside the
file's `factor` cap is ignored) and writes it back with `replaceState`
(`amountQuery`: `portions` when the servings come out whole, else `fois` with at
most 4 decimals; nothing at factor 1). `page.url` is not updated by
`replaceState`, so the page compares against `location.href`; the factor is
re-read on a new slug or a real navigation. The stepper goes to the next whole
number of servings (from 7,5: + gives 8, − gives 7) inside the cap. "Autre
quantité" takes a free factor on every recipe; a recipe without servings also
lists the current factor in its select when it is not one of the multipliers.
"Remettre" shows whenever the factor is not 1 (the button already existed under
that name, so it was kept rather than renamed "Réinitialiser"). A tapped amount
(main or `alt`, from the lower bound; not `to_taste`, not zero) opens « La
recette demande … J'en ai : » under its line; errors say what to type or the
cap. "recette × f" shows on screen when the servings are not whole, and always
in print. The paste preview has no tapping and no free factor. Kitchen mode
stores `factor` in its session and still resumes an older session's `servings`
or `multiplier`; the page's parameter still wins, then is dropped from the
address. UI numbers (the cap, "recette × f") are in French whatever the
recipe's language. The kitchen e2e amount after + is now `935 g` (metric step
5 from 100 g), was `933 g`.

Tests: `tests/unit/scale.test.ts` (address in and out, typed amounts);
`tests/e2e/scaling.spec.ts` (desktop: reload, bad parameters, tapping, free
factor and cap, print, no request, file, HEAD and `git status` unchanged);
`tests/e2e/kitchen-scaling.spec.ts` (phone and tablet: stepper, kitchen opened
scaled, an older session). Vitest 1651 passed, 1 skipped; svelte-check 0
errors; e2e 120 passed, 3 failed in `resolve-queue.spec.ts` (desktop; not
touched by scaling, not investigated — the owner's reboot came first).

Stopped here (reboot). Next: Phase 4 (sub-recipes per Q5 A with
`subRecipeFactor × factor` in kitchen mode and `?fois=` on the recipe page's
sub-recipe link; `src/lib/render/stepamounts.ts` for the scaled step amount
beside the original per Q6 B, in kitchen `pieces()` and the recipe page
markdown; the times/oven/pan notice), then record Q1 and Q5–Q9 in the docs
(DATA-FLOW.md), then check the `resolve-queue.spec.ts` failures. (Phase 4
and the docs: done, below; the `resolve-queue.spec.ts` failures were fixed by
`a67ef64`.)

### Phase 4 — kitchen mode: sub-recipes and step amounts

Depends on: Q5, Q6.

1. **Sub-recipes** per Q5: the inline expansion scaled by `line amount ×
   factor / yield` when the sub-recipe's `yield` object is in the line's unit
   or class (the cost rule, `cost.ts`, shared rather than copied); otherwise
   shown as written with its yield ("recette complète : donne 2 abaisses").
   The recipe page's sub-recipe link carries the derived amount when scalable
   (`/r/pate-brisee?fois=0.5`).
2. **Step amounts** per Q6: amounts found in step text with the vocabulary's
   unit words (`findAllQtyUnits`, `lang`-aware for `t`/`T`), shown per the
   answer; temperatures, durations and pan sizes never touched (they use no
   recipe unit). The timers keep reading the original text.
3. **Notice** per Q6 when the factor is not 1 (times, oven, pan).

Tests: sub-recipe at ×1 (one crust of two → the half pastry), ×2, a text yield,
a mismatched unit, a cycle guard; step amounts in French and English cards
(`1 t. de lait` French cup, `1 T sugar` English tablespoon), not touching
`350 °F`, `25 min`, `9 x 13`, `2 L` of a bowl (flagged if Q6 B: shown beside the
original, never replacing it). Corpus: every step of the 320 cards scanned;
count of amounts found and of amounts inside a sentence about a pan or a
temperature, printed for the report.

Done when: a scaled tarte in kitchen mode shows its crust at the right amount
or says why not, and no step shows an amount that contradicts the scaled list
without saying so.

**Built** (`subRecipeScale` / `subRecipeHref` in `render/scale.ts`,
`render/stepamounts.ts`, the `scale` option of `render/markdown.ts`), with
these decisions:

- **Sub-recipes.** `subRecipeScale` = `subRecipeFactor` (cost.ts, unchanged
  rule, its parameter narrowed to `yield`/`servings`) × factor, kept inside the
  file's cap (outside it: as written). Like cost it reads the line's upper
  bound of a range. Kitchen mode shows « recette × ½ » beside the expanded
  title when the factor is not 1; unscalable → as written with « Recette
  complète : donne 2 litres » (the yield, else the servings). The recipe page
  gets `subScale` (each directly used sub-recipe's yield and servings, and the
  conversions) and the link carries `amountQuery(sub, f)` (`portions` when the
  sub-recipe's servings come out whole, else `fois`; nothing at 1). The link
  changes at ×1 too (`/r/pate-brisee?fois=0.5`), as Q5 intends; the line's
  text does not. The expansion stays one level deep (no recursion, so no cycle
  to guard beyond `loadSubRecipes`'s own; nested since issue #13, below); the
  sub-recipe's own steps show their amounts at its factor.
- **Step amounts.** Only `mass` and `volume` units: counts and containers in a
  step are more often shapes (« couper en 8 tranches », « en 2 abaisses »), and
  the per-step ingredient line already shows the scaled count. A range written
  `2 à 3 tasses` / `2-3 cups` scales as one amount (issue #13: not after a
  label word — « Étape 1 - 2 tasses » is `2 tasses`; *étape*, *step*, *n°*,
  *no.*, *numéro*, `#`). Marked inside the method's
  step lists only (the lists `stepLists` tags; notes and variants untouched),
  after the original as `<span class="step-scaled"> → 2 tasses</span>`; in
  kitchen mode inside the text between the timer buttons (the timers still
  read the original). Emphasis or a marker splitting an amount's text leaves
  that amount unmarked (best effort; issue #13: now marked, below). ⚑ A size in a step (« la boîte (796 ml) »,
  « un bol de 2 L ») is found and scaled beside the original, as Q6 B accepts.
- **Notice** « Recette × f : les temps, la température du four et la taille du
  moule restent ceux de la recette de base. », plus « Dans les étapes, la
  quantité ajustée suit la flèche (→) » when a step holds an amount: above the
  method (when it has steps, times or an oven; printed too) and on the kitchen
  step.
- **Fixtures.** *Crêpes minces* step 1 now writes « 1 ½ tasse de lait » and
  *Molasses Cookies* step 3 « 2 T sugar » (the fixture vault had no amount in
  any step); the baseline was regenerated with the code before this phase —
  only those two body digests changed.
- **Leftovers of Phase 3, decided.** ⚑ Names are not pluralized when scaled
  (`2 oignon`, text yield `2 moule`): the file holds one form of the name, the
  docs define no plural, and adding endings is a noun grammar per language
  (`VOCAB.md` "Plurals" only strips them) — recorded in `DATA-FLOW.md`,
  "Scaling", for the owner. `money.ts`'s `pièce/pièces`: `piece` now has words
  in `vocab/unit-labels.yaml` (`VOCAB.md` seed), shown only where a count needs
  a word (`unitWord`, a pack size); ingredient lines keep the bare count
  (`unitLabel`). `render/steps.ts`'s `s`/`x` stem: the step-name matching uses
  the vault's plural rule (`vocab/normalize.yaml`, the resolver's own, loaded
  by the kitchen page for the recipe's `lang`) rather than the unit-labels file
  — it is about ingredient names, and that data already exists; without the
  file, names match as written. ⚑ `UNIT_ALIASES` stays in code: `STORAGE.md`
  keeps "the canonical unit list" in code, `VOCAB.md` "Units" makes that list
  the authority that must match `AI-TEMPLATE.md` rule 8, and the seeded
  `vocab/units.yaml` says it only documents the vault. Moving it would make the
  checker vault-dependent (E201 on a loose file); raised, not changed.

Tests: `tests/unit/stepamounts.test.ts` (French and English units, `t`/`T`,
ranges, nothing on °F / °C, minutes, `9 x 13`, counts; the bowl flagged; factor
1 identical; escaping; 30 steps; sub-recipe ×1 / ×2, class conversion, text
yield, mismatched class, no amount, the cap); corpus: every step of the 320
cards scanned — 3 amounts in 2 of 1472 steps (all `cup`), none in a sentence
about a pan, a bowl or the oven, none a temperature, duration or pan size
(~35 ms). The factor-1 gate now renders the method with the step option on.
E2E: steps scaled beside the original with the notice (desktop), the
sub-recipe link's factor (desktop), the kitchen expansion at ½ / 0,56 / whole /
text yield and kitchen step amounts (phone, tablet).

**Issue #13 (scaling leftovers).**

- *Step or item numbers.* « Étape 1 - 2 tasses » read as the range « 1 à 2 ».
  A number after a label word (*étape*, *step*, *n°*, *no.*, *numéro*, `#`)
  is never the low end of a range: the amount is `2 tasses`. Without such a
  word a spaced dash still reads as a range (« 2 - 3 tasses »): nothing else
  tells the two apart, and the range is what cards write.
- *Amounts split by emphasis or a marker.* The step's inline tokens are read
  in runs — text, emphasis (`**`, `*`, `~~`) and the markers that qualify a
  word (`[?]`, `[?: …]`, `[+]`) — as the text they show, so « 1 **tasse** »,
  « **1** tasse », « 1 [?] tasse » and « **2** à 3 *tasses* » are marked. The
  scaled value goes after the amount's last character, past the closing tags
  of emphasis opened inside the amount (`1 <strong>tasse</strong> → 2
  tasses`). Safe for the markup: only text tokens are split and only the
  escaped `stepAmountHtml` is added; raw HTML stays off (`html: false`).
  `[illisible]` (it may hide part of the number), code, links and line breaks
  end a run: an amount across them stays unmarked. The « → » notice now reads
  the rendered steps, so it follows the same rule.
- *Nested sub-recipes in kitchen mode.* A sub-recipe's lines that use a
  sub-recipe get their own « Voir la recette », opening inside the expansion
  (a recursive snippet), each level at `subRecipeScale(line, sub, conv, factor
  of the level above)` — the cost rule per level, so the factors multiply; a
  level the rule cannot scale shows as written and counts as ×1 below it; each
  level inside the `factor` cap. `canOpenSub`: never a slug already on the
  path (a cycle cannot be saved, but a hand-edited vault could hold one), at
  most `SUB_RECIPE_DEPTH` = 4 levels. Open state is keyed by position, so the
  same sub-recipe used in two places opens separately. `loadSubRecipes` now
  walks level by level (breadth first) to the same depth: depth-first with one
  `seen` set, a recipe reached deep first had its own sub-recipes cut off.

### Phase 5 — the duplicate model

Depends on: Q10, Q11, Q16.

1. **Element set** of a recipe (`similar.ts`) per Q10: from its index rows —
   which lines, which identity (`item`, else `k:<key>`), sub-recipes as one
   element or flattened, `or`, optional, `to_taste`, staples.
2. **Similarity** per Q11, with the weights computed from the vault itself
   (document frequency of each element, recomputed with the model) if Q11 says
   so — no list of "common ingredients" in code or data.
3. **Candidates**: inverted index element → recipes; prefix filtering on the
   rarest elements for the threshold; exact similarity only on candidates.
   Minimum set size per Q10 (a two-line recipe never pairs).
4. **Model** in `index/similar.ts`, built from the index and kept per index
   state (`indexMemo`), like the pantry model: `allPairs(db)` (sorted by
   similarity, with the elements shared and those only in each) and
   `pairsFor(db, recipe, slug?)` for a recipe not yet saved (the paste or the
   form), using the resolver on its lines as `unresolvedDiagnostics` does.
   Pairs in the dismiss file (Q14) and same-family pairs per Q16 are left out.
5. **Tune the threshold on the corpus** (`tests/duplicates-corpus.test.ts`):

   | Id | Measure | Gate |
   |---|---|---|
   | D0 | planted pairs (Phase 0.2) found | **100 %** |
   | D1 | precision: flagged pairs whose two cards share a dish key | ≥ 90 % |
   | D2 | recall: same-dish pairs flagged (French–French, and any language) | report |
   | D3 | the 20 highest-scoring different-dish pairs, with their shared elements | report |
   | D4 | pairs flagged per 100 recipes | report (the page's size on a real vault) |

   Record the threshold (and the similarity's parameters) in `INGREDIENTS.md`.
   `PLANNING.md`'s "~0.8" is the starting point, not the answer.

Tests: set building per Q10 on invented recipes (staples, sub-recipe, `or`,
optional group, unresolved, a two-line recipe); similarity arithmetic; prefix
filtering finds exactly the pairs a brute-force pass finds (a 300-recipe
generated vault, every pair checked both ways); dismissed and same-family pairs
out; the model is rebuilt after a save and after a registry edit (a queue
"Relier" can create a pair).

Done when: D0 = 100 %, D1 ≥ 90 % at the recorded threshold (or a report of why
not, with the pairs that break it), and brute force equals the fast path.

**Built.** Threshold **0.65**, weights `ln(1 + N/df)` (not `ln(N/df)`: an
element in every recipe keeps a small positive weight, so a set is never
weightless), recorded in `INGREDIENTS.md`, "Duplicates". Corpus at 0.65: D0
100 % (78 planted copies of 26 cards; the worst, a copy missing its last line,
scores 0.699), D1 97.2 % of 213 flagged corpus pairs, D2 recall 27 % (French–
French and any language alike), D4 66.6 pairs per 100 recipes. The gates hold
from ~0.58 (D1 = 90 %) to 0.699 (D0); 0.65 sits inside with margin on both.
D3's top different-dish pairs are dessert batters on one syrup (*grands-pères*
/ *pouding chômeur*, 0.68), *cretons* / *tourtière* (same spices), two Jell-O
desserts, chili / *riz espagnol*. Decisions: the model is keyed per index state
by `indexMemo` (the pantry model has its own copy of that key); dismissed pairs
(Q14) are filtered per read, not in the memo, since `vocab/distinct.yaml` can
change without an index write; `pairsFor` scores an unsaved recipe against the
vault's weights (an element the vault does not use yet weighs as df = 1).
5000 generated recipes: build ~0.2 s, `pairsFor` ~0.3 ms median — but 74 580
pairs, because `gen-vault.ts` draws 4–11 lines from ~30 common words: the
generated vault says nothing about the page's size on a real vault (Phase 8's
planted-pair bench is for the scaling agent or a later session).

### Phase 6 — the warning on paste and form

Depends on: Q12.

1. **A new code** per Q12 (proposed `W505`, `app`: the AI cannot see the
   vault): "ingredients close to <other recipe> — possible duplicate", with
   the other slug(s) and the share of ingredients in common. Computed by
   `pairsFor` in the server check (`/api/check`), the form's check
   (`/api/form/check`) and the save result, beside `unresolvedDiagnostics`;
   never in the browser-only check, never in the fix-request block.
2. **Paste box**: listed with the other `app` codes, the other recipe linked;
   "Mettre en famille" offered as for W608.
3. **Form**: a hint (Q9 A of plan 04), the other recipe as a link that opens in
   a new tab, and "En faire deux versions" (the existing W608 pair offer).
   Never blocking.
4. The code's row in `VALIDATION.md`, its fixer in `codes.ts`, its French line
   in `diagnostics.ts`, its entry in `FORM_HINT_CODES` / `formHintText` — the
   existing tests fail on a code missing any of these.
5. Not on the recipe page (Q12): the pair list is where settled pairs are
   handled.

Tests: paste a planted duplicate → the code with the right slug; paste the same
file over itself (`E103` "Remplacer") → no self-pair; the form shows the hint
and "En faire deux versions" commits both; a dismissed pair gives no warning;
the warning never enters the fix-request block.

Done when: pasting any planted duplicate warns, in the paste box and the form,
and nothing else changes on those paths.

**Built.** `W505` (`app`), `src/lib/server/duplicates.ts`: `closeRecipes`
(at most three other recipes, settled pairs left out, each with its file hash)
and `duplicateWarnings` (one diagnostic on `ingredients` naming each slug and
its weighted share). Wired beside `unresolvedDiagnostics` in `serverCheck`, in
`saveLocked`'s result and in `formCheck`, which also returns `close` (the same
shape as `same`), so the form's "En faire deux versions" is the W608 pair offer
unchanged (`makePair`). Decisions: the recipe's own slug is always left out
(an edit, a paste over itself, a save over itself); the save result's W505 is
against the vault before that save; on the paste page the offer is the W608
checkbox with its own line and the other recipes linked, the family defaulting
to the other recipe's family when it has one (in P1 the paste path families
only the pasted recipe, as for W608; the form path families both); the form
shows the first close recipe not already offered by title. Two recipes put in
one family whose ingredients and amounts are identical stay a pair (Q16 C) —
the right answer there is "C'est la même recette".

### Phase 7 — the pair list and its actions

Depends on: Q12, Q13, Q14, Q15.

1. **Page** per Q12/Q15 (proposed `/doublons`): pairs by similarity, 20 at a
   time, each with both titles, sources, family, status, the ingredients in
   common and those only in each (the family diff table's shape), a W503/W608
   mark when the titles are near too, and "Comparer" opening both recipes side
   by side (the stale-compare layout of the form, read-only).
2. **Actions** per Q13, each one commit by the signed-in person through existing
   writers: "Deux versions de la même recette" (family both — the W608 pair
   writer, family picker as in the form), "C'est la même recette" (the one she
   picks to the trash, `delete:` — undoable from `/corbeille`), "Recettes
   différentes" (dismiss, Q14). Each hash-guarded on the files it touches.
3. **Dismiss** per Q14: the pair written to the vault file, sorted, one line
   per pair, edited as text; commit `duplicate: <a> ≠ <b>`; "Annuler" reverses
   it. A trashed or renamed-by-hand recipe leaves its lines harmlessly
   (a pair with a slug not in the vault is ignored); `vault check --dir`
   reports such lines as stale, nothing more.
4. **Nav** per Q15.

Tests: each action is one commit touching only what it names; stale hash
refused; dismiss survives deleting `cache/`; undo of each action; a dismissed
pair disappears from the page and from W505. E2E (desktop and tablet): open the
page on the fixture vault with a planted pair, compare, "Deux versions", the
family page shows both.

Done when: every pair on the page can be settled in one tap plus a confirm, and
a settled pair never comes back unless the recipes change per Q14.

**Built.** `/doublons` (`src/routes/doublons/`), the writers in
`src/lib/server/duplicates.ts`, "Comparer" at `/doublons/comparer?a=…&b=…`
(the form's `compareForms` table, read-only), "Doublons (N)" in the nav for a
Markdown account while N > 0 (counted only for that account). Decisions:

- "Deux versions" is its own writer over a new `editRecipesLocked` in
  `save.ts` (several recipes, each hash-guarded and checked, one commit
  `edit: <a>; edit: <b>`, a family label in the same commit only where the
  family has none) — the W608 pair writer (`pairEdit`) only edits the *other*
  recipe of a form save. Family offered: the one either recipe is in, else the
  first title's slug with that title as its label; both variants required and
  distinct (E105); existing variants prefilled. A pair already in one family
  (identical sets and amounts, Q16 C) shows no offer — "C'est la même recette"
  is the answer there. Undone by `undoCommit` (two edits + families.yaml is a
  shape it already reverts).
- "C'est la même recette": `remove()` of the one she does not keep (a radio,
  default: keep the first), `delete: <title>`; undone by `undoCommit`, which
  restores through the trash.
- "Recettes différentes": `vocab/distinct.yaml` is not seeded (created with a
  header comment by the first dismiss); edited as text, comment lines kept,
  pair lines rewritten sorted, parsed back before the write; hash-guarded on
  the file. Its "Annuler" is `undismissPair`, commit `undo: duplicate <a> ≠
  <b>` — `undoCommit` stays recipe-only (it refuses a vocab-only commit as
  `unsupported`).
- "Annuler" is a form in the page's message (works without JavaScript), not
  the toast: the action's result carries the commit (or the pair).
- `vault check --dir` prints the file's pair count and its stale lines (a slug
  no longer in `recipes/`), no code, never an error.
- E2E runs on a phone (Pixel 7, like `/etiquettes`) rather than desktop and
  tablet; the four actions are in the guard spec's signed-out list.

**Review fixes (duplicates).** From the one end-of-work review:

- ⚑ **Flagged — "C'est la même recette" and sub-recipes** (the docs left it
  open). Chosen, the safest: a recipe another recipe uses as a sub-recipe is
  **never sent to the trash from `/doublons`** — each side lists "Sert de
  sous-recette dans …"; the radio defaults to trashing the side nobody uses and
  the used side cannot be picked; when both are used the action is not offered
  ("changez d'abord ces recettes"); `sameRecipe` refuses it server-side too.
  Not chosen: repointing the linking recipes to the kept one in the same
  commit (a bigger writer), or a confirm that lets her break the link. For the
  owner to revisit; the recipe page's own delete still only shows `usedBy`.
- The form's W505 hint shows whatever the family (a copy put in the wrong
  family is the case it is for); only "En faire deux versions" needs no family.
- A paste whose slug is taken (`E103`, its only error) gets its close recipes
  as a new file would ("Enregistrer comme"): the recipe it collides with left
  out, that recipe's settled pairs not applied. Only `close` (shown unless she
  picks "Remplacer"), no W505 line. Before, a colliding file had no recipe and
  so no close list at all.
- "Deux versions": the variant is prefilled and written as in the file,
  markers kept; a posted variant equal to the file's as read leaves the file's
  text. "Annuler" names a recipe the commit wrote (`editRecipesLocked` returns
  `slugs`), not always the first of the pair.
- `vocab/distinct.yaml`: a slug YAML would read as something else (`1905`,
  `null`, `1e5`) is written double-quoted; a hand-written line that looks like
  a pair but does not read as one is kept as written. `vault check --dir` says
  when the file does not parse or is not a list (its pairs ignored) rather than
  "0 pairs"; still no code, never an error.

**Where it stopped (reboot).** Green: `npm test`, `npx svelte-check`, and
`doublons.spec.ts` + `guard.spec.ts` run alone. The full `npm run test:e2e` was
not run after Phase 7 (the scaling session held the e2e port). Next: run the
full e2e suite; then Phase 8 (bench with planted pairs on the pair list and
`pairsFor`, report). Leftovers: two copies inside one paste batch are not
compared with each other (W505 checks against the vault only); the paste
path's "Mettre en famille" families only the pasted recipe (as W608 in P1),
the form path and `/doublons` family both.

### Phase 8 — bench, docs, report

1. **Bench** (`scripts/gen-vault.ts --bench`, extended): the generated vault
   gets ~50 planted duplicate pairs (copies with a new title, reordered lines,
   one line changed) and ~20 family groups of close variants; the speed targets
   below; D0 on the planted pairs at 5000 recipes.
2. **Docs**, each answer in the doc its question names, plus: `PLANNING.md`
   (P3 scaling built; Tier 2 duplicates built), `VOCAB.md` ("Scaling"; the
   dismiss file), `STORAGE.md` (layout), `DATA-FLOW.md` (scaling in the browser,
   nothing written; the duplicate model and page; the figures),
   `INGREDIENTS.md` (the similarity and its threshold; the "Shopping cost"
   paragraph and `PLANNING.md` "Cost" reworded now that the shopping list is
   declined — consumed cost is the only figure), `VALIDATION.md` (the new
   code), `README.md` (pages).
3. The one end-of-work review (decision 3); leftovers become GitHub issues.

Done when: the targets are measured and recorded, and every answered question
is in its doc.

**Built (bench and docs; the review ran separately).**

- *Ingredient mix.* Phase 5 found the generated vault meaningless for pairs:
  every line drew from ~30 common words, and 5000 recipes gave 74 580 pairs.
  `gen-vault.ts` now draws each recipe's names from one of 1200 invented dish
  archetypes, picked with a long tail (weight 1 / (rank + 30): a few dishes with
  dozens of cards — the largest 78 —, most with one to three; 905 used). An
  archetype is sweet (45 %) or savoury: 2–5 flavour names drawn, long-tailed,
  from the seed registry's first French names by category (`when:` entries
  left out), half the time an invented registry entry, then 2–5 staples of its
  kind; a card keeps each with p 0.8 and fills its lines with extras. The old
  ING words as cards write them (*patates*, *tomates*, *bœuf haché*) head each
  list, so the resolve queue still has plural and ambiguous forms. Flavours
  come first in the archetype: the first try listed staples first, so a 4-line
  card kept only staples and unrelated dishes paired at 1.0 (precision against
  the archetypes 61 %; 97 % after). All of it from a **second PRNG**: the main
  one keeps its exact call sequence (the invented-entry draw is still made,
  unused), so titles, families, amounts, units, tags, times, prices and the
  history are drawn as before; only the names on the lines changed. **Break
  with plans 03/04:** the resolution mix (unresolved or ambiguous 9.5 % of rows,
  15 % before), the most used entry (*beurre*, 1154 recipes, not *cheddar*,
  882) and the pantry results differ; the timings of those paths are within
  their earlier ranges.
- *Planted pairs* (`--bench`, or `--plant`; a plain `gen-vault.ts N` still
  writes exactly N recipes, as `tests/server/duplicates.test.ts` expects): 50
  copies of recipes with 6+ lines and 10 of 4–5 lines, at a fixed stride, each
  with a new title and slug, no family, its lines reversed, and in turn one
  line's amount changed, its ingredient replaced by another of the dish's
  kind, or the line removed; 20 families of three close variants (one
  archetype, all of its core, one extra line each). Second PRNG only.
- *Bench* (`benchPlan05`, after the plan 04 part: the vault has ~20 000
  commits): the 60-line recipe and the 30 steps are invented (every unit class,
  ranges, `alt`, `or`, a marker, `to_taste`; amounts, °F, minutes, a pan size,
  a bowl); the corpus sweep is `tests/helpers/display`'s, as the test runs it;
  the page loads call `loadRecipePage` and the kitchen load's own calls, and
  time plan 05's share apart; the duplicate model is rebuilt by a write to the
  index's `meta` table. The generator's archetypes give the pair list a
  precision and recall of its own, printed beside D0.
- *No `src/` change.* No target is missed by a margin that matters (below).
- *Docs.* `DATA-FLOW.md` (W505 in the paste box, the form and the warnings
  list; the used-sub-recipe rule of "C'est la même recette"; "Final figures for
  P3"; the P2 table's retag row, stale since `6e8ee04`), `INGREDIENTS.md`
  (consumed cost the only figure; the bench's duplicate figures),
  `PLANNING.md` (Cost; 5000 recipes' duplicates; P3 scaling built; Tier 2
  duplicates built), `VOCAB.md` (a stale example, below), `README.md` (pages,
  `vault ingredients seed`, `vault check --dir`, the bench). `STORAGE.md`,
  `VALIDATION.md`, `RECIPE-SCHEMA.md` were already current.

## Speed targets

Measured on the generated 5000-recipe vault on this machine; recorded in the
final report and in `DATA-FLOW.md` next to the plan 02–04 figures. Scaling is
browser code, timed in Node on a desktop CPU (a tablet ~10× slower must stay
under a frame).

| Operation | Target | Why | Measured (Phase 8) |
|---|---|---|---|
| rescale and reformat every line of a 60-line recipe (rules parsed once) | < 1 ms | one tap on the stepper on a mid-range tablet | **0.16 ms** (median of 500 taps over six factors); parsing the rules 0.5 ms, once per load |
| scan every step of a 30-step recipe for amounts | < 1 ms | per factor change in kitchen mode | **0.96 ms — at the target** (30 invented steps holding 45 amounts; the corpus has 3 amounts in 1472 steps); rendering the whole scaled method 1.2 ms |
| corpus sweep: 320 recipes × 7 factors | < 2 s | the test stays in the normal suite | **0.41 s** (lines and method); `tests/scaling-corpus.test.ts` 1.2 s in vitest |
| recipe page / kitchen page server load | unchanged ± 2 ms | the rules file is one small read | **2.0–2.4 ms / 0.15–0.2 ms**, of which plan 05 **0.02–0.1 ms** (rules, `subScale`) / **0.03 ms** (rules, conversions, plural rule); the layout's unit words 0.03 ms per page |
| duplicate model build: 5000 recipes, all pairs above the threshold | < 1 s | first visit to the page, first check after a write | **105 ms** (5126 recipes, 3980 pairs) |
| `pairsFor` one recipe (paste or form check), model built | < 10 ms | every debounced form check | **0.11 ms**; `closeRecipes` (W505, with `distinct.yaml`) 0.15 ms |
| pair list page, model built | < 50 ms | | **2.9 ms** (page 1 or 50); 107 ms with the model to build, 121 ms the first read after a write |
| dismiss a pair (write + commit) | < 500 ms | git dominates (a price append is ~170 ms) | **322 ms**; its "Annuler" 189 ms (a price append 221 ms in the same run) |
| family both / trash one from the page | as the existing writes (< 500 ms) | same writers | **368 ms / 409 ms** (a form save 341 ms in the same run; 436 / 514 ms in a run at load ~6) |

Measured 2026-09-30 on the AMD Ryzen 5 5600X (load average 5.8 at the start,
1.4 at the end: the parallel review's test runs), git 2.43, Node 24.20:
`npx tsx scripts/gen-vault.ts --bench` at `bc852b3`, 5000 recipes + 60
planted copies + 60 in close-variant families, 1000 registry entries, 3000
price rows, 20 012 commits. A first run on the code before the review's
duplicates fixes (`51275c5`) gave the same figures within noise, except the
trash action at 514 ms under load ~6.

Duplicates on the bench vault (not speed; the generator's archetypes as the
answer key):

| Measure | Figure |
|---|---|
| pairs above 0.65 | 3980 — **77.6 per 100 recipes** (corpus: 66.6); by score 0.65–0.7: 827, 0.7–0.8: 1117, 0.8–0.9: 584, 0.9–1: 1452 |
| precision: both cards of one archetype | 96.8 % (corpus D1: 97.2 %) |
| recall: same-archetype pairs flagged | 10.7 % of 35 886 (corpus D2: 27 %) |
| D0, 6+ lines: amount changed / ingredient replaced / line removed | 16/16 / **16/17** / 17/17, on the page and on paste; lowest scores 1.0 / 0.639 / 0.770 |
| D0, 4–5 lines: same three | 4/4 / **2/3** / 3/3; lowest 1.0 / 0.508 / 0.860 |
| close-variant families (60 pairs) | 0 listed; 55 score above 0.65 (Q16 C leaves them out) |

The page's size on a real vault is the number of cards per dish, which the
generator assumes; the corpus and the bench agree on ~70–80 pairs per 100
recipes when most dishes have a few cards, and on ~97 % of them being one dish.

## Testing summary

- Unit: `parseScaling`; `scaleAmount` against the Phase 0 table; ranges,
  `alt`, `or`, markers, yield, servings range; step amounts (French and English
  unit words, nothing on °F, minutes, pan sizes); element sets; similarity;
  prefix filtering against brute force.
- Corpus: the scaling sweep (factor 1 identical; tolerances; no forbidden
  fraction) and D0–D4 over the dish answer key, in the normal suite.
- Server: the duplicate model rebuilt after a save, a sync and a registry
  edit; W505 on paste, form check and save result; dismiss file writes
  (commit, rollback, stale guard, survives `cache/` deletion); the page's
  actions.
- Invariant: scaling writes nothing — after an E2E scaling session, every vault
  file hash and HEAD unchanged (the plan 03 invariants test extended).
- E2E (Playwright, fixture vault, invented accounts): scale on phone and tablet,
  reload, kitchen mode with a sub-recipe; paste a planted duplicate; settle a
  pair on `/doublons`.
- `npm run check` clean.

## Done when

- A recipe read at its own amount shows exactly what it shows today.
- At any other amount every quantity is one a cook can measure with the vault's
  cups and spoons (per `vocab/scaling.yaml`), or is marked `≈`, or is metric
  rounded; mass and volume never cross; oven, times and notes never change.
- The amount survives a reload and a shared link; kitchen mode's sub-recipes
  and steps agree with the scaled list or say why not.
- No scaled value is ever written to a file.
- Every planted duplicate is flagged on paste and in the form, and listed on the
  pair page; D1 ≥ 90 % on the corpus (or reported).
- A pair settled by a person stays settled after deleting `cache/`.
- Speed targets met or measured and reported.
- Docs updated for every answered question; all tests and `svelte-check` pass.

## Final report

Asked for:

1. What was built, per phase, with commit hashes.
2. The scaling sweep's counts (`≈`, ladder moves, decimals left) and the step
   amounts found, per unit class.
3. D0–D4, the chosen threshold, and the pairs that decided it.
4. Speed numbers at 5000 recipes.
5. Doc contradictions or undefined cases found beyond the questions below, each
   with a proposed doc change.
6. Anything deferred, and why; the review's leftovers as GitHub issue links.

### Report (Phase 8)

**1. Built, per phase.**

| Phase | What | Commits |
|---|---|---|
| — | plan, questions decided (recommended options; unit words to data) | `a9cf7cb`, `d556f5a` |
| 0 | dish answer key and planted pairs; factor-1 baseline, scaling table, corpus harness | `41a3a6c`, `854e858` |
| 1 | `vocab/scaling.yaml` and `vocab/unit-labels.yaml`, seeded | `785aa3c` |
| 2 | scaled amounts a cook can measure: unit fractions, kitchen ladder, metric steps, `≈` | `c5d3ae9` |
| 3 | the amount in the address, tap an amount, free factor | `a4f1f9f` |
| 4 | sub-recipes at the line's amount, step amounts beside the original, the notice; the docs of Q1, Q5–Q9 | `23755ca`, `3278cea` |
| 5 | the duplicate model: element sets, rarity-weighted Jaccard, prefix filtering, 0.65 | `0e5c359` |
| 6 | W505 on paste, form and save | `53317f4` |
| 7 | `/doublons` and its three actions, "Comparer", the nav entry | `b4fc206` (and `a67ef64`, the resolve-queue e2e) |
| review | step amounts, unit words per request, Back and « Retour », the duplicates findings | `030071b`, `9b7de75`, `d60f5b5`, `51275c5` |
| 8 | bench (realistic mix, planted pairs, the targets); docs; this report | `bc852b3`, this pass's `docs` commit |

**2. Scaling sweep and step amounts:** Phase 2 and Phase 4 notes above (seed
rules: counts ≈ 903 of 3192, containers ≈ 324 of 972, mass ≈ 166 / ladder 157
/ decimal 10, volume ≈ 1735 / ladder 1117 / decimal 14, none on a cup or a
spoon; 3 step amounts in 2 of 1472 steps, all cups).

**3. D0–D4 and the threshold:** Phase 5 above (0.65; corpus D0 100 %, D1
97.2 %, D2 27 %, D4 66.6 per 100); at 5000 recipes, the table above.

**4. Speed:** the table above; every target met, the step scan at it (0.96 ms
for 1 ms). Not a speed problem worth a change: the bench's 30 steps hold 45
amounts (the corpus averages 0.002 a step), and even so a tablet ~10× slower
stays under a 16 ms frame. The duplicate model's rebuild (~0.1 s) is paid by
the first read after any index write, including the nav count of a Markdown
account's next page.

**5. Doc and code disagreements, and undefined cases** (found in the docs pass;
none silently settled):

- *Fixed in the docs, the decision already recorded:* `VOCAB.md` "Scaling"
  gave `0,67 lb` as a decimal beyond the tolerance; since Phase 2's `oz → lb`
  rung, `1 lb × ⅔` shows `10 ½ oz` (the plan's recorded decision) — the example
  is now `1 oz × ⅔ = 0,67 oz`. `DATA-FLOW.md`'s P2 table still gave 3.8 s for
  accepting a pending tag; `6e8ee04` made it ~0.5 s (now 0.65 s here) — the row
  says both. The review's rule that a used sub-recipe is never trashed from
  `/doublons` was only in this plan: now in `DATA-FLOW.md` too; kept by the
  owner (2026-09-30).
- *Decided by the owner 2026-09-30:* (a) docs fixed to match the code; (b) the
  seed command now names the vocab files it adds; (c) kept as built; (d) kept
  (`18 c. à table`). Also decided: `c. à t.`, `c. à t`, `c. thé` (tsp) and
  `c. table`, `c. soupe` (tbsp) are aliases (VOCAB.md, AI template rule 8).
  Leftovers: issue #13. The questions as raised: (a) `DATA-FLOW.md` "Validation" heads its warnings
  "save anyway, mark the recipe `needs-review`", while its Conveniences (and the
  code) set `needs-review` only for an uncertain marker (W605): no other
  warning, W505 included, changes the status. Proposed: "save anyway; the
  status follows the markers (Conveniences)". (b) `vault ingredients seed`
  adds the vocab files a vault lacks (`unit-labels.yaml`, `scaling.yaml`), but
  its help line says "add the seed ingredients missing from the vault" and its
  output counts only ingredients, so the owner cannot see that their vault got
  the scaling rules. `README.md` now says both; the CLI text is code (not
  changed here). (c) A decimal beyond the tolerance can carry `≈` (`½ oz × ½`
  shows `≈ 0,13 oz`: two decimals are 4 % from 0.125); `VOCAB.md` does not say
  whether a decimal is ever marked. Proposed: decimals keep two digits and the
  mark follows the 2 % rule like any amount — or show three digits below 1.
  (d) A written `9 c. à table × 2` shows `18 c. à table`, not `≈ 1 tasse`: the
  ladder steps up only to an exact result, and "never as many of the smaller
  unit as make one of the next" applies only when stepping down. Consistent with
  `VOCAB.md` as written, but a cook might expect the cup; for the owner.
- *The plan's Phase 8 wording:* "one line changed" can be an amount (the same
  card twice: always found, 1.0) or another ingredient (closer to a version:
  missed 1 in 17 with 6+ lines, 1 in 3 with 4–5). The corpus gate (D0 100 %)
  planted no replaced ingredient. Not a threshold problem to fix: lowering it
  to catch 0.51 would cost precision (below ~0.58, D1 < 90 %).

**6. Deferred, and why** (the review's leftovers go to GitHub issues from its
own report):

- Names are not pluralized when scaled (`2 oignon`, text yield `2 moule`): the
  file holds one form of the name and the docs define no plural; adding endings
  is a noun grammar per language (`DATA-FLOW.md`, "Scaling").
- `UNIT_ALIASES` stays in code: `STORAGE.md` keeps the canonical unit list in
  code and moving it would make the checker vault-dependent (Phase 4 notes).
- ~~Kitchen mode expands one sub-recipe level~~ — nested since issue #13, 4
  levels, cycle-guarded (Phase 4 notes).
- ~~An amount in a step split by emphasis or a marker is not marked~~ — marked
  since issue #13 (Phase 4 notes), except across `[illisible]`, code or a link.
- ~~The owner has not read `tests/fixtures/scaling.yaml` yet~~ — reviewed
  2026-09-30 (Phase 0 notes: two cases changed, the rest approved).
- Two copies pasted in the same batch are not compared with each other (W505
  checks against the vault only).
- The paste page's "Mettre en famille" families only the pasted recipe (as W608
  in P1); the form and `/doublons` family both.
- An existing vault needs `vault ingredients seed` to get
  `vocab/unit-labels.yaml` and `vocab/scaling.yaml`; without them units show
  their code and scaled amounts show as before this plan.
- The pair count on a real vault is unknown until the owner opens `/doublons`
  on it: the bench and the corpus say ~70–80 per 100 recipes if most dishes
  have a few cards — 3500–4000 pairs, ~200 pages, at 5000 recipes.

## Out of scope

- **Shopping list** — declined by the owner (decision 5): no list, no
  whole-pack shopping cost, no aggregation across recipes, no store aisles.
  Pantry search and the consumed cost cover what remains of the need.
- **Meal planner, price history charts, cook log, PDF / cookbook export**
  (`PLANNING.md` P3 and Tier 2): not chosen now.
- **Unit conversion for display** (a metric ↔ cups toggle): the cards are
  written in cups, printed recipes already give both (`alt`), and crossing
  mass and volume needs densities the recipe page does not have. Scaling stays
  within the written unit's class.
- **Writing a scaled recipe** as a new file or changing a file's `servings`:
  Q9 (recommended: never).
- **Merging two duplicates into one file** (combining lines, notes, sources):
  "same recipe" trashes one, undoably; a merge editor is a different feature.
- **Duplicates by method text** (step similarity): the ingredient set is the
  signal `PLANNING.md` chose; titles are W503/W608's.
- Moving unit display labels to data (flagged above, for the owner).

---

## Open questions

**Decided 2026-09-29: the owner took the recommended option on every question,
Q1–Q16.** Where a phase says "depends on Qn", that dependency is settled. Doc
changes that follow from a decision are part of the phase that implements it.

**Also decided:** the unit display words (*tasse*, *c. à thé*, …) move out of
`src/lib/render/ingredient.ts` into a seeded vocab file, like the other
regional words (STORAGE.md: code holds no regional words). Done in Phase 1,
beside `vocab/scaling.yaml`; a vault without the file shows the unit code.

The docs leave each of these open or contradict themselves. For each: the
options, then the recommendation with its reason. Q-numbers are referenced
from the phases. **Key** marks the answers that change the most code.

### Scaling

**Q1 — Where does the chosen amount live?**
Today: component state on the recipe page (lost on reload, back, or a shared
link), passed once to kitchen mode as `?portions`/`?fois`; kitchen mode keeps it
per device in `localStorage` for 12 h. Pantry search keeps its state in the
URL (plan 03, Phase 7).
- A. In the recipe page's URL (`?portions=8` / `?fois=1.5`), updated with
  `replaceState` as she taps; no memory across visits (a recipe opened fresh
  shows the card's amount); kitchen mode unchanged (URL wins, then its session).
- B. Remembered per device and recipe in `localStorage` ("last time: 12
  portions"), offered back on the next visit.
- C. As today (component state only).
- **Recommended: A.** It survives reload and back, can be sent to a sibling or
  printed, follows the pantry convention, and never surprises her with an old
  amount on a recipe she opens fresh.

**Q2 — Key — How are scaled amounts rounded?**
`formatNumber` snaps to a glyph within 2 % (eighths and thirds, any unit),
else prints a decimal. `RECIPE-SCHEMA.md` and `PLANNING.md` ask for fractions
"never 0.667" but say nothing of scaled values.
- A. Snap to the unit's allowed fractions (from `vocab/scaling.yaml`) within a
  tolerance (seed 10 %), and mark `≈` when the shown value differs from the
  exact one by more than 2 %; metric (`g`, `ml`) rounded by the file's steps
  (1 g below 100, 5 g from 100, 25 g from 1000); beyond the tolerance, a short
  decimal. Factor 1 never snaps.
- B. As A without the `≈` mark.
- C. Exact values, as today (decimals where no glyph is within 2 %).
- D. Snap to the nearest allowed fraction whatever the distance.
- **Recommended: A.** Every amount becomes one her cups and spoons can
  measure, the mark keeps the rounding honest (the "never a figure that looks
  exact when it is not" rule of cost), and the fractions per unit are data a
  vault outside Québec can change.

**Q3 — Does a scaled amount change unit?**
`⅛ tasse`, `6 c. à thé`, `20 c. à table` are measurable but not how a cook
writes them. The cost factors give 1 cup = 16 ⅔ tbsp (250 / 15), not a
kitchen's 16.
- A. Never: the written unit stays, only the number changes.
- B. A kitchen ladder in `vocab/scaling.yaml` (seed: 3 tsp = 1 tbsp, 16 tbsp =
  1 cup, 1000 g = 1 kg, 1000 ml = 1 L), used only within the written unit's
  family: step up when the amount reaches the next unit's smallest allowed
  fraction, step down when it falls below the unit's smallest; the result is
  rounded per Q2 in its new unit. Never across mass and volume, never `lb`/`oz`
  ↔ `g`.
- C. As B, and also imperial ↔ metric (`lb` → `g`) to a "house system".
- **Recommended: B.** `2 c. à table` instead of `⅛ tasse` is what makes a
  halved recipe readable; the ladder is data, and staying in the written
  system keeps the card recognisable.

**Q4 — Counts and containers (`œuf`, `gousse`, `boîte`, `sachet`).**
- A. Snap to halves (`count: [1/2]`, `container: [1/2]` in the data file),
  marked `≈` per Q2; below ½, show `½` with `≈` rather than 0.
- B. Always round up to a whole, with the exact value muted beside it
  (`2 œufs (1 ⅓)`).
- C. Exact fractions like any unit (`1 ⅓ œuf`).
- **Recommended: A.** Half an egg or half a can is something a cook does;
  rounding to whole silently changes the recipe's proportions, and thirds of an
  egg are not measurable. The halves are data.

**Q5 — Sub-recipes when scaled (kitchen mode's inline expansion, the recipe
page's link).**
Today the expansion shows the sub-recipe's own amounts at every factor.
- A. Scale the expansion by `line amount × factor / yield` when the
  sub-recipe's `yield` object is in the line's unit or class — the cost rule of
  plan 03 Q16 A, one shared function; otherwise show it as written with its
  yield ("recette complète : donne 2 abaisses"). The recipe page's sub-recipe
  link carries that factor (`?fois=`).
- B. Always as written, with its yield shown.
- C. No expansion change; only the link carries a factor.
- **Recommended: A.** At ×1 the expansion is already wrong for one crust of
  two; the rule already exists and is conservative (unscalable says so rather
  than guesses).

**Q6 — Key — Quantities written inside steps, and the times.**
"Ajouter 1 tasse de lait chaud" is prose; kitchen mode shows `2 tasses lait`
under it at ×2.
- A. Leave step text alone; when the factor is not 1, one notice above the
  method: « Les quantités dans les étapes, les temps et la température sont
  ceux de la recette de base. »
- B. Find amounts with the vocabulary's unit words (`findAllQtyUnits`, the
  E216 grammar, `lang`-aware) and show the scaled amount beside the original in
  a distinct style (`1 tasse → 2 tasses`), the original always visible; plus
  A's notice for times, oven and pan.
- C. As B, but replace the original in place.
- **Recommended: B.** She reads the step she is on, not a notice at the top;
  keeping the original visible means a misread ("un bol de 2 L") is seen as
  such, and temperatures, durations and pan sizes are not recipe units, so
  they are never found.

**Q7 — Servings ranges and text yields.**
`servings: 6, servings_max: 8` shows "6 à 8" only at the base amount;
`yield: "24 biscuits"` never scales.
- A. Scale both: the range proportionally (`12 à 16` at ×2; the stepper moves
  the lower bound); a text yield's leading number (a plain number or fraction
  at the start, nothing else) scaled per Q2, the rest of the text kept; a text
  without a leading number shown unscaled with `× factor` beside it.
- B. Stepper on the lower bound, range dropped when scaled (today); text
  yields never scaled.
- C. As A for servings; text yields never scaled.
- **Recommended: A.** "Donne 48 biscuits" at ×2 is the answer she wants, the
  range is information the card gave, and a leading number is the only part
  read, so nothing else can be misread.

**Q8 — How is the amount set?**
Today: a stepper of ±1 serving (min 1), or a fixed list ×½ … ×3 without
servings.
- A. As today.
- B. As today, plus tapping an ingredient's amount to type what she has ("j'ai
  3 œufs", factor = 3 / written, the lower bound of a range), plus a free
  factor field ("× 2,5") for recipes with servings too; factor capped (seed
  ×0.1 … ×20) and shown when not a whole number of servings.
- C. B without the free factor.
- **Recommended: B.** "I have 3 eggs, not 4" and "60 cookies, not 24" are the
  two cases the stepper cannot reach in a few taps; both are a division, and
  the cap keeps a stray `?fois=1e9` harmless.

**Q9 — Is a scaled recipe ever written to a file?**
- A. Never: scaling is display only (page, print, kitchen mode); the file,
  its `servings` and git never see it.
- B. "Enregistrer comme nouvelle version": a scaled copy saved as a new recipe
  in the same family (through the form's save path).
- C. "Changer la recette de base": rewrite the file's quantities and servings.
- **Recommended: A.** The card as written is the archive; rounded amounts
  written back would be a lossy copy of her mother's card, and B/C invite
  `≈` values into files. A version she really cooks differently is a new
  recipe she types in the form.

### Duplicates

**Q10 — Key — What goes into a recipe's ingredient set?**
- A. Each line that is not optional (item or group) and not `to_taste`, as its
  registry slug, else `k:<lookup key>` (the family diff's identity); a
  sub-recipe line as one element `r:<slug>` (not flattened); `or` choices
  ignored (the main line counts); staples kept; a recipe with fewer than 3
  elements never pairs.
- B. As A, staples removed.
- C. As A, sub-recipes flattened into their lines.
- D. As A, unresolved lines removed.
- **Recommended: A.** Flattening makes every tarte on the same crust look
  alike; dropping unresolved names hides a duplicate until the queue is worked;
  staples are better handled by weights (Q11) than removed, since removing them
  leaves two-line sets that pair on one ingredient. The minimum size keeps
  "café" and "vinaigrette" out.

**Q11 — Key — Which similarity, and what threshold?**
`PLANNING.md`: "Jaccard similarity on ingredient sets … Flag pairs above
~0.8."
- A. Plain Jaccard `|A∩B| / |A∪B|`, threshold 0.8.
- B. Weighted Jaccard, each element weighted by its rarity in this vault
  (`log(N / recipes using it)`, recomputed with the model: salt weighs little,
  *chipits* much), threshold tuned on the corpus (Phase 5, D1 ≥ 90 %), starting
  at 0.8.
- C. A, plus a second pass comparing quantities (converted with the fixed
  factors) to label pairs "identiques" vs "proches".
- D. MinHash / LSH approximation.
- **Recommended: B.** It keeps the doc's measure and threshold as the start,
  lets shared staples count for little without a list of "common ingredients"
  anywhere (the weights come from the vault itself, so nothing regional), and
  the corpus's dish key tunes it. At 5000 recipes exact computation with prefix
  filtering is fast enough (D is not needed); C can come later from the pair
  view.

**Q12 — Where do possible duplicates show, and under which code?**
- A. A page only (`/doublons`).
- B. The page, plus a new warning **W505** (`app`, `VALIDATION.md` row: "a
  recipe in the vault has nearly the same ingredients — possible duplicate",
  the other slugs and the share in common) on the paste box's server check, the
  form's check (a hint with the other recipe and "En faire deux versions") and
  the save result; not on the recipe page, never in the fix-request block.
- C. As B, and also a banner on both recipes' pages until settled.
- **Recommended: B.** The best moment is before the second copy is saved; the
  page handles the backlog (the real vault already holds pairs); a banner on
  hundreds of recipe pages she cooks from is noise, as W603 was (plan 04, Q13
  A). W505 sits beside W503 (titles) in the 5xx "vault identity" codes.

**Q13 — What can she do with a pair?**
- A. Nothing but look: both links, and "Recettes différentes" (dismiss).
- B. Three actions, each one commit through an existing writer: "Deux versions
  de la même recette" (family both, as W608), "C'est la même recette" (the one
  she picks to the trash, undoable), "Recettes différentes" (dismiss, Q14).
- C. B, plus "Fusionner" (combine the two files into one).
- **Recommended: B.** Most pairs in a card box are versions, a few are true
  repeats, some are coincidences; each has a writer already, so three buttons
  cost little code, and every one is undoable. A merge editor (C) is a second
  form.

**Q14 — Key — What does "Recettes différentes" store, and where?**
`STORAGE.md`: "Anything precious is plain text … Anything in SQLite is either
rebuildable or cheap to lose."
- A. A vault file, `vocab/distinct.yaml` (one line per pair, `[a, b]` sorted),
  committed `duplicate: <a> ≠ <b>`; permanent for that pair of slugs whatever
  the recipes become.
- B. As A, each line also holding a fingerprint of the two ingredient sets at
  the time: the pair comes back if either set changes enough to cross the
  threshold again.
- C. A table in `cache/index.db` (lost when `cache/` is deleted: every pair
  comes back).
- D. A frontmatter key on the recipes (`not_duplicate_of:`) — a schema change.
- **Recommended: A.** A person's judgment is precious and shared by both
  users; slugs are permanent (`STORAGE.md` §Slugs), so the pair stays
  meaningful; a vault file survives `cache/`, is in git and undoable, and
  touches no recipe. B's re-flagging is rarely worth its complexity: a recipe
  edited into a real duplicate of another is still caught by W505 at its save.

**Q15 — Who sees the pair list, and is it in the nav?**
- A. Like `/etiquettes` (plan 04, Phase 8): readable by anyone, actions need a
  session, "Doublons (N)" in the nav only for a `markdown: true` account while
  N > 0.
- B. In the nav for every signed-in account.
- C. No nav entry; reached from the home page's maintenance links and W505.
- **Recommended: A.** Settling the backlog is maintenance the owner does
  (like the resolve queue and pending tags), while she meets pairs one at a
  time through W505 in the form; the page stays open to both (Q2 B of plan 04).

**Q16 — Same-family pairs.**
Recipes in one family are declared versions (`VOCAB.md` §Families); most
would pair.
- A. Never listed nor warned: a family is already the answer.
- B. Listed like any pair.
- C. Left out, except near-identical ones (similarity 1.0 on the element set
  and the same amounts at factor 1): a card pasted twice into one family.
- **Recommended: C.** Families are the normal state of a card box and would
  flood the page; the one mistake worth catching inside a family is the same
  card twice, and "identical set and amounts" finds exactly that with no
  tuning.
