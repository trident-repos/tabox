import React, { Activity } from 'react';
import Modal from 'react-modal';
import { MdClose, MdOpenInNew } from 'react-icons/md';
import { TbFileImport } from 'react-icons/tb';
import './Modal.css';

// Shown when importing from the popup cannot work reliably (Firefox, and any
// browser on Linux): the OS file dialog steals focus and the browser destroys
// the popup document before a file can be picked (issue #68). Import from the
// full-page view — a regular tab — is unaffected.
function ImportFullPageModal({ isOpen, onClose, onOpenFullPage }) {
    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            contentLabel="Import requires the full page view"
            className="modal-content import-fullpage-modal"
            overlayClassName="modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
        >
            <Activity mode={isOpen ? 'visible' : 'hidden'}>
                <div className="modal-card">
                    <div className="modal-card-content">
                        <div className="modal-card-header">
                            <TbFileImport size={20} style={{ marginRight: '8px', verticalAlign: 'text-bottom' }} />
                            <span>Import from file</span>
                            <button
                                className="import-fullpage-modal-close"
                                onClick={onClose}
                                type="button"
                                aria-label="Close"
                                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                                <MdClose size={18} />
                            </button>
                        </div>
                        <div className="modal-card-body">
                            <p>
                                On this browser, importing is only possible from the <strong>Full Page</strong> view —
                                the file picker closes the popup before a file can be selected.
                            </p>
                            <p>Open Tabox in Full Page mode to import your collections.</p>
                        </div>
                        <div className="button-row">
                            <button type="button" className="modal-button" onClick={onClose}>
                                Close
                            </button>
                            <button type="button" className="modal-button primary" onClick={onOpenFullPage}>
                                <MdOpenInNew size={14} style={{ marginRight: '6px', verticalAlign: 'text-bottom' }} />
                                Open Full Page
                            </button>
                        </div>
                    </div>
                </div>
            </Activity>
        </Modal>
    );
}

export default ImportFullPageModal;
