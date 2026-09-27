// Edits from outside the app (docs/DATA-FLOW.md, "File watcher"): a text
// editor, Obsidian, `git revert` in the vault. Debounced per file. A recipe
// that parses is re-indexed and committed as `edit (external): <title>`; one
// that does not keeps its last good rows, is flagged with its codes, and is
// not committed — a half-typed edit must never knock a recipe out of search.
// The app's own writes are recognized by hash and ignored.

import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { parseRecipe } from '../vault/parse';
import { stripMarkers } from '../vault/markers';
import type { VaultContext } from './context';
import { commitPaths, isDirty } from './git';
import { refreshFamilies, retag, sha256 } from './index/build';
import { isRecipeFile, syncFile, type FileOutcome } from './index/sync';
import { INGREDIENTS, RECIPES, VOCAB } from './vault';
import { loadVocab } from './vocab';

export interface WatcherOptions {
	debounceMs?: number;
	/** Called after each handled change — for tests and logs. */
	onHandled?: (rel: string, outcome: FileOutcome | 'committed' | 'ignored' | 'flagged') => void;
}

type Kind = 'recipe' | 'vocab' | 'ingredient' | 'prices';

function kindOf(dir: string, name: string): Kind | undefined {
	if (dir === RECIPES) return isRecipeFile(name) ? 'recipe' : undefined;
	if (dir === VOCAB) return /\.ya?ml$/.test(name) && !name.startsWith('.') ? 'vocab' : undefined;
	if (dir === INGREDIENTS) return isRecipeFile(name) ? 'ingredient' : undefined;
	if (dir === '') return name === 'prices.csv' ? 'prices' : undefined;
	return undefined;
}

export class Watcher {
	private watchers: FSWatcher[] = [];
	private timers = new Map<string, NodeJS.Timeout>();
	private running = new Set<Promise<void>>();
	private debounceMs: number;

	constructor(
		private ctx: VaultContext,
		private opts: WatcherOptions = {}
	) {
		this.debounceMs = opts.debounceMs ?? 1000;
	}

	start(): void {
		for (const dir of [RECIPES, VOCAB, INGREDIENTS, '']) {
			const abs = join(this.ctx.paths.root, dir);
			if (!existsSync(abs)) continue;
			const w = watch(abs, { persistent: false }, (_event, filename) => {
				if (!filename) return;
				const name = filename.toString();
				const kind = kindOf(dir, name);
				if (kind) this.schedule(dir ? `${dir}/${name}` : name, kind);
			});
			w.on('error', (e) => this.ctx.log(`recipevault: watcher error on ${abs}: ${e.message}`));
			this.watchers.push(w);
		}
	}

	stop(): void {
		for (const w of this.watchers) w.close();
		this.watchers = [];
		for (const t of this.timers.values()) clearTimeout(t);
		this.timers.clear();
	}

	/** Resolves once every scheduled change has been handled. */
	async idle(): Promise<void> {
		while (this.timers.size || this.running.size) {
			await new Promise((r) => setTimeout(r, Math.min(50, this.debounceMs)));
			await Promise.all(this.running);
		}
	}

	private schedule(rel: string, kind: Kind): void {
		clearTimeout(this.timers.get(rel));
		this.timers.set(
			rel,
			setTimeout(() => {
				this.timers.delete(rel);
				const p = this.ctx.lock
					.run(() => this.handle(rel, kind))
					.catch((e) => this.ctx.log(`recipevault: watcher could not handle ${rel}: ${(e as Error).message}`))
					.finally(() => this.running.delete(p));
				this.running.add(p);
			}, this.debounceMs)
		);
	}

	private async handle(rel: string, kind: Kind): Promise<void> {
		const { ctx } = this;
		const abs = join(ctx.paths.root, rel);
		const exists = existsSync(abs);
		const text = exists ? readFileSync(abs, 'utf8') : undefined;
		if (text !== undefined && ctx.ownWrites.get(rel) === sha256(text)) {
			ctx.ownWrites.delete(rel);
			this.opts.onHandled?.(rel, 'ignored');
			return;
		}
		if (kind === 'recipe') return this.handleRecipe(rel, text);

		// vocab, ingredients, prices: commit what reads correctly, nothing else.
		if (text !== undefined) {
			const ok =
				kind === 'vocab' ? parses(() => parse(text, { version: '1.2' })) : kind === 'ingredient' ? !!parseRecipe(text).frontmatter : true;
			if (!ok) {
				this.opts.onHandled?.(rel, 'flagged');
				return;
			}
		}
		if (kind === 'vocab') {
			const vocab = loadVocab(ctx.paths.vocab);
			ctx.db.transaction(() => {
				retag(ctx.db, vocab);
				refreshFamilies(ctx.db, vocab);
			})();
		}
		await this.commitIfDirty(rel, `${text === undefined ? 'delete' : 'edit'} (external): ${rel}`);
	}

	private async handleRecipe(rel: string, text: string | undefined): Promise<void> {
		const { ctx } = this;
		const before = ctx.db.prepare('SELECT title FROM recipes WHERE file_path = ?').pluck().get(rel) as string | undefined;
		const outcome = syncFile(ctx.db, ctx.paths, rel);
		if (outcome === 'problem') {
			this.opts.onHandled?.(rel, 'flagged');
			return;
		}
		const title = (ctx.db.prepare('SELECT title FROM recipes WHERE file_path = ?').pluck().get(rel) as string | undefined) ?? before ?? rel;
		const verb = text === undefined ? 'delete' : 'edit';
		const committed = await this.commitIfDirty(rel, `${verb} (external): ${stripMarkers(title)}`);
		this.opts.onHandled?.(rel, committed ? 'committed' : outcome);
	}

	private async commitIfDirty(rel: string, message: string): Promise<boolean> {
		const { ctx } = this;
		if (!(await isDirty(ctx.paths.root, rel))) return false;
		const commit = await commitPaths(ctx.paths.root, [rel], message, ctx.author);
		if (commit) ctx.pusher.schedule();
		return !!commit;
	}
}

function parses(fn: () => unknown): boolean {
	try {
		fn();
		return true;
	} catch {
		return false;
	}
}
