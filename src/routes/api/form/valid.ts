import type { FormRecipe } from '$lib/form/model';

/** The shape `fromForm` walks, checked before it does (a request is not trusted to be a form). */
export function validForm(f: unknown): f is FormRecipe {
	if (typeof f !== 'object' || f === null) return false;
	const o = f as Record<string, unknown>;
	// A body nested too deep for JSON.stringify (a RangeError) is no form either: a 400, not a 500.
	try {
		if (JSON.stringify(o).length > 500_000) return false;
	} catch {
		return false;
	}
	const str = (v: unknown) => typeof v === 'string';
	const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
	const item = (it: unknown): boolean =>
		obj(it) &&
		['id', 'qty', 'qtyMax', 'unit', 'name', 'brand', 'note', 'prep', 'recipe', 'item'].every((k) => str(it[k])) &&
		Array.isArray(it.or) &&
		it.or.every(item) &&
		obj(it.written) &&
		(it.alt === null || (obj(it.alt) && str(it.alt.qty) && str(it.alt.qtyMax) && str(it.alt.unit) && obj(it.alt.written)));
	const dur = (d: unknown) => obj(d) && ['hours', 'minutes', 'maxHours', 'maxMinutes'].every((k) => d[k] === null || typeof d[k] === 'number');
	return (
		o.version === 1 &&
		typeof o.schema === 'number' &&
		['slug', 'lang', 'title', 'family', 'variant', 'servings', 'servingsMax', 'servingsNote', 'preamble'].every((k) => str(o[k])) &&
		obj(o.source) &&
		obj(o.times) &&
		['prep', 'cook', 'rest', 'total'].every((k) => dur((o.times as Record<string, unknown>)[k])) &&
		obj(o.oven) &&
		obj(o.yield) &&
		Array.isArray(o.tags) &&
		o.tags.every(str) &&
		Array.isArray(o.season) &&
		o.season.every(str) &&
		Array.isArray(o.groups) &&
		o.groups.every((g) => obj(g) && str(g.id) && str(g.name) && Array.isArray(g.items) && g.items.every(item) && obj(g.written)) &&
		Array.isArray(o.sections) &&
		o.sections.every((s) => obj(s) && str(s.kind) && str(s.heading) && typeof s.level === 'number' && (s.kind !== 'method' || (Array.isArray(s.rows) && s.rows.every((r) => obj(r) && str(r.text) && obj(r.written))))) &&
		obj(o.media) &&
		obj(o.app) &&
		obj(o.written)
	);
}
