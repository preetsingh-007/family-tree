#!/usr/bin/env node
// Verifies that nothing in public/ (which is copied verbatim into the deployed
// site) contains unencrypted family data. Run automatically in CI.
import { existsSync } from 'node:fs';
import { containerProblem, looksLikePlaintextTree, read, walk } from './lib/containers.mjs';

const problems = [];
if (existsSync('public')) {
  for (const file of walk('public')) {
    if (/\.(svg|png|ico|webp|jpg|txt)$/i.test(file)) continue;
    const text = read(file);
    if (file.endsWith('.ftree')) {
      const problem = containerProblem(text);
      if (problem) problems.push(`${file} ${problem}`);
    } else if (looksLikePlaintextTree(text)) {
      problems.push(`${file} looks like an UNENCRYPTED family-tree document`);
    }
  }
}

if (problems.length) {
  console.error('Public data check failed:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('Public data check passed: no unencrypted family data in public/.');
