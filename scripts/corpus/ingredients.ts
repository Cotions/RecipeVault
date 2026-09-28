// The answer key behind tests/fixtures/corpus: every canonical ingredient the
// corpus uses, and every way a card (as transcribed by an AI following
// docs/AI-TEMPLATE.md) writes its name. Invented data, written for the corpus.
//
// A form is written "name*weight". The weight steers how often the generator
// picks it; weight 0 means "never generated", a form only a hand-written card
// uses. Forms appear in expected-ingredients.yaml only if some corpus file
// actually uses them.

export type Category =
  | "frais"
  | "viande"
  | "poisson"
  | "legume"
  | "fruit"
  | "cremerie"
  | "epicerie"
  | "conserve"
  | "surgele"
  | "epice"
  | "boisson"
  | "autre";

export interface IngDef {
  cat: Category;
  /** Assumed in the cupboard (INGREDIENTS.md §staple). */
  staple?: boolean;
  /** French forms, any amount. */
  fr: string[];
  /** English forms, any amount. */
  en: string[];
  /** Forms used instead of `fr`/`en` when the amount is one piece (singular). */
  one?: { fr?: string[]; en?: string[] };
  /** Forms used instead when the unit is this one (e.g. `gousse d'ail` with `piece`). */
  byUnit?: Record<string, { fr?: string[]; en?: string[] }>;
  /** Misspellings a card has and a faithful transcription keeps. */
  typos?: string[];
  /** Values the generator may put in `brand:` next to a generic name. */
  brands?: string[];
  /** Why a merge or a split was chosen — copied into the answer key. */
  note?: string;
}

