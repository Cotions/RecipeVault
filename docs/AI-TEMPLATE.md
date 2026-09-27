# Master template — the prompt given to an AI to produce a recipe file

Draft 3.2. Draft 2 was revised after P0 round 1 (ten real Quebec recipes, some 35+
years old, through a free chat AI); draft 3 after round 2, the same ten re-run with
draft 2; draft 3.1 after the checker's first run; draft 3.2 after the decisions on
the checker's stress test. What changed and why is at the end.

This file is the contract. The parser, the validator, cost, and pantry search all
assume output matching it exactly.

How it is used: paste the prompt below into any chat AI (ChatGPT free tier,
Claude, Gemini — anything that reads images), attach the recipe photo, copy the
markdown it returns into RecipeVault's paste box. The app has no AI built in.

The app extracts only the ```` ```markdown ```` fences from a paste and ignores all
other text, so the AI may talk around them — questions, remarks — without breaking
anything.

Keep the prompt here and have the app render it with a copy button; never retype
it. Free tiers forget long instructions over a long chat, so start a fresh chat
every ~10 recipes and paste the prompt again.

---

## The prompt

````text
You convert photographs of recipes into a strict Markdown format.

OUTPUT
- One markdown file per recipe, each inside its own ```markdown fence.
- Several images may be ONE recipe (front and back of a card, two pages):
  combine them into one file, in order.
- One image may hold SEVERAL recipes: one fence per recipe.
- After the fences, you MAY add a section titled QUESTIONS with at most 5
  questions — only things the owner can answer that would change the file (a
  missing quantity, a name you cannot read). Nothing else outside the fences.
- When the user answers, output the complete corrected file(s) again.

REGION
Most recipes are handwritten cards and clippings from Quebec, in Quebec French,
some decades old. Read them with Quebec conventions:
- "t." / "tasse" = cup · "c. à thé" / "c.t." = teaspoon ·
  "c. à table" / "c. à soupe" / "c.s." = tablespoon ·
  "lb" / "livre" = pound · "oz" / "once" = ounce
