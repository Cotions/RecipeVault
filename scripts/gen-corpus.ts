// Invented test corpus for the ingredient registry (plan 03, P1.5): ~300 recipe
// files as a chat AI following docs/AI-TEMPLATE.md (draft 3.2) would transcribe
// a Québécois family's recipe cards, 1990–2000. Everything is invented — people,
// books, magazines. No real recipe, no URL.
//
//   npx tsx scripts/gen-corpus.ts            rewrite tests/fixtures/corpus/
//   npx tsx scripts/gen-corpus.ts --out DIR  write DIR/recipes/*.md,
//                                            DIR/expected-ingredients.yaml and
//                                            DIR/expected-dishes.yaml
//
// Deterministic: a fixed seed, no clock. The hand-written cards in
// tests/fixtures/corpus/hand/ are copied in unchanged. Every file must check
// without errors; the generator throws otherwise. expected-ingredients.yaml is
// derived from the files actually written, mapped through
// scripts/corpus/ingredients.ts — the answer key. expected-dishes.yaml maps
// each card to its dish archetype (dishes.ts `key`; hand cards from
// scripts/corpus/hand-dishes.ts) — the answer key of duplicate detection.

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, Scalar, YAMLMap, YAMLSeq, parse as parseYaml } from "yaml";
import {
  checkRecipe,
  hasErrors,
  parseRecipe,
  slugify,
  stripMarkers,
} from "../src/lib/vault/index";
import { DISHES, type Dish, type Line } from "./corpus/dishes";
import { HAND_DISHES } from "./corpus/hand-dishes";
import {
  AMBIGUOUS,
  CONFUSABLES,
  INGREDIENTS,
  type IngDef,
} from "./corpus/ingredients";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CORPUS_DIR = join(REPO, "tests/fixtures/corpus");
const SEED = 19941225;

type Lang = "fr" | "en";

// --- randomness ---------------------------------------------------------------

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = mulberry32(SEED);
const chance = (p: number) => rand() < p;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

/** "form*3" → ["form", 3]; weight 1 by default, 0 = never generated. */
function weighted(form: string): [string, number] {
  const m = form.match(/^(.*)\*(\d+)$/);
  return m ? [m[1], Number(m[2])] : [form, 1];
}
function pickWeighted(forms: readonly string[]): string {
  const ws = forms.map(weighted).filter(([, w]) => w > 0);
  const total = ws.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [f, w] of ws) if ((r -= w) < 0) return f;
  return ws[ws.length - 1][0];
}

// --- people, books, magazines (all invented) ---------------------------------

const AUTHORS_FR = [
  "Matante Ginette",
  "Matante Pierrette",
  "Matante Huguette",
  "Matante Jacqueline",
  "Matante Rollande",
  "Matante Fleurette",
  "Tante Thérèse",
  "Tante Gisèle",
  "Tante Aline",
  "Mémère Rose-Aimée",
  "Mémère Laplante",
  "Grand-maman Lucienne",
  "Grand-maman Béatrice",
  "Maman",
  "Mononc’ Réal",
  "Mononc’ Gilles",
  "Cousine Nathalie",
  "Cousine Manon",
  "Diane (voisine)",
  "Madame Bélanger d’à côté",
  "Jocelyne du bureau",
  "Sœur Marie-Paule",
  "Lise B.",
  "Francine",
  "Réjeanne",
  "Yvette",
  "Carmen",
  "Micheline",
  "Raymonde",
  "Georgette",
];
const AUTHORS_EN = [
  "Aunt Marjorie",
  "Mrs. Henderson (next door)",
  "Nana Doris",
  "Aunt Shirley",
  "Bev from church",
  "Grandma MacLeod",
  "Mom",
  "Cousin Debbie",
  "Mrs. O’Neill",
  "Aunt Edna",
];
const YEARS = [
  1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000,
];
const CARD_NOTES_FR = [
  "fiche jaunie, {y}",
  "carte recette écrite au crayon",
  "fiche tachée de graisse",
  "recopiée par maman en {y}",
  "écrite au dos d’une enveloppe",
  "carte de la boîte à recettes en métal",
  "fiche recto verso, {y}",
  "écriture de Mémère, encre bleue",
  "Noël {y}",
  "donnée au shower de Manon, {y}",
  "carte imprimée « De la cuisine de… », {y}",
  "fiche lignée, coin déchiré",
  "au dos d’un calendrier de la Caisse pop, {y}",
  "papier à lettres plié en quatre",
  "carte recette, {y}",
  "fiche collée avec du Scotch tape jauni",
];
const CARD_NOTES_EN = [
  "index card, {y}",
  "yellowed card, {y}",
  "typed on the back of a church bulletin",
  "recipe card, pencil",
  "written on a notepad from the bank, {y}",
];
const BOOKS_FR = [
  {
    title: "Recettes de chez nous — Paroisse Saint-Adélard-du-Coteau",
    author: "Comité des dames de Sainte-Anne",
  },
  { title: "Le cahier de cuisine de l’école ménagère de Val-des-Bouleaux" },
  { title: "Cuisine familiale d’autrefois", author: "Éditions du Pignon" },
  {
    title: "Nos meilleures recettes — Comité des loisirs de Rivière-Clairette",
  },
  { title: "Le livre de l’Âge d’or de Saint-Wenceslas-des-Monts" },
];
const BOOKS_EN = [
  { title: "Kitchen Favourites — St. Aidan’s Ladies’ Auxiliary" },
  { title: "The Brookfield Townships Community Cookbook" },
];
const MAGS_FR = [
  "Revue Foyer et Famille",
  "La Ménagère de Val-des-Bouleaux",
  "Le Tablier bleu",
  "Bulletin de la Caisse populaire de Val-des-Bouleaux",
  "Circulaire de l’épicerie",
];
const MAGS_EN = ["Maple Hollow Weekly", "Family Kitchen Monthly"];
const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const TV = {
  title: "Midi-Cuisine (Télé-Coteau)",
  notes: [
    "invitée : Madame Rollande",
    "émission du vendredi, recopiée pendant l’émission",
  ],
};

