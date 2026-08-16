import { test, expect } from 'crxbox';
import { NO_ONBOARDING, seedStorage } from './support/fixtures.mjs';

// Smoke test for the crxbox UI-testing setup: open the popup and verify that
// clicking the gear button opens the Settings modal.
//
// Popup is the manifest's action.default_popup (index.html). The settings trigger
// is a `.settings-button` div in app/SettingsMenu.js; opening it shows the
// `.fp-settings-modal` whose sidebar header reads "Settings".
test.describe('popup settings menu', () => {
  test('opens the settings drawer from the gear button', async ({ ext }) => {
    await seedStorage(ext, NO_ONBOARDING);
    const popup = await ext.popup.open();

    const settingsButton = popup.locator('.settings-button');
    await expect(settingsButton).toBeVisible();

    // Modal starts closed.
    await expect(popup.locator('.fp-settings-modal')).toHaveCount(0);

    await settingsButton.click();

    // Settings modal opens and shows the "Settings" sidebar header.
    const modal = popup.locator('.fp-settings-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  });
});
