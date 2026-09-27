# Deploy — running RecipeVault at home

Decided in plan 02: the app runs on a machine on the home network, listens on
the LAN, and is reached from outside **only through Tailscale**. No port is
opened to the internet. There is no login in P1 (accounts come in P2): anyone
who can reach the app can read and write, which is acceptable only because the
network is the boundary. See `DATA-FLOW.md`, "Authentication".

## 1. Config

`~/.config/recipevault/config.json`:

```json
{
  "vault_directory": "/home/you/RecipeVault-vault",
  "port": 3370,
  "host": "0.0.0.0",
  "git_author": { "name": "Your Name", "email": "you@example.com" },
  "git_push": true,
  "hosts": ["recettes.maison.lan"]
}
```

Lookup order: `RECIPEVAULT_CONFIG`, then `~/.config/recipevault/config.json`,
then `config.json` at the repository root (gitignored). `RECIPEVAULT_PORT`
overrides the port. A missing `vault_directory` is a startup error: create a
vault with `npx vault init <dir>`, never by hand.

`hosts` (optional) lists extra names the app is reached by. Every request must
name, in its `Host` header, one the app knows — a guard against DNS rebinding,
where a web page re-points its own name at the LAN address to read and write
the vault. Always accepted without configuration: `localhost`, any IP address
(`http://192.168.1.20:3370`), the machine's host name and `<hostname>.local`,
and any Tailscale `*.ts.net` name. Anything else — a router DNS name, a
`/etc/hosts` alias — goes in `hosts`, exactly or as `*.maison.lan`; otherwise
the page answers `421 Unknown host`.

`host: "127.0.0.1"` keeps the app off the LAN entirely, reachable only through
Tailscale (step 4) — the stricter choice.

## 2. Build and run

```sh
npm ci
npm run build
npm start            # node bin/serve.js: the config's host and port
```

At startup the app syncs the index with the files (`vault sync`), starts the
file watcher, and retries any pending `git push`. The vault folder, its `.git`
and `cache/` are never served; photos go through `/media/…` only.

## 3. As a service

`deploy/recipevault.service` is a systemd **user** unit:

```sh
cp deploy/recipevault.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now recipevault
loginctl enable-linger "$USER"
journalctl --user -u recipevault -f     # logs
```

After an app update: `git pull && npm ci && npm run build && systemctl --user restart recipevault`.
Updating the app never touches the vault.

## 4. Outside access and HTTPS: Tailscale

```sh
tailscale serve --bg https / http://localhost:3370
```

This gives the app an HTTPS name on the tailnet (`https://<machine>.<tailnet>.ts.net`).
HTTPS is what makes the Wake Lock API work, so kitchen mode keeps the screen on;
over plain `http://` on the LAN the screen may lock (kitchen mode says so once).
Install Tailscale on the phone and tablet used in the kitchen.

The app accepts writes from pages served by the same host it is reached on, so
both `http://<lan-host>:3370` and the Tailscale name work — as long as the name
is one of the allowed hosts (step 1).

## 5. Backups

Git is history, not a backup (`STORAGE.md`, `PLANNING.md` "Backup"):

- every save is committed in the vault and pushed in the background to the
  private GitHub repository — the offsite copy of all text;
- dish photos (`media/`) are not in git: back the whole vault folder up with
  `restic` (excluding `cache/`), to a local disk and one offsite target, and test
  a restore now and then.

```sh
restic -r /mnt/backup/recipevault backup ~/RecipeVault-vault --exclude ~/RecipeVault-vault/cache
```

Deleting `cache/` loses nothing: the next start rebuilds the index.
