# Controlled vocabularies

Region: the collection is from Quebec. Aliases below cover Quebec French first
(c. à thé, tasse, livre, piment vert), France French and English second.

These lists are the **seed** copied into `vocab/` when a new vault is created. From
then on the live vocabulary is data in the vault, edited by the app. The rules in
this doc still apply. See `STORAGE.md`.

Draft 1. Why this file exists: the vault is bilingual and will hold thousands of
recipes. Free-text tags fragment — `four`, `oven`, and `baked` all describe one
thing, and a filter sidebar listing all three is worse than no sidebar. So: one
canonical term per concept, plus aliases that map onto it. Input is mapped at
index time — the file keeps what was written; display uses the reader's language.

Starter lists, to be grown during P0 against real recipes rather than invented
here.

## Tags

```yaml
# canonical: [aliases...]
plat-principal:   [plat, main, main-course, main course, plat principal, repas]
entree:           [starter, appetizer, entrée, hors-doeuvre]
dessert:          [dessert, pudding, pouding, sweet]
accompagnement:   [side, side-dish, garniture]
soupe:            [soup, potage, veloute, velouté]
salade:           [salad]
petit-dejeuner:   [breakfast, petit déjeuner, brunch]
gouter:           [snack, goûter, tea-time]
sauce:            [sauce, dressing, condiment]
boisson:          [drink, beverage, cocktail]
tarte:            [pie, tart, tartes]

# method
four:             [oven, baked, baking, rôti, roast]
poele:            [pan, poêle, fried, sauté, saute]
mijote:           [stew, mijoté, slow-cooked, braise, braised]
cru:              [raw, no-cook, sans-cuisson]
vapeur:           [steamed, steam]
grille:           [grilled, grillé, bbq, barbecue]

# dietary
vegetarien:       [vegetarian, veggie, végétarien, sans-viande]
vegan:            [vegan, végétalien]
sans-gluten:      [gluten-free, gluten free, sans gluten]

# main ingredient
pasta:            [pâtes, pates, noodles]
riz:              [rice]
poisson:          [fish, seafood, fruits-de-mer]
volaille:         [chicken, poultry, poulet]
boeuf:            [beef, bœuf]
porc:             [pork]
legumes:          [vegetables, légumes, veg]
fromage:          [cheese]
chocolat:         [chocolate]

# cuisine
italien:          [italian, italienne]
francais:         [french, française, francaise]
quebecois:        [québécois, québécoise, quebec, québec, traditionnel]
asiatique:        [asian, asiatique]
marocain:         [moroccan, marocaine]
```

Rules:
- Canonical form: lowercase, ASCII, hyphenated, no accents. Keeps URLs, filenames,
  and database values boring.
- Display form comes from a label table per language, not from the canonical
  string. `plat-principal` renders as "Plat principal" or "Main course".
- Unknown tag on input → suggest the closest canonical match (W501); if she
  accepts none, the recipe file keeps the tag as written and the index stores
  it folded as pending (`DATA-FLOW.md`, index schema), so it is filterable but
  visibly unreviewed. Never silently discard a tag she typed. The form offers
  "Ajouter « … »" for it after showing the closest tag (plan 04, Q11 B).
- **Pending tags are settled on `/etiquettes`** (plan 04, Phase 8; Q11 B), one
  commit each: "Nouvelle étiquette" adds it to `vocab/tags.yaml` as a canonical
  tag (slug: folded, ASCII, hyphenated; the written forms the slug does not
  match become its aliases) with its French label; "C'est comme…" adds its
  written forms as aliases of an existing tag. Neither changes a recipe: the
  index maps them. "Retirer" is the one exception, asked for by a person: it
  takes the tag out of every recipe holding it, in one commit.
- **Labels** live in `vocab/tag-labels.yaml`, one entry per line in flow style
  like `families.yaml` (`cabane-a-sucre: { fr: Cabane à sucre }`), seeded by
  `vault init` from "Tag labels" below. Every page that shows a tag shows its
  label: the recipe page maps the tag as written to its canonical tag first
  (aliases included), the filter sidebar and `/etiquettes` show canonical tags.
  A tag without a label shows its slug with hyphens as spaces and a capital;
  on the recipe page, a tag outside the vocabulary (pending) shows as written.
  The app holds no label of its own (plan 04, decision 1).

