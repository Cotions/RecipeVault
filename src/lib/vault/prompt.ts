// The AI prompt: the fenced block under `## The prompt` in docs/AI-TEMPLATE.md.
// Shared by `vault prompt` (reads the doc at runtime) and the paste box (the
// doc is embedded at build time).

/** Extract the prompt from the text of docs/AI-TEMPLATE.md. */
export function extractPrompt(doc: string): string {
	const lines = doc.replace(/\r\n?/g, '\n').split('\n');
	const start = lines.findIndex((l) => /^##\s+The prompt\s*$/.test(l));
	if (start === -1) throw new Error('docs/AI-TEMPLATE.md has no "## The prompt" section');
	for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
		const open = lines[i].match(/^(`{3,}|~{3,})/);
		if (!open) continue;
		const fence = open[1];
		const end = lines.findIndex((l, j) => j > i && l.trimEnd() === fence);
		if (end === -1) break;
		return lines.slice(i + 1, end).join('\n') + '\n';
	}
	throw new Error('no fenced block under "## The prompt" in docs/AI-TEMPLATE.md');
}
