// Provenance: E106, W604.

import { ALLOWED_KEYS, SOURCE_TYPES } from '../vocab';
import { checkKeys, isBlank, isMap, show, type RuleContext } from './context';

const TYPES = SOURCE_TYPES.join(' | ');

export function checkSource(ctx: RuleContext): void {
	const source = ctx.fm.source;
	if (isBlank(source)) {
		ctx.report('W604', 'source', '`source` is absent — the recipe’s provenance is lost.', `Add \`source:\` with \`type:\` (${SOURCE_TYPES.join(', ')}) and the author, title, page or url the source gives.`);
		return;
	}
	if (!isMap(source)) {
		ctx.report('E106', 'source', `\`source: ${show(source)}\` is not a \`{ type, author, … }\` entry.`, `Write \`source:\` with \`type: ${TYPES}\` and, as available, \`author\`, \`title\`, \`page\`, \`url\`, \`note\`.`);
		return;
	}
	checkKeys(ctx, source, 'source', ALLOWED_KEYS.source);
	if (!(SOURCE_TYPES as readonly unknown[]).includes(source.type)) {
		ctx.report(
			'E106',
			'source.type',
			isBlank(source.type) ? '`source.type` is missing.' : `\`source.type: ${show(source.type)}\` is not an allowed source type.`,
			`Use one of: ${TYPES}.`
		);
	}
}