export const INGREDIENTS: Record<string, IngDef> = {
  // --- baking staples -----------------------------------------------------
  "farine-tout-usage": {
    cat: "epicerie",
    staple: true,
    fr: [
      "farine*10",
      "farine tout usage*3",
      "farine tout-usage*2",
      "farine blanche",
      "Farine*0",
    ],
    en: ["flour*5", "all-purpose flour*2", "all purpose flour"],
    typos: ["farrine"],
    brands: ["Five Roses", "Robin Hood"],
  },
  "farine-a-patisserie": {
    cat: "epicerie",
    fr: ["farine à pâtisserie*3", "farine à gâteau"],
    en: ["cake flour*2", "pastry flour"],
    note: "Not all-purpose flour: a different product on the shelf.",
  },
  "farine-de-ble-entier": {
    cat: "epicerie",
    fr: ["farine de blé entier"],
    en: ["whole wheat flour"],
  },
  "sucre-blanc": {
    cat: "epicerie",
    staple: true,
    fr: ["sucre*10", "sucre blanc*3", "sucre granulé*2"],
    en: ["sugar*5", "white sugar*2", "granulated sugar"],
    typos: ["sucre granullé"],
    brands: ["Redpath", "Lantic"],
  },
  "sucre-a-glacer": {
    cat: "epicerie",
    fr: ["sucre à glacer*5", "sucre en poudre"],
    en: ["icing sugar*3", "confectioners sugar"],
    typos: ["sucre à glacé"],
  },
  cassonade: {
    cat: "epicerie",
    fr: ["cassonade*10", "sucre brun*2", "cassonade pâle", "cassonade dorée"],
    en: ["brown sugar*5", "light brown sugar"],
    typos: ["casonade"],
    brands: ["Redpath", "Lantic"],
    note: "Quebec cassonade = brown sugar; pâle/dorée/foncée are shades of one product.",
  },
  beurre: {
    cat: "cremerie",
    staple: true,
    fr: ["beurre*12", "beurre doux", "beurre salé"],
    en: ["butter*5"],
    typos: ["beure"],
  },
  margarine: {
    cat: "cremerie",
    fr: ["margarine*4", "margarine molle"],
    en: ["margarine*2"],
    brands: ["Parkay", "Imperial"],
  },
  "graisse-vegetale": {
    cat: "epicerie",
    fr: [
      "graisse végétale*4",
      "Crisco*3",
      "graisse Crisco*2",
      "graisse*2",
      "shortening",
    ],
    en: ["shortening*3", "Crisco*2", "vegetable shortening"],
    brands: ["Crisco"],
    note: "On these cards 'graisse' alone is shortening; lard is written 'saindoux' or 'Tenderflake'.",
  },
  saindoux: {
    cat: "epicerie",
    fr: ["saindoux*3", "graisse Tenderflake*2", "Tenderflake"],
    en: ["lard*3", "Tenderflake lard"],
    brands: ["Tenderflake"],
    note: "English 'lard' is saindoux. French 'lard' is salt pork (lard-sale) — same key, two languages.",
  },
  "huile-vegetale": {
    cat: "epicerie",
    staple: true,
    fr: ["huile*5", "huile végétale*4", "huile de maïs", "huile de canola"],
    en: ["oil*2", "vegetable oil*3", "salad oil"],
    brands: ["Mazola"],
    note: "Corn and canola oil merged: interchangeable neutral oil on these cards.",
  },
  "huile-d-olive": {
    cat: "epicerie",
    fr: ["huile d'olive"],
    en: ["olive oil"],
  },
  sel: {
    cat: "epice",
    staple: true,
    fr: ["sel*12", "sel de table"],
    en: ["salt*5"],
    brands: ["Windsor"],
  },
  "gros-sel": {
    cat: "epice",
    fr: ["gros sel*3", "sel à marinade*2"],
    en: ["pickling salt*2", "coarse salt"],
    note: "Not table salt: pickling needs it, and it is priced differently.",
  },
  poivre: {
    cat: "epice",
    staple: true,
    fr: ["poivre*12", "poivre noir"],
    en: ["pepper*5", "black pepper"],
  },
  oeufs: {
    cat: "cremerie",
    fr: ["oeufs*6", "œufs*4"],
    en: ["eggs*4"],
    one: { fr: ["oeuf*3", "œuf*2"], en: ["egg"] },
    typos: ["oeus"],
  },
  lait: {
    cat: "cremerie",
    fr: ["lait*12", "lait 2 %*2", "lait entier"],
    en: ["milk*5", "whole milk"],
    note: "Fat content (2 %, entier) folded into one entry. 'lait' never means evaporated or condensed milk.",
  },
  "lait-evapore": {
    cat: "conserve",
    fr: ["lait évaporé*5", "lait Carnation*3", "lait en boîte"],
    en: ["evaporated milk*3", "Carnation milk"],
    brands: ["Carnation"],
    note: "'lait Carnation' keeps the brand in the name (template rule 10: 'lait' alone would be milk).",
  },
  "lait-condense-sucre": {
    cat: "conserve",
    fr: [
      "lait condensé sucré*5",
      "lait condensé*2",
      "lait Eagle Brand*3",
      "Eagle Brand",
    ],
    en: ["sweetened condensed milk*3", "Eagle Brand milk*2"],
    brands: ["Eagle Brand"],
    note: "'lait condensé' on these cards is always the sweetened one.",
  },
  "creme-35": {
    cat: "cremerie",
    fr: ["crème 35 %*5", "crème à fouetter*4", "crème 35%", "crème épaisse"],
    en: ["whipping cream*3", "heavy cream"],
    note: "The percentage is the product: never merge with crème 15 % or 10 %.",
  },
  "creme-15": {
    cat: "cremerie",
    fr: ["crème 15 %*4", "crème de table*2", "crème à cuisson"],
    en: ["light cream*2", "table cream"],
  },
  "creme-10": {
    cat: "cremerie",
    fr: ["crème 10 %*2", "crème à café*2"],
    en: ["half-and-half", "coffee cream*2"],
  },
  "creme-sure": {
    cat: "cremerie",
    fr: ["crème sure*4", "crème sûre"],
    en: ["sour cream*2"],
  },
  babeurre: {
    cat: "cremerie",
    fr: ["babeurre*4", "lait de beurre"],
    en: ["buttermilk*3"],
  },
  "poudre-a-pate": {
    cat: "epicerie",
    fr: ["poudre à pâte*8", "poudre a pate"],
    en: ["baking powder*4"],
    brands: ["Magic"],
    note: "Confusable with soda à pâte (baking soda).",
  },
  "soda-a-pate": {
    cat: "epicerie",
    fr: ["soda à pâte*7", "bicarbonate de soude*2", "soda"],
    en: ["baking soda*4", "soda"],
    brands: ["Cow Brand"],
  },
  vanille: {
    cat: "epicerie",
    fr: [
      "vanille*8",
      "essence de vanille*4",
      "extrait de vanille",
      "vanille artificielle",
    ],
    en: ["vanilla*4", "vanilla extract"],
    typos: ["vanile"],
    brands: ["Club House"],
  },
  "essence-d-amande": {
    cat: "epicerie",
    fr: ["essence d'amande"],
    en: ["almond extract"],
  },
  "fecule-de-mais": {
    cat: "epicerie",
    fr: ["fécule de maïs*5", "fécule*2", "amidon de maïs"],
    en: ["cornstarch*3"],
  },
  levure: {
    cat: "epicerie",
    fr: ["levure*3", "levure sèche active*2", "levure Fleischmann"],
    en: ["yeast*2", "dry yeast"],
    brands: ["Fleischmann's"],
  },
  gelatine: {
    cat: "epicerie",
    fr: ["gélatine*3", "gélatine sans saveur*2"],
    en: ["unflavoured gelatin*2", "gelatin"],
    brands: ["Knox"],
  },

  // --- spices and seasonings ----------------------------------------------
  cannelle: {
    cat: "epice",
    fr: ["cannelle*8", "cannelle moulue"],
    en: ["cinnamon*4"],
    typos: ["canelle"],
    brands: ["Club House"],
  },
  muscade: {
    cat: "epice",
    fr: ["muscade*5", "noix de muscade*2"],
    en: ["nutmeg*3"],
    brands: ["Club House"],
  },
  "clou-de-girofle": {
    cat: "epice",
    fr: ["clou de girofle*3", "clous de girofle*4", "girofle"],
    en: ["cloves*2", "ground cloves"],
    brands: ["Club House"],
  },
  "gingembre-moulu": {
    cat: "epice",
    fr: ["gingembre*5", "gingembre moulu*2"],
    en: ["ginger*3", "ground ginger"],
  },
  "piment-de-la-jamaique": {
    cat: "epice",
    fr: ["piment de la Jamaïque*3", "toute-épice"],
    en: ["allspice*2"],
    note: "A spice, not a pepper: piment here is neither piment vert nor piment fort.",
  },
  "epices-a-marinade": {
    cat: "epice",
    fr: ["épices à marinade*4", "épices pour marinades*2", "épices mélangées"],
    en: ["pickling spice*2", "mixed pickling spice"],
  },
  sarriette: { cat: "epice", fr: ["sarriette*5"], en: ["savory*2"] },
  thym: { cat: "epice", fr: ["thym*3"], en: ["thyme*2"] },
  laurier: {
    cat: "epice",
    fr: ["laurier*4", "feuille de laurier*2"],
    en: ["bay leaf*2"],
    byUnit: { leaf: { fr: ["laurier*3"], en: ["bay leaf"] } },
  },
  persil: { cat: "frais", fr: ["persil*4", "persil frais"], en: ["parsley*2"] },
  "fines-herbes": {
    cat: "epice",
    fr: ["fines herbes*3", "assaisonnement italien*2", "épices italiennes"],
    en: ["Italian seasoning*2", "mixed herbs"],
  },
  origan: { cat: "epice", fr: ["origan*3"], en: ["oregano*2"] },
  basilic: { cat: "epice", fr: ["basilic*3"], en: ["basil*2"] },
  paprika: { cat: "epice", fr: ["paprika*4"], en: ["paprika*2"] },
  "poudre-de-chili": {
    cat: "epice",
    fr: ["poudre de chili*4", "chili en poudre", "assaisonnement au chili"],
    en: ["chili powder*2"],
  },
  "piment-fort-broye": {
    cat: "epice",
    fr: ["piments broyés*2", "flocons de piment fort"],
    en: ["crushed red pepper", "chili flakes"],
  },
  "moutarde-seche": {
    cat: "epice",
    fr: ["moutarde sèche*4", "moutarde en poudre*2"],
    en: ["dry mustard*3", "mustard powder"],
    brands: ["Keen's"],
    note: "Powder, not the prepared mustard in a jar.",
  },
  "moutarde-preparee": {
    cat: "epicerie",
    fr: ["moutarde*5", "moutarde préparée*2", "moutarde jaune"],
    en: ["mustard*2", "prepared mustard", "yellow mustard"],
    brands: ["French's"],
  },
  "graines-de-moutarde": {
    cat: "epice",
    fr: ["graines de moutarde*2"],
    en: ["mustard seed"],
  },
  curcuma: {
    cat: "epice",
    fr: ["curcuma*3", "safran des Indes*2"],
    en: ["turmeric*2"],
    note: "'safran des Indes' is the old Quebec name for turmeric, not saffron.",
  },
  "ail-en-poudre": {
    cat: "epice",
    fr: ["poudre d'ail*3", "poudre d’ail", "ail en poudre"],
    en: ["garlic powder*2"],
  },
  "sel-d-ail": { cat: "epice", fr: ["sel d'ail*2"], en: ["garlic salt"] },
  "sel-de-celeri": {
    cat: "epice",
    fr: ["sel de céleri*3", "sel de celeri"],
    en: ["celery salt"],
  },
  "oignon-en-poudre": {
    cat: "epice",
    fr: ["poudre d'oignon*2", "oignon en poudre"],
    en: ["onion powder"],
  },

  // --- sugar, chocolate, nuts, dried fruit ------------------------------
  cacao: {
    cat: "epicerie",
    fr: ["cacao*5", "poudre de cacao"],
    en: ["cocoa*3", "cocoa powder"],
    brands: ["Fry's"],
  },
  "chocolat-mi-sucre": {
    cat: "epicerie",
    fr: ["chocolat mi-sucré*4", "carrés de chocolat mi-sucré"],
    en: ["semi-sweet chocolate*2"],
    brands: ["Baker's"],
  },
  "chocolat-non-sucre": {
    cat: "epicerie",
    fr: ["chocolat non sucré*3"],
    en: ["unsweetened chocolate"],
    brands: ["Baker's"],
  },
  "pepites-de-chocolat": {
    cat: "epicerie",
    fr: [
      "pépites de chocolat*4",
      "brisures de chocolat*3",
      "Chipits*2",
      "grains de chocolat",
    ],
    en: ["chocolate chips*3", "Chipits"],
  },
  "noix-de-coco": {
    cat: "epicerie",
    fr: ["noix de coco*5", "coco*2"],
    en: ["coconut*2", "shredded coconut"],
  },
  "noix-de-grenoble": {
    cat: "epicerie",
    fr: ["noix de Grenoble*4", "noix*5", "noix de grenoble"],
    en: ["walnuts*3", "nuts*2"],
    note: "Bare 'noix' / 'nuts' on these cards means walnuts.",
  },
  pacanes: {
    cat: "epicerie",
    fr: ["pacanes*3", "noix de pacane"],
    en: ["pecans*2"],
  },
  amandes: { cat: "epicerie", fr: ["amandes*2"], en: ["almonds"] },
  arachides: {
    cat: "epicerie",
    fr: ["arachides*2", "peanuts*0"],
    en: ["peanuts"],
  },
  "beurre-d-arachide": {
    cat: "epicerie",
    fr: [
      "beurre d'arachides*4",
      "beurre d’arachides",
      "beurre d'arachide*3",
      "beurre de peanut*2",
    ],
    en: ["peanut butter*3"],
    brands: ["Kraft", "Squirrel"],
    note: "Starts with 'beurre' and is not butter.",
  },
  "raisins-secs": {
    cat: "epicerie",
    fr: ["raisins secs*6", "raisins*3", "raisins Sultana"],
    en: ["raisins*3", "seedless raisins"],
  },
  dattes: { cat: "epicerie", fr: ["dattes*8"], en: ["dates*3"] },
  "fruits-confits": {
    cat: "epicerie",
    fr: ["fruits confits*3", "cerises confites*2", "fruits glacés"],
    en: ["candied fruit", "glacé cherries"],
  },
  "cerises-au-marasquin": {
    cat: "conserve",
    fr: ["cerises au marasquin*3", "cerises rouges"],
    en: ["maraschino cherries*2"],
  },
  melasse: {
    cat: "epicerie",
    fr: ["mélasse*8", "melasse", "mélasse de fantaisie"],
    en: ["molasses*4", "fancy molasses"],
    brands: ["Grandma"],
  },
  "sirop-d-erable": {
    cat: "epicerie",
    fr: ["sirop d'érable*6", "sirop d’érable*2", "sirop d'érable pur"],
    en: ["maple syrup*2"],
  },
  "sirop-de-mais": {
    cat: "epicerie",
    fr: ["sirop de maïs*4", "sirop de blé d'Inde", "sirop Crown"],
    en: ["corn syrup*2", "Crown syrup"],
    brands: ["Crown", "Bee Hive"],
  },

  // --- packaged, era brands ----------------------------------------------
  "poudre-de-gelee": {
    cat: "epicerie",
    fr: ["Jell-O*6", "jello*2", "poudre à gelée*3", "gelée en poudre"],
    en: ["Jell-O*3", "jelly powder*2"],
    note: "Flavour goes in note (template rule 10 keeps Jell-O as the name). Whether lime and strawberry are one registry entry is an open question.",
  },
  "pouding-instantane": {
    cat: "epicerie",
    fr: ["pouding instantané*3", "pouding Jell-O instantané"],
    en: ["instant pudding*2"],
  },
  "cool-whip": {
    cat: "surgele",
    fr: ["Cool Whip*4", "garniture fouettée"],
    en: ["Cool Whip*2", "whipped topping"],
  },
  "dream-whip": {
    cat: "epicerie",
    fr: ["Dream Whip*2"],
    en: ["Dream Whip"],
    note: "A powder, not Cool Whip.",
  },
  guimauves: {
    cat: "epicerie",
    fr: ["guimauves*4", "petites guimauves*2", "guimauves miniatures"],
    en: ["marshmallows*2", "miniature marshmallows"],
  },
  "chapelure-graham": {
    cat: "epicerie",
    fr: [
      "chapelure de biscuits Graham*3",
      "chapelure Graham*2",
      "biscuits Graham",
    ],
    en: ["graham crumbs*2", "graham cracker crumbs"],
  },
  chapelure: {
    cat: "epicerie",
    fr: ["chapelure*5", "chapelure de pain", "miettes de pain"],
    en: ["bread crumbs*2", "breadcrumbs"],
  },
  "biscuits-soda": {
    cat: "epicerie",
    fr: ["biscuits soda*5", "craquelins*2", "biscuits soda salés"],
    en: ["soda crackers*2", "saltines"],
    brands: ["Christie"],
  },
  "rice-krispies": {
    cat: "epicerie",
    fr: ["Rice Krispies*3", "céréales Rice Krispies"],
    en: ["Rice Krispies*2"],
  },
  "all-bran": {
    cat: "epicerie",
    fr: ["All-Bran*2", "céréales All-Bran"],
    en: ["All-Bran"],
  },
  son: {
    cat: "epicerie",
    fr: ["son*3", "son de blé*2"],
    en: ["bran*2", "wheat bran"],
  },
  "flocons-d-avoine": {
    cat: "epicerie",
    fr: [
      "flocons d'avoine*5",
      "flocons d’avoine",
      "gruau*5",
      "avoine",
      "gruau à cuisson rapide",
    ],
    en: ["rolled oats*2", "oats*2", "quick oats", "oatmeal"],
    brands: ["Quaker"],
    note: "Quebec 'gruau' = rolled oats (not porridge).",
  },
  pain: {
    cat: "epicerie",
    fr: ["pain*3", "pain blanc*2", "pain tranché"],
    en: ["bread*2", "white bread"],
  },
  riz: {
    cat: "epicerie",
    fr: ["riz*6", "riz blanc*2", "riz à grains longs"],
    en: ["rice*3", "long grain rice"],
    typos: ["ris"],
  },
  "riz-minute": {
    cat: "epicerie",
    fr: ["Minute Rice*3", "riz Minute*2", "riz instantané"],
    en: ["Minute Rice*2", "instant rice"],
    note: "Not plain rice: cooks differently, priced differently.",
  },
  macaroni: {
    cat: "epicerie",
    fr: ["macaroni*6", "macaronis*2", "coudes"],
    en: ["macaroni*3", "elbow macaroni"],
  },
  spaghetti: {
    cat: "epicerie",
    fr: ["spaghetti*5", "spaghettis"],
    en: ["spaghetti*2"],
  },
  "nouilles-aux-oeufs": {
    cat: "epicerie",
    fr: ["nouilles*4", "nouilles aux oeufs*2", "nouilles aux œufs"],
    en: ["egg noodles*2", "noodles"],
  },
  "pates-alimentaires": {
    cat: "epicerie",
    fr: ["pâtes*2", "pâtes alimentaires*2"],
    en: ["pasta"],
    note: "Trap: 'pâtes' (pasta) de-pluralizes to 'pâte' (pastry).",
  },
  "kraft-dinner": {
    cat: "epicerie",
    fr: ["Kraft Dinner*5", "macaroni Kraft Dinner", "KD"],
    en: ["Kraft Dinner*2"],
  },
  croustilles: {
    cat: "epicerie",
    fr: ["croustilles*3", "chips"],
    en: ["potato chips*2", "chips*0"],
  },
  "pate-a-tarte": {
    cat: "epicerie",
    fr: [
      "pâte à tarte*5",
      "pâte brisée*4",
      "abaisse*2",
      "fond de tarte*2",
      "croûte à tarte",
      "pâte",
    ],
    en: ["pie crust*2", "pastry*2", "pie shell*2", "unbaked pie shell"],
    one: {
      fr: [
        "abaisse*2",
        "pâte à tarte*3",
        "fond de tarte*2",
        "pâte brisée*3",
        "croûte à tarte",
      ],
      en: ["pie shell*2", "unbaked pie shell", "pie crust"],
    },
    note: "Usually a sub-recipe link (recipe:). Trap: 'pâte' vs 'pâtes' (pasta).",
  },

  // --- sauces, condiments, canned ---------------------------------------
  mayonnaise: {
    cat: "epicerie",
    fr: ["mayonnaise*6", "mayo"],
    en: ["mayonnaise*3"],
    brands: ["Hellmann's"],
  },
  "miracle-whip": {
    cat: "epicerie",
    fr: ["Miracle Whip*5", "sauce à salade*3"],
    en: ["Miracle Whip*2", "salad dressing"],
    brands: ["Kraft", "Miracle Whip"],
    note: "Not mayonnaise. Quebec 'sauce à salade' is this kind of dressing.",
  },
  ketchup: {
    cat: "epicerie",
    fr: ["ketchup*6", "catsup"],
    en: ["ketchup*3", "catsup"],
    brands: ["Heinz"],
  },
  "sauce-chili": {
    cat: "epicerie",
    fr: ["sauce chili*5"],
    en: ["chili sauce*3"],
    brands: ["Heinz"],
    note: "A tomato relish-sauce, not chili powder or hot sauce.",
  },
  relish: {
    cat: "epicerie",
    fr: ["relish*4", "relish sucrée"],
    en: ["relish*2", "sweet relish"],
  },
  cornichons: {
    cat: "epicerie",
    fr: ["cornichons*3", "cornichons sucrés"],
    en: ["pickles*2", "sweet pickles"],
  },
  "sauce-worcestershire": {
    cat: "epicerie",
    fr: ["sauce Worcestershire*5", "sauce Worcester*2", "Worcestershire"],
    en: ["Worcestershire sauce*3"],
    typos: ["sauce Worchestershire", "sauce Worcestshire"],
    brands: ["Lea & Perrins"],
  },
  "sauce-soya": {
    cat: "epicerie",
    fr: ["sauce soya*5", "soya"],
    en: ["soy sauce*2"],
  },
  "sauce-hp": {
    cat: "epicerie",
    fr: ["sauce HP*3", "sauce brune"],
    en: ["HP sauce*2"],
  },
  "vinaigre-blanc": {
    cat: "epicerie",
    fr: ["vinaigre*6", "vinaigre blanc*4"],
    en: ["vinegar*3", "white vinegar*2"],
  },
  "vinaigre-de-cidre": {
    cat: "epicerie",
    fr: ["vinaigre de cidre*3"],
    en: ["cider vinegar*2"],
  },
  "soupe-tomate-condensee": {
    cat: "conserve",
    fr: ["soupe aux tomates*5", "soupe tomate*3", "crème de tomate*2"],
    en: ["tomato soup*3", "condensed tomato soup"],
    brands: ["Campbell"],
    note: "The condensed can. Brand split out (template rule 10): the rest still names the product.",
  },
  "creme-de-champignons": {
    cat: "conserve",
    fr: [
      "crème de champignons*5",
      "soupe crème de champignons*2",
      "soupe aux champignons",
    ],
    en: ["cream of mushroom soup*3"],
    brands: ["Campbell"],
  },
  "creme-de-poulet": {
    cat: "conserve",
    fr: ["crème de poulet*3"],
    en: ["cream of chicken soup*2"],
    brands: ["Campbell"],
  },
  "creme-de-celeri": {
    cat: "conserve",
    fr: ["crème de céleri*2"],
    en: ["cream of celery soup"],
    brands: ["Campbell"],
  },
  "soupe-a-l-oignon-sachet": {
    cat: "epicerie",
    fr: [
      "soupe à l'oignon*5",
      "mélange à soupe à l'oignon*2",
      "soupe à l'oignon déshydratée",
    ],
    en: ["onion soup mix*3"],
    brands: ["Lipton"],
    note: "The dry packet mix (unit packet), never homemade onion soup.",
  },
  bovril: {
    cat: "epicerie",
    fr: ["Bovril*4", "bouillon Bovril"],
    en: ["Bovril*2"],
    note: "Concentrated beef bouillon in a jar.",
  },
  "cube-bouillon-boeuf": {
    cat: "epicerie",
    fr: ["cube de bouillon de boeuf*2", "bouillon de boeuf en cube", "Oxo*2"],
    en: ["beef bouillon cube*2", "Oxo cube"],
    one: {
      fr: ["cube de bouillon de boeuf*2", "Oxo"],
      en: ["beef bouillon cube"],
    },
  },
  "bouillon-de-boeuf": {
    cat: "conserve",
    fr: ["bouillon de boeuf*4", "bouillon de bœuf*2"],
    en: ["beef broth*2", "beef stock"],
  },
  "consomme-de-boeuf": {
    cat: "conserve",
    fr: ["consommé de boeuf*3", "consommé"],
    en: ["beef consommé*2"],
    brands: ["Campbell"],
  },
  "bouillon-de-poulet": {
    cat: "conserve",
    fr: ["bouillon de poulet*5"],
    en: ["chicken broth*2", "chicken stock"],
  },
  "tomates-en-conserve": {
    cat: "conserve",
    fr: ["tomates en conserve*4", "tomates en boîte*2", "tomates étuvées*2"],
    en: ["canned tomatoes*2", "stewed tomatoes"],
    byUnit: {
      can: {
        fr: ["tomates*4", "tomates en conserve*3", "tomates étuvées*2"],
        en: ["tomatoes*2", "stewed tomatoes"],
      },
    },
    brands: ["Aylmer"],
  },
  "tomates-fraiches": {
    cat: "legume",
    fr: ["tomates*5", "tomates fraîches*2"],
    en: ["tomatoes*2"],
    one: { fr: ["tomate"], en: ["tomato"] },
  },
  "tomates-vertes": {
    cat: "legume",
    fr: ["tomates vertes*6"],
    en: ["green tomatoes*2"],
  },
  "pate-de-tomates": {
    cat: "conserve",
    fr: ["pâte de tomates*5", "pâte de tomate*2", "concentré de tomate"],
    en: ["tomato paste*3"],
    note: "Not tomato sauce, not pâte (pastry).",
  },
  "sauce-tomate": {
    cat: "conserve",
    fr: ["sauce tomate*5", "sauce aux tomates*2"],
    en: ["tomato sauce*3"],
    brands: ["Hunt's", "Aylmer"],
  },
  "jus-de-tomate": {
    cat: "boisson",
    fr: ["jus de tomate*3", "jus de tomates"],
    en: ["tomato juice*2"],
  },
  "ble-d-inde-en-creme": {
    cat: "conserve",
    fr: [
      "blé d'Inde en crème*6",
      "blé d’Inde en crème*2",
      "maïs en crème",
      "blé d'inde en crème",
      "ble d'Inde en creme",
    ],
    en: ["creamed corn*2", "cream-style corn"],
    brands: ["Géant Vert"],
    note: "Quebec blé d'Inde = corn. Creamed and kernel are two products.",
  },
  "ble-d-inde-en-grains": {
    cat: "conserve",
    fr: [
      "blé d'Inde en grains*5",
      "blé d’Inde en grains",
      "blé d'Inde*3",
      "maïs en grains",
      "blé d'Inde entier",
    ],
    en: ["corn*2", "kernel corn", "whole kernel corn"],
    brands: ["Géant Vert", "Green Giant"],
  },
  "petits-pois": {
    cat: "conserve",
    fr: ["petits pois*5", "pois verts*2"],
    en: ["peas*2", "green peas"],
  },
  "pois-jaunes": {
    cat: "epicerie",
    fr: ["pois jaunes*5", "pois à soupe*3", "pois*2", "pois secs"],
    en: ["yellow split peas*2", "split peas", "dried peas"],
    note: "Bare 'pois' on a pea-soup card is dried yellow peas, not petits pois.",
  },
  "feves-blanches": {
    cat: "epicerie",
    fr: [
      "fèves blanches*5",
      "petites fèves blanches*3",
      "fèves*2",
      "feves blanches",
      "haricots blancs",
    ],
    en: ["navy beans*3", "white beans", "dried beans"],
    note: "Quebec fèves = beans (not broad beans). Bare 'fèves' only occurs on fèves au lard cards.",
  },
  "feves-rouges": {
    cat: "conserve",
    fr: ["fèves rouges*5", "haricots rouges"],
    en: ["kidney beans*3", "red kidney beans"],
  },
  "feves-jaunes": {
    cat: "legume",
    fr: ["fèves jaunes*4", "haricots jaunes"],
    en: ["wax beans*2", "yellow beans"],
  },
  "feves-vertes": {
    cat: "legume",
    fr: ["fèves vertes*4", "haricots verts"],
    en: ["green beans*2"],
  },
  "feves-au-lard-conserve": {
    cat: "conserve",
    fr: ["fèves au lard*3", "binnes"],
    en: ["baked beans*2", "beans with pork"],
    brands: ["Clark"],
  },
  "feves-germees": {
    cat: "legume",
    fr: ["fèves germées*4", "germes de soya"],
    en: ["bean sprouts*2"],
  },
  "ananas-broye": {
    cat: "conserve",
    fr: ["ananas broyé*5", "ananas en morceaux*2", "ananas"],
    en: ["crushed pineapple*3", "pineapple", "pineapple rings"],
    note: "Crushed, chunks and rings merged: one fruit, one can.",
  },
  "cocktail-de-fruits": {
    cat: "conserve",
    fr: [
      "cocktail de fruits*4",
      "salade de fruits en conserve",
      "macédoine de fruits",
    ],
    en: ["fruit cocktail*2"],
  },
  thon: {
    cat: "poisson",
    fr: ["thon*5", "thon pâle", "thon en conserve"],
    en: ["tuna*3", "canned tuna"],
    brands: ["Clover Leaf"],
  },
  "saumon-en-conserve": {
    cat: "poisson",
    fr: ["saumon*5", "saumon en conserve*2", "saumon rose"],
    en: ["salmon*2", "canned salmon", "red salmon"],
    brands: ["Clover Leaf", "Gold Seal"],
    note: "No fresh salmon in the corpus: 'saumon' is always the can.",
  },
  "champignons-en-conserve": {
    cat: "conserve",
    fr: ["champignons en conserve*3", "champignons tranchés en conserve"],
    en: ["canned mushrooms"],
    byUnit: {
      can: {
        fr: ["champignons*4", "champignons en conserve*2"],
        en: ["mushrooms*2", "canned mushrooms"],
      },
    },
  },

  // --- vegetables -------------------------------------------------------------
  oignon: {
    cat: "legume",
    fr: ["oignons*8", "oignon*6", "ognon", "oignon jaune"],
    en: ["onions*3", "onion*3"],
    one: { fr: ["oignon*10", "ognon", "oignon jaune"], en: ["onion*3"] },
    typos: ["oingon", "oigon"],
    note: "'ognon' is the 1990 reformed spelling, not a typo.",
  },
  "oignon-rouge": { cat: "legume", fr: ["oignon rouge*2"], en: ["red onion"] },
  "echalote-verte": {
    cat: "legume",
    fr: [
      "échalotes*5",
      "échalote*3",
      "oignons verts*2",
      "oignon vert",
      "échalotes vertes",
      "echalotes",
    ],
    en: ["green onions*3", "green onion", "scallions", "shallots"],
    note: "Quebec échalote = green onion. Anglophone Quebec cards say 'shallots' for the same thing.",
  },
  "echalote-francaise": {
    cat: "legume",
    fr: ["échalote française*2", "échalotes françaises*2", "échalote sèche"],
    en: ["French shallot"],
    note: "The bulb (France échalote). Must never merge with echalote-verte.",
  },
  ail: {
    cat: "legume",
    fr: ["ail*8"],
    en: ["garlic*4"],
    byUnit: {
      piece: {
        fr: ["gousses d'ail*3", "gousses d’ail"],
        en: ["garlic cloves"],
      },
    },
    one: { fr: ["ail*6"], en: ["garlic*3"] },
    note: "'gousse d'ail' as the name happens when the AI uses unit piece; ail with unit clove is the template's form.",
  },
  celeri: {
    cat: "legume",
    fr: ["céleri*8", "celeri", "branches de céleri"],
    en: ["celery*4"],
    byUnit: {
      stalk: { fr: ["céleri*6", "celeri"], en: ["celery*2"] },
      piece: {
        fr: ["branches de céleri*2", "branche de céleri"],
        en: ["celery stalks"],
      },
    },
    one: { fr: ["céleri*4", "branche de céleri"], en: ["celery*2"] },
    typos: ["céléri", "cèleri"],
  },
  carottes: {
    cat: "legume",
    fr: ["carottes*8", "carotte"],
    en: ["carrots*4"],
    one: { fr: ["carotte*4"], en: ["carrot*2"] },
    typos: ["carrottes"],
  },
  patates: {
    cat: "legume",
    fr: ["patates*8", "pommes de terre*4", "patates blanches"],
    en: ["potatoes*4"],
    one: { fr: ["patate*3", "pomme de terre"], en: ["potato"] },
    typos: ["patattes"],
    note: "Quebec patates = pommes de terre (VOCAB.md). Not patates douces.",
  },
  navet: {
    cat: "legume",
    fr: ["navet*6", "chou de Siam", "rabiole"],
    en: ["turnip*2", "rutabaga"],
    note: "Quebec navet is usually the rutabaga; the cards do not distinguish.",
  },
  chou: {
    cat: "legume",
    fr: ["chou*6", "chou vert*2", "chou blanc"],
    en: ["cabbage*3"],
    note: "Not chou-fleur.",
  },
  "chou-fleur": {
    cat: "legume",
    fr: ["chou-fleur*3", "choufleur"],
    en: ["cauliflower*2"],
  },
  concombres: {
    cat: "legume",
    fr: ["concombres*5", "concombres à mariner*3"],
    en: ["cucumbers*2", "pickling cucumbers"],
    one: { fr: ["concombre"], en: ["cucumber"] },
  },
  "piment-vert": {
    cat: "legume",
    fr: ["piment vert*6", "piments verts*3", "poivron vert"],
    en: ["green pepper*3", "green peppers", "green bell pepper"],
    one: { fr: ["piment vert*6", "poivron vert"], en: ["green pepper*3"] },
    note: "A bell pepper, never a chili (VOCAB.md). Trap with piment-fort.",
  },
  "piment-rouge": {
    cat: "legume",
    fr: ["piment rouge*5", "piments rouges*2", "poivron rouge"],
    en: ["red pepper*2", "red bell pepper"],
    one: { fr: ["piment rouge*5", "poivron rouge"], en: ["red pepper*2"] },
    note: 'Bell pepper. English "red pepper" on these cards is the vegetable, not crushed chili.',
  },
  "piment-fort": {
    cat: "legume",
    fr: ["piment fort*3", "piments forts*2"],
    en: ["hot pepper", "hot peppers"],
    note: "The only chili. Trap with piment vert / piment rouge.",
  },
  champignons: {
    cat: "legume",
    fr: ["champignons*5", "champignons frais*2"],
    en: ["mushrooms*3", "fresh mushrooms"],
  },
  betteraves: {
    cat: "legume",
    fr: ["betteraves*5", "petites betteraves"],
    en: ["beets*2"],
  },
  "pommes-de-terre-pilees": {
    cat: "legume",
    fr: ["purée de pommes de terre*2", "patates pilées*2"],
    en: ["mashed potatoes"],
    note: "A leftover used as an ingredient, not raw potatoes.",
  },

  // --- fruit ----------------------------------------------------------
  pommes: {
    cat: "fruit",
    fr: ["pommes*8", "pommes McIntosh*2", "pommes Cortland", "pommes à cuire"],
    en: ["apples*4", "McIntosh apples"],
    one: { fr: ["pomme*3"], en: ["apple"] },
    note: "Cultivar names folded in. Trap: pommes de terre.",
  },
  bleuets: {
    cat: "fruit",
    fr: ["bleuets*8", "bleuets frais"],
    en: ["blueberries*4"],
    note: "Quebec bleuets = blueberries.",
  },
  fraises: { cat: "fruit", fr: ["fraises*5"], en: ["strawberries*2"] },
  rhubarbe: { cat: "fruit", fr: ["rhubarbe*5"], en: ["rhubarb*2"] },
  bananes: {
    cat: "fruit",
    fr: ["bananes*8"],
    en: ["bananas*4"],
    one: { fr: ["banane"], en: ["banana"] },
  },
  peches: { cat: "fruit", fr: ["pêches*4", "peches"], en: ["peaches*2"] },
  poires: { cat: "fruit", fr: ["poires*4"], en: ["pears*2"] },
  citron: {
    cat: "fruit",
    fr: ["citron*3"],
    en: ["lemon*2"],
    one: { fr: ["citron"], en: ["lemon"] },
  },
  "jus-de-citron": {
    cat: "epicerie",
    fr: ["jus de citron*6"],
    en: ["lemon juice*3"],
    brands: ["ReaLemon"],
  },
  "zeste-de-citron": {
    cat: "fruit",
    fr: ["zeste de citron*3"],
    en: ["lemon rind*2", "grated lemon rind"],
  },
  "jus-d-orange": {
    cat: "boisson",
    fr: ["jus d'orange*3"],
    en: ["orange juice*2"],
  },

  // --- meat and fish ------------------------------------------------------
  "boeuf-hache": {
    cat: "viande",
    fr: [
      "boeuf haché*10",
      "bœuf haché*5",
      "steak haché*2",
      "boeuf haché maigre*2",
      "boeuf à hamburger",
    ],
    en: ["ground beef*5", "hamburger meat", "lean ground beef*2"],
    typos: ["beouf haché", "boeuf aché", "bœf haché"],
    note: "Quebec 'steak haché' = ground beef (VOCAB.md).",
  },
  "porc-hache": {
    cat: "viande",
    fr: ["porc haché*8", "porc haché maigre*2"],
    en: ["ground pork*3"],
  },
  "veau-hache": { cat: "viande", fr: ["veau haché*5"], en: ["ground veal*2"] },
  "boeuf-a-ragout": {
    cat: "viande",
    fr: ["boeuf à ragoût*4", "bœuf à ragoût*2", "cubes de boeuf"],
    en: ["stewing beef*2", "stew beef"],
  },
  "porc-epaule": {
    cat: "viande",
    fr: ["épaule de porc*3", "soc de porc*2", "rôti de porc"],
    en: ["pork shoulder*2", "pork butt"],
  },
  poulet: {
    cat: "viande",
    fr: ["poulet*5", "poulet entier*2"],
    en: ["chicken*3", "whole chicken"],
  },
  "poitrines-de-poulet": {
    cat: "viande",
    fr: ["poitrines de poulet*4"],
    en: ["chicken breasts*2"],
  },
  "cuisses-de-poulet": {
    cat: "viande",
    fr: ["cuisses de poulet*3"],
    en: ["chicken legs"],
  },
  lievre: { cat: "viande", fr: ["lièvre*3"], en: ["hare"] },
  perdrix: { cat: "viande", fr: ["perdrix*2"], en: ["partridge"] },
  jambon: {
    cat: "viande",
    fr: ["jambon*5", "jambon cuit*2", "jambon fumé"],
    en: ["ham*3", "cooked ham"],
  },
  "os-de-jambon": {
    cat: "viande",
    fr: ["os de jambon*3", "os de jambon avec viande"],
    en: ["ham bone*2"],
  },
  "lard-sale": {
    cat: "viande",
    fr: ["lard salé*6", "lard*3", "lard salé entrelardé"],
    en: ["salt pork*3"],
    note: "French 'lard' on these cards is salt pork, not saindoux.",
  },
  bacon: { cat: "viande", fr: ["bacon*4"], en: ["bacon*2"] },
  saucisses: {
    cat: "viande",
    fr: ["saucisses*4", "saucisses de porc*2"],
    en: ["sausages*2", "pork sausages"],
  },
  "saucisses-hot-dog": {
    cat: "viande",
    fr: ["saucisses à hot-dog*3", "wieners"],
    en: ["wieners*2", "hot dogs"],
  },
  "pattes-de-cochon": {
    cat: "viande",
    fr: ["pattes de cochon*5", "pattes de porc*2", "jarrets de porc"],
    en: ["pork hocks*2", "pigs feet"],
    note: "Hocks and feet merged: the cards use them interchangeably for ragoût.",
  },

  // --- other ----------------------------------------------------------------
  eau: {
    cat: "autre",
    staple: true,
    fr: [
      "eau*12",
      "eau bouillante*4",
      "eau froide*3",
      "eau chaude*2",
      "eau glacée",
    ],
    en: ["water*5", "boiling water*2", "cold water", "hot water"],
    note: "Temperature written in the name on many cards; still water.",
  },
  cafe: {
    cat: "boisson",
    fr: ["café*4", "café fort*2", "café infusé"],
    en: ["coffee*2", "strong coffee"],
  },
  "cafe-instantane": {
    cat: "boisson",
    fr: ["café instantané*3", "Nescafé"],
    en: ["instant coffee*2"],
  },
  orge: {
    cat: "epicerie",
    fr: ["orge*4", "orge perlé*2"],
    en: ["barley*2", "pearl barley"],
  },
  "fromage-cheddar": {
    cat: "cremerie",
    fr: [
      "fromage cheddar*4",
      "cheddar*4",
      "cheddar fort*2",
      "fromage fort",
      "fromage jaune",
    ],
    en: ["cheddar cheese*3", "old cheddar*2", "cheddar"],
    note: "'fromage fort' and 'fromage jaune' on 1990s Quebec cards mean cheddar (strong / orange).",
  },
  mozzarella: {
    cat: "cremerie",
    fr: ["mozzarella*5", "fromage mozzarella*2"],
    en: ["mozzarella*2"],
    typos: ["mozarella"],
  },
  parmesan: {
    cat: "cremerie",
    fr: ["parmesan*4", "fromage parmesan*2"],
    en: ["parmesan cheese*2", "parmesan"],
    brands: ["Kraft"],
  },
  "fromage-a-la-creme": {
    cat: "cremerie",
    fr: ["fromage à la crème*4", "fromage Philadelphia*3", "Philadelphia"],
    en: ["cream cheese*3"],
    brands: ["Philadelphia"],
    note: "'fromage Philadelphia' keeps the brand (template rule 10: 'fromage' alone is any cheese).",
  },
  "cheez-whiz": {
    cat: "cremerie",
    fr: ["Cheez Whiz*5", "Cheese Whiz"],
    en: ["Cheez Whiz*2"],
  },
  "fromage-cottage": {
    cat: "cremerie",
    fr: ["fromage cottage*4"],
    en: ["cottage cheese*2"],
  },
  "colorant-alimentaire": {
    cat: "epicerie",
    fr: ["colorant alimentaire*2", "colorant vert", "colorant rouge"],
    en: ["food colouring", "green food colouring"],
    note: "Colour folded in: one bottle set.",
  },
};

