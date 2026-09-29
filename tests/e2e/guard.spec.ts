// Every write needs a session (plan 04, Q1 A); the host allowlist and the
// Origin check still come first; a write with a session is the signed-in
// person's commit. Against the running app and its throwaway vault.
import { execFileSync } from 'node:child_process';
import { expect, request as newRequest, test } from '@playwright/test';
import { FIXTURE_USERS } from '../../scripts/fixture-vault';
import { file } from './helpers';

const VAULT = '/tmp/rv-e2e/vault';
const lastCommit = () => execFileSync('git', ['log', '-1', '--format=%s|%an|%ae'], { cwd: VAULT, encoding: 'utf8' }).trim();

/** Each existing write, as the browser sends it. */
const ACTIONS = [
	'/r/crepes?/verify',
	'/r/crepes?/remove',
	'/corbeille?/restore',
	'/famille/lasagna?/label',
	'/resoudre?/link',
	'/resoudre?/create',
	'/resoudre?/unlink',
	'/resoudre?/rule',
	'/ingredients?/price',
	'/ingredients/farine?/alias',
	'/ingredients/farine?/link',
	'/ingredients/farine?/edit',
	'/ingredients/farine?/merge'
];
const APIS = ['/api/save', '/api/check', '/api/import', '/api/pastelog'];

test('signed out, every write is refused and nothing is committed', async ({ baseURL }) => {
	const anon = await newRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	const before = lastCommit();
	for (const path of ACTIONS) {
		// A plain form post (no JavaScript): a redirect to the sign-in page.
		const r = await anon.post(path, { form: { hash: 'x', slug: 'crepes', label: 'X' }, headers: { origin: baseURL!, accept: 'text/html' }, maxRedirects: 0 });
		expect(r.status(), path).toBe(303);
		expect(r.headers().location, path).toMatch(/^\/connexion\?suite=/);
	}
	// A form action posted by SvelteKit's enhance: a redirect it follows, not a page.
	const enhanced = await anon.post('/r/crepes?/verify', { form: { hash: 'x' }, headers: { origin: baseURL!, accept: 'application/json', 'x-sveltekit-action': 'true' } });
	expect(await enhanced.json()).toEqual({ type: 'redirect', status: 303, location: '/connexion?suite=%2Fr%2Fcrepes' });
	for (const path of APIS) {
		const r = await anon.post(path, { data: { files: [file('Refusée')] }, headers: { origin: baseURL! } });
		expect(r.status(), path).toBe(401);
	}
	expect(lastCommit()).toBe(before);
	await anon.dispose();
});

test('a cross-site write is refused even with a valid session; an unknown host even for a read', async ({ page, baseURL }) => {
	const r = await page.request.post('/api/save', { data: { files: [{ text: file('Intruse') }] }, headers: { origin: 'http://evil.example' } });
	expect(r.status()).toBe(403);
	const a = await page.request.post('/r/crepes?/verify', { form: { hash: 'x' }, headers: { origin: 'http://evil.example' }, maxRedirects: 0 });
	expect(a.status()).toBe(403);
	const h = await page.request.get('/', { headers: { host: 'evil.example' } });
	expect(h.status()).toBe(421);
});

test('signed in, a write is the signed-in person’s commit', async ({ page, baseURL }) => {
	const { owner } = FIXTURE_USERS;
	const r = await page.request.post('/api/save', { data: { files: [{ text: file('Galettes de l’essai') }] }, headers: { origin: baseURL! } });
	expect(r.status()).toBe(200);
	expect(lastCommit()).toBe(`add: Galettes de l’essai|${owner.name}|${owner.email}`);
	await page.goto('/r/galettes-de-l-essai');
	await page.getByRole('button', { name: 'Vérifié' }).click();
	await expect(page.getByText('Recette marquée vérifiée.')).toBeVisible();
	expect(lastCommit()).toBe(`verify: Galettes de l’essai|${owner.name}|${owner.email}`);
});
