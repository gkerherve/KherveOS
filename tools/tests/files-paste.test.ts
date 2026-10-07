// Copy / paste rules for files.  Run:  node --test tools/tests/files-paste.test.ts
// (Node ≥ 23 runs TypeScript directly.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  copyName, deviceName, downloadUrlData, moveName, pasteLabel, pickClipboard, planPaste, safeZipPath,
  supportsDownloadUrl, zipTopLevel,
} from '../../src/apps/files/pasteLogic.ts'

const takenIn = (...names: string[]) => (n: string) => names.includes(n)

test('copy names follow macOS', () => {
  assert.equal(copyName('a.txt', false, takenIn()), 'a.txt')
  assert.equal(copyName('a.txt', false, takenIn('a.txt')), 'a copy.txt')
  assert.equal(copyName('a.txt', false, takenIn('a.txt', 'a copy.txt')), 'a copy 2.txt')
  assert.equal(copyName('a.txt', false, takenIn('a.txt', 'a copy.txt', 'a copy 2.txt')), 'a copy 3.txt')
  // copying a copy does not stack "copy copy"
  assert.equal(copyName('a copy.txt', false, takenIn('a.txt', 'a copy.txt')), 'a copy 2.txt')
  assert.equal(copyName('a copy 2.txt', false, takenIn('a copy 2.txt', 'a copy.txt')), 'a copy 3.txt')
  // folders and dot-files have no extension; double extensions keep the last one
  assert.equal(copyName('My.Folder', true, takenIn('My.Folder')), 'My.Folder copy')
  assert.equal(copyName('.bashrc', false, takenIn('.bashrc')), '.bashrc copy')
  assert.equal(copyName('data.tar.gz', false, takenIn('data.tar.gz')), 'data.tar copy.gz')
  assert.equal(copyName('Notes', false, takenIn('Notes')), 'Notes copy')
})

test('move names keep both like "Keep Both"', () => {
  assert.equal(moveName('a.txt', false, takenIn()), 'a.txt')
  assert.equal(moveName('a.txt', false, takenIn('a.txt')), 'a 2.txt')
  assert.equal(moveName('Dir', true, takenIn('Dir', 'Dir 2')), 'Dir 3')
})

// A tiny drive for planPaste.
function drive(paths: Record<string, 'file' | 'dir'>) {
  return {
    exists: (p: string) => p in paths,
    isDir: (p: string) => paths[p] === 'dir',
  }
}

const D = drive({
  '/h': 'dir',
  '/h/a.txt': 'file',
  '/h/Dir': 'dir',
  '/h/Dir/b.txt': 'file',
  '/h/Dir/Sub': 'dir',
  '/h/Other': 'dir',
  '/h/Other/a.txt': 'file',
})

test('copy into the same folder makes "copy" names, also for several items', () => {
  const plan = planPaste(['/h/a.txt', '/h/Dir'], '/h', 'copy', D.exists, D.isDir)
  assert.deepEqual(plan.steps, [
    { from: '/h/a.txt', to: '/h/a copy.txt' },
    { from: '/h/Dir', to: '/h/Dir copy' },
  ])
  assert.deepEqual(plan.skipped, [])
})

test('two items with the same name pasted together do not collide', () => {
  const plan = planPaste(['/h/a.txt', '/h/Other/a.txt'], '/h/Dir', 'copy', D.exists, D.isDir)
  assert.deepEqual(plan.steps.map((s) => s.to), ['/h/Dir/a.txt', '/h/Dir/a copy.txt'])
})

test('copy into another folder keeps the name when free', () => {
  const plan = planPaste(['/h/Dir/b.txt'], '/h/Other', 'copy', D.exists, D.isDir)
  assert.deepEqual(plan.steps, [{ from: '/h/Dir/b.txt', to: '/h/Other/b.txt' }])
})

test('a folder cannot be pasted into itself or its subfolders', () => {
  const plan = planPaste(['/h/Dir'], '/h/Dir/Sub', 'copy', D.exists, D.isDir)
  assert.deepEqual(plan.steps, [])
  assert.deepEqual(plan.skipped, [{ path: '/h/Dir', reason: 'into-itself' }])
  assert.equal(planPaste(['/h/Dir'], '/h/Dir', 'cut', D.exists, D.isDir).skipped[0].reason, 'into-itself')
})

