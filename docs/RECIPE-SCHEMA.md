# Recipe file schema

Draft 4. Adds `schema` version and sub-recipes. Draft 3 broke from draft 2: ingredients moved from prose body lines into
structured frontmatter. Reason below.

One recipe per file: `recipes/<slug>.md`. Slug is lowercase, hyphenated, ASCII.
Family members are prefixed with the family: `lasagna-bolognaise.md`.

## Why ingredients are structured

Draft 2 had ingredients as prose bullets, parsed best-effort. That fails on real
recipes:

| Prose line | Problem |
|---|---|
| `huile d'olive, sel, poivre` | three ingredients, one line, no quantities |
| `1 gros oignon, émincé` | `gros` is not a unit, `émincé` is not part of the name |
| `2 gousses d'ail` | is the unit `gousse` or is the item `gousses d'ail`? |
| `1 feuille de laurier` | same ambiguity again |
| `sel` | no quantity at all, and that is correct |

Best-effort parsing of these is guesswork, and three features depend on getting it
exactly right: cost per recipe, pantry search ("what can I make with eggs and
penne"), and ingredient scaling. A 90%-accurate parser means a wrong price and a
wrong search result on one recipe in ten, forever.

So the structure is explicit and the prose is generated for display. Writing YAML
by hand is slightly less pleasant — but an AI writes most of these files, and her
form UI writes the rest. Almost nobody types them.

## Frontmatter

```yaml
---
# identity
schema: 3                            # file format version — required
title: Lasagnes à la bolognaise
slug: lasagna-bolognaise
lang: fr                             # fr | en — default fr

# family grouping — omit both if the recipe is a one-off
family: lasagna
variant: bolognaise

# provenance
source:
  type: family                       # family | book | website | magazine | tv | invented
  author: Mamie Jeanne
  url:
  title:                             # book or magazine name
  page:
  note: "carte manuscrite"

# timing
times:
  prep: 30m
  cook: 45m
  rest: 10m
  total: 1h25m                       # optional, computed if absent

# quantity
servings: 6
servings_note: "or 4 hungry people"

# classification — canonical values only, see VOCAB.md
tags: [pasta, italien, four, plat-principal]
season: [automne, hiver]
difficulty: 2                        # 1 easy - 5 hard
rating: 5

# ingredients — the load-bearing part
ingredients:
  - group: Sauce bolognaise
    items:
      - { qty: 500, unit: g, name: bœuf haché }
      - { qty: 1, unit: piece, name: oignon, note: gros, prep: émincé }
      - { qty: 2, unit: clove, name: ail }
      - { qty: 800, unit: g, name: tomates concassées }
      - { qty: 2, unit: tbsp, name: concentré de tomate }
      - { qty: 1, unit: leaf, name: laurier }
      - { name: huile d'olive, to_taste: true }
      - { name: sel, to_taste: true }
      - { name: poivre, to_taste: true }
  - group: Béchamel
    items:
      - { qty: 50, unit: g, name: beurre }
      - { qty: 50, unit: g, name: farine }
      - { qty: 500, unit: ml, name: lait }
      - { qty: 1, unit: pinch, name: muscade }
  - group: Montage
    items:
      - { qty: 12, unit: piece, name: feuilles de lasagne }
      - { qty: 100, unit: g, name: parmesan, prep: râpé }

# media
photos:
  final: photos/lasagna-bolognaise.jpg
  steps: []
scans:
  - scans/lasagna-bolognaise-p1.jpg  # the original paper, kept forever

# bookkeeping
status: verified                     # draft | needs-review | verified
added: 2026-09-26
updated: 2026-09-26
extracted_by: hand                   # hand | claude — which parses to distrust
---
```

Only `schema`, `title` and `ingredients` are required; `slug` is derived from the title when
absent. Omit keys rather than leaving them blank — an absent key is cleaner to
handle than an empty one.

### Ingredient item fields

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | as written, in the recipe's language. Display text. |
| `qty` | no | number. Fractions as decimals: `0.5`, not `1/2`. Ranges: use `qty` plus `qty_max`. |
| `unit` | no | canonical unit from `VOCAB.md`. Required whenever `qty` is present. |
| `note` | no | descriptor that is not the name: `gros`, `bien mûr`, `à température` |
| `prep` | no | what is done to it: `émincé`, `râpé`, `en dés` |
| `to_taste` | no | `true` for salt, pepper, oil — no quantity, and that is correct |
| `optional` | no | `true` if the recipe works without it |
| `recipe` | no | slug of another recipe used as an ingredient — see sub-recipes below |
| `item` | never written by hand | canonical ingredient slug, resolved by the app on save. See `INGREDIENTS.md`. |

Rules:
- **One ingredient per entry.** `huile d'olive, sel, poivre` is three entries.
- `qty` without `unit` is an error. Countable things use `unit: piece`.
- `unit` without `qty` is an error.
- `to_taste: true` and `qty` together is an error — pick one.
- Never put the quantity inside `name`. `name: 500 g de farine` is wrong.
- Never put the preparation inside `name`. `name: oignon émincé` is wrong; use
  `prep: émincé`. Otherwise the pantry index holds two different ingredients for
  one onion.
- `group` is optional. A recipe with no components can be a single group with
  `group:` omitted.

### Schema version

`schema: 3` on every file. At 5000 files, a format change means a migration script,
and a migration script must know what it is looking at. Files without it are
rejected (`E110`). Costs one line per file now; retrofitting it later means guessing
the version of every file from its shape.

### Sub-recipes

Pâte brisée appears in forty tartes. Béchamel in lasagna, gratins, croque-monsieur.
Copying the sub-recipe into each one means forty copies drifting apart. Instead an
ingredient entry can point at another recipe:

```yaml
  - group: Pâte
    items:
      - { qty: 1, unit: piece, name: pâte brisée, recipe: pate-brisee }
```

- Renders as a link, optionally expandable inline.
- Cost recurses: the sub-recipe's consumed cost, scaled by `qty` against its
  `servings` (or `yield`, below).
- Pantry search recurses: missing flour for the pastry means missing it for the
  tarte — unless `buy_instead` is set (store-bought pastry is a legitimate answer).
- Cycles (`A` uses `B` uses `A`) are a hard error (`E213`).
- A reference to a slug that does not exist yet is a warning (`W306`), not an
  error — during a batch ingest the tarte can arrive before the pastry.

Sub-recipes usually need a `yield` rather than `servings`:
`yield: { qty: 1, unit: piece, note: "pour un moule de 28 cm" }`.

```yaml
      - { qty: 1, unit: piece, name: pâte brisée, recipe: pate-brisee, buy_instead: true }
```

`buy_instead: true` means "a shop-bought one is fine", so pantry search treats a
registry ingredient `pate-brisee` as an acceptable match too.

## Body

Prose only: method, notes, variants. No ingredient list — the app renders that
from frontmatter.

Headings are load-bearing. Either language accepted.

| Section | Accepted headings |
|---|---|
| Method | `Préparation`, `Preparation`, `Instructions`, `Méthode` |
| Notes | `Notes`, `Remarques` |
| Variants | `Variantes`, `Variants` |
| Alternatives | `Alternatives`, `Substitutions` |

Matching is case-insensitive and diacritic-insensitive. When the app writes a file
back out it uses the headings matching the recipe's `lang`.

```markdown
## Préparation

1. Faire revenir l'oignon dans l'huile d'olive.
2. Ajouter l'ail, puis le bœuf haché. Laisser colorer.

### Béchamel
4. Fondre le beurre, ajouter la farine, cuire 1 min.

## Notes

Meilleur réchauffé le lendemain.

## Variantes

- Moitié bœuf, moitié porc pour une sauce plus douce.

## Alternatives

- Pas de parmesan : gruyère râpé fait l'affaire, moins salé.
```

Rules:
- Steps numbered. The app renumbers, so `1.` on every line is acceptable.
- `### Sub-headings` under the method group steps by component.
- Only `## Préparation` is required in the body.
- Sections beyond these four: allowed, ignored by the parser, still rendered.
- Both languages may appear in one vault, never inside one recipe.

## Family pages

Generated, not written. For each distinct `family` the app produces a page listing
every variant plus a diff table — the ingredients unique to each variant and the
differing times. Now exact, because ingredients are structured.
