import { browser } from '../../static/globals';
import { batchUpdateCollections } from './storageUtils';
import { getDisplayInfo } from './displayInfo';

const hasVisibleIntersection = (targetBounds, displayBounds) => {
    const intersection = {
        top: Math.max(displayBounds.top, targetBounds.top),
        left: Math.max(displayBounds.left, targetBounds.left),
        bottom: Math.min(displayBounds.top + displayBounds.height, targetBounds.top + targetBounds.height),
        right: Math.min(displayBounds.left + displayBounds.width, targetBounds.left + targetBounds.width),
    };

    const width = intersection.right - intersection.left;
    const height = intersection.bottom - intersection.top;

    if (width <= 0 || height <= 0) {
        return false;
    }

    return (width * height) / (targetBounds.width * targetBounds.height) >= 0.5;
};

const buildWindowCreationObject = (collection, displays = []) => {
    let windowCreationObject = { focused: true };

    if (!collection?.window) {
        return windowCreationObject;
    }

    const targetBounds = {
        top: Math.round(collection.window.top),
        left: Math.round(collection.window.left),
        width: Math.round(collection.window.width),
        height: Math.round(collection.window.height),
    };

    const isPositionValid = displays.some((display) => hasVisibleIntersection(targetBounds, display.bounds));

    if (isPositionValid) {
        return { ...windowCreationObject, ...targetBounds };
    }

    return {
        ...windowCreationObject,
        width: targetBounds.width,
        height: targetBounds.height,
    };
};

export const openCollectionsInSequence = async (collections = []) => {
    const openedCollections = [];
    const failedCollections = [];
    const displays = await getDisplayInfo();

    for (const collection of collections) {
        try {
            // Send createWindowSpec (not a pre-created window) so the background
            // creates the window and opens the tabs atomically - on Firefox,
            // focusing a brand-new window destroys the calling document (popup or
            // full page) immediately, so any code after `windows.create()`
            // (including the old `sendMessage` call) would never run, leaving a
            // blank window. NOTE: for this multi-collection loop, the caller may
            // still die on Firefox right after the FIRST window opens. The
            // remaining collections still open correctly (the work is driven by
            // background messages), but this loop's own bookkeeping
            // (openedCollections/failedCollections, the batchUpdateCollections
            // call below) may not run to completion. Acceptable for now - Chrome
            // is unaffected.
            await browser.runtime.sendMessage({
                type: 'openTabs',
                collection,
                createWindowSpec: buildWindowCreationObject(collection, displays),
                newWindow: true,
            });
            openedCollections.push({
                ...collection,
                lastOpened: Date.now(),
            });
        } catch {
            failedCollections.push(collection?.name || 'Untitled Collection');
        }
    }

    if (openedCollections.length > 0) {
        await batchUpdateCollections(openedCollections);
    }

    return {
        openedCollections,
        failedCollections,
        openedCount: openedCollections.length,
        failedCount: failedCollections.length,
    };
};

export const buildCollectionSubsetExport = ({
    collections = [],
    folders = [],
} = {}) => {
    const folderIds = new Set(
        collections
            .map((collection) => collection?.parentId || null)
            .filter(Boolean),
    );

    const referencedFolders = folders.filter((folder) => folderIds.has(folder.uid));

    return {
        type: 'full_export',
        collections,
        folders: referencedFolders,
        exportedAt: new Date().toISOString(),
        version: '2.0',
        stats: {
            totalCollections: collections.length,
            totalFolders: referencedFolders.length,
            collectionsInFolders: collections.filter((collection) => !!collection.parentId).length,
            rootCollections: collections.filter((collection) => !collection.parentId).length,
        },
    };
};
