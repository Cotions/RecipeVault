import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PasteLog, pasteStats, readPasteLog } from '../../src/lib/server/pastelog';

const dir = mkdtempSync(join(tmpdir(), 'rv-log-'));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('paste log', () => {
	it('logs codes and outcomes only, and spots a fix after rejections', () => {
		const file = join(dir, 'cache/paste-log.jsonl');
		const log = new PasteLog(file);
		log.append('fix-block', [{ codes: ['E201', 'W605'], outcome: 'rejected', slug: 'tarte-secrete' }]);
		log.append('save', [{ codes: ['E210'], outcome: 'rejected', slug: 'tarte-secrete' }]);
		// a new PasteLog (server restart) reads the history back
		new PasteLog(file).append('save', [
			{ codes: ['W605'], outcome: 'saved', slug: 'tarte-secrete' },
			{ codes: [], outcome: 'saved', slug: 'autre' }
		]);
		const raw = readFileSync(file, 'utf8');
		expect(raw).not.toContain('tarte');
		expect(raw).not.toContain('secrete');
		const entries = readPasteLog(file);
		expect(entries.map((e) => e.results.map((r) => r.outcome))).toEqual([
			['rejected'],
			['rejected'],
			['fixed-after-3-attempts', 'saved']
		]);
		const s = pasteStats(entries);
		expect(s.codes[0]).toMatchObject({ code: 'W605', count: 2, files: 2, fixer: 'app' });
		expect(s.codes.find((c) => c.code === 'E201')).toMatchObject({ fixer: 'ai' });
		expect(s.outcomes).toEqual({ rejected: 2, 'fixed-after-attempts': 1, saved: 1 });
	});
});
