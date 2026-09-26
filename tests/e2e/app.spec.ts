import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createSessionKey, encryptText } from '../../src/crypto/container';

const PASSPHRASE = 'harbour lantern violet oatmeal';

test.beforeEach(async ({ page }) => {
  // Force the download-based save path so tests do not depend on native file pickers.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
});

function trackRequests(page: Page) {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}

/** Collects Content-Security-Policy violations reported by the browser. */
function trackCspViolations(page: Page) {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

async function createTree(page: Page) {
  await page.getByRole('button', { name: 'New tree' }).click();
  await page.getByLabel('Name of the tree').fill('E2E family');
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByLabel('Repeat passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create tree' }).click();
  await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible({ timeout: 15_000 });
}

test('create, save, reopen and decrypt a tree from the static build', async ({ page, baseURL }) => {
  const requests = trackRequests(page);
  const cspViolations = trackCspViolations(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Family Tree', exact: true })).toBeVisible();
  await createTree(page);

  await page.getByRole('button', { name: 'Add person' }).first().click();
  await page.getByLabel('Given names').fill('Ottilie');
  await page.getByLabel('Surname / family name').fill('Privatename');
  await page.getByRole('button', { name: 'Add person' }).last().click();
  await expect(page.getByRole('heading', { level: 2, name: 'Ottilie Privatename' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Save/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^family-tree-.*\.ftree$/);
  const content = readFileSync((await download.path())!, 'utf8');
  expect(JSON.parse(content).format).toBe('family-tree-encrypted');
  expect(content).not.toContain('Ottilie');

  // Nothing but the site itself was contacted.
  const origin = new URL(baseURL!).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'))).toEqual([]);
  // No family data or passphrase in the URL.
  expect(page.url()).not.toContain('Ottilie');
  expect(page.url()).not.toContain('harbour');

  await page.reload();
  await page.getByLabel('Encrypted family-tree file').setInputFiles({ name: 'tree.ftree', mimeType: 'application/json', buffer: Buffer.from(content) });
  await page.getByLabel('Passphrase', { exact: true }).fill('wrong passphrase');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be decrypted', { timeout: 15_000 });

  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: /E2E family/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /^Ottilie Privatename/ }).first()).toBeVisible();
  expect(cspViolations).toEqual([]);
});

test('refuses to run inside a frame', async ({ page, baseURL }) => {
  await page.goto('./');
  await page.setContent(`<iframe src="${baseURL}" width="800" height="600"></iframe>`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Open this page directly' })).toBeVisible();
});

test('opens an encrypted tree published with the site', async ({ page }) => {
  const tree = {
    format: 'family-tree',
    version: 1,
    id: 'hosted',
    title: 'Hosted family',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    people: [
      { id: 'p1', givenNames: 'Hosted', surname: 'Person', alternateNames: [], living: 'unknown', events: [], notes: '', customFields: [], mediaIds: [] },
    ],
    parentLinks: [],
    partnerships: [],
    associations: [],
    media: [],
  };
  const container = await encryptText(JSON.stringify(tree), await createSessionKey(PASSPHRASE));
  await page.route('**/family-tree.ftree', (route) => route.fulfill({ body: container, contentType: 'application/json' }));
  await page.goto('./');
  const card = page.getByRole('region', { name: 'Open the family tree on this site' });
  await card.getByRole('button', { name: 'Unlock' }).click();
  await card.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await card.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: /Hosted family/ })).toBeVisible({ timeout: 15_000 });
});

test('keeps working offline once loaded', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Reload once so the page is controlled by the service worker.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Family Tree', exact: true })).toBeVisible();
  await createTree(page);
  await context.setOffline(false);
});

test('publishes the encrypted tree to GitHub from the production build', async ({ page }) => {
  const cspViolations = trackCspViolations(page);
  let committed: { message: string; content: string; branch: string } | undefined;
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'GET' && url.includes('/contents/')) return route.fulfill({ status: 404, body: '{}' });
    if (request.method() === 'GET' && url.includes('/branches/')) return route.fulfill({ status: 200, body: '{"name":"main"}' });
    if (request.method() === 'PUT') {
      committed = request.postDataJSON();
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{"content":{"sha":"abc123"}}' });
    }
    return route.fulfill({ status: 500, body: '{}' });
  });

  await page.goto('./');
  await createTree(page);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Publish to website/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish to website' });
  await dialog.getByLabel('Repository').fill('someone/family-tree');
  await dialog.getByLabel('GitHub access token', { exact: true }).fill('github_pat_TEST');
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('dialog', { name: 'Published' })).toBeVisible({ timeout: 15_000 });

  const text = Buffer.from(committed!.content, 'base64').toString('utf8');
  expect(JSON.parse(text).format).toBe('family-tree-encrypted');
  expect(text).not.toContain('E2E family');
  expect(cspViolations).toEqual([]);
});
