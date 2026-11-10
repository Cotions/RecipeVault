# RecipeVault — Planning

Status: P1 (read app), P1.5 (ingredients) and P2 (the form write path) built — see
Phases. Last updated 2026-09-28.

## Goal

Archive and digitize a recipe collection — paper cards, clippings, cookbooks,
websites, photos — into a durable, self-hosted archive where every recipe is
easy to find and easy to read. 500 to 5000 recipes.

Input workflow, kept deliberately simple: photograph a paper recipe, give the
photo to any chat AI (ChatGPT free tier, Claude, anything) along with the prompt
from `docs/AI-TEMPLATE.md`, paste the markdown it returns into the app. The app
checks it, saves it, displays it. If the file is not compliant, the app produces a
copy-paste error block to send back to the same chat. **Photos of the old recipes
never enter the app** — they stay on the user's side.

Two kinds of user, different needs (the docs say "she" and "her form" for the
first, from when the plan was written around one person):
- **Main user** (non-technical): browses, cooks from it, and **adds and edits
  recipes** through a form. Never sees markdown.
- **Maintainer**: bulk input, corrections, maintenance. Happy with raw markdown.

## Decisions settled

| Question | Answer |
|---|---|
| Mealie or own build | Own build |
| Source of truth | `recipes/*.md` on disk, frontmatter + body |
| Code vs data | Separate, same pattern as ChannelVault. This repo is app + docs only. Recipes live in a vault folder set by `vault_directory` in the config, with their own git repo. |
| Index | SQLite, derived, regenerable |
| Stack | SvelteKit + better-sqlite3 + FTS5 |
| Volume | 500–5000 recipes |
| Language | Mixed French and English |
| Main user's access | Full read and write, via a form UI |
| Ingredient lines | Structured in frontmatter, not prose |
| Ingredients | First-class objects in `ingredients/<slug>.md` |
| Cost tracking | Yes — price per ingredient pack, cost computed per recipe |

### Why own build, not Mealie

1. **Variant families.** Core to the vision: "lasagna, all types" — bolognaise,
   courgette, végétarienne, the one from the old card — grouped, with a view of
   *what differs*. (The data key is `family`; the UI calls a family's page
   « Variantes ».) Mealie has a flat recipe list and tags; tags tell you two recipes
   share a word, not that they are siblings.
2. **Data outlives the app.** Plain `.md` files: readable in 20 years, greppable,
   diffable, no server needed to read a recipe. Mealie's truth lives in its
   database; export exists but is a second-class path.
3. **Custom fields.** Provenance (who it came from, book and page), review
   status. Mealie's `extras` bag can hold these but
   treats them as second-class in the UI.

Given up: meal planner, shopping list, ingredient scaling, URL import — all
already built in Mealie. Accepted; some are cheap to add later.

Mealie stays a fallback. MD is the truth, so a sync script could push into it if
its features ever outweigh the loss of the variant (family) model.

### Why SvelteKit + SQLite

- One process, one thing to run and back up. No separate API and frontend.
- The pieces that dominate this UI — live preview, a form with repeatable
  ingredient and step rows, a filter sidebar, a virtualized 5000-item list — all
  want genuine client-side reactivity. Svelte does that with the least ceremony,
  and no React re-render pitfalls to fight in the ingredient editor.
- `better-sqlite3` is synchronous and in-process: no connection pool, no second
  container, queries measured in microseconds.
- FTS5 ships inside SQLite. No Elasticsearch, no separate search service.
- Server-side rendering for the read views, so recipes load fast on a phone in a
  kitchen with weak wifi.

FastAPI + HTMX would be less total code and is a fine alternative; the deciding
factor was the ingredient/step form editor, which is genuinely nicer in Svelte.

## Data model

### Code and data are separate

This repository holds the app, the docs, and test fixtures — nothing real. It can
be public. The recipes live in a **vault folder** somewhere else, located the same
way ChannelVault locates its data:

| Thing | Path |
|---|---|
| Config (installed) | `~/.config/recipevault/config.json` |
| Config (from source) | `config.json` at repo root, gitignored |
| Recipes, ingredients, media, index | whatever `vault_directory` points at |

```json
{
  "vault_directory": "/home/cotions/RecipeVault-vault",
  "port": 3370
}
```

Environment overrides: `RECIPEVAULT_CONFIG`, `RECIPEVAULT_PORT`. To run against
throwaway data instead of the real vault:

```bash
RECIPEVAULT_CONFIG=/tmp/rv.json RECIPEVAULT_PORT=3399 npm run dev
```

with `/tmp/rv.json` pointing `vault_directory` at a copy of `tests/fixtures/vault`.

The app never writes inside its own repository. Consequences:
- Updating the app (`git pull`, new container) never touches a recipe.
- The repo can be public; her recipes, notes, and provenance never are.
- The vault is backed up as one folder (see Backup).
- A missing `vault_directory` on startup is an error, not a silent new empty
  vault — otherwise a typo in the path looks exactly like losing everything.

### Vault layout

Full layout, formats, and reasoning: `docs/STORAGE.md`. The vault is also a valid
Obsidian vault — optional power-user view, same files, see `STORAGE.md`. In short — anything
precious is plain text in the vault's git repo; anything in SQLite is rebuildable.

```
recipes/<slug>.md          one file per recipe, Markdown + YAML frontmatter
ingredients/<slug>.md      aliases, category, substitutes — no price
vocab/                     families, tags, units — grows as she uses it
prices.csv                 append-only price history
media/<slug>/              optional dish photo, original never modified
_trash/                    soft-deleted recipes with their media
cache/                     SQLite index + image cache, deletable
```

Flat over nested: renames stay cheap, one file is one recipe, git diffs stay
readable, no directory churn when a recipe joins or leaves a family.

**Families come from frontmatter, not the filesystem:**

```yaml
family: lasagna
variant: bolognaise
```

The app groups by `family` and generates a family page listing every variant with
a diff table — the ingredients unique to each, and the differing times.

**Variant vs. inline note:**
- Separate file when ingredients differ substantially or the method changes.
- Inline `## Variantes` note when it is a swap ("butter instead of oil").

### Ingredients are structured, not prose

Draft 2 of the schema had ingredients as prose bullets, parsed best-effort. That
was wrong. Real lines break it: `huile d'olive, sel, poivre` is three ingredients
on one line with no quantities; `1 gros oignon, émincé` mixes a size descriptor and
a preparation into the name; `2 gousses d'ail` is ambiguous about what the unit is.

Three features depend on getting this exactly right — cost per recipe, pantry
search, ingredient scaling. A 90%-accurate parser means a wrong price and a wrong
search result on one recipe in ten, permanently. So ingredients live in frontmatter
as explicit `{ qty, unit, name, note, prep }` entries, and the pretty prose list is
rendered from them. The "prose is nicer to write" argument does not survive the fact
that an AI writes most of these files and her form writes the rest.

### Ingredients are objects

`ingredients/<slug>.md` per ingredient: every alias in both languages, category,
pack size, price, substitutes, allergens, and a `staple` flag. Recipes reference
ingredients by written `name`; the app resolves that to a canonical slug on save,
and unresolved names go to a queue rather than blocking the save.

This registry is what makes cost, pantry search, and the ingredient view possible
at all. Details: `docs/INGREDIENTS.md`.

Specs: `docs/STORAGE.md` · `docs/RECIPE-SCHEMA.md` · `docs/INGREDIENTS.md` · `docs/VOCAB.md` ·
`docs/AI-TEMPLATE.md` · `docs/VALIDATION.md` · `docs/DATA-FLOW.md`.

## Architecture

Files are the truth. SQLite is a cache that can be deleted.

```
 me: paste MD from AI ─┐
                       ├──> parse ──> validate ──> preview ──> save
 her: form UI ─────────┘                                        │
                                  ┌─────────────────────────────┴────┐
                                  v                                  v
                     recipes/<slug>.md on disk            SQLite index row
                        + git commit (undo)                  (derived)
                                  │                                  │
                                  └────── vault sync rebuilds ───────┘
                                                                     │
                                                   browse / search / filter / families
```