/**
 * Written names that are one key for more than one ingredient: the resolver
 * cannot pick from the name alone (brand, note, prep and unit are not part of
 * the lookup key — plan 03 Phase 2). Every one of these is deliberate.
 */
export const AMBIGUOUS: Record<string, { candidates: string[]; note: string }> =
  {
    tomates: {
      candidates: ["tomates-en-conserve", "tomates-fraiches"],
      note: "canned (unit can) or fresh: the unit says which, and the unit is not part of the lookup key.",
    },
    tomatoes: {
      candidates: ["tomates-en-conserve", "tomates-fraiches"],
      note: "same as tomates, English cards.",
    },
    champignons: {
      candidates: ["champignons", "champignons-en-conserve"],
      note: "fresh, or canned when the unit is can.",
    },
    mushrooms: {
      candidates: ["champignons", "champignons-en-conserve"],
      note: "same as champignons, English cards.",
    },
    boeuf: {
      candidates: ["boeuf-hache", "boeuf-a-ragout"],
      note: "with prep 'haché' ground beef, with 'en cubes' stewing beef; prep is not part of the key.",
    },
    bœuf: {
      candidates: ["boeuf-hache", "boeuf-a-ragout"],
      note: "same as boeuf.",
    },
    porc: {
      candidates: ["porc-hache", "porc-epaule"],
      note: "with prep 'haché' ground pork, with 'en cubes' shoulder.",
    },
    "viande hachée": {
      candidates: ["boeuf-hache", "porc-hache", "veau-hache"],
      note: "a mix the card does not state.",
    },
    bouillon: {
      candidates: ["bouillon-de-boeuf", "bouillon-de-poulet"],
      note: "the card does not say which.",
    },
    fromage: {
      candidates: ["fromage-cheddar", "mozzarella"],
      note: "any cheese; on these cards usually cheddar, not always.",
    },
    lard: {
      candidates: ["lard-sale", "saindoux"],
      note: "fr: salt pork; en: lard. One folded key in two languages.",
    },
  };

