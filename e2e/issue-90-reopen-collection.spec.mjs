import { test, expect } from 'crxbox';
import { buildSeed } from './support/fixtures.mjs';

// Repro attempt for GitHub issue #90 (dup: #99): after opening a collection once,
// clicking "open collection tabs" again does nothing — regardless of the
// "if a tab already exists, open it anyway" (chkIgnoreDuplicates) setting.
// Reporters say it works only on the first open after the browser starts, and
// never again, even after the collection's tabs are closed.
//
// Working hypothesis: openCollectionTabs always passes trackOpenedWindow=true, so the
// first open registers the window in collectionsToTrack; with chkEnableAutoUpdate on,
// handleAutoUpdate then REBUILDS the collection from the tracked window as its tabs
// close — leaving the collection with no (or wrong) tabs, so later opens no-op.
//
// Tabs use extension-page URLs: the background's openTabs navigates a new window's
// first tab via tabs.update, which never commits for data: URLs in headless Chromium
// (see open-folder-launch-all.spec.mjs).

const NO_ONBOARDING = { onboardingEligible: false, onboardingCompleted: true };

const extUrl = (ext, key) => `${ext.url('index.html')}?e2e=${key}`;

async function currentWindowUrls(ext, windowId) {
  return ext.background.evaluate(async (id) => {
    const w = await chrome.windows.get(id, { populate: true });
    return (w.tabs || []).map((t) => t.url);
  }, windowId);
}

async function popupWindowId(ext) {
  return ext.background.evaluate(async () => {
    const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return w.id;
  });
}

// Close (via the SW) every tab in `windowId` whose URL is in `urls`.
async function closeTabsByUrl(ext, windowId, urls) {
  await ext.background.evaluate(
    async ({ id, urls }) => {
      const w = await chrome.windows.get(id, { populate: true });
      const doomed = (w.tabs || []).filter((t) => urls.includes(t.url)).map((t) => t.id);
      if (doomed.length) await chrome.tabs.remove(doomed);
    },
    { id: windowId, urls },
  );
}

async function seededCollectionTabs(ext) {
  return (await ext.storage.local.get('collection_col-a')).tabs.map((t) => t.url);
}

function seed(ext, extra = {}) {
  const tabs = [
    { title: 'Alpha One', url: extUrl(ext, 'a1') },
    { title: 'Alpha Two', url: extUrl(ext, 'a2') },
  ];
  return {
    seed: {
      ...buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha', tabs }] }),
      ...NO_ONBOARDING,
      chkOpenNewWindow: false, // open into the current window (reporters' scenario)
      chkIgnoreDuplicates: false, // "if a tab already exists, OPEN IT ANYWAY"
      ...extra,
    },
    urls: tabs.map((t) => t.url),
  };
}

async function openCollectionFromPopup(ext) {
  const popup = await ext.popup.open();
  const row = popup.locator('[data-collection-uid="col-a"]');
  await row.hover();
  await row.locator('.open-tabs-icon').click();
  return popup;
}

// Poll until every url in `urls` is present in the window.
async function expectTabsOpen(ext, windowId, urls, label) {
  await expect
    .poll(async () => {
      const open = await currentWindowUrls(ext, windowId);
      return urls.every((u) => open.includes(u));
    }, { timeout: 10000, message: label })
    .toBe(true);
}

test('reopens a collection in the current window after its tabs were closed (auto-update OFF)', async ({ ext }) => {
  const { seed: data, urls } = seed(ext, { chkEnableAutoUpdate: false });
  await ext.storage.local.set(data);

  const winId = await popupWindowId(ext);

  // First open — works per reporters.
  await openCollectionFromPopup(ext);
  await expectTabsOpen(ext, winId, urls, 'first open');

  // User closes the collection's tabs, then tries to open again.
  await closeTabsByUrl(ext, winId, urls);
  await openCollectionFromPopup(ext);
  await expectTabsOpen(ext, winId, urls, 'second open (issue #90: this never happens)');
});

test('reopens a collection after its tabs were closed with auto-update ON (tracked window)', async ({ ext }) => {
  const { seed: data, urls } = seed(ext, { chkEnableAutoUpdate: true });
  await ext.storage.local.set(data);

  const winId = await popupWindowId(ext);

  await openCollectionFromPopup(ext);
  await expectTabsOpen(ext, winId, urls, 'first open');

  // Give addCollectionToTrack's 300ms setTimeout time to register the window.
  await expect
    .poll(async () => ((await ext.storage.local.get('collectionsToTrack')) ?? []).length ?? 0, {
      timeout: 5000,
    })
    .toBeGreaterThan(0);

  // Close the collection's tabs — auto-update fires on tabs.onRemoved and may
  // rebuild the collection from what's left of the tracked window.
  await closeTabsByUrl(ext, winId, urls);

  // The collection's saved tabs must survive its own tabs being closed.
  await expect
    .poll(async () => (await seededCollectionTabs(ext)).length, {
      timeout: 5000,
      message: 'collection tabs should NOT be emptied by auto-update when its tabs close',
    })
    .toBe(urls.length);

  await openCollectionFromPopup(ext);
  await expectTabsOpen(ext, winId, urls, 'second open with auto-update on');
});
