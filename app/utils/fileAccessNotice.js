import { browser } from '../../static/globals';
import { showInfoToast } from '../toastHelpers';

// Storage flag set when the user clicks "Don't show again" on the file-access
// notice — same one-shot dismiss pattern as orphanRecoveryModalDismissed.
export const FILE_ACCESS_NOTICE_DISMISSED_KEY = 'fileAccessNoticeDismissed';

const isFirefox = () => browser.runtime.getURL('').startsWith('moz-extension://');
const isEdge = () => typeof navigator !== 'undefined' && navigator.userAgent.includes('Edg/');

export const getFileAccessNoticeMessage = (skippedCount) => {
    const tabsLabel = `${skippedCount} local file tab${skippedCount === 1 ? '' : 's'}`;
    if (isFirefox()) {
        return `${tabsLabel} skipped — Firefox doesn't let extensions open file:// links. Open them manually from the collection.`;
    }
    const extensionsPage = isEdge() ? 'edge://extensions' : 'chrome://extensions';
    return `${tabsLabel} skipped — the browser blocks file:// links until you enable "Allow access to file URLs" for Tabox (${extensionsPage} → Tabox → Details).`;
};

// Opens the extension's own details page, where the "Allow access to file URLs"
// switch lives. Chromium only — Firefox has no equivalent switch.
export const openExtensionSettingsPage = async () => {
    const extensionsPage = isEdge() ? 'edge://extensions' : 'chrome://extensions';
    await browser.tabs.create({ url: `${extensionsPage}/?id=${browser.runtime.id}` });
};

/**
 * Shows the "local file tabs were skipped" notice, unless the user dismissed it
 * with "Don't show again". Called from openCollectionTabs — the shared open path
 * for both the popup and the full-page view.
 * @param {number} skippedCount - result.skippedForFileAccess from the background
 */
export const maybeShowFileAccessNotice = async (skippedCount) => {
    if (!skippedCount || skippedCount <= 0) return false;

    const stored = await browser.storage.local.get(FILE_ACCESS_NOTICE_DISMISSED_KEY);
    if (stored?.[FILE_ACCESS_NOTICE_DISMISSED_KEY]) return false;

    const actions = [];
    if (!isFirefox()) {
        actions.push({ label: 'Open settings', onClick: openExtensionSettingsPage });
    }
    actions.push({
        label: "Don't show again",
        onClick: () => browser.storage.local.set({ [FILE_ACCESS_NOTICE_DISMISSED_KEY]: true }),
    });

    showInfoToast(getFileAccessNoticeMessage(skippedCount), 12000, {
        title: 'Local file tabs skipped',
        actions,
    });
    return true;
};
