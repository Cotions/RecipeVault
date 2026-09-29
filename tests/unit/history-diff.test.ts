// Plan 04, Phase 7: the history's plain-French summary of what changed
// between two versions, computed on what she sees (the form model).

import { describe, expect, it } from 'vitest';
import { describeChanges, diffVersions, parseVersion } from '../../src/lib/server/history-diff';

const base = (fm = '', ingredients = '      - { qty: 1, unit: cup, name: farine }\n      - { qty: 2, unit: piece, name: œufs }', steps = '1. Mélanger.\n2. Cuire.\n3. Servir.') =>
	`---\nschema: 3\ntitle: Galettes inventées\nslug: galettes-inventees\nlang: fr\n${fm}ingredients:\n  - items:\n${ingredients}\nstatus: draft\nextracted_by: hand\n---\n\n## Préparation\n\n${steps}\n`;

const diff = (a: string, b: string) => describeChanges(diffVersions(parseVersion(a), parseVersion(b), a !== b));

describe('diffVersions', () => {
	it('names the fields that changed, never the Markdown', () => {
		expect(diff(base(), base('servings: 4\noven: { temp: 350, unit: F }\n'))).toEqual(['Modifié : four, portions']);
		expect(diff(base(), base('family: galettes\nvariant: fines\n'))).toEqual(['Modifié : famille, variante']);
	});

	it('ingredients added, removed and changed, by name', () => {
		const after = base('', '      - { qty: 2, unit: cup, name: farine }\n      - { qty: 1, unit: tsp, name: sel }');
		expect(diff(base(), after)).toEqual(['Ingrédient ajouté : « sel » ; Ingrédient retiré : « œufs » ; Ingrédient modifié : « farine »']);
	});

	it('steps changed, added, reordered', () => {
		expect(diff(base(), base('', undefined, '1. Mélanger.\n2. Cuire doucement.\n3. Servir.'))).toEqual(['Une étape modifiée']);
		expect(diff(base(), base('', undefined, '1. Mélanger.\n2. Cuire.\n3. Servir.\n4. Ranger.\n5. Laver.'))).toEqual(['2 étapes ajoutées']);
		expect(diff(base(), base('', undefined, '1. Cuire.\n2. Mélanger.\n3. Servir.'))).toEqual(['Étapes remises dans un autre ordre']);
	});

	it('photo, verified, tags, markers, title', () => {
		expect(diff(base(), base('media: { final: final-2026-09-28-1.jpg }\n'))).toEqual(['Photo ajoutée']);
		expect(diff(base(), base().replace('status: draft', 'status: verified'))).toEqual(['Marquée vérifiée']);
		expect(diff(base(), base('tags: [dessert]\n'))).toEqual(['Étiquettes ajoutées : Dessert']);
		expect(diff(base('', '      - { qty: "1 [?]", unit: cup, name: farine }\n      - { qty: 2, unit: piece, name: œufs }'), base())).toContain('Une lecture incertaine réglée');
		expect(diff(base(), base().replace('title: Galettes inventées', 'title: Galettes fines'))).toEqual(['Titre : « Galettes inventées » devient « Galettes fines »']);
	});

	it('a change she cannot see reads as formatting; an unreadable version says so', () => {
		expect(diff(base(), base().replace('extracted_by: hand', 'extracted_by: hand\nupdated: 2026-09-28'))).toEqual(['Mise en forme du fichier seulement, rien de visible']);
		expect(diff(base(), '---\ntitle: [\n---\n')).toEqual(['Version que l’application ne sait plus lire']);
	});
});
