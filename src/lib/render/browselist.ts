// The home list's shape, browser-safe: same-title rows bundled under one
// title, the two columns' split, and the pager's pages named by guide words.

import { stripMarkers } from "../vault/markers";
import { fold } from "../vault/normalize";
import { provenanceParts, type ProvenanceFields } from "./provenance";

/** What a list row needs here (a `Card` of the index). */
export interface Row {
  title: string;
  family: string | null;
}

export interface Entry<C extends Row> {
  cards: C[];
  /** The letter tab before it (title order), if any. */
  divider: string | null;
  /** Every card's family, when there are several and they share one. */
  family: string | null;
}

const titleKey = (title: string) =>
  fold(stripMarkers(title)).replace(/\s+/g, " ").trim();

/**
 * Rows that follow each other with the same title (folded: case, accents and
 * markers aside) become one entry — the title once, then a line per recipe.
 * A letter tab always starts a new entry.
 */
export function bundle<C extends Row>(
  list: { card: C; divider: string | null }[],
): Entry<C>[] {
  const out: Entry<C>[] = [];
  for (const { card, divider } of list) {
    const last = out[out.length - 1];
    if (
      last &&
      !divider &&
      titleKey(last.cards[0].title) === titleKey(card.title)
    )
      last.cards.push(card);
    else out.push({ cards: [card], divider, family: null });
  }
  for (const e of out) {
    const f = e.cards[0].family;
    e.family =
      e.cards.length > 1 && f && e.cards.every((c) => c.family === f)
        ? f
        : null;
  }
  return out;
}

/**
 * A search's results, in relevance order, with the rows of the same title
 * (folded) brought up under the best placed one: three « Tourtière de Noël »
 * read as one entry, where the first of them ranked, not as rows far apart.
 * Otherwise the order is kept.
 */
export function gather<T extends { title: string }>(list: T[]): T[] {
  const by = new Map<string, T[]>();
  for (const x of list) {
    const k = titleKey(x.title);
    const same = by.get(k);
    if (same) same.push(x);
    else by.set(k, [x]);
  }
  return [...by.values()].flat();
}

/**
 * Where the second column starts (title order, two columns): the index of the
 * entry that opens it, so the columns come out about even. Each entry weighs
 * about its height in rows: a letter tab, a row, a same-title group's heading
 * and its lines. Null when there is nothing to split.
 */
export function columnSplit<C extends Row>(entries: Entry<C>[]): number | null {
  if (entries.length < 2) return null;
  const weight = (e: Entry<C>) =>
    (e.divider ? 0.55 : 0) +
    (e.cards.length > 1
      ? 0.6 + 0.62 * e.cards.length
      : e.cards[0].title.length > 44
        ? 1.35
        : 1);
  const w = entries.map(weight);
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  let best = 1;
  let gap = Infinity;
  for (let i = 1; i < entries.length; i++) {
    acc += w[i - 1];
    // The second column opens with a continued letter's tab when the split falls inside a letter.
    const second = total - acc + (entries[i].divider ? 0 : 0.55);
    const d = Math.max(acc, second);
    if (d < gap) {
      gap = d;
      best = i;
    }
  }
  return best;
}

/**
 * Where each page of a title-sorted list starts (indexes into the folded
 * titles, in order): about `size` titles a page, the break moved to where a
 * letter changes when one falls within 30 % of it, else to where the first
 * word changes, never between two same titles if it can help it. The rest
 * stays on the last page when it fits there (a page never holds a lone
 * letter's tail). « A–B », « C », « D–G » rather than « A–C », « C–G ».
 */
export function pageStarts(titles: string[], size: number): number[] {
  const n = titles.length;
  const starts = [0];
  const first = (x: string) => x.split(" ")[0];
  const tier = (b: number) => {
    const a = titles[b - 1];
    const c = titles[b];
    if (a.charAt(0) !== c.charAt(0)) return 0;
    if (first(a) !== first(c)) return 1;
    return a === c ? 3 : 2;
  };
  let s = 0;
  while (n - s > Math.round(size * 1.3)) {
    const ideal = s + size;
    const lo = s + Math.ceil(size * 0.7);
    const hi = Math.min(n - Math.ceil(size * 0.3), s + Math.floor(size * 1.3));
    let best = ideal;
    let score = [Infinity, Infinity];
    for (let b = lo; b <= hi; b++) {
      const t = tier(b);
      const d = Math.abs(b - ideal);
      if (t < score[0] || (t === score[0] && d < score[1])) {
        best = b;
        score = [t, d];
      }
    }
    starts.push(best);
    s = best;
  }
  return starts;
}

