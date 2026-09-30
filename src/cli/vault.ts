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
	type CheckOptions as RecipeCheckOptions,
	type Diagnostic,
	type VaultEntry
} from '../lib/vault/index';
import { extractPrompt } from '../lib/vault/prompt';
import { DEFAULT_CURRENCY, findConfig, loadConfig, type GitAuthor } from '../lib/server/config';
import { openVault } from '../lib/server/context';
import { catchUpCommits } from '../lib/server/index/commits';
import { syncVault } from '../lib/server/index/sync';
import { PasteLog, pasteStats, readPasteLog } from '../lib/server/pastelog';
import { save } from '../lib/server/save';
import { initVault, vaultPaths } from '../lib/server/vault';
import { seedVault } from '../lib/server/seed';
import { checkRegistry, parseIngredient } from '../lib/ingredients/registry';
import { loadCheckWords, loadVocab, seedCheckWords } from '../lib/server/vocab';
import { resolveQueue } from '../lib/server/queue';
import { DISTINCT_FILE, readDistinct } from '../lib/server/duplicates';
import { priceProblems } from '../lib/server/prices';
import { parsePrices, PRICES_FILE, type PriceProblem } from '../lib/ingredients/prices';
import { SessionStore } from '../lib/server/sessions';
import { addUser, assertOutsideVault, checkPassword, loadUsers, normalizeLogin, removeUser, setPassword, usersPath } from '../lib/server/users';

const USAGE = `Usage:
  vault check <file...>          check files; '-' reads a paste from stdin
  vault check --dir <dir>        every .md in a directory, batch rules on; a vault
                                 directory: recipes/ and ingredients/
  vault check --vault <dir>      also check collisions/references against a vault
        --json                   diagnostics as JSON
        --fix-block              print the fix-request block for failing files
        --quiet                  only the summary line
  vault prompt                   print the prompt from docs/AI-TEMPLATE.md
  vault init <dir>               create a new vault (layout, vocab and ingredient seed, git)
  vault ingredients seed         add the seed ingredients missing from the vault
  vault add <file...>            save files through the app's save path
  vault sync [--force]           bring the index in line with the files (and the git history)
  vault reindex                  delete the index and rebuild it
  vault stats                    code frequency over the paste log
  vault queue [--limit N]        the resolve queue: unlinked ingredient names, most frequent first
  vault user add <login> --name "<Nom>" [--email <e>] [--markdown]
                                 create an account (password asked twice, never an argument);
                                 --markdown shows the paste box, raw file and resolve queue
  vault user passwd <login>      set a new password; signs that account out everywhere
  vault user remove <login>      delete an account and end its sessions
  vault user list                logins and names
        --vault <dir>            (add, sync, reindex, stats, ingredients, queue) instead of the config's vault

Exit codes: 0 no errors (warnings allowed), 1 any error, 2 usage or IO failure.`;

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;
	try {
		if (command === 'check') return check(rest);
		if (command === 'init') return await init(rest);
		if (command === 'add') return await add(rest);
		if (command === 'sync') return await sync(rest, false);
		if (command === 'reindex') return await sync(rest, true);
		if (command === 'stats') return stats(rest);
		if (command === 'ingredients') return await ingredients(rest);
		if (command === 'queue') return queue(rest);
		if (command === 'user') return await user(rest);
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

/** The config's currency when a config exists, else the default. */
function readCurrency(): string {
	try {
		const f = findConfig();
		const c = f ? JSON.parse(readFileSync(f, 'utf8')).currency : undefined;
		if (typeof c === 'string' && /^[A-Za-z]{3}$/.test(c)) return c.toUpperCase();
	} catch {
		// fall through
	}
	return DEFAULT_CURRENCY;
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
		return openVault({ root, author: readAuthor(), push: false, currency: readCurrency() });
	}
	const config = loadConfig();
	return openVault({ root: config.vaultDirectory, author: config.gitAuthor, push: config.gitPush, currency: config.currency });
}

