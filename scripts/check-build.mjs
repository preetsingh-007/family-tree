#!/usr/bin/env node
// Post-build safety checks for the static site in dist/.
import { existsSync } from 'node:fs';
import { containerProblem, looksLikePlaintextTree, read, walk } from './lib/containers.mjs';

// Distinctive names used only in the (synthetic) test fixtures.
const TEST_MARKERS = ['Testfield', 'Exampleton', 'Hiddenname'];

const problems = [];
if (!existsSync('dist/index.html')) problems.push('dist/index.html is missing — did the build run?');

for (const file of existsSync('dist') ? walk('dist') : []) {
  if (file.endsWith('.map')) problems.push(`${file}: source maps must not be published`);
  if (/\.(png|ico|webp|jpg)$/i.test(file)) continue;
  const text = read(file);
  if (file.endsWith('.ftree')) {
    const problem = containerProblem(text);
    if (problem) problems.push(`${file} ${problem}`);
    continue;
  }
  if (looksLikePlaintextTree(text)) problems.push(`${file}: contains what looks like an unencrypted family tree`);
  for (const marker of TEST_MARKERS) {
    if (text.includes(marker)) problems.push(`${file}: contains test fixture data ("${marker}")`);
  }
}

if (existsSync('dist/index.html')) {
  const html = read('dist/index.html');
  if (!html.includes('http-equiv="Content-Security-Policy"')) problems.push('dist/index.html: Content-Security-Policy is missing');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) problems.push('dist/index.html: contains an inline script');
  if (/(src|href)="\/(?!\/)/.test(html) && !process.env.BASE_PATH) {
    problems.push('dist/index.html: uses root-absolute URLs, which break on GitHub Pages project sites');
  }
}

if (problems.length) {
  console.error('Build check failed:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('Build check passed: no source maps, test data, plaintext trees, or inline scripts; CSP present.');
