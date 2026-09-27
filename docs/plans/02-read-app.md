# Plan 02 — P1, the read app

Status: ready to implement. Written 2026-09-27 for a fresh agent session.
Previous plan: `01-checker.md` (done — the checker library and `vault check` CLI).

## Context in one paragraph

RecipeVault is a self-hosted archive for a family's recipe collection (Québec
French, 500–5000 recipes, many handwritten cards decades old). A person photographs
a paper recipe, gives the photo plus the prompt from `docs/AI-TEMPLATE.md` to a chat
AI, and pastes the Markdown file it returns into the app. Plan 01 built the checker
that validates those files. This plan builds the app around it: a vault on disk, a
save path, a SQLite index, the paste box, browsing and search, the recipe page,
family pages, print view, and kitchen mode. The main users are the owner (pasting
from a desktop) and the owner's retired mother (reading and cooking on a tablet or phone).
No ingredient registry, cost, or pantry search yet (P1.5); no edit form or login
yet (P2).

## Read first

| Doc | Why |
|---|---|
| `CLAUDE.md` | privacy rule, conventions |
| `PLANNING.md` | sections Architecture, Search, Kitchen mode, Bilingual handling, What 5000 recipes changes, Phases |
| `docs/STORAGE.md` | vault layout, canonical serialization, slugs, media, Obsidian rules |
| `docs/DATA-FLOW.md` | save order, delete, stale-write guard, index schema, `vault sync`, file watcher, family diff table |
| `docs/RECIPE-SCHEMA.md` | every field you will render |
| `docs/VALIDATION.md` | codes, "Fixed by" column, fix-request block |
| `README.md`, `src/lib/vault/index.ts` | what the checker library already exports |

The docs are the source of truth. Where this plan makes a decision the docs do not
yet record (section "Decisions made for this plan"), update the doc in the same
commit. Where docs contradict each other or leave a case undefined, implement the
most conservative reading and list it in the final report.

## Privacy rule — non-negotiable

This repository is **public**. The real vault is `/home/cotions/RecipeVault-vault/`.
Never copy, quote, paraphrase, screenshot, or snapshot anything from it into this
repository: fixtures, tests, e2e snapshots, docs, commit messages. No real names,
titles, or URLs. All fixtures are invented. Screenshots you take while testing go to
`/tmp`, never into the repo. When you work against the real vault (last phase only),
report counts and codes, not content.

## Decisions made for this plan

The owner delegated these. Record each in the doc named.

1. **Hosting: home network plus Tailscale.** The app listens on the LAN; outside
   access and HTTPS come from `tailscale serve` (HTTPS is what makes Wake Lock work
   in kitchen mode). No public exposure. → `PLANNING.md` Open questions,
   `DATA-FLOW.md` Authentication.
2. **No login in P1.** LAN-only makes this acceptable for now (DATA-FLOW says so).
   Commits are attributed to `git_author` from the config. Accounts come in P2.
   The server still never serves the vault folder, `.git`, or `cache/` statically.
3. **Status on paste:** an AI file is never auto-`verified`. On save: `needs-review`
   if any `[?]`, `[?: …]` or `[illisible]` remains (W605), otherwise `draft`.
   `verified` is set only by a person, with a "Vérifié" button on the recipe page
   (a one-field edit through the normal save path, committed as `verify: <title>`).
   → replaces the status rule in `DATA-FLOW.md` Conveniences.
4. **Soft delete and trash come forward from P2** — a paste box without delete
   forces hand-editing the vault for every mistake. Delete button on the recipe
   page (with confirm), `/corbeille` lists `_trash/` with restore. → `PLANNING.md`
   Phases.
5. **UI language: French.** All UI strings in one module (`src/lib/i18n/fr.ts`)
   so English can be added later; no i18n library.
6. **Measuring the prompt replaces more manual P0 rounds.** Every paste is logged
   (codes only, never content) so real use shows which prompt rules the AI breaks.
   See Phase 3.
7. **Web import:** fetched server-side, `http`/`https` only, 10 s timeout, 5 MB cap,
   refuse hosts that resolve to private, loopback or link-local addresses. Output is
   a Markdown file placed in the paste box, `extracted_by: web` (new value — add to
   `RECIPE-SCHEMA.md` and the checker).
