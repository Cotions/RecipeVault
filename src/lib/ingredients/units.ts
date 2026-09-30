// Unit conversion for cost (docs/INGREDIENTS.md, "Unit conversion"; plan 03,
// Phase 5, Q10–Q13). Browser-safe and pure: the factors are data from the
// vault's vocab/conversions.yaml, the densities and weights come from the
// ingredient's registry entry. Nothing is guessed: an amount that cannot be
// measured against a pack is unpriceable, never estimated.

import { stripMarkers } from '../vault/markers';
import { parseQuantity } from '../vault/quantity';
import { UNITS, type Lang, type Unit } from '../vault/types';
import { findAllQtyUnits, unitForAlias } from '../vault/vocab';
import { UNIT_CLASS_OF, UNIT_CLASSES } from './types';

/** vocab/conversions.yaml: grams for one mass unit, millilitres for one volume unit. */
export interface Conversions {
	mass: Partial<Record<Unit, number>>;
	volume: Partial<Record<Unit, number>>;
}

export const NO_CONVERSIONS: Conversions = { mass: {}, volume: {} };

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read vocab/conversions.yaml. Only canonical units of the right class with a
 * positive factor are kept; anything else is ignored (a broken file means
 * fewer conversions, never a failed page).
 */
export function parseConversions(data: unknown): Conversions {
	const out: Conversions = { mass: {}, volume: {} };
	if (!isMap(data)) return out;
	for (const kind of ['mass', 'volume'] as const) {
		const block = data[kind];
		if (!isMap(block)) continue;
		const allowed = UNIT_CLASSES[kind] as readonly string[];
		for (const [u, f] of Object.entries(block)) {
			if (allowed.includes(u) && typeof f === 'number' && Number.isFinite(f) && f > 0) out[kind][u as Unit] = f;
		}
	}
	return out;
}

/** What conversion needs to know about an ingredient: its registry entry's density and weights. */
export interface Convertible {
	/** Grams per millilitre. */
	density?: number;
	/** Grams for one of a unit: `{ piece: 55, tbsp: 12 }`. Overrides density for that unit (Q11). */
	weights?: Partial<Record<Unit, number>>;
}

/**
 * An amount measured every way it safely can: in its own unit, in grams, in
 * millilitres. `derived` counts the steps that went through the ingredient's
 * density or weights rather than a fixed factor; fewer is preferred.
 */
export type Measures = Map<string, { qty: number; derived: number }>;

function put(m: Measures, dim: string, qty: number, derived: number): void {
	const had = m.get(dim);
	if (!had || had.derived > derived) m.set(dim, { qty, derived });
}

/**
 * Measure `qty unit` of an ingredient. `size` is a container's size read from
 * its note (Q13 B): one can of 796 ml. Keys are a unit name (its own unit),
 * `g` and `ml`.
 */
export function measure(qty: number, unit: Unit, ing: Convertible, conv: Conversions, size?: { qty: number; unit: Unit }[]): Measures {
	const m: Measures = new Map();
	put(m, unit, qty, 0);
	const cls = UNIT_CLASS_OF[unit];
	const weight = ing.weights?.[unit];
	if (weight !== undefined && weight > 0) put(m, 'g', qty * weight, 1);
	if (cls === 'mass' && conv.mass[unit]) put(m, 'g', qty * conv.mass[unit]!, 0);
	if (cls === 'volume' && conv.volume[unit]) put(m, 'ml', qty * conv.volume[unit]!, 0);
	if (cls === 'container' && size) {
		// Each reading of the size (`19 oz (540 ml)`) is the same amount: take every measure it gives.
		for (const s of size) {
			for (const [dim, v] of measure(qty * s.qty, s.unit, ing, conv)) if (dim === 'g' || dim === 'ml') put(m, dim, v.qty, v.derived);
		}
	}
	// Mass ↔ volume only through the ingredient's own density.
	const d = ing.density;
	if (d !== undefined && d > 0) {
		const g = m.get('g');
		const ml = m.get('ml');
		if (ml && !g) put(m, 'g', ml.qty * d, ml.derived + 1);
		else if (g && !ml) put(m, 'ml', g.qty / d, g.derived + 1);
	}
	return m;
}

/**
 * How many packs `need` is, or undefined when no common measure exists. The
 * same unit wins; otherwise the measure reached with the fewest derived steps
 * (a price per litre against millilitres before the same through grams).
 */
export function packsOf(need: Measures, pack: Measures): number | undefined {
	let best: { packs: number; score: number } | undefined;
	for (const [dim, n] of need) {
		const p = pack.get(dim);
		if (!p || !(p.qty > 0)) continue;
		const score = n.derived + p.derived;
		if (!best || score < best.score) best = { packs: n.qty / p.qty, score };
	}
	return best?.packs;
}

/** `1-1/2` and `1½` as cards write them, a decimal comma: a number (also read by step amounts, plan 05). */
export function sizeNumber(q: string): number | undefined {
	const VULGAR: Record<string, string> = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' };
	const s = q
		.trim()
		.replace(/^(\d+)-(?=\d+\/)/, '$1 ')
		.replace(/(\d)\s*([½¼¾⅓⅔⅛])/, '$1 $2')
		.replace(/[½¼¾⅓⅔⅛]/, (v) => VULGAR[v])
		.replace(/\s+/g, ' ')
		.replace(',', '.');
	const r = parseQuantity(s);
	return r.ok ? r.value : undefined;
}

/** A multipack count right before a size: `2 x `, `6× `. */
const MULTIPACK_RE = /(?<![\p{L}\p{N}.,])(\d+)\s*[x×]\s*$/iu;

/**
 * The size of one container, from `note` (Q13 B), in the E216 grammar: one
 * size (`796 ml`), or one size with its equivalent in parentheses
 * (`19 oz (540 ml)`). A multipack, `2 x 400 g` or `6 × 355 ml`, is the whole
 * pack: 800 g, 2130 ml. Anything else (two sizes, an alternative, an ambiguous
 * unit, a multipack with an equivalent) gives nothing, and the item stays
 * unpriced.
 */
export function noteSize(note: string | undefined, lang: Lang): { qty: number; unit: Unit }[] | undefined {
	if (!note) return undefined;
	const text = stripMarkers(note);
	const found = findAllQtyUnits(text);
	if (found.length === 0 || found.length > 2) return undefined;
	const times = found.map((f) => MULTIPACK_RE.exec(text.slice(0, f.start)));
	if (found.length === 2) {
		const [a, b] = found;
		if (times.some(Boolean)) return undefined;
		if (!/^\s*\(\s*$/.test(text.slice(a.end, b.start)) || !/^\s*\)/.test(text.slice(b.end))) return undefined;
	}
	const out: { qty: number; unit: Unit }[] = [];
	for (const [i, f] of found.entries()) {
		const unit = unitForAlias(f.unitText, lang);
		const n = times[i] ? Number(times[i]![1]) : 1;
		const size = sizeNumber(f.qty);
		const qty = size === undefined || !(n > 0) ? undefined : size * n;
		if (!unit || qty === undefined) return undefined;
		const cls = UNIT_CLASS_OF[unit];
		if (cls !== 'mass' && cls !== 'volume') return undefined;
		out.push({ qty, unit });
	}
	return out;
}

export const isUnit = (u: string): u is Unit => (UNITS as readonly string[]).includes(u);
