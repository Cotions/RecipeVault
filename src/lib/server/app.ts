// The running app: config, vault, index, watcher. Started once by the server
// init hook; routes reach it through getApp().

import { loadConfig, type Config } from './config';
import { openVault, type VaultContext } from './context';
import { syncVault, type SyncReport } from './index/sync';
import { PasteLog } from './pastelog';
import { commitExternalEdits, Watcher } from './watcher';

export interface App {
	config: Config;
	ctx: VaultContext;
	watcher: Watcher;
	pasteLog: PasteLog;
	startup: SyncReport;
}

let app: App | undefined;

export function startApp(): App {
	if (app) return app;
	const config = loadConfig();
	const ctx = openVault({ root: config.vaultDirectory, author: config.gitAuthor, push: config.gitPush });
	const startup = syncVault(ctx.db, ctx.paths);
	console.log(
		`recipevault: vault ${config.vaultDirectory} — ${startup.scanned} recipes, ${startup.indexed} (re)indexed, ${startup.problems.length} with errors (${startup.ms} ms)`
	);
	const watcher = new Watcher(ctx);
	watcher.start();
	ctx.lock
		.run(() => commitExternalEdits(ctx))
		.catch((e) => console.warn(`recipevault: could not commit edits made while the app was stopped: ${(e as Error).message}`));
	ctx.pusher.schedule();
	app = { config, ctx, watcher, pasteLog: new PasteLog(ctx.paths.pasteLog), startup };
	return app;
}

export function getApp(): App {
	return app ?? startApp();
}
