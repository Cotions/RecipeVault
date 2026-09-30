# RecipeVault

Self-hosted family recipe archive. Recipes are Markdown files with YAML
frontmatter in a private vault folder; this repository holds only the app, the
docs, and invented test fixtures. Start with `PLANNING.md`; the file format and
its rules are in `docs/`.

## Setup

```sh
npm install
npm test               # unit and server tests (vitest)
npm run check          # svelte-check
npm run test:e2e       # Playwright, against a throwaway copy of the fixture vault
```

## Running the app

1. Create a vault (the only way one is created — a missing vault is a startup
   error, never an empty new one):

   ```sh
   npx vault init ~/RecipeVault-vault
   ```

2. Config at `~/.config/recipevault/config.json` (or `RECIPEVAULT_CONFIG`, or
   `config.json` at the repo root, gitignored):

   ```json
   {
     "vault_directory": "/home/you/RecipeVault-vault",
     "port": 3370,
     "host": "0.0.0.0",
     "git_author": { "name": "You", "email": "you@example.com" },
     "git_push": true,
     "currency": "CAD",
     "locale": "fr-CA",
     "shops": []
   }
   ```

   `RECIPEVAULT_PORT` overrides the port. `currency` (default `CAD`) is the
   currency prices are costed in, `locale` (default `fr-CA`) formats money, and
   `shops` adds shop names to the ones suggested when entering a price. See
   `docs/DEPLOY.md`.

3. Accounts (next to the config, in `users.json`; never in the vault). Reading
   needs none; every change does, and is committed under that person's name:

   ```sh
   npx vault user add moi --name "Votre Nom" --email you@example.com --markdown
   npx vault user add maman --name "Son Nom"
   ```

   `--markdown` shows that person the paste box, "Voir le fichier", the
   resolve queue and the pending tags, besides the form every account has.

4. Run:

   ```sh
   npm run build && npm start      # production (bin/serve.js)
   npm run dev                     # development
   ```

To try it on invented data instead of a real vault:

```sh
npx tsx scripts/fixture-vault.ts /tmp/rv-demo 3399
RECIPEVAULT_CONFIG=/tmp/rv-demo/config.json npm run dev
```

It comes with two invented accounts (printed on creation): `proprio` /
`proprio-mot-de-passe` (with the Markdown tools) and `cuisine` /
`cuisine-mot-de-passe`.

`--corpus` builds it from the invented card corpus instead (320 recipes, the
seed ingredient registry and invented prices): realistic data for the resolve
queue, the ingredient pages and pantry search.

```sh
npx tsx scripts/fixture-vault.ts /tmp/rv-corpus 3399 --corpus
```

Service, Tailscale and backups: `docs/DEPLOY.md`.

## Pages

| Path | What |
|---|---|
| `/` | browse and search: facets, sort, pagination; state in the URL |
| `/r/<slug>` | a recipe: servings adjuster (the amount in the address, `?portions=` / `?fois=`; a free factor; tap an amount to scale by what you have), cost line with coverage, ingredient links, print view, Vérifié, Modifier, Historique, Supprimer, "Ajouter une photo", the raw file |
| `/nouvelle`, `/r/<slug>/modifier` | the recipe form (signed in): ingredient and step rows, family picker, tags, source, times, photo; drafts kept in the browser, Annuler after a save |
| `/r/<slug>/historique` | every version of a recipe, what changed in plain French, "Revenir à cette version" |
| `/r/<slug>/cuisine` | kitchen mode: screen kept on, checklist, one step at a time, timers, offline; scaled amounts in the steps and sub-recipes at the amount the line needs |
| `/familles`, `/famille/<slug>` | families and the variant diff table |
| `/ingredients` | the ingredient registry with current prices; inline price entry, sorted by what to price first |
| `/ingredients/<slug>` | one ingredient: names, prices and their history, the recipes using it by quantity, substitutes, drifting names; edit and "Fusionner dans…" |
| `/resoudre` | the resolve queue: ingredient names not linked to the registry, most frequent first; link, create, remove an alias, add a rule |
| `/garde-manger` | pantry search: what can I make with what I have — ready, with a substitution, almost, ideas |
| `/ajouter` | the paste box: live checks, fix-request block, web import |
| `/etiquettes` | pending tags: make one a new tag with its label, map it to an existing tag, or remove it |
| `/doublons` | possible duplicates (nearly the same ingredients): two versions of one recipe, the same recipe (one to the trash), or different recipes |
| `/doublons/comparer?a=…&b=…` | two recipes side by side, every field where they differ |
| `/corbeille` | the trash, with restore |
| `/connexion` | sign in ("Rester connectée" by default: a year, renewed on use); sign out from the header |

