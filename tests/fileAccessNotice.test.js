import '@testing-library/jest-dom';

jest.mock('../app/toastHelpers', () => ({
    showInfoToast: jest.fn(),
}));

const { browser } = require('../static/globals');
const toastHelpers = require('../app/toastHelpers');
const {
    maybeShowFileAccessNotice,
    getFileAccessNoticeMessage,
    FILE_ACCESS_NOTICE_DISMISSED_KEY,
} = require('../app/utils/fileAccessNotice');

// UI side of the file:// UX: when the background reports skippedForFileAccess
// (Chrome blocked file:// tabs because "Allow access to file URLs" is off),
// openCollectionTabs shows a one-time-dismissible toast explaining how to
// enable it. Shared code path, so it covers both the popup and full-page views.
describe('maybeShowFileAccessNotice', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.storage.local.get.mockReset();
        browser.storage.local.set.mockReset();
        browser.tabs.create = browser.tabs.create || jest.fn();
        browser.tabs.create.mockReset();
        browser.runtime.getURL = jest.fn(() => 'chrome-extension://test-id/');
        browser.runtime.id = 'test-id';
        browser.storage.local.get.mockResolvedValue({});
        browser.storage.local.set.mockResolvedValue(undefined);
    });

    test('shows the explanation toast with enable instructions when file tabs were skipped', async () => {
        const shown = await maybeShowFileAccessNotice(2);

        expect(shown).toBe(true);
        expect(toastHelpers.showInfoToast).toHaveBeenCalledTimes(1);
        const [message, duration, options] = toastHelpers.showInfoToast.mock.calls[0];
        expect(message).toContain('2 local file tabs skipped');
        expect(message).toContain('Allow access to file URLs');
        expect(message).toContain('chrome://extensions');
        expect(duration).toBe(12000);
        expect(options.title).toBe('Local file tabs skipped');
        expect(options.actions.map((a) => a.label)).toEqual(['Open settings', "Don't show again"]);
    });

    test('does nothing when no file tabs were skipped', async () => {
        expect(await maybeShowFileAccessNotice(0)).toBe(false);
        expect(await maybeShowFileAccessNotice(undefined)).toBe(false);
        expect(toastHelpers.showInfoToast).not.toHaveBeenCalled();
        expect(browser.storage.local.get).not.toHaveBeenCalled();
    });

    test('stays silent once the user dismissed the notice with "Don\'t show again"', async () => {
        browser.storage.local.get.mockResolvedValue({ [FILE_ACCESS_NOTICE_DISMISSED_KEY]: true });

        const shown = await maybeShowFileAccessNotice(3);

        expect(shown).toBe(false);
        expect(toastHelpers.showInfoToast).not.toHaveBeenCalled();
    });

    test('the "Don\'t show again" action persists the dismissal flag', async () => {
        await maybeShowFileAccessNotice(1);

        const [, , options] = toastHelpers.showInfoToast.mock.calls[0];
        const dontShowAgain = options.actions.find((a) => a.label === "Don't show again");
        await dontShowAgain.onClick();

        expect(browser.storage.local.set).toHaveBeenCalledWith({ [FILE_ACCESS_NOTICE_DISMISSED_KEY]: true });
    });

    test('the "Open settings" action opens the extension details page', async () => {
        await maybeShowFileAccessNotice(1);

        const [, , options] = toastHelpers.showInfoToast.mock.calls[0];
        const openSettings = options.actions.find((a) => a.label === 'Open settings');
        await openSettings.onClick();

        expect(browser.tabs.create).toHaveBeenCalledWith({ url: 'chrome://extensions/?id=test-id' });
    });

    test('on Firefox the message says extensions cannot open file:// links and offers no settings action', async () => {
        browser.runtime.getURL = jest.fn(() => 'moz-extension://test-id/');

        await maybeShowFileAccessNotice(1);

        const [message, , options] = toastHelpers.showInfoToast.mock.calls[0];
        expect(message).toContain('1 local file tab skipped');
        expect(message).toContain('Firefox');
        expect(message).not.toContain('chrome://extensions');
        expect(options.actions.map((a) => a.label)).toEqual(["Don't show again"]);
    });

    test('message pluralization: singular for one tab', () => {
        browser.runtime.getURL = jest.fn(() => 'chrome-extension://test-id/');
        expect(getFileAccessNoticeMessage(1)).toContain('1 local file tab skipped');
        expect(getFileAccessNoticeMessage(2)).toContain('2 local file tabs skipped');
    });
});