Two input paths, **one parser and one validator**. The form builds a recipe
object, serializes it to markdown, and then runs the exact same save path as a
paste. No second code path to keep in sync, and the form can never produce a file
the parser cannot read.

Save order is not arbitrary: write the file, commit, then index. If the file write
fails nothing is indexed; if the index write fails the file still exists and
`vault sync` recovers it. Never the reverse.

Why the index exists: at 5000 recipes you want instant sort, filter, and full-text
search. SQLite FTS5 answers in under a millisecond. Reading 5000 markdown files
per page load does not.

Why the vault has its own git history: she can edit and delete. The vault folder is
its own git repository, separate from the app's, pushed to a **private** GitHub
repo (`Cotions/RecipeVault-recipes`) as an offsite copy of the text. Every save is a
commit there, which gives version history and a real undo —
"restore what it looked like last Tuesday" becomes a `git show`, not a support
incident. All text is tracked; `media/` and `cache/` are excluded by the vault's
own `.gitignore`, which the app writes when creating a vault. Deletes move the file
and its media folder to `_trash/` rather than unlinking
it.

Details — database schema, paste and form flows, validation, auth:
`docs/DATA-FLOW.md`.

## Search

Four distinct ways in, all served by the same SQLite index:

1. **Full text** — FTS5 over title, body, and ingredient names.
2. **Faceted filter** — family, tags, season, time, servings, difficulty, rating,
   source, author, status.
3. **Pantry search** — "I have eggs and penne, what can I make". Ranked by coverage,
   in three tiers: cookable now, cookable with a substitution, missing one or two
   things. Staple ingredients are excluded from "missing" or every result reads
   "missing salt" and the feature is useless.
4. **By ingredient** — the ingredient view lists every recipe using it, sorted by
   quantity used. The answer to "I have a kilo of courgettes, now what".

Ranking, tiers, and the substitution logic: `docs/INGREDIENTS.md`.

## Cost

