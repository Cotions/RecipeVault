// Which ingredients a step uses, for kitchen mode (PLANNING.md, "Kitchen mode").
// Names are matched in the step text, accent- and case-insensitive, singular or
// plural. The plural endings are the vault's (vocab/normalize.yaml, docs/VOCAB.md
// "Plurals"), the same rule the ingredient resolver uses; without one, names
// match only as written.
//
// A partial list is worse than none — the cook trusts it — so beyond the names:
// - a group's name (« la garniture », « la béchamel ») stands for the group;
// - a generic word (« la viande », « les épices », « une abaisse », « saler »)
//   stands for the recipe's lines of that kind (porc, bœuf…; cannelle, girofle…);
// - a generic word with no line of its kind, or « le reste », « les
//   ingrédients », makes the match unsure: kitchen mode then says « Mentionnés »
//   instead of « Pour cette étape », and offers the whole list.
// - a line's other names (its registry entry's aliases) count as its name;
// - a line not linked to the registry (often a typo: « oigon ») is found by a
//   step word one letter off (« l'oignon »);
// - a food word left over (« l'oignon » with no line for it) makes the match
//   unsure too, so a missing line is never silently dropped;
// - a doneness check (« jusqu'à ce que la pâte soit dorée », « until golden »)
//   names what is already in the pan, not something to add: not read;
// - across a recipe's steps (`matchSteps`), a generic word for lines an earlier
//   step already used (« remplir de viande » after « cuire la viande ») is the
//   product of that step, so its group's chip (« Garniture (tout) »), and so is
//   « le mélange », « la préparation » (the group the step before worked in).

import { fold } from '../vault/normalize';
import { stripMarkers } from '../vault/markers';
import { singularKey, type PluralRule } from '../ingredients/normalize';
import type { Ingredient, IngredientGroup } from '../vault/types';

const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'a', 'au', 'aux', 'en', 'et', 'd', 'l', 'un', 'une', 'of', 'the', 'and', 'an']);

/**
 * A doneness check, to the end of its sentence: « jusqu'à ce que la pâte soit
 * dorée », « jusqu'à ce qu'il soit tendre », « until the crust is golden ».
 */
const DONENESS = /\bjusqu['’]?\s*(?:à|a)\s+ce\s+qu(?:e\b|['’])[^.;!?\n]*|\buntil\b[^.;!?\n]*/giu;

/**
 * A word ending in « -é » (« beurré », « sucrée », « hachés », « pâté »): a
 * participle or a word of its own, never the noun it looks like once the
 * accents are gone (« un plat beurré » uses no « beurre », « pâte sucrée » no
 * « sucre »). Its four forms read as one word, kept apart by the « é ».
 */
const PARTICIPLE = /é(?:e|s|es)?$/u;

/** A text's words, folded (accents, case), the participles in « -é » kept apart; the articles left out. */
function words(s: string): string[] {
	return stripMarkers(s)
		.normalize('NFC')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.flatMap((w) => {
			const parts = fold(w).split(/[^a-z0-9]+/);
			if (PARTICIPLE.test(w) && parts.length) parts[parts.length - 1] = parts[parts.length - 1].replace(/e(?:e|s|es)?$/, 'é');
			return parts;
		})
		.filter((w) => w && !STOP.has(w));
}

const set = (s: string) => new Set(s.split(' '));

