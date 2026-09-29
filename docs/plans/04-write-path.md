# Plan 04 — P2, her write path

Status: **built** (Phases 0–9, 2026-09-28; the final report is at the end of
"Final report"). Written 2026-09-28 for a fresh agent session; the open
questions were decided the same day (recommended options).
Previous plans: `02-read-app.md` (done: vault, save path, index, paste box,
browse, recipe page, kitchen mode, trash), `03-ingredients.md` (done: registry,
resolution and queue, prices, cost, pantry search).

## Context in one paragraph

RecipeVault is a self-hosted archive of a family's recipe collection (500–5000
recipes, mostly old handwritten Québec cards). Two people use it
(`PLANNING.md`, Goal): the owner, who bulk-adds recipes by pasting Markdown from
a chat AI, and his retired mother — "her" in every doc — a non-technical cook
who browses, cooks from a tablet or phone, and **adds and edits her own
recipes, never seeing Markdown**. Until now every write goes through the paste
box, a Markdown tool. This plan builds her path (`PLANNING.md`, P2): a form with
repeatable ingredient and step rows, a family picker showing existing families,
photo upload from a phone, undo through the vault's git history, and accounts so
that every commit says who made it. The form is not a second writer: it builds
a recipe object, serializes it to the canonical Markdown, and enters the exact
save path a paste does (`DATA-FLOW.md`, "Two inputs, one save path"), so it can
never produce a file the parser cannot read. The app stays on the home network
plus Tailscale; accounts are attribution and a guard against accidents, not the
only wall between the vault and the internet (`DATA-FLOW.md`, Authentication).

## Read first

| Doc | Why |
|---|---|
| `CLAUDE.md` | privacy rule, conventions |
| `PLANNING.md` | Goal (two users), Architecture, Kitchen mode, "What 5000 recipes changes" (images), P2, open questions 4 and 5, Gaps review Tier 2 |
| `docs/DATA-FLOW.md` | **the spec for the save path**: "Two inputs, one save path", "SAVE, in order" (step 5 is thumbnails), Delete, Concurrent edit, Validation → Conveniences and "Her form never shows a raw error", Authentication |
| `docs/STORAGE.md` | canonical serialization, slugs are permanent, media (originals untouched, derived copies in `cache/img/`, EXIF rotation on copies), "Accounts are not vault data" (`users.json`, sessions), Obsidian rules |
| `docs/RECIPE-SCHEMA.md` | every field the form edits; markers ("Clearing a `[?]` in the app … removes the marker"); body sections and step rules |
| `docs/VALIDATION.md` | "Fixed by" (`ai` / `app`), "Human-facing validation" (the form prevents states structurally) |
| `docs/VOCAB.md` | tags (pending), families (the picker, drift warning, labels), units, seasons |
| `docs/INGREDIENTS.md` | Resolution (names the form can suggest; `item:` "or, later, the P2 form") |
| `docs/DEPLOY.md` | LAN + Tailscale, `hosts` allowlist, HTTP on the LAN vs HTTPS on the tailnet |
| `docs/plans/02-read-app.md`, `03-ingredients.md` | conventions this plan follows |

The docs are the source of truth. Each behaviour below names the doc line it
comes from (→ `DOC` §section). Where the docs are silent or contradict each
other, the behaviour is an open question (Qn) at the end. **Do not start a phase
until the questions it depends on are answered.** Record each answer in the doc
named in that question, in the same commit as the code.

## Privacy rule — non-negotiable

This repository is **public**. Never read, copy, quote or paraphrase anything
from `/home/cotions/RecipeVault-vault/` or `~/.config/recipevault/` (the real
config and, after this plan, the real `users.json`). This plan has no real-vault
phase: the owner creates the real accounts himself (`vault user add`). All
fixtures are invented: recipes (`tests/fixtures/vault`, the 320-card corpus in
`tests/fixtures/corpus`), test accounts and passwords, test photos (generated
in the test, never a real picture). Screenshots go to `/tmp`.

## Decisions given by the owner

1. **Nothing regional is hard-coded.** Regional adaptation belongs in data
   (`vocab/`, the registry, the config) or in the AI template, never in app
   code (→ plan 03, decision 1). For this plan: no default that is Québec
   knowledge lives in code. The oven unit the form starts on, the unit list's
   order, the suggested ingredient names come from the vault's data (the units
   and oven units most used in its recipes, the registry and vocab files).
2. **UI in Québécois French.** Every string in `src/lib/i18n/fr.ts`; French
   texts of diagnostics in `src/lib/i18n/diagnostics.ts` (→ plan 02,
   decision 5; plan 03, decision 4).
3. **Review policy.** One review per piece of work, at the end; no re-review
   after the fixes; anything left over goes to GitHub issues.
4. **Hosting: LAN + Tailscale, no public exposure** (→ `DEPLOY.md`;
   `PLANNING.md` open question 1). Auth is designed for that setting, not for
   the internet-reachable case of `DATA-FLOW.md` §Authentication.
5. **Build now, test on invented data.** The invented corpus
   (`tests/fixtures/corpus`, 320 recipes) and the fixture vault stand in for
   the real vault; nothing waits on real data.

## What the form must guarantee (from the docs)

These are not open; each is a doc line, and a test.

- **One save path.** Form → recipe object → `serialize` → the same check and
  save as a paste (→ `DATA-FLOW.md` §Two inputs; `PLANNING.md` Architecture:
  "No second code path to keep in sync").
- **No Markdown anywhere** (→ `PLANNING.md` Goal, P2). She never sees
  frontmatter, fences, headings, `1.` numbering, or marker syntax typed by hand.
