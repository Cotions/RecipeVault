# Ingredients — registry, cost, pantry search

Draft 1. Depends on `RECIPE-SCHEMA.md` (structured ingredients) and `VOCAB.md`.

Ingredients are first-class objects, not strings inside recipes. That is what makes
three features possible: cost per recipe, "what can I make with what I have", and
an ingredient view of its own.

## The registry

One file per ingredient: `ingredients/<slug>.md`. Same principle as recipes —
plain markdown on disk is the truth, SQLite is a derived index.

```yaml
---
slug: tomates-concassees             # canonical id. lowercase ASCII hyphenated.
category: conserve                   # see categories below
names:                               # every way it appears in a recipe
  fr: [tomates concassées, tomate concassée, pulpe de tomate, tomates pelées]
  en: [chopped tomatoes, crushed tomatoes, canned tomatoes]
default_unit: g                      # optional; see below
staple: false                        # true = assumed always in the cupboard
au_gout: false                       # optional; true = may be written "to taste"
density: 1.0                         # g per ml, only when the conversion is safe
weights: { piece: 400 }              # optional; grams for one of a count unit
substitutes: [tomates-fraiches, coulis-de-tomate]
allergens: [gluten]                  # from vocab/allergens.yaml
---

Free prose notes about the ingredient.
```

Categories: `frais`, `viande`, `poisson`, `legume`, `fruit`, `cremerie`,
`epicerie`, `conserve`, `surgele`, `epice`, `boisson`, `autre`.

The app writes these files in that key order, names as flow lists
(`fr: [a, b]`), and leaves out `default_unit`, `au_gout`, `density` and
`weights` when unset. Only `slug`, `category` and one name are required.
Problems in a file have stable codes, `E801`–`W811` (`VALIDATION.md`,
"Registry codes"); a file with an error keeps its last good index rows.

- `default_unit` (plan 03, Q26): the unit vault-wide totals and "sorted by how
  much it uses" add quantities in, and the default `pack_unit` when entering a
  price. A canonical unit.
- `weights` (plan 03, Q12): canonical unit → grams for one of it, for count and
  spoon units a recipe writes: `{ piece: 55, clove: 5, pinch: 0.4 }`. This is the
  "explicit average weight" and the "per-ingredient table" of "Unit conversion"
  below.
- `au_gout` (plan 03, Q21): the item may reasonably be written `to_taste` —
  salt, pepper, oils, butter, herbs and spices. `W606` fires on `to_taste`
  items whose entry does not have it. It describes how a recipe uses the item;
  `category` describes where it is bought.
- `allergens` (plan 03, Q20): values from `vocab/allergens.yaml`, seeded with
  the Health Canada priority allergens (`VOCAB.md`, "Allergens"). An unknown
  value is a warning (`W809`) and is ignored.

### The seed

A new vault starts with a seed registry (plan 03, Q5): `docs/INGREDIENTS-SEED.yaml`,
a couple of hundred common entries with staples, categories, densities for flours
and sugars, per-unit weights, and the Québec names as aliases. `vault init`
writes it; `vault ingredients seed` adds the missing entries (and the
`vocab/normalize.yaml` and `vocab/allergens.yaml` files an older vault lacks) to
an existing vault without touching an entry already there. It is data, like the
vocabulary seed: the resolve queue then starts with the long tail, not with
*sel* and *farine* on every recipe.

Its aliases are exact synonyms only. A bare name whose product depends on the
unit or the prep (*tomates*, *champignons*: fresh or canned) is not an alias of
either entry, nor is a word that means another product in the other language
(English *lard* is saindoux, French *lard* is salt pork): the lookup key is the
name alone, so such a name goes through the resolve queue.

### `staple` is the important flag

Salt, pepper, oil, flour, sugar, butter, water. Marked `staple: true`, they are
assumed present. Without this, every pantry search result reads "missing salt" and
the feature is worthless. This one boolean is the difference between a usable
"what can I make" and noise.

