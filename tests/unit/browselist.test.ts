import { describe, expect, it } from "vitest";
import {
  bundle,
  columnSplit,
  gather,
  guideWords,
  pageLinks,
  pageStarts,
  rowProvenance,
  titleEndsWithName,
} from "../../src/lib/render/browselist";

const row = (
  title: string,
  family: string | null = null,
  divider: string | null = null,
) => ({ card: { title, family }, divider });

describe("the home list", () => {
  it("bundles rows that follow each other with the same title, case and accents aside", () => {
    const e = bundle([
      row("Carrés aux dattes", "dattes", "C"),
      row("Carrés aux Dattes", "dattes"),
      row("Carres aux dattes", "dattes"),
      row("Cipaille"),
    ]);
    expect(e.map((x) => x.cards.length)).toEqual([3, 1]);
    expect(e[0].divider).toBe("C");
    expect(e[0].family).toBe("dattes");
    expect(e[1].family).toBeNull();
  });
  it("names no family when the same titles do not all share one, and never bundles across a letter tab", () => {
    const e = bundle([
      row("Tourtière", "tourtiere"),
      row("Tourtière", null),
      row("Tourtière", null, "T"),
    ]);
    expect(e.map((x) => x.cards.length)).toEqual([2, 1]);
    expect(e[0].family).toBeNull();
  });
  it("names each page by its guide words, never two pages alike, sorted by title", () => {
    // The folded titles at each page's edges (render: title_sort).
    const g = guideWords([
      { first: "apple crisp", last: "carres aux dattes" },
      { first: "cipaille", last: "gateau renverse" },
      { first: "jambon", last: "salade de chou" },
      { first: "salade de patates", last: "tourtiere" },
    ]);
    expect(g).toEqual([
      { first: "A", last: "Ca" },
      { first: "Ci", last: "G" },
      { first: "J", last: "Sala" },
      { first: "Sala", last: "T" },
    ]);
    // Inside a letter, as many letters as it takes: « …–Sal », « Sau–… ».
    expect(
      guideWords([
        { first: "pain", last: "salade" },
        { first: "sauce", last: "sucre" },
      ]),
    ).toEqual([
      { first: "P", last: "Sal" },
      { first: "Sau", last: "Suc" },
    ]);
    expect(pageLinks({ page: 1, pages: 2 }, g.slice(0, 2))).toEqual([
      { page: 1, first: "A", last: "Ca" },
      { page: 2, first: "Ci", last: "G" },
    ]);
    expect(pageLinks({ page: 1, pages: 1 }, g.slice(0, 1))).toEqual([]);
  });
  it("breaks a title-sorted list where a letter changes, near the page size", () => {
    const titles = [..."aaaaaaa", ..."bbb", ..."ccccccc", ..."dd"].map(
      (l, i) => `${l}${String(i).padStart(2, "0")}`,
    );
    // 19 titles, about 6 a page: the first break moves from 6 to the a's end (7).
    const s = pageStarts(titles, 6);
    expect(s.slice(0, 2)).toEqual([0, 7]);
    // A rest that fits stays on the page: no page for a letter's tail.
    expect(pageStarts(titles.slice(0, 7), 6)).toEqual([0]);
    // No letter change near: where the first word changes, rather than between two same titles.
    const same = [
      "pain a",
      "pain a",
      "pain a",
      "pain b",
      "pate",
      "pate",
      "pate",
      "pate",
      "pate",
      "pate",
    ];
    expect(pageStarts(same, 4)[1]).toBe(4);
  });
  it("brings the same titles of a search together, where the best placed one ranked", () => {
    const list = [
      "Tourtière de Noël",
      "Tourtière",
      "Tourtière de noel",
      "Pâté",
      "Tourtiere",
    ].map((title) => ({ title }));
    expect(gather(list).map((x) => x.title)).toEqual([
      "Tourtière de Noël",
      "Tourtière de noel",
      "Tourtière",
      "Tourtiere",
      "Pâté",
    ]);
  });
  it("starts the second column about half way, counting a group by its lines", () => {
    type E = {
      cards: { title: string; family: string | null }[];
      divider: string | null;
      family: string | null;
    };
    const one = (title: string, divider: string | null = null): E => ({
      cards: [{ title, family: null }],
      divider,
      family: null,
    });
    const group: E = {
      cards: Array.from({ length: 6 }, () => ({
        title: "Carrés aux dattes",
        family: "dattes",
      })),
      divider: null,
      family: "dattes",
    };
    expect(columnSplit([one("A", "A"), one("B"), one("C"), one("D")])).toBe(2);
    // The six-line group weighs more than one row: the split comes before it.
    expect(
      columnSplit([
        one("Apple", "A"),
        one("Banane", "B"),
        group,
        one("Cipaille"),
        one("Cretons"),
      ]),
    ).toBe(2);
    expect(columnSplit([one("A")])).toBeNull();
  });
  it("keeps the first two, the last two and the pages around this one of a long list", () => {
    const p = pageLinks({ page: 10, pages: 20 }, null);
    expect(p.map((x) => x?.page ?? null)).toEqual([
      1,
      2,
      null,
      9,
      10,
      11,
      null,
      19,
      20,
    ]);
    expect(p[0]).toEqual({ page: 1, first: "", last: "" });
  });
});

describe("a row’s provenance, when the title already names who it is from", () => {
  it("reads the end of the title, case, accents, markers and closing punctuation aside, a whole word only", () => {
    expect(
      titleEndsWithName(
        "Tarte aux pommes de Matante Ginette",
        "Matante Ginette",
      ),
    ).toBe(true);
    expect(
      titleEndsWithName("Gâteau renversé de TANTE BERTHE", "Tante Berthé"),
    ).toBe(true);
    expect(titleEndsWithName("Sucre à la crème (Aline)", "Aline")).toBe(true);
    expect(titleEndsWithName("Galettes d’Aline", "Aline")).toBe(true);
    expect(titleEndsWithName("Tarte de Josiane", "Ane")).toBe(false);
    expect(titleEndsWithName("Tarte de Ginette aux pommes", "Ginette")).toBe(
      false,
    );
    expect(titleEndsWithName("Tarte aux pommes", "")).toBe(false);
    expect(titleEndsWithName("Tarte aux pommes", null)).toBe(false);
  });
  it("drops « de X » and keeps the rest of the line", () => {
    expect(
      rowProvenance({
        title: "Tarte aux pommes de Matante Ginette",
        author: "Matante Ginette",
        source_type: "family",
      }),
    ).toEqual({ lead: "", name: "", rest: "" });
    expect(
      rowProvenance({
        title: "Pouding de Grand-papa Lucien",
        author: "Grand-papa Lucien",
        source_type: "book",
        source_title: "Le Tablier bleu",
        source_page: "12",
      }),
    ).toEqual({ lead: "Tiré du ", name: "Tablier bleu", rest: ", p.\u00a012" });
    expect(
      rowProvenance({
        title: "Tarte aux pommes",
        author: "Matante Ginette",
        source_type: "family",
      }),
    ).toEqual({
      lead: "de ",
      name: "Matante Ginette",
      rest: "",
    });
  });
});