Ingredient prices are stored per pack (`400 g for $0.89`), and recipe cost is
computed: the **consumed cost** (pro-rata, what the recipe uses), per serving as
the headline on a recipe page. It is the only figure: a whole-pack *shopping
cost* belonged to the shopping list, which was declined ("Deliberately out of
scope").

Partial pricing is the normal state, so totals always show coverage —
`≈ $4.20 · 9 of 12 ingredients priced` — and never a number that looks complete
when it is not. Mass-to-volume conversion only happens with an explicit density;
otherwise the ingredient counts as unpriceable. A wrong price is worse than an
absent one, because an absent price is visibly absent.

## AI-generated files

Most recipes will be produced by a chat AI from a photo, outside the app — any
provider, including free tiers. So the prompt is a first-class artifact, not
something retyped per session: `docs/AI-TEMPLATE.md`. The app renders it with a copy
button. There is no AI integration inside the app, no API key, and no per-recipe
cost.

When a pasted file fails validation, the error output is designed as **input to the
next AI turn**, not as a message for a human: stable error codes, a path rather than
a line number for every fault, the corrected form shown alongside each complaint,
the whole rejected file included, and a restatement of "return the complete
corrected file, one fence, no explanation". One copy button, paste it back, get a
fixed file. Codes and format: `docs/VALIDATION.md`.

## Kitchen mode

The view she will actually cook from, on a phone or tablet propped against the
backsplash. Everything is designed for wet or floury hands, a glance from a metre
away, and not touching the screen much.

- **Screen stays on.** Wake Lock API while kitchen mode is open. Without this the
  screen locks mid-recipe and she has to unlock with dirty hands — the single most
  annoying failure, and the reason this is a mode rather than a font size. The
  header always says which it is, worded as a state, after a reload too: « ☀
  Écran gardé allumé » (the sun green; « Écran allumé » on a phone) while the
  screen is kept on, a tap lets it sleep; « ☀̸ L'écran peut s'éteindre ·
  Réactiver » (a crossed-out sun; « · Garder allumé » when she let it sleep or
  it was never on) while it is not, a tap asks again; a 44 px target. On a
  phone only the sun and the action fit, the state is the sun, the words at
  14 px at least (under 400 px wide « ← Quitter » keeps only its arrow, named
  for screen readers, so they fit); from 64rem the whole sentence. While the first request is
  still out, nothing shows for 1.5 s (a grant usually comes sooner). A refusal is asked again on her first tap (some browsers
  want one), on every later tap while it is off, and when the page comes back
  into view. Where it still cannot be kept on (plain HTTP, a refusal) there is
  no toggle, and only the header's crossed-out sun and its words say so — no
  note repeats it (UI round 1: a second message for the same state, near the
  step buttons, read as noise). The sun is named for what a tap does (« … · Réactiver », shown as a tooltip on hover or focus), and opens the reason
  (HTTPS and Tailscale, or the browser's refusal) and « Réessayer ». Nothing
  under her finger moves when the screen's state changes: the indicator sits
  before the amount and grows into the header's free space (the amount and ⋯
  keep their place), its reason hangs from the header's right edge, and the
  answer to a request made by a tap (the crossed-out sun) waits
  for that tap's click (600 ms at most, for a swipe), or the click would land
  on what just appeared.
- **Big type.** Readable at arm's length. Nothing else on screen — no navigation,
  no sidebar, no tags. « Taille du texte » in the ⋯ menu (A− / A+, 85 % to
  150 %) scales the step text and its ingredient chips, remembered on the device.
- **Ingredients first, as a checklist.** Tap to tick off while gathering — the
  whole row is the target, 48 px tall at least, and the box itself is a 48 px
  target with a visible square of about 28 px (24 px at least). Grouped
  as in the recipe (sauce, béchamel, montage). Ticks stay on the device
  (`localStorage`) and are never sent to the server.
- **One step at a time.** Current step large; the previous and next steps
  around it (« Avant », « Ensuite ») in the body ink at reading size (18 px),
  two lines at most, their labels (« Avant : », « Pour cette étape »,
  « Ensuite : », a group's « Garniture ») in sentence case, 15 px semibold — small
  capitals read as a form (UI round 1). On a wide screen the step
  is larger (about 49 px at 1366 px, 60 px at most) and sits in the upper part
  of its pane, a little below the top, with its chips and the steps around it
  (dead centre left a band of empty paper above it). The space above it is
  measured on the window, not the pane, so a timer strip
  appearing does not move the step; it gives way only to a step too long to
  fit under it, and a longer one still scrolls.
  Large tap zones: right half of the screen advances, left half goes
  back — no small buttons to hit. Under the step, two big buttons; on step 1 of
  a wide screen there is nothing before it, so « Étape suivante » takes the
  whole row (a phone has « ← Ingrédients » there; later, its back button is
  the arrow over the word « Précédente »). A swipe left or right
  (over 60 px, more across than down) moves a step too. On the last step the big
  button reads « Terminé ✓ »: « Bon appétit ! », then back to the recipe by
  itself after a moment — not while a timer is still on, and not if she taps
  « Recommencer ». A finished cook is not resumed.
- **Phone: two halves, a wide screen: side by side.** On a phone the checklist
  and the steps are two tabs at the top (« Ingrédients 3/12 · Étapes 2/7 »),
  with a big « Commencer » (or « Reprendre à l’étape n ») at the bottom of the
  checklist; going back to the checklist remembers the step. The phone header
  is one row (← Quitter, the screen, the amount, ⋯); the recipe's name
  heads the checklist and the step instead (no second « Ingrédients » heading
  under the tab that says it). The recipe's photo — as often the card as the
  dish — is a small thumbnail button (« Voir la photo ») beside the name, or
  beside « Ingrédients » on a wide screen, never a cropped band: tapped, it
  opens full screen, fitted; a tap zooms to 2.5× around that spot (it then
  scrolls; pinch zoom works too), another fits it again; « Fermer », Escape
  or the backdrop close it. From 1024 px wide (a tablet across,
  a laptop) the checklist sits on the left (about a third) and the steps on the
  right from the start, with no « Commencer » gate. The checklist folds to a
  narrow rail (« Ingrédients (12) », remembered on the device) so the step text
  gets the width.
- **Step's ingredients shown with the step.** "Ajouter l'ail, puis le bœuf" shows
  `2 gousses ail` `500 g bœuf haché` as small chips over the instruction
  (« Pour cette étape »), so on a phone she never flips back to the
  ingredients tab. Matched by ingredient name appearing in the step text
  (singular or plural by the vault's rule; a long name by its head noun:
  « l'eau » is the « eau bouillante » line); a group's name (« la garniture »)
  stands for the group — its lines when it has three or fewer, else one chip
  « Garniture (tout) »; a generic word stands for the lines of its kind (« la
  viande » → porc, bœuf, veau; « les épices »; « une abaisse » → the pastry;
  « saler, poivrer »; « les pâtes » → the pasta); a name in two groups (butter
  in the syrup and the batter) goes with the group the step otherwise works
  in. A line's other names count as its name (the aliases of its registry
  entry, unless another line has that name as its own; a long alias by its
  head noun too, unless that is a generic word: « le piment » finds the
  « poivron vert » line, « la viande » is not narrowed to one line by an
  alias « viande à hamburger »), a word in « -é/-ée/-és/-ées » is a word of
  its own, never one letter off a noun (« plat beurré » does not light
  « beurre », « pâte sucrée » not « sucre »), and a line the
  registry does not know — often a typo on the card (« oigon ») — is found by
  a step word one letter off its head noun (five letters at least, same first
  letter: « l'oignon »). A doneness clause is not a use: « jusqu'à ce que la
  pâte soit dorée » (« until … ») names nothing, so a « Cuire … » step has no
  chips for it. What an earlier step made is shown as that step's product:
  a step that names a kind (« la viande ») a line of which was already used
  in an earlier step, inside a named group of more than one line, or that
  says « le mélange », « la préparation », « l'appareil » after steps that
  worked in a named group, gets that group's chip (« Garniture (tout) »),
  not the one raw line (`matchSteps`). A partial list is worse than none: when the step names
  something the list cannot account for (« le reste », « les ingrédients secs »,
  « les fines herbes » with none in the list, or a food left over: « l'oignon »
  with no line for it), the chips are labelled « Mentionnés »
  instead, with « Tous les ingrédients → » under them (or alone), and the wide
  screen's checklist marks nothing. The matcher is `src/lib/render/steps.ts`
  (unit-tested with invented steps). On a wide screen with the
  checklist open, the step's lines are marked in the checklist itself (bold, a
  red bar on the card's cream, the rest in a softer ink that stays readable, full ink again
  under the pointer or keyboard, scrolled into sight) instead of the chips: the
  same lines twice on one screen would be two places to read, and the list is
  where she ticks them. With the checklist folded to its rail, the chips come back.
- **Servings adjuster at the top,** before starting. Quantities rescale everywhere,
  including in the per-step ingredient lines. Free, because quantities are
  structured. Built in plan 05: amounts a cook can measure, sub-recipes at
  the amount the line needs, amounts written in steps shown scaled beside the
  original (`DATA-FLOW.md`, "Scaling").
- **Timers.** Durations in step text (`25 min`, `1 h`) become tappable. Several can
  run at once, in a strip over the step buttons (in the steps column on a wide
  screen, so the checklist beside it is never covered; over « Commencer » on
  the phone's checklist), in the flow: the step pane ends above it, so the
  step text scrolls clear of it, never under it. On a wide screen the strip
  holds the timers of the other steps only: a timer shows once, inline on its
  own step (below), and in the strip from every other step. Each is one row,
  « Étape 1 · 59:45 » (digits 26 px on a phone, 30 px wide, tabular), a thin
  line across its top that drains, then Pause (▶ Reprendre while paused) and
  ✕ Arrêter, each a 44 px square named with its step for screen readers; the
  label and time go back to that step. On a phone three or more collapse to
  one line « ⏱ 3 minuteurs · 12:30 » that opens them all. Once it rings its
  row turns red, « Terminé », and its buttons are « +1 min » and Arrêter.
  The strip is there only while a timer it shows is on, and starting one
  moves neither the step text nor the step buttons. On « Étape suivante » the
  new step's instruction is brought into sight (scrolled to, if the recap and
  chips over it would push it under the strip), and kept in sight when the
  strip grows. A duration in a step reads as a button: ▶ in a disc
  before it (⏱ while its timer runs). Until she has started a timer once on
  this device, a step with a duration has a one-line caption under it
  (« ↑ Touchez la durée pour lancer un minuteur ») and a ring goes out from
  the duration three times (none with reduced motion), on two visits at most. An alarm sounds when one is done. Survives the screen
  changing steps. A finished timer turns red (« Terminé », a slow pulse, none
  with reduced motion), stays until stopped, and rings again every 20 s for
  three minutes; « +1 min » on it starts a new minute. A range (« 35 à 40
  min ») runs to its upper bound, the safe end for a cake or a roast: its
  chip reads « 39:12 · 35–40 », and at the lower bound it does not ring but
  calls once, softly (one low beep, a short buzz): the chip turns the
  highlight colour, « Vérifier », and its controls open with « 35 min :
  vérifier la cuisson ». She stops it if it is done, or lets it run. The sound
  needs the tap that started the timer (browsers block audio otherwise): after
  a reload, a timer that finishes only shows and vibrates where allowed. A
  timer that finished before this visit (a reload, a return) neither pulses
  nor rings: it reads « Minuteur terminé il y a 12 min » (its row « Terminé
  il y a 12 min ») with « Relancer » (its whole length again) and « Effacer ».
  The current step's own timer shows only there, large under the step text
  (« ⏱ 38:55 », with « 35–40 min » or « En pause » beside it), never over
  it, with Pause / Reprendre, « +1 min » and « Arrêter » (red and first once
  it rings); the strip does not repeat it (UI round 1: the same timer twice
  on one screen). At another amount, « × 2 · temps et four inchangés »
  says on one line, under the step count, that times, the oven and the pans
  are not scaled — on step 1 and on a step that names a time, a temperature
  or a pan, not on every step (`src/lib/render/stepnote.ts`). On
  a wide screen the space above the step is held while that countdown comes
  or goes, so the step does not move. Other recipes' timers on this device
  sit in the same strip as dashed chips (« Tourtière 38:55 ↗ ») that open
  that recipe's kitchen mode at the timer's step, and ring there too.
- **Sub-recipes inline.** A step using pâte brisée can expand the pastry recipe in
  place instead of navigating away — and a sub-recipe's own sub-recipes inside
  it, each at the amount its line needs (`DATA-FLOW.md`, "Scaling").
- **Resumes where she left off** if the tab reloads or the phone switches apps —
  current step and running timers kept in local storage, silently. A session
  untouched for 12 hours is a new cook. On any restore, one small line under
  the step header says so, in the flow — « Repris à l'étape 3 · 12 portions ·
  Recommencer » — and fades after 5 s (not while she points at it or has
  focus in it) or at her first move; its room stays, so the step does not
  move when it goes. Nothing fixed covers « Ensuite » or the step (UI round 1:
  a toast there did).
  Opened from a recipe page where she set another amount, the cook goes on at
  that amount, step, ticks and timers kept, and the line says both (« 16
  portions (avant : 10) »; plan 05, "The address and a resume"). A
  finished cook with a timer still on (« Terminé » with the cake in the oven)
  is resumed at its last step until the timer is stopped. « Recommencer »
  is in the ⋯ menu, the resumed line and « Bon appétit » — not beside the
  step count: the step area is a tap zone (right half: next), and a button
  there turned a tap meant for « next » into a restart. It stops the timers,
  so while one runs a line under the header asks first (« Un minuteur en
  marche · Recommencer quand même · Annuler »), from any of its places. Done,
  one line says so for 4 s (« Cuisine recommencée »); a second tap leaves the
  same fresh cook. The « Étapes » tab always counts out of the total (« 0/4 »). The session also saves the step count
  and the recipe's title, for the cook chip.
- **The cook follows her around the app.** While a session on this device has
  a timer on, or a step to resume, every page's header carries one compact
  chip in its own row (« ⏱ 39:12 », the recipe's name in its accessible name
  and title, shown beside the time from 80rem; under 80rem the wordmark keeps
  only its mark while she cooks, so the header never wraps). Its width is
  fixed and taken before the first paint (an inline script in `app.html`
  reads the same storage, `cookflag.test.ts` keeps it in step), so nothing
  shifts on load. It shows the timer that rings soonest (ringing
  first, then a range to check, then the soonest, then a paused one), or
  « ↩ Étape 4 » for a step to resume, « +1 » when other recipes cook too: a
  tap on it lists them all, each a link to its kitchen with « × Terminer »
  (that session goes from the device; one untouched for 12 h is no longer
  listed). A tap goes back to kitchen mode at the timer's step
  (`/r/<slug>/cuisine?etape=4`, 1-based, dropped from the address once
  read). A timer that rings while she reads another page turns the chip red
  (« TERMINÉ », a slow pulse, none with reduced motion) and sounds the
  kitchen's alarm, again every 20 s for three minutes; a range's lower bound
  turns it the highlight colour (« Vérifier ») with the soft call. One that
  rang while no page was open shows red but does not sound late. The pulse
  stops after 30 s, leaving a still red mark; a rung timer is forgotten once
  seen (on its recipe's kitchen mode, or the chip's ×) or 30 min later.
  Signing out clears this device's kitchen sessions and the chip. A step-only chip has a × (« Masquer »,
  remembered until that session changes) and is not shown on that recipe's
  own page, whose « Cuisiner » button already reads « Reprendre ». Not in
  kitchen mode itself. Read from local storage in the browser only
  (`lib/kitchensession.ts`, `CookChip.svelte`); other tabs update it.
- **Works offline** once opened. Kitchen wifi is often the worst in the house; the
  recipe and its images are cached on open.
- **Dark mode option,** high contrast either way.
- **Oven temperature in both units.** Old Quebec cards are all °F (`oven:` field);
  kitchen mode shows `350 °F · 180 °C`.
- **Fractions displayed as fractions.** `"2/3"` shows as ⅔ tasse, never 0.667.

Wake Lock needs HTTPS (or `localhost`) to work in browsers. On a LAN-only setup
over plain HTTP it silently does nothing — one more reason for the reverse proxy
with a certificate, or reaching the app through Tailscale, which provides HTTPS
names.

## Page layout

Desktop first (1280–1440 wide), the phone a check that nothing breaks — except
the recipe page and kitchen mode, which are read on a phone at the counter.

- **One page head.** Every page opens with the same head (`PageHead.svelte`): a
  way back when it sits under another page, the title, its count beside it, the
  page's actions on the right, the intro under it.
- **Primary action out, the rest in ⋯.** A page shows its one or two main
  actions as buttons; the secondary ones go in a ⋯ menu (`Menu.svelte`, a
  `<details>`, so it works without JavaScript; its items are 44 px tall on a
  phone or a touch screen). The header keeps the four
  places one goes to every day (Recettes, Variantes, Ingrédients,
  Garde-manger) and « Nouvelle recette »; the work queues (À relier,
  Étiquettes, Doublons), Ajouter, Corbeille and the account sit in « Plus »,
  each queue always on its row, in the same place (a queue that empties keeps
  its row, with nothing after it), and after its name the backlog's total in the
  soft ink for À relier and Doublons, then what is new and waits for her
  (« Étiquettes · 3 à décider », « Doublons · 74 · 1 nouveau », « À relier · 70 »;
  UI round 2: a backlog with no number anywhere read as nothing to do). These are backlogs (on an archive being typed in, À relier holds
  about every recipe and Doublons hundreds of cards), so the button does not
  carry their size: a count that never clears is noise. It says only what
  waits for a decision and is new (decided in the round-5 UI pass, revised in
  the organize pass): every pending tag (each one is new until accepted,
  linked or removed), plus the duplicate cards holding a recipe saved after
  this device's mark. The mark is a cookie (`rv-vu`, the index's highest
  recipe id when the device first came, `lib/server/seen.ts`); a new card
  counts until decided or seen — /doublons sorts the new cards first and,
  once its first page has shown them all, moves the mark up (usability round
  4; before, only deciding cleared it, and « 1 nouveau » pointed at a card on
  another page). « Plus · 3 », 99+ at most, on the phone's Plus button too.
  À relier never counts on the button (every new recipe adds names to it).
  When nothing is new, the button carries no mark at all: round 3's quiet dot
  for the backlogs said nothing to a thumb (usability round 4), and each line
  of the menu says its own count. Corbeille shows only when signed in, and
  « Plus » itself only when it holds something (signed out with no queue:
  nothing). The number is text in navy small caps after a middle dot
  (« Plus · 3 »), not a coloured badge. It is never a bare number (usability
  round 2: « 1 élément à décider » beside 50 doublons and 64 names read as
  « everything left »): the button's tooltip and what a screen reader hears
  say what it counts, by kind (« Plus — 2 étiquettes à décider et 1 doublon
  nouveau »), and in the menu each line's count is in ink, sentence case
  (« Étiquettes · 2 à décider », « Doublons · 1 nouveau »): they add up to the
  button's. The current
  place is marked the tabs' way, an ink line under it — under « Nouvelle
  recette » on /nouvelle and /ajouter, under « Plus » on its pages — never a
  pressed button. The app has a name of its own, « Boîte à recettes »
  (`t.app.name`, also the end of every page title), with its mark, a card
  standing in a navy box; « Recettes » is the tab.
