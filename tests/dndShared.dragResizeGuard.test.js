/**
 * The Firefox browserAction panel fires spurious zero-delta `resize` events
 * (the panel auto-sizes to content and re-notifies on every re-layout even
 * when innerWidth/innerHeight are unchanged). dnd-kit's AbstractPointerSensor
 * cancels the active drag on ANY window resize, which killed every popup drag
 * ~one frame after activation. installDragResizeGuard swallows resize events
 * that carry no size change while a pointer drag is in progress, before they
 * can reach dnd-kit's per-drag resize listener.
 */
import { installDragResizeGuard } from '../app/utils/dndShared';

function makeWindowStub({ width = 670, height = 585 } = {}) {
    const listeners = [];
    return {
        innerWidth: width,
        innerHeight: height,
        addEventListener(type, fn) {
            listeners.push({ type, fn });
        },
        dispatch(type, event) {
            // Mirrors AT_TARGET dispatch on `window`: registration order, and
            // stopImmediatePropagation halts the remaining listeners.
            let stopped = false;
            const ev = {
                type,
                ...event,
                stopImmediatePropagation() {
                    stopped = true;
                },
            };
            for (const l of listeners) {
                if (l.type !== type) continue;
                l.fn(ev);
                if (stopped) break;
            }
            return !stopped;
        },
    };
}

describe('installDragResizeGuard', () => {
    let win;
    let sensorResizeCalls;

    beforeEach(() => {
        win = makeWindowStub();
        installDragResizeGuard(win);
        // Simulates dnd-kit's AbstractPointerSensor: it registers its
        // cancel-on-resize listener AFTER the guard (at pointerdown time).
        sensorResizeCalls = 0;
        win.addEventListener('resize', () => {
            sensorResizeCalls += 1;
        });
    });

    test('swallows zero-delta resize while a pointer drag is active', () => {
        win.dispatch('pointerdown', {});
        win.dispatch('resize', {});
        expect(sensorResizeCalls).toBe(0);
    });

    test('lets real size changes through mid-drag (dnd-kit may cancel)', () => {
        win.dispatch('pointerdown', {});
        win.innerHeight = 600;
        win.dispatch('resize', {});
        expect(sensorResizeCalls).toBe(1);
    });

    test('does not interfere when no pointer is down', () => {
        win.dispatch('resize', {});
        expect(sensorResizeCalls).toBe(1);
    });

    test('stops guarding after pointerup', () => {
        win.dispatch('pointerdown', {});
        win.dispatch('pointerup', {});
        win.dispatch('resize', {});
        expect(sensorResizeCalls).toBe(1);
    });

    test('stops guarding after pointercancel', () => {
        win.dispatch('pointerdown', {});
        win.dispatch('pointercancel', {});
        win.dispatch('resize', {});
        expect(sensorResizeCalls).toBe(1);
    });

    test('tracks latest dimensions so a revert resize is still zero-delta', () => {
        // Real change while idle updates the baseline...
        win.innerHeight = 600;
        win.dispatch('resize', {});
        expect(sensorResizeCalls).toBe(1);
        // ...so a mid-drag notification at those same dimensions is swallowed.
        win.dispatch('pointerdown', {});
        win.dispatch('resize', {});
        expect(sensorResizeCalls).toBe(1);
    });
});
