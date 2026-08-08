import { STORAGE_KEYS, CURRENT_STORAGE_VERSION, generateUid, safeFavIconUrl, FALLBACK_FAVICON } from '../app/utils/sharedConstants';

describe('STORAGE_KEYS', () => {
    test('contains expected storage key constants', () => {
        expect(STORAGE_KEYS.COLLECTIONS_INDEX).toBe('collections_index');
        expect(STORAGE_KEYS.FOLDERS_INDEX).toBe('folders_index');
        expect(STORAGE_KEYS.LEGACY_TABS_ARRAY).toBe('tabsArray');
        expect(STORAGE_KEYS.DELETED_COLLECTION_TOMBSTONES).toBe('deleted_collection_tombstones');
        expect(STORAGE_KEYS.COLLECTION_PREFIX).toBe('collection_');
        expect(STORAGE_KEYS.FOLDER_PREFIX).toBe('folder_');
        expect(STORAGE_KEYS.STORAGE_VERSION).toBe('tabox_storage_version');
    });

    test('has all expected keys', () => {
        const expectedKeys = [
            'COLLECTIONS_INDEX',
            'FOLDERS_INDEX',
            'LEGACY_TABS_ARRAY',
            'DELETED_COLLECTION_TOMBSTONES',
            'DELETED_FOLDER_TOMBSTONES',
            'COLLECTION_PREFIX',
            'FOLDER_PREFIX',
            'STORAGE_VERSION'
        ];
        
        expect(Object.keys(STORAGE_KEYS).sort()).toEqual(expectedKeys.sort());
    });
});

describe('CURRENT_STORAGE_VERSION', () => {
    test('is a number', () => {
        expect(typeof CURRENT_STORAGE_VERSION).toBe('number');
    });

    test('is version 3', () => {
        expect(CURRENT_STORAGE_VERSION).toBe(3);
    });
});

describe('generateUid', () => {
    test('returns a string', () => {
        const result = generateUid();
        
        expect(typeof result).toBe('string');
    });

    test('returns non-empty string', () => {
        const result = generateUid();
        
        expect(result.length).toBeGreaterThan(0);
    });

    test('generates unique IDs on subsequent calls', () => {
        const uid1 = generateUid();
        const uid2 = generateUid();
        const uid3 = generateUid();
        
        expect(uid1).not.toBe(uid2);
        expect(uid2).not.toBe(uid3);
        expect(uid1).not.toBe(uid3);
    });

    test('generates IDs of reasonable length', () => {
        const result = generateUid();

        // UUID format is typically 36 chars, random fallback is shorter but still substantial
        expect(result.length).toBeGreaterThanOrEqual(10);
    });
});

// Regression: Firefox reports privileged-page favIconUrl values like
// chrome://mozapps/skin/extensions/extension.svg, and Chrome-authored
// collections synced/imported from older builds can carry chrome:// favicons
// too. Extension pages (moz-extension://... / chrome-extension://...) are not
// allowed to load chrome:// images, which throws a Security Error at render
// time in Firefox. safeFavIconUrl() is the single render-time guard used at
// every favicon <img src> site.
describe('safeFavIconUrl', () => {
    test('passes through http: URLs', () => {
        expect(safeFavIconUrl('http://example.com/favicon.ico')).toBe('http://example.com/favicon.ico');
    });

    test('passes through https: URLs', () => {
        expect(safeFavIconUrl('https://example.com/favicon.ico')).toBe('https://example.com/favicon.ico');
    });

    test('passes through data: URLs', () => {
        const dataUrl = 'data:image/png;base64,aGVsbG8=';
        expect(safeFavIconUrl(dataUrl)).toBe(dataUrl);
    });

    test('falls back for chrome: URLs', () => {
        expect(safeFavIconUrl('chrome://mozapps/skin/extensions/extension.svg')).toBe(FALLBACK_FAVICON);
    });

    test('falls back for about: URLs', () => {
        expect(safeFavIconUrl('about:blank')).toBe(FALLBACK_FAVICON);
    });

    test('falls back for moz-extension: URLs', () => {
        expect(safeFavIconUrl('moz-extension://abc-123/icon.png')).toBe(FALLBACK_FAVICON);
    });

    test('falls back for javascript: URLs', () => {
        expect(safeFavIconUrl('javascript:alert(1)')).toBe(FALLBACK_FAVICON);
    });

    test('falls back for garbage/unparsable input', () => {
        expect(safeFavIconUrl('not a url')).toBe(FALLBACK_FAVICON);
    });

    test('falls back for empty string, null, and undefined', () => {
        expect(safeFavIconUrl('')).toBe(FALLBACK_FAVICON);
        expect(safeFavIconUrl(null)).toBe(FALLBACK_FAVICON);
        expect(safeFavIconUrl(undefined)).toBe(FALLBACK_FAVICON);
    });

    test('respects a custom fallback (e.g. null, to conditionally skip rendering)', () => {
        expect(safeFavIconUrl('chrome://mozapps/skin/extensions/extension.svg', null)).toBeNull();
        expect(safeFavIconUrl('https://example.com/favicon.ico', null)).toBe('https://example.com/favicon.ico');
    });
});