/** Pairs that fold or read alike and must never resolve to one slug. */
export const CONFUSABLES: [string, string, string][] = [
  [
    "echalote-verte",
    "echalote-francaise",
    "Quebec échalote is the green onion; échalote française is the bulb.",
  ],
  ["piment-vert", "piment-fort", "piment vert is a bell pepper."],
  [
    "piment-rouge",
    "piment-fort-broye",
    "red pepper (vegetable) vs crushed red pepper (spice).",
  ],
  ["piment-de-la-jamaique", "piment-vert", "allspice is a spice."],
  ["creme-35", "creme-15", "the percentage is the product."],
  ["creme-15", "creme-10", "the percentage is the product."],
  ["creme-35", "creme-sure", 'both "crème".'],
  [
    "lait",
    "lait-evapore",
    '"lait Carnation" / "lait en boîte" are evaporated milk.',
  ],
  ["lait-evapore", "lait-condense-sucre", "unsweetened vs sweetened."],
  ["lait", "babeurre", '"lait de beurre" is buttermilk.'],
  ["beurre", "beurre-d-arachide", "both start with beurre."],
  [
    "beurre",
    "margarine",
    'often written "beurre ou margarine" — or: keeps them apart.',
  ],
  ["graisse-vegetale", "saindoux", "shortening vs lard."],
  ["saindoux", "lard-sale", "English lard vs French lard (salt pork)."],
  [
    "sucre-blanc",
    "sucre-a-glacer",
    '"sucre en poudre" is icing sugar in Quebec.',
  ],
  ["sucre-blanc", "cassonade", '"sucre brun" is cassonade.'],
  ["poudre-a-pate", "soda-a-pate", "baking powder vs baking soda."],
  ["sel", "gros-sel", "table vs pickling salt."],
  ["sel", "sel-d-ail", "sel d’ail is a seasoning blend."],
  ["sel", "sel-de-celeri", "sel de céleri is a seasoning blend."],
  ["ail", "ail-en-poudre", "fresh vs powder."],
  ["oignon", "oignon-en-poudre", "fresh vs powder."],
  ["oignon", "echalote-verte", '"oignons verts" are green onions.'],
  ["oignon", "soupe-a-l-oignon-sachet", "soupe à l’oignon is a dry mix here."],
  [
    "pate-a-tarte",
    "pates-alimentaires",
    "pâte / pâtes: the plural is another product.",
  ],
  ["pate-a-tarte", "pate-de-tomates", "both start with pâte."],
  ["pate-de-tomates", "sauce-tomate", "paste vs sauce."],
  ["sauce-tomate", "soupe-tomate-condensee", "sauce vs condensed soup."],
  ["ketchup", "sauce-chili", "two tomato condiments."],
  ["mayonnaise", "miracle-whip", "Miracle Whip is not mayonnaise."],
  ["pommes", "patates", '"pommes de terre" are potatoes.'],
  ["patates", "pommes-de-terre-pilees", "raw vs mashed leftovers."],
  ["riz", "riz-minute", "plain vs instant rice."],
  ["macaroni", "kraft-dinner", "plain pasta vs the boxed dinner."],
  ["ble-d-inde-en-creme", "ble-d-inde-en-grains", "two different cans."],
  [
    "ble-d-inde-en-grains",
    "sirop-de-mais",
    '"sirop de blé d’Inde" is corn syrup.',
  ],
  ["petits-pois", "pois-jaunes", "green peas vs dried yellow peas."],
  [
    "feves-blanches",
    "feves-au-lard-conserve",
    "dried beans vs the can of baked beans.",
  ],
  ["feves-blanches", "feves-vertes", "fèves = beans; colour is the product."],
  ["feves-germees", "sauce-soya", '"germes de soya" are bean sprouts.'],
  ["chou", "chou-fleur", "cabbage vs cauliflower."],
  ["chapelure", "chapelure-graham", "bread crumbs vs graham crumbs."],
  ["cafe", "cafe-instantane", "brewed vs instant."],
  ["poudre-de-gelee", "gelatine", "Jell-O vs unflavoured gelatin."],
  ["cool-whip", "dream-whip", "frozen topping vs powder."],
  ["cool-whip", "creme-35", "whipped topping vs whipping cream."],
  ["noix-de-grenoble", "noix-de-coco", 'both "noix".'],
  ["noix-de-grenoble", "muscade", '"noix de muscade" is nutmeg.'],
  ["boeuf-hache", "boeuf-a-ragout", "ground vs cubed."],
  ["bouillon-de-boeuf", "bovril", "broth vs concentrate."],
  ["bouillon-de-boeuf", "cube-bouillon-boeuf", "broth vs cube."],
  ["vinaigre-blanc", "vinaigre-de-cidre", "two vinegars."],
  ["farine-tout-usage", "farine-a-patisserie", "two flours."],
  ["tomates-fraiches", "tomates-vertes", "ripe vs green tomatoes."],
  ["moutarde-seche", "moutarde-preparee", "powder vs jar."],
  ["cerises-au-marasquin", "fruits-confits", "maraschino vs candied."],
];
