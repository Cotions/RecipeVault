# Validation and the AI fix-request block

Draft 1. Companion to `AI-TEMPLATE.md`.

Validation has an unusual requirement here: most invalid files are produced by an
AI, not a human. So an error message is not for a person to read and act on — it is
**input to the next AI turn**. That makes the output format part of the design, not
an afterthought.

## The fix-request block

When a paste fails validation, the app offers a copy button producing a block
designed to be pasted straight back into the AI chat that produced the bad file.
It sits once, right under the errors of the first file that needs it (it
covers every such file of the paste). A value from a closed list
(`E201`, `W501`) can also be replaced in place from its problem, and a few
mechanical mistakes (`E002`, `E101`, `E110`, `E204`, `W401`, `E301`) fixed in one
tap ("Quick fixes in the paste box", below); the block is then the second path, and covers what is
still wrong when it is copied.

```text
RECIPEVAULT — FILE REJECTED

Your previous output did not validate. Fix every ERROR below, then return the
COMPLETE corrected file inside one ```markdown fence. Output nothing else. Do not
explain the changes. Do not return a partial file or a diff.

ERRORS — must fix:
  [E201] ingredients[0].items[3]: `unit: "cuillere"` is not allowed.
         Allowed units: g, kg, ml, cl, l, cup, tbsp, tsp, pinch, drop, lb, oz,
         piece, clove, leaf, sprig, stalk, bunch, slice, can, packet, bottle,
         jar, bag, qt, pint
  [E203] ingredients[0].items[6]: `qty: 2` present but `unit` missing.
         Every qty needs a unit. Countable items use `unit: piece`.
  [E210] ingredients[1].items[2]: `name: "500 g de lait"` contains a quantity.
         Move it: `{ qty: 500, unit: ml, name: lait }`
  [E101] `title` is missing and is required.

WARNINGS — fix if you can, the file will save without them:
  [W304] ingredients[0].items[1]: `name: "gros oignon"` may contain a size
         descriptor. Consider `{ name: oignon, note: gros }`
  [W401] no `## Préparation` section found.

