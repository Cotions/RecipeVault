// Body rules: E003, E301, W401, W402, W403, W609.

import { isBlank, type RuleContext } from './context';

const LONG_STEP = 400;
// A 3-digit temperature: '350 °F', '180°C', '350F', '375°', '350º', '350 degrés',
// '350 degrees'; or one right after the oven: 'four à 350', 'Four 350', 'oven to 350'.
const TEMP_RE = /(?<!\d)(\d{3})\s*(?:[°º]\s*([FC])?|(?:degr[ée]s?|degrees?)\s*([FC])?|([FC]))(?!\p{L})/iu;
const OVEN_TEMP_RE = /(?<!\p{L})(?:four|oven)\s+(?:(?:à|a|to|at)\s+)?(\d{3})(?!\d)/iu;

// A `---` line with `schema:` as the next non-blank line: a second file's frontmatter.
const MERGED_RE = /^---[ \t]*\n(?:[ \t]*\n)*[ \t]*schema[ \t]*:/m;

export function checkBody(ctx: RuleContext): void {
	const { body } = ctx;

	// E003: several files pasted as one (bare `---` files, or a fence left open).
	const parts = [{ path: 'body.preamble', text: body.preamble }, ...body.sections.map((s, i) => ({ path: `body.sections[${i}]`, text: s.text }))];
	const merged = parts.find((p) => MERGED_RE.test(p.text));
	if (merged) {
		ctx.report(
			'E003',
			merged.path,
			'the body holds the start of another recipe file (a `---` line followed by `schema:`) — two files were merged into one.',
			'Return each file in its own ```markdown fence, closed with ``` before the next one opens.'
		);
	}
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

	// W403: a method section with text but no step line — its text would be
	// neither shown one step at a time nor checked as steps.
	body.sections.forEach((s, i) => {
		if (s.kind !== 'method' || !s.text || body.steps.some((step) => step.section === i)) return;
		ctx.report(
			'W403',
			`body.sections[${i}]`,
			`the \`${'#'.repeat(s.level)} ${s.heading}\` section has text but no steps.`,
			'Write each step as a numbered (`1.`) or `-` line.'
		);
	});

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
