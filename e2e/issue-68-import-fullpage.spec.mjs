import { test, expect } from 'crxbox';
import { buildSeed } from './support/fixtures.mjs';

// Issue #68 (dupes #88/#93): importing from the POPUP silently failed on Edge and
// Linux Chromium — the OS file dialog steals focus, the browser destroys the popup
// document, and the file input's change event never fires. The popup's Import now
// records pendingImportRequest and opens/focuses the full-page view (a real tab,
// immune to focus-close), which consumes the flag on mount and opens its picker.

const NO_ONBOARDING = { onboardingEligible: false, onboardingCompleted: true };

test('popup Import opens the full-page view and hands off the import request', async ({ ext }) => {
  await ext.storage.local.set({
    ...buildSeed({ collections: [{ uid: 'col-a', name: 'Alpha', order: 0 }] }),
    ...NO_ONBOARDING,
  });

  const popup = await ext.popup.open();
  await popup.locator('#toolbar-import').click();

  // A full-page tab opens in the current window...
  const fullPageUrl = `${ext.url('fullpage.html')}`;
  await expect
    .poll(async () =>
      ext.background.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({ url });
        return tabs.length;
      }, fullPageUrl),
    { timeout: 10000 })
    .toBeGreaterThan(0);

  // ...and consumes the pending import request (which triggers its file picker).
  await expect
    .poll(async () => (await ext.storage.local.get('pendingImportRequest')) ?? null, { timeout: 10000 })
    .toBeNull();

  // The popup no longer renders a file input at all.
  const popup2 = await ext.popup.open();
  expect(await popup2.locator('input[type="file"]').count()).toBe(0);
});
