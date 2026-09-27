// Codes-only log of every paste (plan 02, decision 6): which prompt rules the
// AI breaks in real use. One JSON line per save attempt or fix-block copy in
// <vault>/cache/paste-log.jsonl. Never titles, never content: a file is
// correlated across attempts by a short hash of its slug only. Losing the log
// is fine — it lives in cache/.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fixerOf, type Fixer } from '../vault/codes';

export type PasteOutcome = 'saved' | 'rejected' | 'collision' | 'stale' | `fixed-after-${number}-attempts`;

export interface PasteLogFile {
	codes: string[];
	outcome: PasteOutcome;
	/** Short hash of the slug, to count attempts at the same recipe. */
	k?: string;
}

export interface PasteLogEntry {
	t: string;
	/** `save`: the server's save; `fix-block`: the fix-request block was copied. */
	via: 'save' | 'fix-block';
	files: number;
	results: PasteLogFile[];
}

export const slugKey = (slug: string) => createHash('sha256').update(slug).digest('hex').slice(0, 12);

export function readPasteLog(file: string): PasteLogEntry[] {
	if (!existsSync(file)) return [];
	const out: PasteLogEntry[] = [];
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line));
		} catch {
			// a torn line from a crash: skip it
		}
	}
	return out;
}

export class PasteLog {
	/** Rejections per slug key since that key was last saved. */
	private pending: Map<string, number> | null = null;

	constructor(readonly file: string) {}

	private load(): Map<string, number> {
		if (this.pending) return this.pending;
		this.pending = new Map();
		for (const e of readPasteLog(this.file)) for (const r of e.results) this.track(r);
		return this.pending;
	}

	private track(r: PasteLogFile): void {
		if (!r.k || !this.pending) return;
		if (r.outcome === 'rejected') this.pending.set(r.k, (this.pending.get(r.k) ?? 0) + 1);
		else if (r.outcome === 'saved' || r.outcome.startsWith('fixed-after-')) this.pending.delete(r.k);
	}

	/**
	 * Append one entry. A file saved after earlier rejections of the same slug
	 * is logged as `fixed-after-N-attempts`. Never throws: the log must not break a save.
	 */
	append(via: PasteLogEntry['via'], files: { codes: string[]; outcome: 'saved' | 'rejected' | 'collision' | 'stale'; slug?: string }[]): void {
		try {
			const pending = this.load();
			const results: PasteLogFile[] = files.map((f) => {
				const k = f.slug ? slugKey(f.slug) : undefined;
				const tries = k ? (pending.get(k) ?? 0) : 0;
				const outcome: PasteOutcome = f.outcome === 'saved' && tries > 0 ? `fixed-after-${tries + 1}-attempts` : f.outcome;
				const r: PasteLogFile = { codes: [...f.codes].sort(), outcome };
				if (k) r.k = k;
				return r;
			});
			for (const r of results) this.track(r);
			const entry: PasteLogEntry = { t: new Date().toISOString(), via, files: files.length, results };
			mkdirSync(dirname(this.file), { recursive: true });
			appendFileSync(this.file, JSON.stringify(entry) + '\n');
		} catch {
			// a lost log line is acceptable
		}
	}
}

export interface CodeStat {
	code: string;
	count: number;
	/** Number of files (per attempt) in which the code fired. */
	files: number;
	fixer: Fixer;
}

export interface PasteStats {
	entries: number;
	files: number;
	outcomes: Record<string, number>;
	codes: CodeStat[];
}

/** Code frequency over the log, most frequent first, with who fixes each code. */
export function pasteStats(entries: PasteLogEntry[]): PasteStats {
	const codes = new Map<string, CodeStat>();
	const outcomes: Record<string, number> = {};
	let files = 0;
	for (const e of entries) {
		for (const r of e.results) {
			files++;
			const o = r.outcome.startsWith('fixed-after-') ? 'fixed-after-attempts' : r.outcome;
			outcomes[o] = (outcomes[o] ?? 0) + 1;
			for (const code of new Set(r.codes)) {
				const s = codes.get(code) ?? { code, count: 0, files: 0, fixer: fixerOf(code) };
				s.files++;
				codes.set(code, s);
			}
			for (const code of r.codes) codes.get(code)!.count++;
		}
	}
	return {
		entries: entries.length,
		files,
		outcomes,
		codes: [...codes.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
	};
}
