import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitPaste } from '../../src/lib/vault/fences';

const FILE = '---\nschema: 3\ntitle: X\n---\n\n## Préparation\n\n1. Y\n';

describe('splitPaste', () => {
	it('returns nothing for text without fences or frontmatter', () => {
		expect(splitPaste('Désolé, je ne peux pas lire cette image.')).toEqual({
			files: [],
			outside: 'Désolé, je ne peux pas lire cette image.'
		});
	});

	it('extracts one fence', () => {
		expect(splitPaste('```markdown\n' + FILE + '```\n')).toEqual({ files: [FILE], outside: '' });
	});

	it('reads the first word of the info string as the language', () => {
		expect(splitPaste('```markdown title="un.md"\n' + FILE + '```\n\nQUESTIONS\n1. ?')).toEqual({ files: [FILE], outside: 'QUESTIONS\n1. ?' });
		const r = splitPaste(`\`\`\`markdown\n${FILE}\`\`\`\n\n\`\`\`markdown title="deux.md"\n${FILE}\`\`\`\n\n\`\`\`markdown\n${FILE}\`\`\`\n`);
		expect(r.files).toHaveLength(3);
		expect(r.outside).toBe('');
	});

	it('extracts several fences and keeps text before, between and after', () => {
		const r = splitPaste(`Voici :\n\n\`\`\`markdown\n${FILE}\`\`\`\n\nEt :\n\n\`\`\`md\n${FILE}\`\`\`\n\nQUESTIONS\n1. ?`);
		expect(r.files).toEqual([FILE, FILE]);
		expect(r.outside).toBe('Voici :\n\nEt :\n\nQUESTIONS\n1. ?');
	});

	it('takes a bare fence that holds a recipe file, not other fences', () => {
		const r = splitPaste('```\n' + FILE + '```\n\n```text\nnote\n```\n');
		expect(r.files).toEqual([FILE]);
		expect(r.outside).toBe('```text\nnote\n```');
	});

	it('handles longer fences and tildes', () => {
		expect(splitPaste('````markdown\n' + FILE + '````\n').files).toEqual([FILE]);
		expect(splitPaste('~~~markdown\n' + FILE + '~~~\n').files).toEqual([FILE]);
	});

	it('takes an unclosed fence to the end of the text', () => {
		expect(splitPaste('```markdown\n' + FILE).files).toEqual([FILE]);
	});

	it('starts a new file at a ```markdown opener even if the previous fence is not closed', () => {
		const r = splitPaste(`\`\`\`markdown\n${FILE}\n\`\`\`markdown\n${FILE}\`\`\`\n\nQUESTIONS\n1. ?`);
		expect(r.files).toEqual([FILE, FILE]);
		expect(r.outside).toBe('QUESTIONS\n1. ?');
		expect(splitPaste(`\`\`\`md\n${FILE}\`\`\`md\n${FILE}\`\`\`md\n${FILE}`).files).toEqual([FILE, FILE, FILE]);
		expect(splitPaste(`\`\`\`\n${FILE}\`\`\`markdown\n${FILE}\`\`\`\n`).files).toEqual([FILE, FILE]);
	});

	it('leaves a ```markdown line inside another kind of fence alone', () => {
		const r = splitPaste('```text\nexemple :\n```markdown\n```\n\n```markdown\n' + FILE + '```\n');
		expect(r.files).toEqual([FILE]);
		expect(r.outside).toBe('```text\nexemple :\n```markdown\n```');
	});

	it('treats a paste without fences that starts with --- as one file', () => {
		expect(splitPaste('\n\n' + FILE)).toEqual({ files: [FILE], outside: '' });
	});

	it('normalizes CRLF and NFC', () => {
		const r = splitPaste('```markdown\r\n---\r\ntitle: Cre\u0301me\r\n---\r\n```\r\n');
		expect(r.files).toEqual(['---\ntitle: Cr\u00e9me\n---\n']);
	});

	it('splits the multi-recipe paste fixture', () => {
		const r = splitPaste(readFileSync('tests/fixtures/check/paste/two-recipes-one-failing.txt', 'utf8'));
		expect(r.files).toHaveLength(2);
		expect(r.outside).toContain('QUESTIONS');
		expect(r.outside).not.toContain('schema');
	});
});
