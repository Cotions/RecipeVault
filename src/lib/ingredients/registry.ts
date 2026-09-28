// One registry file, `ingredients/<slug>.md`: parse, check, serialize
// (docs/INGREDIENTS.md, "The registry"; plan 03 Phase 1). Codes E801–W811
// (docs/VALIDATION.md, "Registry codes"), all settled by the person (`app`).
// Browser-safe.

import { isMap as isYamlMap, isScalar, isSeq, parseDocument, YAMLSeq, type Document, type YAMLMap } from 'yaml';
import { parseRecipe, bodyText } from '../vault/parse';
import { normalizeText } from '../vault/normalize';
import { scalar } from '../vault/serialize';
import { SLUG_RE } from '../vault/slug';
import { UNITS, type Diagnostic, type Lang, type Unit } from '../vault/types';
import { suggestKey } from '../vault/vocab';
import { lookupKey } from './normalize';
import { CATEGORIES, NAME_LANGS, type Category, type RegistryEntry } from './types';

/** Frontmatter keys, in the order the serializer writes them. */
export const REGISTRY_KEYS = [
	'slug',
	'category',
	'names',
	'default_unit',
	'staple',
	'au_gout',
	'density',
	'weights',
	'substitutes',
	'allergens'
] as const;

export interface IngredientCheckOptions {
	/** The file name without `.md`: the slug must equal it (like E113 for recipes). */
	fileStem?: string;
	/** The allergen list (vocab/allergens.yaml). Absent: allergens are not checked against a list. */
	allergens?: ReadonlySet<string>;
}

export interface IngredientCheck {
	/** Set when the file has no error. */
	entry?: RegistryEntry;
	diagnostics: Diagnostic[];
}

