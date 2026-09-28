# Invented recipe corpus

About 320 recipe files in the vault format (`schema: 3`). They are written the way a
chat AI following `docs/AI-TEMPLATE.md` (draft 3.2) would transcribe a Québécois
family's recipe cards from 1990 to 2000. One draft 3.3 rule is applied: the pastry
recipes that others use as sub-recipes give `yield: { qty, unit }` when they make
2 or 3 crusts (rule 15, `yieldObjects` in `scripts/corpus/dishes.ts`), so their
parents' cost can scale; other yields stay text. The corpus is the test bed for the
ingredient registry (plan 03, P1.5): resolution, the answer key, and pantry search.

**Everything here is invented.** The people, the card notes, the books, magazines
and shows, and the recipes are all made up. No file comes from the private vault.
There are no real names, no published recipe titles and no URLs. Brands such as
Crisco, Campbell's, Jell-O or Eagle Brand appear because 1990s cards named them.

## Layout

| Path | What |
|---|---|
| `recipes/*.md` | the corpus. Generated files and hand-written cards together. Do not edit here. |
| `hand/*.md` | about 40 hand-written "messy" cards: ditto marks, typos (`beouf haché`, `patattes`), `or` entries with their own amount, clippings with `alt`, English cards from anglophone neighbours, and every ambiguous name. They are copied into `recipes/` unchanged. Edit these directly. |
| `expected-ingredients.yaml` | the answer key (generated) |
| `../../../scripts/gen-corpus.ts` | the generator |
| `../../../scripts/corpus/ingredients.ts` | the ingredient table: canonical ids, written forms, typos, brands, ambiguous names, confusable pairs |
| `../../../scripts/corpus/dishes.ts` | the dish templates: family variants, groups, steps |

## Regenerate

```sh
npx tsx scripts/gen-corpus.ts             # rewrites recipes/, expected-ingredients.yaml and the table below
npx tsx scripts/gen-corpus.ts --out /tmp/c  # writes somewhere else instead
npx tsx src/cli/vault.ts check --dir tests/fixtures/corpus/recipes
```

Generation is deterministic: it uses a fixed seed and no clock. The generator runs
the checker on every file it writes and throws if a file has an error. It also
throws on three other problems:

- a name that is not in the ingredient table;
- a written form listed under two ids without being declared ambiguous;
- a declared ambiguous name that the corpus never uses;
- a hand card using an ambiguous name without its entry in that name's `hand`
  table (the id the line means, or null when the card does not say), or a
  `hand` entry for a card that does not use the name.

The answer key's `ambiguous` section lists every use of each ambiguous name under
`given`, with the id its line means. The resolution metrics use it to score
disambiguation rules (`docs/INGREDIENTS.md`, "Disambiguation rules").

`tests/unit/corpus-fixture.test.ts` checks the following:

- every file has no errors;
- the slug matches the filename;
- every name resolves through the answer key;
- no variant is listed twice;
- the committed files equal a fresh generation, so after changing the table or the hand cards you must regenerate.

## What the corpus exercises

- **Name variety within what the template allows.** Rule 1 keeps what the card
  says: accents and typos (`boeuf`/`bœuf`/`beouf`), singular and plural
  (`oignon`/`oignons`), and regional or older words for the same product
  (`cassonade`/`sucre brun`, `soda`/`soda à pâte`/`bicarbonate de soude`,
  `lait Carnation`, `gruau`).
- **Traps.** Some pairs look or read alike but are different products:
  - `piment vert` is a bell pepper, not a hot pepper;
  - `échalote` is a green onion, not a French shallot;
  - `pâte` is not `pâtes`;
  - `crème 35 %` is not `crème 15 %`;
  - French `lard` is salt pork, English `lard` is saindoux.

  The `confusables` section of the answer key lists them.
- **Brands.** A brand usually goes in the `brand` field. It stays in the name
  where rule 10 keeps it (`Crisco`, `Jell-O`, `Cheez Whiz`, `KD`, `Bovril`).