8. **Photos:** P1 displays `media.final` if present, but has no upload (that is the
   P2 form). No thumbnail pipeline yet: serve the original through the app, with
   `loading="lazy"`; HEIC shows a placeholder. Thumbnails arrive with upload in P2.

## Stack

- SvelteKit (already scaffolded) with **`@sveltejs/adapter-node`** (replace
  `adapter-auto`). Svelte 5 runes.
- `better-sqlite3` for the index. Synchronous, fast, FTS5 built in.
- `markdown-it` with `html: false` for bodies. The body comes from an AI or a web
  page: raw HTML in it must never reach the page. Add a small plugin for markers
  (`[?]`, `[?: …]`, `[illisible]`, `[+]` → styled spans) and wikilinks
  (`[[slug]]` → link to the recipe).
- git through `child_process.execFile('git', …)` — no git library.
- File watching with `node:fs` `watch` on the vault subfolders (flat directories;
  no chokidar needed on Linux with Node 24).
- No CSS framework. Plain CSS with custom properties; mobile first. If a
  `frontend-design` skill is available, load it before building the UI.
- Tests: vitest for server and library code, `@playwright/test` for a few
  end-to-end flows against a temporary fixture vault.
- Node-only code goes in `src/lib/server/` (SvelteKit enforces that it never
  reaches the browser). `src/lib/vault/` stays browser-safe.

## Module layout (target)

```
src/lib/server/
  config.ts        # load config: RECIPEVAULT_CONFIG, ~/.config/recipevault/config.json, ./config.json
  vault.ts         # paths, init, layout checks
  git.ts           # commit, background push with retry
  save.ts          # the one save path: serialize → write → commit → index
  trash.ts         # delete / restore
  index/
    schema.sql
    db.ts          # open, migrate (drop & rebuild on schema change — it is a cache)
    build.ts       # recipe → rows
    sync.ts        # vault sync (hash-based)
    query.ts       # browse, facets, FTS, family diff
  watcher.ts       # external edits
  webimport.ts     # URL → JSON-LD → Markdown
  pastelog.ts      # codes-only log of every paste
src/lib/vault/
  serialize.ts     # NEW, browser-safe: Recipe → canonical Markdown
src/lib/render/    # browser-safe display helpers
  fraction.ts      # 0.667 → ⅔, 1.5 → 1 ½
  temperature.ts   # °F ↔ °C
  scale.ts         # servings scaling
  markdown.ts      # markdown-it setup with the marker/wikilink plugin
  timers.ts        # find durations in step text
src/routes/        # see Phase 4–7
src/cli/vault.ts   # add: init, sync, add, reindex
```

Adjust names if something reads better; keep the server/browser split.

## Config

```json
{
  "vault_directory": "/home/cotions/RecipeVault-vault",
  "port": 3370,
  "host": "0.0.0.0",
  "git_author": { "name": "Cotions", "email": "…" },
  "git_push": true
}
```

Lookup order: `RECIPEVAULT_CONFIG`, then `~/.config/recipevault/config.json`, then
`config.json` at the repo root (gitignored). `RECIPEVAULT_PORT` overrides the port.
A missing or non-existent `vault_directory` is a startup error with a clear message —
never create an empty vault silently (`PLANNING.md` explains why). `vault init` is
the only thing that creates one.

## Phases

Commit at the end of each phase (conventional commits). Tests green before each.

### Phase 1 — vault, serializer, save path (no UI)

1. **`vault init <dir>`**: creates the layout from `STORAGE.md` (`recipes/`,
   `ingredients/`, `vocab/`, `media/`, `_trash/`, `cache/`), writes the vault
   `.gitignore` (`media/`, `cache/`, `inbox/`, `.obsidian/workspace*.json`), seeds
   `vocab/` from `docs/VOCAB.md` (units, tags, families — as YAML), runs `git init`,
   makes the first commit. Refuses a non-empty directory unless it only contains
   `inbox/`.