const NOTES_FR = [
  "« Un classique chez nous. »",
  "« Mon mari en raffole. »",
  "Doubler la recette pour les Fêtes.",
  "Se congèle bien.",
  "« Toujours un succès. »",
  "Recette gagnante au bazar de la paroisse.",
  "Ne pas donner la recette à Madame Bélanger !",
  "On la faisait au chalet.",
  "« Meilleur que celui du restaurant. »",
];
const NOTES_EN = [
  '"Always a hit."',
  "Double for a crowd.",
  "Freezes well.",
  "From the church bazaar table.",
];

// --- amounts ------------------------------------------------------------------

interface Amount {
  qty?: string | number;
  qty_max?: string | number;
  unit?: string;
  note?: string;
  alt?: { qty: string | number; qty_max?: string | number; unit: string };
  to_taste?: boolean;
}

function num(q: string): string | number {
  return /^\d+(\.\d+)?$/.test(q) ? Number(q) : q;
}

function parseAmount(s: string): Amount {
  if (s === "-") return {};
  if (s === "taste") return { to_taste: true };
  const [q, unit, extra] = s.split("|");
  const a: Amount = { unit };
  const range = q.match(/^(\S+)-(\S+)$/);
  if (range) {
    a.qty = num(range[1]);
    a.qty_max = num(range[2]);
  } else a.qty = num(q);
  if (extra?.startsWith("=")) {
    const [aq, au] = extra.slice(1).split(" ");
    a.alt = { qty: num(aq), unit: au };
  } else if (extra) a.note = extra;
  return a;
}

// Canadian metric conversions printed on 1990s books and clippings: "1 t (250 ml)".
const TO_METRIC: Record<string, Record<string, [number, string]>> = {
  cup: {
    "1/4": [50, "ml"],
    "1/3": [75, "ml"],
    "1/2": [125, "ml"],
    "2/3": [150, "ml"],
    "3/4": [175, "ml"],
    "1": [250, "ml"],
    "1 1/2": [375, "ml"],
    "2": [500, "ml"],
    "3": [750, "ml"],
    "4": [1, "l"],
  },
  tbsp: { "1": [15, "ml"], "2": [30, "ml"], "3": [45, "ml"] },
  tsp: {
    "1/8": [0.5, "ml"],
    "1/4": [1, "ml"],
    "1/2": [2, "ml"],
    "1": [5, "ml"],
    "2": [10, "ml"],
  },
  lb: { "1/2": [225, "g"], "1": [454, "g"], "2": [900, "g"] },
};

function metricate(a: Amount): Amount {
  if (a.qty === undefined || a.qty_max !== undefined || !a.unit || a.alt)
    return a;
  const m = TO_METRIC[a.unit]?.[String(a.qty)];
  if (!m) return a;
  return { ...a, qty: m[0], unit: m[1], alt: { qty: a.qty, unit: a.unit } };
}

// --- text -------------------------------------------------------------------------

function ovenText(o: { temp: number; temp_max?: number }, lang: Lang): string {
  if (lang === "en")
    return o.temp_max ? `${o.temp}-${o.temp_max}°F` : `${o.temp}°F`;
  return o.temp_max ? `${o.temp} à ${o.temp_max} °F` : `${o.temp} °F`;
}

function durationText(d: string, lang: Lang): string {
  const one = (x: string) => {
    const m = x.match(/^(?:(\d+)h)?(?:(\d+)m)?$/)!;
    const h = Number(m[1] ?? 0);
    const min = Number(m[2] ?? 0);
    if (lang === "en")
      return [h && `${h} hour${h > 1 ? "s" : ""}`, min && `${min} minutes`]
        .filter(Boolean)
        .join(" ");
    if (h && min) return `${h} h ${min}`;
    return h ? `${h} heure${h > 1 ? "s" : ""}` : `${min} minutes`;
  };
  const [a, b] = d.split("-");
  if (!b) return one(a);
  const joiner = lang === "en" ? " to " : " à ";
  return a.endsWith("m") &&
    b.endsWith("m") &&
    !a.includes("h") &&
    !b.includes("h")
    ? `${a.slice(0, -1)}${joiner}${one(b)}`
    : `${one(a)}${joiner}${one(b)}`;
}

