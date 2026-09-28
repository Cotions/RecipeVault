import { fail } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { ingredientIndex, INDEX_SORTS, type IndexSort } from '$lib/server/ingredients';
import { appendPrice, knownShops, PriceError, priceProblems } from '$lib/server/prices';
import { today } from '$lib/ingredients/prices';
import { CATEGORIES } from '$lib/ingredients/types';
import { UNITS } from '$lib/vault/types';
import { formatMoney, formatPack } from '$lib/render/money';
import { t } from '$lib/i18n/fr';
import type { Actions, PageServerLoad } from './$types';

const yesNo = (v: string | null) => (v === 'oui' ? true : v === 'non' ? false : undefined);

export const load: PageServerLoad = ({ url }) => {
	const app = getApp();
	const p = url.searchParams;
	const sort = (INDEX_SORTS as readonly string[]).includes(p.get('tri') ?? '') ? (p.get('tri') as IndexSort) : 'a-saisir';
	const filter = {
		sort,
		reverse: p.get('inverse') === '1',
		category: (CATEGORIES as readonly string[]).includes(p.get('categorie') ?? '') ? p.get('categorie')! : undefined,
		priced: yesNo(p.get('prix')),
		staple: yesNo(p.get('essentiel')),
		q: p.get('q')?.trim() || undefined
	};
	const day = today();
	const rows = ingredientIndex(app.ctx.db, filter, day);
	const all = app.ctx.db.prepare('SELECT count(*) FROM registry').pluck().get() as number;
	const priced = app.ctx.db.prepare('SELECT count(*) FROM registry r JOIN current_price c ON c.ingredient = r.slug').pluck().get() as number;
	return {
		rows,
		filter: { ...filter, q: filter.q ?? '', category: filter.category ?? '', prix: p.get('prix') ?? '', essentiel: p.get('essentiel') ?? '' },
		total: all,
		priced,
		problems: priceProblems(app.ctx.db, app.ctx.currency),
		shops: knownShops(app.ctx.db, app.config.shops),
		money: { currency: app.config.currency, locale: app.config.locale },
		categories: [...CATEGORIES],
		units: [...UNITS],
		today: day
	};
};

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
/** A number as typed in a French form: `0,89` or `0.89`. */
const num = (f: FormData, k: string) => {
	const s = str(f, k).replace(/[\s  $]/g, '').replace(',', '.');
	return /^\d*\.?\d+$/.test(s) ? Number(s) : NaN;
};

export const actions: Actions = {
	price: async ({ request }) => {
		const app = getApp();
		const f = await request.formData();
		const slug = str(f, 'slug');
		try {
			const { row } = await appendPrice(app.ctx, {
				ingredient: slug,
				amount: num(f, 'amount'),
				packQty: num(f, 'pack_qty'),
				packUnit: str(f, 'pack_unit'),
				shop: str(f, 'shop'),
				date: str(f, 'date')
			});
			const name = (app.ctx.db.prepare('SELECT name FROM registry WHERE slug = ?').pluck().get(slug) as string | undefined) ?? slug;
			const money = { currency: app.config.currency, locale: app.config.locale };
			return { ok: true, slug, shop: row.shop, message: t.ingredients.saved(name, `${formatMoney(row.amount, money)} ${t.ingredients.per(formatPack(row.packQty, row.packUnit))}`) };
		} catch (e) {
			if (e instanceof PriceError) return fail(409, { ok: false, slug, shop: str(f, 'shop'), message: e.message });
			throw e;
		}
	}
};
