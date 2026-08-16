const { createBrowserHarness } = require('./helpers/browserHarness');

// Regression test for a live Firefox-port bug: chrome/background.js registered
// browser.windows.onRemoved.addListener(fn, { windowTypes: ['normal'] }) — an
// event filter Chrome accepts but Firefox rejects synchronously. IMPORTANT:
// Firefox's real WebExtensions argument validator throws a PLAIN `Error`
// with message "Incorrect argument types for windows.onRemoved." — NOT a
// TypeError. An earlier version of this fix (and this test) wrongly assumed
// TypeError, which made the mock-based test pass while the real Firefox
// build kept throwing (confirmed via the user's live console after rebuild:
// the uncaught error still fired, because `if (!(error instanceof TypeError))
// throw error;` re-threw Firefox's plain Error instead of falling back).
//
// Because the addListener call sits at the top level of background.js, an
// uncaught throw there aborts the entire rest of the script load on Firefox,
// so every listener registered *after* it (windows.onCreated/onFocusChanged/
// onBoundsChanged, all tabs.* events, etc.) never attaches — auto-update,
// badge, and window tracking are silently dead.
//
// The fix wraps the filtered registration in try/catch and falls back to the
// same named callback without the filter on ANY throw (not filtered by error
// type — Firefox's exact error class isn't part of any spec and isn't
// future-proof to depend on). This test simulates Firefox's rejection with a
// mock that throws the real plain-Error shape, then requires background.js
// and asserts it (a) doesn't throw at load, (b) still attaches a working
// listener, and (c) every listener registered after windows.onRemoved in the
// source (windows.onCreated etc.) also attaches — proving the fallback didn't
// just swallow the error but let script execution continue.
describe('windows.onRemoved Firefox filter fallback', () => {
    let browser;

    // errorFactory lets each test.each case supply the exact error shape to
    // throw — real Firefox throws a plain Error (not TypeError), which is the
    // case that matters; TypeError is kept as a secondary case since the fix
    // must not regress if a browser ever throws that instead.
    const makeFirefoxStyleOnRemoved = (errorFactory) => {
        const listeners = [];
        return {
            addListener: jest.fn((listener, filter) => {
                if (filter !== undefined) {
                    throw errorFactory();
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

    const ERROR_SHAPES = {
        'plain Error (real Firefox behavior)': () => new Error('Incorrect argument types for windows.onRemoved.'),
        'TypeError (defensive secondary case)': () => new TypeError('Incorrect argument types for windows.onRemoved.')
    };

    beforeEach(() => {
        jest.resetModules();

        browser = createBrowserHarness();

        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
    });

    afterEach(() => {
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
    });

    describe.each(Object.entries(ERROR_SHAPES))('when the filtered call throws %s', (_label, errorFactory) => {
        beforeEach(() => {
            browser.windows.onRemoved = makeFirefoxStyleOnRemoved(errorFactory);
        });

        test('background.js loads without throwing', () => {
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
    });

    test('if even the unfiltered fallback registration throws, there is no further fallback to swallow it', () => {
        // background.js's whole top-level body (including this listener
        // registration block) already runs inside one big pre-existing
        // try/catch (the same one that logs any other startup failure), so a
        // throw from the unfiltered fallback doesn't crash the whole script —
        // it's caught there, same as any other unexpected startup error would
        // be. What matters for this fix is that our own try/catch has no
        // *second* fallback path silently swallowing it before that point.
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const thrown = new Error('Incorrect argument types for windows.onRemoved.');
        browser.windows.onRemoved = {
            addListener: jest.fn(() => {
                throw thrown;
            })
        };

        expect(() => require('../chrome/background.js')).not.toThrow();
        expect(browser.windows.onRemoved.addListener).toHaveBeenCalledTimes(2);
        expect(consoleErrorSpy).toHaveBeenCalledWith(thrown);

        consoleErrorSpy.mockRestore();
    });

    test('on Chrome (filter accepted), only the filtered registration happens — no behavior change', () => {
        // Plain createEventMock() never throws, matching real Chrome behavior.
        browser.windows.onRemoved = require('./helpers/browserHarness').createEventMock();

        require('../chrome/background.js');

        expect(browser.windows.onRemoved.addListener).toHaveBeenCalledTimes(1);
        expect(browser.windows.onRemoved.addListener.mock.calls[0][1]).toEqual({ windowTypes: ['normal'] });
    });
});