2. **Canonical serializer** `serialize(recipe): string` in `src/lib/vault/`. Fixed
   key order following the `RECIPE-SCHEMA.md` example; ingredient items in flow
   style (`- { qty: 2, unit: cup, name: farine }`) as in the schema; quote any
   string YAML could misread (markers, `no`, `1:30`, leading `[`, `:`, `#`); NFC,
   LF, trailing newline; body headings in the recipe's `lang`.
   **Round-trip property:** for every valid fixture, `parse(serialize(parse(x)))`
   deep-equals `parse(x)`, and `serialize` is idempotent. This test is the guard for
   the promise that a save never changes meaning.
3. **Save path** `save(files, { author, overwrite? })`, exactly the order in
   `DATA-FLOW.md`: check (with the vault's existing entries, so E103/W306/W608 work)
   → refuse on any error → set `status`/`added`/`updated` (decision 3; strip pasted
   `status`/`added` per E112) → serialize → write `recipes/<slug>.md` atomically
   (temp file + rename) → `git add` + commit (`add: <title>` / `edit: <title>`) →
   index upsert → push in background (non-blocking, retried on next save; failure
   logged, never surfaced as a save failure). Several files in one paste → one
   commit.
4. **Slug collision (E103)**: the save path returns the collision instead of
   failing blindly; the caller chooses `overwrite` or the suffixed slug the checker
   proposes. Overwrite is an edit: stale-write guard from `DATA-FLOW.md` applies.
5. **Trash**: `remove(slug)` moves the file and `media/<slug>/` into `_trash/`,
   commits `delete: <title>`, drops index rows. `restore(slug)` reverses it (refuse
   if the slug is taken again).
6. CLI: `vault add <file…>` (the save path from the terminal — handy for tests and
   for the inbox), `vault init`.

Tests: temp vault per test (`mkdtemp`, `git init`, fixed git author env), assert on
files, commit messages, and index rows. Failure injection: make the index write
throw and check that the file and commit exist and a later sync recovers.

### Phase 2 — index and sync

1. SQLite at `<vault>/cache/index.db`, schema from `DATA-FLOW.md`, adapted where the
   structured ingredients need it: one row per ingredient item with `group_name`,
   `qty`, `qty_max`, `unit`, `name`, `optional`, `recipe` (sub-recipe slug); `item` =
   normalized name for now (lowercase, NFC, no accents) — real resolution is P1.5.
   Store a `schema_version` pragma; on mismatch drop and rebuild (it is a cache).
2. FTS5: `unicode61 remove_diacritics 2`, over title, body, ingredient names, author,
   tags. Use an external-content or regular FTS table keyed by an integer rowid of
   `recipes` — note that a contentless table (`content=''`) as sketched in
   DATA-FLOW cannot return columns; pick what works and update the doc.
   Prefix queries (`lasag*`) so search-as-you-type works.
3. **`vault sync [--force]`**: hash-based, as in `DATA-FLOW.md`. Files that no longer
   parse keep their last good rows and are listed with their codes. Run at server
   start.
4. **Watcher** (`DATA-FLOW.md` File watcher): debounce ~1 s, ignore the app's own
   writes by hash, commit external edits as `edit (external): <title>`, never
   commit or de-index a file that stops parsing — flag it instead (the UI shows a
   banner on that recipe with the codes).
5. Queries: browse with sort (title, added, updated, total time, rating) and
   pagination; facets with counts (family, tags, season, source type, author,
   status, time buckets, servings); FTS search combined with facets; family diff
   table (ingredients unique to each variant, common ones collapsed, differing
   times/servings/rating).
6. **Scale fixture**: `scripts/gen-vault.ts` writes N invented recipes (random
   combinations of invented titles, families, ingredients, tags) into a temp
   vault. Targets at N=5000, on this machine: full `sync --force` < 30 s, no-op
   sync < 3 s, FTS query < 20 ms, browse page < 50 ms. Record the measured numbers
   in the final report.

### Phase 3 — the paste box (`/ajouter`)

The owner's main tool; built for speed (`PLANNING.md`, "Paste speed matters").

- Large textarea, focused on load. Live validation in the browser with the
  checker library on every change (debounced): the list of files found, each with
  title, pass/fail, diagnostics grouped by severity, paths shown.
- A **preview** of each valid file rendered exactly like the recipe page.
- **Save** (`Ctrl+Enter`): posts to the server, which re-runs the checks with vault
  context (E103, W306, W608 need the vault) — never trust the browser's result.
  After a save: toast with links to the saved recipes, box cleared and refocused.
- **Collisions (E103)**: inline choice per file — "Remplacer" or "Enregistrer comme
  `<slug>-2`". W608 (same title): inline offer to put both in a family (sets
  `family`/`variant` on the new file only; the existing file is untouched in P1).