- **The recipe page is the calmest page.** Ingredients and steps come first.
  The head reads: « Une des 4 variantes de Tourtière » (the family, a link;
  one word, « variante », for sibling recipes on the whole page, as in
  « Autres variantes » under the sheet; the method's own « Variantes » head
  is the cook's text from the file, shown as a small label inside the sheet;
  the variant's own label after it, « — sans porc », unless it only repeats
  the author the provenance names; usability round 3),
  the title, then the provenance as the page's signature (an italic serif
  line with a small drawing of the kind of source: a card, a book, a
  clipping, a site, a show), then the facts in one row. Cuisiner,
  Modifier and ⋯ make one row level with the title on a wide screen; on a
  phone Cuisiner runs the width under the facts and Modifier joins « Ajouter
  une photo », Imprimer, Historique, « Voir le fichier » (Markdown accounts,
  a dialog), « Marquer vérifiée » and Supprimer in the ⋯ menu, so the
  ingredients start inside the first screen. The photo or scan is a print
  (white border, a paper shadow, a slight tilt on a wide screen): with one,
  the wide head is two columns — the family line, title, provenance, facts,
  tags and Cuisiner · Modifier · ⋯ at the left, the print at the right,
  whole (a card across or a book page up) within ~232 × 256 px, « Voir la
  photo en grand » under it — so the facts no longer wait under the photo and
  the ingredients start higher; without one, a single column with the
  actions level with the title. Up to 56rem (round-5 UI pass) the print is a
  small square, ~88 px, beside the title, the family line across the width
  above both, so the facts, Cuisiner and the first ingredients reach the
  first screen of a phone; on a phone the tags move after the method (ways
  into the list, not the recipe). The small print shows its top (where a
  card's title is), a small enlarge mark at its corner; it was a 120 px strip
  across the width under the title. Tapped, it opens full in a dialog.
  Ingredients tick off while gathering: a small box at each row's start (or
  a tap on the row's plain text) strikes the line through, kept for the tab's
  session per recipe, never printed, with « Tout décocher » under the list.
  A box rather than the whole row because most of a row already answers a
  tap: the amount scales, the name opens its ingredient. The cost line is a
  footnote of the method, after the steps, notes and variants, in the
  ingredients' sans at 14 px and one weight: « Coût estimé : ≈ 20,26 $ ·
  2,53 $ par portion », and the coverage as the disclosure that holds the
  detail (« 9 ingrédients sur 15 ont un prix »: the lines without a price,
  each with why, then the priced ones). Below the threshold only the
  archive's keeper (the Markdown tools) sees « Coût estimé : pas assez de
  prix »; a family account sees no cost line until there is a figure.
  `[+]` reads as a small pencil chip, « ajouté », its title and the legend
  at the sheet's foot saying the rest (« absent de l’original, ajouté à la
  transcription »). In a title on the home page and the lists (round 4) it
  is a small pencil « + » raised after the word, the same title on hover and
  « ajouté » for a screen reader; never the raw brackets. Variantes speak in the steps' voice (serif, full size,
  full ink) under a small capitals label like Notes', a hairline above.
  On a phone the scaler sits on the Ingrédients heading's line when both
  fit, else on its own line, « Autre quantité » as its last chip (« Autre… »,
  a word, not a bare « … »). Once the head's Cuisiner has scrolled out of
  sight, the phone's bottom bar carries it as a fifth cell in ink beside the
  four tabs (the bar still slides away while reading down and comes back at
  the first move up), so Cuisiner is a flick away anywhere on the page. The
  cost's coverage says where the lines the page does not list come from: a
  sub-recipe is one line on the page and its own lines in the count, « 9
  ingrédients sur 15 ont un prix (dont 5 dans Pâte brisée) ».
  The archive's upkeep is the keeper's alone (the Markdown tools) and says
  itself in one quiet line above the family line and the title, under the
  red rule: the state's badge, one short reason, « Marquer vérifiée » when
  nothing is uncertain, and « 2 ingrédients à relier », which opens the list
  of unlinked names at the sheet's foot, each with « Relier › » to its row in
  the queue (usability round 3). There is no word after each unlinked line
  any more (« pas encore relié » under names read as part of the recipe).
  A draft reads « Brouillon · La famille la voit déjà ; « Marquer vérifiée »
  dit qu’elle a été relue contre la fiche. » A draft with nothing to read it
  against — no source, an invented one or a source with no field, and no
  photo — reads « Saisie sans fiche d’origine · La famille la voit déjà ;
  « Marquer vérifiée » dit seulement qu’elle a été relue. » (round 4: plainer
  than « Pas de fiche originale », which read as something missing): only the
  words change, the file's `status: draft` and what
  verifying means stay as they are. Verified says nothing (the calm state),
  so the line is there only when something waits. The family account sees
  none of it: no badge, no reason, no link to the queue. Setting the amount
  on a phone: the servings count is itself a button that opens « Pour [..]
  portions », and × ½ × 2 × 3 stand at the right of the « Quantités d’origine »
  line at every width (round 4; was « Recette originale », read as the card) (plan 05, « Help around scaled amounts »). « Reprendre ·
  étape 4 » adds the kitchen session's amount when it differs from the page's
  (« · 10 portions »).
