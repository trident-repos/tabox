import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useAtomValue } from 'jotai';
import { settingsDataState } from './atoms/globalAppSettingsState';
import AIButton from './AIButton';
import './CollectionListOptions.css';
import { PiGridNineFill } from "react-icons/pi";
import { browser } from '../static/globals';
import { openOrFocusFullPageInCurrentWindow } from './utils/openFullPage';
import Select, { components } from 'react-select';
import {
    MdAccessTime,
    MdArrowUpward,
    MdArrowDownward,
    MdPalette,
    MdOpenInNew,
    MdSortByAlpha,
    MdViewList,
    MdCreateNewFolder,
} from 'react-icons/md';
import { TbFileImport } from 'react-icons/tb';
import { CollectionFilter } from './CollectionFilter';
import { showErrorToast } from './toastHelpers';
import { Tooltip } from 'react-tooltip';
// Lazy load rarely-used modals for better performance
const CreateFolderModal = lazy(() => import('./CreateFolderModal'));


const sortOptions = [
    { value: 'DATE', label: 'Date', icon: MdAccessTime },
    { value: 'NAME', label: 'Name', icon: MdSortByAlpha },
    { value: 'COLOR', label: 'Color', icon: MdPalette }
];

function SortOption(props) {
    const { icon: Icon } = props.data;

    return (
        <components.Option {...props}>
            <div className="toolbar-select-option">
                <Icon size={16} />
                <span>{props.label}</span>
            </div>
        </components.Option>
    );
}

function SortSingleValue(props) {
    const { icon: Icon } = props.data;

    return (
        <components.SingleValue {...props}>
            <div className="toolbar-select-single-value">
                <Icon size={16} />
                <span>{props.data.label}</span>
            </div>
        </components.SingleValue>
    );
}

