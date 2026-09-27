// Body rules: E301, W401, W402, W609.

import { isBlank, type RuleContext } from './context';

const LONG_STEP = 400;
// A 3-digit temperature: '350 °F', '180°C', '350F', '375°', '350º', '350 degrés',
// '350 degrees'; or one right after the oven: 'four à 350', 'Four 350', 'oven to 350'.
const TEMP_RE = /(?<!\d)(\d{3})\s*(?:[°º]\s*([FC])?|(?:degr[ée]s?|degrees?)\s*([FC])?|([FC]))(?!\p{L})/iu;
const OVEN_TEMP_RE = /(?<!\p{L})(?:four|oven)\s+(?:(?:à|a|to|at)\s+)?(\d{3})(?!\d)/iu;

export function checkBody(ctx: RuleContext): void {
	const { body } = ctx;
	const hasMethod = body.sections.some((s) => s.kind === 'method');
	const unknown = body.sections
		.map((s, i) => ({ s, i }))
		.filter(({ s }) => s.kind === 'other');

	if (!hasMethod && unknown.length) {
		ctx.report(
			'E301',
			`body.sections[${unknown[0].i}]`,
			`no recognized method heading, and unrecognized heading${unknown.length > 1 ? 's' : ''} ${unknown.map(({ s }) => `\`${'#'.repeat(s.level)} ${s.heading}\``).join(', ')}.`,
			'Put the numbered steps under `## Préparation` (French) or `## Instructions` (English). Other accepted headings: `## Notes`, `## Variantes`, `## Alternatives`.'
		);
	} else if (!hasMethod) {
		ctx.report('W401', null, 'no `## Préparation` section found.', 'Add `## Préparation` (or `## Instructions` in English) with the numbered steps.');
	}

	body.steps.forEach((step, i) => {
		if (step.text.length > LONG_STEP) {
			ctx.report('W402', `body.steps[${i}]`, `step is ${step.text.length} characters — probably several steps merged.`, 'Split it into one numbered step per action.');
		}
	});

	if (isBlank(ctx.fm.oven)) {
		for (let i = 0; i < body.steps.length; i++) {
			const text = body.steps[i].text;
			const m = text.match(TEMP_RE) ?? text.match(OVEN_TEMP_RE);
			if (!m) continue;
			const unit = (m[2] ?? m[3] ?? m[4] ?? 'F').toUpperCase();
			ctx.report(
				'W609',
				`body.steps[${i}]`,
				`the step mentions an oven temperature (\`${m[0].trim()}\`) but \`oven\` is absent.`,
				`Add \`oven: { temp: ${m[1]}, unit: ${unit} }\`.`
			);
			break;
		}
	}
}