- **Notes are the archive's voice.** A Notes section is a « note de famille »:
  a tinted slip with a pen rule in ink (not red), the text at 18 px italic
  serif in full ink, signed « — Francine » when the recipe is a person's
  (a family card or a source of unknown kind with an author; never a book's
  author or publisher).
- **Phone: the tab bar makes room.** On a recipe page it slides away while
  reading down and comes back at the first move up or near the top; never
  while focus is in it, and without the slide under reduced motion. On the
  form pages (/nouvelle, /ajouter, /…/modifier) the save bar takes the bottom
  and there is no tab bar: the four pages (Recettes, Variantes, Ingrédients,
  Garde-manger) head the « Plus » menu there instead, 44 px rows over a rule
  (usability round 5) — no extra button, the header stays one row.
- **The red rule means the card.** On the recipe page: the sheet's top edge,
  Ingrédients and Préparation; elsewhere the site header, kitchen mode and
  errors. Not links (navy underline at 40 %), not step bullets (ink), not a
  scaled amount (ink on a pale ground), not the « Plus » count (navy small caps:
  things waiting are not errors). Variantes gets a hairline and a small
  label, not the rule. « Autres variantes » shows three, then « Voir les n
  autres ».
- **The list is the drawer.** One cream card of ruled rows, at every width:
  at the row's start a small drawing of the kind of source (the recipe page's
  set: a card with its red rule, a book, a clipping, a site, a show, a
  pencil; a plain card with dashed lines when the recipe does not say;
  `SourceGlyph`, in ink, named on hover and to a screen reader: « Livre »,
  « Magazine »… as in the Provenance filter), then the title (serif, 18 px,
  two lines at most) and after its last word the family count « ⧉ 3 » (the
  Variantes tab's drawing; the words « 3 variantes » for a screen reader) —
  plain words, not a link: the row is one target, its recipe, whose page
  links the family (a link nested in the row was a 28 × 17 px target), then
  one quieter line « de Tante Aline · Dessert · Automne · 6 portions » — who
  it is from, the name in ink, then the course (the first course tag it has)
  and its seasons when it has one or two; a course or season the list is
  filtered by goes unsaid, and who it is from keeps at least 40 % of the line
  (servings dropped on a narrow row, the season after a course on a phone):
  the family count never takes the author's room. The total time stands in
  a right-hand column of its own on every row, the same grid track on every
  row kind (a row, a same-title group's line, phone or desktop), so the eye
  runs down the times — 129 desserts scan as « Automne · 40 min ». No other
  tags on the rows: on a box of desserts they say little; a tag a search
  found sits in that line, marked (« de Lise B. · **Dessert** »), never on a
  line of its own, and not at all when it is a filter. Rows with the same title
  are one entry, like a book's index under one word: a pile of cards and the
  title once, « Carrés aux dattes 3 fiches » — plain words, not a link — or
  « ⧉ 5 variantes » linking to the variants' page when they all belong to it
  (the group's head is no row's link, so this one stays a link, 44 px under a
  finger). Searching, a group's lines keep the search's order: no recipe is
  marked « notre version », since nothing in a file says which version is the
  family's own (an author is free text, there is no default per family).
  Two words for two things: « fiches » counts the cards filed under one title
  (any family or none); « variantes » is always the family, a link, as on the
  recipe page's « Une des 4 variantes de … » and the Variantes tab. Then,
  indented under it behind an `--edge` rule, a line per
  recipe that leads with its drawing and who it is from, the name in bold — or
  « Provenance inconnue » in italics when the recipe says nothing of where it
  is from (else its `variant:` name), then its own « ⧉ 3 » — plain words, not
  a link: the line is one 44 px target, its recipe — when it belongs to a
  family the group's head does not name. Searching, the same titles are
  brought together where the best placed of them ranked. No legend under
  the list: each drawing carries its name (its title, read out). A row of its
  own leaves out « de X » when its title already ends with that name (« Tarte
  de Matante Ginette »; case, accents, markers aside — `rowProvenance`); a
  same-title group's line keeps it. On a phone the provenance line wraps to
  two lines at most, never « Tiré de Cuisine f… », the time keeping its
  column. Every row keeps one rhythm: a scan
  sits only on a wide one-column row (before the time) as a strip (96 × 40)
  of its top-left corner, enlarged, where a card's or a page's title is
  written; in the drawer's two columns, on a phone and on a same-title
  group's line there is none — it would push the title onto a second line or
  cut the provenance; the scans are on the idea cards and on the recipe
  page. Most cards have no photo: no placeholder images on rows. On
  a wide screen the drawer has two columns read like a book's index — down
  the first, then the second — so a letter's tab sits in the flow and a short
  letter leaves no hole; sorted by title the page sets where the second
  column starts (about half way, counting a group by its lines), and a
  letter that runs on opens it with its tab again, « B (suite) » (also at the
  top of a page that starts inside a letter). A letter's tab is an index
  card's: a buff tab with the serif capital in ink, on an `--edge` rule.
  About twenty-four rows show at once, forty-eight to a page — sorted by
  title, the page breaks where a letter changes when one is within 30 % of
  that, else where the first word changes, and a rest that fits stays on the
  last page. The letter strip lists only the letters that have recipes.
  Over the index, on the first page of the whole box (no search,
  no filter), under 60 rem (where the filters fold behind « Filtres » — a
  wider screen has them beside the list, so no chip repeats them), a row of
  filters to tap without opening « Filtres » — Plat
  principal · Dessert · Rapide · 30 min · De saison · automne, each only when
  it narrows the box (on a phone the row scrolls sideways and fades
  out over its last 3.5 rem, so a cut chip reads as « more this way ») —
  then a visible head « Des idées », with « Avec ce que j'ai › » (the pantry
  search, another page) at its right, and up to six compact cream index cards of ideas: « Une
  fiche au hasard » (its scan when there is one; under the title, two lines at
  most of provenance · time · course; « ↻ Une autre » draws another of twelve
  sent with the page), « De saison · automne » (three of the season's; the
  whole head, « De saison · automne — Les n › », is the link to all of them;
  Québec seasons: déc.–févr. hiver, mars–mai printemps, juin–août été,
  sept.–nov. automne), three ways in read off the files — « Longs mijotés ·
  plus de 2 h » (main dishes over 2 h total; « Les n › » is
  `?tag=plat-principal&temps=plus`), « Pour une tablée · 7 et plus »
  (`?portions=7+`, the Portions facet's top bucket, so the link holds exactly
  what the card draws from) and « Les mieux notées » (rating 4 or 5; « Toutes
  › » is the list sorted by note), each three at random and shown only when
  it holds three at least — and « Ajoutées récemment » (the last three; the head
  « … — Toutes › » leads to the list by date added). There is no « pas
  cuisinée depuis longtemps »: nothing records when a recipe was cooked (the
  history is of the file), and a card must not claim what the box does not
  know. On a wide screen one row of three shows — the random card, the
  season's, the first rail that holds enough (« Longs mijotés » first) — and a
  quiet « Plus d'idées » shows the others in place, under them. Each idea is two lines,
  the title then provenance · time · course (the first course tag of the seed
  vocabulary it has: plat principal, entrée, dessert…), with a small thumbnail
  where there is a photo. On a phone the cards scroll sideways, each about
  80 % wide, with a dot per card under them for the one in view, so the index
  starts right under them; the index stays. The owner's review state follows the title as a
  word in small capitals (« à relire »), never a bare dot — on the rows only
  while the État filter is on (on a third of the box it competed with the
  titles; the recipe page always says it); a broken file is marked always, an alarm; a family account
  sees none of it, nor État, « Ingrédients à relier » or the files that fail.
  Searching, the rows whose title holds a word come first; the rest follow
  under the reason they were found (« Dans les ingrédients de n recettes »,
  then étiquettes, provenance, texte, and last « Mentionnent aussi « mot » » for a word
  only a note mentions; see DATA-FLOW; each a quiet heading in the sans and
  the soft ink, plainly not more of the results above) in
  quieter drawers (a muted paper, no shadow), the same rows plus one line of
  where the words are. Over the results, one line says how many (« 12
  recettes pour « tourti » ») with the sort beside it, and the active filters
  as chips, a dashed « Tout effacer » chip first, then each with its ×. On a phone,
  under the search box, one row: « Filtres » (with how many are on), then how
  many recipes and their order (« 320 recettes · par titre ») — or, with
  filters on, the count, then under it « Tout effacer » (first, 44 px) and
  the active filters as chips, wrapping onto as many lines as they need —
  every one in sight, none cut at the edge (they are few); the first recipe
  starts about 150 px under the header. The sort is the first thing in the
  filter sheet; its head stays put with a 44 px ✕, Escape closes it (focus back
  on « Filtres »), « Voir les recettes » sits under the last group, never over
  it, and opening a group shifts nothing above it. A facet counts within the
  current list; a value that would leave nothing shows greyed with 0, last —
  except right after a tap on a value: every group then keeps the order it
  was shown in, so the value tapped stays under the finger, until the next
  navigation that is not a filter's.
  Nothing found: with filters on, they show as chips with « Tout effacer » and
  « Sans les filtres : n recettes »; with a search alone of several words,
  « Aucune recette avec tous les mots. » and each word alone with its count
  (« « carrot » seul : 27 recettes › », a link when it finds some); of one
  word, one line to check the spelling. A word that stands for several
  ingredients (« poivron ») adds « Aussi : piment vert (40) · piment rouge
  (17) » over the count, each a link that narrows the list; a name the word
  heads without meaning it (« piment de la Jamaïque », allspice, for
  « piment ») is not among the results and comes last in the plain weight,
  « · piment de la Jamaïque (2) », a link to its own search. Sorted by note,
  each row shows its « ★ 4 »; the « Note » sort is offered only when a recipe
  of the box has a rating. On a wide screen the filter column stays beside
  the list as it scrolls (sticky, with a scroll of its own). While the search box has the focus (and is empty), a row of at
  most three filters read off the list shows under it (its two most used
  tags, the shortest time that narrows it, a season if there is room). The
  filter groups run Étiquettes, Temps total — open — then Variantes, Saison,
  Portions, Provenance, Auteur, folded unless one of their values is on; each
  shows its top four, then « + n autres ». On a wide screen the active
  filters sit over the count. Sorted by title, the letters on a wide screen
  mark the ones on this page (underlined in ink) and lead to the page of the
  others, at the letter; on a phone the letters that have recipes run down
  the right edge in a gutter of their own, from under the search box (where
  the header leaves it: measured at load and when the header or the window
  changes size — a running timer's pill makes the header taller — never while
  scrolling) to over the tab bar, each as tall as that allows (about 32 px with twenty letters):
  tap one, or slide a finger along them — the letter shows large just left of
  the finger, the list follows on this page and the page of the letter loads
  on release. The pager names each page by its guide words, like a
  dictionary's: the letters alone where two pages meet between letters, as
  many as it takes where they meet inside one (« A–Ca · Ch–F · G–L · M–Pai ·
  Pat–R »), never two pages alike; the current one in ink; by number when
  not sorted by title; a long list keeps the first two, the last two and
  those around this one. On a phone the pages are one row that scrolls
  sideways (this page brought into it), never one alone on a second line.
  Then « Précédentes · Page 2 sur 7, Titres de Ch à F · Suivantes ».
  A variant's page names each version by who it is from; its `variant:` name
  only when that says something more.
- **Quiet signals.** A scalable amount has no underline: the scaler says it
  once (the same pill whether by servings or by « × n », 44 px targets), with a
  hint the first time on a device: one muted line under the scaler, in the
  flow, never over the list (« Astuce : touchez une quantité pour tout
  ajuster · Compris »), never in the paste preview; gone at « Compris », the
  first amount tapped or the first change of amount. Only real links
  underline, in navy over a faded navy line. Selects everywhere are drawn in
  the cream and ink with their own chevron (app.css), still native. The
  header's « Nouvelle recette » is an outlined button (a « + » on a phone),
  underlined as current on the pages that write a new recipe; the filled ink is for
  Cuisiner and Enregistrer. The steps' style (bullets by default, issue #5) is
  a small two-part pill on Préparation's head, both choices in sight, the one
  in use pressed in ink: « • Puces | 1. Numéros ». Bulleted steps get a
  paragraph of air between them and a firm ink dot on their first line.
- **Two accents, the ink and the red rule.** Notes, tips, notices and panels
  are paper: a warm tint (`--info-bg`) with an ink rule at the left
  (`--info-edge`) or an `--edge` border, never a pastel blue; « saved »
  flashes `--ok-bg`. Highlighter yellow is for uncertain readings only.
  Secondary text is `--ink-soft` (≈ 8:1 on the card) and nothing that is
  read is under 15 px (`--step--1`); only capitals labels and counts are
  smaller.
- **Long lists are capped.** A list that can run to a hundred rows (the
  recipes using an ingredient) shows a dozen and a « n de plus » button.
- **Images in fixed boxes.** A photo never sets the height of what is around
  it: fixed aspect boxes, `object-fit: cover`. The one exception is the
  recipe page's print, shown whole (it may be the card itself) within a
  bounding box of ~232 × 256 px beside the head on a wide screen; on a phone
  it is a fixed 120 px strip, cropped from the top.
- **Button sizes.** A button is at least 40 px high on a wide screen and 44 px
  on a phone or a touch screen; only links inside a sentence are smaller. On
  the form (`/nouvelle`, `/r/<slug>/modifier`) a phone keeps Enregistrer in a
  bar at the bottom of the screen, « Il manque : … » beside it going to the
  field; the bar steps back into the flow while she types, so it never covers
  the box she is in (`docs/plans/04-write-path.md`, usability round 3).

## Bilingual handling

Recipes will be a mix of French and English. Decisions:

- Frontmatter **keys** stay English always. Values may be either language.
- `lang: fr | en` per recipe, default `fr`. Drives which UI labels render
  alongside it and which heading names the serializer writes back.
- The parser accepts heading aliases in both languages
  (`## Ingrédients` or `## Ingredients`, `## Préparation` or `## Instructions`).
  See `docs/RECIPE-SCHEMA.md`.
- FTS5 with `remove_diacritics 2`, so `boeuf` finds `bœuf` and `creme` finds
  `crème`.
- **Tags and families need a controlled vocabulary with aliases.** Free-text tags
  across two languages at 5000 recipes fragments into `four` / `oven` / `baked`
  describing one thing, and the filter sidebar becomes useless. Canonical term
  plus alias list, defined in `docs/VOCAB.md`; input maps to canonical, display
  uses the reader's language.

## What 5000 recipes changes

Numbers to design against:

- **List views** — never render 5000 cards. Paginate or virtualize from day one.
- **Images** — optional dish photos only, up to ~5000. Thumbnails generated on
  upload, cached to disk, lazy loaded. Full-size phone photos in a
  grid is unusable. Handle EXIF rotation — phone photos arrive sideways.
- **Duplicates** — the same recipe gets pasted twice, guaranteed. Slug collision
  is a hard block; a near-identical title is a warning; nearly the same
  ingredients under another title is a warning too (`W505`), and the vault's
  pairs are listed on `/doublons` (plan 05).
- **Families get big** — 30 variants of tarte is plausible. Family pages need
  their own filtering, not just a list.
- **`vault sync`** — hash files, reparse only what changed. A no-op sync over 5000
  files is then a couple of seconds. Run it on startup.
- **Paste speed matters.** Every recipe goes through the paste box, so the loop
  must be fast: paste, see it valid, save, next — one keyboard shortcut each, the
  box cleared and focused again after saving. When invalid, the fix block is one
  click to copy.

## Phases

**P0 — schema validation**
Run 10-15 real recipes through the chat AI with the template and check the output
with the validator (the first code built, as a command line tool). Pick awkward ones on
purpose: a handwritten card, one with sub-recipes (sauce + pasta), a page that is
really three variants, one from a book, one clipped from a magazine, one in
English, one with vague quantities. The schema was designed in a vacuum, so it is
wrong somewhere; real recipes say where. More important at 5000 recipes, not less — a schema mistake found at
recipe 400 is a migration.

**P1 — read app** — *built 2026-09-27 (`docs/plans/02-read-app.md`).*
Browse, search, filter, sort. Family pages with the variant diff table. Recipe
page. Print view (she will want paper in the kitchen). Mobile first. Plus the
paste box with validation and the fix-request block, and `vault sync`. Kitchen
mode — see its section above. Also: web import (schema.org JSON-LD), the
« Marquer vérifiée » action (an AI file is never auto-verified), soft delete and the
trash, a codes-only paste log with `vault stats`, and an offline service worker
for kitchen mode. The UI is in French, all strings in `src/lib/i18n/fr.ts`.

**P1.5 — ingredients** — *built 2026-09-27 (`docs/plans/03-ingredients.md`).*
Registry, name resolution with the resolve queue, ingredient view, ingredient index
with inline price editing, pantry search, cost on the recipe page. Planned for
after the read app, because resolution quality depends on having a few hundred
real recipes to resolve against. The owner chose not to wait: an invented corpus
of 320 Québécois cards (`tests/fixtures/corpus/`) with an answer key stood in,
and the owner runs `vault sync` on the real vault. Built: a seed registry of 268
entries (`docs/INGREDIENTS-SEED.yaml`, `vault ingredients seed`), resolution by
alias, plural rules and disambiguation rules (never by fuzzy match), the resolve
queue (`/resoudre`, `vault queue`), `prices.csv` with inline entry
(`/ingredients`), consumed cost with coverage, the ingredient view
(`/ingredients/<slug>`, with "Fusionner dans…"), pantry search
(`/garde-manger`), and the checker codes that waited for the registry and
vocabularies (W302–W305, W501, W502, W606, W607). All 26 open questions of the
plan were decided; each is recorded in the doc it concerns.

Soft delete and the trash (`/corbeille`) come forward from P2 into P1: a paste
box without delete forces hand-editing the vault for every mistake.

**P2 — her write path** — *built 2026-09-28 (`docs/plans/04-write-path.md`).*
Form UI: repeatable ingredient and step rows, family picker showing existing
families, photo upload from a phone, no markdown anywhere. Undo via git. Auth. This is a substantial chunk of work — it is deliberately after the read
app so the data model is proven before building forms on top of it.
Built: an account per person (`vault user add`, `users.json` beside the
config, argon2id; sessions in `cache/sessions.db`), reading open and every
write signed in and committed under that person's name; the form
(`/nouvelle`, `/r/<slug>/modifier`) over a form model that round-trips every
fixture and corpus file byte for byte, entering the paste's save path, with
hints instead of codes, drafts in the browser and a side-by-side view when the
recipe changed meanwhile; one dish photo per recipe (original untouched in
`media/`, derived WebP copies in `cache/img/`, never the original served);
"Annuler" after every save and a per-recipe history with "Revenir à cette
version", both as new commits; pending tags settled on `/etiquettes`, with
labels in `vocab/tag-labels.yaml`. All 18 open questions of the plan took the
recommended option; each is recorded in the doc it concerns.

**P3 — only if actually wanted**
Ingredient scaling (the structured quantities already make this nearly free),
meal planner, price history charts. **Scaling built** (plan 05,
`docs/plans/05-scaling-duplicates.md`): a recipe read at another amount shows
amounts a cook can measure (the vault's `vocab/scaling.yaml`: fractions per
unit, a kitchen ladder, metric steps, `≈` when rounded), the amount in the
page's address, set by the stepper, a free factor or by tapping an ingredient's
amount; sub-recipes at the amount the line needs; amounts written in steps shown
scaled beside the original; nothing scaled is ever written (`DATA-FLOW.md`,
"Scaling"). The shopping list was declined (see "Deliberately out of scope").
Meal planner and price history charts: not chosen.

## Open questions

1. **Hosting** — *decided 2026-09-27 (plan 02):* home network plus Tailscale.
   The app listens on the LAN; outside access and HTTPS come from
   `tailscale serve` (HTTPS is also what makes Wake Lock work in kitchen mode).
   No public exposure. No login in P1 — acceptable only because the network is
   the boundary; commits are attributed to `git_author` from the config.
   Accounts came in P2 (plan 04, Q1 A, Q2 B): one per person, reading open,
   every write signed in and attributed. See `docs/DEPLOY.md` and
   `docs/DATA-FLOW.md`.
2. **Currency and shop** — *decided 2026-09-27 (plan 03, Q7 and decision 2):*
   one current price per ingredient, the latest row of `prices.csv` whatever the
   shop; the shop is a label shown next to it. Comparing shops is a different
   app. Currency and shops come from the config, not the code: `currency`
   (default `CAD`) is the one prices are costed in (a row in another currency is
   kept and shown, never costed), `locale` (default `fr-CA`) formats money, and
   shop names are free text, suggested from those already in `prices.csv` plus
   an optional `shops` list. Taxes are not modelled: basic groceries are
   zero-rated. See `docs/STORAGE.md` ("Prices") and `docs/DEPLOY.md`.
3. **Who prices ingredients?** — *decided 2026-09-27 (plan 03, Q8 and Q9):* she
   does, by hand, inline on the ingredient index (`/ingredients`), sorted by
   "used in most recipes, not priced" — the first 50 entries give most of the
   value. One row appended and one commit per price. No scraping (fragile and
   shop-dependent). Hand-editing `prices.csv` in a spreadsheet also works; a
   bulk "receipt" mode can come later if entry proves tedious.
4. **Does she want her own tags?** — *decided 2026-09-28 (plan 04, Q11 B):* the
   middle ground. A controlled vocabulary keeps filters usable but means she
   cannot invent a tag freely, so she proposes: the form writes her tag as typed,
   the index holds it as pending, and it is settled on `/etiquettes` — a new
   canonical tag with its label, an alias of an existing one, or removed
   (`VOCAB.md`, "Tags").
5. **Photo per recipe, or several?** — *decided 2026-09-28 (plan 04, Q12 A):*
   one, `media.final`. Processed with `sharp` (thumbnail and display copy, WebP,
   rotated, metadata stripped); HEIC is stored but shown as a placeholder. The
   schema still allows more `media` keys, which the form keeps
   (`STORAGE.md`, "Media").

## P0 findings — 2026-09-27

Ten real recipes run through a free chat AI with template draft 1: handwritten
family cards (some 35+ years old), a magazine clipping, a printed recipe website
page, a printed TV show page. The AI mostly followed the template correctly; the
template was wrong.

**The collection is Québécois, and the template was written for France.** Cups,
pounds, °F, *c. à thé*, *piment vert*, *fèves*, brand-name products (St-Hubert,
Minute Rice, Cool Whip). With no `cup` or `lb` unit, most quantities on the cards
ended up as text in `note` — invisible to cost, scaling, and pantry search.
Currency is CAD.

Everything found, and the fix for each, is the table at the end of
`docs/AI-TEMPLATE.md`. Headlines:

- Imperial units added; Quebec abbreviations spelled out in the prompt.
- Fractions stay as written (`"1 1/2"`), not converted to decimals by the AI.
- Uncertainty as four fixed markers — `[?]`, `[?: other]`, `[illisible]`, `[+]` —
  instead of free prose. The app highlights them and derives `needs-review`.
- **Inference policy.** Cards skip obvious steps ("mix everything") and name
  ingredients only in the steps. The AI may fill in the obvious, marked `[+]`,
  shown in a distinct style so her original is always visible as original. It may
  never invent quantities, times, temperatures, or people — it asks instead, in a
  `QUESTIONS` section after the fences, which the paste box ignores.
- New fields: `brand`, `or`, `alt`, optional groups, `oven`, `servings_max`,
  `yield`. One duration format.
- The app, not the AI, sets `status`, `added`, and family membership — the AI
  sees one card, the app sees the whole vault.

Readings to confirm (a person or a name) are for her, not for the template.

**Round 2** — the same ten re-run with template draft 2: roughly 90% clean. Units,
fractions, times, oven temperatures, markers, and dual measures all came back
right. Six small remaining issues fixed in template draft 3 (alternatives with
their own amounts, over-eager brand splitting, `[+]` on moved ingredients — see
the round 2 table in `docs/AI-TEMPLATE.md`). The format is considered settled;
changes from here are additive.

The twenty inbox files (both rounds) stay in the private vault inbox as the
checker's first real test corpus. They never go into this public repository;
the public fixtures are invented.

## Gaps review — 2026-09-26

Found on a pass over the whole plan. Tier 1 either changes the file format or
risks losing data, so it is settled now. Tier 2 is cheap to add later.

### Tier 1 — decided now

**Backup. Git is history, not a backup.** One dead disk loses every recipe.
Decision:
- Nothing real is in the app repository.
- The vault's git repo is pushed to a private GitHub repo — an offsite copy of every
  recipe and ingredient with full history. Push after each save, or on a timer;
  a failed push must never block a save.
- Dish photos are not in git (git keeps every deleted version forever). The vault
  folder is backed up with `restic` (or similar): deduplicated, encrypted,
  versioned. One folder, one backup job, which covers the photos the GitHub copy
  does not. Losing the photos is annoying; losing the text is not possible while
  the GitHub copy exists.
- `cache/` is excluded from the backup; `vault sync` rebuilds it.
- 3-2-1: the live copy, a local second copy (external disk or NAS), one offsite
  (cloud bucket, or a disk kept at another address).
- A scheduled restore test. A backup never restored is a hope, not a backup.

**Sub-recipes.** Pâte brisée in forty tartes should not be forty copies. An
ingredient can reference another recipe with `recipe: <slug>`; cost and pantry
search recurse. Added to schema draft 4. Retrofitting this across thousands of
files would have been a migration.

**Multi-page and multi-recipe photos.** Real sources are not one-card-one-recipe:
a card has a back, a magazine page has three recipes. Template now says: several
images may be one recipe, one image may be several. The paste box therefore accepts
several fenced files in one paste and saves them as separate recipes.

**Schema version.** `schema: 3` on every file. A future migration must know what
it is reading. Now required (`E110`).

**Web import via schema.org.** Most recipe sites embed a `Recipe` JSON-LD block.
Paste a URL, parse the JSON-LD, map it to the schema, fill `source.url`. More
accurate than an AI reading a screenshot, and nearly free. Fall back to the AI
path only when a site lacks the markup. Goes in P1 alongside the paste box.

### Tier 2 — noted, later

- **Cookbook export / PDF of a selection.** A printable book of a selection:
  a group of variants, a tag, one source or author. The print view does most of
  this.
- **Cook log and personal notes.** "Made 2026-10-12, too salty, less sel next time."
  A `log` list in frontmatter: date, rating, note. Gives "last made" and "never
  made" sorts for free.
- **Duplicate detection by ingredient set.** Titles lie — "Lasagnes du dimanche" and
  "Lasagnes bolo" can be one recipe. Structured ingredients make Jaccard similarity
  on ingredient sets trivial. Flag pairs above ~0.8. **Built** (plan 05): weighted
  Jaccard (rare ingredients weigh more, the weights from the vault itself),
  threshold 0.65 tuned on the corpus (`INGREDIENTS.md`, "Duplicates"); `W505`
  on the paste box and the form; `/doublons` lists the pairs, each settled as
  two versions, the same recipe (one to the trash) or different recipes
  (`vocab/distinct.yaml`).
- **Parser test fixtures.** The validator is the contract with every AI and the
  form. A `tests/fixtures/` folder of good files and deliberately broken files,
  each asserting its exact error codes. Every real-world failure found becomes a
  fixture.
- **Where it runs.** Still open under Hosting. Candidates: a NAS, a Raspberry Pi
  5, an old laptop. One Docker container plus the vault folder makes any
  of them fine.

### Deliberately out of scope

- **Nutrition.** Needs per-ingredient nutrition data and reliable gram weights for
  every unit. Large effort, and not what this archive is for.
- **Multi-shop price comparison.** A different app.
- **Public sharing / social features.** A private, self-hosted archive.
- **Shopping list.** Declined by the owner (2026-09-29): no list built from
  chosen recipes, no whole-pack shopping cost, no aggregation across recipes.
  Consumed cost and pantry search cover what is needed.