--- YOUR FILE ---
<the rejected file, verbatim>
--- END FILE ---
```

Design choices that matter:

- **Stable numeric codes.** `E201` never changes meaning. Makes errors greppable,
  countable over time, and lets the prompt in `AI-TEMPLATE.md` be improved
  against whichever code fires most often.
- **Path, not line number.** `ingredients[0].items[3]` survives reformatting; a
  line number does not, and YAML reflow shifts every line.
- **Every error states the fix, not just the fault.** `[E210]` shows the corrected
  entry. An AI given the fix applies it; an AI given only a complaint improvises.
- **The full file is included.** The AI's own context may be gone, compacted, or a
  different session entirely. Self-contained block, always.
- **"Complete file, one fence, no explanation"** is repeated here even though it is
  in the original prompt, because that is the instruction most often lost by the
  second turn.
- **Errors and warnings separated**, with warnings explicitly marked non-blocking,
  so the AI does not restructure a valid file chasing a suggestion.

**Who fixes each code.** Every code in the tables below has a *Fixed by* column:

- `ai` — the AI that produced the file can fix it from the file and the source.
  These, and only these, go into the fix-request block.
- `app` — only the app or the person can settle it: it depends on the rest of the
  vault (slug collisions, duplicate titles, sub-recipes not added yet, the
  registry and vocabularies), on reading the photo (confirming a `[?]`), or on
  information the source may not have (servings, times, provenance — asking the
  AI invites it to invent them). These show in the app UI and in `vault check`
  output, never in the block.

A file whose only errors are `app` codes is left out of the block and listed with
the recipes the AI must not resend. **Adding a code means choosing its fixer**;
the checker's test suite fails on a code without one.

The block includes the spec only when an error suggests the AI never had it —
three or more *different* `ai` `E2xx` error codes across the whole paste (one
mistake repeated on many lines does not count: its own message fixes it), or
any `E001`, the output not being markdown at all. Otherwise the
codes and fixes are enough, and pasting the whole of `AI-TEMPLATE.md` every time
wastes the AI's context on a one-line fix.

## Info

Not problems; shown so nothing is silent.

| Code | Fixed by | Condition |
|---|---|---|
| I701 | app | `[+]` present — text added by the transcriber, rendered distinctly |
| I702 | app | a `QUESTIONS` section or other text found outside the fences — ignored, shown to the user in case the AI asked something |

## Error codes

Hard errors. Refuse to save.

A value that *starts* with an unquoted marker (`name: [illisible]`) is read by
YAML as a list, not text. Whichever code fires on that field, its fix is the
same: wrap the value in double quotes (`name: "[illisible]"`).

Number fields take markers the way `qty` does: `qty`, `qty_max`, `servings`,
`servings_max`, `oven.temp` and `oven.temp_max` may be a quoted string such as
`"4 [?]"` or `"350 [?: 325]"`, and what is left once the markers are removed
must be valid for the field. A field that cannot hold text — `qty`, `qty_max`,
`unit` (of an ingredient, `alt` or `yield`), `source.type`, `times.*`,
`servings`, `servings_max`, `oven.temp`, `oven.temp_max` — holding *only* a
marker, quoted or not (`qty: [illisible]`, `type: "[?]"`), means nothing was
read. Quoting would not make it valid, so the fix is instead to leave the key
out (the whole amount for `qty`/`unit`, the whole `alt`, the whole `oven` for
`temp`) and ask in `QUESTIONS` — `AI-TEMPLATE.md` rule 4.

| Code | Fixed by | Condition |
|---|---|---|
| E001 | ai | not valid markdown with a YAML frontmatter block |
| E002 | ai | frontmatter is not valid YAML (include the YAML parser's own message) |
| E003 | ai | the body holds another recipe file — a line that is exactly `---` with `schema:` as the next non-blank line: several files pasted without fences, or a fence left open. Fix: return each file in its own ```` ```markdown ```` fence |
| E101 | ai | `title` missing |
| E102 | ai | `slug` is not lowercase ASCII hyphenated |
| E103 | app | `slug` already exists in the vault, or twice in one paste — resolved in the app: overwrite, or a suffixed slug (see `DATA-FLOW.md`) |
| E104 | ai | `lang` not `fr` or `en` |
| E105 | ai | `family` set without `variant`, or `variant` without `family` |
| E106 | ai | `source` is not a mapping, or `source.type` is present and not in the allowed list. `type` is optional: absent when the kind of source is not evident |
| E107 | ai | `difficulty` or `rating` outside 1–5 |
| E108 | ai | `servings` not a positive integer, or `servings_max` ≤ `servings` (markers aside: `"4 [?]"` is 4) |
| E109 | ai | `times.*` not in the duration format: `30m`, `1h`, `1h15m`, range `45m-50m` |
| E111 | ai | `oven.unit` not `F` or `C`, or `oven.temp` not a number (markers aside: `"350 [?]"` is 350), or `oven.temp_max` ≤ `oven.temp` |
| E112 | app | `status` or `added` written in a pasted file — the app sets these (auto-fixed on the paste path: stripped with a note, not rejected) |
| E113 | app | a vault file's `slug` does not match its file name (an edit outside the app) — the file is not indexed until the file is renamed or `slug` set back |
| E114 | ai | `source.url` does not start with `http://` or `https://` — a bare domain (`example.com`), a site name, or another scheme (`javascript:`); the full address is asked for |
| E110 | ai | `schema` missing, or a version this app does not know |
| E200 | ai | `ingredients` missing or empty |
| E201 | ai | `unit` not in the canonical unit list — the message lists the Quebec abbreviation mapping (`tasse` → `cup`, `livre` → `lb`, `c. à thé` → `tsp`) |
| E202 | ai | `unit` present without `qty` |
| E203 | ai | `qty` present without `unit` |
| E204 | ai | `qty` neither a number nor a fraction string (`"1 1/2"`, `"2/3"`) |
| E205 | ai | `qty_max` present without `qty`, or `qty_max` ≤ `qty` |
| E206 | ai | `to_taste: true` together with `qty` or `unit` |
| E207 | ai | ingredient entry has no `name`, or `name` is not text |
| E208 | ai | `ingredients` is a flat list rather than groups with `items` |
| E209 | ai | duplicate ingredient `name` within one group |
| E210 | ai | `name` contains digits followed by a unit — quantity smuggled into the name |
| E211 | ai | `name` contains a comma and no `note`/`prep` — probably merged ingredients |
| E212 | ai | `buy_instead` present without `recipe` |
| E214 | ai | `alt` present without both `qty` and `unit` inside it, or with a key other than `qty`, `qty_max`, `unit` |
| E215 | ai | `or` not a list, or an entry that is neither a string nor a valid ingredient object (same rules as any ingredient entry, `name` required) |
| E216 | ai | a quantity and unit found inside `note` (`note: 2 lbs`) — should be `qty`/`unit`. Not fired when `unit` is a count or container unit (`piece`, `clove`, `leaf`, `sprig`, `stalk`, `bunch`, `slice`, `can`, `packet`, `bottle`, `jar`, `bag`) and the note holds a single size (`796 ml`, `environ 450 g`, `.75 l`, a multipack `2 x 400 g`) — or one size followed by its equivalent in another unit in parentheses (`19 oz (540 ml)`, `540 ml (19 oz)`), as Canadian cans print it. Always fired when `unit` is absent or a measure, when the note holds any other second amount (two sizes, `796 ml (540 ml)`), or when it gives an alternative (`ou`/`or` + a quantity — that belongs in `or`) |
| E217 | ai | an unknown bracket marker — only `[?]`, `[?: …]`, `[illisible]`, `[+]` are allowed. Also catches prose uncertainty (`lecture incertaine`, `incertain`) and asks for `[?]` |
| E218 | ai | a field of the wrong shape. A text field (`note`, `prep`, `brand`, `recipe`, `group`, `source.author`, a tag, …) holds a list, a mapping or `true`/`false` — usually a value starting with an unquoted marker (`note: [illisible]`); fixed by quoting it. Or a list field (`tags`, `season`) or the `media` mapping holds a single value (`tags: dessert`, `media: final.jpg`); fixed by writing the list or mapping (`tags: [dessert]`, `media: { final: final.jpg }`). Fields with their own code (`title` E101, `name` E207, `qty` E204) keep it |
| E213 | ai | sub-recipe cycle — `A` uses `B` uses `A` |
| E301 | ai | a body heading is unrecognized *and* no recognized method heading exists |

