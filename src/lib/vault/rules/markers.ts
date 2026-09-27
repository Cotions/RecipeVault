// Markers in every string value and the body: W605, I701, E217.

import { findBadMarkers, findMarkers } from '../markers';
import type { Marker } from '../types';
import { strings, type RuleContext } from './context';

/** Every place text can hold a marker: frontmatter strings, then body chunks. */
function* textValues(ctx: RuleContext): Generator<{ path: string; value: string }> {
	yield* strings(ctx.fm, '');
	for (const c of ctx.bodyChunks) yield { path: c.path, value: c.text };
}

/** Every valid marker in the file, with its path. */
export function collectMarkers(ctx: RuleContext): Marker[] {
	const out: Marker[] = [];
	for (const { path, value } of textValues(ctx)) out.push(...findMarkers(value, path));
	return out;
}

export function checkMarkers(ctx: RuleContext): void {
	for (const { path, value } of textValues(ctx)) {
		const markers = findMarkers(value, path);
		const uncertain = markers.filter((m) => m.kind !== 'added');
		if (uncertain.length) {
			ctx.report(
				'W605',
				path,
				`uncertain reading marked ${uncertain.map((m) => `\`${m.text}\``).join(', ')} — check against the source.`,
				'Confirm or correct the reading, then remove the marker.'
			);
		}
		if (markers.some((m) => m.kind === 'added')) {
			ctx.report('I701', path, '`[+]` text added by the transcriber, not on the source.');
		}
		for (const bad of findBadMarkers(value)) {
			if (bad.kind === 'bracket') {
				ctx.report(
					'E217',
					path,
					`unknown marker \`${bad.text}\`.`,
					'Only `[?]`, `[?: other reading]`, `[illisible]` and `[+]` are allowed. Rewrite it as one of these, or remove the brackets if it is plain text.'
				);
			} else {
				ctx.report(
					'E217',
					path,
					`uncertainty written as prose: \`${bad.text}\`.`,
					'Remove the prose and put `[?]` right after the uncertain word or number (`[?: other]` to give another reading, `[illisible]` if unreadable).'
				);
			}
		}
	}
}
