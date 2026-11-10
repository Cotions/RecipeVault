# Data flow — input, validate, save, index

Draft 2. Companion to `RECIPE-SCHEMA.md` and `VOCAB.md`.

Principle: **`recipes/*.md` on disk is the source of truth. SQLite is a derived
cache that can be deleted and rebuilt.** Nothing may live only in the database.

All paths are relative to the vault folder (`vault_directory` in the config), which
lives outside the app repository. The app never writes inside its own repository.

## Two inputs, one save path

```
me:  paste raw markdown ──┐
                          ├──> parse ──> validate ──> preview ──> SAVE
her: form UI ─────────────┘
```

The form does not write to the database directly. It builds a recipe object,
serializes it to markdown in the recipe's language, and enters the same pipeline a
paste does. One parser, one validator, one writer. The form therefore cannot
produce a file the parser fails to read, and a fix to validation improves both
paths at once.

### SAVE, in order

1. Serialize to markdown (if coming from the form).
2. Write `recipes/<slug>.md` to disk.
3. Commit to the vault's git repository — `add: <title>` or `edit: <title>`,
   author tagged with whoever saved it. Push to its private remote in the
   background; a failed push is retried later and never blocks the save.
4. Upsert index rows in one transaction.
5. Generate thumbnails for any new images (the derived copies of `STORAGE.md`
   §Media; a failure here costs nothing, they are made again on demand).

Order is not arbitrary. File write fails → nothing indexed. Index write fails →
the file exists and `vault sync` recovers it. Never the reverse. A failed write
or commit (a `.git/index.lock` left by another git command, say) puts every file
back as it was — a new file removed, an edited one restored — and the save
reports that nothing was saved: a file the app wrote but git never recorded
would otherwise sit uncommitted, and the watcher, which ignores the app's own
writes, would never commit it. Delete and restore roll back the same way.
A lock that is surely stale — older than the last boot (a power loss), or
untouched for ten minutes (a killed git; the app's own git calls take
seconds) — is removed and the git command run once more, so a crash never
blocks every save until someone deletes the file by hand. A fresh lock is left
alone: another git command may be running.

### The paste box

`/ajouter`. An empty page leads with the main path, one card with two tabs:
"Une fiche en photo" (selected) and "Une page web" (the URL field and
"Importer", see "Web import"; the tab stays chosen after an import, its
result shown under the card like a paste's, and a paste goes back to the
first tab). The first tab holds three compact numbered steps: copy
the prompt (the page says « les consignes pour l'IA », never « prompt »), open the AI with it, paste its answer — the paste box is step 3,
inside the card, visible on load on a phone too, and says nothing until
something is in it. "Taper à la main" (a link to her form, `/nouvelle`) is the
page head's action. Step 2 on a computer is "Ouvrir Claude", a link to
`https://claude.ai/new` in a new tab that also copies the prompt when step 1
was skipped; on a touch screen that can share text it is "Partager les
consignes…" (`navigator.share({ text: prompt })`; a refused share copies the
prompt and says so; closing the sheet changes nothing). Each step is ticked
when done: step 1 reads "1 Copier les consignes" until the prompt is given, then
"✓ Consignes copiées". A copy that worked says so on its button, "✓ Copié", for
2 s, then "Copier à nouveau". A copy the browser refuses or leaves hanging
(no clipboard, a permission prompt: given 1 s) is never silent: a read-only
box opens with the whole prompt in it, selected, and "Copie automatique
impossible ici : Ctrl+C, ou appui long › Copier"; a copy from that box ticks
step 1. "Voir les consignes" (a disclosure under the step, always there) shows
the same box, to read or copy by hand; once Claude is opened, "Coller" becomes the filled button and,
back on the tab, the box takes the focus (mouse only). The box takes the focus with a mouse on a screen 700 px
wide or more (not on a touch screen or a narrow one, where a keyboard would
rise over steps 1–2), and a paste anywhere on the page
that is not into another field goes in the box, after what is there. Beside
step 3, "Coller" (where the browser lets a page read the clipboard on a tap,
`navigator.clipboard.readText`) puts the clipboard in the box the same way —
the way back from the AI's app; refused or unavailable, it says to paste in
the box by hand. On a phone, once step 2 is done, steps 1–2 fold to one
line ("✓ Consignes copiées · Revoir"), so the box is on the first screen: after
step 2 in this visit, or on a later visit when the prompt was copied on this
device before (`localStorage` `recipevault:prompt-donne`, a convenience
only); with photo sharing (below) the steps are per card, so only this card's
"Envoyer à l'IA" folds them ("✓ Photo et consignes envoyées"). "Revoir" opens
them again. A wide screen keeps the three steps.

**Photo to the AI, on a phone.** On a touch screen whose browser can share a
file with another app (Web Share: `navigator.canShare({ files })`), steps 1
and 2 become "Choisir la photo de la fiche" (the system's picker or camera)
and "Envoyer à l'IA": one tap calls `navigator.share({ files: [photo], text:
prompt })`, so the AI's app opens with the photo and the prompt together. The
photo is never uploaded by this: it stays in the page's memory (a local
`blob:` preview), goes only where the system's share sheet sends it, and is
dropped with the page. Closing the sheet changes nothing; a share the browser
refuses copies the prompt instead and says to attach the photo by hand; "Copier
les consignes pour l'IA" stays offered under the button for an app that keeps only the
photo. Elsewhere (a computer, a browser without file sharing) the steps are
"Copier les consignes pour l'IA" and "Ouvrir Claude" (or "Partager les consignes…", above).

