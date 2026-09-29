// Small pure helpers of the recipe form's components (plan 04, Phases 4–5),
// kept out of the .svelte files so they can be unit-tested. Browser-safe.

import type { Block, Draft, FormRecipe, Mark } from '../../form';
import { sameForm } from '../../form/draft';
import { form as f } from '../../i18n/fr-form';
import { explain } from '../../i18n/diagnostics';

/**
 * "Autre lecture" (Q15 A): the field's shown text with the marked span
 * replaced by its other reading — the rest of the field kept as it is.
 */
export function withAlternative(text: string, mark: Pick<Mark, 'start' | 'end' | 'alternative'>): string {
	if (mark.alternative === undefined) return text;
	return text.slice(0, mark.start) + mark.alternative + text.slice(mark.end);
}

/** The W608 pair offer she accepted: the other recipe and her variant name for it. */
export interface DraftPair {
	slug: string;
	hash: string;
	title: string;
	variant: string;
}

/** A draft of the form (Q17 A) with what she chose beside the form: a new family's label, a W608 pair. */
export interface FormDraft extends Draft {
	familyLabel?: string;
	pair?: DraftPair;
}

/** Whether a draft holds something beyond the form she opened. */
export function draftDiffers(d: Pick<FormDraft, 'form' | 'familyLabel' | 'pair'>, initial: FormRecipe): boolean {
	return !sameForm(d.form, initial) || !!d.familyLabel || !!d.pair;
}

/** The draft to write: the form, the extras only when set. */
export function packDraft(form: FormRecipe, extras: { hash?: string; familyLabel: string; pair: DraftPair | null }, at: number): FormDraft {
	return {
		form,
		...(extras.hash ? { hash: extras.hash } : {}),
		...(extras.familyLabel ? { familyLabel: extras.familyLabel } : {}),
		...(extras.pair ? { pair: { ...extras.pair } } : {}),
		at
	};
}

/** The extras of a loaded draft, checked (a draft is data from the device, not trusted). */
export function unpackDraft(d: FormDraft): { familyLabel: string; pair: DraftPair | null } {
	const p = d.pair;
	const pair =
		p && typeof p === 'object' && typeof p.slug === 'string' && typeof p.hash === 'string' && typeof p.title === 'string' && typeof p.variant === 'string'
			? { slug: p.slug, hash: p.hash, title: p.title, variant: p.variant }
			: null;
	return { familyLabel: typeof d.familyLabel === 'string' ? d.familyLabel : '', pair };
}

/**
 * Enter in a single-line field must not save the recipe (implicit form
 * submission): only the Enregistrer button saves.
 */
export function blocksImplicitSubmit(key: string, target: { tagName?: string; type?: string } | null): boolean {
	if (key !== 'Enter' || !target || target.tagName !== 'INPUT') return false;
	return !['submit', 'button', 'reset', 'image', 'file'].includes((target.type ?? 'text').toLowerCase());
}

/**
 * What a number field of a duration shows: the number, nothing when empty,
 * and what she typed when it is not a number (never "NaN").
 */
export function durationText(value: number | null, typed: string | undefined): string {
	if (value === null) return '';
	if (Number.isNaN(value)) return typed ?? '';
	return String(value);
}

/**
 * The French line next to a blocked field: the form's own sentence for its
 * reason, the words at fault for a marker, the checker's line for any other
 * checker error (never its code).
 */
export function blockText(b: Block | undefined): string | undefined {
	if (!b) return undefined;
	if (b.reason === 'marker') return f.fieldMarker(b.value ?? '[…]');
	if (b.reason === 'checker') return b.code ? explain(b.code) : f.blocks.other;
	return f.field[b.reason] ?? f.field.format;
}

/** The browser's blocks and the server's (the vault check, a refused save), one per field. */
export function mergeBlocks(mine: Block[], server: Block[]): Block[] {
	const out = [...mine];
	for (const b of server) if (!out.some((o) => o.id === b.id && o.field === b.field)) out.push(b);
	return out;
}

/** The short line in the save bar for one block (what keeps Save disabled). */
export function reasonLine(b: Block): string {
	if (b.reason === 'checker') return b.code ? explain(b.code) : f.blocks.other;
	if (b.reason === 'marker') return f.blocks.marker;
	const k =
		b.field === 'title' || b.field === 'ingredients' || b.field === 'variant' || b.field === 'family' || b.field === 'items'
			? b.field
			: b.field === 'oven.unit'
				? 'oven'
				: b.field === 'source.url'
					? 'url'
					: b.reason === 'required' && b.field === 'name'
						? 'name'
						: b.reason === 'fraction' || b.reason === 'zero'
							? 'format'
							: b.reason === 'incomplete'
								? 'unit'
								: b.reason;
	return f.blocks[k] ?? f.blocks.other;
}
