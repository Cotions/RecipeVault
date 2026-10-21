// The interface's strings, in the language of the person being served
// (lib/prefs.ts): French signed out, the account's choice signed in.
// Browser-safe.

import { en } from './en';
import { fr, type Strings } from './fr';
import { localized } from './localized';

export const t: Strings = localized({ fr, en });
/** The form's strings (`t.form`), imported as `f` by the form's components. */
export const form = t.form;

export { tagLabel, familyLabel, type Strings } from './fr';