## Tag labels

The seed of `vocab/tag-labels.yaml`: labels for the seed tags whose slug lost
its accents or reads badly with a capital alone. A vault created before this
seed existed (no file, or a file holding only labels set on `/etiquettes`) gets
the missing ones from `vault ingredients seed`, which adds a label only to a tag
that has none and never rewrites one already there (issue #11). Until then such
a vault shows those tags by their slug.

```yaml
plat-principal: { fr: Plat principal }
entree: { fr: Entrée }
petit-dejeuner: { fr: Petit-déjeuner }
gouter: { fr: Goûter }
poele: { fr: Poêle }
mijote: { fr: Mijoté }
grille: { fr: Grillé }
vegetarien: { fr: Végétarien }
sans-gluten: { fr: Sans gluten }
pasta: { fr: Pâtes }
boeuf: { fr: Bœuf }
legumes: { fr: Légumes }
francais: { fr: Français }
quebecois: { fr: Québécois }
```

## Families

Families are user-created, so they cannot be a fixed list — but they are exactly
where drift hurts most (`lasagna` vs `lasagne` vs `lasagnes` splits one family into
three). Handling:

- Canonical slug per family, same rules as tags: `lasagna`, `tarte-tatin`.
- A `families` table holds the canonical slug plus display names per language.
- On input, the family picker shows existing families first and only offers
  "create a new family" after a fuzzy search found nothing close.
- Creating a near-duplicate family is a warning, not a block — sometimes two
  similar names really are different things.

**Labels.** `vocab/families.yaml` maps a slug to its display names, one entry
per line in flow style:

```yaml
lasagna: { fr: Lasagnes, en: Lasagna }
pate-chinois: { fr: Pâté chinois }
```

The slug is ASCII (`pates`, not `pâtes`), so the label is what every page
shows: the family pages, the family filter, recipe cards and recipe pages. A
family without a label shows its slug with hyphens as spaces and a capital
(`pate-chinois` → "Pate chinois"). The seed is empty (`{}`); a family exists as
soon as a recipe names it, label or not.

**Setting a label (P1).** On `/famille/<slug>`, "Changer le nom de la famille"
sets the French label; an empty field removes it (and the entry once it holds
no label). The write goes through the same guarantees as a recipe save
(`DATA-FLOW.md`, "Family labels"). The paste box's "Mettre en famille" only
writes `family`/`variant` into the new recipe; it does not write a label —
naming the family is a separate, later step on the family page.

**The form (plan 04, Q10 A).** The family picker searches the labels and slugs
(accents and case folded) and offers "Nouvelle famille « … »" only when no
family is within two edits (W502's distance) and none matches exactly. A new
family's French label is her words as typed, written to `families.yaml` in the
recipe's own commit — only when the family has no label yet, never over one.
W608's "En faire deux versions" sets `family`/`variant` on both recipes in one
commit. English
labels (`en`) are kept when present but not edited by the app until there is
an English UI.

## Distinct recipes

`vocab/distinct.yaml` holds the pairs of recipes a person settled as different
recipes on `/doublons` (plan 05, Q14 A; `INGREDIENTS.md`, "Duplicates"): two
recipes with nearly the same ingredients that are not the same card and not two
versions of one dish. A pair listed here is never shown on `/doublons` again,
nor named by W505, whatever the two recipes become. One pair per line, the two
slugs sorted, the lines sorted:

```yaml
# Pairs of recipes settled as different recipes on /doublons …
- [carres-aux-dattes, carres-magiques]
- [cretons, tourtiere]
```

Not seeded: the file is written by the first "Recettes différentes", one commit
`duplicate: <a> ≠ <b>`; its "Annuler" takes the line out again (`undo:
duplicate <a> ≠ <b>`). The app edits it as text — comments are kept, the pair
lines rewritten sorted — and reads it on every request, so a hand edit or a
`git pull` counts at once; it is not in the index, so deleting `cache/` loses
nothing. A line naming a slug no longer in the vault (a recipe sent to the
trash) is ignored. Slugs are permanent (`STORAGE.md`, "Slugs"), so a pair keeps
its meaning.

## Regional ingredient names

Quebec French names map to the same registry entries as France French ones — this
lives in the ingredient registry's alias lists, noted here because it is where the
two dialects actually disagree:

| Quebec | France | Registry note |
|---|---|---|
| piment vert / rouge | poivron vert / rouge | **not** a chili pepper — the most likely mistake |
| fèves (vertes, jaunes, rouges) | haricots | *fèves* in Quebec are beans, not broad beans |
| blé d'Inde | maïs | |
| patates | pommes de terre | |
| cassonade | sucre brun / vergeoise | |
| sauce soya | sauce soja | |
| crème 35 % / 15 % | crème entière / légère | the percentage matters |
| steak haché | bœuf haché | |

## Plurals

How the ingredient resolver strips plurals (`INGREDIENTS.md`, "Resolution";
plan 03, Q2). Data, not code: the seed is copied to `vocab/normalize.yaml`, and
the owner may change it. Per language, each word of a name at least
`min_length` letters long loses the first suffix it ends with (words holding a
digit are left alone). The rule applies to the written name and to every alias
alike, and only as a fallback: an exact alias match always wins, and a singular
form shared by two ingredients resolves to neither (so *pâte* and *pâtes* can be
two ingredients).

```yaml
plurals:
  fr: { suffixes: [x, s], min_length: 4 }
  en: { suffixes: [s], min_length: 4 }
```

## Allergens

The fixed list an ingredient's `allergens` takes its values from, and what
pantry search's "à éviter" offers (plan 03, Q20). Seeded with the Health Canada
priority allergens; copied to `vocab/allergens.yaml`. A value not in the list
is a warning (`W809`) and is ignored.

```yaml
oeuf: { fr: Œufs, en: Eggs }
lait: { fr: Lait, en: Milk }
moutarde: { fr: Moutarde, en: Mustard }
arachide: { fr: Arachides, en: Peanuts }
crustaces: { fr: Crustacés et mollusques, en: Crustaceans and molluscs }
poisson: { fr: Poisson, en: Fish }
sesame: { fr: Sésame, en: Sesame }
soya: { fr: Soya, en: Soy }
sulfites: { fr: Sulfites, en: Sulphites }
noix: { fr: Noix, en: Tree nuts }
gluten: { fr: Blé et gluten, en: Wheat and gluten }
```

## Preparation words

What the cook does to an ingredient, which belongs in `prep`, not in `name`
(`AI-TEMPLATE.md` rule 10; `W302`, plan 03, Q22). Seeded into
`vocab/participles.yaml`. The three name-word lists share one shape: `words`
(one list, or one per language; every language's words apply, as a card may mix
them) and `keep`, names in which a listed word is part of the product's name
rather than something to split out. Words and names are compared case- and
accent-insensitively, as whole words. A word is flagged at the start or the end
of a name (French puts it after the noun, English before) and only when other
words remain, so a name that is the word alone is left alone. A name in `keep`
covering the flagged word is not flagged. Every gender and number form is listed:
the match is exact, with no grammar in code.

```yaml
words:
  fr: [haché, hachée, hachés, hachées, émincé, émincée, émincés, émincées,
       râpé, râpée, râpés, râpées, tranché, tranchée, tranchés, tranchées,
       coupé, coupée, coupés, coupées, pelé, pelée, pelés, pelées,
       fondu, fondue, fondus, fondues, battu, battue, battus, battues,
       tamisé, tamisée, ciselé, ciselée, ciselés, ciselées,
       écrasé, écrasée, écrasés, écrasées, pilé, pilée, pilés, pilées,
       égoutté, égouttée, égouttés, égouttées, épépiné, épépinée, épépinés, épépinées,
       émietté, émiettée, émiettés, émiettées, en cubes]
  en: [chopped, minced, diced, sliced, grated, shredded, melted, beaten, sifted,
       peeled, mashed, drained, cubed, crumbled]
keep: [bœuf haché, porc haché, veau haché, poulet haché, dinde hachée, agneau haché,
       steak haché, viande hachée, noix de coco râpée, coco râpé, tomates pelées,
       ananas écrasé, à fondue, bouillon en cubes, shredded coconut, shredded wheat,
       diced tomatoes]
```

Ground meat, shredded coconut, canned peeled tomatoes are sold that way: the
word names the product, and the registry has them as their own entries.
*Moulu* / *ground* is not in the list for the same reason (*cannelle moulue*).

## Size words

A size, which belongs in `note` (`AI-TEMPLATE.md` rule 10, *1 gros oignon* →
`note: gros`; `W304`). Seeded into `vocab/descriptors.yaml`, same shape as
"Preparation words".

```yaml
words:
  fr: [gros, grosse, grosses, petit, petite, petits, petites, moyen, moyenne, moyens, moyennes,
       grand, grande, grands, grandes]
  en: [large, small, medium, big, jumbo, extra-large]
keep: [gros sel, gros gruau, petits pois, petit pois, petit lait, petits fruits,
       petites guimauves, petites fèves, grand marnier, medium ground, small curd, large flake]
```

*Gros sel*, *petits pois*, *petit lait* (buttermilk), *petits fruits* (berries)
and *petites guimauves* (miniature marshmallows) are products, not sizes.

## Brands

Brands that go in `brand`, not in `name` (`AI-TEMPLATE.md` rule 10, *ketchup
Heinz* → `brand: Heinz`; `W607`). Seeded into `vocab/brands.yaml`, same shape
as "Preparation words"; a brand is flagged anywhere in a name. Only brands
whose removal leaves a name that still says exactly what the product is are
listed: brands that *are* the product on a Québec card (Jell-O, Cool Whip,
Philadelphia, Minute Rice, Cheez Whiz, Miracle Whip, Rice Krispies, Bovril,
Carnation, Eagle Brand, Kraft Dinner) are left out, because rule 10 keeps them
as the name.

```yaml
words: [Heinz, Campbell, Campbell's, Robin Hood, Five Roses, Lantic, Redpath, Windsor,
        Club House, Magic, Cow Brand, Keen's, Fry's, Quaker, Aylmer, Mazola, Crown,
        Clover Leaf, Grandma, Baker's, Lipton, Crosby's, Kraft, Fleischmann's,
        Lea & Perrins, Hellmann's, Squirrel, Crisco, Tenderflake, Catelli, Primo,
        Del Monte, Libby's, Maple Leaf, Schneiders, Becel, Bick's, French's,
        Kellogg's, Christie, Nabisco]
keep: [Kraft Dinner]
```

## Seasons

Fixed, four values plus none: `printemps`, `ete`, `automne`, `hiver`.
Absent means year-round. Aliases: `spring`, `summer`/`été`, `autumn`/`fall`,
`winter`. Any other value is a warning (`W504`); `season` must be a list
(`season: [hiver]`, `E218`).

## Units

Canonical list. The validator rejects anything else (`E201`), so this list is the
authority and must match `AI-TEMPLATE.md` rule 8 exactly.

```yaml
g:      [g, gr, gramme, grammes, gram, grams]
kg:     [kg, kilo, kilos, kilogramme]
ml:     [ml, millilitre, millilitres]
cl:     [cl, centilitre]
l:      [l, litre, litres, liter, L]
cup:    [tasse, tasses, t., t, cup, cups, c.]
tbsp:   [c. à table, c. à soupe, c.s., c. à s., cuillère à soupe, cuil. à soupe, tablespoon, tbsp, T]
tsp:    [c. à thé, c.t., c. à café, cuillère à thé, cuillère à café, cuil. à thé, teaspoon, tsp]
pinch:  [pincée, pincee, pinch]
drop:   [goutte, gouttes, drop, drops]
lb:     [lb, lbs, livre, livres, pound, pounds]
oz:     [oz, once, onces, ounce, ounces]
qt:     [pinte, pintes, quart, qt]
pint:   [chopine, chopines, pint]
piece:  [pièce, piece, pcs, unité, unite]
clove:  [gousse, gousses, clove, cloves]
leaf:   [feuille, feuilles, leaf, leaves]
sprig:  [brin, brins, sprig]
stalk:  [branche de céleri, tige, stalk]
bunch:  [botte, bouquet, bunch]
slice:  [tranche, tranches, slice, slices]
can:    [boîte, boite, bte, conserve, can, tin]
packet: [sachet, paquet, enveloppe, packet, sachets, pqt]
bottle: [bouteille, bouteilles, bottle, bottles]
jar:    [pot, pots, jar, jars]
bag:    [sac, sacs, bag, bags]
```

"branche" alone is deliberately in no list: *branche de céleri* is a stalk,
*branche de thym* is a sprig. The unit depends on the ingredient, so the AI decides
from context.

`cup` means the Canadian metric cup, 250 ml, for conversion. Canadian recipes
printed after metrication give "1 t (250 ml)". Very old cards may predate that
(an imperial cup is ~227 ml); the difference is under 10% and irrelevant to cost.

`tbsp` alias `T` (capital) and `tsp` alias `t` (lowercase) is an English convention
that collides with French `t.` = tasse. French recipes: `t.` is a cup. English
recipes: `T` is a tablespoon, `t` a teaspoon. The parser picks by the recipe's
`lang`.

No conversions between mass and volume without a per-ingredient `density`, and no
generic mass for `tbsp`/`tsp` — a tablespoon of flour and one of honey are not the
same weight. See `INGREDIENTS.md`.

`clove`, `leaf`, `sprig`, `bunch`, `slice`, `can`, `packet`, `bottle`, `jar`, `bag` exist because real
recipes use them constantly and folding them into `piece` loses the information
that makes a price computable: one clove of garlic is not one garlic.

`boîte` stays an alias of `can` only: on a Québec card it almost always means a
can, not a box. `pot` is a jar (*1 pot de moutarde*).

## Unit labels

The seed of `vocab/unit-labels.yaml`: the word each canonical unit shows on a
page, per language, singular then plural (`[tasse, tasses]`); one word stands
for both (`c. à table`). French takes the plural from 2 (`1 ½ tasse`,
`2 tasses`), English above 1; that rule is grammar and stays in the code. The
words are regional (*c. à table* here, *c. à soupe* in France), so they are data
(plan 05, "Also decided"). `piece` has no word: a bare count (`3 oignons`).

A unit missing from the file, or a vault without it, shows its canonical code
(`tbsp`). `vault init` writes the file; `vault ingredients seed` adds it to an
older vault, or adds only the units and languages the vault's copy lacks,
never rewriting a word already there.

```yaml
g:      { fr: g, en: g }
kg:     { fr: kg, en: kg }
ml:     { fr: ml, en: ml }
cl:     { fr: cl, en: cl }
l:      { fr: L, en: L }
cup:    { fr: [tasse, tasses], en: [cup, cups] }
tbsp:   { fr: c. à table, en: tbsp }
tsp:    { fr: c. à thé, en: tsp }
pinch:  { fr: [pincée, pincées], en: [pinch, pinches] }
drop:   { fr: [goutte, gouttes], en: [drop, drops] }
lb:     { fr: lb, en: lb }
oz:     { fr: oz, en: oz }
qt:     { fr: [pinte, pintes], en: [quart, quarts] }
pint:   { fr: [chopine, chopines], en: [pint, pints] }
clove:  { fr: [gousse, gousses], en: [clove, cloves] }
leaf:   { fr: [feuille, feuilles], en: [leaf, leaves] }
sprig:  { fr: [brin, brins], en: [sprig, sprigs] }
stalk:  { fr: [branche, branches], en: [stalk, stalks] }
bunch:  { fr: [botte, bottes], en: [bunch, bunches] }
slice:  { fr: [tranche, tranches], en: [slice, slices] }
can:    { fr: [boîte, boîtes], en: [can, cans] }
packet: { fr: [sachet, sachets], en: [packet, packets] }
bottle: { fr: [bouteille, bouteilles], en: [bottle, bottles] }
jar:    { fr: [pot, pots], en: [jar, jars] }
bag:    { fr: [sac, sacs], en: [bag, bags] }
```

## Conversions

Factors for cost (`INGREDIENTS.md`, "Unit conversion"), seeded into
`vocab/conversions.yaml`. They are regional data, not code: the owner edits the
vault's copy, and the app reads nothing else. `mass` is grams for one of the
unit, `volume` millilitres for one of the unit. A unit absent here converts to
nothing: it is priced only against a price row in the same unit, or through the
ingredient's own `weights`.

```yaml
mass:
  g: 1
  kg: 1000
  lb: 453.6
  oz: 28.35
volume:
  ml: 1
  cl: 10
  l: 1000
  cup: 250
  tbsp: 15
  tsp: 5
  qt: 1136
  pint: 568
```

`cup` is the Canadian metric cup (see Units). `tbsp`/`tsp` are Canadian metric
spoons, consistent with it. `qt` (*pinte*) and `pint` (*chopine*) are imperial:
old Quebec cards predate metrication (plan 03, Q10). `pinch` and `drop` have no
volume on purpose: a pinch of salt and one of saffron are priced only through
the ingredient's `weights`. Mass to volume always needs the ingredient's
`density`; it is never taken from this file.

## Scaling

The seed of `vocab/scaling.yaml` (plan 05, Q2–Q4, Q8): how a recipe read at
another amount shows its quantities. Regional data like the conversions: which
fractions a Québec kitchen's cups and spoons measure, and how many teaspoons make
a tablespoon, are this file's, not the code's. The file only changes what is
shown; nothing scaled is ever written (Q9).

```yaml
tolerance: 0.1
approx: 0.02
factor: { min: 0.1, max: 20 }
fractions:
  cup: [1/4, 1/3, 1/2, 2/3, 3/4]
  tbsp: [1/2]
  tsp: [1/8, 1/4, 1/2, 3/4]
  lb: [1/4, 1/2, 3/4]
  oz: [1/2]
  kg: []
  l: []
  pinch: []
  drop: []
  count: [1/2]
  container: [1/2]
  default: [1/4, 1/3, 1/2, 2/3, 3/4]
always: [cup, tbsp, tsp, pinch, drop, count, container]
ladder:
  - { unit: tsp, into: tbsp, per: 3, from: 1 }
  - { unit: tbsp, into: cup, per: 16 }
  - { unit: oz, into: lb, per: 16 }
  - { unit: g, into: kg, per: 1000 }
  - { unit: ml, into: l, per: 1000 }
metric:
  units: [g, ml]
  steps:
    - { from: 0, step: 1 }
    - { from: 100, step: 5 }
    - { from: 1000, step: 25 }
```

The rules, applied to each amount (`qty`, `qty_max`, `alt`, `or` amounts, the
yield) when the factor is not 1:

- **Factor 1 is the card.** Nothing is snapped, moved or marked: the amount
  shows as written.
- **Fractions.** An amount shows as a whole number plus one of its unit's
  fractions (`fractions`: a canonical unit, else its class — `mass`, `volume`,
  `count`, `container` — else `default`; `[]` means whole numbers only). Only
  the fractions with a glyph are read: `1/8 1/4 1/3 3/8 1/2 5/8 2/3 3/4 7/8`.
- **Tolerance.** The nearest allowed value is taken when it is within
  `tolerance` (10 %) of the exact amount. A unit or class in `always` snaps to
  its nearest value whatever the distance, and never to 0 (a quarter of an egg
  shows `≈ ½`); any other unit beyond the tolerance shows a short decimal
  (`0,67 lb`).
- **The mark.** `≈` shows before an amount more than `approx` (2 %) away from
  the exact one.
- **Metric.** The `metric.units` round to the step of the first `from` they
  reach, counting down from the largest (1 g below 100, 5 g from 100, 25 g from
  1000), and never to 0.
- **The ladder** (Q3 B). Kitchen equivalences, not the cost factors (a cup is
  250 ml for cost, 16 tablespoons here). Within the written unit's ladder only
  (never mass to volume, never `lb` to `g`). A larger unit is taken when the
  amount reaches the rung's `from` (else the larger unit's smallest value) and
  shows there within 2 % (`6 c. à thé` → `2 c. à table`, `20 c. à table` →
  `1 ¼ tasse`, `1000 g` → `1 kg`; `from: 1` keeps `1 ½ c. à thé` rather than
  `½ c. à table`). A smaller one when the amount falls below the written unit's
  smallest value (`⅛ tasse` → `2 c. à table`), or when nothing in the written
  unit is within the tolerance (`0,89 tasse` → `14 c. à table`) — but never as
  many of it as make one of the next (`18 c. à table` is more than a cup: the
  cup shows, marked). Among exact results the largest unit wins; otherwise the
  closest.
- **Ranges** scale both ends in one unit; two ends that show the same value
  show once.
- **`factor`** caps what a link or a typed amount may ask for (×0.1 to ×20); a
  value outside it is ignored.

A vault without the file, or with a file that does not read, shows every amount
as before this plan: the exact value, as a fraction glyph when one is within 2 %,
else a decimal. An entry that does not read (an unknown unit, a fraction without
a glyph, a negative step) is dropped, the rest kept. `vault init` writes the
file; `vault ingredients seed` adds it to an older vault, never over one already
there.