Warnings. Save, mark `needs-review`.

| Code | Fixed by | Condition |
|---|---|---|
| W302 | ai | `name` starts or ends with a word of the vault's preparation list, `vocab/participles.yaml` (`émincé`, `râpé`, `haché`, *chopped*; `VOCAB.md`, "Preparation words"), with other words left and no `keep` name covering it (*porc haché* is a product) — move it to `prep`. The lists travel with the paste page, so the browser's check and the server's agree (plan 03, Q22) |
| W303 | app | `name` resolves to no registry entry (`INGREDIENTS.md`, "Resolution") and no entry is close enough to suggest — create it from the resolve queue. Computed in the app (recipe page, server check, save result) from the registry, never in the fix-request block |
| W304 | ai | `name` starts or ends with a word of `vocab/descriptors.yaml` (`gros`, `petit`, `grande`, *large*; `VOCAB.md`, "Size words"), same rules as W302 (*gros sel*, *petits pois* are kept) — move it to `note` |
| W305 | app | `name` resolves to no registry entry, or is a name of several entries (ambiguous), and the resolve queue has a candidate waiting — confirm it there. A fuzzy match never resolves on its own (plan 03, Q1) |
| W306 | app | `recipe:` points at a slug not in the vault yet |
| W307 | app | `item:` (a manual override, `STORAGE.md`) names a slug with no registry entry |
| W401 | ai | no method section in the body |
| W402 | ai | a step exceeds ~400 characters — probably several steps merged |
| W403 | ai | a method section has text but no steps — no numbered (`1.`) or `-` / `*` bullet line. Its text would not be shown one step at a time in kitchen mode, nor checked by `W402` and `W609`. Fix: write each step as a numbered or `-` line |
| W501 | app | tag not in the vault's `vocab/tags.yaml` (canonical or alias), closest canonical suggested within two edits. The tag is kept and indexed as pending (`VOCAB.md`, "Tags"). `app`: the AI cannot see the vault's vocabulary; the fix is choosing the suggestion or adding the tag or alias to the vocabulary (`/etiquettes`, plan 04 Phase 8). Server check, save result and recipe page (plan 03, Q23), never the browser-only check |
| W502 | app | `family` within edit distance 2 of an existing family (`vocab/families.yaml` plus the families in use, without the ones only this recipe uses — also when it is pasted again over itself) and not itself an existing family — drift suspected. `app`: family is decided in the app (`AI-TEMPLATE.md` rule 19). Server check, save result and recipe page |
| W503 | app | near-identical `title` already in the vault — duplicate paste |
| W504 | ai | a `season` value not in the fixed list of `VOCAB.md` — `printemps`, `ete`, `automne`, `hiver` or one of their aliases (`été`, `summer`, `fall`, …); the closest season is suggested |
| W505 | app | nearly the same ingredients as a vault recipe — the same card pasted under another title, suspected. The ingredient sets (`INGREDIENTS.md`, "Duplicates") score at least 0.65 weighted Jaccard; at most three other recipes are named, each linked; a pair settled as different recipes (`vocab/distinct.yaml`, `VOCAB.md`) is never named again; a recipe is never its own duplicate (an edit, a paste over itself); a pair in one family is left out unless the ingredients and amounts are identical. A pair scoring at least 0.45 whose methods are the same text is flagged too (`INGREDIENTS.md`, "The second signal"). Inside one paste (or `vault add` with several files) a file names the earlier files close to it by their place (`recipe 1 of this batch`; the paste box says "le fichier n° 1 de ce collage"): they are not saved yet. `app`: the AI cannot see the vault. The offer is the W608 one — "En faire deux variantes du même plat". Server check, the form's check and save result (plan 05, Phase 6); the vault's pairs are listed on `/doublons` (Phase 7) |
| W601 | app | no `servings` |
| W602 | app | no `times` |
| W603 | app | no dish photo. **Not emitted** (plan 04, Q13 A): a photo is optional and most recipes never get one, so as a warning it would sit on nearly every recipe; the recipe page (and the form) show an "Ajouter une photo" prompt instead, which is not a diagnostic |
| W604 | app | `source` entirely absent — provenance lost |
| W605 | app | `[?]`, `[?: …]`, or `[illisible]` present — each location listed |
| W606 | ai | `to_taste: true` on a line that resolves to a registry entry without `au_gout: true` (plan 03, Q21) — probably should be a plain name without amount (`AI-TEMPLATE.md` rule 13). An unresolved name is not judged, nor an `item:` override naming no registry entry (that is W307). Computed from the registry in the server check and the save result; reaches the fix-request block through the server check |
| W607 | ai | `name` contains a brand of `vocab/brands.yaml` (`VOCAB.md`, "Brands"), with other words left — suggest `brand:`. The list holds only brands whose removal leaves an exact product name (rule 10 keeps *Jell-O*, *fromage Philadelphia* as names) |
| W608 | app | same title as an existing recipe — offer to make both members of a family |
| W609 | ai | step text mentions an oven temperature but `oven` is absent |
| W610 | ai | unknown frontmatter key (`serving:`, `temps:`), in the frontmatter or inside `source`, `times`, `oven`, `yield`, `media`, a group or an ingredient entry — its value is ignored; the closest allowed key is suggested |

