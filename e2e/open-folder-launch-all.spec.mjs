import { test, expect } from 'crxbox';
import { buildSeed, seedStorage } from './support/fixtures.mjs';

// Coverage gap: opening collections into REAL new windows (post-refactor path where the
// popup sends `createWindowSpec` and the BACKGROUND creates the window + tabs atomically —
// see openCollectionTabs in app/useCollectionOperations.js and handlePlayFolder in
// app/FolderContainer.js). Both flows are popup-only: FolderContainer/CollectionList are
// rendered when `isFullPage` is false (app/App.js); the full-page view uses the separate
// FPLayout/FPCollectionCard tree.
//
// Also covers the "update collection" auto-tracking flow (chrome/background.js
// `handleAutoUpdate`), which was not exercised anywhere else in e2e/ (grep for
// "auto-update|updateCollection" only turned up an unrelated comment in
// reorder-collections.spec.mjs about order persistence).

const pageUrl = (title) => `data:text/html,<title>${title}</title><h1>${title}</h1>`;

// The background's openTabs navigates a freshly-created window's FIRST tab via
// `chrome.tabs.update` (chrome/background.js ~line 1161), not `chrome.tabs.create`. In this
// headless Chromium, tabs.update-ing a brand-new about:blank/newtab tab to a `data:` URL never
// commits (tab stays on chrome://newtab/, confirmed by manual probing) — while tabs.create
// (used for every subsequent tab) handles `data:` URLs fine, and tabs.update also works fine
// for extension-page URLs. So every seeded collection's first tab must be an extension page;
// only tabs after the first may use data: URLs.
function firstTabUrl(ext, key) {
  return `${ext.url('index.html')}?e2e=${key}`;
}

// Suppress the first-run onboarding overlay (app/OnboardingGuide.js) — it renders on top of
// the popup and steals pointer events from the collection/folder rows this spec clicks.
const NO_ONBOARDING = { onboardingEligible: false, onboardingCompleted: true };

// Snapshot every real browser window with its tab URLs, read straight from the SW's
// chrome.windows API (not Playwright's own window model, which doesn't map 1:1 to it).
async function windowsSnapshot(ext) {
  return ext.background.evaluate(async () => {
    const wins = await chrome.windows.getAll({ populate: true });
    return wins.map((w) => ({ id: w.id, urls: (w.tabs || []).map((t) => t.url) }));
  });
}

// Poll until a window NOT present in `baseline` contains every url in `urls` (order-
// independent; data: URLs may round-trip encoded/decoded, so compare decoded).
async function waitForNewWindow(ext, baseline, urls, { timeout = 10000 } = {}) {
  const baselineIds = new Set(baseline.map((w) => w.id));
  let found;
  await expect
    .poll(
      async () => {
        const snap = await windowsSnapshot(ext);
        found = snap.find(
          (w) =>
            !baselineIds.has(w.id) &&
            urls.every((u) => w.urls.some((wu) => decodeURIComponent(wu || '') === u)),
        );
        return Boolean(found);
      },
      { timeout },
    )
    .toBe(true);
  return found;
}

// Like waitForNewWindow, but for asserting N disjoint new windows show up at once
// (folder "open all"), matching each window to one of several url-sets.
async function waitForNewWindows(ext, baseline, urlSets, { timeout = 10000 } = {}) {
  const baselineIds = new Set(baseline.map((w) => w.id));
  let found;
  await expect
    .poll(
      async () => {
        const snap = await windowsSnapshot(ext);
        const candidates = snap.filter((w) => !baselineIds.has(w.id));
        found = urlSets.map((urls) =>
          candidates.find((w) => urls.every((u) => w.urls.some((wu) => decodeURIComponent(wu || '') === u))),
        );
        return found.every(Boolean);
      },
      { timeout },
    )
    .toBe(true);
  return found;
}

async function closeWindows(ext, ids) {
  for (const id of ids.filter(Boolean)) {
    await ext.background.evaluate((winId) => chrome.windows.remove(winId).catch(() => {}), id);
  }
}

test('opens a single collection into a new window from the popup', async ({ ext }) => {
  const tabs = [
    { title: 'Alpha One', url: firstTabUrl(ext, 'alpha') },
    { title: 'Alpha Two', url: pageUrl('Alpha Two') },
  ];
  await seedStorage(ext, {
    ...buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha', tabs }] }),
    ...NO_ONBOARDING,
    chkOpenNewWindow: true,
  });

  const popup = await ext.popup.open();
  const baseline = await windowsSnapshot(ext);

  const row = popup.locator('[data-collection-uid="col-a"]');
  await row.hover();
  await row.locator('.open-tabs-icon').click();

  const newWin = await waitForNewWindow(ext, baseline, tabs.map((t) => t.url));
  expect(newWin.urls).toHaveLength(2);

  // The background's openTabs handler stamps lastOpened authoritatively for this path too.
  await expect
    .poll(async () => (await ext.storage.local.get('collections_index'))['col-a'].lastOpened)
    .not.toBeNull();

  await closeWindows(ext, [newWin.id]);
});