## The `vault` command

```sh
npx vault init <dir>                  # create a vault: layout, vocab and ingredient seed, git
npx vault ingredients seed            # add the seed ingredients and vocab files a vault lacks (never overwrites)
npx vault add <file…>                 # save files through the app's save path (one commit)
npx vault sync [--force]              # bring the index in line with the files
npx vault reindex                     # delete the index and rebuild it
npx vault stats                       # code frequency over the paste log
npx vault queue [--limit N]           # ingredient names not linked to the registry, most frequent first
npx vault user add <login> --name "<Nom>" [--email …] [--markdown]   # password asked twice, never an argument
npx vault user passwd <login>         # new password; signs that account out everywhere
npx vault user remove <login>         # delete the account, end its sessions
npx vault user list                   # logins and names
npx vault check recipe.md other.md    # check files
npx vault check - < answer.txt        # a whole AI answer: every ```markdown fence is a file
npx vault check --dir inbox/          # every .md in a folder, with a summary by code
npx vault check --dir ~/vault         # a vault: its recipes, its ingredient files, stale lines of vocab/distinct.yaml
npx vault check --vault ~/vault new.md
npx vault check --fix-block bad.md    # the block to paste back into the AI chat
npx vault check --json recipe.md
npx vault prompt | xclip -sel clip    # copy the AI prompt from docs/AI-TEMPLATE.md
```

`add`, `sync`, `reindex`, `stats`, `ingredients` and `queue` use the config's vault, or `--vault <dir>`.
`check` exit codes: 0 no errors (warnings allowed), 1 at least one error, 2 a
usage or IO failure. `npm run vault -- …` works too.

`scripts/gen-vault.ts [N] --bench` writes N invented recipes, a registry of
1000 invented ingredients and 3000 price rows into a temporary vault, and times
sync, search, browse, resolution, the resolve queue, the ingredient pages, cost,
pantry search and price entry; then grows the vault's history to ~20 000
commits (`git fast-import`) and times the write path: the form, its saves,
undo and restore, the history page, a 12 MP photo, `/etiquettes`, sign-in and
the session lookup; last, scaling (a 60-line recipe, 30 steps, the corpus
sweep, the page loads) and duplicates (the model, `W505`'s check, `/doublons`
and its three writes), with ~50 planted duplicate copies and 20 families of
close variants (the figures are in `docs/DATA-FLOW.md`).

## Layout

- `src/lib/vault/` — the checker, parser and serializer; browser-safe (the
  paste box runs it live)
- `src/lib/ingredients/` — the registry format, name resolution, unit
  conversion, cost and pantry tiers; browser-safe, no regional word in code
- `src/lib/render/` — display helpers (fractions, units, °F/°C, markdown, timers); browser-safe
- `src/lib/form/` — the form model: recipe ↔ rows, quantities, durations,
  steps, markers, hints, drafts; browser-safe
- `src/lib/server/` — Node-only: config, save path and the form's save, git,
  index, watcher, web import, the registry and prices on disk, the resolve
  queue, accounts and sessions, photos, history and undo, pending tags
- `src/routes/` — the pages; `src/cli/vault.ts` — the command

To run the checker over the private test corpus (prints codes and counts only):

```sh
RECIPEVAULT_CORPUS=/path/to/vault/inbox npm run test:corpus
```
