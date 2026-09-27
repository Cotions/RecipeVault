// Who fixes each diagnostic code — the "Fixed by" column of docs/VALIDATION.md.
// Only `ai` codes go into the fix-request block; `app` codes are settled in the
// app or by the person, and show only in the app UI and `vault check` output.
// Adding a code means choosing its fixer: a test fails on a code missing here
// or disagreeing with the doc.

export type Fixer = 'ai' | 'app';

export const CODE_FIXERS: Readonly<Record<string, Fixer>> = {
	I701: 'app',
	I702: 'app',
	E001: 'ai',
	E002: 'ai',
	E003: 'ai',
	E101: 'ai',
	E102: 'ai',
	E103: 'app',
	E104: 'ai',
	E105: 'ai',
	E106: 'ai',
	E107: 'ai',
	E108: 'ai',
	E109: 'ai',
	E110: 'ai',
	E111: 'ai',
	E112: 'app',
	E113: 'app',
	E114: 'ai',
	E200: 'ai',
	E201: 'ai',
	E202: 'ai',
	E203: 'ai',
	E204: 'ai',
	E205: 'ai',
	E206: 'ai',
	E207: 'ai',
	E208: 'ai',
	E209: 'ai',
	E210: 'ai',
	E211: 'ai',
	E212: 'ai',
	E213: 'ai',
	E214: 'ai',
	E215: 'ai',
	E216: 'ai',
	E217: 'ai',
	E218: 'ai',
	E301: 'ai',
	W302: 'ai',
	W303: 'app',
	W304: 'ai',
	W305: 'app',
	W306: 'app',
	W401: 'ai',
	W402: 'ai',
	W403: 'ai',
	W501: 'app',
	W502: 'app',
	W503: 'app',
	W504: 'ai',
	W601: 'app',
	W602: 'app',
	W603: 'app',
	W604: 'app',
	W605: 'app',
	W606: 'ai',
	W607: 'ai',
	W608: 'app',
	W609: 'ai',
	W610: 'ai'
};

/** Who fixes a code. An unregistered code is kept away from the AI. */
export function fixerOf(code: string): Fixer {
	return CODE_FIXERS[code] ?? 'app';
}
