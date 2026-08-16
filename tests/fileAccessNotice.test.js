import '@testing-library/jest-dom';

jest.mock('../app/toastHelpers', () => ({
    showInfoToast: jest.fn(),
}));

const { browser } = require('../static/globals');
const toastHelpers = require('../app/toastHelpers');
const {
    maybeShowFileAccessNotice,
    getFileAccessNoticeMessage,
    initFileAccessNoticeWatcher,
    FILE_ACCESS_NOTICE_DISMISSED_KEY,
    FILE_ACCESS_NOTICE_PENDING_KEY,
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

// The background persists FILE_ACCESS_NOTICE_PENDING_KEY when it skips file://
// tabs (the initiating popup is usually torn down by the focus shift before a
// toast could render). The watcher — mounted by App.js in both views — is what
// actually surfaces the notice.
describe('initFileAccessNoticeWatcher', () => {
    let cleanup;

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const getChangeListener = () => {
        const calls = browser.storage.onChanged.addListener.mock.calls;
        return calls[calls.length - 1][0];
    };

    beforeEach(() => {
        jest.clearAllMocks();
        cleanup = null;
        browser.storage.local.get.mockReset();
        browser.storage.local.set.mockReset();
        browser.storage.local.remove = browser.storage.local.remove || jest.fn();
        browser.storage.local.remove.mockReset();
        browser.storage.local.remove.mockResolvedValue(undefined);
        browser.storage.local.set.mockResolvedValue(undefined);
        browser.runtime.getURL = jest.fn(() => 'chrome-extension://test-id/');
        browser.runtime.id = 'test-id';
    });

    afterEach(() => {
        if (cleanup) cleanup();
    });

    test('shows and consumes a pending notice on mount', async () => {
        browser.storage.local.get.mockResolvedValue({
            [FILE_ACCESS_NOTICE_PENDING_KEY]: { count: 2, ts: 123 },
        });

        cleanup = initFileAccessNoticeWatcher({ isFullPage: false });
        await flush();

        expect(toastHelpers.showInfoToast).toHaveBeenCalledTimes(1);
        expect(toastHelpers.showInfoToast.mock.calls[0][0]).toContain('2 local file tabs skipped');
        expect(browser.storage.local.remove).toHaveBeenCalledWith(FILE_ACCESS_NOTICE_PENDING_KEY);
    });

    test('does nothing on mount when there is no pending notice', async () => {
        browser.storage.local.get.mockResolvedValue({});

        cleanup = initFileAccessNoticeWatcher({ isFullPage: false });
        await flush();

        expect(toastHelpers.showInfoToast).not.toHaveBeenCalled();
        expect(browser.storage.local.remove).not.toHaveBeenCalled();
    });

    test('a live storage change shows AND consumes the notice in the full-page view', async () => {
        browser.storage.local.get.mockResolvedValue({});
        cleanup = initFileAccessNoticeWatcher({ isFullPage: true });
        await flush();

        browser.storage.local.get.mockResolvedValue({
            [FILE_ACCESS_NOTICE_PENDING_KEY]: { count: 1, ts: 123 },
        });
        getChangeListener()({ [FILE_ACCESS_NOTICE_PENDING_KEY]: { newValue: { count: 1 } } }, 'local');
        await flush();

        expect(toastHelpers.showInfoToast).toHaveBeenCalledTimes(1);
        expect(browser.storage.local.remove).toHaveBeenCalledWith(FILE_ACCESS_NOTICE_PENDING_KEY);
    });

    test('a live storage change in the popup shows the notice but leaves it pending (popup may be about to die)', async () => {
        browser.storage.local.get.mockResolvedValue({});
        cleanup = initFileAccessNoticeWatcher({ isFullPage: false });
        await flush();

        browser.storage.local.get.mockResolvedValue({
            [FILE_ACCESS_NOTICE_PENDING_KEY]: { count: 1, ts: 123 },
        });
        getChangeListener()({ [FILE_ACCESS_NOTICE_PENDING_KEY]: { newValue: { count: 1 } } }, 'local');
        await flush();

        expect(toastHelpers.showInfoToast).toHaveBeenCalledTimes(1);
        expect(browser.storage.local.remove).not.toHaveBeenCalled();
    });

    test('mount consumes the pending notice even when the user already dismissed the toast', async () => {
        browser.storage.local.get.mockImplementation(async (key) => {
            if (key === FILE_ACCESS_NOTICE_PENDING_KEY) {
                return { [FILE_ACCESS_NOTICE_PENDING_KEY]: { count: 1, ts: 123 } };
            }
            return { [FILE_ACCESS_NOTICE_DISMISSED_KEY]: true };
        });

        cleanup = initFileAccessNoticeWatcher({ isFullPage: false });
        await flush();

        expect(toastHelpers.showInfoToast).not.toHaveBeenCalled();
        expect(browser.storage.local.remove).toHaveBeenCalledWith(FILE_ACCESS_NOTICE_PENDING_KEY);
    });

    test('cleanup removes the storage listener', async () => {
        browser.storage.local.get.mockResolvedValue({});
        cleanup = initFileAccessNoticeWatcher({ isFullPage: true });
        await flush();
        const listener = getChangeListener();

        cleanup();
        cleanup = null;

        expect(browser.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
    });
});