/** A page of the pager: its number, and its first and last guide words (title order). */
export interface PageLink {
  page: number;
  /** Empty when the list is not sorted by title. */
  first: string;
  last: string;
}

/** A page's guide words, like a dictionary's: where it starts and where it ends. */
export interface Guide {
  first: string;
  last: string;
}

/**
 * Each page's guide words, from the folded titles at its edges (title order,
 * `titles[p]` = the first and last title of page p + 1). Where two pages meet
 * between two letters, the letters alone (« …–G », « H–… »); where they meet
 * inside a letter, as many letters as it takes to tell the two titles apart
 * (« …–Ca », « Ce–… »), four at most. The list's first and last page start and
 * end with a letter: « A–Ca », « Ce–G », « H–Mo », « Mu–Z ».
 */
export function guideWords(titles: Guide[]): Guide[] {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const word = (s: string, n: number) =>
    cap(s.slice(0, n).replace(/[^\p{L}\p{N}]+$/u, "")) ||
    cap(s.charAt(0)) ||
    "#";
  const edge = (a: string, b: string): [string, string] => {
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    if (k === 0) return [word(a, 1), word(b, 1)];
    const n = Math.min(k + 1, 4);
    return [word(a, n), word(b, n)];
  };
  const out = titles.map((x) => ({
    first: word(x.first, 1),
    last: word(x.last, 1),
  }));
  for (let p = 0; p + 1 < titles.length; p++) {
    const [end, start] = edge(titles[p].last, titles[p + 1].first);
    out[p].last = end;
    out[p + 1].first = start;
  }
  // A page that starts inside a letter and ends at its end: « Sau–Suc », not « Sau–S ».
  out.forEach((g, p) => {
    if (g.last.length < g.first.length && g.first.startsWith(g.last))
      g.last = word(titles[p].last, g.first.length);
  });
  return out;
}

/**
 * The pages to offer: all of them up to nine, else the first two, the last two
 * and those around this one, a `null` for each gap. Sorted by title (`guides`
 * given, one per page), each page says where it starts and ends: « A–Ca »,
 * « Ce–G ».
 */
export function pageLinks(
  o: { page: number; pages: number },
  guides: Guide[] | null,
): (PageLink | null)[] {
  if (o.pages < 2) return [];
  const keep = (p: number) =>
    o.pages <= 9 || p <= 2 || p > o.pages - 2 || Math.abs(p - o.page) <= 1;
  const out: (PageLink | null)[] = [];
  for (let p = 1; p <= o.pages; p++) {
    if (!keep(p)) {
      if (out[out.length - 1] !== null) out.push(null);
      continue;
    }
    const g = guides?.[p - 1];
    out.push({ page: p, first: g?.first ?? "", last: g?.last ?? "" });
  }
  return out;
}

/** Folded for the comparison below: markers, case, accents aside, and the punctuation at either end. */
const nameKey = (s: string) =>
  fold(stripMarkers(s))
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")
    .trim();

/**
 * Whether a title already ends with the name of who it is from — « Tarte aux
 * pommes de Matante Ginette » and « Matante Ginette »; « Sucre à la crème
 * (Aline) » and « aline » — markers, case, accents and the closing
 * punctuation aside, the name a whole word (« Tarte de Josiane » does not end
 * with « Ane »).
 */
export function titleEndsWithName(
  title: string,
  name: string | null | undefined,
): boolean {
  const n = name ? nameKey(name) : "";
  if (!n) return false;
  const t = nameKey(title);
  if (!t.endsWith(n)) return false;
  const before = t.slice(0, t.length - n.length);
  return before === "" || /[^\p{L}\p{N}]$/u.test(before);
}

/**
 * A list row's provenance (provenanceParts) without the author the title
 * already says: « Tarte aux pommes de Matante Ginette » is not followed by
 * « de Matante Ginette ». The rest stays — « Tiré du Tablier bleu, p. 12 ».
 */
export function rowProvenance(s: ProvenanceFields & { title: string }): {
  lead: string;
  name: string;
  rest: string;
} {
  const p = provenanceParts(s);
  if (!s.author || !titleEndsWithName(s.title, s.author)) return p;
  const author = stripMarkers(s.author).trim();
  if (p.name === author && !p.rest) return { lead: "", name: "", rest: "" };
  const tail = ` · ${author}`;
  return p.rest.endsWith(tail)
    ? { ...p, rest: p.rest.slice(0, -tail.length) }
    : p;
}
