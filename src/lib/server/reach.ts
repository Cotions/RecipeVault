// Where the app is reached from (docs/DEPLOY.md, step 4): this machine, the
// home network, and — with "tailscale_https_port" in the config — an HTTPS
// name on the tailnet, set up here with `tailscale serve` at startup. All of it
// is best effort: without Tailscale the app starts the same, and says why.

import { execFileSync } from 'node:child_process';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { Config } from './config';

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

// Bridges and tunnels: addresses no phone on the wifi can use.
const VIRTUAL = /^(lo|tailscale|docker|br-|veth|virbr|lxc|tun|wg)/;

/** True for 100.64.0.0/10, the range Tailscale gives its devices. */
function isTailnet(address: string): boolean {
	const [a, b] = address.split('.').map(Number);
	return a === 100 && b >= 64 && b <= 127;
}

/** The machine's IPv4 addresses on the home network. */
export function lanAddresses(interfaces: Interfaces = networkInterfaces()): string[] {
	return Object.entries(interfaces)
		.filter(([name]) => !VIRTUAL.test(name))
		.flatMap(([, list]) => list ?? [])
		.filter((i) => i.family === 'IPv4' && !i.internal && !isTailnet(i.address))
		.map((i) => i.address);
}

/** True when the app listens on every address, the home network's included. */
function listensEverywhere(host: string): boolean {
	return host === '0.0.0.0' || host === '::';
}

/** Where `tailscale serve` forwards to: the app, as reached from this machine. */
export function serveTarget(config: Pick<Config, 'host' | 'port'>): string {
	const host = listensEverywhere(config.host) ? '127.0.0.1' : config.host;
	return `http://${host.includes(':') ? `[${host}]` : host}:${config.port}`;
}

/** What to do about `tailscale serve`: the address it gives and whether it is still to set up, or why not. */
export type ServePlan = { url: string; run: boolean } | { skip: string };

/**
 * Decide from `tailscale status --json` and `tailscale serve status --json`.
 * A port that already serves something else is left alone: it is another
 * app's, and taking it over would cut that app off.
 */
export function planServe(status: unknown, serve: unknown, target: string, httpsPort: number): ServePlan {
	const s = status as { BackendState?: string; Self?: { DNSName?: string } } | null;
	if (s?.BackendState !== 'Running') return { skip: 'Tailscale is not connected (tailscale up)' };
	const name = s.Self?.DNSName?.replace(/\.$/, '');
	if (!name) return { skip: 'this machine has no name on the tailnet (MagicDNS is off)' };

	const url = `https://${name}${httpsPort === 443 ? '' : `:${httpsPort}`}`;
	const sv = serve as { TCP?: Record<string, unknown>; Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> } | null;
	const handlers = sv?.Web?.[`${name}:${httpsPort}`]?.Handlers;
	if (!handlers) {
		if (sv?.TCP?.[String(httpsPort)]) return { skip: `Tailscale port ${httpsPort} is already used by something else` };
		return { url, run: true };
	}
	const paths = Object.keys(handlers);
	if (paths.length === 1 && handlers['/']?.Proxy === target) return { url, run: false };
	const other = handlers['/']?.Proxy ?? paths.join(', ');
	return { skip: `Tailscale port ${httpsPort} already serves ${other}: choose another "tailscale_https_port"` };
}

function tailscale(args: string[]): string {
	// `serve --bg` waits for an answer when HTTPS is not enabled on the tailnet: give up instead.
	return execFileSync('tailscale', args, { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Set `tailscale serve` up for the app. Returns its HTTPS address, or `skip`: why there is none. */
export function exposeOnTailscale(config: Pick<Config, 'host' | 'port' | 'tailscaleHttpsPort'>, run = tailscale): ServePlan {
	const httpsPort = config.tailscaleHttpsPort;
	if (httpsPort === undefined) return { skip: 'no "tailscale_https_port" in the config' };
	const target = serveTarget(config);
	try {
		const plan = planServe(JSON.parse(run(['status', '--json'])), JSON.parse(run(['serve', 'status', '--json']) || '{}'), target, httpsPort);
		if ('url' in plan && plan.run) run(['serve', '--bg', `--https=${httpsPort}`, target]);
		return plan;
	} catch (e) {
		const err = e as NodeJS.ErrnoException & { stderr?: string };
		if (err.code === 'ENOENT') return { skip: 'the tailscale command was not found' };
		const said = String(err.stderr ?? '').trim().split('\n')[0];
		return { skip: `tailscale serve failed: ${said || err.message}` };
	}
}

/** The startup lines: every address the app answers on. */
export function reachLines(config: Pick<Config, 'host' | 'port' | 'tailscaleHttpsPort'>, plan: ServePlan, lan = lanAddresses()): string[] {
	const lines = [`this machine  http://localhost:${config.port}`];
	if (listensEverywhere(config.host)) for (const a of lan) lines.push(`home network  http://${a}:${config.port}`);
	if ('url' in plan) lines.push(`Tailscale     ${plan.url}`);
	else if (config.tailscaleHttpsPort !== undefined) lines.push(`Tailscale     not set up — ${plan.skip}`);
	return lines;
}

/** Set Tailscale up when the config asks for it, and say where the app is. */
export function announce(config: Config, log: (line: string) => void = console.log): void {
	for (const line of reachLines(config, exposeOnTailscale(config))) log(`recipevault: ${line}`);
}