/** A frontmatter scalar: plain when YAML reads it back as the same string, else double-quoted. */
function y(v: string | number | boolean): string {
  if (typeof v !== "string") return String(v);
  const plain =
    /^[\p{L}][\p{L}\p{N} '’.%&/()-]*$/u.test(v) ||
    /^\d[\p{L}\p{N} '’.%&/()-]*[\p{L})][\p{L}\p{N} '’.%&/()-]*$/u.test(v);
  if (plain && !/^(true|false|null|yes|no|on|off)$/i.test(v) && !/\s$/.test(v))
    return v;
  return JSON.stringify(v);
}
const qtyY = (q: string | number) =>
  typeof q === "number" ? String(q) : JSON.stringify(q);

// --- ingredient forms -------------------------------------------------------------

function formsFor(def: IngDef, lang: Lang, a: Amount): string[] {
  const byUnit = a.unit ? def.byUnit?.[a.unit]?.[lang] : undefined;
  if (byUnit?.length) return byUnit;
  const one =
    a.unit === "piece" && Number(a.qty) === 1 && a.qty_max === undefined
      ? def.one?.[lang]
      : undefined;
  if (one?.length) return one;
  return def[lang];
}

const primaryUsed = new Set<string>();
const primaryForm = (key: string, lang: Lang) =>
  weighted(INGREDIENTS[key][lang][0])[0];

function nameFor(key: string, lang: Lang, a: Amount, typoP = 0.03): string {
  const def = INGREDIENTS[key];
  if (!def) throw new Error(`unknown ingredient ${key}`);
  if (lang === "fr" && def.typos?.length && chance(typoP))
    return pick(def.typos);
  const forms = formsFor(def, lang, a);
  if (!forms.length) throw new Error(`${key} has no ${lang} form`);
  // The first card to use an ingredient writes its primary form, so the answer
  // key can list it first (the natural registry name, plan 03 metric R1).
  const primary = primaryForm(key, lang);
  if (
    !primaryUsed.has(`${lang}:${key}`) &&
    forms.some((f) => weighted(f)[0] === primary)
  ) {
    primaryUsed.add(`${lang}:${key}`);
    return primary;
  }
  return pickWeighted(forms);
}

// --- one generated recipe ---------------------------------------------------------

interface Generated {
  slug: string;
  text: string;
  /** path → canonical, for every ingredient name written (or entries included). */
  truth: Map<string, string>;
}

interface Ctx {
  taken: Set<string>;
  pates: string[];
}

function sourceFor(lang: Lang): {
  lines: string[];
  author?: string;
  kind: string;
  printed: boolean;
} {
  const y4 = pick(YEARS);
  const r = rand();
  if (lang === "en") {
    if (r < 0.75) {
      const author = pick(AUTHORS_EN);
      return {
        kind: "family",
        author,
        printed: false,
        lines: [
          "  type: family",
          `  author: ${y(author)}`,
          `  note: ${y(pick(CARD_NOTES_EN).replace("{y}", String(y4)))}`,
        ],
      };
    }
    if (r < 0.88) {
      const b = pick(BOOKS_EN);
      return {
        kind: "book",
        printed: true,
        lines: [
          "  type: book",
          `  title: ${y(b.title)}`,
          `  page: ${int(12, 140)}`,
        ],
      };
    }
    return {
      kind: "magazine",
      printed: true,
      lines: [
        "  type: magazine",
        `  title: ${y(pick(MAGS_EN))}`,
        `  note: ${y(`clipping, ${y4}`)}`,
      ],
    };
  }
  if (r < 0.66) {
    const author = pick(AUTHORS_FR);
    const lines = ["  type: family", `  author: ${y(author)}`];
    if (chance(0.8))
      lines.push(
        `  note: ${y(pick(CARD_NOTES_FR).replace("{y}", String(y4)))}`,
      );
    return { kind: "family", author, printed: false, lines };
  }
  if (r < 0.7) {
    // The kind is not evident: author and note, no type (template rule 23).
    const author = pick(AUTHORS_FR);
    return {
      kind: "none",
      author,
      printed: false,
      lines: [
        `  author: ${y(author)}`,
        `  note: ${y("papier plié dans un livre")}`,
      ],
    };
  }
  if (r < 0.82) {
    const b = pick(BOOKS_FR);
    const lines = ["  type: book", `  title: ${y(b.title)}`];
    if (b.author) lines.push(`  author: ${y(b.author)}`);
    lines.push(`  page: ${int(8, 220)}`);
    return { kind: "book", printed: true, lines };
  }
  if (r < 0.93) {
    if (chance(0.25))
      return { kind: "magazine", printed: true, lines: ["  type: magazine"] };
    return {
      kind: "magazine",
      printed: true,
      lines: [
        "  type: magazine",
        `  title: ${y(pick(MAGS_FR))}`,
        `  note: ${y(`découpure, ${pick(MONTHS_FR)} ${y4}`)}`,
      ],
    };
  }
  if (r < 0.96)
    return {
      kind: "tv",
      printed: false,
      lines: [
        "  type: tv",
        `  title: ${y(TV.title)}`,
        `  note: ${y(pick(TV.notes))}`,
      ],
    };
  return { kind: "absent", printed: false, lines: [] };
}

function shortName(author: string): string {
  return author
    .replace(
      /^(Matante|Tante|Mémère|Grand-maman|Mononc’|Cousine|Aunt|Nana|Grandma|Cousin)\s+/,
      "",
    )
    .replace(/\s*\(.*\)$/, "");
}

function date(from: number, to: number): string {
  const m = int(from, to);
  const d = int(1, m === 9 ? 26 : 28);
  return `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function generate(dish: Dish, lang: Lang, ctx: Ctx): Generated {
  const titles = lang === "en" ? dish.titlesEn : dish.titles;
  const steps0 = lang === "en" ? dish.stepsEn : dish.steps;
  if (!titles?.length || !steps0?.length)
    throw new Error(`${dish.key}: no ${lang} titles or steps`);

  const src = sourceFor(lang);
  let title = pickWeighted(titles);
  if (src.author && src.kind === "family" && chance(0.2) && lang === "fr")
    title = `${title} de ${src.author.replace(/\s*\(.*\)$/, "")}`;
  if (src.author && src.kind === "family" && chance(0.15) && lang === "en")
    title = `${shortName(src.author)}’s ${title}`;
  const untitled = src.kind === "magazine" && chance(0.2);
  const marks = {
    qty: chance(0.1),
    qtyAlt: chance(0.04),
    name: chance(0.06),
    author: chance(0.05) && !!src.author,
    added: chance(0.12),
    illegible: chance(0.04),
    servings: chance(0.03),
    oven: chance(0.03),
  };
  let uncertain = false;

  // slug
  let slug = slugify(title);
  const variantSlug = src.author
    ? slugify(shortName(src.author))
    : src.kind === "book"
      ? "livre"
      : src.kind === "magazine"
        ? "revue"
        : "carte";
  if (ctx.taken.has(slug)) slug = `${slugify(title)}-${variantSlug}`;
  for (let k = 2; ctx.taken.has(slug); k++)
    slug = `${slugify(title)}-${variantSlug}-${k}`;
  ctx.taken.add(slug);

  const fm: string[] = [
    "---",
    "schema: 3",
    `title: ${y(untitled ? `${title} [+]` : title)}`,
    `slug: ${slug}`,
  ];
  if (lang === "en" || chance(0.5)) fm.push(`lang: ${lang}`);
  if (dish.n + (dish.nEn ?? 0) > 2 && chance(0.4))
    fm.push(`family: ${dish.family}`, `variant: ${variantSlug}`);
  if (src.lines.length) {
    let lines = src.lines;
    if (marks.author && src.author) {
      const alt = pick(["Gisèle", "Ginette", "Lucille", "Rolande", "Jacinthe"]);
      lines = lines.map((l) =>
        l.startsWith("  author:")
          ? `  author: ${y(`${src.author} [?: ${alt}]`)}`
          : l,
      );
      uncertain = true;
    }
    fm.push("source:", ...lines);
  }

  // times, oven, servings
  const times: string[] = [];
  const cook = dish.cook ? pick(dish.cook) : undefined;
  const rest = dish.rest && chance(0.6) ? pick(dish.rest) : undefined;
  if (dish.prep && chance(0.5)) times.push(`  prep: ${pick(dish.prep)}`);
  if (cook) times.push(`  cook: ${cook}`);
  if (rest) times.push(`  rest: ${rest}`);
  if (times.length) fm.push("times:", ...times);

  let oven: { temp: number; temp_max?: number } | undefined;
  if (dish.oven) {
    const o = pick(dish.oven).split("-").map(Number);
    oven = { temp: o[0], ...(o[1] ? { temp_max: o[1] } : {}) };
    const t = marks.oven ? `"${oven.temp} [?]"` : String(oven.temp);
    if (marks.oven) uncertain = true;
    fm.push(
      `oven: { temp: ${t}, ${oven.temp_max ? `temp_max: ${oven.temp_max}, ` : ""}unit: F }`,
    );
  }

  const yields = lang === "en" ? (dish.yieldsEn ?? []) : (dish.yields ?? []);
  if (dish.servings && (!yields.length || chance(0.6)) && chance(0.85)) {
    const s = pick(dish.servings);
    fm.push(`servings: ${marks.servings ? `"${s} [?]"` : s}`);
    if (marks.servings) uncertain = true;
    if (chance(0.15)) fm.push(`servings_max: ${s + 2}`);
  } else if (yields.length && chance(0.85)) {
    const yv = pick(yields);
    fm.push(`yield: ${dish.yieldObjects?.[yv] ?? y(yv)}`);
  }

  let tags = [...dish.tags];
  if (tags.length > 3 && chance(0.3)) tags.splice(int(0, tags.length - 1), 1);
  fm.push(`tags: [${tags.join(", ")}]`);
  if (dish.season && chance(0.5))
    fm.push(`season: [${dish.season.join(", ")}]`);
  fm.push(`difficulty: ${pick(dish.difficulty)}`);
  if (chance(0.35)) fm.push(`rating: ${pick([3, 4, 4, 5, 5, 5])}`);

  // ingredients
  const truth = new Map<string, string>();
  const metric = src.printed && lang === "fr" && chance(0.7);
  fm.push("ingredients:");
  const groups = dish.groups.filter((g) => chance(g.p ?? 1));
  let markedQty = false;
  let markedName = false;
  groups.forEach((g, gi) => {
    const gname = lang === "en" ? (g.gEn ?? g.g) : g.g;
    const lines = g.items.filter((l) => chance(l.p ?? 1));
    if (!lines.length) return;
    fm.push(gname ? `  - group: ${y(gname)}` : "  - items:");
    if (gname) {
      if (g.optional) fm.push("    optional: true");
      fm.push("    items:");
    }
    const seen = new Set<string>();
    let ii = 0;
    for (const line of lines) {
      const entry = item(line, lang, metric, ctx);
      const key = entry.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const gIndex = fm.filter((l) => l.startsWith("  - ")).length - 1;
      const path = `ingredients[${gIndex}].items[${ii}]`;
      truth.set(`${path}.name`, line.i);
      entry.orKeys.forEach((k, oi) => truth.set(`${path}.or[${oi}]`, k));
      // markers
      if (marks.qty && !markedQty && entry.a.qty !== undefined && chance(0.4)) {
        entry.a.qty = `${entry.a.qty} [?]`;
        markedQty = uncertain = true;
      } else if (
        marks.qtyAlt &&
        !markedQty &&
        typeof entry.a.qty === "string" &&
        /^\d\/\d$/.test(entry.a.qty) &&
        chance(0.5)
      ) {
        entry.a.qty = `${entry.a.qty} [?: 1/${entry.a.qty.endsWith("2") ? 3 : 2}]`;
        markedQty = uncertain = true;
      }
      if (marks.name && !markedName && !entry.a.to_taste && chance(0.3)) {
        entry.name = `${entry.name} [?]`;
        markedName = uncertain = true;
      }
      fm.push(`      - ${flow(entry)}`);
      ii++;
    }
  });

  // bookkeeping
  const extractedBy = chance(0.9) ? "ai" : "hand";

  // body
  const temps = cook ?? rest;
  // `{?a|b}Step` is on the card only when ingredient a or b is.
  const present = new Set(
    [...truth].filter(([k]) => k.endsWith(".name")).map(([, v]) => v),
  );
  const holds = (alt: string) => {
    const m = alt.match(/^\{\?([^}]+)\}/);
    return !m || m[1].split("|").some((k) => present.has(k));
  };
  let steps = steps0
    .map((s) => s.split("||").filter(holds))
    .filter((alts) => alts.length)
    .map((alts) => pick(alts).replace(/^\{\?[^}]+\}/, ""));
  steps = steps.map((s) =>
    s
      .replace(
        "{four}",
        oven
          ? ovenText(oven, lang)
          : lang === "en"
            ? "moderate oven"
            : "four modéré",
      )
      .replace(
        "{temps}",
        temps
          ? durationText(temps, lang)
          : lang === "en"
            ? "until done"
            : "le temps qu’il faut",
      ),
  );
  if (marks.added) {
    const k = int(0, steps.length - 1);
    steps[k] = `${steps[k]} [+]`;
  }
  if (marks.illegible) {
    const k = int(0, steps.length - 1);
    steps[k] = steps[k].replace(
      /\.$/,
      lang === "en" ? " [illisible]." : " [illisible].",
    );
    uncertain = true;
  }
  const bullets = chance(0.08);
  const body: string[] = [
    "",
    lang === "en" ? "## Instructions" : "## Préparation",
    "",
    ...steps.map((s, i) => (bullets ? `- ${s}` : `${i + 1}. ${s}`)),
  ];
  const notes =
    lang === "en"
      ? [...(dish.notesEn ?? []), ...NOTES_EN]
      : [...(dish.notes ?? []), ...NOTES_FR];
  if (chance(0.45)) {
    const chosen = [
      ...new Set([
        pick(dish[lang === "en" ? "notesEn" : "notes"] ?? notes),
        ...(chance(0.3) ? [pick(notes)] : []),
      ]),
    ];
    body.push("", "## Notes", "", chosen.join("\n\n"));
  }
  const variantes = lang === "en" ? dish.variantsEn : dish.variantes;
  if (variantes?.length && chance(0.25))
    body.push(
      "",
      lang === "en" ? "## Variants" : "## Variantes",
      "",
      `- ${pick(variantes)}`,
    );

  const status = uncertain
    ? "needs-review"
    : pickWeighted(["draft*5", "verified*4", "needs-review*1"]);
  fm.push(`status: ${status}`);
  const addedMonth = int(1, 9);
  const added = date(addedMonth, addedMonth);
  fm.push(`added: ${added}`);
  if (status === "verified" && chance(0.6))
    fm.push(`updated: ${date(Math.min(addedMonth + 1, 9), 9)}`);
  fm.push(`extracted_by: ${extractedBy}`, "---");

  return { slug, text: [...fm, ...body, ""].join("\n"), truth };
}

interface Entry {
  a: Amount;
  name: string;
  brand?: string;
  note?: string;
  prep?: string;
  or: string[];
  orKeys: string[];
  optional?: boolean;
  recipe?: string;
  buy_instead?: boolean;
}

function item(line: Line, lang: Lang, metric: boolean, ctx: Ctx): Entry {
  let a = parseAmount(pick(line.a));
  if (metric) a = metricate(a);
  const def = INGREDIENTS[line.i];
  const name = nameFor(line.i, lang, a);
  const e: Entry = { a, name, or: [], orKeys: [] };
  const notes = lang === "en" ? line.noteEn : line.note;
  if (notes?.length && !a.note && chance(0.5)) {
    const n = pick(notes);
    if (!name.includes(n)) e.note = n;
  } else if (a.note) e.note = a.note;
  const preps = lang === "en" ? line.prepEn : line.prep;
  if (preps?.length && chance(0.7)) e.prep = pick(preps);
  if (def.brands?.length && chance(line.brandP ?? 0.15)) {
    const b = pick(def.brands);
    if (!name.toLowerCase().includes(b.toLowerCase()) && !/^[A-Z]/.test(name))
      e.brand = b;
  }
  if (line.or && chance(line.orP ?? 0.3)) {
    for (const k of line.or) {
      const n = nameFor(k, lang, {}, 0);
      if (n.toLowerCase() !== name.toLowerCase()) {
        e.or.push(n);
        e.orKeys.push(k);
      }
    }
  }
  if (line.opt && chance(line.opt)) e.optional = true;
  if (line.recipe && ctx.pates.length && chance(0.6)) {
    e.recipe = chance(0.1)
      ? pick(["pate-a-tarte-de-grand-maman", "pate-brisee-au-saindoux"])
      : pick(ctx.pates);
    if (chance(0.25)) e.buy_instead = true;
  }
  return e;
}

function flow(e: Entry): string {
  const parts: string[] = [];
  const a = e.a;
  if (a.qty !== undefined) parts.push(`qty: ${qtyY(a.qty)}`);
  if (a.qty_max !== undefined) parts.push(`qty_max: ${qtyY(a.qty_max)}`);
  if (a.unit && a.qty !== undefined) parts.push(`unit: ${a.unit}`);
  parts.push(`name: ${y(e.name)}`);
  if (e.brand) parts.push(`brand: ${y(e.brand)}`);
  if (e.note) parts.push(`note: ${y(e.note)}`);
  if (e.prep) parts.push(`prep: ${y(e.prep)}`);
  if (a.alt)
    parts.push(`alt: { qty: ${qtyY(a.alt.qty)}, unit: ${a.alt.unit} }`);
  if (e.or.length) parts.push(`or: [${e.or.map(y).join(", ")}]`);
  if (e.optional) parts.push("optional: true");
  if (a.to_taste) parts.push("to_taste: true");
  if (e.recipe) parts.push(`recipe: ${e.recipe}`);
  if (e.buy_instead) parts.push("buy_instead: true");
  return `{ ${parts.join(", ")} }`;
}

// --- the answer key ---------------------------------------------------------------

type Resolution = { slug: string } | { ambiguous: string } | { unknown: true };

/** Every written form of the table → the set of slugs it belongs to. */
function formIndex(): Map<
  string,
  { slugs: Set<string>; langs: Set<string>; typo: boolean }
> {
  const idx = new Map<
    string,
    { slugs: Set<string>; langs: Set<string>; typo: boolean }
  >();
  const add = (form: string, slug: string, lang: string, typo = false) => {
    const f = weighted(form)[0];
    const e = idx.get(f) ?? { slugs: new Set(), langs: new Set(), typo };
    e.slugs.add(slug);
    e.langs.add(lang);
    idx.set(f, e);
  };
  for (const [slug, d] of Object.entries(INGREDIENTS)) {
    for (const lang of ["fr", "en"] as const) {
      d[lang].forEach((f) => add(f, slug, lang));
      d.one?.[lang]?.forEach((f) => add(f, slug, lang));
      for (const u of Object.values(d.byUnit ?? {}))
        u[lang]?.forEach((f) => add(f, slug, lang));
    }
    d.typos?.forEach((f) => add(f, slug, "fr", true));
  }
  return idx;
}

/** Resolve a written name (markers stripped) through the answer key. */
export function resolveName(name: string, idx = formIndex()): Resolution {
  const n = stripMarkers(name);
  if (AMBIGUOUS[n]) return { ambiguous: n };
  const e = idx.get(n);
  if (!e) return { unknown: true };
  if (e.slugs.size > 1)
    throw new Error(
      `form "${n}" is under ${[...e.slugs].join(", ")} but not declared in AMBIGUOUS`,
    );
  return { slug: [...e.slugs][0] };
}

interface NameUse {
  name: string;
  lang: string;
  path: string;
  file: string;
}

/** Every ingredient name in a file: items and their `or` entries. */
export function namesIn(text: string, file: string): NameUse[] {
  const { frontmatter: fm } = parseRecipe(text);
  if (!fm || !Array.isArray(fm.ingredients)) return [];
  const lang = fm.lang === "en" ? "en" : "fr";
  const out: NameUse[] = [];
  fm.ingredients.forEach((g: any, gi: number) => {
    (g?.items ?? []).forEach((it: any, ii: number) => {
      const path = `ingredients[${gi}].items[${ii}]`;
      if (typeof it?.name === "string")
        out.push({
          name: stripMarkers(it.name),
          lang,
          path: `${path}.name`,
          file,
        });
      (Array.isArray(it?.or) ? it.or : []).forEach((o: any, oi: number) => {
        const n = typeof o === "string" ? o : o?.name;
        if (typeof n === "string")
          out.push({
            name: stripMarkers(n),
            lang,
            path: `${path}.or[${oi}]`,
            file,
          });
      });
    });
  });
  return out;
}

function answerKey(
  files: Map<string, string>,
  truths: Map<string, Map<string, string>>,
): string {
  const idx = formIndex();
  const uses = new Map<string, Map<string, { n: number; lang: Set<string> }>>();
  const ambiguous = new Map<string, number>();
  /** Every use of an ambiguous name, with the id its line means (null: the card does not say). */
  const given = new Map<string, { file: string; path: string; id: string | null }[]>();
  const handUsed = new Set<string>();
  const brands = new Map<string, Set<string>>();
  let total = 0;
  const problems: string[] = [];
  for (const [file, text] of files) {
    const truth = truths.get(file);
    const { frontmatter: fm } = parseRecipe(text);
    for (const u of namesIn(text, file)) {
      total++;
      const r = resolveName(u.name, idx);
      if ("unknown" in r) {
        problems.push(
          `${file} ${u.path}: "${u.name}" is not in scripts/corpus/ingredients.ts`,
        );
        continue;
      }
      if ("ambiguous" in r) {
        ambiguous.set(r.ambiguous, (ambiguous.get(r.ambiguous) ?? 0) + 1);
        const a = AMBIGUOUS[r.ambiguous];
        let t: string | null | undefined = truth?.get(u.path);
        if (!truth) {
          const h = a.hand ?? {};
          if (!(file in h))
            problems.push(
              `${file} ${u.path}: hand card uses "${r.ambiguous}"; add "${file}" to its \`hand\` (the id, or null)`,
            );
          else if (handUsed.has(`${r.ambiguous}\0${file}`))
            problems.push(
              `${file}: "${r.ambiguous}" used twice on one hand card; \`hand\` holds one id per card`,
            );
          t = h[file];
          handUsed.add(`${r.ambiguous}\0${file}`);
        }
        if (t && !a.candidates.includes(t))
          problems.push(
            `${file} ${u.path}: ${t} is not a candidate of "${r.ambiguous}"`,
          );
        (
          given.get(r.ambiguous) ??
          given.set(r.ambiguous, []).get(r.ambiguous)!
        ).push({ file, path: u.path, id: t ?? null });
        continue;
      }
      const expected = truth?.get(u.path);
      if (expected && expected !== r.slug)
        problems.push(
          `${file} ${u.path}: "${u.name}" generated as ${expected}, resolves to ${r.slug}`,
        );
      const m = uses.get(r.slug) ?? new Map();
      const e = m.get(u.name) ?? { n: 0, lang: new Set<string>() };
      e.n++;
      e.lang.add(u.lang);
      m.set(u.name, e);
      uses.set(r.slug, m);
    }
    // brands seen next to a resolved name
    (fm?.ingredients as any[] | undefined)?.forEach((g) =>
      (g?.items ?? []).forEach((it: any) => {
        if (typeof it?.brand !== "string" || typeof it?.name !== "string")
          return;
        const r = resolveName(it.name, idx);
        if ("slug" in r)
          (
            brands.get(r.slug) ?? brands.set(r.slug, new Set()).get(r.slug)!
          ).add(it.brand);
      }),
    );
  }
  if (problems.length)
    throw new Error(`answer key:\n  ${problems.join("\n  ")}`);
  for (const k of Object.keys(AMBIGUOUS))
    if (!ambiguous.has(k))
      throw new Error(`AMBIGUOUS "${k}" is never used in the corpus`);
  for (const [k, a] of Object.entries(AMBIGUOUS))
    for (const f of Object.keys(a.hand ?? {}))
      if (!handUsed.has(`${k}\0${f}`))
        throw new Error(`AMBIGUOUS "${k}".hand lists ${f}, which does not use it`);

  const doc = new Document({}, { version: "1.2" });
  doc.commentBefore = [
    " Ground truth for ingredient-name resolution over tests/fixtures/corpus/recipes.",
    " Generated by scripts/gen-corpus.ts from scripts/corpus/ingredients.ts. Do not edit:",
    " change the table and run `npx tsx scripts/gen-corpus.ts`.",
    "",
    " ingredients: canonical id → every written form of its `name` in the corpus",
    "   (item names and `or` entries, markers stripped, exactly as written). Each form",
    "   is listed once in the whole file. French forms first, then English, then",
    "   misspellings; most frequent first within each. The first variant is the",
    "   natural registry name (plan 03, metric R1). Trailing comment: occurrences,",
    "   language, and `typo` for a misspelling that normalization cannot fix.",
    " ambiguous: written forms that are one lookup key for several ids. The unit,",
    "   prep or language decides on the card, and none is part of the key: the",
    '   expected resolution from the name alone is "ambiguous", never one of the',
    "   candidates. given: every use, with the id its line means (from its unit,",
    "   prep or language), or null when the card does not say. A resolver that",
    "   looks at the line may resolve a use only to that id, and never a null one.",
    " confusables: ids that fold or read alike and must never merge.",
    "",
    " Invented data: no real recipe, person or source.",
  ].join("\n");
  const root = doc.contents as YAMLMap;
  root.set("version", 1);
  root.set("recipes", files.size);
  root.set("occurrences", total);
  const ingMap = new YAMLMap();
  const slugs = [...uses.keys()].sort(
    (a, b) =>
      INGREDIENTS[a].cat.localeCompare(INGREDIENTS[b].cat) ||
      a.localeCompare(b),
  );
  let variantCount = 0;
  for (const slug of slugs) {
    const def = INGREDIENTS[slug];
    const m = uses.get(slug)!;
    const node = new YAMLMap();
    node.set("category", def.cat);
    if (def.staple) node.set("staple", true);
    const primaries = [weighted(def.fr[0])[0], weighted(def.en[0])[0]];
    const rank = (f: string) => {
      if (idx.get(f)!.typo) return 4;
      const fr = m.get(f)!.lang.has("fr");
      return (fr ? 0 : 2) + (f === primaries[fr ? 0 : 1] ? 0 : 1);
    };
    const forms = [...m.keys()].sort(
      (a, b) =>
        rank(a) - rank(b) || m.get(b)!.n - m.get(a)!.n || a.localeCompare(b),
    );
    const seq = new YAMLSeq();
    for (const f of forms) {
      const s = new Scalar(f);
      const u = m.get(f)!;
      s.comment = ` ${u.n} ${[...u.lang].sort().reverse().join("+")}${idx.get(f)!.typo ? " typo" : ""}`;
      seq.items.push(s);
    }
    variantCount += forms.length;
    node.set("variants", seq);
    const b = brands.get(slug);
    if (b?.size) {
      const bs = new YAMLSeq();
      bs.flow = true;
      [...b].sort().forEach((x) => bs.items.push(new Scalar(x)));
      node.set("brands", bs);
    }
    if (def.note) node.set("note", def.note);
    ingMap.set(slug, node);
  }
  root.set("ingredients", ingMap);
  const amb = new YAMLMap();
  for (const [name, a] of Object.entries(AMBIGUOUS)) {
    const node = new YAMLMap();
    const c = new YAMLSeq();
    c.flow = true;
    a.candidates.forEach((x) => c.items.push(new Scalar(x)));
    node.set("candidates", c);
    node.set("occurrences", ambiguous.get(name) ?? 0);
    node.set("note", a.note);
    const gs = new YAMLSeq();
    for (const g of (given.get(name) ?? []).sort(
      (x, y) => x.file.localeCompare(y.file) || x.path.localeCompare(y.path),
    )) {
      const m = new YAMLMap();
      m.flow = true;
      m.set("file", g.file);
      m.set("path", g.path);
      m.set("id", new Scalar(g.id)); // a Scalar, so null is written `id: null`
      gs.items.push(m);
    }
    node.set("given", gs);
    amb.set(name, node);
  }
  root.set("ambiguous", amb);
  const conf = new YAMLSeq();
  for (const [a, b, why] of CONFUSABLES) {
    if (!uses.has(a) || !uses.has(b)) continue;
    const pair = new YAMLSeq();
    pair.flow = true;
    pair.items.push(new Scalar(a), new Scalar(b));
    pair.comment = ` ${why}`;
    conf.items.push(pair);
  }
  root.set("confusables", conf);
  stats.ids = slugs.length;
  stats.variants = variantCount;
  stats.ambiguous = Object.keys(AMBIGUOUS).length;
  return doc.toString({ lineWidth: 0 });
}

