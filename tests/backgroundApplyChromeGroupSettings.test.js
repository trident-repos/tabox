// tests/backgroundApplyChromeGroupSettings.test.js
import { browser } from '../static/globals';
import { applyChromeGroupSettings } from '../chrome/background-utils';

describe('applyChromeGroupSettings', () => {
    beforeEach(() => {
        browser.tabs.group = jest.fn().mockResolvedValue(900);
        browser.tabGroups.update = jest.fn().mockResolvedValue();
        browser.tabGroups.query = jest.fn().mockResolvedValue([]);
    });

    test('groups tabs by groupUid even when numeric groupId has drifted', async () => {
        // Session ids drift after sync/merge/import — or a UI drag wrote the uid
        // string into groupId — so only groupUid still ties tabs to their group.
        const collection = {
            chromeGroups: [
                { id: 42, uid: 'group-uid-1', title: 'Work', color: 'blue', collapsed: false },
            ],
            tabs: [
                { newTabId: 1, groupUid: 'group-uid-1', groupId: 9999 },
                { newTabId: 2, groupUid: 'group-uid-1', groupId: 'group-uid-1' },
                { newTabId: 3, groupUid: 'other-uid', groupId: 42 },
            ],
        };

        await applyChromeGroupSettings(100, collection);

        expect(browser.tabs.group).toHaveBeenCalledWith({
            createProperties: { windowId: 100 },
            tabIds: [1, 2],
        });
        expect(browser.tabGroups.update).toHaveBeenCalledWith(900, {
            collapsed: false,
            color: 'blue',
            title: 'Work',
        });
    });

    test('falls back to numeric groupId for legacy tabs without groupUid', async () => {
        const collection = {
            chromeGroups: [
                { id: 42, uid: 'group-uid-1', title: 'Legacy', color: 'red', collapsed: true },
            ],
            tabs: [
                { newTabId: 4, groupId: 42 },
                { newTabId: 5, groupId: -1 },
            ],
        };

        await applyChromeGroupSettings(100, collection);

        expect(browser.tabs.group).toHaveBeenCalledWith({
            createProperties: { windowId: 100 },
            tabIds: [4],
        });
        expect(browser.tabGroups.update).toHaveBeenCalledWith(900, {
            collapsed: true,
            color: 'red',
            title: 'Legacy',
        });
    });

    test('falls back to groupId when the group record itself lacks a uid', async () => {
        const collection = {
            chromeGroups: [
                { id: 7, title: 'Old group', color: 'green', collapsed: false },
            ],
            tabs: [
                { newTabId: 6, groupUid: 'stale-uid', groupId: 7 },
            ],
        };

        await applyChromeGroupSettings(100, collection);

        expect(browser.tabs.group).toHaveBeenCalledWith({
            createProperties: { windowId: 100 },
            tabIds: [6],
        });
    });
});
