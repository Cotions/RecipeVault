import { describe, expect, it } from 'vitest';
import { exposeOnTailscale, lanAddresses, planServe, reachLines, serveTarget } from '../../src/lib/server/reach';

const NAME = 'cuisine.tail0000.ts.net';
const running = { BackendState: 'Running', Self: { DNSName: `${NAME}.` } };
const TARGET = 'http://127.0.0.1:3370';
const web = (port: number, handlers: Record<string, { Proxy: string }>) => ({ TCP: { [port]: { HTTPS: true } }, Web: { [`${NAME}:${port}`]: { Handlers: handlers } } });
const v4 = (address: string, internal = false) => ({ address, family: 'IPv4' as const, internal, netmask: '', mac: '', cidr: null });

describe('reach', () => {
	it('lists the home network addresses, not loopback, bridges or the tailnet', () => {
		const found = lanAddresses({
			lo: [v4('127.0.0.1', true)],
			enp5s0: [v4('192.168.1.20'), { ...v4('fe80::1'), family: 'IPv6', scopeid: 2 }],
			tailscale0: [v4('100.101.102.103')],
			utun4: [v4('100.64.0.9')],
			lxcbr0: [v4('10.0.3.1')],
			docker0: [v4('172.17.0.1')]
		});
		expect(found).toEqual(['192.168.1.20']);
	});

	it('forwards to loopback when the app listens everywhere, else to its one address', () => {
		expect(serveTarget({ host: '0.0.0.0', port: 3370 })).toBe(TARGET);
		expect(serveTarget({ host: '::', port: 3370 })).toBe(TARGET);
		expect(serveTarget({ host: '192.168.1.20', port: 3370 })).toBe('http://192.168.1.20:3370');
		expect(serveTarget({ host: '::1', port: 3370 })).toBe('http://[::1]:3370');
	});

	it('plans a serve on a free port, and names the address', () => {
		expect(planServe(running, {}, TARGET, 8443)).toEqual({ url: `https://${NAME}:8443`, run: true });
		expect(planServe(running, {}, TARGET, 443)).toEqual({ url: `https://${NAME}`, run: true });
		// Another port's serve does not count.
		expect(planServe(running, web(443, { '/': { Proxy: 'http://127.0.0.1:9999' } }), TARGET, 8443)).toMatchObject({ run: true });
	});

	it('does nothing when the port already serves the app', () => {
		expect(planServe(running, web(8443, { '/': { Proxy: TARGET } }), TARGET, 8443)).toEqual({ url: `https://${NAME}:8443`, run: false });
	});

	it('leaves alone a port that serves something else', () => {
		expect(planServe(running, web(443, { '/': { Proxy: 'http://127.0.0.1:9999' } }), TARGET, 443)).toEqual({
			skip: expect.stringMatching(/443 already serves http:\/\/127\.0\.0\.1:9999/)
		});
		expect(planServe(running, web(8443, { '/': { Proxy: TARGET }, '/autre': { Proxy: TARGET } }), TARGET, 8443)).toHaveProperty('skip');
		expect(planServe(running, { TCP: { 8443: { TCPForward: '127.0.0.1:22' } } }, TARGET, 8443)).toHaveProperty('skip');
	});

	it('skips when Tailscale is stopped or the machine has no name', () => {
		expect(planServe({ BackendState: 'Stopped' }, {}, TARGET, 8443)).toEqual({ skip: expect.stringMatching(/not connected/) });
		expect(planServe({ BackendState: 'Running', Self: { DNSName: '' } }, {}, TARGET, 8443)).toHaveProperty('skip');
	});

	it('runs tailscale serve only when asked and needed, and never throws', () => {
		const calls: string[][] = [];
		const cli = (serve: unknown) => (args: string[]) => {
			calls.push(args);
			return args[0] === 'status' ? JSON.stringify(running) : args[1] === 'status' ? JSON.stringify(serve) : '';
		};
		expect(exposeOnTailscale({ host: '0.0.0.0', port: 3370 }, cli({}))).toHaveProperty('skip');
		expect(calls).toEqual([]);

		const config = { host: '0.0.0.0', port: 3370, tailscaleHttpsPort: 8443 };
		expect(exposeOnTailscale(config, cli({}))).toEqual({ url: `https://${NAME}:8443`, run: true });
		expect(calls.at(-1)).toEqual(['serve', '--bg', '--https=8443', TARGET]);

		calls.length = 0;
		exposeOnTailscale(config, cli(web(8443, { '/': { Proxy: TARGET } })));
		expect(calls.some((c) => c.includes('--bg'))).toBe(false);

		const missing = () => {
			throw Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' });
		};
		expect(exposeOnTailscale(config, missing)).toEqual({ skip: expect.stringMatching(/not found/) });
		const refused = () => {
			throw Object.assign(new Error('Command failed'), { stderr: 'Access denied: serve config denied\nmore' });
		};
		expect(exposeOnTailscale(config, refused)).toEqual({ skip: 'tailscale serve failed: Access denied: serve config denied' });
	});

	it('says where the app is reached', () => {
		const config = { host: '0.0.0.0', port: 3370, tailscaleHttpsPort: 8443 };
		expect(reachLines(config, { url: `https://${NAME}:8443`, run: false }, ['192.168.1.20'])).toEqual([
			'this machine  http://localhost:3370',
			'home network  http://192.168.1.20:3370',
			`Tailscale     https://${NAME}:8443`
		]);
		// Off the LAN: no home network line. Tailscale asked for but not there: why.
		expect(reachLines({ ...config, host: '127.0.0.1' }, { skip: 'Tailscale is not connected (tailscale up)' }, ['192.168.1.20'])).toEqual([
			'this machine  http://localhost:3370',
			'Tailscale     not set up — Tailscale is not connected (tailscale up)'
		]);
		// Not asked for: nothing said about it.
		expect(reachLines({ host: '0.0.0.0', port: 3370 }, { skip: 'x' }, [])).toEqual(['this machine  http://localhost:3370']);
	});
});
