// Write vault text files and commit them together, or change nothing
// (docs/DATA-FLOW.md, "SAVE": order and rollback). Shared by recipe saves,
// family labels and ingredient edits (plan 03), and later price rows.
//
// Each file is written atomically (temp file + rename) and recorded in
// `ctx.ownWrites`, so the watcher does not take the app's own write for an
// outside edit. A failed write or commit puts every file back as it was
// (removed if it was new) and unstages it: a file the app wrote but git never
// recorded would be ignored by the watcher and never committed. The caller
// holds `ctx.lock` and updates the index afterwards.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { VaultContext } from './context';
import { commitPaths, unstage } from './git';
import { sha256 } from './index/build';

export interface FileWrite {
	/** Path relative to the vault root. */
	rel: string;
	/** The new content; null deletes the file. */
	text: string | null;
}

export class FileWriteError extends Error {
	constructor(
		/** Which step failed: nothing changed either way. */
		readonly stage: 'write' | 'commit',
		readonly cause: Error
	) {
		super(cause.message);
	}
}

/** A vault file as on disk: text and sha256 ('' for both when absent). */
export function readVaultFile(ctx: VaultContext, rel: string): { text: string; hash: string } {
	const abs = join(ctx.paths.root, rel);
	if (!existsSync(abs)) return { text: '', hash: '' };
	const buf = readFileSync(abs);
	return { text: buf.toString('utf8'), hash: sha256(buf) };
}

/** Write the files, then commit them in one commit. Returns the commit id (undefined when nothing changed). */
export async function writeAndCommit(ctx: VaultContext, writes: FileWrite[], message: string): Promise<string | undefined> {
	const paths = writes.map((w) => w.rel);
	const done: { rel: string; abs: string; previous?: Buffer }[] = [];
	const rollback = async () => {
		for (const w of done.reverse()) {
			ctx.ownWrites.delete(w.rel);
			try {
				if (w.previous) writeFileSync(w.abs, w.previous);
				else rmSync(w.abs, { force: true });
			} catch (e) {
				ctx.log(`recipevault: could not put ${w.rel} back: ${(e as Error).message}`);
			}
		}
		await unstage(ctx.paths.root, paths);
	};
	try {
		for (const w of writes) {
			const abs = join(ctx.paths.root, w.rel);
			const previous = existsSync(abs) ? readFileSync(abs) : undefined;
			if (w.text === null) {
				if (previous) rmSync(abs);
			} else {
				const tmp = join(dirname(abs), `.${basename(abs)}.${process.pid}.tmp`);
				try {
					writeFileSync(tmp, w.text);
					ctx.ownWrites.set(w.rel, sha256(w.text));
					renameSync(tmp, abs);
				} catch (e) {
					ctx.ownWrites.delete(w.rel);
					rmSync(tmp, { force: true });
					throw e;
				}
			}
			done.push({ rel: w.rel, abs, previous });
		}
	} catch (e) {
		await rollback();
		throw new FileWriteError('write', e as Error);
	}
	try {
		return await commitPaths(ctx.paths.root, paths, message, ctx.author);
	} catch (e) {
		await rollback();
		throw new FileWriteError('commit', e as Error);
	}
}
