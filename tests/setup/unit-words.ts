// Every test runs with the seed unit words (docs/VOCAB.md, "Unit labels")
// installed, as every page of a seeded vault does through the root layout.
// tests/unit/unitwords.test.ts covers a vault without them.

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { parseUnitWords, setUnitWords } from '../../src/lib/render/unitwords';
import { seedVocab } from '../../src/lib/server/vault';

setUnitWords(parseUnitWords(parse(seedVocab(readFileSync('docs/VOCAB.md', 'utf8'))['unit-labels.yaml'], { version: '1.2' })));