## Registry codes

Problems in an ingredient file, `ingredients/<slug>.md` (`INGREDIENTS.md`, "The
registry"; plan 03, Q6). The AI never writes these files, so every code is
settled by the person (`app`). They show in `vault check --dir <vault>`, `vault
sync`, and on the ingredient pages. An ingredient file with an error keeps its
last good index rows and is not committed by the file watcher, the same rule as
a recipe; warnings leave it in use.

| Code | Fixed by | Condition |
|---|---|---|
| E801 | app | the ingredient file is not Markdown with a YAML frontmatter, or the YAML does not read |
| E802 | app | `slug` missing, not lowercase ASCII hyphenated, or not the file name |
| E803 | app | `category` missing or not one of the 12 categories |
| E804 | app | `names` not a mapping of `fr`/`en` to lists of text, or no name at all |
| E805 | app | `density` not a positive number, or `weights` not a mapping of canonical unit → positive grams |
| E806 | app | `default_unit` not a canonical unit |
| E807 | app | `staple` or `au_gout` not `true`/`false`, or `substitutes`/`allergens` not a list of slugs |
| W808 | app | a `substitutes` entry is not in the registry, or is the entry itself |
| W809 | app | an `allergens` value not in `vocab/allergens.yaml` — ignored |
| W810 | app | alias collision: one lookup key (`INGREDIENTS.md`, "Resolution") written under two entries — recipes writing it stay unresolved (ambiguous) until one entry drops it |
| W811 | app | unknown key in an ingredient file — ignored; the closest allowed key is suggested |
| E820 | app | a `when` rule (`INGREDIENTS.md`, "Disambiguation rules") is malformed: not a list of mappings, no `names`, an unknown key, a `lang` other than `fr`/`en`, a `unit` value that is neither a canonical unit nor a unit class, empty `words`, or no condition at all |
| W821 | app | two entries have rules for one name that can hold on the same line (their languages, units and words all meet) — such lines stay unresolved (ambiguous) |

## Price codes

Problems in `prices.csv` (`STORAGE.md`, "Prices are an append-only log"; plan
03, Phase 4). The file is data, not a recipe: a problem is reported with its
line number rather than a path. A line that does not read is skipped; the
others are used. They show in `vault check --dir <vault>`, `vault sync`, and on
the ingredient index (`/ingredients`). The watcher still commits the file.

| Code | Fixed by | Condition |
|---|---|---|
| E812 | app | the first line is not the header, or the header lacks `date`, `ingredient`, `amount`, `pack_qty` or `pack_unit` — no row is read |
| E813 | app | a line does not read — skipped: more cells than columns (an unquoted comma), `date` not YYYY-MM-DD, `ingredient` not a slug, `amount` or `pack_qty` not a positive number, `pack_unit` not a canonical unit, `currency` not a three-letter code. An empty `currency` is the config's |
| W814 | app | the row's `ingredient` names no registry entry — kept, used once the entry exists |
| W815 | app | the row's `currency` is not the config's `currency` — shown, never used for cost |

`E210` and `E211` are heuristics, deliberately hard errors rather than warnings.
They catch the two AI mistakes that quietly corrupt the ingredient index, and a
false positive costs one manual override — far cheaper than discovering at recipe
800 that the pantry search has been splitting onions in two the whole time.

## Several recipes in one paste

One photo can hold several recipes, so the AI may return several fenced files in
one answer. The paste box accepts that: each fence is validated and saved as its
own recipe. A ```` ```markdown ```` (or ```` ```md ````) opener line always starts
a new file, even when the previous recipe fence was never closed — it cannot
occur inside a recipe. Files pasted bare, one after the other, are not split:
they arrive as one file and fail with `E003`. The fix-request block then covers only the failing ones, each with its
own file included, and says which recipes already saved so the AI does not resend
them.

