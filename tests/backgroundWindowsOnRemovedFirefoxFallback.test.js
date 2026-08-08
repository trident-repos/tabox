const { createBrowserHarness } = require('./helpers/browserHarness');

// Regression test for a live Firefox-port bug: chrome/background.js registered
// browser.windows.onRemoved.addListener(fn, { windowTypes: ['normal'] }) — an
// event filter Chrome accepts but Firefox rejects synchronously with
// `Error: Incorrect argument types for windows.onRemoved`. Because that
// addListener call sits at the top level of background.js, the throw aborted
// the entire script load on Firefox, so every listener registered *after* it
// (windows.onCreated/onFocusChanged/onBoundsChanged, all tabs.* events, etc.)
// never attached — auto-update, badge, and window tracking were silently dead.
//
// The fix wraps the filtered registration in try/catch and, on TypeError,
// re-registers the same named callback without the filter argument. This
// simulates Firefox's rejection by making the harness's windows.onRemoved
// mock throw a TypeError whenever addListener is called with a filter arg
// (real webextension-polyfill/Firefox behavior), then requires background.js
// and asserts it (a) doesn't throw at load, (b) still attaches a working
// listener, and (c) every listener registered after windows.onRemoved in the
// source (windows.onCreated etc.) also attaches — proving the fallback didn't
// just swallow the error but let script execution continue.
describe('windows.onRemoved Firefox filter fallback', () => {
    let browser;

    const makeFirefoxStyleOnRemoved = () => {
        const listeners = [];
        return {
            addListener: jest.fn((listener, filter) => {
                if (filter !== undefined) {
                    throw new TypeError('Incorrect argument types for windows.onRemoved');
                }
                listeners.push(listener);
            }),
            trigger: async (...args) => {
                for (const listener of listeners) {
                    await listener(...args);
                }
            },
            _listeners: listeners
        };
    };

    beforeEach(() => {
        jest.resetModules();

        browser = createBrowserHarness();
        browser.windows.onRemoved = makeFirefoxStyleOnRemoved();

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
    });

    test('background.js loads without throwing when the filtered call is rejected', () => {
        expect(() => require('../chrome/background.js')).not.toThrow();
    });

    test('falls back to registering the same callback without the filter', () => {
        require('../chrome/background.js');

        // First call: with the filter, which this harness rejects like Firefox.
        // Second call: the fallback, with no filter argument at all.
        expect(browser.windows.onRemoved.addListener).toHaveBeenCalledTimes(2);
        expect(browser.windows.onRemoved.addListener.mock.calls[0][1]).toEqual({ windowTypes: ['normal'] });
        expect(browser.windows.onRemoved.addListener.mock.calls[1][1]).toBeUndefined();

        // Both calls register the exact same function reference (one shared
        // named callback), not two separately-defined closures.
        const [firstCallback] = browser.windows.onRemoved.addListener.mock.calls[0];
        const [secondCallback] = browser.windows.onRemoved.addListener.mock.calls[1];
        expect(secondCallback).toBe(firstCallback);
        expect(browser.windows.onRemoved._listeners).toEqual([firstCallback]);
    });

    test('the fallback-registered listener still prunes collectionsToTrack by windowId', async () => {
        browser.storage.local._data = browser.storage.local._data || {};
        await browser.storage.local.set({
            collectionsToTrack: [
                { uid: 'c1', windowId: 1 },
                { uid: 'c2', windowId: 2 }
            ]
        });

        require('../chrome/background.js');

        await browser.windows.onRemoved.trigger(1);

        const { collectionsToTrack } = await browser.storage.local.get('collectionsToTrack');
        expect(collectionsToTrack).toEqual([{ uid: 'c2', windowId: 2 }]);
    });

    test('listeners registered after windows.onRemoved in background.js still attach (script execution continues)', () => {
        require('../chrome/background.js');

        expect(browser.windows.onCreated.addListener).toHaveBeenCalled();
        expect(browser.windows.onFocusChanged.addListener).toHaveBeenCalled();
        expect(browser.tabs.onCreated.addListener).toHaveBeenCalled();
        expect(browser.tabs.onRemoved.addListener).toHaveBeenCalled();
    });

    test('on Chrome (filter accepted), only the filtered registration happens — no behavior change', () => {
        // Plain createEventMock() never throws, matching real Chrome behavior.
        browser.windows.onRemoved = require('./helpers/browserHarness').createEventMock();

        require('../chrome/background.js');

        expect(browser.windows.onRemoved.addListener).toHaveBeenCalledTimes(1);
        expect(browser.windows.onRemoved.addListener.mock.calls[0][1]).toEqual({ windowTypes: ['normal'] });
    });
});
