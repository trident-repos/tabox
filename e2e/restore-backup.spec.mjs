import { test, expect } from 'crxbox';
import { NO_ONBOARDING, seedStorage } from './support/fixtures.mjs';

// E2E: Settings modal → "Recovery" section → Restore an auto backup → collections updated.
//
// Flow (verified against the source):
//  - The Recovery section (SyncDebugRecoveryPanel mode="recovery") renders in the
//    settings modal for every user — no sync login required.
//  - It lists `autoBackups` (grouped under "Auto Backups") with a Restore action per backup.
//  - Restore asks for confirmation via native confirm(), then sends
//    `restoreBackupSelection` (mode: overwrite) — the background restores the backup's
//    collections into indexed storage while keeping unrelated current items untouched.

const T = 1_710_000_000_000;

// Two collections that exist BEFORE the restore.
const indexEntry = (name, color, tabCount) => ({
  name,
  type: 'collection',
  tabCount,
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
  color,
  size: 0,
  parentId: null,
});

const SEED = {
  ...NO_ONBOARDING,

  // Initial collections (the "before" state).
  collections_index: {
    'col-old-1': indexEntry('Old Collection A', '#4fc3f7', 2),
    'col-old-2': indexEntry('Old Collection B', '#aed581', 1),
  },
  'collection_col-old-1': {
    uid: 'col-old-1',
    name: 'Old Collection A',
    color: '#4fc3f7',
    parentId: null,
    tabs: [
      { title: 'Old Tab 1', url: 'https://old1.example.com' },
      { title: 'Old Tab 2', url: 'https://old2.example.com' },
    ],
    chromeGroups: [],
    lastUpdated: T,
    lastOpened: null,
    createdOn: T,
  },
  'collection_col-old-2': {
    uid: 'col-old-2',
    name: 'Old Collection B',
    color: '#aed581',
    parentId: null,
    tabs: [{ title: 'Old Tab 3', url: 'https://old3.example.com' }],
    chromeGroups: [],
    lastUpdated: T,
    lastOpened: null,
    createdOn: T,
  },

  // A single auto backup whose collections DIFFER from the current ones.
  autoBackups: [
    {
      timestamp: T + 1,
      reason: 'Test auto backup',
      tabsArray: [
        {
          uid: 'col-restore-1',
          name: 'Restored Collection X',
          color: '#ff9800',
          parentId: null,
          tabs: [
            { title: 'New Tab 1', url: 'https://new1.example.com' },
            { title: 'New Tab 2', url: 'https://new2.example.com' },
            { title: 'New Tab 3', url: 'https://new3.example.com' },
          ],
          chromeGroups: [],
        },
        {
          uid: 'col-restore-2',
          name: 'Restored Collection Y',
          color: '#2196f3',
          parentId: null,
          tabs: [{ title: 'New Tab 4', url: 'https://new4.example.com' }],
          chromeGroups: [],
        },
      ],
      foldersArray: [],
    },
  ],
};

test('restoring an auto backup updates the stored collections', async ({ ext }) => {
  await seedStorage(ext, SEED);

  const popup = await ext.popup.open();

  // Sanity: before restore, the backup's collections are not present yet.
  const indexBefore = await ext.storage.local.get('collections_index');
  expect(Object.keys(indexBefore)).toEqual(
    expect.arrayContaining(['col-old-1', 'col-old-2']),
  );
  expect(Object.keys(indexBefore)).not.toContain('col-restore-1');

  // Open Settings modal → "Recovery" section.
  await popup.locator('.settings-button').click();
  await expect(popup.locator('.fp-settings-modal')).toBeVisible();
  await popup.locator('.fp-settings-sidebar-item', { hasText: 'Recovery' }).click();

  // The panel lists the seeded auto backup with a Restore button. Scope to the
  // "Auto Backups" group so we don't accidentally match a pre-sync/version restore.
  const autoGroup = popup
    .locator('.sync-recovery-backup-group')
    .filter({ hasText: 'Auto Backups' });
  const restoreButton = autoGroup.getByRole('button', { name: /^Restore backup/ });
  await expect(restoreButton).toBeVisible();

  // Restore asks for confirmation via a native confirm() dialog — accept it
  // (Playwright dismisses dialogs by default, which would cancel the restore).
  popup.once('dialog', (dialog) => dialog.accept());
  await restoreButton.click();

  // The restore round-trips through the service worker and writes asynchronously,
  // so poll the index rather than reading once (per crxbox guidance).
  await expect
    .poll(async () => Object.keys(await ext.storage.local.get('collections_index')))
    .toEqual(expect.arrayContaining(['col-restore-1', 'col-restore-2']));

  // The restored collection matches the backup's contents.
  const restored = await ext.storage.local.get('collection_col-restore-1');
  expect(restored).toMatchObject({
    uid: 'col-restore-1',
    name: 'Restored Collection X',
    color: '#ff9800',
  });
  expect(restored.tabs).toHaveLength(3);
  expect(restored.tabs.map((tab) => tab.url)).toEqual([
    'https://new1.example.com',
    'https://new2.example.com',
    'https://new3.example.com',
  ]);

  // The pre-existing collections are untouched (recover merges, it does not wipe).
  expect(Object.keys(await ext.storage.local.get('collections_index'))).toEqual(
    expect.arrayContaining(['col-old-1', 'col-old-2']),
  );
});
