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
     "git_push": true
   }
   ```

   `RECIPEVAULT_PORT` overrides the port.

3. Run:

   ```sh
   npm run build && npm start      # production (bin/serve.js)
   npm run dev                     # development
   ```

To try it on invented data instead of a real vault:

```sh
npx tsx scripts/fixture-vault.ts /tmp/rv-demo 3399
RECIPEVAULT_CONFIG=/tmp/rv-demo/config.json npm run dev
```

Service, Tailscale and backups: `docs/DEPLOY.md`.

## Pages

| Path | What |
|---|---|
| `/` | browse and search: facets, sort, pagination; state in the URL |
| `/r/<slug>` | a recipe: servings adjuster, print view, Vérifié, Supprimer, the raw file |
| `/r/<slug>/cuisine` | kitchen mode: screen kept on, checklist, one step at a time, timers, offline |
| `/familles`, `/famille/<slug>` | families and the variant diff table |
| `/ingredients` | the ingredient registry with current prices; inline price entry, sorted by what to price first |
| `/resoudre` | ingredient names not linked to the registry, most frequent first |
| `/ajouter` | the paste box: live checks, fix-request block, web import |
| `/corbeille` | the trash, with restore |

## The `vault` command

```sh
npx vault init <dir>                  # create a vault: layout, vocab and ingredient seed, git
npx vault ingredients seed            # add the seed ingredients a vault lacks (never overwrites)
npx vault add <file…>                 # save files through the app's save path (one commit)
npx vault sync [--force]              # bring the index in line with the files
npx vault reindex                     # delete the index and rebuild it
npx vault stats                       # code frequency over the paste log
npx vault queue [--limit N]           # ingredient names not linked to the registry, most frequent first
npx vault check recipe.md other.md    # check files
npx vault check - < answer.txt        # a whole AI answer: every ```markdown fence is a file
npx vault check --dir inbox/          # every .md in a folder, with a summary by code
npx vault check --dir ~/vault         # a vault: its recipes and its ingredient files
npx vault check --vault ~/vault new.md
npx vault check --fix-block bad.md    # the block to paste back into the AI chat
npx vault check --json recipe.md
npx vault prompt | xclip -sel clip    # copy the AI prompt from docs/AI-TEMPLATE.md
```

`add`, `sync`, `reindex`, `stats` and `ingredients` use the config's vault, or `--vault <dir>`.
`check` exit codes: 0 no errors (warnings allowed), 1 at least one error, 2 a
usage or IO failure. `npm run vault -- …` works too.

`scripts/gen-vault.ts [N] --bench` writes N invented recipes into a temporary
vault and times sync, search and browse.

## Layout

- `src/lib/vault/` — the checker, parser and serializer; browser-safe (the
  paste box runs it live)
- `src/lib/render/` — display helpers (fractions, units, °F/°C, markdown, timers); browser-safe
- `src/lib/server/` — Node-only: config, save path, git, index, watcher, web import
- `src/routes/` — the pages; `src/cli/vault.ts` — the command

To run the checker over the private test corpus (prints codes and counts only):

```sh
RECIPEVAULT_CORPUS=/path/to/vault/inbox npm run test:corpus
```
