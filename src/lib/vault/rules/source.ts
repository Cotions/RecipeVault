// Provenance: E106, E114, W604.

import { ALLOWED_KEYS, SOURCE_TYPES } from '../vocab';
import { checkKeys, isBlank, isMap, show, type RuleContext } from './context';

const TYPES = SOURCE_TYPES.join(' | ');

export function checkSource(ctx: RuleContext): void {
	const source = ctx.fm.source;
	if (isBlank(source)) {
		ctx.report('W604', 'source', '`source` is absent — the recipe’s provenance is lost.', `Add \`source:\` with the \`type:\` (${SOURCE_TYPES.join(', ')}), author, title, page or url the source gives.`);
		return;
	}
	if (!isMap(source)) {
		ctx.report('E106', 'source', `\`source: ${show(source)}\` is not a \`{ type, author, … }\` entry.`, `Write \`source:\` with \`type: ${TYPES}\` and, as available, \`author\`, \`title\`, \`page\`, \`url\`, \`note\`.`);
		return;
	}
	checkKeys(ctx, source, 'source', ALLOWED_KEYS.source);
	// `type` is optional — never guessed; only a type that is there is checked.
	if (!isBlank(source.type) && !(SOURCE_TYPES as readonly unknown[]).includes(source.type)) {
		ctx.report(
			'E106',
			'source.type',
			`\`source.type: ${show(source.type)}\` is not an allowed source type.`,
			`Use one of: ${TYPES}, or leave \`type\` out if the kind of source is not evident.`
		);
	}
	// A url that is not text is E218's.
	const url = source.url;
	if (typeof url === 'string' && url.trim() !== '' && !WEB_URL_RE.test(url.trim())) {
		const domain = url.trim().match(BARE_DOMAIN_RE);
		ctx.report(
			'E114',
			'source.url',
			`\`url: ${show(url)}\` is not a web address starting with \`http://\` or \`https://\`.`,
			domain
				? `Write the full address: \`url: https://${url.trim()}\`.`
				: 'Write the full address as shown on the source, starting with `https://`. A site or book name without an address goes in `title`; leave `url` out if there is none.'
		);
	}
}

export const WEB_URL_RE = /^https?:\/\/[^\s/]/i;
// `example.com`, `www.example.com/recette` — a domain written without its scheme.
const BARE_DOMAIN_RE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i;