const UNIT_SET = new Set<string>(UNITS);
const CATEGORY_SET = new Set<string>(CATEGORIES);

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Parse and check one ingredient file. */
export function parseIngredient(text: string, opts: IngredientCheckOptions = {}): IngredientCheck {
	const out: Diagnostic[] = [];
	const report = (code: string, path: string | null, message: string, fix?: string) =>
		out.push({ code, severity: code[0] === 'E' ? 'error' : 'warning', path, message, ...(fix ? { fix } : {}) });

	const parsed = parseRecipe(text);
	if (!parsed.frontmatter) {
		const d = parsed.diagnostics[0];
		report('E801', null, `the ingredient file does not read: ${d?.message ?? 'no frontmatter'}`, d?.fix);
		return { diagnostics: out };
	}
	const fm = parsed.frontmatter;

	for (const k of Object.keys(fm)) {
		if (!(REGISTRY_KEYS as readonly string[]).includes(k)) {
			const near = suggestKey(k, REGISTRY_KEYS);
			report('W811', k, `unknown key \`${k}\` in an ingredient file; it is ignored.`, near ? `Did you mean \`${near}\`?` : undefined);
		}
	}

	const slug = fm.slug;
	if (!isText(slug) || !SLUG_RE.test(slug)) {
		report('E802', 'slug', `\`slug\` must be lowercase ASCII words joined by hyphens, got ${JSON.stringify(slug ?? null)}.`, opts.fileStem ? `Set \`slug: ${opts.fileStem}\`.` : undefined);
	} else if (opts.fileStem !== undefined && slug !== opts.fileStem) {
		report('E802', 'slug', `\`slug: ${slug}\` does not match the file name ${opts.fileStem}.md; the slug is the file name.`, `Rename the file to \`${slug}.md\`, or set \`slug: ${opts.fileStem}\`.`);
	}

	const category = fm.category;
	if (typeof category !== 'string' || !CATEGORY_SET.has(category)) {
		report('E803', 'category', `\`category\` must be one of ${CATEGORIES.join(', ')}, got ${JSON.stringify(category ?? null)}.`);
	}

	const names: Record<Lang, string[]> = { fr: [], en: [] };
	if (!isMap(fm.names)) {
		report('E804', 'names', '`names` must be a mapping of `fr` and `en` to lists of names.', 'Write `names: { fr: [farine], en: [flour] }`.');
	} else {
		for (const [lang, list] of Object.entries(fm.names)) {
			if (!(NAME_LANGS as string[]).includes(lang)) {
				report('E804', `names.${lang}`, `\`names.${lang}\`: only \`fr\` and \`en\` are allowed.`);
				continue;
			}
			if (list === null || list === undefined) continue;
			if (!Array.isArray(list)) {
				report('E804', `names.${lang}`, `\`names.${lang}\` must be a list of names.`, `Write \`${lang}: [${String(list)}]\`.`);
				continue;
			}
			list.forEach((n, i) => {
				if (!isText(n)) report('E804', `names.${lang}[${i}]`, `\`names.${lang}[${i}]\` must be a name (text), got ${JSON.stringify(n)}.`);
				else names[lang as Lang].push(normalizeText(n).trim());
			});
		}
		if (!names.fr.length && !names.en.length && !out.some((d) => d.code === 'E804'))
			report('E804', 'names', 'the ingredient has no name: `names.fr` and `names.en` are both empty.', 'Add at least one name.');
	}

	let defaultUnit: Unit | undefined;
	if (fm.default_unit !== undefined && fm.default_unit !== null) {
		if (typeof fm.default_unit === 'string' && UNIT_SET.has(fm.default_unit)) defaultUnit = fm.default_unit as Unit;
		else report('E806', 'default_unit', `\`default_unit\` must be a canonical unit (${UNITS.join(', ')}), got ${JSON.stringify(fm.default_unit)}.`);
	}

	const bool = (key: 'staple' | 'au_gout'): boolean => {
		const v = fm[key];
		if (v === undefined || v === null) return false;
		if (typeof v === 'boolean') return v;
		report('E807', key, `\`${key}\` must be true or false, got ${JSON.stringify(v)}.`);
		return false;
	};
	const staple = bool('staple');
	const auGout = bool('au_gout');

	let density: number | undefined;
	if (fm.density !== undefined && fm.density !== null) {
		if (typeof fm.density === 'number' && Number.isFinite(fm.density) && fm.density > 0) density = fm.density;
		else report('E805', 'density', `\`density\` must be a positive number of grams per millilitre, got ${JSON.stringify(fm.density)}.`);
	}

	const weights: Partial<Record<Unit, number>> = {};
	if (fm.weights !== undefined && fm.weights !== null) {
		if (!isMap(fm.weights)) report('E805', 'weights', '`weights` must be a mapping of unit to grams: `{ piece: 55, clove: 5 }`.');
		else
			for (const [unit, g] of Object.entries(fm.weights)) {
				if (!UNIT_SET.has(unit)) report('E805', `weights.${unit}`, `\`weights.${unit}\`: \`${unit}\` is not a canonical unit.`);
				else if (typeof g !== 'number' || !Number.isFinite(g) || g <= 0)
					report('E805', `weights.${unit}`, `\`weights.${unit}\` must be a positive number of grams, got ${JSON.stringify(g)}.`);
				else weights[unit as Unit] = g;
			}
	}

	const textList = (key: 'substitutes' | 'allergens'): string[] => {
		const v = fm[key];
		if (v === undefined || v === null) return [];
		if (!Array.isArray(v)) {
			report('E807', key, `\`${key}\` must be a list, got ${JSON.stringify(v)}.`, `Write \`${key}: [${String(v)}]\`.`);
			return [];
		}
		const list: string[] = [];
		v.forEach((x, i) => {
			if (typeof x !== 'string' || !SLUG_RE.test(x)) report('E807', `${key}[${i}]`, `\`${key}[${i}]\` must be a slug (lowercase, hyphens), got ${JSON.stringify(x)}.`);
			else list.push(x);
		});
		return list;
	};
	const substitutes = textList('substitutes');
	const allergens = textList('allergens');
	if (opts.allergens)
		allergens.forEach((a, i) => {
			if (!opts.allergens!.has(a)) {
				const near = suggestKey(a, [...opts.allergens!]);
				report('W809', `allergens[${i}]`, `allergen \`${a}\` is not in vocab/allergens.yaml; it is ignored.`, near ? `Did you mean \`${near}\`?` : undefined);
			}
		});

	if (out.some((d) => d.severity === 'error')) return { diagnostics: out };
	return {
		entry: {
			slug: slug as string,
			category: category as Category,
			names,
			...(defaultUnit ? { defaultUnit } : {}),
			staple,
			auGout,
			...(density !== undefined ? { density } : {}),
			weights,
			substitutes,
			allergens: opts.allergens ? allergens.filter((a) => opts.allergens!.has(a)) : allergens,
			body: bodyText(text)
		},
		diagnostics: out
	};
}

/**
 * Checks across the whole registry: a substitute that is not an entry (or the
 * entry itself, W808), and a lookup key written under two entries (W810,
 * resolution then treats that key as ambiguous). Keyed by slug.
 */
export function checkRegistry(entries: RegistryEntry[]): Map<string, Diagnostic[]> {
	const out = new Map<string, Diagnostic[]>();
	const add = (slug: string, d: Diagnostic) => out.set(slug, [...(out.get(slug) ?? []), d]);
	const slugs = new Set(entries.map((e) => e.slug));
	const owners = new Map<string, Set<string>>();
	for (const e of entries)
		for (const lang of NAME_LANGS)
			for (const n of e.names[lang]) {
				const k = lookupKey(n);
				if (!owners.has(k)) owners.set(k, new Set());
				owners.get(k)!.add(e.slug);
			}
	for (const e of entries) {
		e.substitutes.forEach((s, i) => {
			if (s === e.slug) add(e.slug, warn('W808', `substitutes[${i}]`, `\`${s}\` is listed as a substitute for itself.`));
			else if (!slugs.has(s)) add(e.slug, warn('W808', `substitutes[${i}]`, `substitute \`${s}\` is not in the registry (no ingredients/${s}.md).`, `Create it, or remove it from \`substitutes\`.`));
		});
		const seen = new Set<string>();
		for (const lang of NAME_LANGS)
			e.names[lang].forEach((n, i) => {
				const k = lookupKey(n);
				const others = [...owners.get(k)!].filter((s) => s !== e.slug);
				if (!others.length || seen.has(k)) return;
				seen.add(k);
				add(
					e.slug,
					warn('W810', `names.${lang}[${i}]`, `the name "${n}" is also a name of ${others.join(', ')}; recipes writing it stay unresolved (ambiguous).`, `Keep the name under one ingredient only.`)
				);
			});
	}
	return out;
}