### Resolution: recipe `name` to registry `slug`

Recipes are written with a human `name`. The AI generating them does not know the
registry. So at index time (on save, on sync, on an external edit):

1. **Lookup key.** The written name with markers stripped (`[?]`, `[illisible]`…),
   apostrophe and hyphen variants unified, then folded (lowercase, no accents,
   `œ` → `oe`), spaces around `'` and `-` removed, and `35 %` written `35%`.
2. **`item:` override.** An entry with `item:` is taken as written. If no
   `ingredients/<item>.md` exists: W307.
3. **Sub-recipe.** An entry with `recipe:` resolves to no registry item
   (`resolution = recipe`); the sub-recipe's own ingredients count instead.
4. **Exact key.** The key matches an alias (`ingredient_names.key`) of exactly
   one entry → resolved (`alias`). A key that is an alias of two or more entries
   is **ambiguous** and never auto-resolved.
5. **Singular key.** Each word is singularized with the recipe language's rules
   in `vocab/normalize.yaml` (see `VOCAB.md`, "Plurals"); a match with the
   singular key of exactly one entry → resolved (`plural`). Two entries → not
   resolved.
6. **Otherwise unresolved.** The resolve queue offers the top fuzzy candidates:
   trigram similarity (Jaccard over padded word trigrams of the singular keys),
   best first, at most **3**, none below **0.15** (`FUZZY` in
   `src/lib/ingredients/resolve.ts`, tuned on `tests/fixtures/corpus`). A candidate
   is **never** taken automatically: a wrong resolution poisons every total that
   includes it. An ambiguous key's candidates are the entries sharing it.

The result goes in the index only (`ingredients.key`, `.item`, `.resolution`, and
the same for each `or` option in `ingredient_or`); it is never written back into
the recipe file (see `STORAGE.md`). A registry change re-resolves every indexed
row from its stored key, without reading a recipe file.

Unresolved names are reported as W305 (a candidate is waiting in the resolve
queue) or W303 (nothing close). They do **not** change the recipe's `status`
(plan 03, Q3): the recipe saves and renders, lists them under "Ingrédients non
reliés" on its page, and can be found with the browse filter *Ingrédients : non
reliés au registre*. It is only missing from cost totals and pantry search until
resolved.

Unresolved ingredients must never block saving a recipe. A recipe with an unknown
ingredient is still a recipe; losing it to a validation wall would be worse than an
incomplete index.

A "resolve queue" screen (`/resoudre`) lists every unresolved name across the
vault, most frequent first. Resolving `farine T55` once fixes it in 200 recipes.
Each row offers its candidates ("C'est ça"), a link to any entry, or a new entry
created from the name; an ambiguous name is settled by taking it off all but one
entry. Only ingredient files change (`DATA-FLOW.md`, "Ingredient edits").

## Cost

Currency is CAD. Prices are not stored in ingredient files. They are rows in the append-only
`prices.csv` — date, ingredient, amount, pack size, shop — and the current price is
the latest row. Pack size belongs to the purchase, not the ingredient: the same
tomatoes come in 400 g and 800 g tins. See `STORAGE.md`.

Two numbers, both honest, never conflated:

- **Consumed cost** — what the recipe actually uses. 800 g of tomatoes at $0.89 per
  400 g pack = $1.78. Pro-rata, fractional packs allowed.
- **Shopping cost** — what you must buy if the cupboard is empty. 150 g of parmesan
  when it is sold in 200 g blocks = one block, not 0.75 of one.

Consumed cost per serving is the headline number on a recipe. Shopping cost belongs
on a shopping list, where whole packs are what you carry home.

### Partial pricing is the normal state

Most ingredients will have no price for a long time. So:

- Never display a total as if complete. Show coverage:
  `≈ $4.20 · 9 of 12 ingredients priced`.
