// Two versions of a line, word by word (usability round 4): the history shows
// what changed in an ingredient or a step, « 1 ½ lb → 2 lb » as the old words
// struck and the new ones underlined, the rest as it reads. Browser-safe.

export interface DiffPart {
	/** `same` in both, `del` only in the old text, `ins` only in the new. */
	op: 'same' | 'del' | 'ins';
	text: string;
}

/** Past this many words on a side, the two texts show whole, old struck then new. */
const MAX_WORDS = 400;

/** Words and the spaces after them, so the parts join back to the text. */
const tokens = (s: string) => s.match(/\S+\s*/g) ?? [];

/** Consecutive parts of the same kind as one. */
function merge(parts: DiffPart[]): DiffPart[] {
	const out: DiffPart[] = [];
	for (const p of parts) {
		const last = out.at(-1);
		if (last && last.op === p.op) last.text += p.text;
		else out.push({ ...p });
	}
	return out;
}

/**
 * The parts of `after` read against `before`: a longest common run of words
 * kept, the rest marked. A word compares without the spaces after it. When
 * the two share less than a third of their words, the old text struck then
 * the new one whole reads better than a scatter of marks.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
	if (before === after) return before ? [{ op: 'same', text: before }] : [];
	const a = tokens(before);
	const b = tokens(after);
	const whole = (): DiffPart[] => merge([...(before ? [{ op: 'del' as const, text: before.trimEnd() + ' ' }] : []), ...(after ? [{ op: 'ins' as const, text: after }] : [])]);
	if (!a.length || !b.length || a.length > MAX_WORDS || b.length > MAX_WORDS) return whole();
	const key = (w: string) => w.trimEnd();
	// lcs[i][j]: the common run of a[i..] and b[j..].
	const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = key(a[i]) === key(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
	if (lcs[0][0] * 3 < Math.max(a.length, b.length)) return whole();
	const parts: DiffPart[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (key(a[i]) === key(b[j])) {
			parts.push({ op: 'same', text: b[j] });
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) parts.push({ op: 'del', text: a[i++] });
		else parts.push({ op: 'ins', text: b[j++] });
	}
	while (i < a.length) parts.push({ op: 'del', text: a[i++] });
	while (j < b.length) parts.push({ op: 'ins', text: b[j++] });
	return merge(parts);
}
