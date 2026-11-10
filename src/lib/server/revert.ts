// "Annuler" for the settling pages' vocabulary and registry writes (/etiquettes,
// /resoudre; docs/DATA-FLOW.md, "Undo"): one commit of the app, taken back by
// writing each file it touched as it was before it — removed when the commit
// created it — in one new commit. Refused when any of those files changed
// since (a later decision, a hand edit): undoing would lose that change.
// Recipe commits go through history.ts's undoCommit instead (the trash, the
// checker); this one only takes paths `allowed` says it may.

import type { VaultContext } from './context';
import { FileWriteError, readVaultFile, writeAndCommit, type FileWrite } from './files';
import { git } from './git';

export class RevertError extends Error {
	constructor(readonly reason: 'unknown' | 'unsupported' | 'stale' | 'failed') {
		super(reason);
	}
}

const COMMIT_RE = /^[0-9a-f]{7,64}$/;

/** A file's text at `rev`, or null when it is not there. */
async function at(root: string, rev: string, path: string): Promise<string | null> {
	try {
		return await git(root, ['cat-file', 'blob', `${rev}:${path}`]);
	} catch {
		return null;
	}
}

/**
 * Take back `commit`: every path it changed must pass `allowed` and still be
 * as the commit left it. One commit `undo: <its subject>`. The caller holds
 * the lock and updates the index afterwards. Returns the new commit.
 */
export async function revertFiles(ctx: VaultContext, commit: string, allowed: (path: string) => boolean): Promise<{ commit?: string; paths: string[] }> {
	const root = ctx.paths.root;
	if (!COMMIT_RE.test(commit)) throw new RevertError('unknown');
	let full: string;
	try {
		full = (await git(root, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`])).trim();
	} catch {
		throw new RevertError('unknown');
	}
	if (!full) throw new RevertError('unknown');
	const parents = (await git(root, ['rev-list', '--parents', '-n', '1', full])).trim().split(' ').slice(1);
	if (parents.length !== 1) throw new RevertError('unsupported');
	const changes = (await git(root, ['diff-tree', '-r', '--no-renames', '--no-commit-id', '--name-status', full]))
		.split('\n')
		.filter(Boolean)
		.map((l) => {
			const [status, path] = l.split('\t');
			return { status: status[0], path };
		});
	if (!changes.length || changes.some((c) => !allowed(c.path))) throw new RevertError('unsupported');
	const writes: FileWrite[] = [];
	for (const c of changes) {
		const now = readVaultFile(ctx, c.path);
		const left = c.status === 'D' ? null : await at(root, full, c.path);
		if ((left ?? '') !== now.text || (left === null) !== (now.hash === '')) throw new RevertError('stale');
		writes.push({ rel: c.path, text: c.status === 'A' ? null : await at(root, `${full}^`, c.path) });
	}
	const subject = (await git(root, ['log', '-1', '--format=%s', full])).trim();
	try {
		return { commit: await writeAndCommit(ctx, writes, `undo: ${subject}`), paths: changes.map((c) => c.path) };
	} catch (e) {
		if (e instanceof FileWriteError) throw new RevertError('failed');
		throw e;
	}
}
