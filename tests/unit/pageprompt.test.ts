import { describe, expect, it } from 'vitest';
import { pagePrompt } from '../../src/lib/vault/prompt';

describe('pagePrompt: a refused web page given to the AI', () => {
	it('names the page for source.url after the prompt', () => {
		const p = pagePrompt('Rules.\n', 'https://example.invalid/tarte?x=1');
		expect(p.startsWith('Rules.\n\n')).toBe(true);
		expect(p).toContain('url: https://example.invalid/tarte?x=1');
		expect(p).toContain('type: website');
	});

	it('adds nothing for an address that is not a full http(s) one', () => {
		expect(pagePrompt('Rules.\n', 'example.invalid/tarte')).toBe('Rules.\n');
		expect(pagePrompt('Rules.\n', 'javascript:alert(1)')).toBe('Rules.\n');
		expect(pagePrompt('Rules.\n', '')).toBe('Rules.\n');
	});
});
