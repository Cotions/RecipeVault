// The dish each hand-written card is (plan 05, Phase 0): a key of dishes.ts
// when the card is one of its archetypes, else a key of its own (a dish no
// generated card is). Written into tests/fixtures/corpus/expected-dishes.yaml
// with the generated cards' keys — the answer key of duplicate detection
// (same key = same dish). Every hand card needs an entry; the generator throws
// on a card missing here or an entry naming no card.

export const HAND_DISHES: Readonly<Record<string, string>> = {
  "binnes-du-camp.md": "feves-au-lard",
  "brownies-de-la-revue.md": "brownies",
  "butter-tarts-mrs-lindsay.md": "butter-tarts",
  "carres-aux-dattes-de-la-caisse.md": "carres-aux-dattes",
  "carres-rice-krispies-au-beurre-d-arachides.md": "carres-rice-krispies",
  "chili-doug.md": "chili",
  "chop-suey-de-ti-paul.md": "chop-suey",
  "cipate-a-memere-gertrude.md": "cipate",
  "cretons-de-tante-yvette.md": "cretons",
  "croquettes-de-saumon-du-vendredi.md": "croquettes-saumon",
  "feves-au-lard-au-sirop-d-erable.md": "feves-au-lard",
  "five-minute-fudge-shirley.md": "fudge-chocolat",
  "galettes-a-la-melasse-adrienne.md": "galettes-melasse",
  "gateau-aux-carottes-de-suzanne.md": "gateau-carottes",
  "gibelotte-de-lievre-mon-oncle-real.md": "gibelotte",
  "hamburger-soup-aunt-dot.md": "hamburger-soup",
  "kd-aux-saucisses.md": "kraft-dinner",
  "ketchup-aux-fruits-de-memere-alma.md": "ketchup-fruits",
  "macaroni-au-fromage-lucille.md": "macaroni-fromage",
  "meat-loaf-mrs-oconnell.md": "pain-de-viande",
  "muffins-au-son-de-la-boite.md": "muffins-son",
  "mushroom-noodle-casserole-aunt-dot.md": "mushroom-noodle-casserole",
  "nanaimo-bars-pat.md": "carres-nanaimo",
  "never-fail-pastry-grandma-macleod.md": "pate-brisee",
  "pain-aux-bananes-de-la-radio.md": "pain-aux-bananes",
  "pain-de-viande-memere-bernadette.md": "pain-de-viande",
  "pate-chinois-de-la-cabane.md": "pate-chinois",
  "porcupine-meatballs-bev.md": "porcupine-meatballs",
  "pouding-chomeur-de-la-cafeteria.md": "pouding-chomeur",
  "poulet-a-la-king-de-l-hopital.md": "poulet-a-la-king",
  "ragout-de-boeuf-de-madeleine.md": "ragout-de-boeuf",
  "ragout-de-pattes-matante-rollande.md": "ragout-de-boulettes",
  // "Marinade de tomates vertes" is one of ketchup-vert's own titles.
  "relish-aux-tomates-vertes-memere.md": "ketchup-vert",
  "salade-de-chou-cremeuse-de-la-fete.md": "salade-chou",
  // Pasta, peppers and a vinaigrette: not the mayonnaise macaroni salad.
  "salade-de-pates-du-mechoui.md": "salade-pates",
  "salade-jell-o-de-noel-francine.md": "salade-jello",
  "sauce-a-spaghetti-matante-pierrette.md": "sauce-a-spaghetti",
  "sauce-au-poivre-de-la-revue.md": "sauce-au-poivre",
  "scalloped-potatoes-aunt-ruth.md": "scalloped-potatoes",
  "scalloped-tomatoes-mrs-lindsay.md": "scalloped-tomatoes",
  "soupe-aux-legumes-du-lundi.md": "soupe-legumes",
  "soupe-aux-pois-de-la-saint-jean.md": "soupe-aux-pois",
  "sucre-a-la-creme-au-micro-ondes.md": "sucre-a-la-creme",
  "tarte-au-sucre-a-nicole.md": "tarte-au-sucre",
  "tarte-aux-bleuets-du-lac.md": "tarte-bleuets",
  "trempette-au-cheez-whiz-pour-les-partys.md": "trempette",
};
