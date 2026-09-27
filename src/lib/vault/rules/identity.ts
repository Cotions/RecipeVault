// Identity, classification and bookkeeping: E101, E102, E104, E105, E107, E110,
// E112, W504, W610.

import { parse } from 'yaml';
import { slugify, SLUG_RE } from '../slug';
import { stripMarkers } from '../markers';
import { ALLOWED_KEYS, MISPLACED_TOP_KEYS, SCHEMA_VERSIONS, SEASONS, seasonFor, suggestSeason } from '../vocab';
import { checkKeys, isBlank, isMap, join, show, type RuleContext } from './context';

export function checkIdentity(ctx: RuleContext): void {
	const { fm } = ctx;
	checkKeys(ctx, fm, '', ALLOWED_KEYS.top, MISPLACED_TOP_KEYS);

	if (isBlank(fm.schema)) {
		ctx.report('E110', 'schema', '`schema` is missing.', 'Add `schema: 3` as the first line of the frontmatter.');
	} else if (!(SCHEMA_VERSIONS as readonly unknown[]).includes(fm.schema)) {
		ctx.report('E110', 'schema', `\`schema: ${show(fm.schema)}\` is not a version this app knows.`, 'Write `schema: 3`.');
	}

	const title = fm.title;
	const titleOk = typeof title === 'string' && title.trim() !== '';
	if (isBlank(title)) {
		ctx.report('E101', 'title', '`title` is missing and is required.', 'Add `title:` as written on the source; if it has none, make one and mark it `[+]`.');
	} else if (!titleOk) {
		const fix =
			typeof title === 'object'
				? 'Write the title as one line of text in quotes, `title: "…"`, in the language of the recipe.'
				: `Write the title in quotes: \`title: "${String(title)}"\`.`;
		ctx.report('E101', 'title', `\`title: ${show(title)}\` is not text.`, fix);
	}

	if (!isBlank(fm.slug)) {
		if (typeof fm.slug !== 'string' || !SLUG_RE.test(fm.slug)) {
			const better = slugify(String(fm.slug)) || (titleOk ? slugify(title as string) : '');
			ctx.report(
				'E102',
				'slug',
				`\`slug: ${show(fm.slug)}\` is not lowercase ASCII words joined by hyphens.`,
				better ? `Write \`slug: ${yamlText(better)}\`.` : 'Use lowercase letters, digits and hyphens only, no accents.'
			);
		}
	} else if (titleOk && slugify(title as string) === '') {
		ctx.report('E102', 'slug', 'no slug can be derived from the title.', 'Add `slug:` — lowercase, ASCII, hyphenated.');
	}

	if (!isBlank(fm.lang) && fm.lang !== 'fr' && fm.lang !== 'en') {
		const guess = /^(fr|fran|french)/i.test(String(fm.lang)) ? 'fr' : /^(en|ang|engl)/i.test(String(fm.lang)) ? 'en' : undefined;
		ctx.report('E104', 'lang', `\`lang: ${show(fm.lang)}\` is not \`fr\` or \`en\`.`, guess ? `Write \`lang: ${guess}\`.` : 'Write `lang: fr` or `lang: en`.');
	}

	const hasFamily = !isBlank(fm.family);
	const hasVariant = !isBlank(fm.variant);
	if (hasFamily !== hasVariant) {
		const [set, missing] = hasFamily ? ['family', 'variant'] : ['variant', 'family'];
		ctx.report(
			'E105',
			missing,
			`\`${set}\` is set without \`${missing}\`.`,
			`Set both \`family\` and \`variant\`, or remove \`${set}\` — family membership is decided in the app unless the source presents the recipe as a version of a dish.`
		);
	}

	for (const key of ['difficulty', 'rating'] as const) {
		const v = fm[key];
		if (isBlank(v)) continue;
		if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) {
			ctx.report('E107', key, `\`${key}: ${show(v)}\` is not a whole number from 1 to 5.`, `Write \`${key}:\` as 1, 2, 3, 4 or 5, or remove it.`);
		}
	}

	// E112 is reported as info: on the paste path the app strips these keys
	// with a note rather than rejecting the file (docs/VALIDATION.md).
	for (const key of ['status', 'added'] as const) {
		if (fm[key] === undefined) continue;
		ctx.report('E112', key, `\`${key}\` is set by the app, not the file; it will be stripped.`, `Remove \`${key}\`.`, 'info');
	}

	if (isMap(fm.media)) checkKeys(ctx, fm.media, 'media', ALLOWED_KEYS.media);

	// W504: the four seasons of docs/VOCAB.md, or their aliases. A value that is
	// not text is E218's.
	if (Array.isArray(fm.season)) {
		fm.season.forEach((v, i) => {
			if (typeof v !== 'string' || v.trim() === '' || seasonFor(stripMarkers(v))) return;
			const guess = suggestSeason(stripMarkers(v));
			ctx.report(
				'W504',
				join('season', i),
				`\`${show(v)}\` is not a season.`,
				`${guess ? `Did you mean \`${guess}\`? ` : ''}Seasons are ${SEASONS.map((x) => `\`${x}\``).join(', ')}; leave \`season\` out for a recipe made all year.`
			);
		});
	}
}

/** A string as a YAML value: quoted when it would read as a number, boolean or null. */
function yamlText(s: string): string {
	return typeof parse(s, { version: '1.2' }) === 'string' ? s : `"${s}"`;
}