const warn = (code: string, path: string, message: string, fix?: string): Diagnostic => ({ code, severity: 'warning', path, message, ...(fix ? { fix } : {}) });

/** A number as YAML writes it back: `1.0` stays readable as a float only when it has a fraction. */
const num = (n: number) => String(n);

const flowList = (xs: string[]) => `[${xs.map((x) => scalar(x, true)).join(', ')}]`;

/** An entry → its canonical file: fixed key order, names in flow lists, LF, NFC. */
export function serializeIngredient(e: RegistryEntry): string {
	const lines = ['---', `slug: ${e.slug}`, `category: ${e.category}`, 'names:'];
	for (const lang of NAME_LANGS) lines.push(`  ${lang}: ${flowList(e.names[lang])}`);
	if (e.defaultUnit) lines.push(`default_unit: ${e.defaultUnit}`);
	lines.push(`staple: ${e.staple}`);
	if (e.auGout) lines.push('au_gout: true');
	if (e.density !== undefined) lines.push(`density: ${num(e.density)}`);
	const w = Object.entries(e.weights);
	if (w.length) lines.push(`weights: { ${w.map(([u, g]) => `${u}: ${num(g!)}`).join(', ')} }`);
	lines.push(`substitutes: ${flowList(e.substitutes)}`);
	lines.push(`allergens: ${flowList(e.allergens)}`);
	lines.push('---', '');
	const body = normalizeText(e.body).trim();
	return (lines.join('\n') + (body ? `\n${body}\n` : '')).normalize('NFC');
}

// --- Edits (plan 03, Phase 3: the resolve queue) ------------------------------
// The frontmatter is edited as a YAML document, so the rest of a hand-edited
// file (comments, order, the body) stays as it was.

export class IngredientEditError extends Error {}

function splitFile(text: string): { yaml: string; rest: string } {
	const t = normalizeText(text);
	const m = /^---\n([\s\S]*?\n)?---(\n|$)/.exec(t);
	if (!m) throw new IngredientEditError('the ingredient file has no frontmatter.');
	return { yaml: m[1] ?? '', rest: t.slice(m[0].length) };
}

/** `edit` returns false when it changed nothing: the file then comes back as it was. */
function editNames(text: string, edit: (names: YAMLMap) => boolean): string {
	const { yaml, rest } = splitFile(text);
	const doc = parseDocument(yaml, { version: '1.2' }) as unknown as Document;
	if (doc.errors.length || !isYamlMap(doc.contents)) throw new IngredientEditError('the ingredient file does not read.');
	const root = doc.contents as YAMLMap;
	let names: unknown = root.get('names', true);
	if (!isYamlMap(names)) {
		names = doc.createNode({});
		root.set('names', names);
	}
	if (!edit(names as YAMLMap)) return text;
	return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n${rest}`.normalize('NFC');
}

/** The file with `name` added to `names.<lang>` (unchanged when an alias already has its lookup key). */
export function withName(text: string, lang: Lang, name: string): string {
	const clean = normalizeText(name).replace(/\s+/g, ' ').trim();
	const key = lookupKey(clean);
	return editNames(text, (names) => {
		for (const l of NAME_LANGS) {
			const seq = names.get(l, true);
			if (isSeq(seq) && seq.items.some((n) => isScalar(n) && typeof n.value === 'string' && lookupKey(n.value) === key)) return false;
		}
		const seq = names.get(lang, true);
		if (isSeq(seq)) seq.add(clean);
		else {
			const node = new YAMLSeq();
			node.flow = true;
			node.add(clean);
			names.set(lang, node);
		}
		return true;
	});
}

/** The file without the aliases whose lookup key is `key`, in any language. */
export function withoutKey(text: string, key: string): string {
	return editNames(text, (names) => {
		let changed = false;
		for (const l of NAME_LANGS) {
			const seq = names.get(l, true);
			if (!isSeq(seq)) continue;
			const kept = seq.items.filter((n) => !(isScalar(n) && typeof n.value === 'string' && lookupKey(n.value) === key));
			changed ||= kept.length !== seq.items.length;
			seq.items = kept;
		}
		return changed;
	});
}

/** A slug proposed from a written name: `Crème 35 %` → `creme-35`. */
export function proposeSlug(name: string): string {
	return lookupKey(name)
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}
