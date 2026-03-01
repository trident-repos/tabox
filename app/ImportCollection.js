import React from 'react'
import './ImportCollection.css';
import { useSetAtom } from 'jotai';
import { highlightedCollectionUidState } from './atoms/animationsState';
import { showSuccessToast, showErrorToast } from './toastHelpers';
import { browser } from '../static/globals';

import { FaFileImport } from 'react-icons/fa';


function ImportCollection(props) {

    const setHighlightedCollectionUid = useSetAtom(highlightedCollectionUidState);

    const handleFileSelection = async (event) => {
        const file = event.target.files[0];
        if (!event.target.value.endsWith('.txt')) {
            showErrorToast('Invalid file: Please select a .txt file');
            event.target.value = '';
            return;
        }
        
        let reader = new FileReader();
        reader.onload = async function () {
            const result = reader.result;
            
            // More flexible JSON validation
            const trimmedResult = result.trim();
            if (!trimmedResult.startsWith('{') && !trimmedResult.startsWith('[')) {
                showErrorToast('Invalid File: File does not contain valid JSON data');
                event.target.value = '';
                return;
            }
            
            try {
                let parsed = JSON.parse(trimmedResult);
                // Clear file input immediately (fast operation)
                event.target.value = '';
                
                // Delegate import to background script to survive popup close
                // This fixes the bug where imports fail unless Inspect Popup is open
                console.log('[Import UI] Sending import request to background');
                let importResult;
                try {
                    importResult = await browser.runtime.sendMessage({
                        type: 'importData',
                        data: parsed
                    });
                    console.log('[Import UI] Received response:', importResult);
                } catch (msgError) {
                    console.error('[Import UI] Message sending failed:', msgError);
                    showErrorToast('Import failed: Could not communicate with background service - ' + (msgError?.message || 'Unknown error'));
                    return;
                }
                
                if (importResult && importResult.success) {
                    // Refresh UI after successful import
                    if (props.onDataUpdate) {
                        await props.onDataUpdate();
                    } else if (props.updateRemoteData) {
                        const { loadAllCollections } = await import('./utils/storageUtils');
                        const updatedCollections = await loadAllCollections();
                        await props.updateRemoteData(updatedCollections);
                    }
                    
                    // Highlight first imported collection
                    if (importResult.firstCollectionUid) {
                        setHighlightedCollectionUid(importResult.firstCollectionUid);
                    }
                    
                    showSuccessToast(importResult.message);
                } else {
                    const errorMsg = importResult?.error || 'Unknown error during import';
                    console.error('[Import UI] Import failed:', errorMsg, 'Full result:', importResult);
                    showErrorToast('Import failed: ' + errorMsg);
                }
            }
            catch (error) {
                console.error('[Import UI] Parse error:', error);
                showErrorToast('Invalid File: Unable to parse JSON - ' + error.message);
                event.target.value = '';
                return;
            }
        }
        reader.readAsText(file);
    };
    return <span className="image-upload">
            <label htmlFor="file-input" className="input-label">
                <div className="import-button">
                    <FaFileImport style={{ color: 'var(--text-color)' }} className="import-icon" size="16px" /> <span>Import file</span>
                </div>
            </label>
            <input id="file-input" type="file" onChange={handleFileSelection} />
        </span>;
}

export default ImportCollection;