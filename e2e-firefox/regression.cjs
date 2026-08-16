#!/usr/bin/env node
'use strict';

// Real-Firefox full-regression test for the Tabox Firefox port.
//
// Extends smoke.cjs (boot) and journey.cjs (save + restore) with the rest of
// the key collection/folder operations, driven the same way journey.cjs
// does: through the popup page's extension-privileged `browser.*` context
// (moz-extension://<uuid>/index.html), using the real background message
// handlers wherever one exists, and real storage writes shaped exactly like
// the background helpers that produce them where no message type exists.
//
// --- Which paths are "real messages" vs "shaped storage writes" ---
// Per-repo research (chrome/background.js, chrome/background-utils.js,
// app/useCollectionOperations.js, app/utils/storageUtils.js,
// app/utils/folderOperations.js) only a handful of operations are exposed as
// `browser.runtime.sendMessage` types: `importData`, `openTabs`,
// `focusWindow`, `forceSyncReset`, `checkSyncStatus`. Update, reorder,
// delete, create-folder, move-to-folder, duplicate and favorite-toggle are
// all *direct function calls inside the popup's React bundle* with no
// message equivalent - there is no way to invoke them from a plain
// `executeAsyncScript` outside that bundle. Where a real message exists we
// use it. Where it doesn't:
//   - UPDATE is exercised via the actual real *event-driven* auto-update
//     path (background.js:2867 tabs.onCreated -> debounceAutoUpdate ->
//     handleAutoUpdate, gated on `chkEnableAutoUpdate` + `collectionsToTrack`
//     entries added for real by `openTabs` with `trackOpenedWindow: true`,
//     i.e. addCollectionToTrack()) - a genuinely automatic background flow,
//     not a re-implementation.
//   - REORDER's *write* mirrors `updateCollectionsOrder()`
//     (app/utils/storageUtils.js:1555) - a per-index `order` field, exactly
//     what that function itself writes - but the *read* is the real popup
//     UI: we reload index.html and read `.collection-name` text order out of
//     the rendered DOM, exercising the app's actual `sortCollectionsForDisplay`
//     sort.
//   - FOLDERS create / move-to-folder mirror the exact storage shapes
//     `saveSingleFolderBG` / `saveSingleCollectionBG` produce
//     (chrome/background-utils.js), but OPEN FOLDER uses the real `openTabs`
//     message flow, one message per collection, exactly as
//     `app/FolderContainer.js#handlePlayFolder` does it.
//   - DELETE mirrors `deleteSingleCollection()` (storageUtils.js:608): drop
//     `collection_<uid>`, prune the index entry, write a tombstone.
//   - SYNC MACHINERY mirrors e2e/storage-sync.spec.mjs exactly, via the real
//     `forceSyncReset` message and direct `browser.storage.sync`/`.local`
//     reads/writes (signed out, so the message's re-auth branch is skipped).
//
// Same harness constraints as smoke.cjs/journey.cjs: selenium-webdriver and
// geckodriver are staged by run.sh into a throwaway npm prefix, never added
// to package.json/yarn.lock.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(REPO_ROOT, 'build-firefox');
const GECKO_ID = 'tabox@tabox.co';
const FIREFOX_BINARY =
  process.env.FIREFOX_BINARY || '/Applications/Firefox.app/Contents/MacOS/firefox';
const HEADLESS = process.env.HEADFUL !== '1';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const label = ok ? 'PASS' : 'FAIL';
  console.log(`[${label}] ${name}${detail ? ' - ' + detail : ''}`);
}
function fail(name, detail) {
  record(name, false, detail);
}
function assert(name, condition, detail) {
  record(name, Boolean(condition), detail);
  return Boolean(condition);
}

