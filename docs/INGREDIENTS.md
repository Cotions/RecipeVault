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
when:                                # optional; disambiguation rules, see below
  - { names: [tomates, tomatoes], unit: [container] }
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
(`fr: [a, b]`), each `when` rule as a flow mapping, and leaves out `when`,
`default_unit`, `au_gout`, `density` and `weights` when unset. Only `slug`,
`category` and one name are required. Problems in a file have stable codes,
`E801`–`W811`, `E820`–`W821` (`VALIDATION.md`, "Registry codes"); a file with
an error keeps its last good index rows.

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
- `when`: disambiguation rules, next section.
- `allergens` (plan 03, Q20): values from `vocab/allergens.yaml`, seeded with
  the Health Canada priority allergens (`VOCAB.md`, "Allergens"). An unknown
  value is a warning (`W809`) and is ignored.

### Disambiguation rules

Some bare names mean one product or another depending on the line, not on the
name: *tomates* by the can are canned tomatoes, by the piece or the pound fresh
ones; *bœuf* with prep *haché* is ground beef, *en cubes* stewing beef; *lard* on
a French card is salt pork, on an English one rendered lard. The lookup key is
the name alone, so no alias can say this. A rule can:

```yaml
when:
  - { names: [tomates, tomatoes], unit: [container] }   # tomates-en-conserve
  - { names: [lard], lang: fr }                          # lard-sale
  - { names: [bœuf, boeuf], words: [haché, hachée] }     # boeuf-hache
```

A rule says: these `names` mean this entry when **every** condition given holds
on the recipe line.

| Key | Condition |
|---|---|
| `names` | required: written names, matched by lookup key like aliases (exact, then singular) |
| `lang` | the recipe's language, `fr` or `en` |
| `unit` | the line's canonical unit is one of these units or in one of these classes: `mass` (g, kg, lb, oz), `volume` (ml, cl, l, cup, tbsp, tsp, qt, pint, pinch, drop), `count` (piece, clove, leaf, sprig, stalk, bunch, slice), `container` (can, packet, bottle, jar, bag). A line with no unit meets no `unit` condition |
| `words` | one of these words or phrases appears, as whole words, in the line's `prep` or `note` (folded, and singularized with the recipe language's plural rules, so `hachés` meets `haché`) |

At least one of `lang`, `unit`, `words` is required: a name with no condition is
an alias and goes in `names`. A value may be a single item instead of a list.
Rule names are **not** aliases: a rule name whose conditions do not hold resolves
nothing through that rule. The classes group the canonical unit list, which is
the app's contract with the prompt; which names depend on which condition is
data, in the registry (plan 03, decision 1).

How rules take part in resolution (step 4 below): the rules naming the key are
checked first, since they are more specific than aliases.

- The rules that hold point at **one** entry → resolved (`rule`).
- They point at two or more → ambiguous, never auto-resolved.
- None holds → the aliases decide as usual. So an entry may keep a bare name as
  an alias for the common case while another entry claims it by rule for the
  exception. When no alias settles it and rules of two or more entries name it,
  the line is ambiguous; with one entry's rules only, it is unresolved and that
  entry is the first candidate.

`or` options are resolved on their own fields: a plain-name option has no unit,
prep or note, so it meets only `lang` conditions.

A rule never guesses: it states a fact the owner knows about this vault's cards.
A bad rule is `E820` (the file is then in error, like any malformed field). Rules
of two entries that can hold on one line (for each condition, one leaves it open
or their values meet) are `W821`: such lines stay ambiguous, which is safe, but
it is probably not what was meant.

### The seed

A new vault starts with a seed registry (plan 03, Q5): `docs/INGREDIENTS-SEED.yaml`,
a couple of hundred common entries with staples, categories, densities for flours
and sugars, per-unit weights, and the Québec names as aliases. `vault init`
writes it; `vault ingredients seed` adds the missing entries (and the
`vocab/normalize.yaml`, `vocab/allergens.yaml` and `vocab/conversions.yaml`
files an older vault lacks) to
an existing vault without touching an entry already there. It is data, like the
vocabulary seed: the resolve queue then starts with the long tail, not with
*sel* and *farine* on every recipe.

