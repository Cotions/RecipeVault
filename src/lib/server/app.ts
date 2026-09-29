// The running app: config, vault, index, watcher. Started once by the server
// init hook; routes reach it through getApp().

import { join } from 'node:path';
import { Throttle, type Auth, type SignedIn } from './auth';
import { loadConfig, type Config } from './config';
import { openVault, withAuthor, type VaultContext } from './context';
import { scheduleCatchUp } from './index/commits';
import { syncVault, type SyncReport } from './index/sync';
import { PasteLog } from './pastelog';
import { SessionStore } from './sessions';
import { assertOutsideVault, decoyHash, UserStore, usersPath } from './users';
import { commitExternalEdits, Watcher } from './watcher';

export interface App {
	config: Config;
	ctx: VaultContext;
	watcher: Watcher;
	pasteLog: PasteLog;
	startup: SyncReport;
	/** Accounts (users.json beside the config), sessions (cache/sessions.db), the login throttle. */
	auth: Auth;
}

let app: App | undefined;

export function startApp(): App {
	if (app) return app;
	const config = loadConfig();
	const users = usersPath(config.file);
	assertOutsideVault(users, config.vaultDirectory);
	const ctx = openVault({ root: config.vaultDirectory, author: config.gitAuthor, push: config.gitPush, currency: config.currency });
	const startup = syncVault(ctx.db, ctx.paths, { currency: ctx.currency });
	console.log(
		`recipevault: vault ${config.vaultDirectory} — ${startup.scanned} recipes, ${startup.indexed} (re)indexed, ${startup.problems.length} with errors (${startup.ms} ms)`
	);
	const watcher = new Watcher(ctx);
	watcher.start();
	ctx.lock
		.run(() => commitExternalEdits(ctx))
		.catch((e) => console.warn(`recipevault: could not commit edits made while the app was stopped: ${(e as Error).message}`));
	ctx.pusher.schedule();
	// Commits made while the app was down (a pull, a commit by hand): read into the commit index.
	scheduleCatchUp(ctx);
	const auth: Auth = { users: new UserStore(users), sessions: new SessionStore(join(ctx.paths.cache, 'sessions.db')), throttle: new Throttle() };
	void decoyHash(); // ready before the first sign-in, so an unknown login costs the same as a known one from the start
	if (!auth.users.size) console.warn(`recipevault: no accounts in ${users}: nobody can save. Create one with \`vault user add <login> --name "<Nom>"\`.`);
	app = { config, ctx, watcher, pasteLog: new PasteLog(ctx.paths.pasteLog), startup, auth };
	return app;
}

export function getApp(): App {
	return app ?? startApp();
}

/**
 * The vault as the signed-in person writes it: every commit made through it
 * is theirs. The hook's guard already refused a signed-out write; this refuses
 * it again rather than fall back to the config's author.
 */
export function writeContext(user: SignedIn | null): VaultContext {
	if (!user) throw new Error('recipevault: a write without a signed-in person (the guard should have refused it)');
	return withAuthor(getApp().ctx, user.author);
}
