import { test, expect } from 'crxbox';
import { buildSeed, openFullPage, seedStorage } from './support/fixtures.mjs';

// Full-page drag-and-drop: collection cards (FPContentArea, rectSortingStrategy) and
// sidebar folders (FPSidebar, vertical). Every surface shares the unified 5px activation
// distance (app/utils/dndShared.js). Both persist `order` into their respective index
// (collections_index / folders_index). Uses crxbox's ext.dragAndDrop() helper to trip
// the activation-distance sensors.

test('reorders collection cards in the content grid', async ({ ext, context }) => {
  await seedStorage(ext,
    buildSeed({
      collections: [
        { uid: 'col-a', name: 'Alpha', order: 0 },
        { uid: 'col-b', name: 'Beta', order: 1 },
        { uid: 'col-c', name: 'Gamma', order: 2 },
      ],
    }),
  );
  const page = await openFullPage(ext);

  // Use the flat "Root Level" view for a deterministic sortable list.
  await page.locator('[data-sidebar-no-folder="true"]').click();
  await expect(page.locator('[data-sortable-collection-id]')).toHaveCount(3);

  const cardOrder = () =>
    page
      .locator('[data-sortable-collection-id]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-sortable-collection-id')));
  expect(await cardOrder()).toEqual(['col-a', 'col-b', 'col-c']);

  // Drag Alpha onto Beta → [Beta, Alpha, Gamma].
  await ext.dragAndDrop(
    page.locator('[data-sortable-collection-id="col-a"]'),
    page.locator('[data-sortable-collection-id="col-b"]'),
  );

  await expect.poll(() => cardOrder()).toEqual(['col-b', 'col-a', 'col-c']);
  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('collections_index');
      return { b: idx['col-b'].order, a: idx['col-a'].order, c: idx['col-c'].order };
    })
    .toEqual({ b: 0, a: 1, c: 2 });
});

test('reorders folders in the sidebar', async ({ ext, context }) => {
  await seedStorage(ext,
    buildSeed({
      folders: [
        { uid: 'f1', name: 'Work', order: 0 },
        { uid: 'f2', name: 'Personal', order: 1 },
        { uid: 'f3', name: 'Archive', order: 2 },
      ],
    }),
  );
  const page = await openFullPage(ext);

  const folderOrder = () =>
    page
      .locator('[data-sidebar-folder-uid]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-sidebar-folder-uid')));
  await expect(page.locator('[data-sidebar-folder-uid]')).toHaveCount(3);
  expect(await folderOrder()).toEqual(['f1', 'f2', 'f3']);

  // Drag Work (f1) down onto Archive (f3) → [f2, f3, f1]. (unified 5px sensor; generous nudge)
  // A single-step downward drag is ambiguous under closestCenter: once the row
  // below shifts up, the pointer at its old center is equidistant between it and
  // the next row, so the drop can re-target one slot too far. Dragging to the
  // END of the list has no row below to steal the drop — deterministic.
  await ext.dragAndDrop(
    page.locator('[data-sidebar-folder-uid="f1"] .fp-sidebar-folder-item'),
    page.locator('[data-sidebar-folder-uid="f3"] .fp-sidebar-folder-item'),
    { nudge: 10 },
  );

  await expect.poll(() => folderOrder()).toEqual(['f2', 'f3', 'f1']);
  await expect
    .poll(async () => {
      const idx = await ext.storage.local.get('folders_index');
      return { f2: idx['f2'].order, f3: idx['f3'].order, f1: idx['f1'].order };
    })
    .toEqual({ f2: 0, f3: 1, f1: 2 });
});
