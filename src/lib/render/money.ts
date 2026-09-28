// Money and pack sizes for display (plan 03, decision 2): the currency and
// the locale come from the config, never from this code. Browser-safe.

import type { Unit } from '../vault/types';
import { unitLabel } from './ingredient';

export interface Money {
	/** ISO 4217 code: the config's `currency`. */
	currency: string;
	/** BCP 47 locale: the config's `locale`. */
	locale: string;
}

const formats = new Map<string, Intl.NumberFormat>();

/** `0,89 $` in fr-CA / CAD. */
export function formatMoney(amount: number, m: Money): string {
	const k = `${m.locale}|${m.currency}`;
	let f = formats.get(k);
	if (!f) formats.set(k, (f = new Intl.NumberFormat(m.locale, { style: 'currency', currency: m.currency })));
	return f.format(amount);
}

/** A pack size as printed on the pack, in decimals: `400 g`, `2,5 kg`, `6 pièces`, `1 boîte`. */
export function formatPack(qty: number, unit: Unit): string {
	const word = unit === 'piece' ? (qty >= 2 ? 'pièces' : 'pièce') : unitLabel(unit, qty, 'fr');
	return `${String(Number(qty.toFixed(3))).replace('.', ',')} ${word}`;
}
