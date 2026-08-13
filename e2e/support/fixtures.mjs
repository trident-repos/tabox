// Shared seed builders + helpers for Tabox e2e specs.
// crxbox resets storage between tests, so seed inside each test before opening a page.

import { expect } from 'crxbox';

export const T = 1_710_000_000_000;

// Fresh installs mark onboarding eligible (background onInstalled), which renders a
// click-blocking overlay in both views. Seed these flags to keep it out of tests.
export const NO_ONBOARDING = { onboardingEligible: false, onboardingCompleted: true };

// Tab record for seeding a collection's `tabs` array.
export const tab = (uid, title, { groupUid, groupId } = {}) => ({
  uid,
  title,
  url: `https://${uid}.example.com`,
  groupId: groupId ?? -1,
  ...(groupUid !== undefined ? { groupUid } : {}),
});

export const collection = (uid, name, { order = 0, parentId = null, tabs, chromeGroups } = {}) => ({
  uid,
  name,
  color: '#4fc3f7',
  parentId,
  order,
  tabs: tabs ?? [{ title: `${name} tab`, url: `https://${uid}.example.com` }],
  chromeGroups: chromeGroups ?? [],
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
});

export const collectionIndexEntry = (name, { order = 0, parentId = null, tabCount = 1 } = {}) => ({
  name,
  type: 'collection',
  tabCount,
  lastUpdated: T,
  lastOpened: null,
  createdOn: T,
  color: '#4fc3f7',
  size: 0,
  parentId,
  order,
});

export const folder = (uid, name, { order = 0 } = {}) => ({
  uid,
  name,
  type: 'folder',
  color: '#ff9800',
  collapsed: false,
  collectionCount: 0,
  order,
  lastUpdated: T,
  createdOn: T,
});

export const folderIndexEntry = (name, { order = 0 } = {}) => ({
  name,
  type: 'folder',
  color: '#ff9800',
  collapsed: false,
  collectionCount: 0,
  order,
  lastUpdated: T,
  createdOn: T,
  size: 0,
});

// Build a full storage seed from a flat spec of collections/folders.
// A collection spec may include optional `tabs` / `chromeGroups` arrays;
// when `tabs` is given it is used verbatim and the index entry's tabCount
// is derived from it. Omitted → single default tab (legacy behavior).
export function buildSeed({ collections = [], folders = [] } = {}) {
  const seed = { collections_index: {}, folders_index: {}, ...NO_ONBOARDING };
  collections.forEach((c, i) => {
    const order = c.order ?? i;
    const parentId = c.parentId ?? null;
    seed.collections_index[c.uid] = collectionIndexEntry(c.name, {
      order,
      parentId,
      tabCount: c.tabs ? c.tabs.length : 1,
    });
    seed[`collection_${c.uid}`] = collection(c.uid, c.name, {
      order,
      parentId,
      tabs: c.tabs,
      chromeGroups: c.chromeGroups,
    });
  });
  folders.forEach((f, i) => {
    const order = f.order ?? i;
    seed.folders_index[f.uid] = folderIndexEntry(f.name, { order });
    seed[`folder_${f.uid}`] = folder(f.uid, f.name, { order });
  });
  return seed;
}

// Seed storage AFTER the SW's install-time writes have settled.
//
// crxbox's fixture clears storage while the extension's async `onInstalled` work may
// still be mid-flight (crxbox-feedback.md §21): a default written after the spec's
// seed silently overwrites it. Second confirmed instance (2026-08-13): under
// full-suite CPU load, `setInitialOptions`' `chkOpenNewWindow: true` default landed
// on top of issue-90's seeded `false`, so the collection opened into a NEW window and
// the spec's current-window polls timed out. The SW sets
// `globalThis.__taboxInstallSettled` once install-time writes are done; wait for it,
// then seed on top of whatever defaults landed. Not safe after `ext.background.kill()`
// (the global dies with the SW and onInstalled won't re-fire) — seed before killing.
export async function seedStorage(ext, data) {
  await expect
    .poll(() => ext.background.evaluate(() => globalThis.__taboxInstallSettled === true), {
      timeout: 10_000,
      message: 'SW install-time writes never settled (__taboxInstallSettled)',
    })
    .toBe(true);
  await ext.storage.local.set(data);
}

// Open the extension's full-page view as a normal page (uses crxbox's openPage helper).
export async function openFullPage(ext) {
  return ext.openPage('fullpage.html');
}

// Right-click a sidebar folder and click one of its context-menu items.
//
// FPSidebar closes the menu on ANY capture-phase scroll, and the full-page view
// emits a stray settle scroll on `.fp-sidebar-folders` shortly after load. Under
// full-suite CPU load that scroll can land BETWEEN the right-click and the item
// click, unmounting the menu under the cursor ("element was detached from the
// DOM"). Retry the whole right-click → item-click interaction until it lands; the
// caller's real assertions (storage/DOM effects) stay outside the retry.
export async function clickFolderCtxItem(page, folderUid, itemText) {
  await expect(async () => {
    await page
      .locator(`[data-sidebar-folder-uid="${folderUid}"] .fp-sidebar-folder-item`)
      .click({ button: 'right' });
    await page.locator('.fp-sidebar-ctx-item', { hasText: itemText }).click({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
}