Its aliases are exact synonyms only, in both languages: the French and Québec
names, the English names of an anglophone neighbour's card (*flour*, *brown
sugar*), and common older or regional synonyms (*sucre brun* → cassonade,
*gruau* → flocons d'avoine). A bare name whose product depends on the unit or
the prep (*tomates*, *champignons*: fresh or canned) is not an alias of either
entry, nor is a word that means another product in the other language (English
*lard* is saindoux, French *lard* is salt pork). Those get a disambiguation rule
where the condition is certain (*tomates* by the can, *lard* by language, *bœuf*
with *haché*), and otherwise go through the resolve queue.

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
4. **Rules.** The disambiguation rules naming the key (exactly, else by its
   singular key) whose conditions hold on the line point at exactly one entry →
   resolved (`rule`); at two or more → ambiguous. See "Disambiguation rules".
5. **Exact key.** The key matches an alias (`ingredient_names.key`) of exactly
   one entry → resolved (`alias`). A key that is an alias of two or more entries
   is **ambiguous** and never auto-resolved.
6. **Singular key.** Each word is singularized with the recipe language's rules
   in `vocab/normalize.yaml` (see `VOCAB.md`, "Plurals"); a match with the
   singular key of exactly one entry → resolved (`plural`). Two entries → not
   resolved.
7. **Otherwise unresolved.** The resolve queue offers the top fuzzy candidates:
   trigram similarity (Jaccard over padded word trigrams of the singular keys),
   best first, at most **3**, none below **0.15** (`FUZZY` in
   `src/lib/ingredients/resolve.ts`, tuned on `tests/fixtures/corpus`). A candidate
   is **never** taken automatically: a wrong resolution poisons every total that
   includes it. An ambiguous key's candidates are the entries sharing it.

The result goes in the index only (`ingredients.key`, `.item`, `.resolution`, and
the same for each `or` option in `ingredient_or`); it is never written back into
the recipe file (see `STORAGE.md`). A registry change re-resolves every indexed
row from its stored key, without reading a recipe file (rows whose key a rule
names also read the line's unit, prep and note from the index's stored parse).

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
entry, or by giving one entry a rule for it ("Selon l'unité ou la préparation":
units or unit classes seen on the lines, words of `prep` or `note`, the language;
see "Disambiguation rules"). Only ingredient files change (`DATA-FLOW.md`, "Ingredient edits").

## Cost

The currency is the config's (`currency`, CAD by default). Prices are not stored in ingredient files. They are rows in the append-only
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
  `≈ 4,20 $ · 9 ingrédients sur 12 ont un prix`.
- Exclude `to_taste` and `staple` ingredients from the coverage denominator — they
  are pennies and would make coverage look permanently broken. A priced staple
  still adds to the cost (plan 03, Q17); butter and sugar are real money.
- A recipe below 70 % coverage shows no figure: `Pas assez de prix · 5
  ingrédients sur 12`, with the unpriced ones listed and linked (Q14). A recipe
  where nothing counts (staples only) shows a figure only when every line with
  an amount is priced.
- What counts: every line that is not optional (item or group, Q18), not
  `to_taste` and not a staple. An unresolved line counts and is unpriced. A line
  with no quantity counts and is unpriced, unless its unit is a count or a
  container (`unit: can` alone is one can).
- Ranges: the upper `qty`; the cost per serving divides by the lower `servings`
  (Q15). `or`: the main entry is costed.
- Sub-recipes are flattened into the parent (Q16): their lines count in its
  cost and coverage, scaled by the line's amount against the sub-recipe's
  `yield` object (same unit, or the same class by the fixed factors), else
  against its `servings` when the line is in `piece`. Otherwise — a `yield`
  written as text, a unit that does not match — the sub-recipe is one unpriced
  line. `buy_instead` does not change cost (homemade is costed).

### Unit conversion

The factors are data, in the vault's `vocab/conversions.yaml` (seeded from
`VOCAB.md`, "Conversions"): grams per mass unit, millilitres per volume unit.
An amount is priced against its pack by the first common measure — the same
unit, else grams or millilitres, preferring the one reached without the
ingredient's density or weights.

- Within mass (`g`, `kg`, `lb`, `oz`) and within volume (`ml`, `cl`, `l`, `cup`,
  `qt`, `pint`, and `tbsp`/`tsp` *as volumes*): always safe. `cup` = 250 ml.
- Mass to volume: only when the ingredient has an explicit `density`. Never guess.
  `tbsp`/`tsp` are volumes, so the density applies to them (Q11); a `weights`
  value for the unit overrides it (a tablespoon of butter weighed, not computed).
- `pinch`, `drop` and the count units (`piece`, `clove`, `slice`, `stalk`…):
  only through the entry's `weights` (`{ piece: 55, pinch: 0.4 }`, grams for one),
  or a price row in the same unit. Otherwise unpriceable, never estimated.
- Containers (`can`, `packet`, `jar`, `bottle`, `bag`): a price row in the same
  unit, or the size in the line's `note` (`796 ml`, `19 oz (540 ml)` — the
  grammar `E216` allows), measured like any amount (Q13).
- `alt` is the same amount in another measure: used when the main one cannot
  be priced.

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