async function init(args: string[]): Promise<number> {
	if (args.length !== 1) throw new UsageError('vault init needs exactly one directory');
	const dir = resolve(args[0]);
	await initVault(dir, readFileSync(join(REPO, 'docs/VOCAB.md'), 'utf8'), readAuthor(), readFileSync(join(REPO, 'docs/INGREDIENTS-SEED.yaml'), 'utf8'));
	console.log(`vault created at ${dir}`);
	return 0;
}

async function ingredients(args: string[]): Promise<number> {
	const { dir, rest } = vaultArgs(args);
	if (rest[0] !== 'seed' || rest.length !== 1) throw new UsageError('usage: vault ingredients seed [--vault <dir>]');
	const ctx = openFromArgs(dir);
	const r = await seedVault(ctx, readFileSync(join(REPO, 'docs/INGREDIENTS-SEED.yaml'), 'utf8'), readFileSync(join(REPO, 'docs/VOCAB.md'), 'utf8'));
	const report = syncVault(ctx.db, ctx.paths, { currency: ctx.currency });
	await ctx.pusher.idle();
	ctx.db.close();
	console.log(`${plural(r.added.length, 'seed ingredient')} added${r.commit ? ` (commit ${r.commit.slice(0, 7)})` : ''}; the registry has ${plural(report.registry.files, 'ingredient')}.`);
	return 0;
}

async function add(args: string[]): Promise<number> {
	const { dir, rest } = vaultArgs(args);
	if (!rest.length) throw new UsageError('vault add needs files');
	const ctx = openFromArgs(dir);
	syncVault(ctx.db, ctx.paths, { currency: ctx.currency });
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

// --- vault user ---------------------------------------------------------------

/**
 * Accounts (plan 04, Phase 1): users.json next to the config file, never in the
 * vault. Passwords are read from the terminal with echo off (from stdin, one
 * per line, when it is not a terminal), never taken as an argument: an
 * argument lands in the shell history and in `ps`.
 */
async function user(args: string[]): Promise<number> {
	const [sub, ...rest] = args;
	const configFile = findConfig();
	if (!configFile) throw new Error('no config found: accounts live next to it (users.json). Create the config first (docs/DEPLOY.md).');
	const config = loadConfig();
	const file = usersPath(configFile);
	assertOutsideVault(file, config.vaultDirectory);
	const opts: Record<string, string | true> = {};
	const pos: string[] = [];
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (a === '--markdown') opts.markdown = true;
		else if (a === '--name' || a === '--email') {
			const v = rest[++i];
			if (v === undefined) throw new UsageError(`${a} needs a value`);
			opts[a.slice(2)] = v;
		} else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
		else pos.push(a);
	}
	/** End the account's sessions in the running app's store (cache/sessions.db), when there is one. */
	const signOut = (login: string) => {
		const db = join(config.vaultDirectory, 'cache', 'sessions.db');
		if (!existsSync(db)) return 0;
		const store = new SessionStore(db);
		try {
			return store.revokeLogin(login);
		} finally {
			store.close();
		}
	};
	if (sub === 'list') {
		if (pos.length || Object.keys(opts).length) throw new UsageError('usage: vault user list');
		const users = loadUsers(file);
		if (!users.length) console.log(`no accounts in ${file}`);
		for (const u of users) console.log(`${u.login.padEnd(16)} ${u.name}${u.markdown ? dim('  (markdown)') : ''}`);
		return 0;
	}
	if (pos.length !== 1) throw new UsageError(`usage: vault user ${sub ?? '<add|passwd|remove|list>'} <login>`);
	const login = normalizeLogin(pos[0]);
	if (sub === 'add') {
		if (typeof opts.name !== 'string') throw new UsageError('vault user add needs --name "<Nom>" (shown in the app and in git history)');
		if (loadUsers(file).some((u) => u.login === login)) throw new Error(`an account "${login}" already exists`);
		const password = await newPassword();
		const u = await addUser(file, { login, name: opts.name, email: typeof opts.email === 'string' ? opts.email : undefined, markdown: opts.markdown === true, password });
		console.log(`account ${u.login} (${u.name}) added to ${file}`);
		return 0;
	}
	if (Object.keys(opts).length) throw new UsageError(`vault user ${sub} takes no options`);
	if (sub === 'passwd') {
		if (!loadUsers(file).some((u) => u.login === login)) throw new Error(`no account "${login}"`);
		await setPassword(file, login, await newPassword());
		const n = signOut(login);
		console.log(`password of ${login} changed${n ? `; ${plural(n, 'session')} ended` : ''}`);
		return 0;
	}
	if (sub === 'remove') {
		removeUser(file, login);
		const n = signOut(login);
		console.log(`account ${login} removed${n ? `; ${plural(n, 'session')} ended` : ''}`);
		return 0;
	}
	throw new UsageError(`unknown: vault user ${sub ?? ''}`);
}

