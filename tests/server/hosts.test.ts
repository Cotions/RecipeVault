import { describe, expect, it } from 'vitest';
import { hostAllowed, hostOf } from '../../src/lib/server/hosts';

describe('host allowlist (DNS rebinding)', () => {
	it('reads the bare host out of a Host header', () => {
		expect(hostOf('Cuisine.local:3370')).toBe('cuisine.local');
		expect(hostOf('[::1]:3370')).toBe('::1');
		expect(hostOf('127.0.0.1')).toBe('127.0.0.1');
		expect(hostOf('example.lan.')).toBe('example.lan');
	});

	it('allows localhost, IP literals, the machine name, .local and *.ts.net', () => {
		for (const h of ['localhost:3370', '127.0.0.1:3398', '192.168.1.20:3370', '[::1]:3370', '[fe80::1]', 'cuisine:3370', 'cuisine.local:3370', 'CUISINE.LOCAL', 'cuisine.tail1234.ts.net'])
			expect(hostAllowed(h, [], 'cuisine'), h).toBe(true);
	});

	it('refuses any other name, a missing header, and a lookalike suffix', () => {
		for (const h of [null, '', 'evil.example:3370', 'cuisine.evil.example', 'ts.net', 'evilts.net', 'localhost.evil.example'])
			expect(hostAllowed(h, [], 'cuisine'), String(h)).toBe(false);
	});

	it('allows the config’s extra hosts, exact or *.suffix', () => {
		expect(hostAllowed('recettes.maison.lan:3370', ['recettes.maison.lan'], 'cuisine')).toBe(true);
		expect(hostAllowed('a.maison.lan', ['*.maison.lan'], 'cuisine')).toBe(true);
		expect(hostAllowed('maison.lan', ['*.maison.lan'], 'cuisine')).toBe(false);
		expect(hostAllowed('autre.lan', ['recettes.maison.lan'], 'cuisine')).toBe(false);
	});
});