// Kinds of ingredient a step names by a generic word. Folded, no accents,
// singular and plural written out (they must work without the vault's rule).
// « piment » is a bell pepper in Québec: a vegetable, not a spice.
const MEAT = set(
	'porc boeuf veau poulet poulets dinde agneau jambon bacon lard saucisse saucisses saucisson chevreuil orignal lapin canard cuisse cuisses poitrine poitrines cotelette cotelettes steak bifteck rosbif pork beef veal chicken turkey lamb ham sausage sausages venison'
);
const SPICE = set(
	'cannelle girofle muscade gingembre jamaique epice epices sarriette thym laurier cumin paprika cari curry chili origan basilic romarin sauge cardamome anis curcuma cayenne cinnamon cloves nutmeg ginger allspice oregano thyme basil sage rosemary cardamom turmeric'
);
const SALT = set('sel salt');
const PEPPER = set('poivre');
const VEG = set(
	'carotte carottes celeri oignon oignons patate patates terre navet navets chou choux poireau poireaux poivron poivrons piment piments courgette courgettes tomate tomates haricot haricots pois mais champignon champignons brocoli panais betterave betteraves epinard epinards carrot carrots celery onion onions potato potatoes turnip cabbage leek leeks zucchini tomato tomatoes bean beans peas corn mushroom mushrooms broccoli parsnip beet beets spinach'
);
const HERB = set('persil ciboulette aneth thym basilic origan romarin sauge estragon coriandre sarriette laurier menthe herbe herbes parsley chives dill thyme basil oregano rosemary sage tarragon cilantro mint herb herbs');
const CHEESE = set('fromage fromages parmesan cheddar mozzarella gruyere emmental feta ricotta oka brie romano cheese cheeses');
const PASTA = set(
	'lasagne lasagnes spaghetti spaghettis macaroni macaronis nouille nouilles coquille coquilles penne fusilli rotini linguine fettuccine vermicelle vermicelles alimentaire alimentaires noodle noodles pasta'
);
const FRUIT = set(
	'pomme pommes poire poires peche peches fraise fraises framboise framboises bleuet bleuets banane bananes raisin raisins datte dattes cerise cerises ananas rhubarbe canneberge canneberges apple apples pear pears peach peaches strawberries raspberries blueberries banana bananas raisins dates cherries pineapple rhubarb cranberries'
);
/** Words for pastry: a group so named, or lines whose name starts (or, in English, ends) with one. */
const PASTRY = set('pate abaisse abaisses croute croutes pastry dough crust');

/**
 * Words that name a food: one left unmatched means the list may be partial.
 * Not « mais » (« but »), « terre », « cuisse », « poitrine »: too often something else.
 */
const FOOD = new Set([...MEAT, ...SPICE, ...VEG, ...HERB, ...CHEESE, ...FRUIT].filter((w) => !['mais', 'terre', 'cuisse', 'cuisses', 'poitrine', 'poitrines', 'jamaique', 'dates', 'sage'].includes(w)));

/** The words that stand for a kind, and what they stand for. `null`: never resolved, always unsure. */
const GENERIC: Record<string, Set<string> | 'pastry' | null> = {};
const kind = (ws: string, k: Set<string> | 'pastry' | null) => ws.split(' ').forEach((w) => (GENERIC[w] = k));
kind('viande viandes meat meats', MEAT);
kind('epice epices spice spices aromate aromates', SPICE);
kind('assaisonnement assaisonnements assaisonner assaisonnez seasoning seasonings season', new Set([...SPICE, ...SALT, ...PEPPER]));
kind('saler salez', SALT);
kind('poivrer poivrez', PEPPER);
kind('legume legumes vegetable vegetables', VEG);
kind('herbe herbes herbs', HERB);
kind('fromage fromages cheese', CHEESE);
kind('pates pasta', PASTA);
kind('fruit fruits', FRUIT);
kind('abaisse abaisses croute croutes pastry dough crust', 'pastry');
kind('ingredient ingredients reste restants restantes remaining', null);

export interface StepIngredient {
	group: number;
	item: number;
	ingredient: Ingredient;
}

export interface StepMatch {
	/** Every line the step uses, in recipe order, a whole group's included. */
	lines: StepIngredient[];
	/** Groups the step names as a whole and too long to list (more than {@link GROUP_LIST} lines), or the product of an earlier step: one chip each. */
	groups: number[];
	/** False when the step names something the lines could not account for: the list may be partial. */
	sure: boolean;
	/** Lines found only through a generic word (« la viande »), as `group:item` keys: `matchSteps` reads them. */
	byKind?: string[];
	/** The step names « le mélange », « la préparation »: what an earlier step made. */
	product?: boolean;
}

/** Words for what an earlier step made. Folded, singular and plural. */
const PRODUCT = set('melange melanges preparation preparations appareil mixture batter');

/** A group named in a step is listed line by line up to this many lines; longer, it is one chip. */
export const GROUP_LIST = 3;

