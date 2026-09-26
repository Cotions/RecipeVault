# Controlled vocabularies

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
plat-principal:   [main, main-course, main course, plat principal]
entree:           [starter, appetizer, entrée, hors-doeuvre]
dessert:          [dessert, pudding, sweet]
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

## Seasons

Fixed, four values plus none: `printemps`, `ete`, `automne`, `hiver`.
Absent means year-round. Aliases: `spring`, `summer`/`été`, `autumn`/`fall`,
`winter`.

## Units

Canonical list. The validator rejects anything else (`E201`), so this list is the
authority and must match `AI-TEMPLATE.md` rule 12 exactly.

```yaml
g:      [g, gr, gramme, grammes, gram, grams]
kg:     [kg, kilo, kilos, kilogramme]
ml:     [ml, millilitre, millilitres]
cl:     [cl, centilitre]
l:      [l, litre, litres, liter, L]
tbsp:   [c. à soupe, cuillère à soupe, cuillere a soupe, cas, cs, tablespoon, tbsp]
tsp:    [c. à café, cuillère à café, cuillere a cafe, cac, cc, teaspoon, tsp]
pinch:  [pincée, pincee, pinch]
drop:   [goutte, gouttes, drop, drops]
piece:  [pièce, piece, pcs, unité, unite]
clove:  [gousse, gousses, clove, cloves]
leaf:   [feuille, feuilles, leaf, leaves]
sprig:  [brin, brins, sprig, branche]
bunch:  [botte, bouquet, bunch]
slice:  [tranche, tranches, slice, slices]
can:    [boîte, boite, conserve, can, tin]
packet: [sachet, paquet, packet, sachets]
```

No conversions between mass and volume without a per-ingredient `density`, and no
generic mass for `tbsp`/`tsp` — a tablespoon of flour and one of honey are not the
same weight. See `INGREDIENTS.md`.

`clove`, `leaf`, `sprig`, `bunch`, `slice`, `can`, `packet` exist because real
recipes use them constantly and folding them into `piece` loses the information
that makes a price computable: one clove of garlic is not one garlic.
