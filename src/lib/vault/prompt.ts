// The AI prompt: the fenced block under `## The prompt` in docs/AI-TEMPLATE.md
// (and the translation request under `## The translation request`).
// Shared by `vault prompt` (reads the doc at runtime) and the paste box (the
// doc is embedded at build time).

/** Extract the prompt from the text of docs/AI-TEMPLATE.md. */
export function extractPrompt(doc: string): string {
	return extractSection(doc, 'The prompt');
}

/** The request that asks the AI to translate an imported English page: the fenced block under `## The translation request`. */
export function extractTranslation(doc: string): string {
	return extractSection(doc, 'The translation request').trimEnd();
}

/** The first fenced block under `## <heading>` in docs/AI-TEMPLATE.md. */
function extractSection(doc: string, heading: string): string {
	const lines = doc.replace(/\r\n?/g, '\n').split('\n');
	const start = lines.findIndex((l) => l.trim().replace(/^##\s+/, '') === heading && /^##\s/.test(l));
	if (start === -1) throw new Error(`docs/AI-TEMPLATE.md has no "## ${heading}" section`);
	for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
		const open = lines[i].match(/^(`{3,}|~{3,})/);
		if (!open) continue;
		const fence = open[1];
		const end = lines.findIndex((l, j) => j > i && l.trimEnd() === fence);
		if (end === -1) break;
		return lines.slice(i + 1, end).join('\n') + '\n';
	}
	throw new Error(`no fenced block under "## ${heading}" in docs/AI-TEMPLATE.md`);
}

/**
 * The prompt for a web page the app could not read, given to the AI as a
 * capture or its text: one line after it names the page, for `source`
 * (rule 23). Only a full http(s) address is added (anything else: the prompt
 * as it is).
 */
export function pagePrompt(prompt: string, url: string): string {
	const u = url.trim();
	if (!/^https?:\/\/\S+$/i.test(u)) return prompt;
	return `${prompt.trimEnd()}\n\nThis recipe is on the web page ${u} (a capture or its text is attached). In source, write type: website and url: ${u}\n`;
}
