import { test, expect } from 'crxbox';
import { NO_ONBOARDING, T, buildSeed, seedStorage } from './support/fixtures.mjs';

// E2E: the right-click "Add tab to Tabox Collection" menu must mirror indexed
// storage exactly. The SW rebuilds it from a debounced storage.onChanged
// listener and records the applied model on globalThis.__taboxContextMenu
// (see rebuildContextMenuNow in chrome/background-utils.js) — chrome offers no
// contextMenus.getAll(), so that snapshot is the observable surface.
//
// Audit coverage:
//   1. add/delete collection  → appears in / disappears from the menu
//   2. delete folder + its collections → entries removed
//   3. shared folders → write-access collections shown, read-only hidden
//   4. share-link joined collection → appears
//   5. group submenu: orphaned (undo-kept) groups hidden, group click routes

const POLL = { timeout: 15_000 };

const menuIds = (ext) =>
  ext.background.evaluate(() => (globalThis.__taboxContextMenu?.model ?? []).map((i) => i.id));

const sharedFolderRecord = (uid, name, role) => ({
  uid,
  name,
  type: 'folder',
  color: '#ff9800',
  collapsed: false,
  collectionCount: 1,
  order: 0,
  lastUpdated: T,
  createdOn: T,
  shared: { folderId: uid, role, ownerEmail: 'owner@example.com', members: [] },
});

test('deleting a collection via the popup removes it from the context menu', async ({ ext }) => {
  await seedStorage(ext, buildSeed({
    collections: [
      { uid: 'col-a', name: 'Alpha' },
      { uid: 'col-b', name: 'Beta' },
    ],
  }));

  await expect.poll(() => menuIds(ext), POLL)
    .toEqual(expect.arrayContaining(['tabox-super', 'col-a', 'col-b']));

  const popup = await ext.popup.open();
  const row = popup.locator('[data-collection-uid="col-a"]');
  await row.hover();
  await row.locator('.menu-icon').click();
  await popup.locator('.context-menu-item', { hasText: 'Delete Collection' }).click();
  await expect(popup.locator('[data-collection-uid="col-a"]')).toHaveCount(0);

  await expect.poll(() => menuIds(ext), POLL).not.toContain('col-a');
  expect(await menuIds(ext)).toContain('col-b');
});

