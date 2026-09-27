// The `vault` command. Node-only code lives here; the library stays browser-safe.

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	addOutsideText,
	checkBatch,
	hasErrors,
	parseRecipe,
	renderFixBlock,
	splitPaste,
	vaultEntryFor,
	type BatchResult,
	type Diagnostic,
	type VaultEntry
} from '../lib/vault/index';

const USAGE = `Usage:
  vault check <file...>          check files; '-' reads a paste from stdin
  vault check --dir <dir>        every .md in a directory, batch rules on
  vault check --vault <dir>      also check collisions/references against a vault
        --json                   diagnostics as JSON
        --fix-block              print the fix-request block for failing files
        --quiet                  only the summary line
  vault prompt                   print the prompt from docs/AI-TEMPLATE.md

Exit codes: 0 no errors (warnings allowed), 1 any error, 2 usage or IO failure.`;

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

class UsageError extends Error {}

function main(argv: string[]): number {
	const [command, ...rest] = argv;
	try {
		if (command === 'check') return check(rest);
		if (command === 'prompt') {
			process.stdout.write(readPrompt());
			return 0;
		}
		if (command === undefined || command === '--help' || command === '-h') {
			console.log(USAGE);
			return command ? 0 : 2;
		}
		throw new UsageError(`unknown command '${command}'`);
	} catch (e) {
		if (e instanceof UsageError) {
			console.error(`vault: ${e.message}\n\n${USAGE}`);
		} else {
			console.error(`vault: ${(e as Error).message}`);
		}
		return 2;
	}
}

// --- vault prompt -----------------------------------------------------------

/** The fenced block under `## The prompt` in docs/AI-TEMPLATE.md, read at runtime. */
export function readPrompt(): string {
	const doc = readFileSync(join(REPO, 'docs/AI-TEMPLATE.md'), 'utf8').replace(/\r\n?/g, '\n');
	const lines = doc.split('\n');
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

// --- vault check ------------------------------------------------------------

interface CheckOptions {
	files: string[];
	dir?: string;
	vault?: string;
	json: boolean;
	fixBlock: boolean;
	quiet: boolean;
}

function parseArgs(args: string[]): CheckOptions {
	const o: CheckOptions = { files: [], json: false, fixBlock: false, quiet: false };
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const value = () => {
			const v = args[++i];
			if (v === undefined) throw new UsageError(`${a} needs a directory`);
			return v;
		};
		if (a === '--dir') o.dir = value();
		else if (a === '--vault') o.vault = value();
		else if (a === '--json') o.json = true;
		else if (a === '--fix-block') o.fixBlock = true;
		else if (a === '--quiet') o.quiet = true;
		else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
		else o.files.push(a);
	}
	if (!o.files.length && !o.dir) throw new UsageError('nothing to check: give files, - for stdin, or --dir');
	return o;
}

function mdFiles(dir: string): string[] {
	return readdirSync(dir)
		.filter((f) => f.endsWith('.md') && statSync(join(dir, f)).isFile())
		.sort()
		.map((f) => join(dir, f));
}

/** Index the recipes already in a vault, skipping any file that is also being checked. */
function readVault(vaultDir: string, checking: Set<string>): VaultEntry[] {
	const recipesDir = join(vaultDir, 'recipes');
	let files: string[];
	try {
		files = mdFiles(recipesDir);
	} catch {
		throw new Error(`cannot read ${recipesDir}`);
	}
	const entries: VaultEntry[] = [];
	for (const f of files) {
		if (checking.has(realpathSync(f))) continue;
		const { frontmatter } = parseRecipe(readFileSync(f, 'utf8'));
		const entry = frontmatter && vaultEntryFor(frontmatter);
		if (entry) entries.push(entry);
	}
	return entries;
}

