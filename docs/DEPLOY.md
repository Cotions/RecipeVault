# Deploy — running RecipeVault at home

Decided in plan 02: the app runs on a machine on the home network, listens on
the LAN, and is reached from outside **only through Tailscale**. No port is
opened to the internet. Anyone who can reach the app can read; every change
needs an account (plan 04), which makes edits and deletes attributable and
guards against accidents — the network stays the real boundary. See
`DATA-FLOW.md`, "Authentication".

## 1. Config

`~/.config/recipevault/config.json`:

```json
{
  "vault_directory": "/home/you/RecipeVault-vault",
  "port": 3370,
  "host": "0.0.0.0",
  "git_author": { "name": "Your Name", "email": "you@example.com" },
  "git_push": true,
  "hosts": ["recettes.maison.lan"],
  "currency": "CAD",
  "locale": "fr-CA",
  "shops": ["Épicerie du coin"]
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

`currency` (default `"CAD"`) is the currency of the prices used for cost: a
`prices.csv` row in another currency is shown but never costed. `locale`
(default `"fr-CA"`) formats money (`0,89 $`). `shops` (optional) are shop names
suggested when entering a price, after the shops already in `prices.csv`
(plan 03, decision 2: none of this is in the code).

`host: "127.0.0.1"` keeps the app off the LAN entirely, reachable only through
Tailscale (step 4) — the stricter choice.

### Accounts

One per person, created on the server by the owner (nobody signs up in the app):

```sh
npx vault user add moi --name "Votre Nom" --email you@example.com --markdown
npx vault user add maman --name "Son Nom"       # the password is asked twice, never an argument
npx vault user list
npx vault user passwd maman                     # also signs her out on every device
npx vault user remove maman
```

They go to `users.json` next to the config file (mode 0600; never in the vault,
which is pushed to GitHub). `name` and `email` are the git author of that
person's saves (no email: `<login>@recipevault.invalid`). `--markdown` shows
the paste box, "Voir le fichier" and the resolve queue. Without any account the
app still serves every page, but nobody can save (it says so at startup).

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

**Sign-in cookies over LAN HTTP and Tailscale HTTPS.** `tailscale serve`
terminates TLS and forwards to the app with the original `Host` (the
`*.ts.net` name), `X-Forwarded-Proto: https`, `X-Forwarded-Host` and
`X-Forwarded-For: <tailnet address of the device>` (checked in Tailscale's
source, `ipn/ipnlocal/serve.go`, `addProxyForwardedHeaders`: the proto header is
set only when the incoming connection is TLS, and the Go reverse proxy drops any
`X-Forwarded-*` the client sent). The app marks the session cookie `Secure`
exactly when `X-Forwarded-Proto` is `https`, so the same install works both
ways: over `https://<machine>.<tailnet>.ts.net` the cookie is `Secure`; over
`http://<lan-host>:3370` it is not (a `Secure` cookie would never be stored
over HTTP, and signing in would silently fail). A LAN client that forges the
header only gets a cookie its own browser refuses. The two names are two
sites to the browser: sign in once on each. The password crosses the LAN in
clear over plain HTTP — prefer the Tailscale name on devices that have
Tailscale.

The throttle on failed sign-ins counts per address; behind `tailscale serve`
the socket address is always loopback, so the app takes the device's address
from `X-Forwarded-For`, and believes that header only from loopback. Don't put
another proxy in front without checking what it forwards.

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

Deleting `cache/` loses nothing but sign-ins: the next start rebuilds the
index. `users.json` (next to the config) is not in the vault: back it up with
the config, or recreate the accounts with `vault user add`.