- **Structure.**
  - Salt and pepper are two entries.
  - Preparation goes in `prep`; can and packet sizes go in `note`.
  - Printed sources give metric amounts with the cup in `alt`.
  - Also present: sub-recipes (`recipe:`, including one deliberately dangling link), `or`, `optional`, `to_taste`, optional groups, and oven temperatures from 250 to 425 °F.
- **Markers.** `[?]`, `[?: x]`, `[illisible]` and `[+]` appear in names,
  amounts, authors, steps and oven temperatures. Files that contain any of them
  are `needs-review`.
- **Families.** Tourtière, pâté chinois, sauce à spaghetti, tarte au sucre,
  cretons and others appear in several versions from different aunts, books and
  clippings (`family` + `variant`).
- **Sources.**
  - About two thirds are family cards; the rest are books, magazines, TV and radio, or have no source.
  - About 15% are in English.
  - `status` and `added` dates fall in 2026.

The brief described a source type `card`. The schema has no such type, and E106 rejects
it. Cards therefore use `type: family`, with the physical detail in
`source.note` (`fiche jaunie, 1994`).

## The answer key

`expected-ingredients.yaml` is the ground truth for resolution tests. It is derived
from the files, so it lists what the corpus actually says:

- `ingredients`: canonical id → `category`, `staple`, and `variants`. The
  variants are every form written in an item `name` or an `or` entry, with
  markers stripped, exactly as written. Each form appears once in the whole
  file. The first variant is the natural registry name (plan 03, metric R1).
  The trailing comments give the occurrence count, the language, and `typo`
  when normalization cannot fix the spelling.
- `ambiguous`: written forms that are one lookup key for several ids.
  - `tomates` is canned or fresh depending on the unit.
  - `boeuf` is ground or stewing beef depending on `prep`.
  - `fromage`, `bouillon` and `viande hachée` are simply unspecified.

  Unit, prep and language are not part of the lookup key, so the expected result for these forms is *ambiguous*, never one of the candidates.
- `confusables`: id pairs that must never merge.

Open points for plan 03, not decided here:

- **Jell-O flavours.** The flavour sits in `note`, and every flavour is one id,
  `poudre-de-gelee`.
- **Unit or prep deciding the id.** Examples: `tomates` with `unit: can`, `boeuf` with
  `prep: haché`. The key is name-only by design, so these forms are ambiguous.
  If resolution later uses the unit or prep, move these entries from
  `ambiguous` to `ingredients`.

## Variant groups

Generated from the answer key; do not edit by hand.