test('adding collections (loose or inside a folder) adds them to the context menu', async ({ ext }) => {
  await seedStorage(ext, buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha' }] }));
  await expect.poll(() => menuIds(ext), POLL).toContain('col-a');

  // Any add path (popup save, save-all-windows folder, import) lands in the
  // same indexed-storage writes — append a loose collection and a folder child.
  const extra = buildSeed({
    collections: [
      { uid: 'col-a', name: 'Alpha' },
      { uid: 'col-new', name: 'Fresh' },
      { uid: 'col-in-folder', name: 'WindowOne', parentId: 'fold-1' },
    ],
    folders: [{ uid: 'fold-1', name: 'All Windows' }],
  });
  await seedStorage(ext, extra);

  await expect.poll(() => menuIds(ext), POLL)
    .toEqual(expect.arrayContaining(['col-new', 'col-in-folder']));
});

test('deleting a folder with its collections removes them from the context menu', async ({ ext }) => {
  await seedStorage(ext, buildSeed({
    collections: [
      { uid: 'col-keep', name: 'Keeper' },
      { uid: 'col-f1', name: 'InFolder', parentId: 'fold-1' },
    ],
    folders: [{ uid: 'fold-1', name: 'Doomed' }],
  }));
  await expect.poll(() => menuIds(ext), POLL)
    .toEqual(expect.arrayContaining(['col-keep', 'col-f1']));

  // Same storage transitions deleteFolder(force, deleteCollections) performs.
  await ext.background.evaluate(async () => {
    const { collections_index: cIndex = {} } = await chrome.storage.local.get('collections_index');
    delete cIndex['col-f1'];
    await chrome.storage.local.remove(['collection_col-f1', 'folder_fold-1']);
    await chrome.storage.local.set({ collections_index: cIndex, folders_index: {} });
  });

  await expect.poll(() => menuIds(ext), POLL).not.toContain('col-f1');
  expect(await menuIds(ext)).toContain('col-keep');
});

test('shared folders: write-access collections appear, read-only ones are hidden', async ({ ext }) => {
  const seed = buildSeed({
    collections: [
      { uid: 'col-rw', name: 'Editable', parentId: 'f-rw' },
      { uid: 'col-ro', name: 'ViewOnly', parentId: 'f-ro' },
    ],
  });
  seed['folder_f-rw'] = sharedFolderRecord('f-rw', 'Team RW', 'write');
  seed['folder_f-ro'] = sharedFolderRecord('f-ro', 'Team RO', 'read');
  seed.folders_index = {
    'f-rw': sharedFolderRecord('f-rw', 'Team RW', 'write'),
    'f-ro': sharedFolderRecord('f-ro', 'Team RO', 'read'),
  };
  await seedStorage(ext, seed);

  await expect.poll(() => menuIds(ext), POLL).toContain('col-rw');
  const ids = await menuIds(ext);
  expect(ids).not.toContain('col-ro');
  expect(ids).not.toContain('col-ro-main');

  // Defense in depth: a click on the hidden read-only collection is refused.
  const refused = await ext.background.evaluate(
    (info) => globalThis.TaboxBackgroundUtils.handleContextMenuClickBG(info, { title: 'x', url: 'https://x.example.com' }),
    { menuItemId: 'col-ro' },
  );
  expect(refused.handled).toBe(false);
});

test('a collection joined via share link appears in the context menu', async ({ ext }) => {
  await seedStorage(ext, { ...NO_ONBOARDING });

  // Exact storage writes addLocalCollectionFromSnapshot (share-link redeem)
  // performs in the SW: fresh uid, loose collection, index entry.
  await ext.background.evaluate(async (t) => {
    const uid = 'linked-uid';
    const { collections_index: got = {} } = await chrome.storage.local.get('collections_index');
    const record = {
      uid,
      name: 'Joined Via Link',
      color: '#4fc3f7',
      parentId: null,
      tabs: [{ title: 'shared tab', url: 'https://joined.example.com' }],
      chromeGroups: [],
      createdOn: t,
      lastUpdated: t,
    };
    await chrome.storage.local.set({
      [`collection_${uid}`]: record,
      collections_index: { ...got, [uid]: { uid, name: record.name, parentId: null, lastUpdated: t } },
    });
  }, T);

  await expect.poll(() => menuIds(ext), POLL).toContain('linked-uid');
});

test('group submenu hides orphaned groups and routes group clicks into the group', async ({ ext }) => {
  await seedStorage(ext, buildSeed({
    collections: [{
      uid: 'col-g',
      name: 'Grouped',
      tabs: [
        { uid: 't1', title: 'in live group', url: 'https://live.example.com', groupUid: 'g-live', groupId: 7 },
        { uid: 't2', title: 'loose', url: 'https://loose.example.com' },
      ],
      chromeGroups: [
        { uid: 'g-live', id: 7, title: 'Live Group', color: 'blue' },
        { uid: 'g-orphan', id: 8, title: 'Orphaned', color: 'red' },
      ],
    }],
  }));

  await expect.poll(() => menuIds(ext), POLL).toContain('col-g|g-live');
  const ids = await menuIds(ext);
  expect(ids).toContain('col-g-main');
  expect(ids).not.toContain('col-g|g-orphan');

  // Click the group item through the real SW handler → tab lands in the group.
  const result = await ext.background.evaluate(
    (info) => globalThis.TaboxBackgroundUtils.handleContextMenuClickBG(info, { title: 'added', url: 'https://added.example.com' }),
    { menuItemId: 'col-g|g-live' },
  );
  expect(result.handled).toBe(true);

  const saved = await ext.storage.local.get('collection_col-g');
  const added = saved.tabs.find((t) => t.url === 'https://added.example.com');
  expect(added).toBeTruthy();
  expect(added.groupUid).toBe('g-live');
  expect(added.groupId).toBe(7);
});