/** A new password, typed twice. */
async function newPassword(): Promise<string> {
	const read = process.stdin.isTTY ? hiddenLine : pipedLine;
	const a = await read('Mot de passe : ');
	checkPassword(a);
	const b = await read('Encore une fois : ');
	if (a !== b) throw new Error('the two passwords differ; nothing changed');
	return a;
}

let piped: string[] | undefined;
/** Not a terminal (a script, a test): one password per line of stdin. */
async function pipedLine(): Promise<string> {
	if (!piped) {
		const chunks: Buffer[] = [];
		for await (const c of process.stdin) chunks.push(c as Buffer);
		piped = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
	}
	const line = piped.shift();
	if (line === undefined) throw new Error('no password on stdin');
	return line;
}

/** A line typed with echo off. */
function hiddenLine(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const stdin = process.stdin;
		process.stderr.write(prompt);
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding('utf8');
		let buf = '';
		const done = (err?: Error) => {
			stdin.setRawMode(false);
			stdin.pause();
			stdin.removeListener('data', onData);
			process.stderr.write('\n');
			if (err) reject(err);
			else resolve(buf);
		};
		const onData = (chunk: string) => {
			for (const ch of chunk) {
				if (ch === '\r' || ch === '\n') return done();
				if (ch === '\u0003') return done(new Error('cancelled'));
				if (ch === '\u007f' || ch === '\b') buf = [...buf].slice(0, -1).join('');
				else if (ch >= ' ') buf += ch;
			}
		};
		stdin.on('data', onData);
	});
}

function queue(args: string[]): number {
	const i = args.indexOf('--limit');
	let limit = 20;
	if (i >= 0) {
		limit = Number(args[i + 1]);
		if (!Number.isInteger(limit) || limit < 1) throw new UsageError('--limit needs a positive whole number');
		args = [...args.slice(0, i), ...args.slice(i + 2)];
	}
	const { dir, rest } = vaultArgs(args);
	if (rest.length) throw new UsageError(`unexpected argument ${rest[0]}`);
	const ctx = openFromArgs(dir);
	syncVault(ctx.db, ctx.paths, { currency: ctx.currency });
	const vocab = loadVocab(ctx.paths.vocab);
	const { total, rows } = resolveQueue(ctx.db, vocab, { limit });
	const occurrences = rows.reduce((n, r) => n + r.count, 0);
	ctx.db.close();
	if (!total) {
		console.log('Every ingredient name is linked to the registry.');
		return 0;
	}
	const width = Math.min(32, Math.max(...rows.map((r) => r.forms[0].name.length)));
	for (const r of rows) {
		const cands = r.candidates.map((c) => (r.ambiguous ? c.slug : `${c.slug} ${c.score.toFixed(2)}`)).join(', ');
		const forms = r.forms.length > 1 ? `  (${r.forms.map((f) => `${f.name} ×${f.count}`).join(', ')})` : '';
		console.log(
			`${String(r.count).padStart(4)}  ${r.forms[0].name.padEnd(width)}  ${plural(r.recipes, 'recipe')}, ${r.lang}  ${r.ambiguous ? yellow(`ambiguous: ${cands}`) : cands ? `→ ${cands}` : '—'}${forms}`
		);
	}
	console.log(`${plural(total, 'name')} to link${total > rows.length ? `; the first ${rows.length} shown (${occurrences} uses)` : ''}.`);
	return 0;
}

