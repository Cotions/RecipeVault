// The `vault` command. Node-only code lives here; the library stays browser-safe.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	addOutsideText,
	aiErrors,
	fixerOf,
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
import { extractPrompt } from '../lib/vault/prompt';
import { findConfig, loadConfig, type GitAuthor } from '../lib/server/config';
import { openVault } from '../lib/server/context';
import { syncVault } from '../lib/server/index/sync';
import { PasteLog, pasteStats, readPasteLog } from '../lib/server/pastelog';
import { save } from '../lib/server/save';
import { initVault, vaultPaths } from '../lib/server/vault';

const USAGE = `Usage:
  vault check <file...>          check files; '-' reads a paste from stdin
  vault check --dir <dir>        every .md in a directory, batch rules on
  vault check --vault <dir>      also check collisions/references against a vault
        --json                   diagnostics as JSON
        --fix-block              print the fix-request block for failing files
        --quiet                  only the summary line
  vault prompt                   print the prompt from docs/AI-TEMPLATE.md
  vault init <dir>               create a new vault (layout, vocab seed, git)
  vault add <file...>            save files through the app's save path
  vault sync [--force]           bring the index in line with the files
  vault reindex                  delete the index and rebuild it
  vault stats                    code frequency over the paste log
        --vault <dir>            (add, sync, reindex, stats) instead of the config's vault

Exit codes: 0 no errors (warnings allowed), 1 any error, 2 usage or IO failure.`;

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;
	try {
		if (command === 'check') return check(rest);
		if (command === 'init') return await init(rest);
		if (command === 'add') return await add(rest);
		if (command === 'sync') return sync(rest, false);
		if (command === 'reindex') return sync(rest, true);
		if (command === 'stats') return stats(rest);
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
	return extractPrompt(readFileSync(join(REPO, 'docs/AI-TEMPLATE.md'), 'utf8'));
}

// --- vault init / add / sync / reindex / stats ------------------------------

/** The git author: the config's `git_author` if a config exists, else git's own user. */
function readAuthor(): GitAuthor {
	try {
		const f = findConfig();
		const a = f ? JSON.parse(readFileSync(f, 'utf8')).git_author : undefined;
		if (a?.name && a?.email) return { name: a.name, email: a.email };
	} catch {
		// fall through
	}
	const cfg = (k: string) => {
		try {
			return execFileSync('git', ['config', k], { encoding: 'utf8' }).trim();
		} catch {
			return '';
		}
	};
	return { name: cfg('user.name') || 'RecipeVault', email: cfg('user.email') || 'recipevault@localhost' };
}

/** Split `--vault <dir>` and flags off the arguments. */
function vaultArgs(args: string[], flags: string[] = []): { dir?: string; rest: string[]; set: Set<string> } {
	const rest: string[] = [];
	const set = new Set<string>();
	let dir: string | undefined;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--vault') {
			dir = args[++i];
			if (!dir) throw new UsageError('--vault needs a directory');
		} else if (flags.includes(args[i])) set.add(args[i]);
		else if (args[i].startsWith('--')) throw new UsageError(`unknown option ${args[i]}`);
		else rest.push(args[i]);
	}
	return { dir, rest, set };
}

function openFromArgs(dir: string | undefined) {
	if (dir) {
		const root = resolve(dir);
		if (!existsSync(join(root, 'recipes'))) throw new Error(`${root} is not a vault (no recipes/ folder)`);
		return openVault({ root, author: readAuthor(), push: false });
	}
	const config = loadConfig();
	return openVault({ root: config.vaultDirectory, author: config.gitAuthor, push: config.gitPush });
}

async function init(args: string[]): Promise<number> {
	if (args.length !== 1) throw new UsageError('vault init needs exactly one directory');
	const dir = resolve(args[0]);
	await initVault(dir, readFileSync(join(REPO, 'docs/VOCAB.md'), 'utf8'), readAuthor());
	console.log(`vault created at ${dir}`);
	return 0;
}

