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
- Unknown tag on input → suggest the closest canonical match; if accepted none,
  store it with `status: pending` so it is filterable but visibly unreviewed.
  Never silently discard a tag she typed.
- **Pending tags are settled on `/etiquettes`** (plan 04, Phase 8; Q11 B), one
  commit each: "Nouvelle étiquette" adds it to `vocab/tags.yaml` as a canonical
  tag (slug: folded, ASCII, hyphenated; the written forms the slug does not
  match become its aliases) with its French label; "C'est comme…" adds its
  written forms as aliases of an existing tag. Neither changes a recipe: the
  index maps them. "Retirer" is the one exception, asked for by a person: it
  takes the tag out of every recipe holding it, in one commit.
- **Labels** live in `vocab/tag-labels.yaml`, one entry per line in flow style
  like `families.yaml` (`cabane-a-sucre: { fr: Cabane à sucre }`); not seeded.
  A tag without one shows its slug with hyphens as spaces and a capital (the
  seed tags whose slug lost its accents have labels in the app until they are
  moved to that file).

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
naming the family is a separate, later step on the family page. English
labels (`en`) are kept when present but not edited by the app until there is
an English UI.

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