export function CollectionListOptions(props) {
    const settingsData = useAtomValue(settingsDataState);
    const [sortType, setSortType] = useState('DATE');
    const [sortAscending, setSortAscending] = useState(true);
    const [openInNewWindow, setOpenInNewWindow] = useState(false);
    const [viewMode, setViewMode] = useState('list'); // 'list' or 'grid'
    const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
    const isMountedRef = useRef(true);
    const menuPortalTarget = typeof document !== 'undefined' ? document.body : null;

    useEffect(() => {
        const loadData = async () => {
            try {
                // Load saved preferences - use props.selected if available, otherwise load from storage
                const selectedValue = props.selected || await browser.storage.local.get('currentSortValue').then(result => result.currentSortValue);
                const { chkOpenNewWindow, collectionViewMode, currentSortAscending } = await browser.storage.local.get(['chkOpenNewWindow', 'collectionViewMode', 'currentSortAscending']);
                
                // Only update state if component is still mounted
                if (isMountedRef.current) {
                    if (selectedValue) {
                        setSortType(selectedValue);
                    }
                    // Load ascending/descending preference
                    // Handle both boolean and string values (for backward compatibility)
                    if (currentSortAscending !== undefined) {
                        // Convert string "true"/"false" to boolean if needed
                        const sortAscendingValue = typeof currentSortAscending === 'string' 
                            ? currentSortAscending === 'true' 
                            : currentSortAscending;
                        setSortAscending(sortAscendingValue);
                    } else {
                        // Default to ascending if not set
                        setSortAscending(true);
                    }
                    setOpenInNewWindow(chkOpenNewWindow || false);
                    const loadedViewMode = collectionViewMode || 'list';
                    setViewMode(loadedViewMode);
                    // Sync with parent component
                    if (props.onViewModeChange) {
                        props.onViewModeChange(loadedViewMode);
                    }
                }
            } catch (error) {
                console.error('Error loading CollectionListOptions data:', error);
            }
        };

        loadData();

        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const handleSort = async (sortBy, ascending = sortAscending) => {
        if (!settingsData || settingsData.length === 0) return;

        // CRITICAL: Load ALL collections from storage to ensure we clear order from all of them
        // This includes collections in folders, not just root-level collections
        const { loadAllCollections, loadAllFolders, batchUpdateCollections } = await import('./utils/storageUtils');
        const { isReadOnlySharedFolder } = await import('./utils/sharedFolderUtils');

        // Map sort type to storage field name
        const sortFieldMap = {
            'DATE': 'lastUpdated',
            'NAME': 'name',
            'COLOR': 'color'
        };
        const sortByField = sortFieldMap[sortBy] || 'lastUpdated';
        const sortOrder = ascending ? 'asc' : 'desc';

        // Read-only shared folders are never touched by a global sort - their
        // manual order was set by the folder owner, not this user. Collections
        // that live inside one are excluded from the clearing batch entirely so
        // their `order` field stays exactly as-is.
        const allFolders = props.folders && props.folders.length > 0
            ? props.folders
            : await loadAllFolders();
        const readOnlyFolderUids = new Set(
            allFolders.filter(isReadOnlySharedFolder).map((folder) => folder.uid)
        );
        const isReadOnlyShared = (collection) => Boolean(collection.parentId) && readOnlyFolderUids.has(collection.parentId);

        // Load all collections WITHOUT sort params first to get them all (order might affect sorting)
        const allCollectionsFromStorage = await loadAllCollections({
            metadataOnly: false,
            sortBy: sortByField,
            sortOrder: sortOrder
        });

        // Set order to null for every collection we're allowed to write to
        // (including those in folders). This explicitly signals to
        // batchUpdateCollections to clear the order field, which allows
        // user-selected sorting to take precedence over manual drag-and-drop
        // ordering. Collections inside a read-only shared folder are excluded.
        const collectionsToClear = allCollectionsFromStorage
            .filter((collection) => !isReadOnlyShared(collection))
            .map(collection => ({
                ...collection,
                order: null  // Explicitly set to null to clear manual ordering
            }));

        // Save the writable collections with order=null to storage (will remove order field from index and collection data)
        await batchUpdateCollections(collectionsToClear);

        // Reload collections with the sort preferences to ensure they're in the correct order
        // This ensures that after clearing order fields, collections are sorted by the user's preference
        const reloadedCollections = await loadAllCollections({
            metadataOnly: false,
            sortBy: sortByField,
            sortOrder: sortOrder
        });

        // Update UI with reloaded collections (they should already be sorted correctly).
        // Read-only shared collections are passed through unchanged so their order
        // field is never stripped, even in the data handed to updateRemoteData.
        const cleanedData = reloadedCollections.map((collection) => {
            if (isReadOnlyShared(collection)) return collection;
            const rest = { ...collection };
            delete rest.order;
            return rest;
        });
        await props.updateRemoteData(cleanedData);

        // Save both sort type AND direction
        await browser.storage.local.set({ currentSortValue: sortBy, currentSortAscending: ascending });
    };

    const handleSortTypeChange = async (selectedOption) => {
        if (!isMountedRef.current) return;
        const newSortType = selectedOption.value;
        setSortType(newSortType);
        await handleSort(newSortType, sortAscending);
    };

    const toggleSortDirection = async () => {
        if (!isMountedRef.current) return;
        const newDirection = !sortAscending;
        setSortAscending(newDirection);
        await handleSort(sortType, newDirection);
    };

    const toggleNewWindow = async () => {
        if (!isMountedRef.current) return;
        const newValue = !openInNewWindow;
        setOpenInNewWindow(newValue);
        await browser.storage.local.set({ chkOpenNewWindow: newValue });
    };

    const toggleViewMode = async () => {
        if (!isMountedRef.current) return;
        const newViewMode = viewMode === 'list' ? 'grid' : 'list';
        setViewMode(newViewMode);
        await browser.storage.local.set({ collectionViewMode: newViewMode });
        // Call the parent function to update the view
        if (props.onViewModeChange) {
            props.onViewModeChange(newViewMode);
        }
    };

    const handleFiltersChange = (filters) => {
        if (!isMountedRef.current) return;
        // Pass filters to parent component
        if (props.onFiltersChange) {
            props.onFiltersChange(filters);
        }
    };

    useEffect(() => {
        const openFolder = () => setIsFolderModalOpen(true);
        // Command palette "Import" in the popup routes to the full-page view too
        // (see handleImportClick — the popup cannot survive the OS file dialog).
        const openImport = () => handleImportClick();
        window.addEventListener('tabox:open-create-folder', openFolder);
        window.addEventListener('tabox:open-import', openImport);
        return () => {
            window.removeEventListener('tabox:open-create-folder', openFolder);
            window.removeEventListener('tabox:open-import', openImport);
        };
    }, []);

    const handleCreateFolder = () => {
        setIsFolderModalOpen(true);
    };

    const handleFolderModalClose = () => {
        setIsFolderModalOpen(false);
    };

    const handleFolderSave = async (name, color) => {
        if (props.addFolder) {
            await props.addFolder(name, color);
        }
    };

    // Issue #68/#88/#93: opening a native file picker from the POPUP is fundamentally
    // broken on Edge and Linux Chromium — the OS dialog steals focus, the browser
    // destroys the popup document, and the input's change event never fires, so the
    // import silently dies. A regular tab is immune, and the full-page view already
    // has a complete import path — so the popup's Import always routes there. The
    // full-page view picks up the pending request on mount (FPContentArea) and opens
    // its own file picker.
    const handleImportClick = async () => {
        try {
            await browser.storage.local.set({ pendingImportRequest: Date.now() });
            await openOrFocusFullPageInCurrentWindow();
            window.close();
        } catch (error) {
            console.error('[Import UI] Failed to open full-page import:', error);
            showErrorToast('Import failed: could not open the full-page view');
        }
    };

    const ICON_SIZE = 18; // Reduced from 24 to match smaller buttons

    return (
        <>
            <div className="collections-toolbar-wrapper">
                <div className="collections-toolbar fp-toolbar">
                    <CollectionFilter onFiltersChange={handleFiltersChange} />

                    <div className="fp-toolbar-divider" />

                    <div className="fp-toolbar-group">
                        <div id="toolbar-sort-select" className="toolbar-select-shell">
                            <Select
                                className="toolbar-select"
                                classNamePrefix="toolbar-select"
                                value={sortOptions.find((option) => option.value === sortType)}
                                onChange={handleSortTypeChange}
                                options={sortOptions}
                                isSearchable={false}
                                isClearable={false}
                                components={{
                                    Option: SortOption,
                                    SingleValue: SortSingleValue,
                                }}
                                aria-label="Sort collections"
                                menuPortalTarget={menuPortalTarget}
                                menuPosition="fixed"
                                styles={{
                                    menuPortal: (base) => ({
                                        ...base,
                                        zIndex: 1000001,
                                    }),
                                }}
                            />
                        </div>
                        <button
                            type="button"
                            id="toolbar-sort-direction"
                            className="fp-toolbar-btn"
                            onClick={toggleSortDirection}
                        >
                            {/* Inverted: Up arrow for descending (higher values first), Down arrow for ascending (lower values first) */}
                            {sortAscending ? <MdArrowDownward size={ICON_SIZE} /> : <MdArrowUpward size={ICON_SIZE} />}
                        </button>
                    </div>

                    <div className="fp-toolbar-divider" />

                    <div className="fp-toolbar-group">
                        <button
                            type="button"
                            id="toolbar-open-new-window"
                            className={`fp-toolbar-btn ${openInNewWindow ? 'active' : ''}`}
                            onClick={toggleNewWindow}
                        >
                            <MdOpenInNew size={ICON_SIZE} />
                        </button>
                        <button
                            type="button"
                            id="toolbar-create-folder"
                            className="fp-toolbar-btn"
                            onClick={handleCreateFolder}
                        >
                            <MdCreateNewFolder size={ICON_SIZE} />
                        </button>
                        <button
                            type="button"
                            id="toolbar-view-mode"
                            className="fp-toolbar-btn"
                            onClick={toggleViewMode}
                        >
                            {viewMode === 'list' ? <PiGridNineFill size={ICON_SIZE} /> : <MdViewList size={ICON_SIZE} />}
                        </button>
                        <button
                            type="button"
                            id="toolbar-import"
                            className="fp-toolbar-btn"
                            onClick={handleImportClick}
                            aria-label="Import collections from file"
                        >
                            <TbFileImport size={ICON_SIZE} />
                        </button>
                    </div>

                    <AIButton withDivider />
                </div>
            </div>

            <Suspense fallback={null}>
                <CreateFolderModal
                    isOpen={isFolderModalOpen}
                    onClose={handleFolderModalClose}
                    onSave={handleFolderSave}
                />
            </Suspense>
            <Tooltip
                anchorSelect="#toolbar-sort-direction"
                content={sortAscending ? "Ascending (A→Z, Oldest→Newest)" : "Descending (Z→A, Newest→Oldest)"}
                className="small-tooltip"
                place="bottom"
            />
            <Tooltip
                anchorSelect="#toolbar-sort-select .toolbar-select__control"
                content="Choose how collections are sorted"
                className="small-tooltip"
                place="bottom"
            />
            <Tooltip
                anchorSelect="#toolbar-open-new-window"
                content={openInNewWindow ? "Open collections in new window" : "Open collections in current window"}
                className="small-tooltip"
                place="bottom"
            />
            <Tooltip
                anchorSelect="#toolbar-create-folder"
                content="Create new folder"
                className="small-tooltip"
                place="bottom"
            />
            <Tooltip
                anchorSelect="#toolbar-view-mode"
                content={viewMode === 'list' ? "Switch to grid view" : "Switch to list view"}
                className="small-tooltip"
                place="bottom"
            />
            <Tooltip
                anchorSelect="#toolbar-import"
                content="Import collections or folders"
                className="small-tooltip"
                place="bottom"
            />
        </>
    );
}