- **Invalid**: one button copies the fix-request block (`renderFixBlock`, which
  already keeps only `ai` codes). `app` codes are shown to the person, not copied.
- **Prompt**: a "Copier le prompt" button (the prompt from `docs/AI-TEMPLATE.md`,
  embedded at build time — the CLI's `vault prompt` already extracts it; share that
  code).
- **Web import** field above the textarea: paste a URL → server fetches (decision
  7) → JSON-LD `Recipe` mapped to the schema → the Markdown lands in the textarea for
  review, never saved directly. Ingredient strings are parsed with the existing
  quantity/unit parser; a line that does not parse becomes an ingredient whose
  `name` is the whole line plus `[?]`, so the checker flags it for review instead of
  losing it. No JSON-LD → message suggesting the AI path.
- **Paste log** (decision 6): each save attempt appends one JSON line to
  `<vault>/cache/paste-log.jsonl`: time, number of files, per file the list of codes
  (no titles, no content), outcome (`saved`, `rejected`, `fixed-after-N-attempts`
  when the same slug is saved after rejections). `vault stats` prints the code
  frequency over the log, with the fixer per code, sorted — the same summary as
  `vault check --dir`. Losing it is fine (it is in `cache/`).

### Phase 4 — browse and search (`/`)

- Mobile-first list of recipe cards: title, family/variant, total time, servings,
  status badge (`needs-review` visible, `draft` subtle), photo if any.
- Search box at the top: FTS, results update as you type, diacritics-insensitive.
- Filters: family, tags, season, time, source/author, status. On phone a filter
  sheet; on desktop a sidebar. Counts per facet value.
- Sort menu. Pagination or infinite scroll with a page size (never 5000 cards).
- State in the URL (`?q=&tag=&sort=&page=`) so a filtered view can be bookmarked
  and the back button works.
- `/familles` lists families with variant counts; `/famille/[slug]` shows the
  variants and the diff table.

### Phase 5 — recipe page (`/r/[slug]`)

- Title, photo, source line (author, book + page, or link), times, servings,
  oven (`350 °F · 180 °C`), tags, status.
- **Servings adjuster** rescaling every quantity (ranges too, `qty_max`).
- Ingredients grouped; `optional` groups marked; `alt`, `or`, `to_taste`, `brand`,
  `note`, `prep` rendered naturally in French (`2 tasses de farine tamisée`, not a
  table of fields). Units displayed in the recipe's language with Québec words
  (`tasse`, `c. à thé`, `c. à table`, `lb`). Fractions as fractions (`⅔`, `1 ½`).
- Sub-recipe ingredients (`recipe:`) link to that recipe; `buy_instead` shown as
  "ou acheter : …".
- Body sections (method, notes, variants, alternatives) via the markdown renderer.
  Markers visibly styled: `[?]` highlighted, `[+]` in a distinct style with a
  legend. Wikilinks resolve to recipe links (dead ones shown as plain text).
- Actions: Cuisiner (kitchen mode), Imprimer, Vérifié (decision 3), Supprimer
  (decision 4), and "Voir le fichier" showing the raw Markdown (read-only in P1;
  copyable, so an edit can round-trip through an AI and the paste box with
  "Remplacer").
- Other variants of the same family listed at the bottom.
- **Print view**: `@media print` stylesheet on the same page — one column, no
  navigation or buttons, ingredients and method on one page when they fit, source
  line kept, the scaled quantities if the servings were changed.
- A recipe whose file currently fails to parse (watcher) shows a banner with the
  codes.

### Phase 6 — kitchen mode (`/r/[slug]/cuisine`)

