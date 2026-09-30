import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { checkBatch, checkRecipe } from "../../src/lib/vault/check";
import { parseRecipe, stripMarkers } from "../../src/lib/vault/index";
import {
  generateCorpus,
  namesIn,
  updateReadme,
} from "../../scripts/gen-corpus";

// The invented Québécois card corpus (tests/fixtures/corpus/README.md) and its
// answer key, expected-ingredients.yaml, used by the ingredient-registry tests.

const DIR = "tests/fixtures/corpus";
const RECIPES = join(DIR, "recipes");
const files = readdirSync(RECIPES)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((name) => ({ name, text: readFileSync(join(RECIPES, name), "utf8") }));
const yamlText = readFileSync(join(DIR, "expected-ingredients.yaml"), "utf8");
const key = parseYaml(yamlText) as {
  recipes: number;
  occurrences: number;
  ingredients: Record<string, { category: string; variants: string[] }>;
  ambiguous: Record<string, { candidates: string[]; occurrences: number }>;
  confusables: [string, string][];
};
const errors = (
  ds: { code: string; severity: string; path: string | null }[],
) => ds.filter((d) => d.severity === "error").map((d) => `${d.code} ${d.path}`);

describe("corpus fixture", () => {
  it("has about 300 recipes, some hand-written", () => {
    expect(files.length).toBeGreaterThanOrEqual(280);
    expect(
      readdirSync(join(DIR, "hand")).filter((f) => f.endsWith(".md")).length,
    ).toBeGreaterThanOrEqual(35);
    expect(key.recipes).toBe(files.length);
  });

  it.each(files.map((f) => [f.name, f.text]))("%s has no errors", (_, text) => {
    expect(errors(checkRecipe(text).diagnostics)).toEqual([]);
  });

  it("has no errors checked together", () => {
    const r = checkBatch(files);
    expect(
      r.files.flatMap((f) =>
        errors(f.diagnostics).map((e) => `${f.name}: ${e}`),
      ),
    ).toEqual([]);
  });

  it("has slugs that match the filenames", () => {
    const bad = files.filter(
      (f) =>
        parseRecipe(f.text).frontmatter?.slug !== f.name.replace(/\.md$/, ""),
    );
    expect(bad.map((f) => f.name)).toEqual([]);
  });

  it("is what the generator writes (regenerate with `npx tsx scripts/gen-corpus.ts`)", () => {
    const corpus = generateCorpus();
    expect([...corpus.files.keys()]).toEqual(files.map((f) => f.name));
    for (const f of files)
      expect(corpus.files.get(f.name), f.name).toBe(f.text);
    expect(corpus.yaml).toBe(yamlText);
    expect(corpus.dishes).toBe(readFileSync(join(DIR, "expected-dishes.yaml"), "utf8"));
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    expect(updateReadme(readme, yamlText)).toBe(readme);
  });
});

describe("dish key", () => {
  const dishes = parseYaml(
    readFileSync(join(DIR, "expected-dishes.yaml"), "utf8"),
  ) as Record<string, string>;

  it("names the dish of every card, and nothing else", () => {
    expect(Object.keys(dishes).sort()).toEqual(
      files.map((f) => f.name.replace(/\.md$/, "")).sort(),
    );
    for (const k of Object.values(dishes))
      expect(k).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("groups the cards: most dishes have several", () => {
    const n = new Map<string, number>();
    for (const k of Object.values(dishes)) n.set(k, (n.get(k) ?? 0) + 1);
    expect([...n.values()].filter((c) => c > 1).length).toBeGreaterThan(50);
    expect(dishes["binnes-du-camp"]).toBe("feves-au-lard");
  });
});

describe("answer key", () => {
  const owner = new Map<string, string>();
  const dupes: string[] = [];
  for (const [slug, v] of Object.entries(key.ingredients)) {
    for (const n of v.variants) {
      if (owner.has(n)) dupes.push(`${n}: ${owner.get(n)}, ${slug}`);
      owner.set(n, slug);
    }
  }
  for (const n of Object.keys(key.ambiguous)) {
    if (owner.has(n)) dupes.push(`${n}: ${owner.get(n)}, ambiguous`);
    owner.set(n, "ambiguous");
  }

  it("lists each written form once", () => {
    expect(dupes).toEqual([]);
  });

  it("covers every name in the corpus, and nothing else", () => {
    const used = new Map<string, number>();
    for (const f of files)
      for (const u of namesIn(f.text, f.name))
        used.set(u.name, (used.get(u.name) ?? 0) + 1);
    expect([...used.keys()].filter((n) => !owner.has(n))).toEqual([]);
    expect([...owner.keys()].filter((n) => !used.has(n))).toEqual([]);
    expect([...used.values()].reduce((a, b) => a + b, 0)).toBe(key.occurrences);
    for (const [n, a] of Object.entries(key.ambiguous))
      expect(used.get(n), n).toBe(a.occurrences);
  });

  it("stores names already stripped of markers", () => {
    expect([...owner.keys()].filter((n) => stripMarkers(n) !== n)).toEqual([]);
  });

  it("has slug-shaped ambiguous candidates and confusables between corpus ids", () => {
    const ids = new Set(Object.keys(key.ingredients));
    for (const a of Object.values(key.ambiguous)) {
      expect(a.candidates.length).toBeGreaterThanOrEqual(2);
      for (const c of a.candidates)
        expect(c).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    for (const [a, b] of key.confusables) {
      expect(a).not.toBe(b);
      expect(ids.has(a) && ids.has(b), `${a} / ${b}`).toBe(true);
    }
  });

  it("keeps the traps apart", () => {
    const id = (n: string) => owner.get(n);
    expect(id("piment vert")).toBe("piment-vert");
    expect(id("piment fort")).toBe("piment-fort");
    expect(id("échalotes françaises")).toBe("echalote-francaise");
    expect(id("échalotes")).toBe("echalote-verte");
    expect(id("pâte à tarte")).toBe("pate-a-tarte");
    expect(id("pâtes")).toBe("pates-alimentaires");
    expect(id("crème 35 %")).toBe("creme-35");
    expect(id("crème 15 %")).toBe("creme-15");
    expect(id("sucre brun")).toBe("cassonade");
    expect(id("lard")).toBe("ambiguous");
  });
});