- An oven temperature with no unit ("350", "350°") is Fahrenheit.
- A ditto mark (") under a word repeats that word.
- Keep Quebec words exactly as written: "piment vert", "fèves", "blé d'Inde",
  "soya", "cassonade". Do not translate them to France French.

TRANSCRIBE, AND MARK EVERYTHING THAT IS NOT A PLAIN READING
1. Copy the source faithfully: wording, quantities, order of steps. Do not
   modernize, do not convert units, do not round.
2. Use exactly these inline markers, nothing else, never prose like
   "(lecture incertaine)":
     [?]           you are unsure of the word or number just before it
     [?: other]    same, and gives the other plausible reading
     [illisible]   you cannot read it at all
     [+]           text you added that is NOT on the source
   In the frontmatter, EVERY value that contains a marker goes in double
   quotes — unquoted, "[?: other]" and any marker inside { } break the file:
   Examples:  author: "Jeanne Tremblay [?: Tremblé]"
              - { qty: "250 [?]", unit: ml, name: "lait [?]" }
              servings: "4 [?]"
              oven: { temp: "350 [?]", unit: F }
              1. Mélanger tous les ingrédients. [+]
   A number, unit, source type or time you cannot read at all is not
   written as a marker: leave that key out and ask in QUESTIONS (rule 4).
3. You MAY add, marked [+], only what is obvious and harmless:
   - a missing "mix the ingredients" step when the card jumps straight to baking
   - a title for an untitled clipping, based on its ingredients
   Moving something that IS on the source to its proper place is not adding:
   an ingredient named only in the steps goes in the ingredient list with no
   [+], because it is written on the card.
4. NEVER invent quantities, times, temperatures, ingredients, or names of
   people. Leave them absent and ask in QUESTIONS.

INGREDIENTS — in frontmatter, never as prose bullets
5. One ingredient per entry. "sel, poivre" is two entries.
6. Fields, all optional except name:
     qty, qty_max, unit, name, brand, note, prep, alt, or, optional, to_taste
7. qty: a number, or a fraction in quotes exactly as written:
     2 · 0.5 · "1 1/2" · "2/3" · "1/8".  Range: qty plus qty_max.
8. unit must be exactly one of:
     g, kg, ml, cl, l, cup, tbsp, tsp, pinch, drop, lb, oz, piece, clove,
     leaf, sprig, stalk, bunch, slice, can, packet, bottle, jar, bag, qt, pint
   qty requires unit, unit requires qty. Countable things use unit: piece.
   A branch of celery is "stalk"; a sprig of thyme is "sprig".
   "boîte" is a can; "pot" (1 pot de moutarde) is a jar; "sac" a bag.
9. When the source gives two measures ("1 t (250 ml)"): metric goes in
   qty/unit, the other in alt:
     - { qty: 250, unit: ml, name: bouillon, alt: { qty: 1, unit: cup } }
   alt may have its own qty_max: alt: { qty: 2, qty_max: 3, unit: tsp }
10. name is the generic ingredient only — no quantity, no preparation, no size,
    no brand:
      "2 lbs de boeuf en cubes" → { qty: 2, unit: lb, name: boeuf, prep: en cubes }
      "1 gros oignon"           → { qty: 1, unit: piece, name: oignon, note: gros }
      "ketchup Heinz"           → { name: ketchup, brand: Heinz }
    Split out the brand ONLY when what remains still names the product exactly.
    Otherwise keep the whole thing as the name:
      "fromage Philadelphia" → { name: fromage Philadelphia }   ("fromage" alone
                                 would mean any cheese; it is cream cheese)
      "gâteau Duncan Hines"  → { name: gâteau Duncan Hines }    (a cake mix)
      "Cool Whip", "Jell-O", "Minute Rice" → keep as the name
    Never replace a brand with what you think the product is — the app maps
    names to products.
11. Size of a can or pack goes in note: { qty: 1, unit: can, name: tomates,
    note: "796 ml" }. A size printed in two measures keeps both, the second
    in parentheses: note: "19 oz (540 ml)". One size only — an alternative
    amount goes in or.
12. "X ou Y" for one ingredient → { name: X, or: [Y] }. When the alternative
    has its own amount or detail, write it as an object:
      "2 ml cannelle ou 1 ml piment de la Jamaïque" →
        { qty: 2, unit: ml, name: cannelle,
          or: [{ qty: 1, unit: ml, name: piment de la Jamaïque }] }
      "10 feuilles de sauge ou 1 c. à soupe si séchée" →
        { qty: 10, unit: leaf, name: sauge,
          or: [{ qty: 1, unit: tbsp, name: sauge, note: séchée }] }
    Do not repeat any of it in ## Alternatives or in note.
13. to_taste: true ONLY for seasoning and cooking fat with no amount (salt,
    pepper, oil for the pan). Anything else with no amount — noodles to serve,
    bread slices — gets just a name, no qty, no to_taste.
14. Group ingredients by component with group:. A serving suggestion that has
    its own ingredients (a mayonnaise, a sauce) becomes its own group with
    optional: true, and its steps go under a ### sub-heading with the same name
    at the end of the method — not as a "Suggestion:" step. A suggestion with
    no ingredients goes in ## Notes.
15. If an ingredient is another recipe on the same source ("pâte, voir p. 12"),
    add recipe: with that recipe's slug.

FRONTMATTER
16. First line is always schema: 3.
17. title: as written on the source. If there is none, make one and mark it:
    title: "Bouchées au canard [+]"
18. slug: lowercase, ASCII, hyphenated, no accents, from the title without markers.
19. family / variant: set them ONLY if the source presents itself as a version of
    a dish, or if the user says so. The app detects same-named recipes itself.
20. times: only times the source states, as 30m, 1h, 1h15m; ranges as 45m-50m.
    Keys: prep, cook, rest. What the rest is for ("au frigo") goes in the steps.
21. oven: { temp: 350, unit: F } when a temperature is given. Range: temp_max.
22. servings: an integer; range with servings_max. Things not counted in
    portions ("24 biscuits", "1 moule 9x13") go in yield: as text instead.
23. source: everything the source says about where the recipe came from.
      type: family | book | website | magazine | tv | invented
      author: the person the recipe comes from — a name in the corner of a card,
              a website user. Not the guests of a TV show; put those in note.
      title, page, url, note as available.
    If only the kind of source is evident (a printed magazine clipping, a
    printed web page), keep just source: { type: magazine }. Nothing at all →
    omit source. Never guess a name or title.
24. tags: 3 to 6 plain lowercase words: course, method, main ingredient, cuisine.
    Do not repeat the family or the title as a tag.
25. extracted_by: ai. Do not write status or added — the app sets them.
26. Omit any key you have no value for. Never write an empty value.

BODY
27. ## Préparation (French) or ## Instructions (English): numbered steps in
    source order, one action per step.
28. ## Notes: remarks that are not steps, including the source author's own
    comments ("un classique chez nous"), quoted as written.
    ## Variantes: variations the source mentions.
    ## Alternatives: substitutions the source mentions that are not already an
    or: on an ingredient.
    Omit any section the source does not have.

SKELETON

```markdown
---
schema: 3
title:
slug:
lang: fr
source:
  type:
  author:
  title:
  page:
  url:
  note:
times:
  prep:
  cook:
  rest:
oven: { temp: , unit: F }
servings:
tags: []
difficulty:        # 1 easy – 5 hard, your judgement
ingredients:
  - group:
    items:
      - { qty: , unit: , name: , note: , prep: }
extracted_by: ai
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

Invented card, typical of the collection.

**Source:**

```
Pâté chinois (tante Rita)
1 1/2 lb boeuf haché - 1 oignon
1 boite blé d'Inde en crème
1  "     "     "  en grains
5 patates, pilées avec beurre et lait
Dorer viande et oignon. Étager boeuf, blé d'Inde, patates.
Four 350, 30-35 min.
```

**Expected output:**

```markdown
---
schema: 3
title: Pâté chinois
slug: pate-chinois
lang: fr
source:
  type: family
  author: tante Rita
times:
  cook: 30m-35m
oven: { temp: 350, unit: F }
tags: [plat, boeuf, four, québécois]
difficulty: 1
ingredients:
  - group: Viande
    items:
      - { qty: "1 1/2", unit: lb, name: boeuf haché }
      - { qty: 1, unit: piece, name: oignon }
  - group: Blé d'Inde
    items:
      - { qty: 1, unit: can, name: blé d'Inde en crème }
      - { qty: 1, unit: can, name: blé d'Inde en grains }
  - group: Purée
    items:
      - { qty: 5, unit: piece, name: patates, prep: pilées }
      - { name: beurre }
      - { name: lait }
extracted_by: ai
---

## Préparation

1. Dorer la viande et l'oignon.
2. Piler les patates avec le beurre et le lait. [+]
3. Étager le boeuf, le blé d'Inde et les patates.
4. Cuire au four à 350 °F, 30 à 35 min.
```

What each rule did:
- `"1 1/2"` kept as written, `lb` as a real unit — no quantity lost in a note.
- The ditto line became a second can of blé d'Inde, not a guess.
- `beurre` and `lait` for the purée have no amount on the card: named, no qty, and
  *not* `to_taste` — they are not seasoning.
- Step 2 is implied by the ingredient line but not written as a step, so it is
  marked `[+]`.
- `350` with no unit is °F, and lives in `oven:` where kitchen mode can show °C too.

## Revisions after P0

Ten real recipes exposed these problems in draft 1. All fixed above.

| Found | Fix |
|---|---|
| No `cup` or `lb` unit, so most quantities on Quebec cards ended up as text in `note`, invisible to cost, scaling, and pantry search | Units `cup`, `lb`, `oz`, `qt`, `pint`, `stalk` added; Quebec abbreviations spelled out in the prompt |
| "Fractions as decimals" forced the AI to do arithmetic (`2/3` → `0.667`) and contradicted "do not convert" | Fractions kept as written in quotes; the app parses them |
| Both cups and ml on one line — which wins? | Metric in `qty`/`unit`, the other in `alt:` |
| Uncertainty written as free prose, three different ways | Four fixed markers: `[?]`, `[?: other]`, `[illisible]`, `[+]` |
| Cards that skip obvious steps ("mix everything") | Obvious steps may be added, marked `[+]`. Quantities, times, and people never are |
| `to_taste` used for any ingredient without an amount (noodles, bread) | `to_taste` restricted to seasoning and cooking fat — it removes an ingredient from pantry search |
| Brands inside names (`ketchup Heinz`) would split pantry search by brand | `brand:` field |
| "beurre ou huile", "agneau ou veau" hidden in notes, repeated in Alternatives | `or:` field |
| Serving suggestions with their own ingredients crammed into Notes | Their own group, `optional: true` |
| Times as `2 hrs`, `1 1/4 heure`, `45-50 minutes`, `2 heures de réfrigération` | One format: `1h15m`, ranges `45m-50m` |
| Oven temperature only in step text, in four spellings | `oven:` field |
| `servings: 8-10` | `servings_max` |
| AI writing `added` dates it cannot know, and choosing `status` | The app sets both; `needs-review` comes from markers and warnings |
| AI deciding family/variant for one of two same-named recipes but not the other | Family is decided in the app, which sees the whole vault |
| TV show guests recorded as recipe authors | `author` is the recipe's origin; guests go in `note` |
| AI questions had nowhere to go | `QUESTIONS` section after the fences, ignored by the app |

Round 2 — the same ten with draft 2. Units, fractions, times, oven, markers, and
`alt` all came back correct. Remaining:

| Found | Fix |
|---|---|
| Ingredients lifted from the steps marked `[+]` although they are on the card | `[+]` only for content not on the source; moving is not adding |
| An alternative with its own amount ("ou 1 ml piment de la Jamaïque", "1 c. à soupe si séchée") could not fit in `or:` and leaked into `note` and Alternatives | `or:` entries may be full ingredient objects |
| `alt` needed a range | `alt` may carry `qty_max` |
| Brand splitting left vague names: Philadelphia → `fromage` (any cheese), Duncan Hines → `gâteau` | Split only when the rest still names the product exactly |
| A serving suggestion's steps turned into a "Suggestion:" step | Its steps go under a `###` sub-heading named like the group |
| An untitled clipping lost `source.type` entirely | Keep `type` alone when only the kind of source is evident |
| Both "Pain de viande" cards got the slug `pain-de-viande` | Correct per the rules — the app catches the collision (`E103`) and offers a family (`W608`). Kept as a test case |

Draft 3.1 — found by the checker (`docs/plans/01-checker.md`), not by a new round:

| Found | Fix |
|---|---|
| `[?: other]` in an unquoted value is invalid YAML (it reads as a nested `key: value`), and any marker inside a `{ … }` entry opens a list. The prompt's own example `author: Jeanne Tremblay [?: Tremblé]` did not parse | Every frontmatter value containing a marker is double-quoted; examples fixed. The checker's `E002` names the value to quote |

Draft 3.2 — decisions on cases the checker's stress test left open (invented files):

| Found | Fix |
|---|---|
| A can size printed in two measures (`19 oz (540 ml)`) was rejected as two amounts (`E216`); dropping one breaks rule 1, and `alt` is the amount, not the container size | One size plus its parenthesised equivalent is one size (rule 11) |
| `servings: "4 [?]"` and `oven.temp: "350 [?]"` were rejected (`E108`, `E111`), so the fix dropped the marker and claimed a certainty the transcriber did not have | Markers allowed on `servings` and `oven.temp` as on `qty` (rule 2) |
| A bare marker on `qty`, `unit`, `source.type` or a time was told "wrap it in quotes", and the quoted value failed again | An unreadable number, unit, type or time is left out and asked about (rule 2, rule 4); the checker's fix says so |

## Failure modes to watch for

The validator cannot catch these; a glance at the photo can.

- **Invented precision.** "un peu de crème" becoming `qty: 100, unit: ml`.
- **Confident misreading of numbers.** French `1` with its hook read as `7`,
  `4` versus `9`. On old handwriting, check every quantity against the photo.
- **Unmarked guesses.** The markers only work if the AI uses them; an illegible
  word replaced by a plausible one with no `[?]` looks exactly like a clean read.
- **Dropped provenance.** A name in the corner of a card is the easiest thing to
  lose and cannot be recovered once the card is gone.
- **Unmarked additions.** A step the source never had, without `[+]`.

This is why every AI-extracted recipe is marked `extracted_by: ai` and starts as
`draft`: a quick look at the photo before marking it verified catches what the
validator cannot.
