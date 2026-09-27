// Private corpus run. The real recipes live outside this public repository; this
// test reads them from RECIPEVAULT_CORPUS and prints only file names, codes and
// counts — never content. It asserts nothing strict: it feeds the report.
//
//   RECIPEVAULT_CORPUS=/path/to/vault/inbox npm run test:corpus

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBatch, hasErrors } from '../src/lib/vault/check';

const dir = process.env.RECIPEVAULT_CORPUS;

describe.skipIf(!dir)('private corpus', () => {
	it('checks every file without crashing', () => {
		const names = readdirSync(dir!).filter((f) => f.endsWith('.md')).sort();
		const result = checkBatch(names.map((name) => ({ name, text: readFileSync(join(dir!, name), 'utf8') })));

		const width = Math.max(...names.map((n) => n.length));
		const lines = result.files.map((f) => {
			const codes = f.diagnostics.map((d) => d.code);
			const counted = [...new Set(codes)].map((c) => {
				const n = codes.filter((x) => x === c).length;
				return n > 1 ? `${c}×${n}` : c;
			});
			return `${hasErrors(f.diagnostics) ? '✗' : '✓'} ${f.name.padEnd(width)}  ${counted.join(' ')}`;
		});
		const summary = result.summary.map((s) => `${s.code.padEnd(5)} ${String(s.count).padStart(4)}`);
		console.log(['', ...lines, '', 'By code:', ...summary, ''].join('\n'));

		expect(result.files).toHaveLength(names.length);
	});
});