/** What the index knows of the lines, by position across groups (as the recipe page's links). */
export interface LineNames {
	/** The other names of each line's registry entry, in the recipe's language. */
	aliases?: Record<number, string[]>;
	/** The lines not linked to the registry: a step word one letter off still finds them. */
	unlinked?: number[];
}

/** Optimal string alignment distance, capped: 2 means « 2 or more ». */
function near(a: string, b: string): number {
	if (Math.abs(a.length - b.length) > 1) return 2;
	const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) d[0][j] = j;
	for (let i = 1; i <= a.length; i++)
		for (let j = 1; j <= b.length; j++) {
			const c = a[i - 1] === b[j - 1] ? 0 : 1;
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
		}
	return Math.min(2, d[a.length][b.length]);
}

export function matchStep(step: string, groups: IngredientGroup[], plural?: PluralRule | null, lang: string = 'fr', known: LineNames = {}): StepMatch {
	// Singular form per the vault's rule (oignons → oignon, choux → chou).
	const stem = (w: string) => (plural ? singularKey(w, plural) : w);
	const raw = words(step.replace(DONENESS, ' '));
	const text = raw.map(stem);
	const used = text.map(() => false);
	/** French names lead with their noun (« bœuf haché »), English ones end with it (« ground beef »). */
	const head = (ws: string[]) => (lang === 'en' ? ws[ws.length - 1] : ws[0]);

	/** Where `seq` stands in the step on words not yet accounted for. */
	function find(seq: string[], plurals = false): number[] {
		const at: number[] = [];
		for (let i = 0; i + seq.length <= text.length; i++) {
			if (seq.every((w, j) => text[i + j] === w && (!used[i + j] || (plurals && raw[i + j] !== w)))) at.push(i);
		}
		return at;
	}
	const take = (at: number[], n: number) => at.forEach((i) => used.fill(true, i, i + n));

	const found = new Map<string, StepIngredient>();
	const add = (gi: number, ii: number) => found.set(`${gi}:${ii}`, { group: gi, item: ii, ingredient: groups[gi].items[ii] });

	// Lines by name: the same name in two groups (beurre in the syrup and the batter) is one key.
	const byName = new Map<string, { gi: number; ii: number; name: string[] }[]>();
	groups.forEach((g, gi) =>
		g.items.forEach((it, ii) => {
			const name = words(it.name).map(stem);
			if (!name.length) return;
			const k = name.join(' ');
			byName.set(k, [...(byName.get(k) ?? []), { gi, ii, name }]);
		})
	);
	// Longest names first, so « beurre d'arachides » is not read as « beurre ».
	const names = [...byName.entries()].sort((a, b) => b[1][0].name.length - a[1][0].name.length);

	/** Position across groups: how the index numbers the lines. */
	const byPos: [number, number][] = groups.flatMap((g, gi) => g.items.map((_, ii): [number, number] => [gi, ii]));
	const at = (pos: number): [number, number] | undefined => byPos[pos];

	// The entry's other names count as the line's (« sucre brun » for a « cassonade » line),
	// unless another line has that name as its own (« beurre » for « beurre salé » beside a « beurre » line).
	const withAliases = new Map([...byName.entries()].map(([k, v]) => [k, [...v]]));
	for (const [pos, aliases] of Object.entries(known.aliases ?? {})) {
		const line = at(Number(pos));
		if (!line) continue;
		const [gi, ii] = line;
		for (const alias of aliases) {
			const name = words(alias).map(stem);
			const k = name.join(' ');
			if (!name.length || byName.has(k) || withAliases.get(k)?.some((l) => l.gi === gi && l.ii === ii)) continue;
			withAliases.set(k, [...(withAliases.get(k) ?? []), { gi, ii, name }]);
		}
	}
	const allNames = [...withAliases.entries()].sort((a, b) => b[1][0].name.length - a[1][0].name.length);

	// 1. Whole names.
	for (const [, lines] of allNames) {
		const at = find(lines[0].name);
		if (!at.length) continue;
		lines.forEach((l) => add(l.gi, l.ii));
		take(at, lines[0].name.length);
	}

	// 2. A group's name, or its head noun: « la béchamel », « la sauce » for « Sauce bolognaise ».
	const wholeGroups = new Set<number>();
	groups.forEach((g, gi) => {
		if (!g.group || !g.items.length) return;
		const name = words(g.group).map(stem);
		if (!name.length) return;
		let at = find(name);
		let n = name.length;
		if (!at.length && name.length > 1 && head(name).length > 3) {
			at = find([head(name)]);
			n = 1;
		}
		if (!at.length) return;
		wholeGroups.add(gi);
		take(at, n);
	});

	// 3. A long name by its head noun: « le bœuf » for « bœuf haché maigre », « l'eau » for « eau bouillante ».
	const heads: { at: number[]; lines: { gi: number; ii: number }[] }[] = [];
	for (const [, lines] of names) {
		const name = lines[0].name;
		if (name.length < 2 || head(name).length < 3 || found.has(`${lines[0].gi}:${lines[0].ii}`)) continue;
		// A plural in the step (« les sucres ») is every line of that noun: « sucre » and « sucre brun ».
		const at = find([head(name)], true);
		if (at.length) heads.push({ at, lines });
	}
	// Then by an other name's head (« le bœuf » for a « steak haché » line whose entry says
	// « bœuf haché », « le piment » for « poivron vert »): on words no line's own name took,
	// never a generic word (« viande à hamburger » must not make « la viande » one line).
	const ownHeads = new Set(heads.flatMap((h) => h.at));
	for (const [k, lines] of allNames) {
		if (byName.has(k)) continue;
		const name = lines[0].name;
		const h = head(name);
		if (name.length < 2 || h.length < 3 || h in GENERIC || found.has(`${lines[0].gi}:${lines[0].ii}`)) continue;
		const at = find([h], true).filter((i) => !ownHeads.has(i));
		if (at.length) heads.push({ at, lines });
	}
	// Taken after all are looked up: two names with the same head (« porc haché », « porc salé ») both match.
	for (const h of heads) {
		h.lines.forEach((l) => add(l.gi, l.ii));
		take(h.at, 1);
	}

	// 3b. A line the registry does not know, by a step word one letter off its
	// head noun (« l'oignon » for a line written « oigon »). Five letters at
	// least, the same first letter: short words are too near each other.
	for (const pos of known.unlinked ?? []) {
		const line = at(pos);
		if (!line || found.has(`${line[0]}:${line[1]}`)) continue;
		const ws = words(groups[line[0]].items[line[1]].name).map(stem);
		if (!ws.length) continue;
		const h = head(ws);
		if (h.length < 5) continue;
		// Not a participle for its noun (« beurré » is one letter off « beurre »).
		const i = text.findIndex((w, j) => !used[j] && !(raw[j] in GENERIC) && w.length >= 5 && w[0] === h[0] && w.endsWith('é') === h.endsWith('é') && near(w, h) <= 1);
		if (i < 0) continue;
		add(line[0], line[1]);
		used[i] = true;
	}

	// 4. Generic words: the lines of their kind, or, with none, an honest « maybe more ».
	let sure = true;
	const named = new Set(found.keys());
	const product = raw.some((w, i) => !used[i] && PRODUCT.has(w));
	const tokens = (it: Ingredient) => {
		const ws = words(it.name);
		return [...ws, ...ws.map(stem)];
	};
	raw.forEach((w, i) => {
		if (used[i]) return;
		const k = w in GENERIC ? GENERIC[w] : stem(w) in GENERIC ? GENERIC[stem(w)] : undefined;
		if (k === undefined) return;
		used[i] = true;
		if (k === null) {
			sure = false;
			return;
		}
		let hit = false;
		if (k === 'pastry') {
			groups.forEach((g, gi) => {
				if (g.group && g.items.length && words(g.group).some((x) => PASTRY.has(stem(x)) || PASTRY.has(x))) {
					wholeGroups.add(gi);
					hit = true;
				}
			});
			if (!hit)
				groups.forEach((g, gi) =>
					g.items.forEach((it, ii) => {
						const ws = words(it.name);
						if (ws.length && (PASTRY.has(head(ws)) || PASTRY.has(stem(head(ws))))) {
							add(gi, ii);
							hit = true;
						}
					})
				);
		} else {
			groups.forEach((g, gi) =>
				g.items.forEach((it, ii) => {
					if (tokens(it).some((x) => k.has(x))) {
						add(gi, ii);
						hit = true;
					}
				})
			);
		}
		if (!hit) sure = false;
	});

	// 5. A food the step names and no line accounts for: the list may be partial.
	raw.forEach((w, i) => {
		if (!used[i] && (FOOD.has(w) || FOOD.has(text[i]))) sure = false;
	});

	// The same name in two groups: keep the group the step is otherwise working in.
	for (const [, lines] of byName) {
		if (lines.length < 2) continue;
		const hits = lines.filter((l) => found.has(`${l.gi}:${l.ii}`));
		if (hits.length < 2) continue;
		const weight = (gi: number) =>
			[...found.values()].filter((f) => f.group === gi && (byName.get(words(f.ingredient.name).map(stem).join(' '))?.length ?? 1) === 1).length + (wholeGroups.has(gi) ? 1 : 0);
		const best = Math.max(...hits.map((l) => weight(l.gi)));
		const winners = hits.filter((l) => weight(l.gi) === best);
		if (best > 0 && winners.length === 1) hits.filter((l) => l !== winners[0]).forEach((l) => found.delete(`${l.gi}:${l.ii}`));
	}

	// A group named as a whole: all its lines; listed one by one when it is short.
	const chips: number[] = [];
	for (const gi of [...wholeGroups].sort((a, b) => a - b)) {
		groups[gi].items.forEach((_, ii) => add(gi, ii));
		if (groups[gi].items.length > GROUP_LIST) chips.push(gi);
	}

	const lines = [...found.values()].sort((a, b) => a.group - b.group || a.item - b.item);
	const byKind = lines.map((l) => `${l.group}:${l.item}`).filter((k) => !named.has(k) && !wholeGroups.has(Number(k.split(':')[0])));
	return { lines, groups: chips, sure, ...(byKind.length ? { byKind } : {}), ...(product ? { product } : {}) };
}

