// Timing and quantity: E108, E109, E111, W601, W602, plus `yield`.

import { parseDuration, suggestDuration } from '../duration';
import { markedNumber } from '../quantity';
import { ALLOWED_KEYS } from '../vocab';
import { checkKeys, isBlank, isMap, join, show, type RuleContext } from './context';
import { checkAmount } from './ingredients';

const DURATION_FORMAT = 'Durations are written `30m`, `1h`, `1h15m`; ranges `45m-50m`.';

export function checkTimes(ctx: RuleContext): void {
	const times = ctx.fm.times;
	if (isBlank(times) || (isMap(times) && Object.keys(times).length === 0)) {
		ctx.report('W602', 'times', 'no `times`.', 'Add `times:` with the `prep`, `cook` or `rest` times the source states — only those.');
		return;
	}
	if (!isMap(times)) {
		ctx.report('E109', 'times', `\`times: ${show(times)}\` is not a \`{ prep, cook, rest }\` entry.`, `Write \`times: { prep: 20m, cook: 1h }\`. ${DURATION_FORMAT}`);
		return;
	}
	checkKeys(ctx, times, 'times', ALLOWED_KEYS.times);
	for (const key of ALLOWED_KEYS.times) {
		const v = times[key];
		if (v === undefined || v === null) continue;
		if (parseDuration(v)) continue;
		const guess = suggestDuration(v);
		const context =
			typeof v === 'string' && /\s(de|d'|pour|au|dans|of|for|in)\b/i.test(v)
				? ' What the time is for goes in the steps.'
				: '';
		ctx.report(
			'E109',
			join('times', key),
			`\`${key}: ${show(v)}\` is not in the duration format.`,
			(guess ? `Write \`${key}: ${guess}\`.` : DURATION_FORMAT) + context
		);
	}
}

export function checkServings(ctx: RuleContext): void {
	const { fm } = ctx;
	const s = fm.servings;
	const max = fm.servings_max;
	// A marker is allowed, as on `qty`: `servings: "4 [?]"`.
	const posInt = (v: unknown): boolean => {
		const n = markedNumber(v);
		return n !== undefined && Number.isInteger(n) && n > 0;
	};

	if (isBlank(s)) {
		if (!isBlank(max)) ctx.report('E108', 'servings_max', '`servings_max` is set without `servings`.', 'A range is `servings` (the low end) plus `servings_max`.');
		else if (isBlank(fm.yield)) ctx.report('W601', 'servings', 'no `servings` (and no `yield`).', 'Add `servings:` if the source says how many it serves, or `yield:` for things not counted in portions.');
	} else if (!posInt(s)) {
		const range = typeof s === 'string' ? s.match(/^\s*(\d+)\s*(?:-|–|à|to|ou|or)\s*(\d+)\s*$/) : null;
		const one = typeof s === 'string' ? s.match(/^\s*(\d+)\b/) : null;
		const fix = range
			? `Write \`servings: ${range[1]}\` and \`servings_max: ${range[2]}\`.`
			: one
				? `Write \`servings: ${one[1]}\`; any remark goes in \`servings_note\`.`
				: 'Write a whole number; a range is `servings` plus `servings_max`; things not counted in portions go in `yield`.';
		ctx.report('E108', 'servings', `\`servings: ${show(s)}\` is not a positive whole number.`, fix);
	}
	if (!isBlank(s) && !isBlank(max)) {
		if (!posInt(max)) ctx.report('E108', 'servings_max', `\`servings_max: ${show(max)}\` is not a positive whole number.`, 'Write a whole number greater than `servings`.');
		else if (posInt(s) && markedNumber(max)! <= markedNumber(s)!)
			ctx.report('E108', 'servings_max', `\`servings_max: ${show(max)}\` is not greater than \`servings: ${show(s)}\`.`, 'Write the high end of the range in `servings_max`, or remove it.');
	}

	const y = fm.yield;
	if (isMap(y)) {
		checkKeys(ctx, y, 'yield', ALLOWED_KEYS.yield);
		checkAmount(ctx, y, 'yield');
	}
}

export function checkOven(ctx: RuleContext): void {
	const oven = ctx.fm.oven;
	if (isBlank(oven)) return;
	const fix = 'Write `oven: { temp: 350, unit: F }`; a range adds `temp_max`.';
	if (!isMap(oven)) {
		const m = String(oven).match(/^\s*(\d{2,3})\s*°?\s*([FC])?\s*$/i);
		ctx.report(
			'E111',
			'oven',
			`\`oven: ${show(oven)}\` is not a \`{ temp, unit }\` entry.`,
			m ? `Write \`oven: { temp: ${m[1]}, unit: ${(m[2] ?? 'F').toUpperCase()} }\`.` : fix
		);
		return;
	}
	checkKeys(ctx, oven, 'oven', ALLOWED_KEYS.oven);
	// A marker is allowed, as on `qty`: `temp: "350 [?]"`.
	const temp = markedNumber(oven.temp);
	if (temp === undefined) {
		const digits = String(oven.temp ?? '').match(/\d{2,3}/);
		ctx.report(
			'E111',
			'oven.temp',
			isBlank(oven.temp) ? '`oven.temp` is missing.' : `\`oven.temp: ${show(oven.temp)}\` is not a number.`,
			digits ? `Write \`temp: ${digits[0]}\`, with the unit in \`unit\`.` : fix
		);
	}
	if (oven.unit !== 'F' && oven.unit !== 'C') {
		const u = typeof oven.unit === 'string' ? oven.unit.replace(/[°\s]/g, '').toUpperCase() : '';
		ctx.report(
			'E111',
			'oven.unit',
			isBlank(oven.unit) ? '`oven.unit` is missing.' : `\`oven.unit: ${show(oven.unit)}\` is not \`F\` or \`C\`.`,
			u === 'F' || u === 'C' ? `Write \`unit: ${u}\`.` : 'Write `unit: F` or `unit: C`; a temperature with no unit on a Quebec card is °F.'
		);
	}
	if (!isBlank(oven.temp_max)) {
		const tempMax = markedNumber(oven.temp_max);
		if (tempMax === undefined)
			ctx.report('E111', 'oven.temp_max', `\`oven.temp_max: ${show(oven.temp_max)}\` is not a number.`, 'Write the high end of the range as a number.');
		else if (temp !== undefined && tempMax <= temp)
			ctx.report('E111', 'oven.temp_max', `\`oven.temp_max: ${show(oven.temp_max)}\` is not greater than \`temp: ${show(oven.temp)}\`.`, 'Write the high end of the range in `temp_max`, or remove it.');
	}
}