test('cut + paste moves; same folder does nothing; clashes keep both', () => {
  assert.deepEqual(planPaste(['/h/a.txt'], '/h', 'cut', D.exists, D.isDir).skipped, [{ path: '/h/a.txt', reason: 'same-folder' }])
  assert.deepEqual(planPaste(['/h/a.txt'], '/h/Other', 'cut', D.exists, D.isDir).steps, [{ from: '/h/a.txt', to: '/h/Other/a 2.txt' }])
  assert.deepEqual(planPaste(['/h/Dir/b.txt'], '/h', 'cut', D.exists, D.isDir).steps, [{ from: '/h/Dir/b.txt', to: '/h/b.txt' }])
})

test('missing items are skipped; a folder brings its own contents', () => {
  const plan = planPaste(['/h/gone.txt', '/h/Dir', '/h/Dir/b.txt', '/h/Dir'], '/h/Other', 'copy', D.exists, D.isDir)
  assert.deepEqual(plan.steps, [{ from: '/h/Dir', to: '/h/Other/Dir' }])
  assert.deepEqual(plan.skipped, [{ path: '/h/gone.txt', reason: 'missing' }])
})

test('pasting into the root folder', () => {
  assert.deepEqual(planPaste(['/h/a.txt'], '/', 'copy', D.exists, D.isDir).steps, [{ from: '/h/a.txt', to: '/a.txt' }])
})

test('the newest clipboard wins; a server copy made here does not count', () => {
  const me = 'dev-me'
  assert.equal(pickClipboard(null, null, me), null)
  assert.equal(pickClipboard({ time: 10 }, null, me), 'local')
  assert.equal(pickClipboard(null, { time: 5, deviceId: 'other' }, me), 'server')
  assert.equal(pickClipboard({ time: 10 }, { time: 20, deviceId: 'other' }, me), 'server')
  assert.equal(pickClipboard({ time: 30 }, { time: 20, deviceId: 'other' }, me), 'local')
  assert.equal(pickClipboard({ time: 10 }, { time: 20, deviceId: me }, me), 'local')
  assert.equal(pickClipboard(null, { time: 20, deviceId: me }, me), null)
})

test('paste labels', () => {
  assert.equal(pasteLabel(0), 'Paste')
  assert.equal(pasteLabel(1), 'Paste Item')
  assert.equal(pasteLabel(3), 'Paste 3 Items')
  assert.equal(pasteLabel(3, 'Chrome on Windows'), 'Paste from Chrome on Windows')
})

test('zip entries: top level and safety', () => {
  assert.deepEqual(zipTopLevel(['Report.txt', 'Project/', 'Project/a/b.txt', 'Solo/x.txt', 'Empty/']), [
    { name: 'Report.txt', isDir: false },
    { name: 'Project', isDir: true },
    { name: 'Solo', isDir: true },
    { name: 'Empty', isDir: true },
  ])
  assert.equal(safeZipPath('a/./b.txt'), 'a/b.txt')
  assert.equal(safeZipPath('Dir/'), 'Dir')
  for (const bad of ['../x', '/etc/passwd', 'a/../../b', 'a\\b', '', './']) assert.equal(safeZipPath(bad), null, bad)
  assert.deepEqual(zipTopLevel(['../evil.txt', 'ok.txt']), [{ name: 'ok.txt', isDir: false }])
})

test('DownloadURL data cannot be broken by the file name', () => {
  assert.equal(downloadUrlData('text/plain', 'a.txt', 'blob:http://x/1'), 'text/plain:a.txt:blob:http://x/1')
  assert.equal(downloadUrlData('', 'time 10:30.txt', 'blob:u'), 'application/octet-stream:time 10-30.txt:blob:u')
})

test('browser and system names', () => {
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15'
  const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'
  const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
  assert.equal(deviceName(mac), 'Chrome on macOS')
  assert.equal(deviceName(safari), 'Safari on macOS')
  assert.equal(deviceName(edge), 'Edge on Windows')
  assert.equal(deviceName(firefox), 'Firefox on Linux')
  assert.equal(supportsDownloadUrl(mac), true)
  assert.equal(supportsDownloadUrl(edge), true)
  assert.equal(supportsDownloadUrl(safari), false)
  assert.equal(supportsDownloadUrl(firefox), false)
})
