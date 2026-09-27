#!/usr/bin/env node
// npm bin entry: runs the TypeScript CLI through tsx.
import { register } from 'tsx/esm/api';

register();
await import('../src/cli/vault.ts');
