// One object that reads in the language of the person being served
// (../prefs.ts): `t.app.name` is French or English at the moment it is read,
// so a component never chooses. Every language has the same shape; the
// compiler checks it (`Strings`). Browser-safe.

import { locale } from '../prefs';
import type { Lang } from '../vault/types';

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;

/**
 * `byLang[locale()]`, read deeply and at every access. The keys are the
 * French ones (`Object.keys` works); a string missing from another language
 * falls back to French rather than showing nothing.
 */
export function localized<T extends object>(byLang: Record<Lang, T>): T {
	const views = new Map<string, object>();
	const view = (path: readonly string[]): object => {
		const id = path.join('\u0000');
		const known = views.get(id);
		if (known) return known;
		const at = (lang: Lang) => path.reduce<unknown>((o, k) => (isPlain(o) ? o[k] : undefined), byLang[lang]) as Record<string, unknown> | undefined;
		const fallback = at('fr') ?? {};
		const made = new Proxy(fallback, {
			get(target, key) {
				if (typeof key === 'symbol') return Reflect.get(target, key);
				const own = at(locale());
				const v = own && key in own ? own[key] : target[key];
				return isPlain(v) ? view([...path, key]) : v;
			}
		});
		views.set(id, made);
		return made;
	};
	return view([]) as T;
}
