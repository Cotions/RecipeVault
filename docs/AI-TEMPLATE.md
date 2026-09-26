# Master template — the prompt given to an AI to produce a recipe file

Draft 1. This file is the contract. Everything downstream — the parser, the
validator, the cost engine, pantry search — assumes output matching it exactly.

Two consumers:
- **Me, by hand.** Paste a photo into any AI chat along with the prompt below,
  copy the result into RecipeVault's paste box.
- **The batch ingest script (P3).** Sends the same prompt via the Claude API with
  structured output, over a directory of photos.

Both use the same text, so a fix to the prompt improves both. Keep it in this file
and have the app render it with a copy button — never retyped from memory.

---

## The prompt

````text
You convert photographs of recipes into a strict Markdown format. Output one
markdown file per recipe, each inside its own ```markdown fence. Output nothing
else — no commentary, no explanation before or after.

- Several images may belong to ONE recipe (front and back of a card, two pages
  of a book). Combine them into a single file, in order.
- One image may contain SEVERAL recipes (a magazine page, a notebook spread).
  Output one fenced file per recipe.
- If you cannot tell whether two images are one recipe or two, treat them as two
  and add a `## Notes` line saying so.

RULES

1. Transcribe, do not improve. Keep the original wording, quantities, and order.
   Do not add steps, do not modernize, do not convert units, do not round.
2. Write in the language of the source recipe. Set `lang: fr` or `lang: en`
   accordingly.
3. Illegible text: write the part you can read, put `[illisible]` / `[illegible]`
   where you cannot, and set `status: needs-review`. Never guess a quantity.
4. Ingredients go in frontmatter as structured entries. Never as prose bullets.
5. ONE INGREDIENT PER ENTRY. A line reading "olive oil, salt, pepper" becomes
   three separate entries.
6. Never put a quantity inside `name`. Wrong: `name: 500 g flour`.
   Right: `qty: 500, unit: g, name: flour`.
7. Never put preparation inside `name`. Wrong: `name: minced onion`.
   Right: `qty: 1, unit: piece, name: onion, prep: minced`.
8. Never put a size descriptor inside `name`. Wrong: `name: large onion`.
   Right: `qty: 1, unit: piece, name: onion, note: large`.
9. `qty` requires `unit`, and `unit` requires `qty`. Countable things use
   `unit: piece`.
10. Ingredients with no quantity given — salt, pepper, oil to taste — use
    `to_taste: true` and no `qty`, no `unit`.
11. Fractions as decimals: `0.5`, never `1/2`. Ranges: `qty` plus `qty_max`.
12. `unit` must be exactly one of:
    g, kg, ml, cl, l, tbsp, tsp, pinch, drop, piece, clove, leaf, sprig, bunch,
    slice, can, packet
13. Group ingredients with `group:` when the recipe has components (sauce, dough,
    topping). If it has none, use one group and omit the `group:` key.
14. Steps: numbered list under `## Préparation` (fr) or `## Instructions` (en).
    One action per step, in source order.
15. `## Notes` for remarks that are not steps. `## Variantes` for variations the
    source mentions. `## Alternatives` for substitutions it mentions. Omit any
    section the source does not contain — do not invent content to fill them.
16. Anything written about who the recipe came from — a name, a book, a magazine,
    a website — goes in `source`. This matters; do not drop it.
17. `slug`: lowercase, ASCII, hyphenated, no accents, derived from the title. If
    the recipe is clearly a variant of a dish family (lasagna, tarte, soup), set
    `family` to the family slug and `variant` to what distinguishes this one, and
    prefix the slug with the family.
18. `tags`: 3 to 6 plain words describing course, method, main ingredient, and
    cuisine. Lowercase, singular, in the recipe's language. Do not invent
    elaborate tags.
19. `status: draft` always, unless rule 3 applies, in which case
    `status: needs-review`.
20. `extracted_by: claude`.
21. Omit any key you have no value for. Never write an empty value.
22. First frontmatter line is always `schema: 3`.
23. If an ingredient is itself a recipe written elsewhere on the same source
    ("pâte brisée, voir page 12"), add `recipe:` with that recipe's slug. If the
    source says a bought one is fine, add `buy_instead: true`.

OUTPUT SKELETON

```markdown
---
schema: 3
title:
slug:
lang: fr
family:
variant:
source:
  type:            # family | book | website | magazine | tv | invented
  author:
  url:
  title:
  page:
  note:
times:
  prep:
  cook:
  rest:
servings:
tags: []
season: []
difficulty:        # 1 easy - 5 hard, your judgement
rating:            # only if the source shows one
ingredients:
  - group:
    items:
      - { qty: , unit: , name: , note: , prep: }
status: draft
added:             # today, YYYY-MM-DD
extracted_by: claude
---

## Préparation

1.

## Notes

## Variantes

## Alternatives
```
````

---

## Worked example

**Source:** a handwritten card, stained, reading roughly —

```
Lasagnes de Mamie Jeanne (pour 6)
500g boeuf hache - 1 gros oignon emince - 2 gousses ail
1 grosse boite tomates (800g) - 2 cs concentre
laurier, huile d'olive, sel poivre
bechamel: 50g beurre 50g farine 1/2 L lait muscade
12 feuilles lasagne, 100g parmesan rape
Faire revenir oignon, ajouter ail et viande, colorer.
Tomates + concentre + laurier, reduire 25 min.
Bechamel classique. Monter en alternant. Four 180 45min.
Repos 10 min. Meilleur le lendemain !
```

**Expected output** — note how each rule bites:

```yaml
ingredients:
  - group: Sauce bolognaise
    items:
      - { qty: 500, unit: g, name: bœuf haché }
      - { qty: 1, unit: piece, name: oignon, note: gros, prep: émincé }   # rules 7, 8
      - { qty: 2, unit: clove, name: ail }                                # rule 12
      - { qty: 800, unit: g, name: tomates concassées }
      - { qty: 2, unit: tbsp, name: concentré de tomate }
      - { qty: 1, unit: leaf, name: laurier }
      - { name: huile d'olive, to_taste: true }                           # rules 5, 10
      - { name: sel, to_taste: true }
      - { name: poivre, to_taste: true }
  - group: Béchamel
    items:
      - { qty: 50, unit: g, name: beurre }
      - { qty: 50, unit: g, name: farine }
      - { qty: 500, unit: ml, name: lait }                                # 1/2 L → 500 ml
      - { qty: 1, unit: pinch, name: muscade }
```

Plus `family: lasagna`, `variant: bolognaise`, `slug: lasagna-bolognaise`,
`source: {type: family, author: Mamie Jeanne}`, `servings: 6`, and
"Meilleur le lendemain !" under `## Notes`, not as a step.

The full expected file is `recipes/lasagna-bolognaise.md`.

## Failure modes seen in practice

Worth watching for when reviewing AI output, because the validator cannot catch
all of them:

- **Invented precision.** A source saying "un peu de crème" becomes
  `qty: 100, unit: ml`. Should be `to_taste: true`. The validator cannot detect
  this — only comparing against the scan can.
- **Merged ingredients** surviving rule 5, usually `sel et poivre` as one entry.
- **Preparation smuggled into the name**, which silently splits the pantry index
  into `tomate` and `tomate pelée`.
- **Dropped provenance.** A grandmother's name in the corner of a card is the part
  that cannot be recovered later. Rule 16 exists because it is the easiest thing
  to lose and the most painful.
- **Helpful additions.** Steps the source never had, because the dish "needs" them.

This is why every AI-extracted recipe keeps its scan, is marked
`extracted_by: claude`, and starts as `draft` rather than `verified`.
