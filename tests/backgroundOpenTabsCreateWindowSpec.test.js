const { createBrowserHarness } = require('./helpers/browserHarness');

// Regression coverage for the Firefox "blank window" bug: opening a collection
// into a new window used to have the POPUP call `browser.windows.create()`
// itself and only afterwards send the `openTabs` message. On Firefox, the new
// window taking focus destroys the popup document immediately, so the
// `sendMessage` call never ran and the window was left blank. The fix moves
// window creation into the background `openTabs` handler: the popup now sends
// a `createWindowSpec` (the old windowCreationObject) INSTEAD OF a
// pre-created `window`, and the background creates the window - including the
// incognito fallback previously done popup-side - before opening the tabs, all
// within a single message round-trip that starts before any window exists.
describe('background openTabs handles createWindowSpec (new-window path owned by the background)', () => {
    let browser;
    let bgUtils;

    beforeEach(() => {
        jest.resetModules();

        // postOpenTasks logs an expected console.error here: the harness does not
        // define applyChromeGroupSettings (chrome-group handling is out of scope
        // for these tests), and background.js catches and logs that failure.
        jest.spyOn(console, 'error').mockImplementation(() => {});

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

    test('creates the window from createWindowSpec, opens the tabs, and returns the same result shape as the pre-created-window path', async () => {
        require('../chrome/background.js');

        await bgUtils.saveSingleCollectionBG({
            uid: 'collection-new-window',
            name: 'New Window Collection',
            tabs: [
                { url: 'https://example.com', title: 'Example' },
                { url: 'https://example.org', title: 'Example Org' }
            ],
            chromeGroups: [],
            lastOpened: null
        }, true);

        const seeded = await bgUtils.loadSingleCollectionBG('collection-new-window');

        const before = Date.now();
        const result = await browser.runtime.sendMessage({
            type: 'openTabs',
            collection: seeded,
            createWindowSpec: { focused: true },
            newWindow: true,
            trackOpenedWindow: true
        });
        const after = Date.now();

        // browser.windows.create is the harness default mock, seeding a single
        // about:blank starter tab - background.js must have called it itself,
        // then queried the new window's tabs to populate `window.tabs` before
        // handing off into the existing openTabs flow.
        expect(browser.windows.create).toHaveBeenCalledWith(expect.objectContaining({ focused: true }));
        expect(browser.tabs.query).toHaveBeenCalledWith(expect.objectContaining({ windowId: expect.any(Number) }));

        expect(result).toEqual(expect.objectContaining({
            success: true,
            tabsOpened: expect.any(Number),
            tabsFailed: expect.any(Number),
            skippedForIncognito: 0,
            wasFromIncognito: false
        }));
        expect(result.tabsOpened).toBeGreaterThan(0);

        const updated = await bgUtils.loadSingleCollectionBG('collection-new-window');
        expect(updated.lastOpened).toBeGreaterThanOrEqual(before);
        expect(updated.lastOpened).toBeLessThanOrEqual(after);
    });

    test('falls back to a normal window when incognito window creation fails, warns, and still opens tabs', async () => {
        require('../chrome/background.js');
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        await bgUtils.saveSingleCollectionBG({
            uid: 'collection-incognito-fallback',
            name: 'Incognito Fallback Collection',
            tabs: [{ url: 'https://example.com', title: 'Example' }],
            chromeGroups: [],
            savedFromIncognito: true,
            lastOpened: null
        }, true);
        const seeded = await bgUtils.loadSingleCollectionBG('collection-incognito-fallback');

        browser.windows.create
            .mockRejectedValueOnce(new Error('incognito blocked'))
            .mockResolvedValueOnce({ id: 555, tabs: [{ id: 1, url: 'about:blank' }] });

        const result = await browser.runtime.sendMessage({
            type: 'openTabs',
            collection: seeded,
            createWindowSpec: { focused: true, incognito: true },
            newWindow: true,
            trackOpenedWindow: true
        });

        expect(browser.windows.create).toHaveBeenCalledTimes(2);
        expect(browser.windows.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ incognito: true }));
        expect(browser.windows.create).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ incognito: true }));
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Failed to create incognito window'),
            expect.any(Error)
        );
        expect(result.wasFromIncognito).toBe(true);
        expect(result.isIncognitoWindow).toBe(false);
        expect(result.restoredToIncognito).toBe(false);

        const updated = await bgUtils.loadSingleCollectionBG('collection-incognito-fallback');
        expect(typeof updated.lastOpened).toBe('number');

        warnSpy.mockRestore();
    });

    test('a pre-created window (no createWindowSpec) still works exactly as before, for backward compatibility with any other caller', async () => {
        require('../chrome/background.js');

        await bgUtils.saveSingleCollectionBG({
            uid: 'collection-precreated-window',
            name: 'Precreated Window Collection',
            tabs: [{ url: 'https://example.com', title: 'Example' }],
            chromeGroups: [],
            lastOpened: null
        }, true);
        const seeded = await bgUtils.loadSingleCollectionBG('collection-precreated-window');

        browser.windows.create.mockClear();

        const result = await browser.runtime.sendMessage({
            type: 'openTabs',
            collection: seeded,
            window: { id: 300, incognito: false, tabs: [{ id: 1, url: 'about:blank' }] },
            newWindow: true,
            trackOpenedWindow: true
        });

        expect(browser.windows.create).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
    });
});
