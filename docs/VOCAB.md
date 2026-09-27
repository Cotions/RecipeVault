# Controlled vocabularies

Region: the collection is from Quebec. Aliases below cover Quebec French first
(c. à thé, tasse, livre, piment vert), France French and English second.

These lists are the **seed** copied into `vocab/` when a new vault is created. From
then on the live vocabulary is data in the vault, edited by the app. The rules in
this doc still apply. See `STORAGE.md`.

Draft 1. Why this file exists: the vault is bilingual and will hold thousands of
recipes. Free-text tags fragment — `four`, `oven`, and `baked` all describe one
thing, and a filter sidebar listing all three is worse than no sidebar. So: one
canonical term per concept, plus aliases that map onto it. Input is normalized on
save; display uses the reader's language.

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
- Unknown tag on input → suggest the closest canonical match; if accepted none,
  store it with `status: pending` so it is filterable but visibly unreviewed.
  Never silently discard a tag she typed.

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

## Seasons

Fixed, four values plus none: `printemps`, `ete`, `automne`, `hiver`.
Absent means year-round. Aliases: `spring`, `summer`/`été`, `autumn`/`fall`,
`winter`.

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
