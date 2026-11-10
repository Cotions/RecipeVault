// app.html's first-paint script (the cook chip's place in the header) against
// lib/kitchensession.ts: the same sessions make the same call. Invented sessions.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chipShown, cookUp, readCooks, RUNG_MS, SESSION_MS } from '../../src/lib/kitchensession';

const html = readFileSync(new URL('../../src/app.html', import.meta.url), 'utf8');
const script = /<script nonce="%sveltekit.nonce%">([\s\S]*?)<\/script>/.exec(html)![1];

const NOW = 1_700_000_000_000;

function storage(entries: Record<string, string>) {
	const keys = Object.keys(entries);
	return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => entries[k] ?? null };
}

/** What the script sets, and what the chip would show, for these entries on this page. */
function both(entries: Record<string, string>, path = '/') {
	const ls = storage(entries);
	const doc = { documentElement: { dataset: {} as Record<string, string> } };
	const realNow = Date.now;
	Date.now = () => NOW;
	const g = globalThis as Record<string, unknown>;
	g.localStorage = ls;
	try {
		new Function('localStorage', 'location', 'document', script)(ls, { pathname: path }, doc);
		const cooks = readCooks(NOW);
		const up = cookUp(cooks, NOW);
		const shown = chipShown(up, path, ls.getItem('rv-cookchip-hidden'));
		return { script: doc.documentElement.dataset.cook ?? null, chip: shown ? (cooks.length > 1 ? 'n' : '1') : null };
	} finally {
		Date.now = realNow;
		delete g.localStorage;
	}
}

const s = (over: Record<string, unknown> = {}) => JSON.stringify({ v: 'x', at: NOW - 60_000, step: 2, last: 0, ticks: [], factor: 1, timers: [], n: 5, title: 'Inventée', ...over });
const tm = (over: Record<string, unknown> = {}) => ({ id: 't', step: 1, end: NOW + 60_000, total: 600, ...over });

describe('app.html first-paint cook flag', () => {
	const cases: [string, Record<string, string>, string?][] = [
		['nothing', {}],
		['a step to resume', { 'rv-kitchen:a': s() }],
		['a step to resume on its own page', { 'rv-kitchen:a': s() }, '/r/a'],
		['a step put away', { 'rv-kitchen:a': s(), 'rv-cookchip-hidden': `a@${NOW - 60_000}` }],
		['a timer on its own page', { 'rv-kitchen:a': s({ timers: [tm()] }) }, '/r/a'],
		['two cooks', { 'rv-kitchen:a': s({ timers: [tm()] }), 'rv-kitchen:b': s({ at: NOW - 1000 }) }],
		['an old session', { 'rv-kitchen:a': s({ at: NOW - SESSION_MS }) }],
		['finished, nothing on', { 'rv-kitchen:a': s({ step: 5 }) }],
		['the checklist, nothing done', { 'rv-kitchen:a': s({ step: -1 }) }],
		['the checklist, ticked', { 'rv-kitchen:a': s({ step: -1, ticks: ['0:0'] }) }],
		['rung and seen', { 'rv-kitchen:a': s({ step: 5, timers: [tm({ end: NOW - 1000, done: true, seen: true })] }) }],
		['rung long ago', { 'rv-kitchen:a': s({ step: 5, timers: [tm({ end: NOW - RUNG_MS })] }) }],
		['rung, not seen', { 'rv-kitchen:a': s({ step: 5, timers: [tm({ end: NOW - 1000 })] }) }],
		['paused', { 'rv-kitchen:a': s({ step: 5, timers: [tm({ end: NOW - 1000, left: 5000 })] }) }],
		['broken', { 'rv-kitchen:a': '{' }],
		['broken beside one on', { 'rv-kitchen:a': '{', 'rv-kitchen:b': s({ timers: [tm()] }) }]
	];
	for (const [name, entries, path] of cases)
		it(name, () => {
			const r = both(entries, path);
			expect(r.script).toBe(r.chip);
		});
});