## Human-facing validation

**In the app, diagnostics are shown in French.** The checker's `message` and
`fix` stay English: they are written for the AI (the fix-request block) and the
developer (`vault check`), and both keep them. Wherever the app lists
diagnostics — the paste box, the banner of a recipe whose file stopped
passing, the home page list of files that fail (the owner's only: an account
without the Markdown tools is not shown it) — each one shows:

- one sentence that leads: where, as a cook would say it, then what is wrong
  and what to do — "**Sirop, 2e ingrédient (eau)** : cette unité n'est pas
  dans la liste des unités…" (`placeHuman`: the group's name, left out for a
  single unnamed group, the ingredient's rank and name; the field is left to
  the sentence; other paths are named as `placeOf` names them, "Temps :
  cuisson", "Méthode, étape 5");
- the value it is about, as written, highlighted in the sentence when the path
  ends on one (« poignée »), unless the place or the sentence already quotes it;
- the sentence is the code's plain-French explanation, for a non-technical cook
  (`src/lib/i18n/diagnostics.ts`, one entry per code; a test fails on a code
  without one, so **adding a code also means writing its French line**). It
  says what is wrong and what to do. Two cases say more than the code's line:
  an `E201` value the alias table knows (`VOCAB.md`, units) is not unknown to
  a Québécois cook, so it leads with the plain thing, never "inconnue":
  "Unité « tasse » : écrivez cup ; l'app affichera « tasse »." — the rule is
  unchanged, files hold unit codes; the sentences are short, what to write
  first (`E204` « Quantité illisible : écrivez 2, 1 1/2 ou 2/3 (1.5, pas
  1,5). »); and in the
  paste box a `W501` reads "Nouvelle étiquette « Erable » : elle sera
  ajoutée." (pending, `VOCAB.md`, "Tags"), or, when the recipe's own text
  writes the word with accents, "Étiquette « Erable » inconnue — vouliez-vous
  « Érable » ?", or, with a known tag within the near-miss distance,
  "L'étiquette « desertt » n'est pas dans la liste. Vouliez-vous dire
  « Dessert » ?". The place is its own line above the sentence;