async function sync(args: string[], rebuild: boolean): Promise<number> {
	const { dir, set } = vaultArgs(args, ['--force']);
	let ctx = openFromArgs(dir);
	if (rebuild) {
		ctx.db.close();
		for (const suffix of ['', '-wal', '-shm']) rmSync(ctx.paths.index + suffix, { force: true });
		ctx = openFromArgs(dir);
	}
	const r = syncVault(ctx.db, ctx.paths, { force: set.has('--force') || rebuild, currency: ctx.currency });
	const priceIssues = priceProblems(ctx.db, ctx.currency);
	// The commit index: the commits since the last read (a pull, a commit by hand), or all of them after a reindex.
	const commits = await catchUpCommits(ctx.db, ctx.paths.root).catch((e: Error) => (console.error(`vault: git history not read: ${e.message}`), null));
	ctx.db.close();
	console.log(`${r.scanned} files: ${r.indexed} indexed, ${r.unchanged} unchanged, ${r.removed} removed, ${r.problems.length} with errors (${r.ms} ms)`);
	if (commits?.mode === 'rebuild') console.log(`git history: ${plural(commits.commits, 'commit')} read`);
	else if (commits?.mode === 'append') console.log(`git history: ${plural(commits.commits, 'new commit')} read`);
	for (const p of r.problems) console.log(`  ${red('✗')} ${p.file}  ${p.codes.join(', ')}`);
	const broken = r.registry.problems.filter((p) => p.broken);
	console.log(`${plural(r.registry.files, 'ingredient')}: ${r.registry.loaded} read, ${broken.length} with errors, ${r.registry.problems.length - broken.length} with warnings`);
	for (const p of r.registry.problems) console.log(`  ${p.broken ? red('✗') : yellow('!')} ${p.file}  ${p.codes.join(', ')}`);
	if (r.prices.rows || priceIssues.length) printPrices(r.prices.rows, priceIssues, true);
	return r.problems.length || broken.length || r.prices.skipped ? 1 : 0;
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

/** The ingredient files of a vault directory, checked one by one and across the registry. */
function checkIngredients(vaultDir: string): { name: string; diagnostics: Diagnostic[] }[] {
	const dir = join(vaultDir, 'ingredients');
	if (!existsSync(dir)) return [];
	const vocab = loadVocab(join(vaultDir, 'vocab'));
	const allergens = vocab.allergens.size ? new Set(vocab.allergens.keys()) : undefined;
	const files = mdFiles(dir).map((f) => {
		const stem = basename(f, '.md');
		return { name: `ingredients/${stem}.md`, ...parseIngredient(readFileSync(f, 'utf8'), { fileStem: stem, allergens }) };
	});
	const cross = checkRegistry(files.flatMap((f) => (f.entry ? [f.entry] : [])));
	return files.map((f) => ({ name: f.name, diagnostics: [...f.diagnostics, ...(f.entry ? (cross.get(f.entry.slug) ?? []) : [])] }));
}

/** prices.csv of a vault directory (docs/VALIDATION.md, "Price codes"), against its ingredient files. */
function checkPricesFile(vaultDir: string, ingredientsChecked: { name: string }[]): { rows: number; problems: PriceProblem[] } | undefined {
	const f = join(vaultDir, PRICES_FILE);
	if (!existsSync(f)) return undefined;
	const slugs = new Set(ingredientsChecked.map((i) => basename(i.name, '.md')));
	const { rows, problems } = parsePrices(readFileSync(f, 'utf8'), { currency: readCurrency(), slugs });
	return { rows: rows.length, problems };
}

/**
 * The name-word lists (W302 / W304 / W607) and, in a vault, its tag vocabulary
 * (W501): the vault's own files, else the seed of docs/VOCAB.md. W502 needs
 * the index's families and is left to the app.
 */
function checkWordOptions(vaultDir: string | undefined): RecipeCheckOptions {
	if (vaultDir && existsSync(join(vaultDir, 'vocab')))
		return { words: loadCheckWords(join(vaultDir, 'vocab')), vocab: { tags: loadVocab(join(vaultDir, 'vocab')).tags } };
	try {
		return { words: seedCheckWords(readFileSync(join(REPO, 'docs/VOCAB.md'), 'utf8')) };
	} catch {
		return {};
	}
}

function check(args: string[]): number {
	const o = parseArgs(args);
	// A vault directory: its recipes, and its ingredient registry.
	const vaultDir = o.dir && existsSync(join(o.dir, 'recipes')) ? o.dir : undefined;
	if (vaultDir) o.dir = join(vaultDir, 'recipes');
	const ingredientResults = vaultDir ? checkIngredients(vaultDir) : [];
	const priceResult = vaultDir ? checkPricesFile(vaultDir, ingredientResults) : undefined;
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
	const result = checkBatch(inputs, { vault, ...checkWordOptions(vaultDir) });
	if (outside) addOutsideText(result, outside);
	const failed =
		result.files.some((f) => hasErrors(f.diagnostics)) ||
		ingredientResults.some((f) => hasErrors(f.diagnostics)) ||
		!!priceResult?.problems.some((p) => p.severity === 'error');

	if (o.json) {
		const out = {
			files: result.files.map((f) => ({ name: f.name, ok: !hasErrors(f.diagnostics), diagnostics: f.diagnostics })),
			pasteDiagnostics: result.pasteDiagnostics,
			summary: result.summary,
			...(vaultDir ? { ingredients: ingredientResults.map((f) => ({ ...f, ok: !hasErrors(f.diagnostics) })) } : {}),
			...(priceResult ? { prices: priceResult } : {})
		};
		console.log(JSON.stringify(out, null, 2));
	} else if (o.fixBlock) {
		printFixBlock(result, inputs);
	} else {
		printHuman(result, o);
		if (vaultDir) printIngredients(ingredientResults, o.quiet);
		if (priceResult) printPrices(priceResult.rows, priceResult.problems, !o.quiet);
		if (vaultDir) printDistinct(vaultDir);
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

function printIngredients(files: { name: string; diagnostics: Diagnostic[] }[], quiet: boolean): void {
	if (!quiet)
		for (const f of files) {
			if (!f.diagnostics.length) continue;
			console.log(`${hasErrors(f.diagnostics) ? red('✗') : yellow('!')} ${bold(f.name)}  ${counts(f.diagnostics)}`);
			f.diagnostics.forEach(printDiagnostic);
		}
	const bad = files.filter((f) => hasErrors(f.diagnostics)).length;
	const all = files.flatMap((f) => f.diagnostics);
	console.log(`${plural(files.length, 'ingredient')}: ${bad} failed, ${files.length - bad} passed` + (all.length ? ` — ${counts(all)}` : ''));
}

/** vocab/distinct.yaml (plan 05, Q14): its pairs naming a recipe no longer in the vault are stale — harmless, reported, nothing more. */
function printDistinct(vaultDir: string): void {
	const file = join(vaultDir, DISTINCT_FILE);
	if (!existsSync(file)) return;
	const { pairs, problem } = readDistinct(readFileSync(file, 'utf8'));
	if (problem) {
		// Informational, never an error (plan 05, Phase 7): but not "0 pairs" when it does not read.
		console.log(
			yellow(`${DISTINCT_FILE}: ${problem === 'yaml' ? 'does not parse as YAML' : 'is not a list of pairs'}; every pair in it is ignored until it is fixed by hand`)
		);
		return;
	}
	const there = (slug: string) => existsSync(join(vaultDir, 'recipes', `${slug}.md`));
	const stale = pairs.filter(([a, b]) => !there(a) || !there(b));
	console.log(`${DISTINCT_FILE}: ${plural(pairs.length, 'pair')} settled as different recipes${stale.length ? `, ${stale.length} stale` : ''}`);
	for (const [a, b] of stale) console.log(dim(`  ${a} ≠ ${b}  (no longer in recipes/; ignored)`));
}

function printPrices(rows: number, problems: PriceProblem[], detail: boolean): void {
	if (detail)
		for (const p of problems) {
			console.log(`  ${(p.severity === 'error' ? red : yellow)(p.code)} ${PRICES_FILE} line ${p.line}: ${p.message}`);
			if (p.fix) console.log(dim(`       ${p.fix}`));
		}
	const e = problems.filter((p) => p.severity === 'error').length;
	console.log(`${PRICES_FILE}: ${plural(rows, 'price row')}, ${plural(e, 'line')} skipped, ${plural(problems.length - e, 'warning')}`);
}

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
