// DNS-rebinding guard (docs/DATA-FLOW.md, "Authentication"). With no login in
// P1, a page on evil.example whose DNS is rebound to the LAN address would be
// same-origin with the app: its Origin and Host headers both read
// evil.example, so the Origin check alone lets it read and write the vault.
// Every request, reads included, must name a host the app knows it is served on.

import { hostname as osHostname } from 'node:os';
import { isIP } from 'node:net';

/** The bare, lowercased host name of a `Host` header: port, brackets and trailing dot removed. */
export function hostOf(header: string): string {
	let h = header.trim().toLowerCase();
	if (h.startsWith('[')) h = h.slice(1, h.indexOf(']') === -1 ? undefined : h.indexOf(']'));
	else if (h.split(':').length === 2) h = h.split(':')[0];
	return h.replace(/\.$/, '');
}

/** Names always allowed: localhost, the machine's own name (and `<name>.local`), any Tailscale `*.ts.net` name. */
export function defaultHosts(machine = osHostname()): string[] {
	const name = machine.toLowerCase().replace(/\.$/, '');
	const short = name.split('.')[0];
	return [...new Set(['localhost', name, short, `${short}.local`, '*.ts.net'])].filter(Boolean);
}

/**
 * True when the `Host` header names this app: an IP literal (v4 or v6, which a
 * rebinding attack cannot use — it needs a name it controls), a default name,
 * or an entry of the config's `hosts` (exact, or `*.suffix` for any subdomain).
 */
export function hostAllowed(header: string | null, extra: readonly string[] = [], machine?: string): boolean {
	if (!header) return false;
	const host = hostOf(header);
	if (!host) return false;
	if (isIP(host)) return true;
	return [...defaultHosts(machine), ...extra].some((entry) => {
		const e = entry.trim().toLowerCase().replace(/\.$/, '');
		return e.startsWith('*.') ? host.endsWith(e.slice(1)) && host.length > e.length - 1 : host === e;
	});
}