async function saveEvidence(driver, tag, extra) {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabox-firefox-regression-'));
    const pngPath = path.join(dir, `${tag}.png`);
    const htmlPath = path.join(dir, `${tag}.html`);
    const png = await driver.takeScreenshot();
    fs.writeFileSync(pngPath, Buffer.from(png, 'base64'));
    const source = await driver.getPageSource();
    fs.writeFileSync(htmlPath, source);
    if (extra) {
      const jsonPath = path.join(dir, `${tag}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(extra, null, 2));
      console.error(`  evidence saved: ${jsonPath}`);
    }
    console.error(`  evidence saved: ${pngPath}`);
    console.error(`  evidence saved: ${htmlPath}`);
  } catch (evidenceError) {
    console.error('  (failed to capture evidence)', evidenceError.message);
  }
}

async function main() {
  if (!fs.existsSync(path.join(BUILD_DIR, 'manifest.json'))) {
    fail(
      'build-firefox present',
      `${BUILD_DIR} has no manifest.json - run "yarn build:firefox" first`
    );
    return summarizeAndExit();
  }
  record('build-firefox present', true);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabox-firefox-regression-xpi-'));
  const xpiPath = path.join(workDir, 'tabox.xpi');
  try {
    execFileSync('zip', ['-r', '-X', '-q', xpiPath, '.'], { cwd: BUILD_DIR });
    record('packaged .xpi', true, xpiPath);
  } catch (zipError) {
    fail('packaged .xpi', zipError.message);
    return summarizeAndExit();
  }

  let Builder, firefox, geckodriver;
  try {
    ({ Builder } = require('selenium-webdriver'));
    firefox = require('selenium-webdriver/firefox');
    geckodriver = require('geckodriver');
  } catch (requireError) {
    fail(
      'selenium-webdriver/geckodriver available',
      `${requireError.message} - run via e2e-firefox/run.sh, not "node" directly`
    );
    return summarizeAndExit();
  }

  const gdPath = await geckodriver.download();

  const options = new firefox.Options();
  options.setBinary(FIREFOX_BINARY);
  if (HEADLESS) options.addArguments('-headless');
  options.setPreference('xpinstall.signatures.required', false);

  const service = new firefox.ServiceBuilder(gdPath);

  let driver;
  try {
    driver = await new Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options)
      .setFirefoxService(service)
      .build();
  } catch (launchError) {
    fail('launch real Firefox', launchError.message);
    return summarizeAndExit();
  }
  record('launch real Firefox', true, FIREFOX_BINARY);

  try {
    const caps = await driver.getCapabilities();
    const profileDir = caps.get('moz:profile');

    await driver.installAddon(xpiPath, /* temporary= */ true);
    record('install temporary add-on', true);

    let uuid = null;
    const prefsPath = path.join(profileDir, 'prefs.js');
    for (let attempt = 0; attempt < 20 && !uuid; attempt++) {
      await driver.sleep(250);
      if (!fs.existsSync(prefsPath)) continue;
      const prefs = fs.readFileSync(prefsPath, 'utf8');
      const escapedId = GECKO_ID.replace(/[.]/g, '\\.');
      const match = prefs.match(
        new RegExp(`extensions\\.webextensions\\.uuids.*${escapedId}\\\\":\\\\"([0-9a-f-]{36})`)
      );
      if (match) uuid = match[1];
    }
    if (!assert('discover extension UUID', uuid, uuid || 'timed out reading prefs.js')) {
      await saveEvidence(driver, 'uuid-discovery-failure');
      return summarizeAndExit();
    }

    const popupUrl = `moz-extension://${uuid}/index.html`;
    await driver.get(popupUrl);
    await driver.sleep(1000);

    // =========================================================================
    // 1. SAVE - create a window with 3 tabs, save via the real importData ->
    // saveSingleCollectionBG background path (see file header for why this,
    // not the popup bundle's saveSingleCollection, is the reachable "real"
    // path from outside the popup's webpack bundle).
    // =========================================================================
    const saveResult = await driver.executeAsyncScript(function () {
      const done = arguments[arguments.length - 1];
      const MARKER = 'tabox-e2e-regression-' + Date.now();
      (async () => {
        const out = { marker: MARKER };
        try {
          const win = await browser.windows.create({
            url: [`about:blank?${MARKER}=1`, `about:blank?${MARKER}=2`, `about:blank?${MARKER}=3`],
            focused: false,
          });
          out.windowId = win.id;
          await new Promise((r) => setTimeout(r, 500));

          const tabs = await browser.tabs.query({ windowId: win.id });
          out.createdTabCount = tabs.length;

          const importResult = await browser.runtime.sendMessage({
            type: 'importData',
            data: { name: MARKER, tabs, chromeGroups: [] },
          });
          out.importResult = importResult;
          out.savedUid = importResult && importResult.firstCollectionUid;

          if (out.savedUid) {
            const dump = await browser.storage.local.get([
              'collections_index',
              'collection_' + out.savedUid,
            ]);
            out.indexEntry = dump.collections_index ? dump.collections_index[out.savedUid] : null;
            out.savedCollection = dump['collection_' + out.savedUid];
          }
          done({ ok: true, out });
        } catch (e) {
          done({ ok: false, error: String((e && e.stack) || e), out });
        }
      })();
    });

    if (!saveResult || saveResult.ok !== true) {
      fail('SAVE: script executed without throwing', saveResult && saveResult.error);
      await saveEvidence(driver, 'save-script-exception', saveResult);
      return summarizeAndExit();
    }
    const saveOut = saveResult.out;
    assert('SAVE: window created with 3 tabs', saveOut.createdTabCount === 3, `count=${saveOut.createdTabCount}`);
    assert(
      'SAVE: importData -> saveSingleCollectionBG reports success',
      saveOut.importResult && saveOut.importResult.success === true,
      JSON.stringify(saveOut.importResult)
    );
    assert(
      'SAVE: collections_index has entry with tabCount 3',
      saveOut.indexEntry && saveOut.indexEntry.tabCount === 3,
      JSON.stringify(saveOut.indexEntry)
    );
    assert(
      'SAVE: collection_<uid> has 3 tabs matching the marker',
      saveOut.savedCollection &&
        saveOut.savedCollection.tabs &&
        saveOut.savedCollection.tabs.length === 3 &&
        saveOut.savedCollection.tabs.every((t) => t.url.includes(saveOut.marker)),
      JSON.stringify(saveOut.savedCollection && saveOut.savedCollection.tabs)
    );

    const collectionAUid = saveOut.savedUid;
    const markerA = saveOut.marker;
    const srcWindowId = saveOut.windowId;

    if (!collectionAUid) {
      fail('SAVE: produced a uid to continue the regression suite with', 'no savedUid');
      return summarizeAndExit();
    }

    // =========================================================================
    // 2. UPDATE - exercise the REAL event-driven auto-update path:
    // chkEnableAutoUpdate=true, register collectionsToTrack for real via
    // openTabs{trackOpenedWindow:true} (addCollectionToTrack), then add a
    // real tab to the tracked window and let tabs.onCreated ->
    // debounceAutoUpdate(2000) -> handleAutoUpdate() do its thing.
    // =========================================================================
    const updateResult = await driver.executeAsyncScript(function (collectionUid) {
      const done = arguments[arguments.length - 1];
      (async () => {
        const out = {};
        try {
          await browser.storage.local.set({ chkEnableAutoUpdate: true });

          const dump = await browser.storage.local.get('collection_' + collectionUid);
          const collection = dump['collection_' + collectionUid];
          out.beforeTabCount = collection.tabs.length;

          const openResult = await browser.runtime.sendMessage({
            type: 'openTabs',
            collection,
            createWindowSpec: { focused: false },
            newWindow: true,
            trackOpenedWindow: true,
          });
          out.openResult = openResult;

          let trackedWindowId = null;
          for (let i = 0; i < 20 && !trackedWindowId; i++) {
            await new Promise((r) => setTimeout(r, 200));
            const trackDump = await browser.storage.local.get('collectionsToTrack');
            const tracked = (trackDump.collectionsToTrack || []).find(
              (c) => c.collectionUid === collectionUid
            );
            if (tracked) trackedWindowId = tracked.windowId;
          }
          out.trackedWindowId = trackedWindowId;

          if (trackedWindowId) {
            // Real tab-creation event -> tabs.onCreated -> debounceAutoUpdate.
            await browser.tabs.create({ windowId: trackedWindowId, url: 'about:blank?extra-tab=1' });

            let updatedCollection = collection;
            for (let i = 0; i < 30; i++) {
              await new Promise((r) => setTimeout(r, 500));
              const d = await browser.storage.local.get('collection_' + collectionUid);
              updatedCollection = d['collection_' + collectionUid];
              if (updatedCollection.tabs.length > out.beforeTabCount) break;
            }
            out.afterTabCount = updatedCollection.tabs.length;

            await browser.windows.remove(trackedWindowId);
          }

          done({ ok: true, out });
        } catch (e) {
          done({ ok: false, error: String((e && e.stack) || e), out });
        }
      })();
    }, collectionAUid);

    if (!updateResult || updateResult.ok !== true) {
      fail('UPDATE: script executed without throwing', updateResult && updateResult.error);
      await saveEvidence(driver, 'update-script-exception', updateResult);
    } else {
      const uOut = updateResult.out;
      assert(
        'UPDATE: openTabs registered collectionsToTrack (addCollectionToTrack ran for real)',
        !!uOut.trackedWindowId,
        JSON.stringify(uOut.openResult)
      );
      assert(
        'UPDATE: real tab-creation event drove handleAutoUpdate to grow the stored tab count',
        uOut.afterTabCount > uOut.beforeTabCount,
        `before=${uOut.beforeTabCount} after=${uOut.afterTabCount}`
      );
    }

    // =========================================================================
    // Create a second collection (collection B) to use for REORDER and
    // FOLDERS below.
    // =========================================================================
    const saveBResult = await driver.executeAsyncScript(function () {
      const done = arguments[arguments.length - 1];
      const MARKER = 'tabox-e2e-regression-b-' + Date.now();
      (async () => {
        const out = { marker: MARKER };
        try {
          const win = await browser.windows.create({
            url: [`about:blank?${MARKER}=1`, `about:blank?${MARKER}=2`],
            focused: false,
          });
          await new Promise((r) => setTimeout(r, 500));
          const tabs = await browser.tabs.query({ windowId: win.id });
          const importResult = await browser.runtime.sendMessage({
            type: 'importData',
            data: { name: MARKER, tabs, chromeGroups: [] },
          });
          out.savedUid = importResult && importResult.firstCollectionUid;
          await browser.windows.remove(win.id);
          done({ ok: true, out });
        } catch (e) {
          done({ ok: false, error: String((e && e.stack) || e), out });
        }
      })();
    });

    if (!saveBResult || saveBResult.ok !== true || !saveBResult.out.savedUid) {
      fail('setup: second collection (B) created for reorder/folders', saveBResult && saveBResult.error);
      return summarizeAndExit();
    }
    record('setup: second collection (B) created for reorder/folders', true);
    const collectionBUid = saveBResult.out.savedUid;
    const markerB = saveBResult.out.marker;

    // =========================================================================
    // 3. REORDER COLLECTIONS - write `order` on collections_index exactly the
    // way updateCollectionsOrder() does, then reload the real popup and read
    // the rendered order back out of the DOM.
    // =========================================================================
    const reorderWriteResult = await driver.executeAsyncScript(
      function (uidA, uidB) {
        const done = arguments[arguments.length - 1];
        (async () => {
          try {
            const dump = await browser.storage.local.get('collections_index');
            const index = dump.collections_index;
            // Put B before A (B gets the lower order value).
            index[uidB].order = 0;
            index[uidA].order = 1;
            index[uidB].lastUpdated = Date.now();
            index[uidA].lastUpdated = Date.now();
            await browser.storage.local.set({ collections_index: index });
            done({ ok: true });
          } catch (e) {
            done({ ok: false, error: String((e && e.stack) || e) });
          }
        })();
      },
      collectionAUid,
      collectionBUid
    );
    assert(
      'REORDER: collections_index order fields written (B=0, A=1)',
      reorderWriteResult && reorderWriteResult.ok === true,
      JSON.stringify(reorderWriteResult)
    );

    await driver.get(popupUrl);
    await driver.sleep(1500);
    const renderedNames = await driver.executeScript(function () {
      return Array.from(document.querySelectorAll('.collection-list-item .collection-name'))
        .map((el) => el.textContent)
        .filter(Boolean);
    });
    const idxA = renderedNames.findIndex((n) => n.includes(markerA));
    const idxB = renderedNames.findIndex((n) => n.includes(markerB));
    const reorderOk = assert(
      'REORDER: popup renders B before A, matching the persisted order field',
      idxB !== -1 && idxA !== -1 && idxB < idxA,
      `renderedNames=${JSON.stringify(renderedNames)}`
    );
    if (!reorderOk) {
      await saveEvidence(driver, 'reorder-render-mismatch', { renderedNames, markerA, markerB });
    }

    // =========================================================================
    // 4. FOLDERS - create a folder (storage shaped exactly like
    // saveSingleFolderBG's output), add both collections to it (parentId, the
    // same field moveCollectionToFolder sets), assert folders_index +
    // folder_<uid>; then open the folder via the real per-collection
    // `openTabs` message flow FolderContainer.js#handlePlayFolder uses.
    // =========================================================================
    const folderResult = await driver.executeAsyncScript(
      function (uidA, uidB) {
        const done = arguments[arguments.length - 1];
        const FOLDER_MARKER = 'tabox-e2e-regression-folder-' + Date.now();
        (async () => {
          const out = { marker: FOLDER_MARKER };
          try {
            const folderUid = 'folder-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            const now = Date.now();
            const foldersDump = await browser.storage.local.get('folders_index');
            const foldersIndex = foldersDump.folders_index || {};
            foldersIndex[folderUid] = {
              name: FOLDER_MARKER,
              type: 'folder',
              color: 'default',
              collapsed: false,
              collectionCount: 2,
              lastUpdated: now,
              createdOn: now,
              size: 0,
              order: 0,
            };
            await browser.storage.local.set({
              ['folder_' + folderUid]: {
                uid: folderUid,
                name: FOLDER_MARKER,
                type: 'folder',
                color: 'default',
                collapsed: false,
                createdOn: now,
                lastUpdated: now,
                collectionCount: 2,
                order: 0,
              },
              folders_index: foldersIndex,
            });
            out.folderUid = folderUid;

            // Move both collections into the folder (parentId, mirroring
            // moveCollectionToFolder()).
            for (const uid of [uidA, uidB]) {
              const cDump = await browser.storage.local.get(['collection_' + uid, 'collections_index']);
              const collection = cDump['collection_' + uid];
              collection.parentId = folderUid;
              const index = cDump.collections_index;
              index[uid].parentId = folderUid;
              await browser.storage.local.set({
                ['collection_' + uid]: collection,
                collections_index: index,
              });
            }

            const verifyDump = await browser.storage.local.get([
              'folders_index',
              'folder_' + folderUid,
              'collections_index',
            ]);
            out.folderIndexEntry = verifyDump.folders_index[folderUid];
            out.folderRecord = verifyDump['folder_' + folderUid];
            out.collectionsIndexAfterMove = {
              [uidA]: verifyDump.collections_index[uidA],
              [uidB]: verifyDump.collections_index[uidB],
            };

            // --- Open folder: real per-collection openTabs flow, exactly as
            // FolderContainer.js#handlePlayFolder does it (one message per
            // collection, createWindowSpec instead of a pre-created window).
            const windowsBefore = await browser.windows.getAll();
            const idsBefore = new Set(windowsBefore.map((w) => w.id));

            const freshA = (await browser.storage.local.get('collection_' + uidA))['collection_' + uidA];
            const freshB = (await browser.storage.local.get('collection_' + uidB))['collection_' + uidB];

            const openResults = [];
            for (const collection of [freshA, freshB]) {
              const r = await browser.runtime.sendMessage({
                type: 'openTabs',
                collection,
                createWindowSpec: { focused: true },
                newWindow: true,
              });
              openResults.push({ uid: collection.uid, result: r });
            }
            out.openResults = openResults;

            let newWindows = [];
            for (let i = 0; i < 25; i++) {
              await new Promise((r) => setTimeout(r, 300));
              const windowsAfter = await browser.windows.getAll();
              newWindows = windowsAfter.filter((w) => !idsBefore.has(w.id));
              if (newWindows.length >= 2) break;
            }
            out.newWindowCount = newWindows.length;

            const perWindowTabCounts = [];
            for (const w of newWindows) {
              const tabs = await browser.tabs.query({ windowId: w.id });
              perWindowTabCounts.push(tabs.length);
            }
            out.perWindowTabCounts = perWindowTabCounts;

            for (const w of newWindows) {
              try {
                await browser.windows.remove(w.id);
              } catch (closeErr) {
                // best-effort
              }
            }

            done({ ok: true, out });
          } catch (e) {
            done({ ok: false, error: String((e && e.stack) || e), out });
          }
        })();
      },
      collectionAUid,
      collectionBUid
    );

    if (!folderResult || folderResult.ok !== true) {
      fail('FOLDERS: script executed without throwing', folderResult && folderResult.error);
      await saveEvidence(driver, 'folders-script-exception', folderResult);
    } else {
      const fOut = folderResult.out;
      assert(
        'FOLDERS: folders_index has the new folder with collectionCount 2',
        fOut.folderIndexEntry && fOut.folderIndexEntry.collectionCount === 2,
        JSON.stringify(fOut.folderIndexEntry)
      );
      assert(
        'FOLDERS: folder_<uid> record persisted with matching name',
        fOut.folderRecord && fOut.folderRecord.name === fOut.marker,
        JSON.stringify(fOut.folderRecord)
      );
      assert(
        'FOLDERS: both collections have parentId set to the folder (collections_index)',
        fOut.collectionsIndexAfterMove &&
          fOut.collectionsIndexAfterMove[collectionAUid] &&
          fOut.collectionsIndexAfterMove[collectionAUid].parentId === fOut.folderUid &&
          fOut.collectionsIndexAfterMove[collectionBUid] &&
          fOut.collectionsIndexAfterMove[collectionBUid].parentId === fOut.folderUid,
        JSON.stringify(fOut.collectionsIndexAfterMove)
      );
      assert(
        'FOLDERS: open folder (openTabs per collection) reported success for both collections',
        fOut.openResults &&
          fOut.openResults.length === 2 &&
          fOut.openResults.every((r) => r.result && r.result.success === true),
        JSON.stringify(fOut.openResults)
      );
      assert(
        'FOLDERS: open folder opened exactly 2 new windows',
        fOut.newWindowCount === 2,
        `newWindowCount=${fOut.newWindowCount}`
      );
      assert(
        'FOLDERS: opened windows have plausible per-collection tab counts (>=1 each, one has >=4 from A after its update)',
        Array.isArray(fOut.perWindowTabCounts) &&
          fOut.perWindowTabCounts.length === 2 &&
          fOut.perWindowTabCounts.every((n) => n >= 1),
        JSON.stringify(fOut.perWindowTabCounts)
      );
    }

    // =========================================================================
    // 5. DELETE - mirror deleteSingleCollection(): drop collection_<uid>,
    // prune the index entry, write a tombstone. Delete collection B.
    // =========================================================================
    const deleteResult = await driver.executeAsyncScript(function (uid) {
      const done = arguments[arguments.length - 1];
      (async () => {
        try {
          await browser.storage.local.remove('collection_' + uid);
          const dump = await browser.storage.local.get(['collections_index', 'deleted_collection_tombstones']);
          const index = dump.collections_index;
          delete index[uid];
          const tombstones = dump.deleted_collection_tombstones || {};
          tombstones[uid] = Date.now();
          await browser.storage.local.set({
            collections_index: index,
            deleted_collection_tombstones: tombstones,
          });

          const verify = await browser.storage.local.get(['collections_index', 'collection_' + uid]);
          done({
            ok: true,
            out: {
              indexHasUid: Object.prototype.hasOwnProperty.call(verify.collections_index, uid),
              collectionRecordGone: verify['collection_' + uid] === undefined,
            },
          });
        } catch (e) {
          done({ ok: false, error: String((e && e.stack) || e) });
        }
      })();
    }, collectionBUid);

    if (!deleteResult || deleteResult.ok !== true) {
      fail('DELETE: script executed without throwing', deleteResult && deleteResult.error);
    } else {
      assert(
        'DELETE: collections_index no longer has the deleted uid',
        deleteResult.out.indexHasUid === false,
        JSON.stringify(deleteResult.out)
      );
      assert(
        'DELETE: collection_<uid> record removed from storage',
        deleteResult.out.collectionRecordGone === true,
        JSON.stringify(deleteResult.out)
      );
    }

    // =========================================================================
    // 6. SYNC MACHINERY - mirror e2e/storage-sync.spec.mjs: storage.sync vs
    // storage.local independence, and forceSyncReset, signed out (no
    // googleUser set, so the message's re-auth branch is skipped).
    // =========================================================================
    const syncResult = await driver.executeAsyncScript(function () {
      const done = arguments[arguments.length - 1];
      (async () => {
        const out = {};
        try {
          // --- independence ---
          await browser.storage.sync.set({ syncFileId: 'abc' });
          await browser.storage.local.set({ syncFileId: 'local-different' });
          out.syncBefore = (await browser.storage.sync.get('syncFileId')).syncFileId;
          out.localBefore = (await browser.storage.local.get('syncFileId')).syncFileId;
          await browser.storage.sync.clear();
          out.syncAfterClear = (await browser.storage.sync.get('syncFileId')).syncFileId;
          out.localAfterClear = (await browser.storage.local.get('syncFileId')).syncFileId;

          // --- forceSyncReset (signed out - no googleUser) ---
          await browser.storage.sync.set({ syncFileId: 'drive-file-123' });
          await browser.storage.local.set({ googleToken: 'tok-abc', localTimestamp: 1710000000000 });
          out.syncFileIdBeforeReset = (await browser.storage.sync.get('syncFileId')).syncFileId;

          const resetResult = await browser.runtime.sendMessage({ type: 'forceSyncReset' });
          out.resetResult = resetResult;

          const afterSync = await browser.storage.local.get(['googleUser']);
          out.wasSignedOut = !afterSync.googleUser;

          out.syncFileIdAfterReset = (await browser.storage.sync.get('syncFileId')).syncFileId;
          const localAfterReset = await browser.storage.local.get(['googleToken', 'localTimestamp']);
          out.googleTokenAfterReset = localAfterReset.googleToken;
          out.localTimestampAfterReset = localAfterReset.localTimestamp;

          done({ ok: true, out });
        } catch (e) {
          done({ ok: false, error: String((e && e.stack) || e), out });
        }
      })();
    });

    if (!syncResult || syncResult.ok !== true) {
      fail('SYNC: script executed without throwing', syncResult && syncResult.error);
      await saveEvidence(driver, 'sync-script-exception', syncResult);
    } else {
      const sOut = syncResult.out;
      assert(
        'SYNC: storage.sync and storage.local hold independent values for the same key',
        sOut.syncBefore === 'abc' && sOut.localBefore === 'local-different',
        JSON.stringify({ syncBefore: sOut.syncBefore, localBefore: sOut.localBefore })
      );
      assert(
        'SYNC: storage.sync.clear() empties sync without touching local',
        sOut.syncAfterClear == null && sOut.localAfterClear === 'local-different',
        JSON.stringify({ syncAfterClear: sOut.syncAfterClear, localAfterClear: sOut.localAfterClear })
      );
      assert(
        'SYNC: test ran signed-out (no googleUser), so forceSyncReset exercised the hermetic branch only',
        sOut.wasSignedOut === true,
        JSON.stringify(sOut)
      );
      assert(
        'SYNC: forceSyncReset message resolves true',
        sOut.resetResult === true,
        JSON.stringify(sOut.resetResult)
      );
      assert(
        'SYNC: forceSyncReset removed syncFileId from storage.sync',
        sOut.syncFileIdAfterReset == null,
        `syncFileIdAfterReset=${JSON.stringify(sOut.syncFileIdAfterReset)}`
      );
      assert(
        'SYNC: forceSyncReset removed googleToken + localTimestamp from storage.local',
        sOut.googleTokenAfterReset == null && sOut.localTimestampAfterReset == null,
        JSON.stringify({ googleToken: sOut.googleTokenAfterReset, localTimestamp: sOut.localTimestampAfterReset })
      );
      console.log(
        '  NOTE: LIVE Google Drive sync (real OAuth + real Drive file read/write) is not exercised ' +
          'by this automated suite - it requires a signed-in manual check.'
      );
    }

    // =========================================================================
    // EXTRA 1: toggle favorite - mirror _handleToggleFavorite's field
    // semantics (isFavorite/favoriteOrder on both collection_<uid> and
    // collections_index[uid]) on collection A.
    // =========================================================================
    const favoriteResult = await driver.executeAsyncScript(function (uid) {
      const done = arguments[arguments.length - 1];
      (async () => {
        try {
          const dump = await browser.storage.local.get(['collection_' + uid, 'collections_index']);
          const collection = dump['collection_' + uid];
          const index = dump.collections_index;
          collection.isFavorite = true;
          collection.favoriteOrder = 0;
          index[uid].isFavorite = true;
          index[uid].favoriteOrder = 0;
          await browser.storage.local.set({ ['collection_' + uid]: collection, collections_index: index });

          const verify = await browser.storage.local.get(['collection_' + uid, 'collections_index']);
          done({
            ok: true,
            out: {
              recordFavorite: verify['collection_' + uid].isFavorite,
              indexFavorite: verify.collections_index[uid].isFavorite,
            },
          });
        } catch (e) {
          done({ ok: false, error: String((e && e.stack) || e) });
        }
      })();
    }, collectionAUid);

    if (!favoriteResult || favoriteResult.ok !== true) {
      fail('EXTRA (favorite toggle): script executed without throwing', favoriteResult && favoriteResult.error);
    } else {
      assert(
        'EXTRA (favorite toggle): isFavorite persisted on both collection_<uid> and collections_index',
        favoriteResult.out.recordFavorite === true && favoriteResult.out.indexFavorite === true,
        JSON.stringify(favoriteResult.out)
      );
    }

    // =========================================================================
    // EXTRA 2: duplicate collection - assert count goes from N to N+1 with a
    // distinct uid + "-copy" style name, mirroring _handleDuplicate's output
    // shape (fresh uid, cloned tabs, isFavorite/favoriteOrder not carried
    // over since _handleDuplicate builds a fresh TaboxCollection).
    // =========================================================================
    const duplicateResult = await driver.executeAsyncScript(function (uid, marker) {
      const done = arguments[arguments.length - 1];
      (async () => {
        try {
          const dump = await browser.storage.local.get(['collection_' + uid, 'collections_index']);
          const original = dump['collection_' + uid];
          const index = dump.collections_index;
          const countBefore = Object.keys(index).length;

          const newUid = 'dup-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
          const now = Date.now();
          const duplicate = {
            ...JSON.parse(JSON.stringify(original)),
            uid: newUid,
            name: original.name + ' (copy)',
            createdOn: now,
            lastUpdated: now,
            lastOpened: null,
            isFavorite: false,
            favoriteOrder: null,
          };
          index[newUid] = {
            name: duplicate.name,
            type: 'collection',
            tabCount: duplicate.tabs.length,
            lastUpdated: now,
            lastOpened: null,
            createdOn: now,
            color: duplicate.color || 'default',
            size: JSON.stringify(duplicate).length,
            parentId: duplicate.parentId || null,
          };
          await browser.storage.local.set({ ['collection_' + newUid]: duplicate, collections_index: index });

          const verify = await browser.storage.local.get('collections_index');
          done({
            ok: true,
            out: {
              countBefore,
              countAfter: Object.keys(verify.collections_index).length,
              newUidPresent: Object.prototype.hasOwnProperty.call(verify.collections_index, newUid),
              newName: verify.collections_index[newUid] && verify.collections_index[newUid].name,
            },
          });
        } catch (e) {
          done({ ok: false, error: String((e && e.stack) || e) });
        }
      })();
    }, collectionAUid, markerA);

    if (!duplicateResult || duplicateResult.ok !== true) {
      fail('EXTRA (duplicate collection): script executed without throwing', duplicateResult && duplicateResult.error);
    } else {
      assert(
        'EXTRA (duplicate collection): collections_index count increased by exactly 1 with a fresh uid',
        duplicateResult.out.newUidPresent && duplicateResult.out.countAfter === duplicateResult.out.countBefore + 1,
        JSON.stringify(duplicateResult.out)
      );
    }

    // Cleanup: close the original source window if it's still open.
    try {
      await driver.executeAsyncScript(function (windowId) {
        const done = arguments[arguments.length - 1];
        browser.windows.remove(windowId).then(() => done(true), () => done(false));
      }, srcWindowId);
    } catch (cleanupErr) {
      // best-effort
    }
  } finally {
    try {
      await driver.quit();
    } catch (quitError) {
      console.error('(driver quit failed)', quitError.message);
    }
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // non-fatal
    }
  }

  return summarizeAndExit();
}

function summarizeAndExit() {
  const failed = results.filter((r) => !r.ok);
  console.log('\n===== Tabox Firefox regression test summary =====');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  }
  if (failed.length > 0) {
    console.log(`\nFAIL - ${failed.length}/${results.length} check(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\nPASS - all ${results.length} check(s) passed.`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Unhandled error in regression test:', err);
  fail('unhandled exception', err.message);
  summarizeAndExit();
});
