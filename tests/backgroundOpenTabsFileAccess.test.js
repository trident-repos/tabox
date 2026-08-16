const { createBrowserHarness } = require('./helpers/browserHarness');

// Chrome rejects tabs.create() with a file:// URL unless the user enables
// "Allow access to file URLs" in the extension's details page. Collections
// containing file:// tabs used to silently drop those tabs into `tabsFailed`
// with no explanation. openTabs now checks
// browser.extension.isAllowedFileSchemeAccess() up front and reports the
// skipped tabs via `skippedForFileAccess` (mirroring skippedForIncognito) so
// the UI can explain how to enable the permission.
describe('background openTabs file:// access detection', () => {
    let browser;
    let bgUtils;

    const seedCollection = async (uid, tabs) => {
        await bgUtils.saveSingleCollectionBG({
            uid,
            name: `Collection ${uid}`,
            tabs,
            chromeGroups: [],
            lastOpened: null
        }, true);
        return bgUtils.loadSingleCollectionBG(uid);
    };

    const openInPrecreatedWindow = (collection, windowOverrides = {}) => browser.runtime.sendMessage({
        type: 'openTabs',
        collection,
        window: { id: 300, incognito: false, tabs: [{ id: 1, url: 'about:blank' }], ...windowOverrides },
        newWindow: true,
        trackOpenedWindow: true
    });

    beforeEach(() => {
        jest.resetModules();

        // applyChromeGroupSettings is out of scope for these tests; background.js
        // catches and logs its absence via console.error.
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        browser = createBrowserHarness();

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();

        bgUtils = require('../chrome/background-utils.js');
        Object.entries(bgUtils).forEach(([key, value]) => {
            if (typeof value === 'function') {
                global[key] = value;
            }
        });

        require('../chrome/background.js');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        Object.keys(bgUtils || {}).forEach((key) => {
            if (typeof global[key] === 'function') {
                delete global[key];
            }
        });
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
    });

    test('skips file:// tabs and reports skippedForFileAccess when access is disabled, still opening the rest', async () => {
        browser.extension.isAllowedFileSchemeAccess.mockResolvedValue(false);

        const seeded = await seedCollection('collection-file-blocked', [
            { url: 'https://example.com', title: 'Example' },
            { url: 'file:///Users/me/notes.html', title: 'Notes' },
            { url: 'FILE:///Users/me/report.pdf', title: 'Report' }
        ]);

        const result = await openInPrecreatedWindow(seeded);

        expect(browser.extension.isAllowedFileSchemeAccess).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(true);
        expect(result.tabsFailed).toBe(0);
        expect(result.skippedForFileAccess).toBe(2);
        expect(result.skippedFileAccessReason).toBe('file-access-disabled');

        // No tabs.create/update call may carry a file:// URL (case-insensitive).
        const attemptedUrls = [
            ...browser.tabs.create.mock.calls.map(([props]) => props.url),
            ...browser.tabs.update.mock.calls.map(([, props]) => props?.url)
        ].filter(Boolean);
        expect(attemptedUrls.some((url) => url.toLowerCase().startsWith('file://'))).toBe(false);
        expect(attemptedUrls).toContain('https://example.com');

        // The popup is usually dead by the time the result lands (focus shifted
        // to the opened tabs), so the background must also persist a pending
        // notice for the next live view to pick up.
        expect(browser.storage.local._data.fileAccessNoticePending).toEqual(
            expect.objectContaining({ count: 2 })
        );
    });

    test('does not persist the pending notice when the user dismissed it, but still skips the tabs', async () => {
        browser.extension.isAllowedFileSchemeAccess.mockResolvedValue(false);
        await browser.storage.local.set({ fileAccessNoticeDismissed: true });

        const seeded = await seedCollection('collection-file-dismissed', [
            { url: 'file:///Users/me/notes.html', title: 'Notes' },
            { url: 'https://example.com', title: 'Example' }
        ]);

        const result = await openInPrecreatedWindow(seeded);

        expect(result.skippedForFileAccess).toBe(1);
        expect(browser.storage.local._data.fileAccessNoticePending).toBeUndefined();
    });

    test('opens file:// tabs normally and reports zero skips when access is allowed', async () => {
        browser.extension.isAllowedFileSchemeAccess.mockResolvedValue(true);

        const seeded = await seedCollection('collection-file-allowed', [
            { url: 'https://example.com', title: 'Example' },
            { url: 'file:///Users/me/notes.html', title: 'Notes' }
        ]);

        const result = await openInPrecreatedWindow(seeded);

        expect(result.skippedForFileAccess).toBe(0);
        expect(result.skippedFileAccessReason).toBeNull();
        expect(browser.storage.local._data.fileAccessNoticePending).toBeUndefined();
        const attemptedUrls = [
            ...browser.tabs.create.mock.calls.map(([props]) => props.url),
            ...browser.tabs.update.mock.calls.map(([, props]) => props?.url)
        ].filter(Boolean);
        expect(attemptedUrls).toContain('file:///Users/me/notes.html');
    });

    test('does not call isAllowedFileSchemeAccess at all for collections without file:// tabs', async () => {
        const seeded = await seedCollection('collection-no-files', [
            { url: 'https://example.com', title: 'Example' },
            { url: 'https://example.org', title: 'Example Org' }
        ]);

        const result = await openInPrecreatedWindow(seeded);

        expect(browser.extension.isAllowedFileSchemeAccess).not.toHaveBeenCalled();
        expect(result.skippedForFileAccess).toBe(0);
    });

    test('attempts the open (current behavior) when the access check throws, rather than silently withholding tabs', async () => {
        browser.extension.isAllowedFileSchemeAccess.mockRejectedValue(new Error('nope'));

        const seeded = await seedCollection('collection-file-check-error', [
            { url: 'file:///Users/me/notes.html', title: 'Notes' }
        ]);

        const result = await openInPrecreatedWindow(seeded);

        expect(result.skippedForFileAccess).toBe(0);
        const attemptedUrls = [
            ...browser.tabs.create.mock.calls.map(([props]) => props.url),
            ...browser.tabs.update.mock.calls.map(([, props]) => props?.url)
        ].filter(Boolean);
        expect(attemptedUrls).toContain('file:///Users/me/notes.html');
    });

    test('in incognito windows file:// tabs count as incognito skips, never double-counted as file-access skips', async () => {
        browser.extension.isAllowedFileSchemeAccess.mockResolvedValue(false);

        const seeded = await seedCollection('collection-file-incognito', [
            { url: 'https://example.com', title: 'Example' },
            { url: 'file:///Users/me/notes.html', title: 'Notes' }
        ]);

        const result = await openInPrecreatedWindow(seeded, { incognito: true });

        expect(result.skippedForIncognito).toBe(1);
        expect(result.skippedForFileAccess).toBe(0);
    });
});
