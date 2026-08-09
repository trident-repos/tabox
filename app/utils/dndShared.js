// Single source of truth for drag-and-drop interaction tuning so every
// DndContext (sidebar folders, collection cards, detail-panel tabs) feels identical.
export const DND_ACTIVATION_DISTANCE = 5;

export const dndPointerSensorOptions = Object.freeze({
    activationConstraint: Object.freeze({ distance: DND_ACTIVATION_DISTANCE }),
});

// The Firefox browserAction panel fires spurious zero-delta `resize` events:
// the panel auto-sizes to content, and every re-layout re-notifies the popup
// window even when innerWidth/innerHeight are unchanged. dnd-kit's
// AbstractPointerSensor registers a cancel-on-resize listener for each drag,
// so in the Firefox popup every drag was cancelled ~one frame after
// activation. Swallow resize events that carry no actual size change while a
// pointer drag is in progress, before dnd-kit's listener can see them.
//
// Ordering guarantee: `resize` fires AT_TARGET on `window`, where listeners
// run in registration order. This guard registers at module load; the sensor
// registers per-drag on pointerdown, so the guard always runs first.
// Real size changes still propagate (dnd-kit's cancel stays meaningful).
export function installDragResizeGuard(win) {
    let pointerActive = false;
    let lastWidth = win.innerWidth;
    let lastHeight = win.innerHeight;
    win.addEventListener('pointerdown', () => { pointerActive = true; }, true);
    win.addEventListener('pointerup', () => { pointerActive = false; }, true);
    win.addEventListener('pointercancel', () => { pointerActive = false; }, true);
    win.addEventListener('resize', (event) => {
        const sizeChanged = win.innerWidth !== lastWidth || win.innerHeight !== lastHeight;
        lastWidth = win.innerWidth;
        lastHeight = win.innerHeight;
        if (!sizeChanged && pointerActive) {
            event.stopImmediatePropagation();
        }
    }, true);
}

if (typeof window !== 'undefined') {
    installDragResizeGuard(window);
}
