jest.mock('../static/globals', () => ({
    browser: {
        system: {
            display: {
                getInfo: jest.fn(async () => [
                    { bounds: { top: 0, left: 0, width: 1600, height: 900 } },
                ]),
            },
        },
        windows: {
            create: jest.fn(async (options = {}) => ({ id: 101, ...options })),
        },
        runtime: {
            sendMessage: jest.fn(async () => ({ success: true })),
        },
    },
}));

import { browser } from '../static/globals';
import {
    buildCollectionSubsetExport,
    openCollectionsInSequence,
} from '../app/utils/collectionBulkActions';

describe('buildCollectionSubsetExport', () => {
    test('includes only folders referenced by the selected collections', () => {
        const payload = buildCollectionSubsetExport({
            collections: [
                { uid: 'collection-a', name: 'A', parentId: 'folder-1', tabs: [] },
                { uid: 'collection-b', name: 'B', parentId: null, tabs: [] },
            ],
            folders: [
                { uid: 'folder-1', name: 'Folder One' },
                { uid: 'folder-2', name: 'Folder Two' },
            ],
        });

        expect(payload).toEqual(expect.objectContaining({
            type: 'full_export',
            collections: [
                expect.objectContaining({ uid: 'collection-a' }),
                expect.objectContaining({ uid: 'collection-b' }),
            ],
            folders: [
                expect.objectContaining({ uid: 'folder-1' }),
            ],
            stats: expect.objectContaining({
                totalCollections: 2,
                totalFolders: 1,
                collectionsInFolders: 1,
                rootCollections: 1,
            }),
        }));
    });
});

describe('openCollectionsInSequence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('sends createWindowSpec (not a pre-created window) without newWindow, and tracks successes without stamping lastOpened locally', async () => {
        const collections = [
            {
                uid: 'collection-a',
                name: 'Collection A',
                tabs: [],
                window: { top: 10, left: 10, width: 800, height: 600 },
            },
            {
                uid: 'collection-b',
                name: 'Collection B',
                tabs: [],
            },
        ];

        const result = await openCollectionsInSequence(collections);

        // Window creation must happen in the background (driven by
        // createWindowSpec), never here - on Firefox, focusing a brand-new
        // window destroys the calling document before any code after
        // `windows.create()` can run, which is exactly the bug this guards
        // against.
        expect(browser.windows.create).not.toHaveBeenCalled();
        expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(2);
        // `newWindow` must be omitted (not sent as `true`): openTabs() in the
        // background only bypasses its chkIgnoreDuplicates storage lookup when
        // `newWindow` is truthy, so sending `true` here would silently disable
        // the user's "ignore duplicates" setting for this path.
        expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
            type: 'openTabs',
            createWindowSpec: expect.objectContaining({ focused: true }),
        }));
        const [firstCallArgs] = browser.runtime.sendMessage.mock.calls[0];
        expect(firstCallArgs).not.toHaveProperty('newWindow');
        // lastOpened is stamped authoritatively by the background
        // (markCollectionOpenedBG), never re-written here - a popup-side write
        // would double-stamp on Chrome and could clobber a concurrent
        // background auto-update save.
        expect(result.openedCollections).toEqual([
            expect.objectContaining({ uid: 'collection-a' }),
            expect.objectContaining({ uid: 'collection-b' }),
        ]);
        expect(result.openedCollections.some((c) => 'lastOpened' in c)).toBe(false);
        expect(result).toEqual(expect.objectContaining({
            openedCount: 2,
            failedCount: 0,
        }));
    });

    test('records failures without aborting later collections', async () => {
        browser.runtime.sendMessage
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ success: true });

        const result = await openCollectionsInSequence([
            { uid: 'collection-a', name: 'Collection A', tabs: [] },
            { uid: 'collection-b', name: 'Collection B', tabs: [] },
        ]);

        expect(result.failedCollections).toEqual(['Collection A']);
        expect(result.openedCount).toBe(1);
        expect(result.openedCollections).toEqual([
            expect.objectContaining({ uid: 'collection-b' }),
        ]);
    });
});