- Exclude `to_taste` and `staple` ingredients from the coverage denominator — they
  are pennies and would make coverage look permanently broken.
- A recipe below ~70% coverage shows a range or a "not enough prices yet" state
  rather than a number that looks authoritative and is not.

### Unit conversion

- Within mass (`g`, `kg`, `lb`, `oz`) and within volume (`ml`, `cl`, `l`, `cup`,
  `qt`, `pint`, and `tbsp`/`tsp` *as volumes*): always safe. `cup` = 250 ml.
- Mass to volume: only when the ingredient has an explicit `density`. Never guess.
- `tbsp`, `tsp`, `pinch`: convert only via a per-ingredient table, because a
  tablespoon of flour and a tablespoon of honey are not the same mass. When no
  entry exists, treat the ingredient as unpriceable rather than inventing a figure.
- `piece`: needs a price row with `pack_unit: piece`, or an explicit average weight for mass
  conversion (one egg ≈ 55 g).

Wrong prices are worse than absent prices — an absent price shows as absent, a
wrong one silently poisons every total that includes it.

### Price history

Prices change. Because `prices.csv` is append-only, the ingredient view can show a
trend, and a price older than a year can be flagged stale. Cheap to
store, impossible to reconstruct later.

## Pantry search — "what can I make"

Input: a set of ingredients she has (`oeuf`, `penne`). Output: recipes ranked by how
close they are to cookable.

```
have      = selected ingredient slugs  (+ all staples, if "assume staples" is on)
required  = recipe ingredients where NOT optional AND NOT to_taste AND NOT staple
            AND NOT in an optional group
            (an entry with or: [...] is matched if ANY of its options is in have)
matched   = required ∩ have
missing   = required − have
coverage  = |matched| / |required|
```

Three modes, one query:

| Mode | Filter | Answers |
|---|---|---|
| Cookable now | `missing = 0` | "dinner, tonight, no shopping" |
| Almost there | `missing ≤ 2` | "what do I grab on the way home" |
| Ideas | `matched ≥ 1` | "inspire me, I have leftover penne" |

Ranking within a mode: coverage descending, then fewest missing, then highest
`rating`, then shortest `total_s`. Rating before time because at 5000 recipes the
top of the list should be recipes she actually likes.

Every result shows its missing ingredients inline. A result you cannot act on is
noise; "missing: crème fraîche" is a decision.

### Substitutions make this much better

`substitutes` in the registry means a missing ingredient can sometimes be covered
by something she has. A recipe missing `crème fraîche` where she has `yaourt grec`
is cookable *with a substitution* — shown as its own tier, between "cookable now"
and "almost there", labelled so she knows it is not the original.

### Negative and required filters

- "must use" — pin an ingredient so only recipes containing it are considered
  (she bought courgettes and needs them gone).
- "must avoid" — exclude recipes containing an ingredient or allergen.

### It stays fast

This is a join over `ingredients(item)` grouped by recipe. At 5000 recipes and
maybe 60000 ingredient rows, SQLite answers in single-digit milliseconds with an
index on `item`. No special machinery.

## Two views

**Recipe view** — what it is today, plus a cost line (consumed cost total and per
serving, with coverage), and per-ingredient links into the ingredient view.

**Ingredient view** — `/ingredients/tomates-concassees`:
- canonical name, all aliases, category, allergens
- pack size and current price, price trend, staleness warning
- every recipe using it, sorted by how much it uses — the answer to "I have a kilo
  of courgettes, now what"
- total quantity consumed across the vault, which is what makes a pack size
  obviously right or wrong
- substitutes, and what it substitutes for
- unresolved written names mapped onto it, so drift is visible

**Ingredient index** — sortable table of every ingredient: name, category, price,
number of recipes, priced or not. This is the working screen for entering prices,
so it needs inline editing. Sorting by "used in most recipes, unpriced" gives the
exact order to enter prices in for maximum benefit.
