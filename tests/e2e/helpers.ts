import type { Page } from '@playwright/test';

/** A minimal recipe file, fenced as an AI would return it. */
export function fenced(title: string, extra = '', ing = '      - { qty: 1, unit: cup, name: farine }'): string {
	return '```markdown\n' + file(title, extra, ing) + '```\n';
}

export function file(title: string, extra = '', ing = '      - { qty: 1, unit: cup, name: farine }'): string {
	return `---\nschema: 3\ntitle: ${title}\n${extra}source: { type: invented }\nservings: 4\ningredients:\n  - items:\n${ing}\nextracted_by: ai\n---\n\n## Préparation\n\n1. Mélanger.\n2. Cuire 20 min.\n`;
}

/** Paste into the box the way a person does (one input event). */
export async function paste(page: Page, text: string) {
	const box = page.getByLabel('Réponse de l’IA');
	await box.fill(text);
}