export const stats = { ids: 0, variants: 0, ambiguous: 0 };

// --- README table -----------------------------------------------------------------

function readmeTable(yamlText: string): string {
  const data = parseYaml(yamlText) as {
    ingredients: Record<
      string,
      { category: string; staple?: boolean; variants: string[] }
    >;
  };
  const rows = [
    "| id | category | variants in the corpus (most frequent first) |",
    "|---|---|---|",
  ];
  for (const [slug, v] of Object.entries(data.ingredients)) {
    rows.push(
      `| \`${slug}\`${v.staple ? " ·staple" : ""} | ${v.category} | ${v.variants.map((x) => x.replace(/\|/g, "\\|")).join(" · ")} |`,
    );
  }
  return rows.join("\n");
}

export function updateReadme(readme: string, yamlText: string): string {
  const start = "<!-- variant-table:start -->";
  const end = "<!-- variant-table:end -->";
  const i = readme.indexOf(start);
  const j = readme.indexOf(end);
  if (i < 0 || j < 0) return readme;
  return `${readme.slice(0, i + start.length)}\n${readmeTable(yamlText)}\n${readme.slice(j)}`;
}

// --- the dish answer key (plan 05, Phase 0) ---------------------------------------

function dishKey(files: Map<string, string>, dishOf: Map<string, string>): string {
  const lines = [
    "# The dish each card of tests/fixtures/corpus/recipes is: slug → dish key.",
    "# Generated by scripts/gen-corpus.ts (dishes.ts `key` for a generated card,",
    "# scripts/corpus/hand-dishes.ts for a hand-written one). Do not edit: change",
    "# those and run `npx tsx scripts/gen-corpus.ts`. Same key = same dish: the",
    "# answer key of duplicate detection (plan 05, Phase 5).",
    "",
  ];
  for (const f of files.keys()) {
    const key = dishOf.get(f);
    if (!key) throw new Error(`${f}: no dish key`);
    lines.push(`${f.replace(/\.md$/, "")}: ${key}`);
  }
  return `${lines.join("\n")}\n`;
}