- behind « Détails pour le dépannage », for the owner and the docs: in the
  paste box one such disclosure per file, closed, at the foot of its problems
  and listing all of them (UI council: no code on the rows); on a recipe page
  and the home page one per problem. It holds the code (stable, so it can be
  looked up here, never on the row or the disclosure itself), the full place from the path
  (`ingredients[0].items[3].unit` → "Ingrédients, groupe 1, ligne 4 « farine »
  : unité", `body.steps[4]` → "Méthode, étape 5"; group, ingredient and
  section names come from the parsed file when there is one, else positions),
  the raw path, then how to correct it: on a French account a French hint per
  code (`FIX_FR` in `src/lib/i18n/diagnostics.ts`, a test requires one for
  every code, never the word "frontmatter") and the names the English message
  and fix cite, in code ("Dans la fiche : `servings`"); on an English account
  the English `message` and `fix`. The English text itself is the AI's and
  `vault check`'s, unchanged.

In the paste box an unknown unit written on several lines of one file is one
problem, said once with "N fois dans cette recette" and its other places
("Aussi : Pâte, 2e ingrédient (sucre) ; …"); the error count stays per line.
The count beside Save and in "Erreurs (N)" is the number of problems listed,
no more and no less (display only; the checker's output is unchanged):
- an `E203` on an item whose quantity also has an `E204` (`qty: 1 1/2 tasse`,
  no `unit`) is one problem, shown and counted once as the `E204` — splitting
  the value settles both;
- an `E103` settled in the page (overwrite or suffix chosen) leaves the list
  and the count; the choice itself reads « Réglé : elle sera enregistrée comme
  … »;
- the problems found in `E002`'s realigned text (below) are listed as error
  rows marked « à revérifier » and counted.
Who settles a code is not said per problem: a quick fix is offered where the
app can settle it, and the one "Copier la demande de correction" under the
errors covers the `ai` codes.

In the paste box, a problem whose place is found in the pasted text
(`src/lib/vault/locate.ts`: a frontmatter value, or the deepest part of its
path that exists; a section heading, a step's first words) can be selected in
the box — best effort, nothing when the path cannot be followed: an error
has a visible "Montrer dans le texte" button under its line (on one row with
its quick fix, the fix first; "Autre unité…" under that row), a one-line
remark is itself the button. An error row leads with its plain sentence (what
is wrong and what to do); where it is follows on one small secondary line.
Two or more `W303`/`W305` remarks (« pas
encore relié »: nothing to do before the save) fold into one row, « N
ingrédients à relier plus tard », the lines inside it. With no step read, the
summary says « 3 lignes hors Préparation » (the lines `W401`'s fix would make
steps), never « 0 étape ». Errors are listed open. On a first validation
with errors (a paste, an import, a "Coller" — not while she types in the box)
the box scrolls to the first error's line, and every error's line is marked in
the box's margin (a red bar and a light band; decoration, each error keeps its
button). Warnings and notes are "remarques", one line
each (the explanation's first sentence and the place; the code and the rest of
it in the file's « Détails pour le dépannage »): one is shown open, more wait behind their count ("2
remarques"). The count of errors beside Save is a link to the first one: it is
scrolled clear of the save bar, its quick fix focused when it has one.

**Quick fixes in the paste box.** A value from a closed list can be replaced in
the pasted text, in place, from its problem; the text is then checked again
like any edit. Two codes qualify:

- `E201` (the vault's units). When the alias table gives one unit, one primary
  button, « Écrire cup » (« Écrire cup partout (3) » when the same unit is on
  several lines: all of them at once), and under it a small link-like
  disclosure « Autre unité… » holding the list, nothing chosen in it. Else the
  list, none preselected: "Remplacer « poignée » par : [liste] Remplacer"
  ("Remplacer partout (3)" / "Seulement ici" for several lines).
- `W501` (an unknown tag), one pattern for every tag: « Utiliser « … » » only
  for the same word — its accents as the recipe's own text writes it (`erable`,
  « sirop d'érable » → « Érable », still a new tag), else a known tag that is
  the same word but for its ending or a typo of it (`preselectTag`,
  `src/lib/vault/tagmatch.ts`, the rule /etiquettes preselects with; computed by
  /api/check, where a tag naming a registry ingredient is matched on its
  ending only, so a food is never offered a course: « pain » is never « Plat
  principal » through its alias « main »). The wider two-edit `suggestTag` is
  no longer offered here. « Garder « … » » is always there; the remark says
  the tag is kept as written and « elle attendra dans Étiquettes », and once
  kept, « ✓ « pain » gardée : elle attendra dans Étiquettes ». Nothing about
  the file changes: a kept tag is saved as written and is pending, as before.

A tag
that differs from a known tag or alias by accents, case or spaces only is that
tag — the lookup folds both sides — so it raises no `W501` at all, and the
paste preview shows it under the vault's label (`Quebecois` → « Québécois »). A
quick fix is offered only when the diagnostic's path names one scalar exactly
(`scalarAt` in `src/lib/vault/locate.ts`: the whole path, never the deepest
part that exists) and the box's offsets hold (the text is already NFC and LF);
the new value is written plain when YAML reads it back as itself, else quoted.
More codes get a one-tap fix that edits the text (`src/lib/vault/quickfix.ts`).
Each is offered only when checking the edited text again shows the problem
gone and no error that was not there before; otherwise nothing is offered:

- `E002` (bad indent): the problem names the line of the box ("Ligne 9 du
  texte", the line in the pasted text, fence included), says whether it is one
  space too far or short against its neighbours, and shows that line and the
  one before it with a caret under the first character; "Montrer dans le
  texte" selects the line. "Réaligner la ligne N" moves it to the indent of a
  neighbouring line of its kind (a list item under a list item, a key under its
  sibling keys), trying the error's line and the lines either side, and only
  an indent after which the whole frontmatter reads. A YAML error stops the
  reading, so other problems may be hidden: when a realignment exists the page
  checks the realigned text — a full, real check, not a partial parse — and
  lists what it finds right under the `E002`, as ordinary error rows marked
  « à revérifier » (« Et 2 autres erreurs, listées ci-dessous « à revérifier »
  » under the `E002`), counted in the errors since Save stays closed until they
  are fixed too (a display choice, not a rule change): all problems in one
  wave. A row « à revérifier » keeps its one-tap fix (a unit alias, a split,
  the version, the steps' heading), computed in the realigned text: one tap
  realigns the line and makes that fix. With no realignment it says only that
  other problems may appear once this one is fixed.
- `E106` on `source.type` (a type not in the list): the row reads « Type de
  provenance « card » inconnu : lequel est-ce ? » and offers one button per
  allowed type, its code and its name, « Écrire family (recette personnelle) »
  … « Écrire invented (inventée) » (`sourceTypeFixes`): she knows the card, the
  app does not guess. A `source` that is not a mapping gets no button.
- `E109` (a time not in the duration format): « Écrire 40m » when the value
  reads one way only (`suggestDuration`, the form's reader of « 40 min »,
  « 1 h 15 », « 2 heures », « 45-50 minutes »), with no words after the time
  (« 30 min de repos » is left to her or the AI; `durationFix`).
- `E101`: "Titre : [____] Ajouter", prefilled from the first body heading that
  is not a section name (often the title written again), else the first line
  of prose (not over 80 characters); written after `schema:`, quoted when YAML
  needs it. Enter in the field adds it (as Enter in the unit list of an `E201`
  replaces); Ctrl/Cmd+Entrée anywhere in the page is Save.
- `E110`: "Ajouter la version" writes `schema: 3` first (or fills an empty
  `schema:`); a version present but unknown is never replaced.
- `E204`: "Séparer en 1 1/2 + tasse" when the value is a quantity then words
  the vocabulary reads as one unit (a code or an alias), and the item has no
  other unit: the quantity stays, the unit is written as its code.
- `E210`: "Séparer en 500 ml + lait" when the name alone holds one amount the
  vocabulary reads (`500 ml de lait`, `beurre : 2 c. à table`) and the item has
  no `qty` or `unit`: the amount goes to `qty`/`unit`, the name keeps the rest
  (a leading « de »/« d' »/« of » and stray punctuation dropped, a `[?]` kept).
- `W401`, and `E301` when the only heading is not a section (the title again):
  "Ranger ces N lignes dans Préparation" writes `## Préparation`
  (`## Instructions` in English) above the first list line, N being the steps
  it then makes. A file with no error and no step read shows this `W401` open,
  above Save and out of the remarks, and Save reads « Enregistrer sans étapes »
  (saving without steps stays allowed: a warning, never blocking).
- `W302`: "Séparer en beurre + fondu" when the name's first or last word is a
  preparation word: the name keeps the rest, the word goes to `prep` (before an
  existing `prep`, comma-separated). After a comma, the whole tail moves when
  every word in it is a preparation word or a joiner (*et*, *ou*, *puis*, *and*,
  *or*, *then*): *pommes de terre, cuites et pilées* splits as *pommes de terre*
  + *cuites et pilées*, never leaving *cuites et* in the name; a tail with any
  other word (*sel, poivre moulu*) keeps the plain reading. One word list for every line, French and
  English words together (`VOCAB.md`, "Preparation words"): *butter softened*
  is flagged as *large eggs beaten* is.
- `E207` on a plain-string item (`- 1 1/2 tasse de lait`): the row says
  « cette ligne n'est pas découpée en quantité, unité et nom », not « pas de
  nom », and offers "Lire comme : 1 ½ tasse · lait" — the line read by the
  reader of the form's « Coller une liste » (`src/lib/form/lineparse.ts`),
  written as a `{ qty, unit, name }` entry, only when that reader reads it
  whole (nothing guessed). With two or more such lines that all read, the
  first row also offers « Lire les N lignes » (one tap, all of them). Other
  `E207` (a map with no `name`) keep « Un ingrédient n'a pas de nom ».
- `W401` / `W403` with lines that look like steps written another way
  (`Étape 1 : …`, `1 - …`, `1.Mélanger`, a list indented 4 spaces, which
  Markdown reads as code): when no step is read and the numbered ones run 1,
  2, 3…, the open row above Save names the first such line (« Ligne 14 du
  texte », the line quoted; « Montrer dans le texte » selects it) and offers
  « En faire N étapes »: each line written `N. …` at the margin, the method
  heading added when there is none. That row shows even while errors wait
  (it does not sink among the remarks). Codes and levels unchanged (a
  warning, Save stays open as « Enregistrer sans étapes » once the errors
  are fixed).

Every one-tap fix (these, and a unit or a tag replaced) leaves its row, and
one line at the top of the file's result says them all, « ✓ 2 corrections
faites — Unité écrite : cup. · Annuler la dernière » (the last one's words
hidden on a phone; a screen reader hears each). « Annuler la dernière » puts
the text back as it was before the last tap — only while nothing else has
changed the text since, else the line stays without it. No message at the
bottom: nothing covers the save bar. The line goes with the save or an empty
box.

A W305 (a name resembling a registry ingredient) names the registry's
ingredient ("ressemble à « huile végétale »"), not its slug — only when the
two look alike to a reader: some word of each starts with the same letter and
shares three letters in a row (`looksAlike`, `src/lib/vault/quickfix.ts`). A
candidate sharing only an ending (« beurre » and « saindoux » share no start)
is not named; the remark says only that the name is not linked to the
registry yet. An ambiguous name (several entries) names them all. It has no
"Relier" before the recipe is saved: linking goes through the resolve queue,
which holds only saved recipes; after the save it is in "À relier".

No other code gets one: their fix needs the source card or a judgment, so the
fix-request block stays their path — and stays offered beside every quick fix,
as the way to have the AI redo the whole file.

Her form UI never shows any of this. Codes and fix-request blocks exist for the
paste path. Separate `qty`, `unit`, `name`, `note`, `prep` inputs prevent most
of these states, but not all (a comma or "796 ml" can still be typed in a name).
So the form runs the checker on exactly what Save would write, and every error
comes back as a French hint on its row and field that blocks Save — never a
code, never a generic failure. The server checks again at Save (the backstop):
an error it finds that the browser's check missed is a gap in the form, logged
with its code for the owner, and comes back the same way — on its field, and
named in the message above Save (the field's own line, else the code's French
sentence). Only a failure that is not the checker's (the disk, git) is the one
plain sentence "La recette n'a pas pu être enregistrée ; rien n'a changé."

Warnings reach the form as hints, never blocking (plan 04, Q9 A): `W302`,
`W304` and `W607` live in the browser on the name field, each with its one-tap
fix (move the word to *préparation*, the note or *marque*); `W501`, `W502`,
`W503`/`W608`, `W505`, `W303`/`W305`, `W306` and `W605` from the server check the form
runs while she types (`DATA-FLOW.md`, "Her form"). A `W305` whose candidates hold exactly
one ingredient with a name one edit away (two from eight letters, five letters
at least, first letter kept: `typoOf`) carries that name as its `suggestion`:
the form asks « Vouliez-vous dire « … » ? » with a one-tap « Oui » (`nearName`,
`src/lib/form/hints.ts`). Their French texts are a
second table beside the codes' own, `formHintText` in
`src/lib/i18n/diagnostics.ts`, with a test requiring an entry for every code
the form maps (`FORM_HINT_CODES`).
