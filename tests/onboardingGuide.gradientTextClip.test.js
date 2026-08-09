/**
 * Firefox paints multi-layer `background-clip: text, <box>` incorrectly: the
 * text-clipped layer fills the whole box, hiding the transparent text (the
 * onboarding "Welcome" title bug). Firefox only honours `text` as a single
 * value, so gradient text must live on its own element with a single-value
 * clip, separate from any backdrop layer.
 */
const fs = require('fs');
const path = require('path');
const glob = (dir) =>
    fs.readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => path.join(dir, f));

describe('gradient text background-clip (Firefox compatibility)', () => {
    const cssFiles = [
        ...glob(path.join(__dirname, '..', 'app')),
        ...glob(path.join(__dirname, '..', 'static')),
    ];

    test.each(cssFiles.map((f) => [path.relative(path.join(__dirname, '..'), f), f]))(
        '%s has no multi-value background-clip containing text',
        (_rel, file) => {
            const css = fs.readFileSync(file, 'utf8');
            const offending = css.match(/(?:-webkit-)?background-clip\s*:[^;}]*text\s*,[^;}]*/g);
            expect(offending).toBeNull();
        }
    );
});
