import type { Page } from '@playwright/test';

/** A minimal recipe file, fenced as an AI would return it. */
export function fenced(title: string, extra = '', ing = '      - { qty: 1, unit: cup, name: farine }'): string {
	return '```markdown\n' + file(title, extra, ing) + '```\n';
}

export function file(title: string, extra = '', ing = '      - { qty: 1, unit: cup, name: farine }'): string {
	return `---\nschema: 3\ntitle: ${title}\n${extra}source: { type: invented }\nservings: 4\ningredients:\n  - items:\n${ing}\nextracted_by: ai\n---\n\n## Préparation\n\n1. Mélanger.\n2. Cuire 20 min.\n`;
}

/**
 * Put a text in the box, replacing what is there (not typed: the box stays
 * free to fold, as after a paste). A box folded to its summary is opened
 * first, as a person would ("Modifier le texte").
 */
export async function paste(page: Page, text: string) {
	const box = page.getByLabel('Réponse de l’IA');
	if (!(await box.isVisible())) await page.getByRole('button', { name: 'Modifier le texte' }).click();
	await box.fill(text);
}

/** After `goto`: the page has hydrated, so a first tap or file input reaches its handler. */
export async function ready(page: Page) {
	await page.locator('html[data-ready]').waitFor({ state: 'attached' });
}