**The card's photo on the recipe.** The scan the AI read can end up on the
recipe it became, as its photo (`media.final`, "Dish photos", below), only
when she says so. On a phone that shared it, once the paste is saved the page
offers "Joindre cette photo à la recette" above the steps (one button per
recipe saved from it, "Joindre à « … »", when one photo held several); one
tap sends that same in-memory photo to `POST /api/photo` with the recipe's
slug and the hash `/api/save` returned for it (each saved file's result
carries the committed file's `hash`), so a recipe changed since is refused,
as everywhere. "Non merci" (or "Fermer" once attached) drops the photo, and
the next card starts at step 1. A reload loses the photo, as before: the offer
is only for this visit. On any device each pasted file's card also offers
"Joindre la photo de la fiche" (a file picker, optional, not on a file with
"Remplacer" chosen): the picked photo stays in the page until that file is
saved, then goes to `/api/photo` the same way, right after the save
("Photo de la fiche jointe." in a message); a refused photo is said
and leaves the saved recipe as it is.

Once
something is pasted, the three steps stay as one line, each ticked when done
(prompt given — only once it was copied, shared or the AI opened from this
page, never implied by a pasted answer, since she may have used another way
in —, answer pasted, every file passing). Text from a web import has its own
two-step line instead, "Page lue · Vérifiée": no prompt was involved; a paste
after it is the AI path again. At that line's end, « Recommencer » (always,
once something is in the box): it empties the box, so the tabs and the steps
come back, and says « Zone vidée. » with « Annuler », which puts the text, the
choices made on it and the kept tags back (about 8 s). The paste is kept in
this tab (`sessionStorage` `recipevault:collage`) until saved or emptied; when
a reload fills the box from it, the line says « Texte repris de votre
dernière visite · Recommencer ». « Modifier le texte » opens the box, scrolls
it into view and focuses it at its start. When every pasted file passes — no errors; warnings and notes do not
hold it — the text folds to a one-line summary
("1 recette trouvée · 6 ingrédients · 5 étapes · Modifier le texte"; with no
step read, « 3 lignes hors Préparation » in place of « 0 étape ») and the
result takes the width; it stays open while she types in it (an edit that
follows a key press in the box) or after she asks
for it ("Modifier le texte", "Montrer dans le texte"), and folds again on the
next paste, import, text put in whole (an autofill) or emptied box. Otherwise a wide screen shows the box and
the result side by side; a phone stacks them. The preview of a single file is
open, on a phone too. Its tags are named as the vault names them: a tag the
vocabulary knows, accents and case aside (`quebecois`, `Québécois`), shows its
canonical label from `vocab/tag-labels.yaml`; an unknown one shows as written.
Per file the
result is ordered by weight: the decisions she alone can make first (the
collision choice; the same-dish question, below, with two answers "Même plat,
regrouper" / "Recette différente"), then the errors, then the warnings and
notes as "N remarques" (shown open when there is one; `W505` / `W608` leave
them when the same-dish question already says it), then the preview. A file
with errors simply does not offer "Relire et modifier"; there is no second
guidance line under its errors. It still shows a preview under them, greyed,
"Aperçu partiel": what the frontmatter gives as far as it reads (a line left
whole, `- 1 1/2 tasse de lait`, shown as written in its place; an entry with
no name left out; a unit outside the list as written, an
unreadable oven dropped), so she sees the other ingredients and the steps came
through; none when the frontmatter does not parse or has no title. Errors lead with a sentence, the place on its
own line then what ("Sirop, 2e ingrédient (eau)" / "Unité « tasse » : …"); no
code on a row: the codes wait in the file's one « Détails pour le dépannage »,
closed, at the foot of its problems (`VALIDATION.md`, "Human-facing
validation"); the box scrolls to the first error's line (a third down, by
whole lines: the top line is never cut) and marks the errors' lines in its
margin. Long lines wrap at the box's width (nothing clipped, no sideways
scroll); the marks follow the wrapped lines, measured on a hidden copy of the
box. With errors, a wide screen shows the box and the result side by side in
two equal columns; a phone keeps the box short (seven lines, scrolled to the
error, the steps line hidden) so the error card and its fix sit right under
the marked line on the first screen. The same-dish
question: "Une autre variante du même plat ?" (or, same title, "Même titre
qu'une recette existante : deux variantes du même plat ?"; only a title that
starts the same, "Titre semblable : une autre variante du même plat ?"), then
each vault recipe it may join (`candidates` from /api/check, at most four:
same title, then close ingredients, then a title one holds whole at its start,
`like`, as the form's « Ressemble à »; a close-ingredients recipe is offered
only at `VARIANT_CLOSE` 0.75 or more, or when its title is alike
(`titlesAlike`) — the W505 remark keeps 0.65, but a group question on a
pouding for a galette was noise, usability round 5), one row each: its title, where it is
from (« de Tante Aline », « carte, 1998 », the provenance line of
`sideReader`, `src/lib/server/duplicates.ts`), why it is asked (« même titre »,
« presque les mêmes ingrédients », « titre semblable », with « · 82 % en
commun » when ingredients were compared) and its group, with a « Voir ↗ »
link; a radio picks the target when there are several, none picked at first
(round 5: a pre-picked target was grouped without being read): « Regrouper
avec… » stays off, « (choisissez la recette ci-dessus) », until one is. A
single candidate is the target. The answer names the target: « Regrouper avec Pouding chômeur — de
Tante Aline » / "Recette différente", both outlined (secondary) buttons — the
screen's one filled button is the save. What grouping does (both cards kept
whole, under one dish, each with its version name) is said once it is chosen,
with the fields: the group's name, a name and never a slug (the target's
group's name, else the shorter of the two titles when one starts the other,
else the shorter; on save it is the known group with that name or slug,
accents and case aside, else a new group with the name's slug), and each
side's « Ce qui distingue », prefilled by `variantPrefill` from where each is
from when that tells them apart (the target's own variant, shown by
`variantShown`, when it has one). A `like`-only question is a hint, as in the
form: the save keeps its own name until she answers it. The save
row ends the file's card for one file and the result for several, and is
sticky (`position: sticky; bottom: 0`): while she scrolls the card it stays at
the bottom of the screen, inside the card, and it settles in its place once
the card's end is reached — never over the card's own content below the
item being fixed, never fixed above another part of the page; a jump to an
error scrolls it clear of the bar. On a phone the bar is one compact line ("✓" alone for "Valide"; the error count, a
link to the first error). The button names what it saves ("Enregistrer « … »", "Enregistrer les 3
recettes"; "Enregistrer" on a phone) — or, when the file asks the same-dish
question, the answer it will act on: "Enregistrer sans regrouper" until it is
answered, "Enregistrer dans « <groupe> »" once « Regrouper avec … » is
chosen (the group's name as in its field; on a phone too), "Enregistrer comme nouvelle recette" after "Recette
différente"; held until the version name is given ("Nommez la variante pour
regrouper", a link to the field). "✓ Valide" sits beside it when every file
passes, else why it is off, at body size ("Corrigez 1 erreur pour
enregistrer", a link to the first error,
scrolled clear of the bar, its quick fix focused); the fix-request block is
copied from one "Copier la demande de correction" right under the errors (of
the first file that needs it; it covers them all).
Ctrl+Entrée (Cmd+Entrée on a Mac) saves from anywhere on the page, a
field or not; the hint is not shown on a touch
screen. The browser checks every change live with the checker library; the
server re-checks with the vault (`E103`, `W306`, `W503`, `W608`, `W505`) and is
the only judge on save. Several fences in one paste are saved in one commit; files that
fail stay in the box. What was saved is said in a card at the top of the page,
not a message at the bottom (UI council): « ✓ Recette enregistrée : <titre> »
with « Voir la recette » and « Ajouter une autre fiche » (which closes the card
and focuses the box, or the address field after a web import); several saved,
« 3 recettes enregistrées : » and a link to each. The card stays until she
closes it or the box's text changes; a photo attached or a file refused is
still a message. A collision (`E103`) is settled inline: the suffixed
slug (« Enregistrer comme pate-chinois-2 »), listed first and chosen until she
picks otherwise, or « Remplacer la fiche existante (l'ancienne reste dans
l'historique) » (an edit, with the hash guard below). Chosen either way, the
clash leaves the error list (usability round 4). Two files in one paste with the same new slug: the first
is saved under it, only the later ones get the choice — the suffixed slug
chosen by default, so both save in one commit unless she picks otherwise (a
copy pasted twice is still asked about as the same dish, below). A same title (`W608`)
asks whether it is the same dish; « Regrouper avec … » sets `family`/`variant` on the new file and on the vault
recipe she picked, each with its version name, in the same commit
(`add: <title>; edit: <other title>`), guarded by the other file's hash as the
check read it — a changed, deleted or broken other recipe, the same version
name twice, or two files of one paste pairing one recipe differently keep the
file in the box with the reason (issue #13; as the form, below, and
`/doublons`). A recipe with nearly the same ingredients (`W505`, "Possible
duplicates", below) gets the same offer, listed with the same-title ones; the
one she picks is put in the family. Two copies inside one paste are compared too: the later
file names the earlier one by its place ("le fichier n° 1 de ce collage"),
with no offer, as neither is saved yet. The fix-request block holds only `ai`
codes.

**Relire et modifier.** Each pasted file that passes the checker on its own
(Q3 A, as `/r/<slug>/modifier`) offers "Relire et modifier": the file opens in
her form ("Her form", below) on the paste page itself, at `/ajouter?recette=N`,
built by `toForm` in the browser — nothing to read in Markdown, YAML or marker
syntax, the same fields as on a phone or a tablet. It is a new recipe: its slug
comes from its title, the first free `-N`, so a clash with the vault or inside
the paste needs no choice there; "Remplacer" stays a paste box choice, and a
file with "Remplacer" chosen does not offer the form. Its draft has a slot of
its own per pasted file (`:collage:<slug>#<rank>`), offered back when the same
recipe is opened again ("Repartir du texte collé" drops it). Save goes through
the form's own save (`POST /api/form/save`); the file then leaves the paste and
she is back among the other pasted recipes, the toast linking the one saved
with "Annuler" — or on the recipe page when it was the last. A file with errors
does not open in the form: its errors are settled first (a quick fix here, else the AI). Until it is saved or emptied, the paste is
kept in the tab (`sessionStorage`, never sent anywhere), so a tablet that
reloads a tab left in the background, or a trip to the form and back, loses
nothing.

**Web import.** A URL typed in "Adresse de la page" (the "Une page web" tab of
the main card on the empty page) is fetched by the server — `http`/`https`
only, 10 s for the whole fetch (redirects and body included, not only while
idle), 5 MB, redirects re-checked, and never a host resolving to a private,
loopback, link-local or CGNAT address (checked on the address actually
connected to; an IPv4 address inside an IPv6 one — `::ffff:7f00:1`, NAT64,
6to4 — is checked as IPv4). The page's schema.org `Recipe` JSON-LD is mapped to the schema
(`extracted_by: web`, `source.type: website`, `source.url`); ingredient lines go
through the quantity and unit parser, and a line that does not read cleanly
becomes `{ name: "<the whole line> [?]" }` so the checker flags it — including
a quantity followed by a unit word the vocabulary does not know
(`2 cuillères à soupe …`), which is never read as `piece`. The result
lands in the box for review; it is never saved directly. The field takes
Enter, adds `https://` to an address typed without it, and says "Lecture de
la page…" while the server reads. A failure stays under the field, in one
plain sentence, until the address is changed — "Ce site refuse la lecture
automatique." (the site answers 401, 403 or 429: it blocks robots), "Cette
page ne contient pas de recette lisible." (no JSON-LD `Recipe`), "Cette page
est introuvable : vérifiez l'adresse." (404, 410), "Ce site est introuvable :
vérifiez l'adresse." (a name no DNS knows, never the system's own
`getaddrinfo` words), the timeout, the size, or an
address the server will not fetch. The address stays in the field. A
refusal or a page with no recipe adds one line on the likely cause ("Cause
probable : le site bloque les lecteurs automatiques…", "… la page ne déclare
pas sa recette dans son code…"). Then the ways that still work:
"Passer par l'IA (capture ou texte de la page)", which keeps the web tab and
shows the AI's three steps worded for a page ("joignez une capture de la page
ou collez son texte"), under « Page : <address> · Réessayer l'adresse »; the
prompt it copies ends with one line naming the page for `source`
(`pagePrompt`, AI-TEMPLATE.md, "A web page through the AI"). The other tab
gives the card's steps again. And "Taper à la main" (none after an address
refused as such: it is the address to fix). `/api/import` answers 422 with `{ error, kind }`, `kind`
one of `refused`, `noRecipe`, `address`, `other`.

The mapping, beyond the parser, reads what sites commonly write:
`recipeYield` of a number of portions ("4", "4 portions", "4 portion(s)",
"4 servings", "Serves 4", "4 à 6 portions" as a range) is `servings`; any
other yield ("Makes 12", "24 biscuits") stays `yield`. A size in nested
parentheses at the end of a line, "1 boîte (540 ml (19 oz))", is the
two-measure note `540 ml (19 oz)`, as written. A `HowToSection` whose name is
the recipe's title again (folded) is no section: its steps are kept without
the heading. An ingredient name whose first word only is capitalised
("Farine") is written in lower case; a name with a capital further in (a
brand, a place) is left alone. The review card of an imported page opens its
remarks: none of them was seen by an AI first.

Before it lands in the box the import is tidied by the same rules the paste
box offers as fixes, so it arrives with as few problems as possible:

- every `E204` and `E210` the quick fixes can settle is settled
  (`splitAll`, `src/lib/vault/quickfix.ts`: « Beurre : 2 c. à table » becomes
  `qty: 2, unit: tbsp, name: "beurre [?]"`); a line with a second amount after
  the first (« 3 gousses d'ail, 500 g, hachées », « 1 egg beaten with 1
  tablespoon water ») keeps the first and puts the rest in `prep`, marked `[?]`;
- a `HowToSection` named Tips, Notes, Storage, Make ahead, Variations (and
  Astuces, Conseils, Conservation, Remarques, À l'avance, Trucs), a `HowToTip`,
  or a step that starts « Tip: » goes to `## Notes` (« Storage: … »), not to
  the steps;
- with no `oven` in the page, the first °F/°C in the steps that reads as an
  oven (200–550 °F, 90–290 °C; `ovenInText`, the rule `W609` checks) fills
  `oven`.

A page whose recipe reads as English (`lang: en`) gets, first on its review
card, « Page en anglais · Faire traduire par l'IA »: the main action is
« Copier pour traduire », one tap that copies the prompt, the translation
request (`AI-TEMPLATE.md`, "The translation request": Québécois French,
`lang: fr`, quantities, unit codes and the source block kept, `note: traduit
de l'anglais`) and the imported file, « ✓ Copié » on the button for 2 s;
« Ouvrir Claude ↗ » beside it (copying too when not done yet). The save stays
possible but is not the primary button there. The next paste — anywhere, the
box or "Coller" — replaces the imported text instead of being added after it.
No data format changes: the answer is an ordinary French file.

**Paste log.** Every save attempt, and every copy of the fix-request block,
appends one JSON line to `cache/paste-log.jsonl`: time, number of files, and per
file the codes and the outcome (`saved`, `rejected`, `collision`, `stale`,
`fixed-after-N-attempts`). No title, no content: attempts at the same recipe are
matched by a 12-character hash of the slug. `vault stats` prints the code
frequency with the fixer of each code — which prompt rules the AI breaks in
real use. Losing the log is fine.

### Her form

**Decided (plan 04, Phases 2–5).** `/nouvelle` (a new recipe) and
`/r/<slug>/modifier` (an edit; offered only for a file that passes the checker,
Q3 A) — both sign-in pages. The form edits a form model (`src/lib/form/`,
browser-safe) built by `toForm` from the parsed file; `fromForm` turns it back
into a recipe object and a body, `serialize` into the canonical text, and
`POST /api/form/save` enters the paste's own save (`formSave` → `saveLocked`).
Opening a recipe and saving without a change writes nothing and commits nothing
(the text is compared with the file as the app would write it); the round trip
is byte-identical over the fixture vault and the 320-card corpus.

- **Slug.** A new recipe's slug comes from its title, the first free `-N` against
  the index, the trash and the disk, chosen under the lock: `E103` never reaches
  her. An edit never changes the slug, whatever the title becomes.
- **What the form does not model** (Q4 A) is carried: the preamble, sections
  other than method / notes / variants / alternatives, `item:`, other `media`
  keys. The preamble and those sections are shown, editable, as « Texte
  libre » (never hidden, written back as typed); the form always has a
  Préparation, and the free text's step lines can be moved into it (plan 04,
  "usability pass, round 1"). YAML comments and unknown keys are dropped, as by any app save. An
  untouched method section is written back as its original text; a changed one
  is rewritten canonically (`1.` numbering across sub-headings).
- **Checks.** The browser runs the checker on exactly what Save would write;
  every error blocks Save on its row and field, in French. Warnings are hints
  (Q9 A): the name-word ones (`W302`, `W304`, `W607`) live in the browser, the
  vault ones from `POST /api/form/check` (debounced while she types, never
  blocking). A `W305` on a name a typo away from exactly one ingredient's name
  asks « Vouliez-vous dire « oignon » ? » with « Oui », which writes that name
  (plan 04, usability round 2). An error the server check still returns is a bug in the form:
  logged with its codes, and she reads one sentence ("rien n'a changé").
- **Family** (Q10 A): a new family's French label, as she typed it, goes into
  `vocab/families.yaml` in the recipe's commit — only when the family has no
  label yet, so her save needs no hash of that file. `W608` "En faire deux
  versions" puts the other recipe in the family too, in the same commit
  (`add: <title>; edit: <other title>`), guarded by that file's hash. `W505`
  (nearly the same ingredients) makes the same offer for the first close
  recipe not already offered by its title (plan 05, Phase 6).
- **Tags** (Q11 B): autocomplete over the canonical tags, their labels and
  aliases; a tag not in the vocabulary is written as typed and indexed as
  pending (below, "Pending tags").
- **Status** (Q14 A): see Conveniences. `extracted_by` absent → `hand`, kept on
  an edit.
- **Drafts** (Q17 A): the form is kept in the browser's `localStorage` (per
  recipe, one slot for a new one) and offered back on reopening; offline, Save
  says so and keeps it. No server-side draft, no queued save.
- **Stale** (Q18 A): "Concurrent edit", below.
- **Photo**: sent to `/api/photo` after the recipe's save, with the slug and
  hash that save returned ("Dish photos", below).
- **Save**: Enregistrer or Ctrl+Entrée from any field (hint not shown on a
  touch screen); success opens the recipe page with « Recette enregistrée. »
  (« Modifications enregistrées. » for an edit).
- **Annuler** in the toast after a save: `POST /api/form/undo` (`commit`,
  `slug`) — "Undo and history", below.

### Delete

Never unlink. Move the file to `_trash/<slug>.md` and its `media/<slug>/` folder alongside it, commit, remove the
index rows (a file git never tracked is moved and committed all the same). A trash view (`/corbeille`) restores it — refused if the slug has been
taken again. A slug in the trash counts as taken for a new paste (`E103`, offered
only the suffixed slug), so a deleted slug is never silently reused. Combined
with the git history this means no single click she makes is unrecoverable.

### Undo and history

Plan 04, Q16 A. Every save is a commit, so undo is a `git show`, never a
rewrite: no `git revert`, no reset, no amend. Both actions write an old text
back as a **new** commit by the signed-in person, byte for byte (its `status`
and `updated` included: undo means "as it was"), through the save's steps:
today's checker with the vault's entries, the hash guard, one commit, the index
rows, the push. An old text the checker now refuses is not written; she is told
in one sentence and the owner can take it back by hand (`git show`).

- **Annuler** (the toast after a save, and after a restore or an undo — undo of
  an undo is a redo), `POST /api/form/undo` from the form's toast or
  `/r/<slug>/historique?/annuler` from the history page, with the commit:
  `undo: <title>`. Each recipe the commit changed goes back to its text before
  it, refused unless the file is still exactly as that commit left it. A recipe
  the commit created goes to the trash (`delete:`); a trash move is undone by
  the trash's own restore or delete, media folder included. A
  `vocab/families.yaml` change in the same commit (a label written with the
  recipe) is undone with it when unchanged since, else kept; a new recipe's
  label is kept. A commit touching anything else (prices, the registry) is not
  undone from here.
- **Historique** (`/r/<slug>/historique`): the commits of the recipe's file
  as `git log --follow -M` lists them (through `_trash/` and back, and a slug
  renamed by hand), read from the commit index (below, "Commit index") rather
  than from git on each visit; it stops where this recipe began — its creation,
  or before the removal of an earlier file under the same slug. Newest first:
  date, author, and what changed in plain French, computed by parsing both
  versions into the form model (title, ingredients added / removed / changed,
  steps, tags, photo, fields, "Vérifié", readings settled) — never a diff of
  Markdown. Under that list, a changed ingredient line and a changed step show
  word by word on the paper, in the recipe's serif: the old words struck, the
  new underlined, the rest as it reads (« ~~1 ½~~ 2 lb de porc »; usability
  round 4, `render/worddiff.ts`, `changeDetails` in `history-diff.ts`). Lines
  pair by position; a step added or removed shows whole. Past 400 words, or
  when the two share under a third of their words, the old text shows struck
  then the new one whole. **Revenir à cette version** shows what going back would change,
  then writes `restore: <title> (version du <date>)`, guarded by the hash of
  the file the page showed. The restore finds the commit among the recipe's
  versions in the commit index and reads that one text (`<commit>:<path>`),
  not the whole history. A version under another slug, or that fails
  today's checker, is shown but not offered. A recipe in the trash shows its
  history without the button: it comes back through `/corbeille` first.

### Commit index

Issue #10 (option A). `git log --follow -- recipes/<slug>.md` walks every
commit of the vault — ~2–7 s at 20 000 commits in the flat `recipes/`
directory — so the history page reads the index instead: `commits` and
`commit_files` in `cache/index.db` (below, "Index schema") hold every
non-merge commit reachable from HEAD, in `git log` order, with the paths it
changed (`git log -M --name-status`, renames detected over the whole tree).
A recipe's history is a walk over those rows that does what `--follow` does:
a commit shows the path as it would alone (a file renamed away reads as
deleted), and a path created by a rename goes on under its old name.

- **Caught up**, never trusted blindly: `meta.commits_head` is the HEAD it was
  read up to. Every history read, restore and undo first compares it with HEAD
  (read from `.git` without running git; `git rev-parse` for an unusual
  layout) and reads only `<last>..HEAD` — the app's own
  commits (also read in the background right after each one), a pull, a
  commit made by hand. When HEAD no longer descends from the last commit read
  (an amend, a reset, a rebase, another branch), or the new commits hold a
  merge (git's date order could then interleave them with older ones), the
  whole history is read again. App startup and `vault sync` catch up too.
- **Undo and restore** use it too: a restore finds its commit among the
  recipe's versions there and reads the one text; an undo reads what the
  commit changed from `commit_files` (what `git diff-tree -M` gives), falling
  back to git for a commit the index does not hold (a merge — refused anyway —
  or one not on HEAD's line).
- **Rebuildable**: deleting `cache/` loses nothing — the next read (or the
  startup) reads the whole history again, ~5 s at 20 000 commits, once.
- **One difference from `git log --follow`, on purpose**: when a path is
  created, `--follow` also looks for a file it could have been *copied* from
  (git turns on `--find-copies-harder` to follow) and, if one is similar
  enough, goes on in that other recipe's history — a variant made from
  another recipe (the W608 "En faire deux variantes du même plat" pair) would list the other
  recipe's versions as its own. The index counts a copy as a creation: the
  history of a recipe starts where that recipe began. Renames (the source
  removed in the same commit) are followed as before.

### Dish photos

`POST /api/photo` (signed in; multipart `slug`, `hash`, `photo`), from the
recipe page's "Ajouter une photo" (an item of its ⋯ menu, there when a recipe has no photo —
`W603` stays deferred, plan 04 Q13 A), from the form (after the recipe's
own save, with the hash it returned), and from the paste box (the card's
photo, after the paste's save, with the hash `/api/save` returned: "The card's
photo on the recipe", above). Same order as a
save, around the recipe file: size (25 MB) and type by content checked, the
image decoded into its two derived copies in memory (a file that does not
decode is refused) — all before the lock, writing nothing. Then, under the
lock: the original is written to `media/<slug>/final-<date>-<n>.<ext>`, the
recipe file — only if it still has the hash the page showed — gets
`media.final`, is serialized and committed as `edit: <title>` (status kept),
and indexed; a stale hash or a failed commit removes the new original. Then
the copies go to `cache/img/`. `DELETE /api/photo` (`{ slug, hash }`) unsets
`media.final` the same way and keeps the file. Refusals come back as 409
(changed, gone, or a file that fails the checker), 413 (too big), 415 (not a
photo, unreadable), each with a French message. `bin/serve.js` raises
adapter-node's body limit to 26 MB for it (`BODY_SIZE_LIMIT`, default 512 KB).
`/media/<slug>/<file>?v=thumb|display` serves the derived copies only (made on
demand when missing), with an ETag; the kitchen-mode service worker keeps the
display copy, not the card thumbnails. Measured: see "Final figures for P2"
below.

### Family labels

`/famille/<slug>` (and « Renommer » on each line of `/familles`, the owner) sets a family's French display label in
`vocab/families.yaml` (`VOCAB.md`, "Families"). Same order as a save: the
page carries the hash of `families.yaml` it was rendered from and the write is
refused if the file changed since; the file is rewritten atomically (comments
and other entries kept), committed alone as `family: <slug> → <label>` (or
`family: <slug> (label removed)`), then the `families` index rows are refreshed
and the push scheduled. A failed commit puts the file back. The watcher
ignores the write by its hash, like a recipe save. A `families.yaml` that no
longer reads as YAML is not overwritten: the page says to fix it first.

### Pending tags

`/etiquettes` (plan 04, Phase 8) lists the tags the index holds as pending,
with their recipes, and settles each one in one commit by the signed-in person,
hash-guarded on `vocab/tags.yaml` and `vocab/tag-labels.yaml` (one version
string for both): "Nouvelle étiquette" (`tag: new <slug> → <label>`, both
files), "C'est comme…" (`tag: <pending> → <canonical>`, `tags.yaml` alone),
then a retag of the index. `tags.yaml` is edited as text, one line, so its
comments and alignment stay. "Retirer" (`tag: drop <pending>`) rewrites every
recipe holding the tag in one commit, guarded by each file's hash and by the
set of recipes the page listed; a recipe with errors stops it.

The page is one compact row per tag (`VOCAB.md`, "Tags": « Garder « Érable » »,
✎, « C'est comme… », « Retirer »). Each decision folds its row away at once (clicks held for the 350 ms the list
takes to settle) and says so in the app's toast with « Annuler » for 10 s
(`lib/settle.svelte.ts`). « Annuler » after "Nouvelle étiquette" or "C'est
comme…" reverts that commit's vocabulary files (`lib/server/revert.ts`: every
file it touched back to its parent's text, refused when one changed since),
commit `undo: <subject>`, then a retag; after "Retirer" it is the history's
undo of the recipe commit.

A pending tag gets a known tag preselected under "C'est comme…" only when it is
the same word but for its ending (plural, feminine, accents) or, for a word that
is not an ingredient's name, a typo of one (one edit in five letters or more,
two from eight, first letter kept); otherwise nothing is preselected and the
card opens on "Nouvelle étiquette" (`lib/vault/tagmatch.ts`; docs/VOCAB.md,
"Tags").

### Possible duplicates

The duplicate model (`INGREDIENTS.md`, "Duplicates") is kept in memory per
index state; the pairs settled as different (`vocab/distinct.yaml`) are read
from the file on each request and filtered out. `W505` is computed beside the
unresolved-name warnings in the paste box's server check, the form's check and
the save result (the recipe's own slug left out). `/doublons` (plan 05, Phase
7) shows the unsettled pairs as cards: the pairs linked by a recipe make one
card (« 3 fiches semblables »), the new cards first (below), then sorted by their closest pair, then by size, 10
cards a page (a phone shows 5, then « Voir les 5 suivantes »). A pair links its
recipes into one card only when it is very close (90 % or more) or the two
titles start with the same word that says something (`titleHead`: little words
dropped, folded, a plural's s off — « Pouding chômeur » and « Pouding chômeur à
l'érable »); the pairs between two sets kept apart make one card of two of
their own (the closest such pair shown, « Et 2 autres paires entre ces deux
plats »; « Recettes différentes » there settles them all) — usability round 2,
where one 68 % pair joined « Grands-pères » and « Pouding chômeur » into an
11-fiche card. The badges (« 100 % en commun · Même titre · Même préparation »)
are the closest pair's, labelled so on a bigger card (« Les 2 plus proches : »).
A card shows its closest three (the closest pair, then each by its closest
pair with those before it); the others wait behind « + N autres fiches », and
a decision is about the recipes in view. Each fiche is named by where it
comes from, the provenance line with the year a note gives (« de Tante Aline,
1994 », « Coup de pouce », `PairSide.from`), never « (1) » / « (2) »; « Fiche
sans source » when there is none. The head counts cards, said so, how many
are done this visit (the count when the tab first opened, in
`sessionStorage`) and how many are very close (a pair at 90 % or more):
« 258 groupes à décider · 12 sur 270 faits · 40 très semblables »; it drops
the moment a card folds away — usability round 3. A decided card folds into one
line where it stood, « ✓ Fèves au lard : 2 variantes · Annuler », the
decision's one undo (UI council: no toast beside it; a screen reader hears
what is left, « Reste 257 groupes à décider. », from a hidden status), and
focus moves to the next card.
A decision about some of a card's recipes (the closest two of seven) leaves
the others linked: they come back as a card of their own, nothing open, the
closest two ticked, right under the receipt (« · la carte reste : 5 fiches
encore semblables »), and focus lands on it. The head counts cards, so such a decision
leaves it as it was, or one more when the card splits in two — round 3 kept
the old card's open panel and ticks because the card kept its key (its
slugs), which read as « nothing happened » (usability round 4). On a wide
screen with a keyboard: J / K next / previous card, 1 2 3 open its three
choices (the first field focused), Échap closes them, said behind a small
« Raccourcis clavier » disclosure above the cards, closed. Pairs already in one family are left out unless their
ingredients and amounts are identical (Q16 C; unchanged). Readable by anyone,
its actions need a session, and « Doublons » is always in « Plus » for an
account with the Markdown tools, with only what is new after it (« Doublons ·
1 nouveau »; PLANNING.md, « Plus »). On a card of
three or more, each recipe has a tick and the decision acts on the ticked
ones: only the two of the closest pair are ticked at first, marked « Les plus
proches » (an ink rule, not red), so « C'est la même recette » never trashes a
far fiche she did not look at; its button names the count (« Mettre 2 fiches à
la corbeille ») — usability round 3. Slugs show only in a « Détail » disclosure; the group's name is
prefilled with the shortest title, and each « Ce qui distingue » is labelled
with that recipe's title. A group with no label reads as its recipes write it
(`familyNames`: « Sucre à la crème », never the slug's « Sucre a la creme »). Each action is one decision by the signed-in person,
the card folds into its receipt, whose « Annuler » undoes it:

- "Deux variantes du même plat" (« Variantes d'un même plat » on a bigger
  card): `family`/`variant` set on every ticked recipe (and the family's label
  in `vocab/families.yaml` when it has none), one commit `edit: <a>; edit:
  <b>…`, hash-guarded on every file, each result checked before anything is
  written. The family is the one a ticked recipe is in (a choice when they are
  in several), else a new one named by her. Undone by the history's undo.
- "C'est la même recette": the one she does not keep goes to the trash
  (`delete: <title>`, hash-guarded), undone by the trash's restore. A recipe
  another recipe uses as a sub-recipe is never trashed from here: each side
  lists where it serves, the used side cannot be picked, and when both are used
  the action is not offered (plan 05, review fixes; kept by the owner
  2026-09-30).
  On a bigger card she keeps one of the ticked and the other ticked ones go,
  one `delete:` commit each, all checked first; "Annuler" restores them all.
- "Recettes différentes": the pair added to `vocab/distinct.yaml`, commit
  `duplicate: <a> ≠ <b>`, hash-guarded on the file; "Annuler" takes the line out
  (`undo: duplicate <a> ≠ <b>`); when that leaves only the app's own header,
  the file is removed, as before the first decision. On a bigger card, the
  pairs among the ticked (all its pairs when every recipe is ticked); one
  ticked alone: its pairs with the others (« Pas le même plat que les
  autres »), in one commit `duplicate: N pairs` (the pairs in the body).
- « Toutes différentes », after the close cards (its quiet line under the
  last one, UI council): the cards little alike
  (`lowGroups`: every pair under `LOW_CLOSE`, 80 % in common, with titles not
  alike — not the same, not within two edits, not the same head word — another
  method, and both recipes in one language, since a pair across languages is
  often one dish translated) listed by their titles in a disclosure, settled in
  one commit as "Recettes différentes"; « Annuler » takes them all out. The
  server recomputes the set and acts only on the cards posted that still
  qualify. On the invented demo vault, 5 of 75 cards.

« Nouveau » (a small navy tag, never the red rule) marks a card holding a
recipe saved after the device's mark (see PLANNING.md, « Plus »); those
cards are the duplicates part of the Plus number. They sort first, and the
head's « 3 nouveaux » is a link to the first. Once the first page has shown
every new card, the device's mark moves up to the index's (`markSeen`): the
Plus number no longer counts them; the tags stay for the rest of the visit.

### Grouping variants

Besides /doublons and the form's « Variante de », the owner groups variants
from two places, each one commit `edit: …` hash-guarded, with « Annuler » in
the toast (the history's undo):

- « Grouper avec… » in a recipe's ⋯ menu opens `/familles?grouper=<slug>`: she
  searches a group (joins it) or another recipe (the two become a group: the
  one either is in, else a new one named after the shorter title). Then the
  group's page. The search ranks by how like the recipe each one is
  (`groupingScores`: the better of its title, read as the form's « Ressemble
  à » reads it — same 1, two edits off 0.95, one title holding the other
  whole 0.9, the same head word 0.7 — and its ingredients' weighted Jaccard; a
  group scores as its likest recipe), not alphabetically; before she types,
  the likest at 0.6 or more is offered on one line, the group when that
  recipe is in one: « Suggestion : Pâté chinois · 3 variantes [Grouper] »
  (usability round 4). The chosen target's preview says « N ingrédients en
  commun sur M, hors ingrédients de base » (distinct linked ingredients, the
  registry's staples left out; M counts both sides), and under 30 % of M
  (`SHARED_LOW`) a soft note « Peu d’ingrédients en commun : est-ce bien le
  même plat ? » — never a refusal (round 5).
  Its toast's « Annuler » reverts the commit, then says « Groupe défait :
  « … » n’en fait plus partie » and refreshes the group's page; when the group
  is gone (a pair undone) it goes to the recipe's page instead.
- « + Ajouter une recette à ce groupe » on `/famille/<slug>`: a recipe joins
  that group. Refused when another member already has that variant.

« Ce qui distingue » (here, on /doublons and in the form) starts with who the
recipe is from, capitalised as written and with its « de » (`fromLabel`:
« de Tante Aline », « d’Hélène »; no author: the book's or magazine's title,
« du Livre des desserts », else its kind, « du livre », « de la revue », « du
site », « de la télé ») when no other recipe of the group reads the same; else
it is empty, with examples in the placeholder (« ex. zeste de citron, sans
sucre »). Never a fragment of the title (usability round 2: « aux », « trois »).
A variant written as a slug reads back from the source (`variantShown`:
`lise-b` for « Lise B. » reads « de Lise B. », `revue` « de la revue », else
the hyphens become spaces). The recipe page shows it after the family link
(« Une des 3 variantes de Tourtière — sans porc »), unless it only repeats the
author the provenance names (usability round 3).

The comparison on `/famille/<slug>` marks an ingredient a variant has with
✓ and one it lacks with –, under a legend line « ✓ : dans cette variante ·
– : absent » (a lone dot read as a bullet; usability round 4).

On /familles each group is one line of facts, « 3 variantes · 45 min–1 h 10 ·
Dessert » (the span of total times, the most common course tag), then its
variants' labels in a serif line. A group of one recipe stays listed for the
owner (more may be on the way), with « · à compléter : ajoutez une 2ᵉ
variante » after its facts; a family account (no
Markdown tools) sees only the groups of two or more, and /garde-manger shows
it no « + N ingrédients pas encore reliés » (the owner's upkeep, a link to
/resoudre for the owner). In the form, Enter (or leaving the field) in
« Variante de » takes the top suggestion, « Ce sera le groupe : … » says what
it will be, and « Aucun groupe existant n'a un nom proche » shows only when no
group is listed. Once a group with recipes is chosen, « Elle rejoindra :
Tourtière (3 recettes) » lists them before the save (« Les autres recettes du
groupe : » on an edit already in it; read from `/famille/<slug>/membres`).
The form's live check also names a recipe whose title this one holds whole,
or that holds it (« Pouding au riz » / « Pouding au riz de la voisine »;
`titleMatches().like`, two words at least): « Ressemble à « Pouding au riz »
(Carmen). En faire une variante » under the title only (round 4: no longer
repeated beside Enregistrer), and not when that recipe is already in this
one's group. A pair made from the form is a new group named after the
shorter title.

"Comparer" (`/doublons/comparer?a=…&b=…`) shows the two recipes side by side,
every field where they differ, read-only: the form's stale-compare table.

### Ingredient edits: the resolve queue

`/resoudre` (plan 03, Phase 3) lists every unresolved or ambiguous lookup key
across the vault, most frequent first, with its written forms, counts, the
recipes using it (a browse link) and its candidates. Three actions, each one
ingredient file in one commit, and never a recipe file:

- **Relier** ("C'est ça" on a candidate, or any entry by name): the key's most
  frequent written form is added to the entry's `names.<lang>`, `<lang>` being
  the language of most recipes using it. Commit `ingredient: <slug> + "<form>"`.
- **Créer**: a new `ingredients/<slug>.md` (slug proposed from the name,
  category required, `staple` optional) whose first name is that form. Commit
  `ingredient: add <slug>`. Refused if the slug is taken.
- **Retirer** (an ambiguous key): the alias is taken off one of the entries that
  share it. Commit `ingredient: <slug> - "<form>"`.

Same order and guards as a save: a candidate carries the hash of its entry file
and the edit is refused if the file changed since; the frontmatter is edited as
YAML (comments, order and body kept) and must still pass its own check; the
file is written atomically and committed, a failed write or commit puts it
back; then the registry is reloaded and every row re-resolved from its key.
Writes of every kind (recipes, family labels, ingredients) go through one helper,
`src/lib/server/files.ts`. « Plus » always lists « À relier », with no count
(a backlog: the total is in the page's head); `vault
queue [--limit N]` prints the same queue. The page shows 30 keys, the total in
its head, and « 30 sur 66 — Voir les suivants » adds 30 more (`?n=`, up to
1000). Each action folds its row away with the toast and « Annuler », which
reverts that ingredient commit (`lib/server/revert.ts`, refused when the entry
changed since), commit `undo: <subject>`, then the registry reloaded. A
candidate shows by its name; its slug shows (small) only when two candidates
share a name. The candidates are the ones worth showing (`shownCandidates`,
docs/INGREDIENTS.md, "Resolution"), strongest first: the first is the primary
button. On a keyboard, 1, 2, 3 pick the row's candidates (the focused row,
else the first left) and Enter the first, ignored while typing in a field
(usability round 3). Only a strong candidate (docs/INGREDIENTS.md, "A sure
suggestion and a guess") is primary and taken by its key or Enter; a guess's
key focuses it and nothing more (round 5). The « À relier — N » count in
« Plus » and the page head follow each link and its undo.

### Ingredient edits: the ingredient view

`/ingredients/<slug>` (plan 03, Phase 6) shows one entry — names and rules,
allergens, density and weights, the current price and the price history (with
the change of the unit price from the previous row when the packs compare), the
recipes using it sorted by quantity in its `default_unit` (else the current
pack's unit, else the unit most used; quantities that do not convert come after,
out of the total), the vault total, substitutes both ways, and the unresolved
names whose queue candidates include it. Its edits go through the same path and
guards as the queue (entry hash, YAML edit, own check, one commit, re-resolve):

- **Ajouter un nom**: commit `ingredient: <slug> + "<name>"`. **Relier ici** on
  a drifting name is the queue's Relier.
- **Modifier**: names, category, `default_unit`, `staple`, `au_gout`,
  `density`, `weights`, `substitutes` (existing entries only), `allergens`
  (from `vocab/allergens.yaml`). Commit `ingredient: edit <slug>`.
- **Fusionner dans…** (Q25 B): the absorbed entry's names, rules, substitutes
  and allergens join the target, its notes are appended, entries naming it as a
  substitute name the target, and its file is deleted: one commit,
  `ingredient: merge <from> into <into>`. Refused when `prices.csv` has rows
  for it (the file stays append-only) or a recipe names it in `item:` (the
  app does not rewrite recipes for ingredient edits).

### Price entry: the ingredient index

`/ingredients` (plan 03, Phase 4) lists every registry entry with its category,
the recipes using it as a main ingredient line, and its current price. The
default order is the order to enter prices in: unpriced first, then the most
recipes. Each row opens an inline editor (amount, pack size and unit — the
entry's `default_unit` by default —, shop, date — today by default). Saving
appends one line to `prices.csv` and commits it alone as `price: <slug>
<amount> / <pack_qty> <pack_unit>`, through the same helper (atomic write,
rollback on a failed commit, recorded as the app's own write); then the
`prices` rows are reloaded. Enter saves and opens the next row.

### Cost on the recipe page

The recipe page (plan 03, Phase 5) computes the recipe's consumed cost on each
load, from the index only: the parsed recipe and its sub-recipes (`recipes`),
the resolved entry of each line (`ingredients.item`, by slug and position — so
a change to resolution changes the cost with no cost code involved), the
entry's `density` and `weights` (`registry`), the `current_price` view, and the
factors in `vocab/conversions.yaml`. Nothing is stored: a new price or a new
link shows on the next load. The server sends the totals at the base servings
and every line's cost; the browser multiplies the total by the servings
adjuster. The rules are `INGREDIENTS.md`, "Cost".

### Scaling on the recipe page and in kitchen mode

A recipe read at another amount (plan 05) is display only, in the browser:
nothing scaled is ever written to a file, to the index or to git — not the
quantities, not `servings` (Q9 A: the card as written is the archive; a version
she really cooks differently is a new recipe typed in the form). The page load
carries the rules (`vocab/scaling.yaml`, how amounts show: `VOCAB.md`,
"Scaling"); every tap after that is local.

- **The amount lives in the address** (Q1 A): `?portions=8` when the recipe
  has servings and they come out whole, else `?fois=1.5`; nothing at the card's
  amount. The recipe page rewrites it as she taps (a navigation that replaces
  the history entry, so the entry Back returns to holds the amount; no load
  reads the address, so nothing is fetched), so a reload, the back button, a
  bookmark or a link sent to someone else shows the same amounts; a recipe opened
  fresh shows the card's. Kitchen mode's « Retour » link carries the amount
  cooked there. A value that does not
  read (`1e9`, `0x10`, a sign) or lies outside the file's `factor` cap (×0.1 to
  ×20) is ignored. Kitchen mode keeps its own per-device session
  (`localStorage`, 12 h): the address wins when present, then is dropped, so a
  reload resumes what was set there. The service worker caches kitchen pages
  under the path alone; the parameters create no cache entry. While a session
  is resumable on the device (same recipe content, under 12 h, not finished,
  and something done: a step reached, a tick or a timer), the recipe page's
  « Cuisiner » reads « Reprendre · étape N » and its link carries no amount, so
  the cook goes on at the session's own; read in the browser only
  (`lib/kitchensession.ts`), the server's page always says « Cuisiner ».
- **Ways in** (Q8 B): the stepper (±1 serving, to the next whole number), the
  multiplier list for a recipe without servings, « Autre quantité » on every
  recipe, and tapping an ingredient's amount to type what she has (factor =
  typed ÷ written, from the lower bound of a range; not a `to_taste` line, not
  a zero). « Autre quantité » asks for the count she wants when the recipe gives
  one — « Pour [10] portions », else a yield that is one plain count (« Pour
  [3] tourtières »; `render/target.ts`) — and shows the factor it makes beside
  the field (« = × 1 ¼ »); a recipe with neither asks for a multiplier. The
  controls are one row — the stepper or the multiplier chips, and « Autre
  quantité » — and never change size or place as the amount changes (the
  multiplier chips stay the same five; a factor not among them presses none).
  Under them, a line whose height is always kept, so the list never moves:
  scaled, « Recette × 2 · donne 4 tourtières · Remettre » (the yield only when
  the recipe gives one; « Remettre » returns to the card); at × 1 nothing (the
  head already says what it makes), or the hint. Scaled, one short note under
  the list says what stays the card's and what ≈ means: « Temps et four
  inchangés · prévoir 4 assiettes à tarte · ≈ arrondi » (the steps named when
  none of their amounts shows its scaled value, the pan when none is found);
  no notice above the method (usability round 6). A tappable amount has a
  dotted underline in the ink and a 44 px target; one hint (« Touchez une
  quantité pour tout ajuster ✕ »), in that line at × 1, shows per device until
  she scales once (by any control, a tapped amount included) or closes it.
  Escape closes « J’en ai » (focus back on the amount) and « Autre quantité »
  (focus back on its button).
- **Servings and yields** (Q7 A): a servings range is scaled at both ends; a
  text yield's leading plain number or fraction is scaled as a count and the
  rest kept (`24 biscuits` → `48 biscuits`); a text with no such number, or a
  range (`2 à 3 douzaines`), shows as written with `(× f)`. The words after a
  number keep their written number (`1 moule` → `2 moule`), as ingredient
  names do: see below.
- **Names.** A scaled line changes its amount and its unit word
  (`1 tasse` → `2 tasses`, from `vocab/unit-labels.yaml`). A measured line's
  name stays as written. A bare count (`piece` or no unit) agrees with the
  number it shows, French from 2 (`1 ½ navet`, `2 navets`), English above 1:
  1. the registry's form first, when the line is linked to an entry that names
     it: an entry name that differs from the line's, word for word, only by a
     plural suffix of `vocab/normalize.yaml` gives it, in the line's own
     spelling (`oeuf` with `œufs` in the entry: `2 oeufs`; `1 ½ oeuf`);
  2. else, in French and at a factor other than 1, a small rule set
     (`render/agree.ts`): each word before the first preposition (`à`, `de`,
     `d’`, `en`, `au`…) takes its plural — `-s`/`-x`/`-z` unchanged, `-al` →
     `-aux`, `-au`/`-eau`/`-eu` → `+x`, the usual exceptions, an invariable
     list (`orange`, `maison`, `crème`…), a capitalised variety and anything
     after a marker left alone — so `1 croûte à quiche` × 4 reads `4 croûtes à
     quiche`. The rule only adds a plural: a name written plural is never taken
     back to the singular without a registry form. English has no rule;
  3. the prep's leading past participles and adjectives then agree with the
     name (`râpé` → `râpés`, `écrasée` → `écrasées`, `finement émincé`, `pelé et
     tranché`), up to the first preposition, comma or unknown word: `coupé en
     cubes` → `coupés en cubes`; `en cubes`, `au goût` never change.
  At × 1 without a registry form, the card's words as written (`2 navet` stays).
  One function for the recipe page and kitchen mode: `countWords` in
  `render/ingredient.ts`, applied by `ingredientParts`/`ingredientText`. Both
  page loads send each linked line's registry forms (and its weights, for the
  grams beside a count) from `ingredientLinks`; kitchen mode receives them as
  `lineForms`, keyed by the line's position across groups (as the index
  numbers it), and hands them to `ingredientText` for its checklist and its
  step chips, so a line reads the same on both pages (`2 ½ poivrons verts`).
- **Sub-recipes** (Q5 A): kitchen mode's inline expansion is read at `line
  amount × factor / yield` — the cost rule (`INGREDIENTS.md`, "Cost";
  `subRecipeFactor`, one shared function) — when the sub-recipe's `yield`
  object is in the line's unit or class; one crust of a pastry that makes two
  shows the half pastry, at ×1 already. Otherwise (a text yield, another
  class) it shows as written with « Recette complète : donne … ». A
  sub-recipe's own sub-recipes open inside its expansion the same way, each
  level read at the amount its line needs at the level above (the factors
  multiply; a level shown as written counts as ×1 for the one below), each
  level kept inside the file's `factor` cap, up to 4 levels deep; a recipe
  never opens inside itself. The page load carries each sub-recipe once, at
  the shallowest level that uses it. The recipe
  page's sub-recipe link carries the same factor (`/r/pate-brisee?fois=0.5`),
  or none when it is 1 or cannot be derived.
- **Amounts in steps** (Q6 B): measures written in a step (mass and volume
  units found with the vocabulary's unit words, `t`/`T` by the recipe's
  `lang`) get their scaled value beside them in a distinct style (`1 tasse →
  2 tasses`); the original always stays, so a misread (« un bol de 2 L ») is
  seen as one. Temperatures, durations and pan sizes use no recipe unit and are
  never found; counts and containers in steps are left alone (« couper en 8
  tranches » is a shape, not an amount). A range written in a step (`2 à 3
  tasses`, `2 - 3 tasses`) scales as one amount, except when its first number
  follows a word that labels it (*étape*, *step*, *n°*, *no.*, *numéro*, `#`):
  « Étape 1 - 2 tasses » is the amount `2 tasses` of step 1, not « 1 à 2 ».
  An amount is read as the step shows it, across emphasis and the `[?]`,
  `[?: …]` and `[+]` markers (« 1 **tasse** », « 1 [?] tasse »), never across
  `[illisible]`, code or a link. The timers read the original text.
  When the factor is not 1, the recipe page's note under the ingredients (and
  in kitchen mode a notice, once: on step 1, on the first step shown that
  visit, and on the step where the amount was changed — not on every step)
  says that times, the oven and the pan are the base recipe's.

### Pantry search

`/garde-manger` (plan 03, Phase 7) is read-only. The first search builds every
recipe's needs from the index (`ingredients.item`, `ingredient_or`, sub-recipes
flattened, `registry.staple`, `substitutes`, `ingredient_allergens`) and keeps
them in memory; any later write to the index (a save, a sync, a registry edit)
rebuilds them on the next search. The state is the URL
(`?have=…&must=…&avoid=…&allergenes=…&essentiels=non`); the last one is also
kept in the browser's `localStorage`. The rules are `INGREDIENTS.md`,
"Pantry search".

### Concurrent edit

Files mean last-write-wins, which silently eats an edit. Cheap guard: every
edit carries the hash of the file it was based on — the paste box's
"Remplacer", the « Marquer vérifiée » action, delete, a family label — and the save refuses when the file
on disk no longer has that hash. (A hash rather than `updated`: `updated` is a
date, too coarse to see two edits on the same day.) Two users at this scale will
rarely collide, but the one time they do it should not be silent.

The form (plan 04, Q18 A) carries the hash too. Refused as stale, it shows
"Cette recette a été modifiée entre-temps" with the other version beside hers,
the fields that differ highlighted; her form stays (and its draft, Q17).
"Garder ma version" saves her form again against the new hash; "Prendre
l'autre version" loads the other one into the form.

## Validation

The full list, with codes, is `VALIDATION.md`; this is the summary.

Hard errors — refuse to save:
- malformed YAML frontmatter (paste path only; the form cannot produce this)
- missing `title`
- `ingredients` missing or empty (`E200`), or any malformed ingredient entry —
  bad unit, qty without unit, quantity inside the name, and the rest of `E2xx`
- `slug` already exists → offer overwrite, or a suffixed slug
- `family` set without `variant`, or `variant` without `family`

Warnings — save anyway; the status follows the markers (Conveniences below),
not the warnings:
- no method section
- a tag not in the vocabulary → suggest closest canonical, else store `pending`
- a `family` close to an existing one (catches `lasagne` vs `lasagna`)
- another recipe has a near-identical title (duplicate paste — expected at 5000)
- another recipe has nearly the same ingredients under another title (`W505`,
  "Possible duplicates")
- no `servings`, no `times` (no photo is `W603`, not emitted: plan 04, Q13 A)

Conveniences:
- `slug` absent → derive from `title`: lowercase, strip accents, hyphenate
- `lang` absent → `fr`
- `added` → today on a new recipe, kept on an edit; `updated` → today on every save
- `status` → set by the app on every paste, never taken from the file: an AI file
  is never auto-`verified`. `needs-review` if any `[?]`, `[?: …]` or
  `[illisible]` remains (W605), otherwise `draft`. `verified` is set only by a
  person, with « Marquer vérifiée » beside the state's badge on the recipe page
  (for whoever has the Markdown tools; the ⋯ menu shows it disabled, with why,
  while an uncertain reading remains) — a one-field edit
  through the normal save path, committed as `verify: <title>`, refused while an
  uncertain marker remains. A **form edit** (plan 04, Q14 A) keeps the
  recipe's status instead — `verified` stays `verified` — except that a
  remaining uncertain marker means `needs-review`, and a `needs-review` with
  none left becomes `draft`. A new recipe from the form is `draft`.
- `extracted_by` absent → `hand`

Her form never shows a raw error. Invalid states are prevented structurally —
required fields marked, ingredient rows added by a button, family chosen from a
picker, tags from an autocomplete over the vocabulary (her own tag kept as
pending, Q11 B) — and the checker runs behind Save in the browser, blocking on
the field an error comes from ("Her form", above).

## Index schema (SQLite)

Derived. Regenerable. Not precious. Lives at `cache/index.db` inside the vault, excluded from git and backup. See `STORAGE.md`.

The authoritative schema is `src/lib/server/index/schema.ts`; its version is
stored in `PRAGMA user_version`, and an index from another version is dropped
and rebuilt (it is a cache). In outline:

| Table | One row per | Notes |
|---|---|---|
| `recipes` | recipe | the columns below, plus `data_json` (the parsed recipe, so a page renders without a disk read), `body_md`, `file_hash`, `uncertain` (count of `[?]`/`[?: …]`/`[illisible]`), `photo`, and `broken_json` while the file on disk fails the checker |
| `problems` | file failing the checker | codes and paths; the file's last good `recipes` rows, if any, stay searchable |
| `families` | family in use or in `vocab/families.yaml` | labels from the vocabulary; refreshed on every save, delete, restore, outside edit and sync |
| `tags` | recipe × tag | canonical via `vocab/tags.yaml` aliases at index time; unknown tags stored folded with `pending = 1`. The file is never rewritten (except by an explicit "Retirer" on `/etiquettes`). A vocabulary change recomputes every row and the FTS `tags` column |
| `seasons` | recipe × season | canonical value (`printemps`, `ete`, `automne`, `hiver`); aliases from `VOCAB.md` mapped at index time |
| `meta` | key | index bookkeeping: `tags_hash`, the hash of `vocab/tags.yaml` at the last retag; `registry_hash`, over every ingredient file's hash plus `vocab/normalize.yaml` and `vocab/allergens.yaml`; `prices_hash`, over `prices.csv` and the config's `currency` |
| `ingredients` | ingredient item | `group_idx`, `group_name`, `group_optional`, `qty`, `qty_max` (numeric), `qty_s` (as written), `unit`, `name` (as written), `optional`, `to_taste`, `recipe` (sub-recipe slug), `buy_instead`, `key` (lookup key), `item` (registry slug, NULL when unresolved), `resolution` (`override`, `rule`, `alias`, `plural`, `none`, `ambiguous`, `recipe`; `INGREDIENTS.md` "Resolution") |
| `ingredient_or` | `or` option of an ingredient item | `position` (the item's), `alt_idx`, `name`, `recipe`, `key`, `item`, `resolution`, resolved like an item |
| `media` | recipe × media file | |
| `registry` | ingredient file (`ingredients/<slug>.md`) | `name` (display), `category`, `staple`, `au_gout`, `density`, `default_unit`, `entry_json` (the parsed entry), `file_hash`; a file that stops passing its check keeps its last good row |
| `ingredient_names` | alias of an entry | `key` (lookup key, `INGREDIENTS.md` "Resolution"), `skey` (the key with the plural rules of `vocab/normalize.yaml`), `slug`, `lang`, `name` as written |
| `substitutes`, `ingredient_allergens` | entry × substitute, entry × allergen | |
| `prices` | `prices.csv` row that reads | `line` (its line number), `date`, `ingredient`, `amount`, `currency`, `pack_qty`, `pack_unit`, `shop`, `note`, `usable` (1 when in the config's `currency`); rebuilt whole when the file or the currency changed |
| `price_problems` | `prices.csv` line that does not read | `line`, `code` (`E812`, `E813`), message |
| `current_price` (view) | ingredient with a usable row | its latest usable row, a same-day tie going to the later line |
| `registry_problems` | ingredient file with diagnostics | codes `E801`–`W811`; `broken = 1` when it has an error |
| `recipes_fts` | recipe | FTS5 over title, body, ingredient names, author, tags |
| `commits` | non-merge commit reachable from HEAD | `seq` (`git log` order, higher is newer), `hash`, `author` (`%an`), `date` (`%aI`), `subject`; read from git, not from the files ("Commit index" above); `meta.commits_head` is the HEAD it was read up to |
| `commit_files` | commit × path it changed | `status` (`A`, `M`, `D`, `T`, `R`), `path` (after), `from_path` (before, for a rename); indexed by `path` and `from_path` for the history walk |

Durations are stored in seconds, the upper bound of a range; `total_s` is
`times.total` if given, else prep + cook + rest.

**Full-text search.** `recipes_fts` is a regular FTS5 table keyed by
`recipes.id` (its rowid), not a contentless one: `content=''` cannot return its
columns and needs the old values to delete a row. It costs a copy of the text,
a few MB at 5000 recipes. Tokenizer `unicode61 remove_diacritics 2`, and text is
**folded before it is indexed and before it is queried** (accents stripped, `œ`
→ `oe`, `æ` → `ae`, lowercase, markers removed): `remove_diacritics` alone does
not map the ligature `œ` to `oe`, so `boeuf` would not find `bœuf`. Each word of
a query becomes a prefix term (`"lasag"*`), all words required, so results
update as you type. A word (or a run of up to five) that names a registry entry,
alone or less a final s/x, also matches the entry's other names in both
languages and the lines resolved to it (`pomme` finds `apple`, `patate` finds
`pommes de terre`). It does not match another entry's compound name whose head
word (French first, English last) is that word and whose category differs:
`pomme` never matches `pommes de terre`, while typing `pommes de t` still does.
A whole word that names no entry but heads several-word names of entries
(French: the first word, English: the last; at most 12 entries) stands for
all of them: `poivron` finds the lines written `piment vert` or `green pepper`
and those resolved to those entries, except inside a longer name of another
entry (`red pepper` in `crushed red pepper`). Such a search shows « Aussi :
piment vert (40) · piment rouge (17) »: per entry, the name the box writes most,
with what a search for it alone finds — the two that find most, and only
names that narrow the list. A one-word search leaves out the names it heads
without naming a kind of it (docs/VOCAB.md, "Search words", names held
apart: `piment` never matches `piment de la Jamaïque`, allspice, nor the
entry known under that word only by it); each such name the registry writes
is offered last, « Aussi : … · piment de la Jamaïque (2) », with what it
finds alone. The search's own word groups (docs/VOCAB.md,
"Search words") stand for each other the same way: kin words (`tante` ⇄
`matante` ⇄ `ma tante` ⇄ `aunt`, `mononc'` ⇄ `oncle`, `mémère` ⇄
`grand-mère`, `pépère` ⇄ `grand-père`) as prefixes, so `tante` finds « Matante
Rollande »; dish words (`cake` ⇄ `gâteau`, `pie` ⇄ `tarte`, `squares` ⇄
`carrés`, `cookies` ⇄ `biscuits`…) as whole words with their plural, so `pie`
finds « Tarte » but not « Tartelettes ». The little words (`la`, `de`, `ma`,
`mon`, `des`, `aux`…) are dropped next to other words; alone, one matches only
itself, never as a prefix (`ma` is not `maigre`).
FTS proposes the candidates and each is checked word by word in JS. The results
whose title holds at least one word come first, the titles holding more ahead;
the rest follow under the field holding the most words, in this order: « Dans
les ingrédients de n recettes », then étiquettes, provenance, texte (the method,
and any text before the first `##` heading), notes (the other sections: Notes,
Variantes, Alternatives — a word only a note mentions, « se sert avec la
tourtière », comes last, under a quieter « Mentionnent aussi « tourtière » »,
so it never reads as more of what was searched).
Each card says where the words are; a word found under another name marks
that name (« Ingrédient piment vert »). Within a group, results are ranked by
bm25 with the title weighted highest.

**Each word alone.** When the words find nothing together (after the close
spelling below), each word — or run of words that names one thing — is
searched alone and the empty list says « Aucune recette avec tous les mots. »,
then « « carrot » seul : 27 recettes › » (a link to that search) and « « gizmo »
seul : aucune ». With filters on, the empty list offers to clear them instead.

**Spelling.** With fewer than three results, each word that finds nothing alone
is replaced by the closest word of the box. The box's words are taken from titles,
ingredient names and registry names, at most 1 edit for 4–6 letters and 2 from 7
letters, none under 4. Ties go to the more frequent word. If that finds more, a
« Vouliez-vous dire « … » ? » link is shown. When the typed words find nothing,
the close spelling's results are shown at once, said once over them:
« Résultats pour « tarte » (vous aviez tapé « tarre ») · Chercher exactement »,
the count line « n recettes pour « tarte » » (never « Aucune recette » over
rows). « Chercher exactement » adds `?exact=1`: the typed words are searched
as they are, the close spelling only offered (« Vouliez-vous dire »); typing
in the box drops it. The vocabulary is cached until the index changes.

**Facet counts** are taken within the current list. A facet's own values ignore
its own filter (one value of Saison replaces another), except tags, which add up.
The values are those of the search with no filter. A value that would leave
nothing shows greyed with 0, after the others, and is not a link. The page
keeps the order it showed after a tap on a value (until a navigation that is
not a filter's), so the value tapped does not move under the finger.

**Rows and idea rails.** Each row carries its course (the first course tag
it has, `COURSE_TAGS`) and its seasons, for its line « Dessert · Automne ».
The idea cards over the whole box add, beside the random card, the season's
and the last added, three rails drawn from the index, each its link's list
exactly: main dishes over 2 h (`?tag=plat-principal&temps=plus`), 7 servings
and up (`?portions=7+`), rated 4 or 5 (its link: the box sorted by note);
three at random each, shown from three recipes up. No rail claims when a
recipe was last cooked: nothing records it.

Measured on a generated vault of 5000 recipes (`scripts/gen-vault.ts --bench`):
full `sync --force` ~5 s, no-op sync ~1.3 s, FTS query ~1 ms, a browse page
with all facet counts ~10–13 ms. With ingredient resolution and a registry of
1000 entries (plan 03, Phase 2): `sync --force` ~6.5 s, no-op sync ~1.35 s,
browse with facets ~16–19 ms (the *non reliés* facet added), re-resolving all
~33 000 ingredient rows ~30 ms, one alias edit picked up by a full sync ~1.5 s
(the recipe-file walk dominates; a queue action reloads the registry only), fuzzy candidates for one name ~0.1 ms, the
resolve queue page (30 rows) ~9 ms, its nav count ~0.3 ms. With ~3000 price
rows and 10 % of recipes using an earlier one as a sub-recipe (plan 03, Phases
4–5): `sync --force` ~6.4 s, no-op sync ~1.3 s, the ingredient index page (999
rows) ~14 ms whatever the sort, the cost of one recipe ~0.4 ms (~1 ms with a
chain of 4 sub-recipes, 36 lines), appending one price and committing it
~200 ms (git dominates).

Final figures for P1.5 (plan 03, Phase 9; AMD Ryzen 5 5600X), on 5000
recipes (~33 000 ingredient rows, 15 % of them unresolved or ambiguous), a
registry of 1000 entries (the seed plus invented ones with staples, densities,
weights, substitutes and allergens, used by 30 % of the lines) and 3000 price
rows:

| Operation | Measured | Target |
|---|---|---|
| `sync --force`, with resolution | ~6.5 s (~5 s before P1.5) | < 30 s |
| no-op sync | ~1.4 s | < 3 s |
| re-resolve every row | ~60 ms | — |
| one alias edit: registry reload + re-resolve (queue action, watcher) | ~120 ms | < 1.5 s |
| one alias edit picked up by `vault sync` (every recipe file hashed) | ~1.4 s | — |
| a queue "Relier" click, commit included | ~290 ms | — |
| fuzzy candidates for one name | ~0.1 ms | < 5 ms |
| resolve queue page (30 rows) | ~10 ms | < 100 ms |
| ingredient index page (1000 rows, worst sort) | ~15 ms | < 50 ms |
| ingredient view (most used entry, 882 recipes) | ~14–19 ms | < 50 ms |
| cost of one recipe (3 nested sub-recipes / none) | ~0.8 ms / ~0.4 ms | < 5 ms |
| pantry search (3 picked / 8 picked + avoid + allergen) | ~4 ms / ~5 ms; ~50 ms for the first, which builds the model | < 10 ms |
| append one price and commit | ~170 ms | < 500 ms |

A queue action or an outside edit of one ingredient file reloads the registry
alone (the changed files, then the names tables) and re-resolves from stored
keys; only `vault sync` walks the recipe files.

Final figures for P2 (plan 04, Phase 9; same machine, under desktop load —
load average 7–9, which made a price append ~1.6× slower than the P1.5 figure
above), on the same 5000-recipe vault grown to ~20 000 commits, one recipe with
50 versions:

| Operation | Measured | Target |
|---|---|---|
| open the edit form (server load, 74-line recipe) | ~12 ms; ~46 ms the first time after a write (vault stats recomputed) | < 100 ms |
| suggestions for one keystroke: ingredient names + "relié" / authors / sub-recipes | ~3 ms / ~1.6 ms / ~0.4 ms (issue #11; ~16 ms before) | < 10 ms (names) |
| name-word hint for one field (browser code, timed in Node) | ~0.03 ms | < 5 ms |
| the form's debounced server check (whole form) | ~21 ms (issue #11; ~200 ms before); ~40 ms the first check after a write | — |
| form save: edit / new recipe (check, serialize, write, commit, index) | ~450 ms / ~490 ms | < 500 ms |
| unchanged form save | ~12 ms, no write, no commit | no commit |
| photo upload, 12 MP JPEG (7.5 MB): store + both copies + commit | ~0.8 s | < 2 s |
| derived copy on demand: thumbnail / display | ~70 ms / ~350 ms | < 1 s each |
| history page, 50 versions | ~260 ms with the commit index (issue #10; ~2.1 s before, `git log --follow` ~1.7 s) | < 300 ms |
| history page, an ordinary recipe (6–10 versions) | ~80–90 ms (~4–12 s before, depending on the file name) | < 300 ms |
| undo the last save | ~420 ms (~620 ms before) | < 500 ms |
| "Revenir à cette version" | ~410 ms (~2.8 s before: it read the whole history first) | < 500 ms |
| commit index: catch up one new commit / already at HEAD / read all ~20 000 commits | ~46 ms / ~0.1 ms / ~5 s (once, after `cache/` is deleted or an upgrade) | — |
| `/etiquettes` page (22 pending tags, two on ~800 recipes) | ~37 ms | — |
| accept a pending tag, commit included | ~3.8 s (the retag of every recipe); ~0.65 s since the retag runs in one transaction (`6e8ee04`, measured in plan 05's bench) | — |
| sign in (argon2id verify; unknown login the same) | ~160 ms | 100–500 ms |
| session lookup per request | ~0.05 ms | < 0.5 ms |

The history page first missed its target by an order of magnitude: `git log`
of one path walks all ~20 000 commits, each step costing more the later the
file name sorts in the flat `recipes/` directory, and `--follow` cannot use
git's changed-path Bloom filters. Issue #10 (option A) replaced that walk by the
commit index ("Commit index", above); the history figures, undo and restore
above are after it (re-measured 2026-09-28, load average ~4; the same run gave
form saves of ~380 / ~480 ms). What is left of a history page is one `git
cat-file --batch` for every version's text and parsing each version (~3 ms
each): a 50-version page is mostly parsing. Undo and restore are now a save
plus a couple of git reads; a git spawn from the server process costs tens of
ms, so HEAD is read from `.git` directly and a commit's changes come from the
index.

Final figures for P3 (plan 05, Phase 8; same machine, 2026-09-30, load average
~1.5–6, the parallel review's test runs beside it), on the 5000-recipe vault
grown to ~20 000 commits. The generator's ingredient mix changed in this plan
(lines drawn from 1200 invented dish archetypes built from the seed registry's
names, instead of ~30 common words), plus 60 planted duplicate copies and 20
families of three close variants: 5126 recipes, 9.5 % of the ~34 000 ingredient
rows unresolved or ambiguous (15 % before). Everything else the generator draws
is as before, and the P1.5 and P2 figures re-measured in the same run are within
their earlier ranges (form save ~340 ms, undo ~250 ms, the resolve queue page
~9 ms). Scaling is browser code, timed in Node (a tablet ~10× slower).

| Operation | Measured | Target |
|---|---|---|
| rescale and reformat every line of a 60-line recipe (rules parsed once, ~0.5 ms) | ~0.16 ms | < 1 ms |
| scan 30 steps for amounts (45 amounts: denser than any card) | ~0.96 ms; rendering the scaled method ~1.2 ms | < 1 ms |
| corpus sweep: 320 cards × 7 factors (lines and method) | ~0.4 s (the test file ~1.2 s in vitest) | < 2 s |
| recipe page / kitchen page server load | ~2.0–2.4 ms / ~0.15–0.2 ms, of which plan 05 adds ~0.02–0.1 ms (the rules, sub-recipe scaling) / ~0.03 ms; the layout's unit words ~0.03 ms per page | unchanged ± 2 ms |
| duplicate model build, all pairs above 0.65 | ~105 ms (3980 pairs); ~260 ms with the same-method signal (4124 pairs; ~420 ms the first build, issue #13) | < 1 s |
| `pairsFor` one recipe / W505's `closeRecipes` (with `distinct.yaml`) | ~0.11 ms / ~0.15 ms; ~0.3 ms with the method | < 10 ms |
| `/doublons` page, model built / not built | ~3 ms / ~110 ms (~120 ms the first read after a write) | < 50 ms |
| the nav's "Doublons (N)" (a Markdown account, every page) | ~0.55 ms | — |
| "Recettes différentes" (write + commit) / its "Annuler" | ~320 ms / ~190 ms | < 500 ms |
| "Deux versions" (both recipes, one commit) / "C'est la même recette" (trash) | ~370 ms / ~410 ms | < 500 ms |

A first read after any write to the index rebuilds the duplicate model (~0.1 s;
~0.26 s on the bench since the same-method signal, most of it the generator's
many recipes sharing one method text):
the pair list, W505's check and, for a Markdown account, the nav count of every
page — the first page after a save pays it once.

## vault sync

```
vault sync [--force]
```

Walk `recipes/*.md`. Hash each file, compare to the stored `file_hash`, skip if
unchanged unless `--force`. Reparse new and changed files. Drop index rows whose
file no longer exists. Report counts plus every file that failed to parse. A file
that fails keeps its last good rows, flagged with its codes; the recipe page shows
them in a banner. A file whose `slug` differs from its file name is not indexed
(the slug is the file name). When `vocab/tags.yaml` differs from the one the
index last used (its hash is kept in `meta`), every tag row is recomputed even
though no recipe file changed — a `git pull` of the vocabulary while the app was
down. The ingredient registry (`ingredients/*.md`) is loaded the same way, by
hash, before the recipes: skipped when `meta.registry_hash` matches, else the
changed files are re-read (all of them when the plural rules or the allergen
list changed), and the report lists the ingredient files with errors or
warnings. When the registry changed, every `ingredients` and `ingredient_or`
row is re-resolved from its stored `key` (set-based, no recipe file read), like
a retag. Rows whose key a disambiguation rule names (`INGREDIENTS.md`,
"Disambiguation rules") also need the line's unit, prep and note: they are
re-resolved one by one from the recipe's stored parse (`data_json`), still
without reading a recipe file. `prices.csv` is reloaded whole when it or the
config's `currency` changed (`meta.prices_hash`); lines that do not read are
listed. Last, the commit index reads the commits made since the last one it
read (all of them after a history rewrite; "Commit index"). `vault reindex`
deletes the index and rebuilds it, the commit index included.

With hashing, a no-op sync over 5000 files is a couple of seconds. Run it on app
startup so hand-edits in a text editor are always picked up.

## File watcher — edits from outside the app

The files are the truth, so they can be edited by anything: a text editor, Obsidian,
`git revert` in the vault. Same pattern as ChannelVault watching its download folder
in real time. While the app runs, it watches `recipes/`, `ingredients/`, `vocab/`,
and `prices.csv`:

- Debounce ~1 s after the last change — editors save in several writes.
- Re-parse and re-index only the changed file.
- If it parses: commit it to the vault repo as `edit (external): <title>`
  (`delete (external): <title>` when the file was removed). Files under
  `ingredients/`, `vocab/` and `prices.csv` are committed as
  `edit (external): <path>` when they still read: an ingredient file that
  passes its check (no `E8xx` error; one that fails keeps its last good rows,
  is flagged and is not committed, like a recipe), YAML, or text respectively.
  A vocabulary change re-derives the tag and family rows; an ingredient file,
  `vocab/normalize.yaml` or `vocab/allergens.yaml` change reloads the registry;
  a `prices.csv` change reloads the prices (a line that does not read is
  skipped and listed; the file is still committed).
- If it does not: keep the last good index rows, flag the recipe in the UI with the
  validation errors, and do not commit. A half-typed edit in Obsidian must never
  knock a recipe out of search.
- Ignore the app's own writes (it knows the hash it just wrote), or every save would
  echo back as an external edit.

`vault sync` on startup still covers edits made while the app was stopped, and
the app then commits every recipe file git shows as changed, new or deleted,
if it reads cleanly, as `edit (external): <title>` (several in one commit) —
the watcher only sees live events. A file that fails the checker stays
uncommitted and flagged, as it would live.

## Family diff table

For a given `family`, select every variant, then compute:
- ingredient `item` values unique to each variant — the actual differentiator
- items common to all variants, shown once and collapsed
- differing `total_s`, `servings`, `difficulty`, `rating`

That table is the "lasagna, all types" view. It answers *what is different*, not
just *what exists*.

A name not linked yet compares by the entry it most likely is (`familyDiff`'s
`guess`: the first shown candidate, docs/INGREDIENTS.md, "Resolution"), when
another variant has that entry linked: it sits on that entry's row, written as
the recipe writes it, with « même ingrédient ? » and, for the owner, « Relier »
(the queue's Relier, with « Annuler »). Such a row is never « Seulement ici »:
a misspelling is not a difference (usability round 3).

## Authentication

Two accounts minimum, since edits should be attributable in the git history and
deletes should not be anonymous.

The right model depended on a question since decided (below: LAN plus
Tailscale, plan 02; accounts, plan 04) — whether the app is reachable only on
the home network or from the open internet:

**LAN-only.** A single shared password over HTTP is defensible, with a name picker
so commits are attributed. Note honestly that this protects against nothing but
accidents; anyone on the network can read and write.

**Internet-reachable.** This needs real handling, because a public write endpoint
will be found by automated scanners within days:
- per-user accounts with passwords hashed using argon2id or bcrypt, never plain
  or fast hashes
- HTTPS only, via a reverse proxy with a real certificate — a login over plain
  HTTP exposes the password on every request
- rate limiting and lockout on the login endpoint
- session cookies marked `HttpOnly`, `Secure`, `SameSite=Lax`
- uploads restricted by type and size, stored outside the web root, served
  through the app rather than directly, and never executed
- the recipes directory and `.git` never served as static files

Simplest safe answer, and the recommendation: keep it LAN-only, and reach it from
outside over a WireGuard or Tailscale tunnel. That removes the public attack
surface entirely and makes the in-app auth a convenience rather than the only
thing standing between the vault and the internet.

**Decided (plan 02): LAN plus Tailscale, no login in P1** (accounts: plan 04, below). The app listens on the
home network; outside access and HTTPS come from `tailscale serve`
(`docs/DEPLOY.md`). Until accounts arrive in P2, every commit is attributed to
`git_author` from the config. What P1 still guarantees: the vault folder, `.git`
and `cache/` are never served (photos go through `/media/…`, images only), and a
writing request is refused unless its `Origin` names the host it was sent to
(CSRF), which works for both the LAN address and the Tailscale name.

Because the Origin check compares two headers a page controls, it does not stop
**DNS rebinding**: a page on `evil.example` whose name is re-pointed at the LAN
address becomes same-origin with the app. So every request, reads included, must
carry a `Host` the app is served on, else `421`: `localhost`, any IP literal
(v4 or v6 — rebinding needs a name), the machine's own name and `<name>.local`,
any `*.ts.net` name (Tailscale's DNS, not the attacker's), and the names listed
in the config's `hosts` (`DEPLOY.md`).

**Decided (plan 04, Q1 A, Q2 B): an account per person, reading open, every
write signed in.** Accounts are made by the owner (`vault user add`, stored in
`users.json` beside the config, `STORAGE.md` §Accounts); passwords are argon2id.
Each request, in this order (`src/hooks.server.ts`):

1. the host allowlist (`421`), then the Origin check on anything but
   GET/HEAD/OPTIONS (`403`) — both before the cookie is even read, so a
   cross-site POST carrying a valid session is still refused;
2. the session cookie → the signed-in person (`locals.user`), or nobody. A
   session whose account was removed, or whose password changed since sign-in,
   ends here;
3. the guard: GET/HEAD/OPTIONS pass (browse, recipe page, kitchen mode, pantry
   search, the family and ingredient pages, the trash list, a recipe's history,
   `/etiquettes`), except pages that exist only to write (`/ajouter`,
   `/nouvelle`, `/r/<slug>/modifier`), which send to `/connexion`. Every other
   method needs a session, with no list of write routes to keep in sync: an API
   call answers `401`; a form action goes to `/connexion?suite=<page>` (a 303,
   or SvelteKit's JSON redirect for an enhanced form). The sign-in page's own
   actions are the only exception.

Every write then commits as the signed-in person (`withAuthor(ctx, user)`,
author and committer both); the CLI and the watcher's `edit (external)`
commits keep `git_author`. Rights are the same for every account (Q2 B); the
per-account `markdown` preference only shows or hides the Markdown tools, and
with them the archive's upkeep on the recipe page: one quiet line under the
red rule with the review state (« Brouillon · pas encore relue contre la fiche ·
Marquer vérifiée » — the button's words never repeated in the sentence —, « Saisie
sans fiche d’origine · pas encore relue » for a draft with no source or photo to
read it against, « À relire · lectures incertaines à vérifier sur l’original »;
usability round 6) and « N ingrédients à relier », which opens
the list of unlinked ingredients at the page's foot, each with « Relier › » to
its queue row (usability round 3; there is no longer a word after each
unlinked line), and the vocabulary notes: one line per `W501` / `W502` at the
foot, its decision a link away (« Étiquette nouvelle : érable — Décider dans
Étiquettes › » to `/etiquettes`; « Nom de plat proche d’un autre : … — Décider
dans Variantes › » to `/familles?grouper=<slug>`), the explanation, file names
and codes only behind « Détails » (usability round 6). A family account reads the recipe
without them: no badge, no explanation (the state says how far the keeper's
work went, not whether the recipe can be cooked).

### Account preferences

**Decided (2026-10-11).** Each account chooses three things for itself on
`/compte` (the name in the header links there), stored under `prefs` in its
`users.json` entry (`STORAGE.md` §Accounts) and nowhere in the vault. They
change what that person is shown, never a file:

- **Language** (`lang`: `fr`, `en`; default `fr`): every menu, button, message
  and checker explanation (`src/lib/i18n/fr.ts`, `en.ts`, `diagnostics.ts`).
  A recipe's own text — title, ingredient names, steps, « au goût » — stays in
  the language it was written in. Addresses stay French (`/ajouter`).
- **Measures** (`system`: `written`, `metric`, `imperial`; default `written`):
  the measuring system amounts are shown in (`VOCAB.md`, "Measuring systems").
- **Unit words** (`words`: per canonical unit, `[singular, plural]`): the
  account's own word for a unit, shown instead of the vault's
  (`vocab/unit-labels.yaml`): *c. à soupe* for `tbsp`, *tige* for `stalk`. At
  most 30 characters; an empty box keeps the usual word.

Once an account has saved `/compte`, its language is a choice made (stored
even when French), and a unit shows its word in that language whatever the
recipe's: an English reader sees `2 cups farine` on a French card, and the
French `de` joins the name only when the unit word is French too. Signed out,
or before any choice: French, amounts as written, each recipe's units in its
own language, as before — nothing changes for an account that chose nothing.

The strings and the amounts read the preferences from one place
(`src/lib/prefs.ts`). The server serves several accounts at once, so the hook
runs each request inside its account's preferences (`AsyncLocalStorage`); the
browser installs them once, from the root layout's data, before anything
renders, and loads the page again when they change (sign-in, saving `/compte`)
rather than re-rendering half of it. `/compte` posts a plain form for the same
reason. Signed out, `/compte` sends to `/connexion`. Anything unknown in
`prefs` (a hand edit, an older version) reads as the default, never as an
error: preferences cannot keep anyone from signing in.

The form (`/nouvelle`, `/r/<slug>/modifier`) always shows amounts as written:
what it saves is the card. The amount a tap scales against (plan 05, Q8 B) is
the written one too.

Sign-in (`/connexion`): login and password; "Garder la session ouverte sur cet appareil",
checked by default, gives a cookie of one year renewed on use (at most once a
day), unchecked a browser-session cookie (a day on the server, renewed on use).
The same answer, after the same argon2id work, for an unknown login and a wrong
password. After 5 failures for a login, or from an address, one try per 30 s per
key, said in words; a failure is counted before the password check so parallel
tries cannot slip through, a success clears the count, an hour of quiet forgets
it. Behind `tailscale serve` every request comes from loopback, so the address
is the proxy's `X-Forwarded-For` — believed only from loopback. The session
token is 32 random bytes, stored as its sha256 (`cache/sessions.db`). The cookie
is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when the request came over
HTTPS (`DEPLOY.md` §4: `X-Forwarded-Proto` from `tailscale serve`). "Se
déconnecter" ends the device's session; `vault user passwd` and `vault user
remove` end all of the account's.
