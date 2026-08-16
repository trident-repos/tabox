const { createBrowserHarness } = require('./helpers/browserHarness');

// Context menu audit coverage (right click → "Add tab to Tabox Collection"):
// the menu model must mirror indexed storage exactly — no ghost collections,
// no read-only shared collections, no orphaned (undo-kept) groups — and the
// click routing must resolve group submenu ids correctly.

const T = 1700000000000;

const collection = (uid, name, extra = {}) => ({
    uid,
    name,
    color: '#4fc3f7',
    parentId: null,
    tabs: [{ title: `${name} tab`, url: `https://${uid}.example.com` }],
    chromeGroups: [],
    lastUpdated: T,
    createdOn: T,
    ...extra,
});

describe('context menu background logic', () => {
    let bgUtils;
    let browser;

    beforeEach(() => {
        jest.resetModules();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        browser = createBrowserHarness();
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };
        global.importScripts = jest.fn();
        bgUtils = require('../chrome/background-utils.js');
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
        delete global.importScripts;
    });

    describe('buildContextMenuModel', () => {
        test('returns empty model when there are no collections', () => {
            expect(bgUtils.buildContextMenuModel([], [])).toEqual([]);
        });

        test('builds a flat item per loose collection under the super item', () => {
            const model = bgUtils.buildContextMenuModel(
                [collection('c1', 'Work'), collection('c2', 'Play')],
                []
            );
            expect(model[0]).toMatchObject({ id: 'tabox-super', title: 'Add tab to Tabox Collection' });
            expect(model.map((m) => m.id)).toEqual(['tabox-super', 'c1', 'c2']);
            expect(model[1]).toMatchObject({ title: 'Work', parentId: 'tabox-super' });
        });

        test('excludes collections inside read-only shared folders, keeps write/owner shared ones', () => {
            const folders = [
                { uid: 'f-read', name: 'RO', shared: { folderId: 'f-read', role: 'read' } },
                { uid: 'f-write', name: 'RW', shared: { folderId: 'f-write', role: 'write' } },
                { uid: 'f-own', name: 'Own', shared: { folderId: 'f-own', role: 'owner' } },
                { uid: 'f-plain', name: 'Plain' },
            ];
            const model = bgUtils.buildContextMenuModel([
                collection('c-ro', 'Hidden', { parentId: 'f-read' }),
                collection('c-rw', 'Editable', { parentId: 'f-write' }),
                collection('c-own', 'Owned', { parentId: 'f-own' }),
                collection('c-plain', 'InFolder', { parentId: 'f-plain' }),
                collection('c-loose', 'Loose'),
            ], folders);
            const ids = model.map((m) => m.id);
            expect(ids).not.toContain('c-ro');
            expect(ids).toEqual(expect.arrayContaining(['c-rw', 'c-own', 'c-plain', 'c-loose']));
        });

        test('renders a group submenu only for groups that still have tabs (orphaned undo-groups hidden)', () => {
            const col = collection('c1', 'Grouped', {
                chromeGroups: [
                    { uid: 'g-live', id: 11, title: 'Live' },
                    { uid: 'g-orphan', id: 12, title: 'Orphan' },
                ],
                tabs: [
                    { title: 't', url: 'https://a.example.com', groupUid: 'g-live' },
                    { title: 't2', url: 'https://b.example.com' },
                ],
            });
            const model = bgUtils.buildContextMenuModel([col], []);
            const ids = model.map((m) => m.id);
            expect(ids).toContain('c1-main');
            expect(ids).toContain('c1|g-live');
            expect(ids).not.toContain('c1|g-orphan');
            // Group items are deterministic and parented under the -main entry
            const groupItem = model.find((m) => m.id === 'c1|g-live');
            expect(groupItem).toMatchObject({ title: 'Live', parentId: 'c1-main' });
        });

        test('collection whose groups are all orphaned renders as a flat item', () => {
            const col = collection('c1', 'AllOrphans', {
                chromeGroups: [{ uid: 'g1', id: 1, title: 'Gone' }],
                tabs: [{ title: 't', url: 'https://a.example.com' }],
            });
            const model = bgUtils.buildContextMenuModel([col], []);
            expect(model.map((m) => m.id)).toEqual(['tabox-super', 'c1']);
        });

        test('super item omitted when every collection is read-only shared', () => {
            const folders = [{ uid: 'f', shared: { folderId: 'f', role: 'read' } }];
            const model = bgUtils.buildContextMenuModel([collection('c', 'X', { parentId: 'f' })], folders);
            expect(model).toEqual([]);
        });
    });

    describe('resolveContextMenuClick', () => {
        test('resolves a plain collection id', () => {
            expect(bgUtils.resolveContextMenuClick('c1')).toEqual({ collectionUid: 'c1', groupUid: null });
        });

        test('resolves a group submenu id to collection + group', () => {
            expect(bgUtils.resolveContextMenuClick('c1|g9')).toEqual({ collectionUid: 'c1', groupUid: 'g9' });
        });

        test('ignores structural ids', () => {
            expect(bgUtils.resolveContextMenuClick('tabox-super')).toBeNull();
            expect(bgUtils.resolveContextMenuClick('c1-main')).toBeNull();
            expect(bgUtils.resolveContextMenuClick('c1-title')).toBeNull();
            expect(bgUtils.resolveContextMenuClick('c1-seperator')).toBeNull();
            expect(bgUtils.resolveContextMenuClick(undefined)).toBeNull();
        });
    });

    describe('handleContextMenuClickBG', () => {
        const seed = async (extra = {}) => {
            const col = collection('c1', 'Target', {
                chromeGroups: [{ uid: 'g1', id: 42, title: 'G' }],
                tabs: [{ title: 'existing', url: 'https://x.example.com', groupUid: 'g1' }],
                ...extra,
            });
            await browser.storage.local.set({
                collections_index: { c1: { name: 'Target', parentId: col.parentId || null, order: 0 } },
                collection_c1: col,
            });
            return col;
        };

        test('adds the tab to the collection on a plain item click', async () => {
            await seed();
            const result = await bgUtils.handleContextMenuClickBG(
                { menuItemId: 'c1' },
                { title: 'New tab', url: 'https://new.example.com' }
            );
            expect(result.handled).toBe(true);
            const { collection_c1: saved } = await browser.storage.local.get('collection_c1');
            expect(saved.tabs.map((t) => t.url)).toContain('https://new.example.com');
        });

        test('adds the tab into the clicked group on a group submenu click', async () => {
            await seed();
            const result = await bgUtils.handleContextMenuClickBG(
                { menuItemId: 'c1|g1' },
                { title: 'Grouped tab', url: 'https://grouped.example.com' }
            );
            expect(result.handled).toBe(true);
            const { collection_c1: saved } = await browser.storage.local.get('collection_c1');
            const added = saved.tabs.find((t) => t.url === 'https://grouped.example.com');
            expect(added).toBeTruthy();
            expect(added.groupUid).toBe('g1');
            expect(added.groupId).toBe(42);
        });

        test('appends to the end when the clicked group has no tabs yet', async () => {
            await seed({
                tabs: [
                    { title: 'a', url: 'https://a.example.com' },
                    { title: 'b', url: 'https://b.example.com' },
                ],
            });
            const result = await bgUtils.handleContextMenuClickBG(
                { menuItemId: 'c1|g1' },
                { title: 'c', url: 'https://c.example.com' }
            );
            expect(result.handled).toBe(true);
            const { collection_c1: saved } = await browser.storage.local.get('collection_c1');
            expect(saved.tabs[saved.tabs.length - 1].url).toBe('https://c.example.com');
        });

        test('refuses to add into a collection inside a read-only shared folder', async () => {
            await seed({ parentId: 'f-read' });
            await browser.storage.local.set({
                folders_index: { 'f-read': { name: 'RO', shared: { folderId: 'f-read', role: 'read' } } },
                'folder_f-read': { uid: 'f-read', name: 'RO', shared: { folderId: 'f-read', role: 'read' } },
            });
            const result = await bgUtils.handleContextMenuClickBG(
                { menuItemId: 'c1' },
                { title: 'nope', url: 'https://nope.example.com' }
            );
            expect(result.handled).toBe(false);
            const { collection_c1: saved } = await browser.storage.local.get('collection_c1');
            expect(saved.tabs.map((t) => t.url)).not.toContain('https://nope.example.com');
        });

        test('reports shared membership so the caller can nudge shared sync', async () => {
            await seed({ parentId: 'f-rw' });
            await browser.storage.local.set({
                folders_index: { 'f-rw': { name: 'RW', shared: { folderId: 'f-rw', role: 'write' } } },
                'folder_f-rw': { uid: 'f-rw', name: 'RW', shared: { folderId: 'f-rw', role: 'write' } },
            });
            const result = await bgUtils.handleContextMenuClickBG(
                { menuItemId: 'c1' },
                { title: 'ok', url: 'https://ok.example.com' }
            );
            expect(result).toMatchObject({ handled: true, isShared: true });
        });

        test('no-ops for unknown or structural ids', async () => {
            await seed();
            expect((await bgUtils.handleContextMenuClickBG({ menuItemId: 'tabox-super' }, {})).handled).toBe(false);
            expect((await bgUtils.handleContextMenuClickBG({ menuItemId: 'ghost-uid' }, {})).handled).toBe(false);
        });
    });

    describe('storage-driven rebuild', () => {
        const flush = async (ms) => {
            // fire the debounce timer, then drain the async rebuild's microtasks
            jest.advanceTimersByTime(ms);
            for (let i = 0; i < 50; i++) {
                await Promise.resolve();
            }
        };

        test('a collections storage write triggers a debounced rebuild reflecting current storage', async () => {
            jest.useFakeTimers();
            browser.storage.onChanged.addListener(bgUtils.handleMenuStorageChanged);

            await browser.storage.local.set({
                collections_index: { c1: { name: 'One', parentId: null, order: 0 } },
                collection_c1: collection('c1', 'One'),
            });
            await flush(bgUtils.CONTEXT_MENU_DEBOUNCE_MS + 100);

            expect(browser.contextMenus.removeAll).toHaveBeenCalled();
            const createdIds = browser.contextMenus.create.mock.calls.map(([p]) => p.id);
            expect(createdIds).toEqual(['tabox-super', 'c1']);
        });

        test('deleting a collection removes it from the rebuilt menu', async () => {
            jest.useFakeTimers();
            browser.storage.onChanged.addListener(bgUtils.handleMenuStorageChanged);

            await browser.storage.local.set({
                collections_index: {
                    c1: { name: 'One', parentId: null, order: 0 },
                    c2: { name: 'Two', parentId: null, order: 1 },
                },
                collection_c1: collection('c1', 'One'),
                collection_c2: collection('c2', 'Two'),
            });
            await flush(bgUtils.CONTEXT_MENU_DEBOUNCE_MS + 100);
            browser.contextMenus.create.mockClear();

            // Simulate deleteSingleCollection: drop the record and its index entry
            await browser.storage.local.remove('collection_c2');
            await browser.storage.local.set({
                collections_index: { c1: { name: 'One', parentId: null, order: 0 } },
            });
            await flush(bgUtils.CONTEXT_MENU_DEBOUNCE_MS + 100);

            const createdIds = browser.contextMenus.create.mock.calls.map(([p]) => p.id);
            expect(createdIds).toEqual(['tabox-super', 'c1']);
        });

        test('irrelevant storage keys do not trigger a rebuild', async () => {
            jest.useFakeTimers();
            browser.storage.onChanged.addListener(bgUtils.handleMenuStorageChanged);

            await browser.storage.local.set({ collectionsToTrack: [], localTimestamp: 5, tabsArray: [] });
            await flush(bgUtils.CONTEXT_MENU_DEBOUNCE_MS + 100);

            expect(browser.contextMenus.removeAll).not.toHaveBeenCalled();
            expect(browser.contextMenus.create).not.toHaveBeenCalled();
        });

        test('identical data skips the redundant removeAll/create cycle', async () => {
            jest.useFakeTimers();
            browser.storage.onChanged.addListener(bgUtils.handleMenuStorageChanged);

            await browser.storage.local.set({
                collections_index: { c1: { name: 'One', parentId: null, order: 0 } },
                collection_c1: collection('c1', 'One'),
            });
            await flush(bgUtils.CONTEXT_MENU_DEBOUNCE_MS + 100);
            const removeAllCalls = browser.contextMenus.removeAll.mock.calls.length;
            browser.contextMenus.create.mockClear();

            // Untracked-field churn (e.g. lastUpdated bumps from auto-update)
            await browser.storage.local.set({
                collection_c1: collection('c1', 'One', { lastUpdated: T + 999 }),
            });
            await flush(bgUtils.CONTEXT_MENU_DEBOUNCE_MS + 100);

            expect(browser.contextMenus.removeAll.mock.calls.length).toBe(removeAllCalls);
            expect(browser.contextMenus.create).not.toHaveBeenCalled();
        });
    });
});