- **No raw error, invalid states prevented structurally** (→ `DATA-FLOW.md`
  §Validation: "required fields marked, ingredient rows added by a button,
  family chosen from a picker, tags from an autocomplete over the vocabulary";
  `VALIDATION.md` §Human-facing validation: separate `qty`, `unit`, `name`,
  `note`, `prep` inputs, so `E210`/`E211` cannot be expressed). Concretely:
  - a unit is chosen from the canonical list (E201 impossible); choosing a
    quantity makes the unit required and vice versa (E202/E203); *au goût*
    disables the amount (E206); a range's upper bound must exceed the lower
    (E205);
  - title required (E101); at least one ingredient row with a name before
    Save is enabled (E200, E207);
  - family and variant both or neither (E105): picking a family makes the
    variant field required;
  - numbers from number inputs (E107, E108, E111); durations from hour/minute
    inputs (E109); the source type from a list (E106); a URL field that only
    accepts `http(s)://` (E114);
  - two rows with the same name in one group are merged or flagged inline before
    save (E209); the sub-recipe picker never offers a recipe that already uses
    this one (E213);
  - `schema`, `slug`, `lang`, `status`, `added`, `updated`, `extracted_by` are
    set by the app, never typed (→ `DATA-FLOW.md` §Conveniences; E102, E104,
    E110, E112).
  Any error the server check still returns is a bug in the form: logged with
  its code, shown to her as one plain sentence ("La recette n'a pas pu être
  enregistrée ; rien n'a changé.") with the owner-facing detail in the server
  log, never the code.
- **Slugs are permanent** (→ `STORAGE.md` §Slugs): a new recipe's slug is
  derived from the title once; changing the title later never changes the slug.
- **Every edit is hash-guarded** (→ `DATA-FLOW.md` §Concurrent edit): the form
  carries the hash of the file it was opened from.
- **Every save is one commit, attributed to the person who saved it**
  (→ `DATA-FLOW.md` §SAVE step 3: "author tagged with whoever saved it").
- **Photos: originals untouched, derived copies in `cache/img/`, EXIF rotation
  on the copies, thumbnails on upload, lazy loaded** (→ `STORAGE.md` §Media;
  `PLANNING.md` "What 5000 recipes changes"; `DATA-FLOW.md` §SAVE step 5).
- **Accounts outside the vault** (`~/.config/recipevault/users.json`, argon2id
  hashes), sessions in memory or in the cache (→ `STORAGE.md` §Accounts).
- **The recipe files never hold anything about accounts** beyond the commit
  author.

## Where it fits in the existing code

Read these before Phase 0.

- `src/lib/server/save.ts` — `save(ctx, files)` is the one save path: check
  with the vault's entries (E103, W306, W503, W608), refuse on errors, set
  `status`/`added`/`updated`, serialize, write, commit, index, push. The form
  reuses it unchanged in spirit: it serializes its recipe to text and calls
  `save` with `overwrite: <hash>` for an edit. What it needs added:
  - an `author` per call (today every commit uses `ctx.author`, the config's
    `git_author`);
  - a status option for Q14 (today `statusFor` recomputes `draft` /
    `needs-review` on every save, so an edit of a `verified` recipe would drop
    it to `draft`);
  - extra files in the same commit (a family label, Q10; the other recipe of a
    W608 pair, Q10);
  - the commit verb (`add`, `edit`, and this plan's `undo`, `restore`).
  The form's text never contains `status` or `added` (the app sets them), so
  E112 never fires on the form path.
- `src/lib/server/files.ts` — `writeAndCommit` (atomic write, rollback, own
  writes). Gains an `author` parameter. Photos are not committed (`media/` is
  git-ignored, → `STORAGE.md`), so a photo is written by its own helper before
  the recipe save and removed again if that save fails.
- `src/lib/server/git.ts` — `commitPaths` already takes an author. Add the
  history helpers: `git log` of one recipe's path (and its `_trash/` path) and
  `git show <commit>:<path>`.
- `src/lib/server/context.ts` — `ctx.author` stays as the default for the CLI
  and the watcher (`edit (external): …` commits are not made by a person using
  the app).
- `src/lib/vault/serialize.ts` — the format does not change. The body writer
  gains a way to write a method section from step rows (Phase 2); untouched
  sections keep being written as they were.
- `src/lib/vault/body.ts` — a step's text is its lines joined with spaces, so a
  step with a nested list (`1. Garniture :` then indented `- pommes`) comes back
  as one line. The form needs the lines (Phase 2, Q5).
- `src/lib/vault/` stays browser-safe; the new form model goes in
  `src/lib/form/` (browser-safe). Accounts, sessions, photos and history are
  Node-only, in `src/lib/server/`.
- `src/hooks.server.ts` — host allowlist (DNS rebinding) and the Origin check
  stay first. Add: session cookie → `event.locals.user`; the write guard of
  Q1/Q2. `src/app.d.ts` gains `Locals.user`.
- Every existing write passes the signed-in person as author: `api/save`
  (paste), `r/[slug]` actions (verify, remove), `corbeille` (restore),
  `famille/[slug]` (label), `resoudre`, `ingredients`, `ingredients/[slug]`.
- `src/lib/server/pages.ts` `photoUrl` and `src/routes/media/[slug]/[file]` —
  today they serve the original file (HEIC refused, → plan 02, decision 8).
  They move to derived copies (Phase 6).
- `src/lib/components/RecipeCard.svelte`, `RecipeView.svelte` — thumbnail on
  cards, display copy on the page, "Modifier" and "Historique" actions.
- `src/service-worker.ts` — kitchen pages and `/media/` are cached for offline.
  Form pages, `/connexion` and every POST stay network-only; the kitchen cache
  keeps working for derived images.
- `src/lib/server/trash.ts` — moves `media/<slug>/`; the derived copies in
  `cache/img/<slug>/` go with it (deleted: they are rebuilt on restore).
- `src/lib/server/config.ts` — `users.json` is found next to the config file
  (→ `STORAGE.md` layout: `~/.config/recipevault/users.json`), i.e.
  `dirname(config.file)/users.json`.
- `src/lib/i18n/fr.ts` gains `form`, `auth`, `photo`, `history` sections.
  Friendly form hints for the warning codes the form can meet (Q9) go in
  `src/lib/i18n/diagnostics.ts` as a second table beside `codeText`, with a
  test requiring an entry for each code the form maps.
- `tests/e2e/serve.ts`, `scripts/fixture-vault.ts` — write a `users.json` with
  two invented accounts next to the throwaway config. Playwright gets a setup
  project that signs in and saves `storageState`; the form specs run in the
  `phone` and `tablet` projects too (her devices), not only `desktop`.

## Module layout (target)

```
src/lib/form/                 # browser-safe
  model.ts        # FormRecipe: the editable shape; toForm(recipe, body) / fromForm(form) → { recipe, body }
  quantity.ts     # what she types ("1 1/2", "1½", "0,5") ↔ Quantity as the schema writes it
  duration.ts     # hours + minutes (+ range) ↔ `1h15m`, `45m-50m`
  steps.ts        # method section ↔ step rows (+ sub-headings); untouched sections kept verbatim
  markers.ts      # marker state per field: uncertain / added; clear on confirm or edit (Q15)
  hints.ts        # warning codes → a field and a one-tap fix (Q9)
  draft.ts        # autosave in localStorage (Q17)
src/lib/server/
  users.ts        # users.json: load, add, passwd, remove; argon2id via node:crypto
  sessions.ts     # cache/sessions.db: create, look up, expire, revoke
  auth.ts         # login throttle, cookie options (Secure only over HTTPS)
  formsave.ts     # the form's entry into save(): author, status rule, extra files, collisions
  photos.ts       # store original, derive copies (cache/img/), serve, trash
  history.ts      # versions of one recipe from git; undo; restore a version
src/routes/
  connexion/+page             # sign in; déconnexion as a form action
  nouvelle/+page              # new recipe (the form)
  r/[slug]/modifier/+page     # edit a recipe (the form)
  r/[slug]/historique/+page   # versions, "Revenir à cette version"
  api/suggest/+server         # ingredient names, families, tags, authors, recipes (sub-recipe picker)
  api/photo/+server           # upload
  etiquettes/+page            # pending tags (only if Q11 B)
src/cli/vault.ts  # add: user add | passwd | remove | list
```

Adjust names if something reads better. Keep the server/browser split.

## Phases

Commit at the end of each phase with a conventional message. All tests and
`npm run check` pass before each commit. Each phase lists the questions it
depends on.

### Phase 0 — author per write (no behaviour change)

Depends on: nothing.

1. `writeAndCommit`, `save`, `verify`, `remove`, `restore`, `setFamilyLabel`,
   the ingredient edits, the queue actions and the price append take an
   optional `author`; absent, `ctx.author` as today.
2. Every route handler passes `undefined` for now (Phase 1 fills it).

Tests: a save with an explicit author commits under that name and email; the
watcher's and the CLI's commits keep the config's author.

**Done — decision.** The author travels in the context, not as a parameter on
each function: `withAuthor(ctx, author?)` (`context.ts`) returns the same vault
(shared lock, index, push queue, own-write map) with `author` set, and every
write function already commits as `ctx.author`. A route passes
`withAuthor(ctx, user)` once and the author reaches every commit however deep
(`linkKey` → `commitEntries` → `writeAndCommit`), with nothing to forget on a
new write function; no signature changed. `savePaste` takes an optional
`author`. Absent, `ctx` itself: the CLI and the watcher keep `git_author`.
Author and committer are both the person. Tests: `tests/server/author.test.ts`.

### Phase 1 — accounts and sessions

Depends on: Q1, Q2.

1. **`users.json`** (→ `STORAGE.md` §Accounts): next to the config file,
   `{ "users": [{ "login", "name", "email"?, "role"?, "hash" }] }`, mode 0600,
   written atomically. `hash` is argon2id through `node:crypto` (`argon2`,
   Node ≥ 24.7; no new dependency), parameters in the file per hash so they can
   be raised later. `email` absent → `<login>@recipevault.invalid` as the git
   email.
2. **CLI**: `vault user add <login> --name "<Nom>" [--email …] [--role …]`
   (password read twice from the terminal, never an argument), `vault user
   passwd <login>`, `vault user remove <login>` (also revokes its sessions),
   `vault user list` (logins and names only).
3. **Sessions** (→ `STORAGE.md`: "in memory or in the cache"):
   `cache/sessions.db`, its own small SQLite file so an index rebuild
   (`cache/index.db` dropped on a schema change) does not sign everyone out.
   Token: 32 random bytes, stored hashed (sha256). Lifetime per Q1. Deleting
   `cache/` signs everyone out, nothing else (→ STORAGE).
4. **Cookie**: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only when the
   request came over HTTPS (check what `tailscale serve` actually forwards —
   `X-Forwarded-Proto` or only the `*.ts.net` host — and record it in
   `DEPLOY.md`; plain LAN HTTP must keep working, → `DEPLOY.md` §4). The `Origin` check and the host
   allowlist stay in front of everything (→ `DATA-FLOW.md` §Authentication).
5. **`/connexion`**: login and password, "Rester connectée sur cet appareil" is
   the default (Q1). Throttle: after 5 failures for a login or an address, one
   try per 30 s, told in words. A redirect back to the page asked for.
   "Se déconnecter" in the nav menu.
6. **Guard** in `hooks.server.ts` per Q1/Q2: which pages need a session, which
   writes; a write without one → 303 to `/connexion` (pages) or 401 (API).
7. Every write passes `locals.user` as author (Phase 0's parameter).
8. Nav: the signed-in name; owner-only entries per Q2.

Tests: argon2id round trip and wrong password; `users.json` written 0600 and
never inside the vault; session create / look up / expire / revoke on `user
remove` and `passwd`; cookie flags over HTTP and HTTPS; throttle; each existing
write refused without a session (per Q1) and attributed with one; the host
allowlist and the Origin check still come first (a cross-site POST with a valid
cookie is still 403). E2E: sign in on the phone project, the name shows, sign
out.

**Done — decisions.**
- **Q2 B in `users.json`:** `markdown: true` replaces the `role` of the sketch
  above (no roles under Q2 B). It shows "Ajouter" (paste box), "À relier"
  (resolve queue) in the nav and "Voir le fichier" on the recipe page; the server
  allows every write to every account. `vault user add … --markdown`; no command
  to flip it later (remove and add, or edit the file).
- **Guard = deny by default.** Every method but GET/HEAD/OPTIONS needs a
  session, `/connexion`'s actions excepted — no list of write routes, so a new
  one is guarded without thinking about it. That includes `/api/check`,
  `/api/import` (a server-side fetch) and `/api/pastelog`, used only by the
  paste box, which itself needs a session (`/ajouter` GET → `/connexion`). A
  form action goes to `/connexion?suite=<page>` (303, or SvelteKit's JSON
  redirect for `use:enhance`, by throwing `redirect` in the hook); `api/` → 401.
  Routes take their write context from `writeContext(locals.user)`, which
  throws on a missing user rather than fall back to `git_author`.
- **HTTPS detection:** adapter-node reports every request as `https:` without
  `ORIGIN`/`PROTOCOL_HEADER`, so `url.protocol` is useless; `Secure` follows
  `X-Forwarded-Proto: https` alone. Checked in Tailscale's source
  (`ipn/ipnlocal/serve.go`, `addProxyForwardedHeaders`): `tailscale serve` sets
  it only on a TLS connection, keeps the `*.ts.net` `Host`, and sets
  `X-Forwarded-For` to the tailnet peer (its Go `ReverseProxy` with `Rewrite`
  drops client-sent `X-Forwarded-*`). A forged header on LAN HTTP only yields a
  cookie the forger's browser refuses. Recorded in `DEPLOY.md` §4.
- **Throttle address:** `X-Forwarded-For` believed only from a loopback socket
  (the `tailscale serve` case); otherwise the socket address. A failure is
  counted before the argon2id check (a parallel burst gets 5 tries, not 50).
  In memory: a restart resets it.
- **Sessions:** "Rester connectée" unchecked → browser-session cookie, one day
  on the server, renewed on use. Each session stores a fingerprint of the
  password hash, so `vault user passwd` ends older sessions even when it could
  not open `sessions.db`; `passwd` and `remove` also delete the rows. An
  unknown login verifies against a decoy argon2id hash (same time, same message).
  Password: 8 characters at least.
- **Not done:** no `__Host-` cookie prefix (the name would differ between LAN
  HTTP and HTTPS; the only other sites under the tailnet's `ts.net` name are
  the owner's own machines). No in-app password change (not in the plan; `vault
  user passwd`).
- **E2E:** a `setup` project signs the invented owner in and saves
  `storageState` (`/tmp/rv-e2e-auth/owner.json`); every project starts signed
  in. `auth.spec.ts` (phone, signed out) and `guard.spec.ts` (every write
  route refused signed out, cross-site 403 with a valid cookie, `421` host,
  commits attributed).

### Phase 2 — the form model (browser-safe, no UI)

Depends on: Q4, Q5, Q6, Q7, Q15.

1. **`FormRecipe`** (`src/lib/form/model.ts`): the editable shape — title,
   family/variant, source, times (hours/minutes per field, optional range),
   oven, servings/range/note, yield, tags, season, difficulty, rating, groups of
   rows, method (step rows and sub-headings), notes / variants / alternatives
   text, photo, and the parts the form does not model, carried untouched (Q4).
   Rows and steps have stable client ids for reordering.
2. **`toForm(recipe, body)` / `fromForm(form)`**. **Round-trip property**: for
   every valid fixture and every one of the 320 corpus recipes,
   `serialize(fromForm(toForm(x)))` is byte-identical to `serialize(x)` (the
   canonical file the paste path would write). This test is the promise that
   opening a recipe in the form and saving without a change writes nothing
   (and so commits nothing). Where Q4's answer allows a loss (comments, unknown
   keys), the test states it by name.
3. **Quantity input** (`quantity.ts`, Q7): what she types → the schema's
   `qty` as written (fractions stay strings, `"1 1/2"`, → `RECIPE-SCHEMA.md`
   "Fractions stay as written"); a decimal comma becomes a number; Unicode
   fractions (`½`) become their string form; anything else is not accepted by
   the input. Displayed back with the existing `render/fraction.ts`.
4. **Durations** (`duration.ts`): hours and minutes ↔ `30m`, `1h`, `1h15m`,
   range `45m-50m` (→ `RECIPE-SCHEMA.md` times).
5. **Steps** (`steps.ts`, Q5): method section ↔ rows; sub-headings (`###`) ↔
   heading rows; `body.ts` keeps each step's own lines so a nested list
   survives. An unchanged method section is written back exactly as it was
   read.
6. **Markers** (`markers.ts`, Q15): per field, the markers it holds, and the
   operations "confirm" (drop its uncertain markers) and "edit" (per Q15).
   Number fields with a marker (`qty: "250 [?]"`) keep it until confirmed
   (→ `RECIPE-SCHEMA.md` §Markers).
7. **Defaults from data** (decision 1): `defaultsFor(vaultStats)` — oven unit
   and the order of the unit picker from the vault's most used values
   (computed from the index, Phase 3), `lang` `fr` when absent
   (→ `RECIPE-SCHEMA.md`, `lang` default).

Tests: the round-trip property over the fixture vault and the corpus (run in
the normal suite: the corpus is public); quantity and duration parsing tables;
steps with sub-headings, nested lists, `-` and numbered lines, a `---` break;
markers confirm/edit on text and number fields; a recipe with an optional group,
`or`, `alt`, a sub-recipe, `buy_instead`, a range.

**Done — decisions.**
- **Nothing moved.** `serialize` and the checker already live in
  `src/lib/vault/` and are browser-safe; `src/lib/form/` imports only from
  there (a test greps it for Node and server imports). `body.ts` now exports
  `methodBlocks` (steps, sub-headings and other text of a method section, in
  order, each step with its own lines): the one split the checker and the form
  both read, so a row is always a step the checker counts. `Step` is unchanged.
- **`written`, per field.** Every field holds what she sees (text without
  marker syntax, `1 ½`, `0,5`, hours + minutes). Where that would not write the
  file's value back identically — a marker, `qty: "2"` quoted, `prep: 90m`,
  `page: "12"` — the value as written is kept beside the field in `written`. A
  field whose shown value is unchanged writes its `written` value; an edited
  field writes what she typed. That is what makes the round trip exact, and it
  is plain JSON (drafts, the request body).
- **Round trip** (`tests/unit/form/roundtrip.test.ts`): fixture vault 22/22,
  `tests/fixtures/check/valid` 11/11, corpus 320/320 byte-identical to
  `serialize(x)`, directly and after a JSON round trip of the form; no file
  fails. (74 of the 320 corpus files are already canonical on disk; the others
  differ from `serialize(x)` in formatting only, which a first app save of any
  kind rewrites.) The Q4 loss is tested by name: a YAML comment and an unknown
  key are gone after the form, as after `serialize`.
- **Method (Q5 A).** An unchanged section (its rows equal to the rows read from
  it) is written back as its original text. Any change rewrites the section
  canonically: `1.` numbering running across sub-headings, a step's further
  lines indented to its text (nested list items one line each; plain
  continuation lines join with a space, as the checker reads them), blank lines
  around sub-headings and prose rows, a prose line that would read as a step or
  a heading escaped with `\`. Empty rows are dropped.
- **Sections.** The form edits method, notes, variants, alternatives;
  `ensureSection` adds one in that order. The preamble and other sections are
  carried verbatim. A section she empties is not written; one already empty in
  the file stays.
- **Quantities (Q7 A).** Accepted: `2`, `1.5`, `0,5`, `,5`, `1/2`, `1 1/2`, the
  Unicode fractions alone or after a whole number (`½`, `1½`, `1 ½`), the
  fraction slash. Refused with a reason (`empty`, `format`, `zero`,
  `fraction` for `1 3/2`). Shown: a fraction string as written with its
  fraction as a glyph (`"1 1/2"` → `1 ½`), a number as its exact decimal with a
  decimal comma in French — not through `formatNumber`, which rounds (`0.33`
  would show as `⅓`).
- **Markers (Q15 A).** `[?]` and `[illisible]` apply to the word before them;
  `[+]` to the text back to the previous marker, line start or sentence end.
  `confirmField` drops `[?]`, `[?: …]` and `[illisible]` and keeps `[+]`; on a
  number field it leaves the plain number (`"375 [?]"` → `375`). An edit drops
  the uncertain markers; each `[+]` stays after its text when that text is
  still there unchanged, else it goes with it. `[+]` on a number field goes on
  any edit. `fieldMarkers` gives the UI the highlight, the alternatives and the
  spans; `uncertainFields` lists what is left to confirm. Tags and seasons are
  vocabulary slugs and carried as written.
- **Errors.** `fromForm` never throws: a value the file format cannot hold is
  reported (`{ id, field, reason }`: title and ingredients required, a row with
  content but no name, a bad quantity or range, an oven temperature without a
  unit) and left out. A row with nothing in it is dropped silently.
  `recipe.markers` is left empty: the save path checks the serialized text.
- **Defaults (decision 1).** `statsFromRecipes` counts units (items, `or`,
  `alt`), oven units and languages; `defaultsFor` gives the most used oven unit
  (`null` on an empty vault: she picks), all 26 units most used first, and the
  most used language, else `fr`. Phase 3 computes the same counts from the
  index.
- **Ids** are a counter with a random prefix, not `crypto.randomUUID`, which a
  browser only offers in a secure context (plain LAN HTTP is not one).

### Phase 3 — the form's save path

Depends on: Q3, Q9, Q10, Q14, Q18.

1. `formSave(ctx, { form, base?: { slug, hash } }, author)` in
   `src/lib/server/formsave.ts`: `fromForm` → `serialize` (without `status`,
   `added`) → `save()` with `overwrite: base.hash` for an edit. Nothing else
   writes a recipe.
2. **New recipe**: slug from the title (→ `DATA-FLOW.md` §Conveniences). A
   collision (E103) never reaches her: the app takes the suffixed slug the save
   path already proposes; a same title (W608) comes back as the family offer of
   Q10. A slug in the trash is never reused (→ `DATA-FLOW.md` §Delete).
3. **Edit**: the title may change, the slug never (→ `STORAGE.md` §Slugs).
   Stale hash → Q18. A recipe the form may not open (Q3) is refused with the
   reason.
4. **Status** per Q14; `extracted_by` absent → `hand` (→ `DATA-FLOW.md`
   §Conveniences), kept on an edit.
5. **Server check** returns warnings mapped to form fields (Q9): W302 / W304 /
   W607 name hygiene, W501 tag, W502 family, W503 / W608 title, W305 / W303
   unresolved name, W306 sub-recipe not yet added, W605 markers left. Errors
   are bugs (see "What the form must guarantee").
6. **Family** per Q10: a new family's label written to `vocab/families.yaml`
   in the same commit (with the `families.yaml` hash guard of `DATA-FLOW.md`
   §Family labels); a W608 "mettre en famille" writing both recipes in one
   commit.
7. **Commit messages**: `add: <title>`, `edit: <title>` as today; the author
   is the signed-in person.
8. **Vault stats for defaults** (decision 1): most used oven unit and units,
   from the index, cached until the next write.

Tests: unchanged form → no commit; new recipe → `add:` commit by the signed-in
author, `extracted_by: hand`, file byte-identical to the paste path's output for
the same content; edit with a stale hash → refused, nothing written; title
change keeps the slug; collision → suffixed slug; W608 → both files in one
commit (Q10); family label written with the recipe; status rule of Q14 on new,
edited, verified and marker-holding recipes; a server error from the check is
logged with its code and never returned as text.

**Done — decisions.**
- **`formsave.ts`**: `formSave(ctx, { form, base?, familyLabel?, pair? })`
  holds the lock, builds the text (`fromForm` → `serialize`, without
  `status`/`added`/`updated`) and calls `saveLocked` — the paste path's own
  save, exported for a caller already under the lock. Results: `saved` (with
  the new hash and the hints), `unchanged`, `stale` (with the other version as
  a form and its hash), `refused` (`gone`, `broken` — Q3 A, `pair`),
  `invalid` (the `fromForm` errors), `failed` (the checker refused: logged
  with the codes, nothing else returned). `openForm(ctx, slug)` opens only a
  file that passes the checker.
- **Unchanged = no write.** An edit is compared as `serialize(fromForm(form))`
  against `serialize(file)` before anything else; equal → `unchanged`, no
  `updated` bump, no commit. A file on disk that is not canonical (edited in
  Obsidian) but reads the same is left as it is.
- **New slug** from the title (`recette` if the title slugifies to nothing),
  first free `-N` against the index, the trash and the disk, chosen under the
  lock: E103 never reaches her; the stored slug is never recomputed.
- **Status (Q14 A)** in `statusFor(recipe, kept?)`: an uncertain marker →
  `needs-review`; else `verified` stays `verified`; anything else is `draft`
  (a `needs-review` whose markers she settled becomes `draft`). `SaveFile`
  gains `keepStatus`, set by the form on an edit only: the paste path still
  recomputes. Recorded in `DATA-FLOW.md` §Conveniences.
- **Extra files in the commit** (`SaveOptions.extra`): written only when the
  recipe itself is saved. **Family label (Q10 A)**: a new family's French label
  is added to `vocab/families.yaml` only when the family has no label yet —
  never overwriting one, so her save needs no hash of that file (a guard would
  refuse her recipe for someone else's label edit). **W608 pair**: the other
  recipe's `family`/`variant` set, its status kept, hash-guarded (`pair.hash`
  from the live check); a changed pair refuses the whole save (`refused:
  pair`), nothing written. Commit `add: <title>; edit: <other title>`.
- **Hints (Q9 A)**: `hintsFrom` maps W501 (tag + closest tag), W502 (near
  family), W503/W608 (the other recipes, computed from the index, not parsed
  from the message), W303/W305/W306 (their row, through `fromForm`'s new
  `ids`: path → row id, empty rows skipped), W605. W302/W304/W607 are computed
  live in the browser (`form/hints.ts`, same word lists) and not repeated.
  `formCheck` runs the same check without saving (`POST /api/form/check`,
  debounced while she types) — it is what makes the W608 offer possible
  *before* the save, so both recipes go in one commit.
- **Routes**: `POST /api/form/save`, `POST /api/form/check` (shape checked in
  `api/form/valid.ts` before `fromForm` walks it), `GET /api/suggest?kind=name|author|recipe`.
- **Stats (decision 1)**: `vaultStats` from the index (units of ingredient
  lines — `or` and `alt` units are not in the index, a small undercount —,
  oven units from `data_json`, languages), cached on `total_changes()` of the
  index connection.
- **Sub-recipes (E213)**: `subRecipeCandidates` leaves out the recipe and every
  recipe that uses it, transitively, through `ingredients.recipe` and
  `ingredient_or.recipe`.
- Tests: `tests/server/formsave.test.ts` (20), `tests/unit/form/rows.test.ts`.

**Fixes after the P2 review — the checker behind Save.** The review found
values the form let through and the checker refused (E210/E211 in a name,
E216 in a note, E217 in her own prose, E108 decimal servings, E202/E203/E205 on
the yield and the alt, E301 once every step is removed, an oven maximum
dropped without a word): each ended in the one plain `failed` sentence, no
field named. The separate inputs do not make E210/E211 impossible after all
(a comma, `tomates 796 ml`).
- **The net (`form/check.ts`).** `blocks()` runs the checker itself on what
  Save would write (`formFile` → `checkFile`, in the browser as the paste box
  does) and maps every error back to its row and field through `fromForm`'s
  `ids` (now also `body.sections[i]`, `body.steps[i]` → step row, `method`).
  A mapped block carries its `code`; the form's own rules come first and keep
  their reasons. New reasons: `integer` (E108), `nameQuantity` (E210),
  `nameComma` (E211), `noteQuantity` (E216), `marker` (E217, with `value`, the
  words at fault), `method` (E301), `checker` (any other code: its French line
  is `explain(code)`).
- **The server runs the same gate.** `formSave` refuses with `invalid` and
  those blocks before writing; an error only the vault check sees (E213) comes
  back from `saveLocked` mapped the same way, and `formCheck` returns the vault
  check's errors as `errors` beside the hints. A block with a `code` is a gap
  in the form's own rules: logged with the code. `failed` is left for a save
  that could not run, or an error no field holds. This replaces "shown to her
  as one plain sentence" above: she sees the field named, still never a code.
- **Specific rules** stated before the net: whole servings, the yield amount
  like an item's (unit ↔ quantity, range), the alt range, the method emptied
  beside an unrecognized section (`method` on the method section), an oven
  maximum without a temperature (a `fromForm` error: refused, never dropped).
- **⚑ Flagged — E217 in her own text is blocked, not escaped.** The docs do
  not say what a person's typed `[voir note]`, "temps incertain", "illisible"
  or "?)" become: the file format has no escape for `[`, and the prose rule
  is the checker's (`VALIDATION.md` E217). Rewriting her text (brackets to
  parentheses) would change what she wrote without her seeing it, so the
  safest reading is a block on the field, naming the words, asking her to
  write it another way. The four markers typed by hand are blocked the same
  way (Q15 A: she cannot add markers). A field still showing the file's value
  is never blocked for markers it held. If the owner prefers an automatic
  rewrite, or wants "incertain" allowed in typed text, that is a checker or
  schema change first.
- **⚑ Flagged — `VALIDATION.md` §Human-facing validation** still says the
  separate inputs make E210/E211 "cannot be expressed"; they can (see above).
  Left for the owner to reword.
- Tests: `tests/unit/form/check.test.ts`, `tests/server/formsave.test.ts`
  ("what the checker refuses comes back on its field").

### Phase 4 — the form UI, core: title, ingredients, method, notes

Depends on: Q5, Q6, Q7, Q8, Q9, Q15, Q17.

Routes `/nouvelle` and `/r/[slug]/modifier`, one Svelte component set. If a
`frontend-design` skill is available, load it first. Mobile first: her devices
are a phone and a tablet (→ `PLANNING.md` Kitchen mode); touch targets ≥ 44 px;
no drag-only interaction (reorder with ↑ ↓ buttons; drag as a desktop extra).

1. **Title** (required) and the recipe's language (a small select, default per
   Phase 2.7, kept on edit).
2. **Ingredients**: groups ("Ajouter un groupe", name, *facultatif*); a recipe
   with one unnamed group shows no group UI until a second group is added.
   Rows per Q6: quantity (Q7), unit picker (canonical units with French labels,
   in the order of Phase 2.7), name with suggestions (Q8), a "Détails" expander
   for the other fields. "Ajouter un ingrédient" adds a row and focuses its
   quantity; Enter in a name adds the next row. Remove a row with an undo
   toast (the form's own, before save).
3. **Method**: step rows per Q5 — one text area per step, numbered by the app,
   "Ajouter une étape", sub-heading rows ("Ajouter un titre de section"),
   reorder and remove as for ingredients. Kitchen-mode timers keep working
   because durations stay plain text in the step (→ plan 02, Phase 6).
4. **Notes, Variantes, Alternatives**: plain multi-line fields, no Markdown
   toolbar; lines are written as the section's text.
5. **Hints** (Q9): inline, next to the field, in plain French with a one-tap
   fix ("Mettre « émincé » dans la préparation ?"). Never a code.
6. **Markers** (Q15): a field holding an uncertain reading shows it highlighted
   with "C'est bien ça" (confirm) beside it; `[+]` text in its distinct style.
7. **Autosave and offline** (Q17): the form state in `localStorage` per recipe
   (and one slot for a new recipe); reopening offers to continue. Offline, Save
   says so and keeps the draft.
8. **Save**: disabled until the required fields hold; then one request, a
   toast with "Annuler" (Phase 7) and a link to the recipe.
9. Entry points: "Ajouter une recette" in the nav (→ the form), "Modifier" on
   the recipe page, and on the home page for her (Q2).

Tests: component tests for rows (add, remove, reorder, detail expander, the
structural rules of "What the form must guarantee": unit required with a
quantity, *au goût* disables the amount, range bound). E2E on `phone` and
`tablet`: create a recipe with two groups, a fraction, a range and three steps,
save, see it on its page and in search; edit it, reorder a step, save; the
file on disk is canonical and the commit is hers; reload mid-typing restores the
draft; a W302 hint moves a word to *préparation* in one tap.

**Done — decisions.** Components in `src/lib/components/form/` (`RecipeForm`,
`ItemRow`, `QtyInput`, `Suggest`, `Marks`, `DurationField`, `FamilyPicker`,
`TagPicker`, `StaleCompare`); routes `/nouvelle` and `/r/[slug]/modifier`,
both in the guard's `WRITE_PAGES`; loads in `src/lib/server/formpage.ts`.
- **Strings** in `src/lib/i18n/fr-form.ts` (imported as `form`), a sibling of
  `fr.ts` rather than a section of it: the form has as many strings as the
  rest of the app, and `fr.ts` was being edited by two other phases at once.
- **Nav label "Nouvelle recette"**, not "Ajouter une recette": the paste page
  is already "Ajouter" for a Markdown account, and two "Ajouter" side by side
  read as one. Shown to anyone signed in; also a button on the home page and
  "Modifier" on the recipe page (not on a broken one).
- **Look:** each part of the recipe on its own index card (red rule on top,
  blue lines between rows), a sticky save bar at the bottom listing in plain
  words what keeps Save disabled, and the uncertain-reading count (not a block).
- **Rows:** ↑ ↓ ✕ buttons (44 px); removing a row, step or group shows the
  app's toast with "Annuler" (restores it in place). Enter in a name adds the
  next row, its quantity focused. Fraction chips ¼ ⅓ ½ ⅔ ¾ under a focused
  quantity (phone keyboards have none). One unnamed group shows no group UI.
- **Markers (Q15):** under the field, the text with the uncertain part
  highlighted (as on the recipe page), the other reading as a button, and
  "C'est bien ça"; `[+]` text in pencil. Nothing once the field is edited.
- **Hints (Q9):** name words live in the browser from the vault's word lists;
  vault hints from `/api/form/check`, debounced 700 ms, never blocking.
  "Pas encore relié" shows under a name the registry does not know.
- **Autosave (Q17):** the form in `localStorage` 400 ms after the last change;
  a draft equal to the opened form is removed. Reopening offers "Reprendre le
  brouillon" / "Repartir de…"; nothing is overwritten before she chooses. An
  edit's draft keeps the hash it was typed over, so resuming it later still
  hits the stale guard. Cleared on save.
- **Save:** offline (or a network error) says so and keeps the draft; a lost
  session says to sign in again. Success goes to the recipe page with the
  toast "Recette enregistrée." and "Annuler" (`/api/form/undo` →
  `undoCommit`, the photo's commit first when there is one); after an undo
  the toast offers "Rétablir". Undoing a new recipe lands on the trash.
- **Stale (Q18):** the other version beside hers, field by field, only the
  fields that differ (`src/lib/form/compare.ts`); "Garder ma version" saves
  hers over the new hash; "Prendre l'autre version" loads it into the form.
- **Photo:** held in the form, previewed, sent to `/api/photo` after the save
  with the returned slug and hash (a new recipe has neither before). "Retirer"
  uses `DELETE /api/photo` after the save. The draft cannot hold the file; the
  form says so while a photo is waiting. A photo refused after a saved recipe
  says the recipe is saved and the photo is not.
- **Component tests** are the pure logic (`rows.ts`, `family.ts`,
  `compare.ts`) under vitest, no component harness; the UI is covered by
  `tests/e2e/form.spec.ts` on desktop, phone and tablet.

### Phase 5 — the form UI, the rest: family, tags, source, times, portions

Depends on: Q10, Q11.

1. **Family picker** (→ `VOCAB.md` §Families: "shows existing families first
   and only offers 'create a new family' after a fuzzy search found nothing
   close"): type-ahead over the family labels and slugs with variant counts;
   "Nouvelle famille « … »" appears only when nothing is within the W502
   distance; creating one shows the near family as a question, never a block
   ("near-duplicate is a warning, not a block"). Variant: a required text field
   once a family is chosen, pre-filled from the title's words the family label
   does not have.
2. **Tags** per Q11: autocomplete over `vocab/tags.yaml` canonical tags and
   aliases, shown with their French labels (→ `VOCAB.md` §Tags).
3. **Seasons**: four toggles (→ `VOCAB.md` §Seasons). **Difficulty**,
   **rating**: 1–5 taps.
4. **Source**: type (list of six, or none), author (suggested from authors
   in the vault), book / magazine title and page, URL, note.
5. **Times** (prep, cook, rest, total; each hours + minutes, optional "à" for
   a range), **oven** (temperature, °F/°C toggle starting on the vault's most
   used unit), **portions** (number, optional "à", note) or **yield**
   ("Donne : 24 biscuits").
6. **Sub-recipe** on an ingredient row (Q6): a recipe picker (search by
   title), never offering this recipe or one that uses it (E213), and
   "on peut l'acheter tout fait" (`buy_instead`).

Tests: the picker never offers "Nouvelle famille" when a family is within
distance; creating a family writes its label (Q10); tag autocomplete; W501 path
per Q11; oven default follows the fixture vault's majority; sub-recipe picker
excludes cycles. E2E: put a new recipe in an existing family, see it on the
family page and in the diff table.

**Done — decisions.**
- **Family picker:** `familyChoices` (`src/lib/form/family.ts`) measures a
  query against each family's slug and label (accents and case folded) and
  offers "Nouvelle famille « … »" only when none is within two edits (W502's
  distance) and none is an exact match. A new family's label is her words as
  typed (`familyLabel`, Q10 A). The server's W502 still shows under the family
  as a question with "Utiliser « … »". Variant pre-filled by `variantFrom`.
- **W608 "En faire deux versions":** when the other recipe already has a
  family, hers joins it; otherwise a new family named from the title, and a
  required field for the other recipe's variant; both in one commit (`pair`).
- **Tags (Q11 B):** suggestions over the canonical tags, their labels and
  aliases; a typed alias becomes its canonical tag; her own tag is written as
  typed, shown dashed "nouvelle, en attente", with W501's closest tag offered.
- **Times:** hours and minutes as plain numeric text fields (no spinner),
  "Ajouter « à »" for a range. **Oven:** °F/°C segmented toggle starting on
  the vault's majority. **Yield:** one "Donne" text field; a file's `yield`
  object (amount + unit) shows as amount, unit, note.
- **Source:** title and page shown for a book or magazine (or when filled),
  URL for a website or TV (or when filled); a URL that is not `http(s)://`
  blocks Save (E114, `WEB_URL_RE` now exported from the checker's rule).
- **Sub-recipe:** in "Détails", a recipe search excluding this recipe and its
  users (E213); picking one fills an empty name with its title.

### Phase 6 — photos

Depends on: Q12, Q13.

1. **Upload** (`/api/photo`, a form field on the form page): `<input
   type="file" accept="image/*">`, which on a phone offers the camera and the
   gallery. Size cap, type check by content (magic bytes, not the name), per
   Q12. The original is written to `media/<slug>/` exactly as received
   (→ `STORAGE.md` §Media: "never resized, never recompressed, EXIF kept"),
   under a new name each time (`final-<date>-<n>.<ext>`), so replacing a photo
   never overwrites the old file and an older version of the recipe (Phase 7)
   still finds its photo. Then `media.final` is set through the recipe save. A
   new recipe's photo is held until its first save gives it a slug.
2. **Derived copies** (→ `DATA-FLOW.md` §SAVE step 5; `STORAGE.md`: copies in
   `cache/img/`, EXIF rotation applied there only): a thumbnail (cards) and a
   display copy (recipe page, kitchen mode), metadata stripped, generated on
   upload and on demand when missing (a deleted `cache/`). Tooling per Q12.
3. **Serving**: `/media/<slug>/<file>?v=thumb|display` serves derived copies
   only; the original is never served to a browser, so the location a phone
   writes into EXIF never leaves the server. HEIC per Q12.
4. Cards show thumbnails (lazy, → `PLANNING.md` "What 5000 recipes changes");
   the recipe page and kitchen mode show the display copy; the service worker
   caches the display copy with the kitchen page.
5. **Remove / replace**: "Retirer la photo" unsets `media.final`; the file
   stays in `media/<slug>/` (originals are never deleted by an edit; the trash
   moves the whole folder, → `DATA-FLOW.md` §Delete).
6. **W603** per Q13.

Tests (photos generated in the test — a tiny JPEG with an EXIF orientation tag
and a fake GPS block, a PNG, a file named `.jpg` holding text): the original is
byte-identical on disk; derived copies are rotated and carry no EXIF; the
original is never served; a rejected type or size writes nothing; a failed
recipe save removes the new original; deleting `cache/img/` and reloading
regenerates; trash and restore move the folder and the copies follow. E2E
(phone): add a photo to a recipe, see the thumbnail on the card.

**Done (server and recipe page) — decisions.**
- **Modules:** `src/lib/server/photos.ts` (sniff, check, derive, store, remove,
  on-demand copies, `dropDerived` for the trash); `src/routes/api/photo`
  (`POST` add, `DELETE` remove — behind the Phase 1 guard, `writeContext`);
  `src/routes/media/[slug]/[file]` rewritten to serve derived copies only;
  `src/lib/render/media.ts` (browser-safe `photoSrc`);
  `src/lib/components/PhotoUpload.svelte`.
- **"One commit" = the recipe file.** `media/` is git-ignored (`STORAGE.md`),
  so the commit holds only the `media.final` change; the original is written
  under the same lock just before and removed if the hash guard or the commit
  fails. The edit goes through `editRecipeLocked` in `save.ts` (hash guard,
  canonical serialize, `edit: <title>`, index, push), a one-field app edit like
  `verify`: it **keeps the status** (a photo on a verified recipe leaves it
  verified — Q14 A's spirit), sets `updated`, and refuses a file with errors
  (Q3 A). No check run: nothing typed changed.
- **Decode before the lock.** Both copies are made in memory before anything is
  written; a file with image magic bytes that libvips cannot read is refused
  (415) like a non-image. Copies go to `cache/` after the commit (SAVE step 5).
- **Names** `final-<date>-<n>.<ext>`, extension from the content, `n` the first
  free number for that date; existing names (`final.jpg`) keep working.
- **Copies** `cache/img/<slug>/<file>.{thumb,display}.webp`, 400 / 1600 px
  longest side, never enlarged, WebP q75 / q82, `rotate()` then no metadata
  written. Regenerated when missing or older than the original (a file
  replaced by hand); concurrent requests share one conversion; `sharp.cache(false)`;
  `limitInputPixels` 100 MP. 12 MP JPEG: both copies in ~0.35 s here.
- **Serving:** `?v=thumb|display`, default `display`; anything else 404; slug
  and file name validated (one segment, image extension, no leading dot) before
  any path is built; `Cache-Control: private, max-age=86400` + ETag/304 (a new
  photo is a new URL). HEIC → 404, the page shows the placeholder. The service
  worker caches display copies with kitchen pages under a `?v=display` key; card
  thumbnails stay out of the kitchen cache.
- **Page data:** `photoView()` replaces `photoUrl()` → `{ src, thumb }` (`src`
  null = HEIC placeholder) for the recipe page and kitchen mode; cards build
  `?v=thumb` from the index row.
- **Q13 A:** W603 stays in `deferred.ts` (reason updated, `VALIDATION.md` row
  says "not emitted"). The recipe page shows "Ajouter une photo" where the
  photo goes when there is none — an upload on the page itself (the edit page
  does not exist yet): a file input (`accept="image/*"`: camera or gallery on a
  phone) posting to `/api/photo` with the page's file hash, then
  `invalidateAll()`. Signed out, it is a link to `/connexion?suite=/r/<slug>`.
  Not shown for a file with errors.
- **Body size:** `bin/serve.js` sets `BODY_SIZE_LIMIT=26M` unless set;
  `/api/photo` also refuses on `Content-Length` before reading the body.
- **Left for the form UI (Phases 4–5):** the photo field on the form page
  (reuse `PhotoUpload` or call `/api/photo` directly; "Remplacer la photo" /
  "Retirer la photo" strings are in `fr.photo`, `DELETE /api/photo` is ready);
  a new recipe's photo is sent after its first save gives it a slug (hold the
  `File` in the form, then POST with the hash the save returned); the draft
  (Q17) cannot hold the file. Card-level "Modifier" is Phase 4.

### Phase 7 — undo and history

Depends on: Q16.

1. **Versions** (`history.ts`): `git log --follow` over `recipes/<slug>.md`
   (and its trash path), each with date, author name, the commit verb, and a
   plain-French summary of what changed, computed by parsing both versions
   (title, ingredients added / removed / changed, steps, photo, family, …) —
   never a diff of Markdown.
2. **Undo** and **restore** per Q16: both write the old text through the save
   path (checker, hash guard, one new commit `undo: <title>` / `restore:
   <title> (version du <date>)`, index). History is never rewritten: no `git
   revert` of a pushed commit, no reset (→ `PLANNING.md` Architecture: "a real
   undo"). A version that no longer passes today's checker is refused with a
   plain sentence and left for the owner.
3. **`/r/[slug]/historique`**: the list, newest first; "Revenir à cette
   version" with a confirm showing the summary. The recipe page links to it.
4. Deleted recipes keep going through `/corbeille` (→ `DATA-FLOW.md` §Delete).

Tests: undo after a form save restores the previous file byte for byte in a new
commit by the signed-in person; undo refused when the file changed since
(hash); restore of a version three edits back; a version that fails today's
checker is refused; the summary lists the fields that changed; a recipe that went
to the trash and back keeps its history.

**Done — decisions.**
- **Modules.** `src/lib/server/history.ts` (`recipeHistory`, `undoCommit`,
  `restoreVersion`, `HistoryError` with a `reason` and a French message) and
  `history-diff.ts` (the field-level summary; no Node import). Git reads stay
  there (`git log --follow`, `diff-tree`, one `git cat-file --batch` for every
  version's text) rather than in `git.ts`. *Since issue #10:* the versions come from the
  commit index in `cache/index.db` (`src/lib/server/index/commits.ts`,
  `DATA-FLOW.md` "Commit index"), not from `git log --follow`. `save.ts` is not changed: the
  write-back runs the save's own steps (`checkBatch` with `vaultEntries`,
  `writeAndCommit`, `indexText`, `refreshFamilies`, push).
- **Byte for byte, not re-serialized.** Undo and restore write the old text
  exactly, `status` and `updated` included, not through `save()` (which would
  recompute both and rewrite the file canonically). Undoing a "Vérifié" makes
  the recipe unverified again: that is what it did.
- **Guards.** Undo compares the file on disk with the text the commit left
  (bytes, per file): no hash needs to travel with the toast, and a later save
  makes it `stale`. Restore takes the hash of the file the page showed. Both
  refuse a commit that did not touch this recipe (`unknown`), and the route
  passes its slug.
- **Undo, per kind of change.** Changed recipe → its text before. Created
  recipe → the trash (`delete:` commit through `trash.remove`, after the lock;
  she gets it back from `/corbeille` or by undoing that). Trash move → the
  trash's own restore / delete (media folder follows). `vocab/families.yaml` in
  the same commit → reverted if unchanged since, else left and reported in
  `kept`; with a created recipe it is left (a label nobody uses is harmless, and
  one commit fewer). W608 pairs and any multi-recipe commit revert together in
  one commit, all or nothing. Prices, registry, merges → `unsupported`. Undo of
  an undo (or of a restore) is the same operation: a redo.
- **Photos.** `media/` is not in git, and originals are never deleted by an
  edit (Phase 6), so an older version's `media.final` still names a file on
  disk; nothing to restore beside the recipe.
- **Today's checker.** A version that fails it is listed ("Version que
  l’application ne sait plus lire"), not offered, and refused if posted
  (`invalid`, codes to the server log only). A version whose `slug:` differs
  from the file name (a slug renamed by hand) is not offered either.
- **Summary** from `toForm` on both versions: title, fields by name, tags,
  ingredients by name (added / removed / changed), steps (added / removed /
  changed / reordered), notes / variants / alternatives / other text, photo,
  "Vérifié", uncertain readings settled. A change she cannot see (a first app
  save's canonical rewrite, `updated`) reads "Mise en forme du fichier
  seulement". The restore confirm shows the same summary from the current
  version to the chosen one.
- **Page.** Versions carry no text to the browser. The confirm is a
  `<details>` under each version (no `confirm()` dialog on a phone). After a
  restore the flash offers "Annuler ce retour"; after an undo, "Rétablir".
  A recipe in the trash shows its history without the button.
- **API for the form's toast.** `undoCommit(writeContext(user), commit, {
  slug })` → `{ action: 'undone' | 'trashed' | 'untrashed', commit, slugs, kept
  }`; or POST `/r/<slug>/historique?/annuler` with `commit` → `{ ok, message,
  commit, result }` (the new commit, to offer "Rétablir"); 409 with `message`
  on refusal.
- Tests: `tests/server/history.test.ts` (17), `tests/unit/history-diff.test.ts`
  (5), `tests/e2e/history.spec.ts` (3, Pixel 7 viewport in the desktop project).

### Phase 8 — pending tags (only if Q11 is B)

Depends on: Q11.

`/etiquettes`: the tags stored as pending (→ `DATA-FLOW.md` §Index schema:
unknown tags "stored folded with `pending = 1`"), with their recipes. Two
actions, each one commit to `vocab/tags.yaml` alone, with the file's hash guard
and the YAML edited in place (comments kept, as `families.yaml` is): "C'est
comme…" (add as an alias of a canonical tag) or "Nouvelle étiquette" (a new
canonical tag with its French label). The index retags (the existing
`tags_hash` path). No recipe file changes (→ `VOCAB.md`: "the file keeps what
was written").

Tests: each action is one commit touching only `vocab/tags.yaml`; the recipes'
tags stop being pending; no recipe file changes.

**Done — decisions.** `src/lib/server/tags.ts`, `src/lib/vault/tagstatus.ts`,
`/etiquettes`. Tests: `tests/server/tags.test.ts`, `tests/e2e/etiquettes.spec.ts`
(phone viewport).
- **Three actions, one commit each**, by the signed-in person
  (`writeContext`): "Nouvelle étiquette" (`tag: new <slug> → <label>`),
  "C'est comme…" (`tag: <pending> → <canonical>`), "Retirer" (`tag: drop
  <pending>`, one `edit: <title>` line per recipe in the body).
- **⚑ Flagged — "C'est comme…" adds an alias, it does not rewrite recipes.**
  The brief for this phase asked for mapping to rewrite the recipes using the
  tag; this plan (above), `VOCAB.md` ("the file keeps what was written") and
  `DATA-FLOW.md` §Index schema ("The file is never rewritten") say alias. The
  docs win: every written form of the pending tag the canonical tag does not
  already match is appended to its list in `vocab/tags.yaml`, and the index
  retags. The recipes then show and filter under the canonical tag. If the
  owner wants the files themselves rewritten, that is a doc change first.
- **⚑ Flagged — "Retirer" (drop) is added, and rewrites recipes.** Not in this
  plan; asked for in the brief. `VOCAB.md` "Never silently discard a tag she
  typed" is kept: it is an explicit act by a person, behind its own disclosure
  and a button naming the count ("Retirer des 3 recettes"). Every recipe holding
  the tag is rewritten in **one** commit (Q10 A's several-files pattern):
  parsed, the tag taken out of `tags`, serialized canonically (Q4 A), status
  kept, `updated` set — like any app edit. Guarded by the file hash of each
  recipe the page listed, and refused when the set of recipes holding the tag
  changed since; a recipe failing the checker is not rewritten (Q3 A) and the
  whole drop is refused. The only one of the three that touches recipes.
- **⚑ Flagged — tag labels live in a new `vocab/tag-labels.yaml`.** The plan
  asks for "a new canonical tag with its French label", but `tags.yaml` is
  `canonical: [aliases]` with no room for one, and the only labels were the
  seed's, in code (`fr.tags`). `VOCAB.md` asks for "a label table per
  language", so: `vocab/tag-labels.yaml`, the shape of `families.yaml`
  (`cabane-a-sucre: { fr: Cabane à sucre }`), not seeded (absent = no labels),
  written with `withLabel` (the families writer, which now takes the file name
  for its errors). `tagLabel(tag, label)` prefers it, then `fr.tags`, then the
  slug. "Nouvelle étiquette" therefore commits `tags.yaml` and
  `tag-labels.yaml` together (both hash-guarded: the page carries one version
  string over the two); with an empty label only `tags.yaml`. The filter
  sidebar shows the label; the recipe page still shows each tag as written
  (`RecipeView.svelte` was being edited by the photos work; left for later).
- **The canonical slug** of a new tag is the pending key (folded) with anything
  outside `a-z0-9` turned into hyphens (`fête d'été` → `fete-d-ete`). The
  written forms the slug does not match become its aliases (lowercased), so
  the recipes resolve without a change. A slug already in the vocabulary is
  refused ("utilisez « C'est comme… »"); a tag with no Latin letter or digit
  cannot become one (map or drop it).
- **`vocab/tags.yaml` edited as text, one line**: an alias is appended inside
  the canonical tag's one-line `[…]` list, a new tag appended as a new line
  lined up with the entries above it, so comments and the seed's alignment stay
  and the diff is one line. Anything else (a block list, `{}`) falls back to a
  YAML document edit (comments kept, alignment not). Each result is parsed back
  and compared with the intended data before writing; an alias YAML would
  misread is double-quoted.
- **Who.** Q2 B: the nav shows "Étiquettes (N)" to a `markdown: true` account
  once N > 0 (like "À relier"); the page and its actions are open to every
  signed-in account (deny-by-default guard). Signed out, the page is readable
  like every other read (Q1 A) and its actions go to `/connexion` — decided
  in issue #12.
- **Helper for the form's tag field (Phase 5).** Server: `tagVocabulary(ctx)`
  → `{ tags: [folded, canonical][], canonical: { tag, label, aliases }[],
  pending: string[] }`, plain JSON for the page. Browser:
  `classifyTag(new Map(tags), new Set(pending), typed)` from
  `$lib/vault/tagstatus` → `known` (with `canonical`), `pending` or `new`
  (with the pending key and W501's `suggestion`), or `empty`; `pendingKey(tag)`
  is the key the index stores. Server-side lists: `pendingTags(ctx)`,
  `pendingTagCount(db)`, `canonicalTags(ctx)`, `tagLabels(ctx)`.

### Phase 9 — scale, docs, report

1. **Bench** (`scripts/gen-vault.ts --bench`, extended): the speed targets
   below on the generated 5000-recipe vault, with one recipe given 50 commits
   of history and a vault history of ~20 000 commits.
2. **Docs**, each answer in the doc its question names, plus: `DATA-FLOW.md`
   (the form's save, undo/restore, photo upload, Authentication "decided"),
   `STORAGE.md` (`users.json` shape, `cache/sessions.db`, media file naming,
   `cache/img/` layout), `DEPLOY.md` (`vault user add`, cookies over LAN HTTP
   vs Tailscale HTTPS), `VALIDATION.md` (W603 per Q13; "Human-facing
   validation" pointing at the form hints), `PLANNING.md` (P2 status, open
   questions 4 and 5), `README.md`.
3. The one end-of-work review (decision 3); leftovers become GitHub issues.

**Implementation notes (Phase 9).**

- *Bench.* `gen-vault.ts --bench` keeps the plan 02 and 03 timings, then
  `benchWritePath`: an invented 74-line recipe (two groups, three
  sub-headings, a `[?]`) is added in the first of ~20 000 commits written with
  `git fast-import` (each changes one random recipe's rating; 49 of them,
  spread evenly, edit the bench recipe in turn: rating, an ingredient, a step,
  the title, the notes — 50 versions), then `git reset --hard` and a sync. Every
  write goes through a context with an invented author (`withAuthor`). The
  photo is a 12 MP JPEG of noise made by `sharp` in the run (7.5 MB, heavier
  than a phone's). Accounts, `users.json` and `sessions.db` live in their own
  temp folder. One generator change: every 50th recipe also carries one of 20
  invented tags (`essai-N`, by index, so the random draws — and plan 03's
  figures — stay as they were), so `/etiquettes` has small pending tags beside
  the two big ones the generator already had (`rapide`, `fetes`: not in the
  seed vocabulary).
- *Git comparison lines.* The bench also times `git log` of one path without
  `--follow`, then again after `git commit-graph write --reachable
  --changed-paths` (Bloom filters), for the report below; they change nothing
  in the app. git 2.43 uses Bloom filters for a single pathspec only, and never
  with `--follow`.
- *Load.* The machine was in desktop use during every run (load average 5–13;
  a browser, a game client, the parallel review). The recorded run is the last
  one, on the code after the review's fixes (`5cf0a93`…`e1be4d6`), load
  average 7–9: a price append took 267 ms there against 166 ms in plan 03, so
  the write-path figures are ~1.6× pessimistic. An earlier run at load ~5
  (before the review's fixes) gave: form save 369 / 431 ms, undo 542 ms,
  photo 670 ms, history 2.4 s.
- *No `src/` change* (the brief: report a speed problem, do not refactor). Two
  real problems found, in the final report: the history page, and the retag
  after a pending-tag action.
- *Docs.* `DATA-FLOW.md` ("Her form", a new section; undo route; photo from the
  form; guard pages; Authentication's question marked decided; W603 in the
  warnings list; the P2 figures), `STORAGE.md` (the `markdown` flag's nav
  entry; a measured caveat under "Flat directory"), `VOCAB.md` (a pending tag
  is kept in the file and pending in the index — not a `status:` field; the
  form's family picker and label), `VALIDATION.md` (the form's hints and their
  table), `DEPLOY.md` (`--markdown`), `INGREDIENTS.md` (`item:` and the form),
  `PLANNING.md` (P2 built, open questions 4 and 5 decided), `README.md` (pages,
  layout, bench). Everything else was already recorded phase by phase.

## Speed targets

Measured on the generated 5000-recipe vault on this machine; recorded in the
final report and in `DATA-FLOW.md` next to the plan 02 and 03 figures.

| Operation | Target | Why | Measured (Phase 9) |
|---|---|---|---|
| open the edit form (server load, a 40-line recipe) | < 100 ms | she opens it from the recipe page on a tablet | **11.9 ms** (74-line recipe: `openForm` + `formPageData`); 46 ms the first time after a write (vault stats recomputed); new-recipe form 9.8 ms |
| suggestions for one keystroke (ingredient names, ~1000 entries + names in use) | < 10 ms server | type-ahead on weak kitchen wifi | **2.8 ms** (names + the "relié" check, 18 prefixes); authors 1.6 ms; sub-recipe picker with the E213 walk 15.5 ms |
| hints for one field while typing (browser, name-word lists) | < 5 ms | no input lag on a mid-range tablet | **0.03 ms** (`nameHint`, timed in Node on a desktop CPU; a tablet ~10× slower is still far under) |
| form save: check + serialize + write + commit + index | < 500 ms | git dominates (a price append is ~170 ms) | **450 ms** edit (one step), **486 ms** new recipe (medians of 5; 369 / 431 ms in a lighter-load run) |
| unchanged form save | no commit | the round-trip promise | **no write, no commit** (HEAD unchanged; 11.5 ms) |
| photo upload, 12 MP JPEG: store + both derived copies | < 2 s | a phone photo | **817 ms** (7.5 MB, commit included) |
| derived copy on demand after `cache/` deleted | < 1 s each | the first page after a cache wipe | **71 ms** thumbnail, **348 ms** display |
| history page, 50 versions, ~20 000-commit vault | < 300 ms | `git log --follow` on one path | **2.1 s — not met** (`git log --follow` alone 1.7 s); ordinary recipes (6–10 versions) **4.2–11.8 s**. **After issue #10 (commit index): 261 ms — met**; ordinary recipes 81–90 ms (same run's baseline before the change: 1.87 s, 3.4–6.5 s) |
| undo / restore a version | < 500 ms | same path as a save | undo **620 ms — not met** under this load (542 ms lighter); restore **2.8 s — not met** (it reads the whole history first). **After issue #10: undo 421 ms, restore 408 ms — met** (baseline before the change, same session: 508 ms, 2.32 s) |
| sign in (argon2id verify) | 100–500 ms | slow on purpose, not slower | **160 ms**; unknown login (decoy hash) 160 ms |
| session lookup per request | < 0.5 ms | every request | **0.05 ms** (`currentUser`: cookie → `sessions.db` → `users.json` stat) |

The issue #10 figures are medians from `npx tsx scripts/gen-vault.ts --bench`
on 2026-09-28 (load average ~4; the same run's form saves were 379 / 477 ms),
against a baseline run of the previous code in the same session (load ~3–4).
The bench also times the commit index: reading all 20 012 commits 5.1 s (once,
after `cache/` is deleted or on the first start after the upgrade), catching up
one new commit 46 ms, a read already at HEAD 0.1 ms; and it checks that the
index lists what `git log --follow` lists for the bench recipe and three
ordinary ones.

Not in the targets, measured for the report: the form's debounced server check
(`formCheck`, whole form) 199 ms; `/etiquettes` load (22 pending tags, two of
them on 883 and 753 recipes) 37 ms; accepting a pending tag, commit included,
3.8 s whatever its size (the retag, below); growing the vault to 20 012
commits (`fast-import` + sync) 61 s.

Measured 2026-09-28 on an AMD Ryzen 5 5600X (desktop in use, load average
7–9), git 2.43, Node 24.20: `npx tsx scripts/gen-vault.ts --bench`, 5000
recipes, 1000 registry entries, 3000 price rows, 20 012 commits.

Git's share of the history page, per path (`git log --format=%H -- recipes/<slug>.md`,
same vault):

| Recipe (sorts at) | `--follow` | plain | plain + Bloom commit-graph | `--follow` + Bloom |
|---|---|---|---|---|
| `banc-d-essai-…` (b) | 1.7–2.3 s | 1.9 s | **0.29 s** | 1.9 s |
| `gateau-aux-n…` (g) | (page 4.2 s) | 4.3 s | **0.32 s** | 3.9 s |
| `pouding-au-f…` (p) | (page 5.5 s) | 6.3 s | 2.0 s | 5.5 s |
| `tourte-au-su…` (t) | (page 11.8 s) | 8.7 s | 3.0 s | 7.9 s |

A path-limited walk diffs `recipes/` at every commit, and in a flat 5000-entry
tree git reaches a later name later, so the cost grows with the file's place
in the alphabet. Bloom filters skip most commits but not all (git's filters
for one-path commits gave ~25 % false positives on some names here), and
`--follow` disables them.

## Testing summary

- Unit: form model round trip over the fixture vault and the 320-recipe
  corpus; quantity, duration, steps, markers, hints; users (argon2id), sessions,
  cookie flags, throttle.
- Server: form save (new, edit, stale, collision, W608 pair, family label,
  status rule, attribution); photos (original untouched, derived copies
  rotated and stripped, never serving the original, cleanup on failure,
  regeneration); history, undo, restore; pending tags; every existing write
  attributed and guarded.
- E2E (Playwright, temp fixture vault, invented accounts; `phone` and
  `tablet` for the form, `desktop` for the owner's paths): sign in; create;
  edit; family picker; photo; undo; history restore; draft restored after
  reload; the paste box still works for the owner (Q2).
- `npm run check` clean.

## Done when

- She can sign in once per device and stay signed in (Q1).
- A new recipe, with groups, fractions, ranges, sub-recipes, steps, family,
  tags, times, oven, portions, source and a photo, is created on a phone
  without seeing Markdown, a code, or an error message.
- Any recipe the form opens (Q3) saves back byte-identical when unchanged, and
  with only the changed parts different otherwise (Q4).
- Every save, undo and restore is one commit with her name as author.
- Undo and "Revenir à cette version" work per Q16; nothing rewrites git
  history.
- Photos: original untouched, derived copies rotated and stripped, the original
  never served.
- The paste box, the resolve queue, prices and the rest keep working, and
  every write is attributed.
- Deleting `cache/` and restarting loses nothing but sessions.
- Speed targets met or measured and reported.
- Docs updated for every answered question; all tests and `svelte-check` pass.

**Checked 2026-09-28 (Phase 9), item by item** (E2E not re-run in this pass:
the review was running it in parallel; the E2E files are cited as written):

| Item | Verdict | Evidence |
|---|---|---|
| Signs in once per device and stays signed in (Q1) | met | `tests/server/auth.test.ts` (a year, renewed on use at most once a day; ended by `passwd`/`remove`); `tests/e2e/auth.spec.ts` (phone) |
| A new recipe with everything, on a phone, without Markdown, a code or an error | met, with the leftovers below | `tests/e2e/form.spec.ts` (phone and tablet projects: groups, fraction, range, steps, family, own tag, photo, hints, drafts, a comma named on its row); sub-recipe, oven, portions and source through the model (`tests/unit/form/*.test.ts`); tablet screens not eyeballed |
| Unchanged → byte-identical, changed → only the changed parts (Q4) | met | `tests/unit/form/roundtrip.test.ts` (fixture vault 22/22, `check/valid` 11/11, corpus 320/320); `tests/server/formsave.test.ts` "unchanged form → no commit"; bench: HEAD unchanged after an unchanged save |
| Every save, undo and restore one commit by her | met | `tests/server/author.test.ts`, `formsave.test.ts`, `history.test.ts`, `photos.test.ts`; `tests/e2e/guard.spec.ts` (every write attributed) |
| Undo and "Revenir à cette version" per Q16, no history rewritten | met; slow at first, **fixed by issue #10** (speed table) | `tests/server/history.test.ts`, `tests/e2e/history.spec.ts` |
| Photos: original untouched, copies rotated and stripped, original never served | met | `tests/server/photos.test.ts`, `tests/e2e/photo.spec.ts` |
| Paste box, queue, prices and the rest still work, every write attributed | met | the plan 02/03 suites, all green; `tests/e2e/guard.spec.ts` |
| Deleting `cache/` loses nothing but sessions | met | sessions are `cache/sessions.db` alone; `tests/server/photos.test.ts` (copies regenerate); `tests/server/ingredients-invariants.test.ts`, `index.test.ts` (index rebuilt equal) |
| Speed targets met or measured and reported | measured; 3 not met, **met since issue #10** (commit index) | "Speed targets" above: history page, undo (under load), restore |
| Docs; tests; `svelte-check` | met | Phase 9 notes; `npm test` 1480 passed, 1 skipped (the private corpus); `npm run check` 0 errors, 0 warnings |

## Final report

Asked for:

1. What was built, per phase, with commit hashes.
2. The round-trip result over the fixture vault and the corpus (files
   byte-identical; any named loss per Q4).
3. Speed numbers at 5000 recipes.
4. Doc contradictions or undefined cases found beyond the questions below,
   each with a proposed doc change.
5. What the owner must do on the real machine (`vault user add` for each
   person, any new dependency's system package), without touching the real
   vault from the agent session.
6. Anything deferred, and why; the review's leftovers as GitHub issue links.

**Report, 2026-09-28** (Phase 9, written beside the end-of-work review, which
ran separately and whose own leftovers it files).

*1. Built.*

| Phase | What | Commits |
|---|---|---|
| — | plan, questions decided (recommended options, Q1–Q18) | `bfc9796`, `f62e310` |
| 0 | author per write: `withAuthor(ctx, author)`, no signature changed | `f7d09b9` |
| 1 | accounts (`users.json`, argon2id, `vault user …`), sessions (`cache/sessions.db`), `/connexion`, throttle, deny-by-default write guard, `markdown` flag | `8b21c77` |
| 2 | form model: `toForm`/`fromForm` with the byte-identical round trip, quantities, durations, step rows, markers, defaults from data | `ed7558a` |
| 3 | `formSave` into the paste's save, status rule (Q14 A), family label and W608 pair in one commit, hints, suggestions, vault stats | `de6b98b` |
| 4–5 | the form UI, core and rest, in one commit: `/nouvelle`, `/r/<slug>/modifier`, rows, markers, hints, autosave, stale compare, family picker, tags, source, times, oven, portions, photo, Annuler | `4278a41` |
| 6 | photos: upload, derived WebP copies in `cache/img/`, serving without the original | `aa1ce57` |
| 7 | undo and per-recipe history, `/r/<slug>/historique` | `763f540` |
| 8 | pending tags on `/etiquettes`, `vocab/tag-labels.yaml` | `7620e88` |
| review | fixes from the end-of-work review (separate pass, still running when this was written) | `5cf0a93`, `f1038ea`, `a9142e0`, `e1be4d6`, `6ffc105` |
| 9 | bench of the write path over ~20 000 commits; docs; this report | this pass's `perf(bench)` and `docs` commits |

Deviations from the plan, each recorded in its phase's notes: the author
travels in the context (Phase 0); `markdown: true` instead of a role (Q2 B),
and a deny-by-default guard instead of a list of write routes (Phase 1); form
strings in `src/lib/i18n/fr-form.ts` beside `fr.ts`, nav label "Nouvelle
recette", pure-logic component tests under vitest with the UI in Playwright
(Phase 4); Phases 4 and 5 in one commit; the photo's commit is the recipe file
alone (`media/` is git-ignored) and the photo prompt came to the recipe page
before the form existed (Phase 6); the git reads live in `history.ts`, and undo
/ restore write the old bytes rather than go through `save()` (Phase 7);
"Retirer" added and `vocab/tag-labels.yaml` introduced, "C'est comme…" an alias
rather than a rewrite (Phase 8, flagged there). `api/suggest` has
`kind=name|author|recipe`; families and tags come with the page load instead.

*2. Round trip* (`tests/unit/form/roundtrip.test.ts`): fixture vault 22/22,
`tests/fixtures/check/valid` 11/11, corpus 320/320, byte-identical to
`serialize(x)`, directly and after a JSON round trip of the form. The Q4 loss is
tested by name: a YAML comment and an unknown key are gone after the form, as
after any app save.

*3. Speed* at 5000 recipes and ~20 000 commits: the "Speed targets" table.
Met: form open (12 ms), suggestions (3 ms), browser hints (0.03 ms), form save
(450 / 486 ms, tight under load), unchanged save (no commit), photo (0.8 s),
copies on demand (71 / 348 ms), sign-in (160 ms), session lookup (0.05 ms).
**Not met:**
- **History page: 2.1 s for the 50-version recipe, 4–12 s for ordinary ones**
  (target 300 ms). Cause: `git log --follow -- recipes/<slug>.md` walks all
  ~20 000 commits; in the flat 5000-entry `recipes/` tree each step costs more
  the later the name sorts; `--follow` cannot use changed-path Bloom filters.
  Without `--follow`, after `git commit-graph write --reachable
  --changed-paths`, git's part falls to ~0.3 s for two of the four names tried
  but stays 2–3 s for the others (Bloom false positives). Directions, for the
  owner to choose (not done — the brief was to report, not refactor): (a) drop
  `--follow`, name the live and `_trash/` paths explicitly (two single-path
  logs, since git 2.43 uses Bloom filters for one pathspec only) and keep a
  Bloom commit-graph written by `vault sync`/after commits; (b) keep a
  per-path commit table in `cache/index.db`, filled once by one `git log
  --name-status` walk and appended at each app commit and sync — history then
  costs a SQL lookup plus the existing `cat-file --batch`, whatever the vault's
  age; (c) show the newest N versions first and load older ones on demand
  (`--max-count` is already supported by `recipeHistory`). (b) is the only one
  that reliably meets 300 ms.
- **Restore: 2.8 s** — `restoreVersion` calls `recipeHistory` to find the
  version; checking that the commit touched this path and reading
  `commit:path` directly would make it a save (~0.5 s).
- **Undo: 620 ms** under load average 7–9 (542 ms at ~5). No `git log`: a few
  small git reads, then `checkBatch` with the vault's entries (likely ~200 ms:
  the same work as the form's debounced check) and the commit. Probably under target on
  an idle machine (a price append ran 1.6× slower during these runs); not
  confirmed.

Found beside the targets: **accepting a pending tag takes 3.8 s** whatever its
size, because `commitVocab` (`src/lib/server/tags.ts`) runs `retag` outside a
transaction — ~10 000 autocommitted statements. The same `retag` wrapped in
`ctx.db.transaction` took 0.5 s on the bench vault (the watcher's and the
sync's callers already wrap it). A one-line fix, left to the owner/review.

*4. Doc/code disagreements and undefined cases* (listed, not settled):
- **`/etiquettes` signed out.** Phase 8's note says the page is open to "none"
  signed out; the code serves it (a GET passes the guard; only `/ajouter`,
  `/nouvelle`, `/r/<slug>/modifier` send to `/connexion`), and its actions go
  to `/connexion`. `DATA-FLOW.md` §Authentication now lists it with the open
  reads, as built. **Decided (issue #12): readable signed out**, as built; the
  Phase 8 note is corrected.
- **Tag labels on the recipe page.** `VOCAB.md`: "Display form comes from a
  label table"; the recipe page still shows each tag as written (the filter
  sidebar uses labels). Known leftover.
- **Seed tag labels in code** (`fr.tags`) against decision 1 and `VOCAB.md`'s
  label table in data; `VOCAB.md` already says so ("until they are moved to
  that file"). Proposed: seed `vocab/tag-labels.yaml` with them at `vault init`
  and drop `fr.tags`.
- **`VALIDATION.md` "never a generic failure"** vs the plan and `formSave`: an
  error the server check still finds (the browser's check missed it) is logged
  and she reads one generic sentence ("rien n'a changé"). Both are true today
  (the browser check blocks first; the server's is the backstop). Proposed:
  `VALIDATION.md` names the backstop.
- **`STORAGE.md` "Flat directory … without complaint"**: true for the
  filesystem and for commits, not for one file's history (above). A caveat
  was added there; the layout decision is unchanged.
- **The plan's speed-target "Why"** assumed `git log --follow` on one path is
  cheap at 20 000 commits; it is not.
- Wording fixed, no behaviour chosen: `VOCAB.md` said an unknown tag is stored
  "with `status: pending`"; there is no such field — the file keeps the tag as
  written and the index marks it pending (as `DATA-FLOW.md` §Index schema and
  Q11 B say).

*5. On the real machine* (the owner; nothing here touched the real vault):
- `git pull && npm ci && npm run build`, restart the service. `sharp` comes
  prebuilt with libvips (no system package); argon2id is `node:crypto`'s (Node
  ≥ 24.7; this machine has 24.20). No vault migration: the file format did not
  change.
- `npx vault user add <him> --name "…" --email … --markdown`, and
  `npx vault user add <her> --name "…"` (password typed twice). Back up
  `users.json` with the config.
- Sign in once per device, on the LAN name and on the Tailscale name
  separately (two sites to the browser, `DEPLOY.md` §4).

*6. Deferred and leftovers* (to become GitHub issues; this pass filed none):
- the history page, restore and undo speed, and the retag transaction (above);
- the recipe page shows tags as written, not their labels;
- seed tag labels still in `fr.tags` code;
- on a phone, the filter sidebar hides the active tag behind "N de plus";
- the R4 corpus test is flaky under full-suite load (5081 ms against a 5000 ms
  timeout);
- `tests/server/auth.test.ts` "HttpOnly, SameSite=Lax…" flaked once in this
  pass under load (`maxAge` 999 against 1000: a millisecond passed between
  `Date.now()` in the test and in `cookieOptions`); passed on the rerun;
- no E2E for W608 "En faire deux versions";
- the form's tablet screens not eyeballed;
- "Pas encore relié" is noisy while typing (shown under every half-typed name);
- possibly unused strings in `src/lib/i18n/fr-form.ts`, and form strings in
  that separate file rather than in `fr.ts` sections (as the plan asked);
- the sub-recipe picker's type-ahead is 15.5 ms (the < 10 ms target was for
  ingredient names; noted);
- the form's debounced server check costs ~200 ms of server CPU per pause while
  typing (no target; fine for two people);
- out of scope as planned: cook log, cookbook export, duplicate detection by
  ingredient set, slug rename, `item:` in the form, several photos, offline
  saving, internet-exposure hardening.

## Follow-up: issue #10, the commit index

Option A of issue #10, chosen by the owner: a per-file commit index in
`cache/index.db` (`commits`, `commit_files`; `SCHEMA_VERSION` 7), so the
history page, restore and undo meet their targets (speed table above).
Decisions:

- **What is stored**: every non-merge commit reachable from HEAD, in `git log`
  order, with every path it changed from `git log -M --name-status -z` (renames
  over the whole tree, as `--follow` finds them). All paths, not only recipes:
  undo reads a commit's changes from it (prices, the registry and families
  included) instead of `rev-list` + `diff-tree`.
- **The walk** (`followPath`) does what `git log --follow -M` does: a commit
  shows the path as it would alone (a file renamed away reads as deleted), a
  path created by a rename goes on under the old name. The page's cut from
  `5cf0a93` is unchanged (stop at the creation; an older removal ends it).
- **One deliberate difference — decided by the owner (2026-09-28): a copy is a creation.** `git log --follow`
  turns on `--find-copies-harder`: a recipe *created* with a text close enough
  to one already in the vault (a W608 variant made from another recipe, a slug
  renamed by hand and taken again) is shown as a copy (`C`), and the walk goes
  on in the *other* recipe's history. The old page did that too (a `C` was not
  a creation for its cut, so the other recipe's versions were listed, blocked
  as `other-slug`). The index counts a copy as a creation: the history starts
  where the recipe began. To keep git's behaviour instead, the index would need
  copy detection against the whole tree at each commit that adds a file.
- **Kept current**: in the background after each app commit (`committed(ctx)`
  beside the push), at startup and in `vault sync`, and before every read
  (history, restore, undo). Only `<last>..HEAD` is read when the new commits
  descend from the last one read in a line; otherwise (amend, reset, rebase,
  branch switch, a merge in the new commits, an unknown last commit) the whole
  history is read again. HEAD is read from `.git` without spawning git (a spawn
  from the server process costs tens of ms); reftable or a worktree's `.git`
  file fall back to `git rev-parse`.
- **The page's own work**: the vault's word lists and vocabulary only add
  warnings, so "does this version pass today's checker" reuses the parse of the
  summary instead of a second check per version (behaviour unchanged, about a
  third of the CPU of a 50-version page).
- **Restore** finds its commit among the recipe's versions in the index and
  reads that one text (`cat-file` of `<commit>:<path>`).
- Tests: `tests/server/commit-index.test.ts` — equality with `git log --follow`
  for every path of a generated vault (renames, trash and back, slugs freed and
  taken again, deletions, a merge; copies ending the list), undo's changes equal
  to `git diff-tree`, incremental catch-up equal to a full read, rewrites, packed
  refs and detached HEAD, deleting `cache/` giving back the same index and
  pages. `tests/server/history.test.ts` and `tests/e2e/history.spec.ts`
  unchanged and green.

## Follow-up: issue #11, small leftovers

Items of issue #11 (the two perf items went to a separate pass).

- **Tag labels on every page.** The recipe page maps each tag as written to
  its canonical tag (aliases included) and shows that tag's label from
  `vocab/tag-labels.yaml`; its link filters on the canonical tag (it used the
  written form, which found nothing for an alias). A tag outside the
  vocabulary shows as written. The history page's tag lines use the same
  names. The paste preview still shows tags as written (the owner's Markdown
  tool; it has no vocabulary on the page). Cards and kitchen mode show no tags.
- **Seed labels are data.** `fr.tags` is gone; the seed labels are a YAML
  block in `docs/VOCAB.md` ("Tag labels"), written to `vocab/tag-labels.yaml`
  by `vault init` like the other seeds. **Flagged decision — a vault made
  before this change:** no migration commit at startup. The app never writes
  the vault on its own at start (a commit nobody asked for, racing the
  watcher and a sync); until the owner runs `vault ingredients seed` — the
  existing command that adds the seed files an older vault lacks, now also the
  missing seed tag labels, never over a label already set — those tags show
  their slug (`Entree` instead of `Entrée`), which is what `VOCAB.md` already
  said a tag without a label shows. **The owner: run `npx vault ingredients
  seed` once on the real vault after pulling.**
- **Form strings in `fr.ts`.** `src/lib/i18n/fr-form.ts` is merged into
  `fr.ts` as `t.form` (also exported as `form`, the form components' `f`), as
  the plan asked; seven strings no component used are gone.
- **The server backstop names the problem** (`VALIDATION.md`, "Human-facing
  validation"): a save the server's check refuses already came back as blocks
  on their fields (`checkerBlocks`); the message above Save now names each
  problem (the field's line, else `explain(code)`) instead of "corrigez les
  champs signalés", and a save-bar line with no text of its own uses the code's
  sentence. "Rien n'a changé" is left for failures that are not the checker's.
- **Tablet screens checked by eye** (Galaxy Tab S9, portrait and landscape,
  `/nouvelle` and `/r/<slug>/modifier` on the fixture vault; screenshots in
  `/tmp`). Fixed: a "Titre de section" row squeezed its name into the step
  number's gutter, broken mid-word — the name now sits above the field; the
  example "1 ½" showed in a disabled quantity (*au goût*) and in "Jusqu'à",
  where it read as a value — gone there; the save bar's « ; » could start a
  line; the four times went three and one held sideways — now two by two.
  Seen and left: the row tools (↑ ↓ ✕) keep 44 px targets, so a long name
  scrolls in its box in portrait.

## Out of scope

- **Cook log and dated notes** (`PLANNING.md` Tier 2, a `log` list in
  frontmatter): a schema change (new key, checker, AI template, index), and not
  needed to write recipes. Her own remarks go in the Notes section, which the
  form edits. Next candidate after P2.
- **Family cookbook export, duplicate detection by ingredient set** (Tier 2):
  read-side features.
- **Slug rename** (`STORAGE.md`: "an explicit, rare operation"): titles change
  freely; the slug stays.
- **`item:` override in the form** (`INGREDIENTS.md` Resolution 2 allows "later,
  the P2 form"): rare by design; the resolve queue and disambiguation rules cover
  the cases. An existing `item:` is kept untouched by the form.
- **Ingredient registry and price editing from the form**: the resolve queue,
  `/ingredients` and the ingredient view already do it.
- **Several photos per recipe**, unless Q12 says otherwise (`PLANNING.md`
  open question 5: "Start with one").
- **Offline saving** (a queued save sent later), unless Q17 says otherwise.
- **Internet exposure hardening** beyond what is listed (decision 4): no 2FA,
  no password-reset e-mail, no account self-registration.
- Shopping list, meal planner, scaling beyond the servings adjuster, price
  charts (P3). English UI.

---

## Open questions

**Decided 2026-09-28: the owner took the recommended option on every question,
Q1–Q18** (Q1 A, Q2 B, Q3 A, Q4 A, Q5 A, Q6 A, Q7 A, Q8 A, Q9 A, Q10 A, Q11 B,
Q12 A, Q13 A, Q14 A, Q15 A, Q16 A, Q17 A, Q18 A). Where a phase says "depends on
Qn", that dependency is settled. Doc changes that follow from a decision are part
of the phase that implements it.

The docs leave each of these open or contradict themselves. For each: the
options, then the recommendation with a one-line reason. Q-numbers are
referenced from the phases. **Key** marks the four answers that change the most
code.

### Accounts

**Q1 — Key — Who signs in, how, and for how long?**
`DATA-FLOW.md` §Authentication: "Two accounts minimum", and for LAN-only "a
single shared password … with a name picker" is defensible; `STORAGE.md` already
names `users.json` with argon2id hashes. Nothing says whether reading needs a
session, nor how long one lasts.
- A. One account per person (login + password, argon2id), sessions of one
  year renewed on use, "rester connectée" by default; **reading needs no
  session** (browse, recipe page, kitchen mode, pantry search); every write
  needs one. Accounts made by the owner with `vault user add`.
- B. As A, but every page needs a session, reads included.
- C. No password: a name picker ("Qui êtes-vous ?") in a cookie, for commit
  attribution only; the network is the only boundary.
- D. Device pairing: `vault user pair <login>` prints a one-time code or QR
  code; the device gets a long-lived token, no password ever typed.
- **Recommended: A.** It is what `STORAGE.md` already describes, a cook with
  floury hands (or a visiting sibling) is never stopped by a login to read, and
  a password typed once per device is the smallest step that makes deletes and
  edits non-anonymous.

**Q2 — What can each account do, and does the paste box stay for the owner?**
`PLANNING.md` gives her "Full read and write, via a form UI" and says she
"Never sees markdown"; the paste box, "Voir le fichier", the fix-request block
and the resolve queue are Markdown or maintenance tools.
- A. Two roles in `users.json`: `owner` (everything) and `cook` (form,
  photos, Vérifié, delete to trash and restore, undo and history, prices);
  the server refuses the paste box, raw-file view, resolve queue and
  ingredient/registry edits to `cook`.
- B. One level of rights: every account may do everything; a per-account
  preference `markdown: true` shows the paste box, "Voir le fichier" and the
  resolve queue, hidden otherwise.
- C. No distinction at all: everyone sees everything.
- **Recommended: B.** `PLANNING.md` gives her full write access, so a
  permission wall protects nothing; hiding the Markdown tools is what "never
  sees markdown" asks for.

### Scope of the form

**Q3 — Which recipes does the form open?**
`PLANNING.md` says she "adds and edits her own recipes"; most recipes will be
AI-pasted by the owner.
- A. Every recipe whose file passes the checker (AI-pasted, web-imported,
  hand-edited alike); a file with an error (the banner case) shows "à faire
  corriger" instead of "Modifier".
- B. Only recipes created with the form (`extracted_by: hand` and first
  commit by a `cook`); the others are read-only for her.
- C. Every recipe, including files with errors, the form showing what it
  could read.
- **Recommended: A.** Fixing an AI's misreading of her own card is exactly
  her job ("Readings to confirm … are for her", `PLANNING.md` P0 findings), and
  a broken file cannot be round-tripped safely.

**Q4 — Key — What happens to what the form does not model?**
A file edited in Obsidian or pasted by the owner may hold YAML comments,
unknown keys (W610: "its value is ignored"), `media` keys besides `final`, a
preamble, sections beyond the four (`RECIPE-SCHEMA.md`: "allowed, ignored by
the parser, still rendered"), non-step prose inside the method. The canonical
serializer, used by every app save today, keeps the body sections as text but
drops comments and unknown keys.
- A. Canonical save, as the paste path: frontmatter rewritten canonically
  (comments and unknown keys dropped — both still in git history); every body
  part the form does not edit (preamble, other sections, a method section she
  did not touch) kept verbatim; other `media` keys kept.
- B. Surgical save: only the frontmatter keys she changed are set on the
  parsed YAML document (comments, unknown keys, order kept, like the family
  label edit); body as in A. The file is not canonical after a form edit.
- C. As A, but the form refuses to open a file with comments or unknown keys
  until the owner cleans it ("à faire corriger").
- **Recommended: A.** `STORAGE.md` makes canonical serialization the rule for
  every app save ("whatever the AI pasted"), the round-trip test proves nothing
  the app reads is lost, and git keeps what was dropped.

**Q5 — How is the method edited?**
The body is prose with numbered or bullet steps, `###` sub-headings, nested
lists joined to their step, and possibly prose lines between steps.
- A. Step rows: one text area per step (multi-line allowed; a nested list is
  shown as its lines), heading rows for sub-headings, reorder / add / remove;
  written back as `1.` lines with indented `-` lines. A method section with
  prose between steps keeps that prose as a "texte" row in place.
- B. One plain text area for the whole method, one step per line, numbering
  added by the app.
- C. Step rows as A, but a method section holding anything besides steps and
  sub-headings is shown as B.
- **Recommended: A.** Kitchen mode is built on steps (one per screen), rows
  make a merged step impossible to write (W402), and the "texte" row keeps
  hand-written prose instead of dropping it.

**Q6 — Which ingredient fields does a row offer?**
`RECIPE-SCHEMA.md` has `qty`, `qty_max`, `unit`, `name`, `alt`, `brand`, `or`,
`note`, `prep`, `to_taste`, `optional`, `recipe`, `buy_instead`, `item`.
- A. Quantity, unit and name on the row; a "Détails" expander with note,
  préparation, marque, *au goût*, *facultatif*, "jusqu'à" (range), "ou en
  mesure" (`alt`), "ou remplacer par" (`or`, a list of rows), "c'est une
  autre recette" (sub-recipe, `buy_instead`). `item` never shown, kept.
- B. The expander offers note, préparation, *au goût*, *facultatif* only;
  `alt`, `or`, `brand`, `recipe`, ranges shown as a read-only summary on the
  row and kept.
- C. Every field inline on the row.
- **Recommended: A.** With Q3 A she edits AI files that use every field; a
  field she cannot edit is a misreading she cannot fix, and the expander keeps
  the row small on a phone.

**Q7 — How is a quantity typed?**
Cards are fractions (`RECIPE-SCHEMA.md`: "Fractions stay as written").
- A. One text field accepting `2`, `1 1/2`, `1½`, `0,5`, `1.5`; stored as the
  schema writes it (fraction string as typed, decimal number otherwise); a row
  of fraction chips (¼ ⅓ ½ ⅔ ¾) above the phone keyboard.
- B. Whole-number field + a fraction drop-down (none, ¼, ⅓, ½, ⅔, ¾, ⅛).
- C. A numeric keypad field, decimals only (`1.5`).
- **Recommended: A.** She types what the card says, the file keeps it as
  written, and the chips spare her the `/` on a phone keyboard.

**Q8 — What does the ingredient name field suggest?**
`INGREDIENTS.md`: names resolve through registry aliases at index time;
unresolved names never block a save.
- A. Suggestions from the registry's names in the recipe's language plus the
  names already written in the vault, most used first; free text always
  accepted; a small "relié" mark when the name resolves.
- B. Registry names only; a name outside the registry needs "Nouvel
  ingrédient", which creates the registry entry from the form.
- C. No suggestions.
- **Recommended: A.** Suggestions cut drift at the source (fewer queue rows)
  without turning the form into registry maintenance, and a new name still
  never blocks a save.

**Q9 — How do checker warnings reach her?**
`DATA-FLOW.md`: "Her form never shows a raw error"; `VALIDATION.md`: warnings
save anyway. The name-hygiene warnings (W302 preparation word, W304 size word,
W607 brand) are typeable in a free name field, and the vault warnings (W501,
W502, W503/W608, W303/W305, W306, W605) exist on any save.
- A. Inline hints next to the field, in plain French, each with a one-tap fix
  where one exists (move the word to préparation / note / marque, pick the
  suggested tag or family); computed live in the browser for the name words,
  from the save result for the vault ones; never blocking, never a code.
- B. No hints: save silently; warnings appear only on the recipe page, as for
  pasted recipes.
- C. Hints as A, but Save stays disabled until each is accepted or dismissed.
- **Recommended: A.** It is the form's version of "the fix states itself",
  catches the pantry-splitting mistakes where she makes them, and never stops a
  save.

### Families and tags

**Q10 — What does creating a family, or joining one, write?**
`VOCAB.md`: the picker creates a family only after the fuzzy search found
nothing close; labels are "a separate, later step on the family page" for the
paste box. `DATA-FLOW.md` §The paste box: W608 sets `family`/`variant` "on the
new file (the existing file is left untouched in P1)".
- A. Creating a family in the form writes its French label (the name she
  typed) to `vocab/families.yaml` in the same commit as the recipe; W608's
  "mettre en famille" sets family and variant on both recipes, one commit.
- B. The form writes only the slug (label later on the family page, as the
  paste box does); W608 changes only the new recipe.
- C. A's label; B's W608.
- **Recommended: A.** She types "Tarte au sucre", not `tarte-au-sucre`, and a
  family of one recipe (the other left out) is not a family; "untouched in P1"
  was a P1 limit.

**Q11 — Can she make her own tags? (`PLANNING.md` open question 4)**
`VOCAB.md` §Tags: unknown tag → suggest the closest, else "store it with
`status: pending`"; "Never silently discard a tag she typed". Nothing says who
settles pending tags or where.
- A. Autocomplete over the vocabulary only; no new tag from the form.
- B. Autocomplete, plus "Ajouter « … »" for a tag not in the vocabulary
  (after the closest canonical tag was offered): written in the file as typed,
  indexed as pending (W501); the owner settles it on `/etiquettes` (Phase 8) —
  alias of an existing tag or new canonical tag with its French label in
  `vocab/tags.yaml`.
- C. As B, without `/etiquettes`: the owner edits `vocab/tags.yaml` by hand.
- **Recommended: B.** It is `PLANNING.md`'s own middle ground, keeps the filter
  sidebar clean, and the retag machinery (`tags_hash`) already exists, so the
  screen is small.

### Photos

**Q12 — Key — Photos: how many, and how are they processed? (`PLANNING.md`
open question 5)**
`STORAGE.md`: originals untouched, derived copies in `cache/img/`, HEIC kept
with a JPEG/WebP copy, EXIF rotation on copies. The app has no image library;
Node cannot resize or decode images alone; the prebuilt `sharp` (libvips)
decodes JPEG, PNG, WebP, AVIF, but not HEIC. iPhones usually send JPEG through
a browser upload; a HEIC file can still arrive.
- A. One photo (`media.final`). `sharp` on the server: thumbnail (~400 px) and
  display copy (~1600 px), WebP, rotated, metadata stripped, on upload and on
  demand. JPEG, PNG, WebP, AVIF accepted, 25 MB cap. HEIC stored as the
  original with a placeholder, like today.
- B. As A, plus HEIC decoding (a `sharp` built against a system libvips with
  libheif, or `heic-decode`, pure JS, slow) so HEIC shows.
- C. Resize in the browser (canvas) and upload only the resized JPEG: no native
  dependency, but the original is lost, against `STORAGE.md`.
- D. As A, with several photos per recipe (a gallery, `media.photos`).
- **Recommended: A.** It keeps every `STORAGE.md` rule with one well-supported
  dependency, one photo is what `PLANNING.md` says to start with, and HEIC from a
  browser upload is the rare case.

**Q13 — Does W603 ("no dish photo") come alive?**
Deferred since plan 01 as "meaningless on the paste path"; plan 03 listed it
"until photo upload (P2)". Most recipes will never get a photo, so as a warning
it would sit on nearly every recipe.
- A. It stays deferred; the form and the recipe page show an "Ajouter une
  photo" prompt instead, which is not a diagnostic.
- B. Live, on the recipe page only (not the paste box, not the fix-request
  block).
- C. Removed from `VALIDATION.md`.
- **Recommended: A.** A photo is optional (`RECIPE-SCHEMA.md`: "optional
  photo"), and a warning on thousands of recipes is noise; the prompt does the
  useful part.

### Status and markers

**Q14 — What status does a form save set?**
`DATA-FLOW.md` §Conveniences was written for pastes: status "set by the app on
every paste, never taken from the file … `verified` is set only by a person,
with the 'Vérifié' button". The save path recomputes `draft` / `needs-review`
on every save, so a form edit of a verified recipe would fall back to
`draft`.
- A. An edit keeps the recipe's status, unless an uncertain marker remains
  (`needs-review`); a new form recipe is `draft`; "Vérifié" stays the only way
  to `verified`.
- B. As the paste path: every save recomputes `draft` / `needs-review`; she
  presses "Vérifié" again after each edit.
- C. A form save by a person sets `verified` when no uncertain marker remains
  (the form is a person, not an AI).
- **Recommended: A.** Fixing a typo in a verified recipe should not un-verify
  it, and verifying stays a deliberate act.

**Q15 — How does the form show and settle markers?**
`RECIPE-SCHEMA.md` §Markers: `[?]`, `[?: …]`, `[illisible]` highlighted; `[+]`
distinct; "Clearing a `[?]` in the app (confirming or correcting the reading)
removes the marker from the file." Undefined: what editing a field holding
`[+]` text does, and whether she can add a marker.
- A. The marker syntax is never shown: an uncertain field is highlighted with
  its alternative, "C'est bien ça" removes its uncertain markers, editing the
  field also removes them; `[+]` text is shown in its style and kept as long as
  she leaves that text alone, dropped with it if she deletes it. She cannot add
  markers.
- B. Markers shown as raw text in the fields; she deletes them by hand.
- C. A plus a "Je ne suis pas sûre" toggle that adds `[?]` to a field.
- **Recommended: A.** It is the doc's rule with no syntax to learn, and a
  person reading her own card has no reason to mark her own uncertainty.

### Safety nets

**Q16 — Key — What does undo cover?**
`PLANNING.md` Architecture: "Every save is a commit there, which gives version
history and a real undo — 'restore what it looked like last Tuesday' becomes
a `git show`". Nothing says what the UI offers.
- A. Both: "Annuler" in the toast after each save (the previous file written
  back as a new commit `undo: <title>`, hash-guarded), and a per-recipe
  history page with plain-French summaries and "Revenir à cette version"
  (`restore: <title> (version du …)`).
- B. Only "Annuler" on the last save.
- C. Only the history page.
- D. `git revert` of the commit, shown as "Annuler".
- **Recommended: A.** "Annuler" covers the slip she just made, the history
  covers "last Tuesday", and writing the old text as a new commit through the
  save path never rewrites pushed history.

**Q17 — Drafts, autosave and offline editing.**
Nothing in the docs. The tablet reloads tabs; kitchen wifi is weak
(`PLANNING.md` Kitchen mode).
- A. Autosave the form in the browser (`localStorage`) per recipe, offered back
  on reopening; offline, Save says "pas de connexion, rien n'est perdu" and
  keeps the draft for a later tap. No server-side drafts.
- B. As A, plus a queued save sent by the service worker when the connection
  returns.
- C. Server-side drafts (a draft file per person in the cache).
- D. No autosave.
- **Recommended: A.** Nothing typed is lost and nothing half-done enters the
  vault or git; a queued save (B) could land over someone else's edit with
  nobody watching.

**Q18 — What does she see when her save is refused as stale?**
`DATA-FLOW.md` §Concurrent edit: the save "refuses when the file on disk no
longer has that hash" and "should not be silent". For the paste box, the owner
reads the message; for her, a refusal alone loses her work.
- A. "Cette recette a été modifiée entre-temps" with the other version shown
  beside hers (fields that differ highlighted); her form stays (autosave, Q17);
  she keeps hers ("Garder ma version", a new save against the new hash) or
  takes theirs.
- B. Automatic field-level merge when the two edits touched different fields;
  A only when they overlap.
- C. A lock: a recipe open in the form is read-only for others for 30 minutes.
- **Recommended: A.** Collisions are rare with two writers, A never loses
  either edit, and B's merge code is effort spent on a case that almost never
  happens.