function check(args: string[]): number {
	const o = parseArgs(args);
	const paths = [...(o.dir ? mdFiles(o.dir) : []), ...o.files.filter((f) => f !== '-')];
	const inputs = paths.map((p) => ({ name: o.dir && !o.files.includes(p) ? basename(p) : p, text: readFileSync(p, 'utf8') }));
	let outside = '';
	if (o.files.includes('-')) {
		const paste = readFileSync(0, 'utf8');
		const split = splitPaste(paste);
		outside = split.files.length ? split.outside : '';
		const pasted = split.files.length ? split.files : [paste];
		pasted.forEach((text, i) => inputs.push({ name: pasted.length > 1 ? `stdin #${i + 1}` : 'stdin', text }));
	}
	const vault = o.vault ? readVault(o.vault, new Set(paths.map((p) => realpathSync(p)))) : undefined;
	const result = checkBatch(inputs, { vault });
	if (outside) addOutsideText(result, outside);
	const failed = result.files.some((f) => hasErrors(f.diagnostics));

	if (o.json) {
		const out = {
			files: result.files.map((f) => ({ name: f.name, ok: !hasErrors(f.diagnostics), diagnostics: f.diagnostics })),
			pasteDiagnostics: result.pasteDiagnostics,
			summary: result.summary
		};
		console.log(JSON.stringify(out, null, 2));
	} else if (o.fixBlock) {
		printFixBlock(result, inputs);
	} else {
		printHuman(result, o);
	}
	return failed ? 1 : 0;
}

function printFixBlock(result: BatchResult, inputs: { name: string; text: string }[]): void {
	const failed = result.files
		.map((f, i) => ({ text: inputs[i].text, diagnostics: f.diagnostics }))
		.filter((f) => hasErrors(f.diagnostics));
	if (!failed.length) {
		console.error('vault: no failing files, no fix-request block.');
		return;
	}
	const passed = result.files.filter((f) => !hasErrors(f.diagnostics)).map((f) => f.recipe?.title ?? f.name);
	let spec: string | undefined;
	try {
		spec = readPrompt();
	} catch {
		spec = undefined;
	}
	process.stdout.write(renderFixBlock(failed, passed, { spec }));
}

// --- human output -----------------------------------------------------------

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const dim = paint('2');
const bold = paint('1');

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function counts(diagnostics: Diagnostic[]): string {
	const e = diagnostics.filter((d) => d.severity === 'error').length;
	const w = diagnostics.filter((d) => d.severity === 'warning').length;
	const i = diagnostics.filter((d) => d.severity === 'info').length;
	return [e && plural(e, 'error'), w && plural(w, 'warning'), i && `${i} info`].filter(Boolean).join(', ');
}

function printDiagnostic(d: Diagnostic): void {
	const tint = d.severity === 'error' ? red : d.severity === 'warning' ? yellow : dim;
	const [first, ...more] = `${d.path ? `${d.path}: ` : ''}${d.message}`.split('\n');
	console.log(`  ${tint(d.code)} ${first}`);
	for (const line of more) console.log(`       ${line}`);
	if (d.fix) console.log(dim(`       ${d.fix}`));
}

function printHuman(result: BatchResult, o: CheckOptions): void {
	const all = result.files.flatMap((f) => f.diagnostics);
	if (!o.quiet) {
		for (const f of result.files) {
			const bad = hasErrors(f.diagnostics);
			const c = counts(f.diagnostics);
			console.log(`${bad ? red('✗') : green('✓')} ${bold(f.name)}${c ? `  ${c}` : ''}`);
			f.diagnostics.forEach(printDiagnostic);
		}
		if (result.pasteDiagnostics.length) {
			console.log(bold('paste'));
			result.pasteDiagnostics.forEach(printDiagnostic);
		}
		if (o.dir && result.summary.length) {
			console.log('');
			console.log(bold('By code, most frequent first:'));
			for (const s of result.summary) {
				const tint = s.severity === 'error' ? red : s.severity === 'warning' ? yellow : dim;
				const files = new Set(all.filter((d) => d.code === s.code).map((d) => d.file)).size;
				console.log(`  ${tint(s.code.padEnd(5))} ${String(s.count).padStart(4)}  in ${plural(files, 'file')}`);
			}
		}
		console.log('');
	}
	const failedFiles = result.files.filter((f) => hasErrors(f.diagnostics)).length;
	console.log(
		`${plural(result.files.length, 'file')}: ${failedFiles} failed, ${result.files.length - failedFiles} passed` +
			(all.length ? ` — ${counts(all)}` : '')
	);
}

process.exitCode = main(process.argv.slice(2));