async function add(args: string[]): Promise<number> {
	const { dir, rest } = vaultArgs(args);
	if (!rest.length) throw new UsageError('vault add needs files');
	const ctx = openFromArgs(dir);
	syncVault(ctx.db, ctx.paths);
	const inputs: { name: string; text: string }[] = [];
	for (const f of rest) {
		const text = f === '-' ? readFileSync(0, 'utf8') : readFileSync(f, 'utf8');
		const split = splitPaste(text);
		const files = split.files.length ? split.files : [text];
		files.forEach((t, i) => inputs.push({ name: files.length > 1 ? `${f} #${i + 1}` : f, text: t }));
	}
	const result = await save(ctx, inputs.map((i) => ({ text: i.text })));
	const log = new PasteLog(ctx.paths.pasteLog);
	log.append('save', result.files.map((r, i) => ({
		codes: r.diagnostics.map((d) => d.code),
		outcome: r.status,
		slug: r.status === 'rejected' ? undefined : r.slug
	})));
	let failed = 0;
	result.files.forEach((r, i) => {
		const name = inputs[i].name;
		if (r.status === 'saved') console.log(`${green('✓')} ${name} → recipes/${r.slug}.md (${r.recipeStatus})`);
		else {
			failed++;
			const codes = [...new Set(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code))].join(', ');
			const why = r.status === 'collision' ? `slug ${r.slug} taken${r.inTrash ? ' (in the trash)' : ''}; free: ${r.suggested}` : r.status === 'stale' ? 'changed on disk' : codes;
			console.log(`${red('✗')} ${name}  ${r.status}: ${why}`);
		}
	});
	if (result.indexError) console.error(`vault: index update failed (run vault sync): ${result.indexError}`);
	await ctx.pusher.idle();
	ctx.db.close();
	console.log(`${plural(result.files.length, 'file')}: ${result.files.length - failed} saved, ${failed} not saved`);
	return failed ? 1 : 0;
}

function sync(args: string[], rebuild: boolean): number {
	const { dir, set } = vaultArgs(args, ['--force']);
	let ctx = openFromArgs(dir);
	if (rebuild) {
		ctx.db.close();
		for (const suffix of ['', '-wal', '-shm']) rmSync(ctx.paths.index + suffix, { force: true });
		ctx = openFromArgs(dir);
	}
	const r = syncVault(ctx.db, ctx.paths, { force: set.has('--force') || rebuild });
	ctx.db.close();
	console.log(`${r.scanned} files: ${r.indexed} indexed, ${r.unchanged} unchanged, ${r.removed} removed, ${r.problems.length} with errors (${r.ms} ms)`);
	for (const p of r.problems) console.log(`  ${red('✗')} ${p.file}  ${p.codes.join(', ')}`);
	return r.problems.length ? 1 : 0;
}

function stats(args: string[]): number {
	const { dir } = vaultArgs(args);
	const root = dir ? resolve(dir) : loadConfig().vaultDirectory;
	const s = pasteStats(readPasteLog(vaultPaths(root).pasteLog));
	console.log(`${plural(s.entries, 'paste')}, ${plural(s.files, 'file')}: ${Object.entries(s.outcomes).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing logged yet'}`);
	if (s.codes.length) {
		console.log('');
		console.log(bold('By code, most frequent first:'));
		for (const c of s.codes) {
			const tint = c.code.startsWith('E') ? red : c.code.startsWith('W') ? yellow : dim;
			console.log(`  ${tint(c.code.padEnd(5))} ${String(c.count).padStart(4)}  in ${plural(c.files, 'file').padEnd(9)}  ${dim(c.fixer)}`);
		}
	}
	return 0;
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

/** The title of a file that failed only on app-resolved errors, for the "already saved" line. */
function titleOf(text: string): string | undefined {
	const t = parseRecipe(text).frontmatter?.title;
	return typeof t === 'string' ? t : undefined;
}

function printFixBlock(result: BatchResult, inputs: { name: string; text: string }[]): void {
	// Files whose only errors are `app` codes need nothing from the AI:
	// they count as passed so the AI does not resend them.
	const forAi = (i: number) => aiErrors(result.files[i].diagnostics).length > 0;
	const failed = result.files
		.map((f, i) => ({ text: inputs[i].text, diagnostics: f.diagnostics }))
		.filter((_, i) => forAi(i));
	if (!failed.length) {
		console.error('vault: nothing for the AI to fix, no fix-request block.');
		return;
	}
	const passed = result.files
		.filter((_, i) => !forAi(i))
		.map((f) => f.recipe?.title ?? titleOf(inputs[result.files.indexOf(f)].text) ?? f.name);
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
				console.log(`  ${tint(s.code.padEnd(5))} ${String(s.count).padStart(4)}  in ${plural(files, 'file').padEnd(9)}  ${dim(fixerOf(s.code) === 'app' ? 'app' : 'ai')}`);
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

process.exitCode = await main(process.argv.slice(2));