<!-- variant-table:start -->
| id | category | variants in the corpus (most frequent first) |
|---|---|---|
| `eau` ·staple | autre | eau · eau bouillante · eau froide · eau chaude · eau glacée · water · boiling water · hot water · cold water |
| `cafe` | boisson | café · café fort · café infusé · coffee |
| `jus-d-orange` | boisson | orange juice |
| `jus-de-tomate` | boisson | jus de tomate · jus de tomates |
| `ananas-broye` | conserve | ananas broyé · ananas en morceaux · crushed pineapple |
| `ble-d-inde-en-creme` | conserve | blé d'Inde en crème · creamed corn |
| `ble-d-inde-en-grains` | conserve | blé d'Inde en grains · blé d'Inde · corn |
| `bouillon-de-boeuf` | conserve | bouillon de boeuf · bouillon de bœuf |
| `bouillon-de-poulet` | conserve | bouillon de poulet |
| `cerises-au-marasquin` | conserve | cerises au marasquin · maraschino cherries |
| `champignons-en-conserve` | conserve | champignons en conserve · canned mushrooms |
| `cocktail-de-fruits` | conserve | cocktail de fruits |
| `consomme-de-boeuf` | conserve | beef consommé |
| `creme-de-champignons` | conserve | crème de champignons · cream of mushroom soup |
| `feves-rouges` | conserve | fèves rouges · kidney beans · red kidney beans |
| `lait-condense-sucre` | conserve | lait condensé sucré · lait condensé · Eagle Brand · lait Eagle Brand · sweetened condensed milk · Eagle Brand milk |
| `lait-evapore` | conserve | lait évaporé · lait Carnation · lait en boîte |
| `pate-de-tomates` | conserve | pâte de tomates · concentré de tomate · pâte de tomate · tomato paste |
| `petits-pois` | conserve | petits pois · pois verts · peas |
| `sauce-tomate` | conserve | sauce tomate · tomato sauce |
| `soupe-tomate-condensee` | conserve | soupe aux tomates · crème de tomate · soupe tomate · tomato soup · condensed tomato soup |
| `tomates-en-conserve` | conserve | tomates en conserve · tomates étuvées · stewed tomatoes |
| `babeurre` | cremerie | babeurre · lait de beurre |
| `beurre` ·staple | cremerie | beurre · beurre salé · beurre doux · butter · beure |
| `cheez-whiz` | cremerie | Cheez Whiz |
| `creme-15` | cremerie | crème 15 % · crème de table |
| `creme-35` | cremerie | crème 35 % · crème à fouetter · crème 35% · crème épaisse |
| `creme-sure` | cremerie | crème sure |
| `fromage-a-la-creme` | cremerie | fromage à la crème · Philadelphia |
| `fromage-cheddar` | cremerie | fromage cheddar · cheddar · fromage jaune · old cheddar |
| `fromage-cottage` | cremerie | fromage cottage · cottage cheese |
| `lait` | cremerie | lait · lait 2 % · lait entier · milk · whole milk |
| `margarine` | cremerie | margarine · margarine molle |
| `oeufs` | cremerie | oeufs · oeuf · œufs · œuf · eggs · egg · oeus |
| `parmesan` | cremerie | parmesan |
| `basilic` | epice | basilic |
| `cannelle` | epice | cannelle · cannelle moulue · cinnamon · canelle |
| `clou-de-girofle` | epice | clou de girofle · clous de girofle · girofle · cloves · ground cloves |
| `curcuma` | epice | curcuma · safran des Indes · turmeric |
| `epices-a-marinade` | epice | épices à marinade · épices pour marinades · épices mélangées · pickling spice |
| `fines-herbes` | epice | fines herbes · épices italiennes · assaisonnement italien · Italian seasoning |
| `gingembre-moulu` | epice | gingembre · gingembre moulu · ginger |
| `graines-de-moutarde` | epice | graines de moutarde |
| `gros-sel` | epice | gros sel · sel à marinade · pickling salt |
| `laurier` | epice | laurier · feuille de laurier · bay leaf |
| `moutarde-seche` | epice | moutarde sèche · moutarde en poudre · dry mustard |
| `muscade` | epice | muscade · noix de muscade · nutmeg |
| `oignon-en-poudre` | epice | poudre d'oignon |
| `origan` | epice | origan · oregano |
| `paprika` | epice | paprika |
| `piment-de-la-jamaique` | epice | piment de la Jamaïque · toute-épice |
| `piment-fort-broye` | epice | crushed red pepper |
| `poivre` ·staple | epice | poivre · poivre noir · pepper · black pepper |
| `poudre-de-chili` | epice | poudre de chili · chili powder |
| `sarriette` | epice | sarriette · savory |
| `sel` ·staple | epice | sel · sel de table · salt |
| `sel-d-ail` | epice | sel d'ail |
| `sel-de-celeri` | epice | sel de céleri · sel de celeri · celery salt |
| `thym` | epice | thym · thyme |
| `all-bran` | epicerie | All-Bran |
| `beurre-d-arachide` | epicerie | beurre d'arachides · beurre d’arachides · beurre de peanut · peanut butter |
| `biscuits-soda` | epicerie | biscuits soda · soda crackers |
| `bovril` | epicerie | Bovril · bouillon Bovril |
| `cacao` | epicerie | cacao · poudre de cacao · cocoa |
| `cassonade` | epicerie | cassonade · sucre brun · cassonade dorée · cassonade pâle · brown sugar · light brown sugar · casonade |
| `chapelure` | epicerie | chapelure · miettes de pain · bread crumbs |
| `chapelure-graham` | epicerie | chapelure de biscuits Graham · biscuits Graham · graham crumbs |
| `chocolat-mi-sucre` | epicerie | chocolat mi-sucré · carrés de chocolat mi-sucré · semi-sweet chocolate |
| `chocolat-non-sucre` | epicerie | chocolat non sucré |
| `croustilles` | epicerie | croustilles |
| `cube-bouillon-boeuf` | epicerie | cube de bouillon de boeuf |
| `dattes` | epicerie | dattes · dates |
| `farine-a-patisserie` | epicerie | farine à pâtisserie · farine à gâteau · cake flour |
| `farine-de-ble-entier` | epicerie | farine de blé entier |
| `farine-tout-usage` ·staple | epicerie | farine · farine tout usage · farine tout-usage · farine blanche · flour · all purpose flour · all-purpose flour · farrine |
| `fecule-de-mais` | epicerie | fécule de maïs · fécule |
| `feves-blanches` | epicerie | fèves blanches · fèves · petites fèves blanches · navy beans |
| `flocons-d-avoine` | epicerie | flocons d'avoine · gruau · gruau à cuisson rapide · rolled oats · oatmeal · oats · quick oats |
| `graisse-vegetale` | epicerie | graisse végétale · Crisco · shortening · graisse · graisse Crisco |
| `guimauves` | epicerie | guimauves · petites guimauves · guimauves miniatures · marshmallows |
| `huile-d-olive` | epicerie | huile d'olive |
| `huile-vegetale` ·staple | epicerie | huile · huile végétale · huile de maïs · huile de canola · oil · vegetable oil · salad oil |
| `jus-de-citron` | epicerie | jus de citron |
| `ketchup` | epicerie | ketchup · catsup |
| `kraft-dinner` | epicerie | Kraft Dinner · KD |
| `levure` | epicerie | levure |
| `macaroni` | epicerie | macaroni · macaronis |
| `mayonnaise` | epicerie | mayonnaise · mayo |
| `melasse` | epicerie | mélasse · mélasse de fantaisie · molasses |
| `miracle-whip` | epicerie | Miracle Whip · sauce à salade · salad dressing |
| `moutarde-preparee` | epicerie | moutarde · moutarde préparée · moutarde jaune |
| `noix-de-coco` | epicerie | noix de coco · coconut |
| `noix-de-grenoble` | epicerie | noix de Grenoble · noix · noix de grenoble · walnuts · nuts |
| `nouilles-aux-oeufs` | epicerie | nouilles · nouilles aux oeufs · egg noodles · noodles |
| `orge` | epicerie | orge · orge perlé · pearl barley |
| `pain` | epicerie | pain · pain blanc · bread |
| `pate-a-tarte` | epicerie | pâte à tarte · pâte brisée · abaisse · fond de tarte · croûte à tarte · pie crust · pastry · pie shell · unbaked pie shell |
| `pates-alimentaires` | epicerie | pâtes |
| `pepites-de-chocolat` | epicerie | pépites de chocolat · brisures de chocolat · Chipits · chocolate chips |
| `pois-jaunes` | epicerie | pois jaunes · pois à soupe · yellow split peas |
| `pouding-instantane` | epicerie | pouding instantané · instant pudding |
| `poudre-a-pate` | epicerie | poudre à pâte · poudre a pate · baking powder |
| `poudre-de-gelee` | epicerie | Jell-O · jello · poudre à gelée |
| `raisins-secs` | epicerie | raisins secs · raisins |
| `rice-krispies` | epicerie | Rice Krispies · céréales Rice Krispies |
| `riz` | epicerie | riz · riz à grains longs · rice |
| `riz-minute` | epicerie | Minute Rice |
| `saindoux` | epicerie | saindoux · graisse Tenderflake |
| `sauce-chili` | epicerie | sauce chili |
| `sauce-hp` | epicerie | sauce HP |
| `sauce-soya` | epicerie | sauce soya · soya |
| `sauce-worcestershire` | epicerie | sauce Worcestershire · sauce Worcester · sauce Worchestershire |
| `sirop-d-erable` | epicerie | sirop d'érable · sirop d’érable |
| `sirop-de-mais` | epicerie | sirop de maïs · corn syrup |
| `soda-a-pate` | epicerie | soda à pâte · bicarbonate de soude · soda · baking soda |
| `son` | epicerie | son · son de blé |
| `soupe-a-l-oignon-sachet` | epicerie | soupe à l'oignon · onion soup mix |
| `spaghetti` | epicerie | spaghetti |
| `sucre-a-glacer` | epicerie | sucre à glacer · sucre en poudre · icing sugar · sucre à glacé |
| `sucre-blanc` ·staple | epicerie | sucre · sucre blanc · sucre granulé · sugar · white sugar · granulated sugar · sucre granullé |
| `vanille` | epicerie | vanille · essence de vanille · extrait de vanille · vanille artificielle · vanilla · vanilla extract · vanile |
| `vinaigre-blanc` | epicerie | vinaigre · vinaigre blanc · vinegar · white vinegar |
| `vinaigre-de-cidre` | epicerie | vinaigre de cidre |
| `persil` | frais | persil · parsley |
| `bananes` | fruit | bananes · bananas |
| `bleuets` | fruit | bleuets · bleuets frais · blueberries |
| `peches` | fruit | pêches · peches · peaches |
| `poires` | fruit | poires · pears |
| `pommes` | fruit | pommes · pommes McIntosh · pommes à cuire · pommes Cortland · apples · McIntosh apples |
| `zeste-de-citron` | fruit | zeste de citron |
| `ail` | legume | ail · gousses d’ail · garlic |
| `betteraves` | legume | betteraves · beets |
| `carottes` | legume | carottes · carotte · carrots · carrot · carrottes |
| `celeri` | legume | céleri · celeri · branches de céleri · celery · cèleri · céléri |
| `chou` | legume | chou · chou vert · cabbage |
| `chou-fleur` | legume | chou-fleur · choufleur · cauliflower |
| `concombres` | legume | concombres · concombre · concombres à mariner · cucumbers |
| `echalote-francaise` | legume | échalotes françaises |
| `echalote-verte` | legume | échalotes · oignon vert · échalote · échalotes vertes · green onions · shallots |
| `feves-germees` | legume | fèves germées |
| `feves-jaunes` | legume | fèves jaunes · haricots jaunes · wax beans |
| `feves-vertes` | legume | fèves vertes · green beans |
| `navet` | legume | navet |
| `oignon` | legume | oignons · oignon · ognon · oignon jaune · onions · onion · oingon · oigon |
| `oignon-rouge` | legume | oignon rouge · red onion |
| `patates` | legume | patates · pommes de terre · patates blanches · patate · potatoes · patattes |
| `piment-fort` | legume | piment fort |
| `piment-rouge` | legume | piment rouge · piments rouges · poivron rouge · red pepper |
| `piment-vert` | legume | piment vert · piments verts · poivron vert · green pepper · green bell pepper |
| `pommes-de-terre-pilees` | legume | patates pilées |
| `tomates-fraiches` | legume | tomates fraîches |
| `tomates-vertes` | legume | tomates vertes |
| `saumon-en-conserve` | poisson | saumon · saumon rose · salmon |
| `thon` | poisson | thon · thon en conserve · tuna |
| `cool-whip` | surgele | Cool Whip |
| `boeuf-a-ragout` | viande | boeuf à ragoût |
| `boeuf-hache` | viande | boeuf haché · bœuf haché · boeuf haché maigre · steak haché · boeuf à hamburger · ground beef · hamburger meat · lean ground beef · beouf haché · boeuf aché |
| `jambon` | viande | jambon · ham |
| `lard-sale` | viande | lard salé · salt pork |
| `lievre` | viande | lièvre |
| `os-de-jambon` | viande | os de jambon · ham bone |
| `pattes-de-cochon` | viande | pattes de cochon |
| `perdrix` | viande | perdrix |
| `poitrines-de-poulet` | viande | poitrines de poulet |
| `porc-epaule` | viande | épaule de porc · soc de porc |
| `porc-hache` | viande | porc haché · porc haché maigre · ground pork |
| `poulet` | viande | poulet · poulet entier · chicken |
| `saucisses-hot-dog` | viande | saucisses à hot-dog |
| `veau-hache` | viande | veau haché · ground veal |
<!-- variant-table:end -->