/**
 * Every step of a recipe (see {@link matchStep}), each read knowing the ones
 * before it: a generic word for lines an earlier step used, or « le mélange »,
 * is what that step made. With the recipe in named groups (its components),
 * the step then gets that group's chip (« Garniture (tout) »), not raw lines.
 */
export function matchSteps(steps: readonly string[], groups: IngredientGroup[], plural?: PluralRule | null, lang: string = 'fr', known: LineNames = {}): StepMatch[] {
	const seen = new Set<string>();
	/** The named group the latest step with lines worked in most. */
	let lastGroup: number | undefined;
	const component = (gi: number) => !!groups[gi]?.group && groups[gi].items.length > 1;
	return steps.map((text) => {
		const m = matchStep(text, groups, plural, lang, known);
		const made = new Set<number>();
		for (const k of m.byKind ?? []) {
			const gi = Number(k.split(':')[0]);
			if (seen.has(k) && component(gi)) made.add(gi);
		}
		if (m.product && lastGroup !== undefined) made.add(lastGroup);
		let out = m;
		if (made.size) {
			const all = new Map(m.lines.map((l) => [`${l.group}:${l.item}`, l]));
			for (const gi of made) groups[gi].items.forEach((ingredient, item) => all.set(`${gi}:${item}`, { group: gi, item, ingredient }));
			const lines = [...all.values()].sort((a, b) => a.group - b.group || a.item - b.item);
			out = { ...m, lines, groups: [...new Set([...m.groups, ...made])].sort((a, b) => a - b) };
		}
		for (const l of out.lines) seen.add(`${l.group}:${l.item}`);
		const counts = new Map<number, number>();
		for (const l of out.lines) if (component(l.group)) counts.set(l.group, (counts.get(l.group) ?? 0) + 1);
		if (counts.size) lastGroup = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
		return out;
	});
}

/** The lines a step uses (see {@link matchStep}). */
export function stepIngredients(step: string, groups: IngredientGroup[], plural?: PluralRule | null, lang?: string, known?: LineNames): StepIngredient[] {
	return matchStep(step, groups, plural, lang, known).lines;
}