// --- the whole corpus -----------------------------------------------------------

export interface Corpus {
  /** file name → text, generated and hand-written. */
  files: Map<string, string>;
  yaml: string;
  /** expected-dishes.yaml: slug → dish key. */
  dishes: string;
  generated: number;
  hand: number;
}

export function generateCorpus(handDir = join(CORPUS_DIR, "hand")): Corpus {
  rand = mulberry32(SEED);
  primaryUsed.clear();
  const hand = new Map<string, string>();
  for (const f of readdirSync(handDir)
    .filter((f) => f.endsWith(".md"))
    .sort())
    hand.set(f, readFileSync(join(handDir, f), "utf8"));
  const ctx: Ctx = {
    taken: new Set([...hand.keys()].map((f) => f.replace(/\.md$/, ""))),
    pates: [],
  };
  const files = new Map<string, string>();
  const truths = new Map<string, Map<string, string>>();
  const dishOf = new Map<string, string>();
  for (const dish of DISHES) {
    const langs: Lang[] = [
      ...Array(dish.n).fill("fr"),
      ...Array(dish.nEn ?? 0).fill("en"),
    ];
    for (const lang of langs) {
      const g = generate(dish, lang, ctx);
      const r = checkRecipe(g.text);
      if (hasErrors(r.diagnostics)) {
        const errs = r.diagnostics
          .filter((d) => d.severity === "error")
          .map((d) => `${d.code} ${d.path}: ${d.message}`);
        throw new Error(
          `generated ${g.slug}.md has errors:\n  ${errs.join("\n  ")}\n${g.text}`,
        );
      }
      files.set(`${g.slug}.md`, g.text);
      truths.set(`${g.slug}.md`, g.truth);
      dishOf.set(`${g.slug}.md`, dish.key);
      if (dish.key === "pate-brisee" && lang === "fr") ctx.pates.push(g.slug);
    }
  }
  const generated = files.size;
  for (const [f, t] of hand) {
    files.set(f, t);
    const key = HAND_DISHES[f];
    if (!key)
      throw new Error(`hand card ${f} has no dish in scripts/corpus/hand-dishes.ts`);
    dishOf.set(f, key);
  }
  for (const f of Object.keys(HAND_DISHES))
    if (!hand.has(f))
      throw new Error(`scripts/corpus/hand-dishes.ts names ${f}, which is no hand card`);
  const sorted = new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
  return {
    files: sorted,
    yaml: answerKey(sorted, truths),
    dishes: dishKey(sorted, dishOf),
    generated,
    hand: hand.size,
  };
}

function main() {
  const args = process.argv.slice(2);
  const o = args.indexOf("--out");
  const out = o >= 0 ? resolve(args[o + 1]) : CORPUS_DIR;
  const corpus = generateCorpus();
  const recipes = join(out, "recipes");
  rmSync(recipes, { recursive: true, force: true });
  mkdirSync(recipes, { recursive: true });
  for (const [f, t] of corpus.files) writeFileSync(join(recipes, f), t);
  writeFileSync(join(out, "expected-ingredients.yaml"), corpus.yaml);
  writeFileSync(join(out, "expected-dishes.yaml"), corpus.dishes);
  if (out === CORPUS_DIR) {
    const readmePath = join(out, "README.md");
    try {
      writeFileSync(
        readmePath,
        updateReadme(readFileSync(readmePath, "utf8"), corpus.yaml),
      );
    } catch {
      // no README yet
    }
  }
  console.log(
    `${corpus.files.size} recipes (${corpus.generated} generated, ${corpus.hand} hand-written) → ${recipes}\n` +
      `answer key: ${stats.ids} ids, ${stats.variants} variants, ${stats.ambiguous} ambiguous names`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
