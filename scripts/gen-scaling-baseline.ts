// Writes tests/fixtures/scaling-baseline.txt: the display of every invented
// recipe at its own amount (plan 05, Phase 0). Run once before scaling changed
// the display; the scaling tests hold the display at factor 1 to it. Rerun only
// for a display change that is meant, and say so in the commit.
//
//   npx tsx scripts/gen-scaling-baseline.ts

import '../tests/setup/unit-words';
import { writeFileSync } from 'node:fs';
import { BASELINE, baselineText } from '../tests/helpers/display';

const text = baselineText();
writeFileSync(BASELINE, text);
console.log(`${BASELINE}: ${text.split('\n').length - 1} lines`);
