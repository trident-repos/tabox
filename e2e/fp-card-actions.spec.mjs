import { readFileSync } from 'node:fs';
import { test, expect } from 'crxbox';
import { buildSeed, openFullPage, seedStorage } from './support/fixtures.mjs';

// Full-page collection card context-menu actions (right-click → ContextMenu): delete + export.

const SEED = buildSeed({
  collections: [
    { uid: 'col-a', name: 'Alpha', order: 0 },
    { uid: 'col-b', name: 'Beta', order: 1 },
  ],
});

async function openCardMenu(page, uid) {
  const card = page.locator(`[data-sortable-collection-id="${uid}"]`);
  await card.click({ button: 'right' });
}

test('deletes a collection from the card menu', async ({ ext, context }) => {
  await seedStorage(ext, SEED);
  const page = await openFullPage(ext);
  await expect(page.locator('.fp-collection-card')).toHaveCount(2);

  await openCardMenu(page, 'col-a');
  await page.locator('.fp-card-ctx-item', { hasText: 'Delete Collection' }).click();

  // Card disappears; storage drops the collection (delete is async ~400ms).
  await expect(page.locator('[data-sortable-collection-id="col-a"]')).toHaveCount(0);
  await expect
    .poll(async () => Object.keys(await ext.storage.local.get('collections_index')))
    .toEqual(['col-b']);
  expect(await ext.storage.local.get('collection_col-a')).toBeUndefined();
  await expect(ext.storage.local).toHaveStorageValue(
    'collections_index',
    expect.objectContaining({ 'col-b': expect.objectContaining({ name: 'Beta' }) }),
  );
});

test('exports a single collection from the card menu', async ({ ext, context }) => {
  await seedStorage(ext, SEED);
  const page = await openFullPage(ext);

  await openCardMenu(page, 'col-a');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.fp-card-ctx-item', { hasText: 'Export Collection' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('Alpha.txt');
  const data = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(data).toMatchObject({ uid: 'col-a', name: 'Alpha' });
  expect(data.tabs).toHaveLength(1);
});
