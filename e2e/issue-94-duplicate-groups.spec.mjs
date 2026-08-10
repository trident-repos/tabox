import { test, expect } from 'crxbox';
import { buildSeed } from './support/fixtures.mjs';

// Repro for GitHub issue #94: reopening a collection that contains a native tab
// group creates a NEW identical group every time instead of reusing/updating the
// matching group that is already in the window. Chrome also saves each created
// group to its Tab Groups dropdown, so duplicates pile up there (reporter's
// screenshot). A follow-up comment adds that the duplicate-tab and duplicate-
// group settings "don't work".
//
// Two suspected defects (from code reading, to be confirmed by this spec):
//  1. applyChromeGroupSettings (chrome/background-utils.js) always calls
//     tabs.group({createProperties}) — it never looks for an existing group
//     with the same title+color in the target window.
//  2. openTabs (chrome/background.js) resolves the dedupe setting via
//     `newWindow ?? storage.get('chkIgnoreDuplicates')`; the popup sends
//     newWindow:false for current-window opens, and `false ?? x` is false —
//     so chkIgnoreDuplicates is silently ignored for same-window opens.

const NO_ONBOARDING = { onboardingEligible: false, onboardingCompleted: true };
const extUrl = (ext, key) => `${ext.url('index.html')}?e2e=${key}`;

const GROUP_ID = 111;

function seed(ext, extra = {}) {
  const tabs = [
    { title: 'Work One', url: extUrl(ext, 'w1'), groupId: GROUP_ID },
    { title: 'Work Two', url: extUrl(ext, 'w2'), groupId: GROUP_ID },
  ];
  return {
    seed: {
      ...buildSeed({
        collections: [{
          uid: 'col-a',
          name: 'Alpha',
          tabs,
          chromeGroups: [{ id: GROUP_ID, title: 'Work', color: 'blue', collapsed: false }],
        }],
      }),
      ...NO_ONBOARDING,
      chkOpenNewWindow: false,
      chkEnableAutoUpdate: false,
      ...extra,
    },
    urls: tabs.map((t) => t.url),
  };
}

async function openFromPopup(ext) {
  const popup = await ext.popup.open();
  const row = popup.locator('[data-collection-uid="col-a"]');
  await row.hover();
  await row.locator('.open-tabs-icon').click();
}

async function groupsNamed(ext, title) {
  return ext.background.evaluate(async (t) => {
    const groups = await chrome.tabGroups.query({});
    return groups.filter((g) => g.title === t).length;
  }, title);
}

async function openTabCount(ext, urls) {
  return ext.background.evaluate(async (list) => {
    const tabs = await chrome.tabs.query({});
    return tabs.filter((t) => list.includes(t.url)).length;
  }, urls);
}

test('reopening a collection reuses the existing matching tab group instead of duplicating it', async ({ ext }) => {
  const { seed: data } = seed(ext, { chkIgnoreDuplicates: false });
  await ext.storage.local.set(data);

  await openFromPopup(ext);
  await expect.poll(() => groupsNamed(ext, 'Work'), { timeout: 10000 }).toBe(1);

  await openFromPopup(ext);
  // Wait until the second open has finished creating its tabs (dedupe is off,
  // so the two urls appear twice) — only then is the group count meaningful.
  const { urls } = seed(ext);
  await expect.poll(() => openTabCount(ext, urls), { timeout: 10000 }).toBe(4);
  await new Promise((r) => setTimeout(r, 1000)); // let applyChromeGroupSettings settle
  // Desired behavior from the issue: still ONE "Work" group (tabs appended /
  // group updated in place), not a second identical one.
  expect(await groupsNamed(ext, 'Work'), 'issue #94: duplicate "Work" group created on reopen').toBe(1);
});

test('duplicate-tab setting is honored on same-window opens (skip tabs already open)', async ({ ext }) => {
  const { seed: data, urls } = seed(ext, { chkIgnoreDuplicates: true });
  await ext.storage.local.set(data);

  await openFromPopup(ext);
  await expect.poll(() => openTabCount(ext, urls), { timeout: 10000 }).toBe(2);

  await openFromPopup(ext);
  // "If a tab already exists, do not open it" is ON — the second open must not
  // duplicate the two tabs (and consequently must not create a second group).
  // Poll waits out the second open before judging.
  await new Promise((r) => setTimeout(r, 3000));
  expect(await openTabCount(ext, urls), 'tabs duplicated despite chkIgnoreDuplicates=true').toBe(2);
  expect(await groupsNamed(ext, 'Work'), 'group duplicated despite chkIgnoreDuplicates=true').toBe(1);
});
