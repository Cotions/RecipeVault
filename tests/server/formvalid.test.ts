import { describe, expect, it } from 'vitest';
import { validForm } from '../../src/routes/api/form/valid';
import { emptyForm } from '../../src/lib/form/model';

describe('validForm', () => {
	it('takes a form, refuses what is not one', () => {
		expect(validForm(emptyForm())).toBe(true);
		expect(validForm(null)).toBe(false);
		expect(validForm([])).toBe(false);
	});

	it('refuses a body nested too deep to measure instead of throwing (a 400, not a 500)', () => {
		let deep: unknown = [];
		for (let i = 0; i < 20_000; i++) deep = [deep];
		expect(validForm({ ...emptyForm(), tags: deep })).toBe(false);
	});
});