test('opens all collections in a folder, each into its own new window', async ({ ext }) => {
  const tabsOne = [
    { title: 'One A', url: firstTabUrl(ext, 'one') },
    { title: 'One B', url: pageUrl('One B') },
  ];
  const tabsTwo = [
    { title: 'Two A', url: firstTabUrl(ext, 'two') },
    { title: 'Two B', url: pageUrl('Two B') },
    { title: 'Two C', url: pageUrl('Two C') },
  ];
  const seed = buildSeed({
    folders: [{ uid: 'fold-1', name: 'Trip', order: 0 }],
    collections: [
      { uid: 'col-one', name: 'CollectionOne', parentId: 'fold-1', order: 0, tabs: tabsOne },
      { uid: 'col-two', name: 'CollectionTwo', parentId: 'fold-1', order: 1, tabs: tabsTwo },
    ],
  });
  // buildSeed's folder fixtures default collectionCount to 0; the "Open" button in
  // FolderContainer.js is disabled when collectionCount === 0, so reflect reality here.
  seed.folders_index['fold-1'].collectionCount = 2;
  seed['folder_fold-1'].collectionCount = 2;
  await seedStorage(ext, { ...seed, ...NO_ONBOARDING });

  const popup = await ext.popup.open();
  const baseline = await windowsSnapshot(ext);

  // The folder's name only exists as the value of an <input class="autosave-textbox">
  // (FolderContainer renders it expanded-by-default via AutoSaveTextbox, not as text), so
  // `hasText` can't target it — a single seeded folder means `.folder-container` is unambiguous.
  const folderContainer = popup.locator('.folder-container');
  await expect(folderContainer).toHaveCount(1);
  await expect(folderContainer.locator('.folder-open-btn')).toBeEnabled();
  await folderContainer.locator('.folder-open-btn').click();

  const [winOne, winTwo] = await waitForNewWindows(ext, baseline, [
    tabsOne.map((t) => t.url),
    tabsTwo.map((t) => t.url),
  ]);
  expect(winOne.urls).toHaveLength(2);
  expect(winTwo.urls).toHaveLength(3);

  await closeWindows(ext, [winOne.id, winTwo.id]);
});

test('auto-update syncs a live tab change in a tracked window back to storage', async ({ ext }) => {
  // Coverage gap: no other e2e spec exercises the "update collection" auto-tracking flow
  // (chrome/background.js handleAutoUpdate + collectionsToTrack). Opening a collection with
  // trackOpenedWindow (the default) registers its window for tracking; a 2s-debounced
  // listener then re-syncs the collection's saved tabs whenever that window's tabs change.
  const initialTabs = [{ title: 'Tracked One', url: firstTabUrl(ext, 'tracked') }];
  await seedStorage(ext, {
    ...buildSeed({ collections: [{ uid: 'col-u', name: 'Tracked', tabs: initialTabs }] }),
    ...NO_ONBOARDING,
    chkOpenNewWindow: true,
    chkEnableAutoUpdate: true,
  });

  const popup = await ext.popup.open();
  const baseline = await windowsSnapshot(ext);

  const row = popup.locator('[data-collection-uid="col-u"]');
  await row.hover();
  await row.locator('.open-tabs-icon').click();

  const newWin = await waitForNewWindow(ext, baseline, initialTabs.map((t) => t.url));

  // Add a second tab directly in the tracked window — a real tab-lifecycle event, not a
  // storage write — and let the SW's debounced auto-update pick it up.
  await ext.background.evaluate(
    (args) => chrome.tabs.create({ windowId: args.windowId, url: args.url }),
    { windowId: newWin.id, url: pageUrl('Tracked Two') },
  );

  await expect
    .poll(async () => (await ext.storage.local.get('collection_col-u'))?.tabs?.length, { timeout: 10000 })
    .toBe(2);
  await expect
    .poll(async () => {
      const col = await ext.storage.local.get('collection_col-u');
      return col.tabs.map((t) => decodeURIComponent(t.url || ''));
    })
    .toEqual(expect.arrayContaining([initialTabs[0].url, pageUrl('Tracked Two')]));

  await closeWindows(ext, [newWin.id]);
});