Implement every bullet of `PLANNING.md` → Kitchen mode. Notes:

- Wake Lock: request on open and again on `visibilitychange`; if unsupported (plain
  HTTP), show a small one-time notice saying the screen may lock and HTTPS via
  Tailscale fixes it.
- Step ingredients: match ingredient names (accent- and case-insensitive, singular
  and plural) in the step text; best effort, a miss shows nothing.
- Timers: durations in step text (`25 min`, `1 h 30`, `45-50 minutes`, `1 heure`)
  become buttons (a range uses its upper bound, labelled). Several at once, labelled
  with the step, pinned on top, alarm with sound + vibration, keep running when
  changing steps. Store end timestamps, not countdowns, so a reload or a sleeping
  tab stays correct.
- Resume: current step, ticks, servings, and timers in `localStorage` per slug.
- Offline: a SvelteKit service worker caching the app shell plus each recipe
  opened in kitchen mode (its data and photo).
- Sub-recipes expandable inline.
- Test on a phone-sized viewport (Playwright device emulation) and at tablet size;
  tap zones must work with a thumb (left half back, right half next, swipe).

### Phase 7 — deploy and the real vault

1. `npm run build` + `node build` with adapter-node; the config's host/port.
2. A systemd **user** unit example in `docs/DEPLOY.md` (`deploy/recipevault.service`),
   plus the `tailscale serve --bg https / http://localhost:3370` line and a note on
   backups (restic, from `STORAGE.md`). Do not install services or run tailscale —
   document them; the owner runs them.
3. Real vault — the only phase that touches it:
   - write `~/.config/recipevault/config.json` pointing at
     `/home/cotions/RecipeVault-vault` (git author: the repo's git user);
   - `vault init /home/cotions/RecipeVault-vault` (keeps `inbox/`, which the vault
     `.gitignore` excludes);
   - add the remote `git@github.com:Cotions/RecipeVault-recipes.git` (private,
     already created, empty) — check with `gh repo view` that it is private
     before the first push; if it is not private, stop and report;
   - `vault add` the `inbox/*-v2.md` files; files that fail stay in the inbox and are
     reported by code; the v1 files (older template) are not imported;
   - `vault sync`, start the app, open it once to confirm the recipes appear.
   Report counts and codes only.
4. Update `README.md` (run, config, CLI commands) and `PLANNING.md` (phase status,
   the decisions above).

## Testing summary

- Unit: serializer round-trip, render helpers (fractions, °F/°C, scaling, timer
  detection, markers), config lookup, web-import mapping (invented JSON-LD
  fixtures), save path with failure injection, trash, sync, watcher (use a short
  debounce in tests), queries including accent-insensitive search.
- Invented fixture vault: extend `tests/fixtures/vault/` to ~20 recipes covering a
  family with 3+ variants, a sub-recipe chain, English and French recipes, markers,
  an optional group, ranges, °F oven, a recipe with a photo (a tiny generated JPEG).
- E2E (Playwright, temp copy of the fixture vault, own port): paste valid → saved
  and visible in search; paste invalid → fix block copied; collision → suffix;
  delete → trash → restore; kitchen mode step navigation, timer, resume after
  reload.
- `npm run check` (svelte-check) clean.

## Done when

- `vault init`, `add`, `sync`, `stats` work; the server starts on the config's port.
- Paste → save → search → recipe page → kitchen mode works end to end in e2e.
- Every save is one git commit in the vault; the app repo never changes at runtime.
- Deleting `cache/` and restarting loses nothing.
- Scale targets met or measured and reported.
- Real vault initialized and pushed, v2 inbox files imported (counts reported).
- Docs updated for every decision above; `svelte-check` and all tests green.

## Final report

1. What was built, per phase, with commit hashes.
2. Scale numbers at 5000 recipes.
3. Real vault: files imported / rejected, by code (no content).
4. Doc contradictions or undefined cases found, each with a proposed doc change.
5. Anything deferred, and why.

## Out of scope

Ingredient registry, name resolution, cost, pantry search (P1.5). Edit form, photo
upload, thumbnails, accounts and login (P2). Shopping list, meal planner, cook log,
cookbook export (P3).
