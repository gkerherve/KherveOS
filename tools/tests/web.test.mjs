// Node tests for "every web link opens inside KherveOS" and the page fetcher's
// browser side.  Run:  node --test tools/tests/web.test.mjs
//
// - the frame helper the fetcher puts in every fetched page
//   (server/kherveos_server/webfetch_frame.js), run in a fake window: links,
//   forms, window.open, fetch/XHR and pushState go through the fetcher or to the Browser;
// - the email frame's link catcher and its CSP (src/apps/email/mailLinks.ts);
// - addresses and messages (src/os/webfetch.ts), link clicks (src/os/links.ts);
// - which sites are framed, fetched or sent to the real browser (src/apps/browser/urls.ts);
// - KherveDB's embedded browsers following the periodic table (src/apps/khervedb/refFrames.ts).
// (The server's HTML/CSS rewriting itself is tested in server/tests/test_webfetch.py.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { FETCH_SANDBOX, fetchedUrl, parseFrameMessage, realUrl } from '../../src/os/webfetch.ts'
import { linkAction, mailtoAddress, urlKind } from '../../src/os/links.ts'
import { MAIL_LINK_SCRIPT, mailCsp, makeNonce, parseMailLink } from '../../src/apps/email/mailLinks.ts'
import { describe as describePage, engineNeedsRealBrowser, pageFor, resolveInput, viaFor } from '../../src/apps/browser/urls.ts'
import { SEARCH_ENGINES } from '../../src/apps/browser/sites.ts'
import * as rf from '../../src/apps/khervedb/refFrames.ts'

const ORIGIN = 'http://localhost:5173'
const PREFIX = `${ORIGIN}/api/web/f/TOKEN/`

// ------------------------------------------------- the frame helper (vm)

/** Objects from the vm's realm, compared as plain data. */
const plain = (x) => JSON.parse(JSON.stringify(x))

const FRAME_JS = readFileSync(new URL('../../server/kherveos_server/webfetch_frame.js', import.meta.url), 'utf8')

/** Run the frame helper in a fake fetched page at `page`; returns the page's globals and what it posted. */
function fetchedPage(page = 'https://example.org/dir/page.html') {
  const posted = []
  const listeners = {}
  const fetched = []
  const location = { href: fetchedUrl(PREFIX, page), hash: '' }
  const g = {
    __KHERVEOS_WEB__: { url: page, prefix: PREFIX, origin: ORIGIN },
    parent: { postMessage: (msg, origin) => posted.push(plain({ msg, origin })) },
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    scrollTo: () => {},
    location,
    document: {
      baseURI: page,
      title: 'A page',
      head: null,
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    history: {
      pushState: (s, t, u) => (location.href = String(u)),
      replaceState: (s, t, u) => (location.href = String(u)),
    },
    fetch: (input, init) => fetched.push({ input, init }),
    XMLHttpRequest: function XMLHttpRequest() {},
    URL,
    URLSearchParams,
    Object,
    Array,
    String,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
  }
  g.XMLHttpRequest.prototype.open = function (method, url) {
    this.method = method
    this.url = url
  }
  g.window = g
  vm.createContext(g)
  vm.runInContext(FRAME_JS, g)
  const fire = (type, event) => {
    for (const fn of listeners[type] ?? []) fn(event)
    return event
  }
  return { g, posted, fetched, location, fire }
}

function link(attrs, base = 'https://example.org/dir/page.html') {
  const a = {
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    hasAttribute: (n) => n in attrs,
    href: new URL(attrs.href, base).href,
    closest: () => a,
  }
  return a
}

function click(target, extra = {}) {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target,
    preventDefault() {
      this.defaultPrevented = true
    },
    ...extra,
  }
}

test('frame helper reports where the page is, to the KherveOS origin only', () => {
  const { posted } = fetchedPage()
  assert.deepEqual(posted[0], {
    msg: { type: 'location', url: 'https://example.org/dir/page.html', title: 'A page', source: 'kherveos-web' },
    origin: ORIGIN,
  })
})

test('frame helper: a link click stays in the frame, through the fetcher, and is reported', () => {
  const { posted, location, fire } = fetchedPage()
  const e = fire('click', click(link({ href: 'other.html?q=1' })))
  assert.equal(e.defaultPrevented, true)
  assert.equal(location.href, `${PREFIX}https/example.org/dir/other.html?q=1`)
  assert.deepEqual(posted.at(-1).msg, { type: 'navigate', url: 'https://example.org/dir/other.html?q=1', source: 'kherveos-web' })
})

test('frame helper: links already rewritten by the server are recognised', () => {
  const { posted, location, fire } = fetchedPage()
  fire('click', click(link({ href: `${PREFIX}https/other.org/x` })))
  assert.equal(location.href, `${PREFIX}https/other.org/x`)
  assert.equal(posted.at(-1).msg.url, 'https://other.org/x')
})

test('frame helper: new-tab links, middle clicks and mailto: go to the Browser instead', () => {
  const { posted, location, fire } = fetchedPage()
  const before = location.href
  fire('click', click(link({ href: 'https://other.org/', target: '_blank' })))
  assert.deepEqual(posted.at(-1).msg, { type: 'open', url: 'https://other.org/', background: false, source: 'kherveos-web' })
  fire('auxclick', click(link({ href: '/a' }), { button: 1 }))
  assert.deepEqual(posted.at(-1).msg, { type: 'open', url: 'https://example.org/a', background: true, source: 'kherveos-web' })
  fire('click', click(link({ href: 'mailto:someone@example.org' })))
  assert.equal(posted.at(-1).msg.url, 'mailto:someone@example.org')
  assert.equal(location.href, before) // the page itself stayed
})

test('frame helper: #jumps stay in the page; downloads and handled clicks are left alone', () => {
  const { posted, location, fire } = fetchedPage()
  const n = posted.length
  fire('click', click(link({ href: '#section' })))
  assert.equal(location.hash, '#section')
  const dl = fire('click', click(link({ href: 'file.zip', download: '' })))
  assert.equal(dl.defaultPrevented, false)
  const handled = click(link({ href: 'x.html' }))
  handled.defaultPrevented = true
  fire('click', handled)
  assert.equal(posted.length, n)
})

test('frame helper: window.open opens a Browser tab and returns null', () => {
  const { g, posted } = fetchedPage()
  assert.equal(g.open('/popup?x=1'), null)
  assert.deepEqual(posted.at(-1).msg, { type: 'open', url: 'https://example.org/popup?x=1', background: false, source: 'kherveos-web' })
})

test("frame helper: the page's GET requests go through the fetcher, without credentials", () => {
  const { g, fetched } = fetchedPage()
  g.fetch('/api/data.json', { credentials: 'include' })
  assert.equal(fetched[0].input, `${PREFIX}https/example.org/api/data.json`)
  assert.equal(fetched[0].init.credentials, 'omit')
  g.fetch('/api/save', { method: 'POST', body: 'x' })
  assert.equal(fetched[1].input, '/api/save') // only GETs
  const xhr = new g.XMLHttpRequest()
  xhr.open('GET', 'https://cdn.example.net/x.json')
  assert.equal(xhr.url, `${PREFIX}https/cdn.example.net/x.json`)
  xhr.open('POST', 'https://cdn.example.net/x')
  assert.equal(xhr.url, 'https://cdn.example.net/x')
})

test('frame helper: pushState stays on the fetcher and moves the address bar', () => {
  const { g, posted, location } = fetchedPage()
  g.history.pushState({}, '', '/dir/next')
  assert.equal(location.href, `${PREFIX}https/example.org/dir/next`)
  assert.equal(posted.at(-1).msg.url, 'https://example.org/dir/next')
})

test('frame helper: forms that send data are handed to the real browser', () => {
  const { posted, fire } = fetchedPage()
  const form = { tagName: 'FORM', getAttribute: (n) => ({ method: 'post', action: '/login' })[n] ?? null }
  const e = fire('submit', { target: form, submitter: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } })
  assert.equal(e.defaultPrevented, true)
  assert.deepEqual(posted.at(-1).msg, { type: 'form', url: 'https://example.org/login', method: 'post', source: 'kherveos-web' })
})

// ------------------------------------------------------------ email links

test('email frame: link clicks are posted out, #jumps are not', () => {
  const posted = []
  const listeners = {}
  const g = {
    parent: { postMessage: (m) => posted.push(plain(m)) },
    addEventListener: (t, fn) => (listeners[t] ??= []).push(fn),
  }
  vm.createContext(g)
  vm.runInContext(MAIL_LINK_SCRIPT, g)
  const e = click(link({ href: 'https://news.example.org/a' }))
  listeners.click[0](e)
  assert.equal(e.defaultPrevented, true)
  assert.deepEqual(posted[0], { source: 'kherveos-mail', type: 'link', url: 'https://news.example.org/a', background: false })
  listeners.click[0](click(link({ href: '#top' })))
  assert.equal(posted.length, 1)
})

test('email frame: only web and mail links are accepted, and only our script may run', () => {
  assert.deepEqual(parseMailLink({ source: 'kherveos-mail', type: 'link', url: 'https://x.org/' }), { url: 'https://x.org/', background: false })
  assert.equal(parseMailLink({ source: 'kherveos-mail', type: 'link', url: 'javascript:alert(1)' }), null)
  assert.equal(parseMailLink({ source: 'kherveos-mail', type: 'link', url: 'file:///etc/passwd' }), null)
  assert.equal(parseMailLink({ source: 'other', type: 'link', url: 'https://x.org/' }), null)
  const nonce = makeNonce()
  assert.match(nonce, /^[0-9a-f]{32}$/)
  const csp = mailCsp(false, nonce)
  assert.match(csp, new RegExp(`script-src 'nonce-${nonce}';`))
  assert.doesNotMatch(csp, /unsafe-inline'[^;]*script|https:/)
  assert.match(mailCsp(true, nonce), /img-src data: blob: http: https:/)
})

// ------------------------------------------------- addresses and messages

test('fetcher addresses round-trip', () => {
  for (const url of ['https://example.org/', 'http://example.org/a/b.html?x=1&y=%20z#frag', 'https://example.org:8443/p']) {
    const f = fetchedUrl(PREFIX, url)
    assert.ok(f.startsWith(PREFIX))
    assert.equal(realUrl(PREFIX, f), url)
  }
  assert.equal(fetchedUrl(PREFIX, 'https://bücher.example/ä'), `${PREFIX}https/xn--bcher-kva.example/%C3%A4`)
  for (const other of ['mailto:a@b.c', 'javascript:alert(1)', 'data:text/html,hi', 'https://u:p@x.org/', 'not a url']) {
    assert.equal(fetchedUrl(PREFIX, other), null)
  }
  assert.doesNotMatch(FETCH_SANDBOX, /allow-same-origin|allow-popups|allow-top-navigation/)
})

test('frame messages are checked field by field', () => {
  assert.deepEqual(parseFrameMessage({ source: 'kherveos-web', type: 'location', url: 'https://a.org/', title: ' T ' }), {
    type: 'location',
    url: 'https://a.org/',
    title: 'T',
  })
  assert.equal(parseFrameMessage({ source: 'kherveos-web', type: 'location', url: 'javascript:alert(1)' }), null)
  assert.equal(parseFrameMessage({ source: 'kherveos-web', type: 'open', url: 'file:///x' }), null)
  assert.equal(parseFrameMessage({ source: 'kherveos-web', type: 'eval', url: 'https://a.org/' }), null)
  assert.equal(parseFrameMessage({ type: 'location', url: 'https://a.org/' }), null)
  assert.equal(parseFrameMessage('https://a.org/'), null)
  assert.deepEqual(parseFrameMessage({ source: 'kherveos-web', type: 'error', kind: 'blocked', message: 'No', url: 'javascript:x', status: 403 }), {
    type: 'error',
    kind: 'blocked',
    url: '',
    message: 'No',
    status: 403,
  })
})

test('link clicks: web and mail open in KherveOS; downloads, blob:, data: and #jumps stay', () => {
  const at = (raw, extra = {}) => linkAction({ raw, href: new URL(raw, 'http://localhost:5173/').href, download: false, background: false, ...extra })
  assert.deepEqual(at('https://example.org/x'), { kind: 'open', url: 'https://example.org/x', background: false })
  assert.deepEqual(at('https://example.org/x', { background: true }), { kind: 'open', url: 'https://example.org/x', background: true })
  assert.deepEqual(at('/help.html'), { kind: 'open', url: 'http://localhost:5173/help.html', background: false }) // never navigate KherveOS away
  assert.deepEqual(at('mailto:a@b.org'), { kind: 'open', url: 'mailto:a@b.org', background: false })
  assert.equal(at('https://example.org/file.zip', { download: true }).kind, 'ignore')
  assert.equal(at('blob:http://localhost:5173/1234').kind, 'ignore')
  assert.equal(at('data:text/plain,hi').kind, 'ignore')
  assert.equal(at('#section').kind, 'ignore')
  assert.equal(at('javascript:void 0').kind, 'ignore')
  assert.equal(urlKind(' https://x.org'), 'web')
  assert.equal(urlKind('mailto:x@y.z'), 'mail')
  assert.equal(urlKind('file:///home/user/a.html'), 'file')
  assert.equal(urlKind('blob:http://x/1'), 'none')
  assert.equal(mailtoAddress('mailto:J%C3%A9r%C3%B4me@example.org?subject=Hi'), 'Jérôme@example.org')
})

// --------------------------------------------- Browser: direct, fetch, real

test('the Browser frames, fetches or sends to the real browser', () => {
  const via = (u, hosts) => viaFor(new URL(u), hosts)
  assert.equal(via('https://en.wikipedia.org/wiki/Iron'), 'direct')
  assert.equal(via('https://www.xpsfitting.com/search/label/Iron'), 'direct')
  assert.equal(via('https://github.com/gkerherve/KherveDB-React'), 'fetch')
  assert.equal(via('https://arxiv.org/abs/2101.00001'), 'fetch')
  assert.equal(via('https://scholar.google.com/scholar?q=iron'), 'fetch')
  assert.equal(via('https://scholar.google.fr/scholar?q=iron'), 'fetch')
  assert.equal(via('https://www.google.com/search?q=iron'), 'real')
  assert.equal(via('https://accounts.google.com/'), 'real')
  assert.equal(via('https://github.com/settings/tokens/new?scopes=repo'), 'real')
  assert.equal(via('https://github.com/login'), 'real')
  assert.equal(via('https://console.anthropic.com/settings/keys'), 'real')
  assert.equal(via('https://www.youtube.com/watch?v=abc'), 'real')
  assert.equal(via('https://www.youtube-nocookie.com/embed/abcdefg'), 'direct')
  assert.equal(via('https://example.org/', ['example.org']), 'fetch') // "Show through KherveOS"
  assert.equal(pageFor('https://github.com/x').via, 'fetch')
})

test('search engines: typed text never leaves KherveOS by itself', () => {
  const opts = (id) => ({ engine: SEARCH_ENGINES.find((e) => e.id === id), isFile: () => false, home: '/home/user' })
  assert.deepEqual(resolveInput('xps iron', opts('bing')), { address: 'https://www.bing.com/search?q=xps%20iron' })
  // Google: an address in KherveOS (its "needs your real browser" page), not a new tab.
  assert.deepEqual(resolveInput('xps iron', opts('google')), { address: 'https://www.google.com/search?q=xps%20iron' })
  assert.equal(engineNeedsRealBrowser(SEARCH_ENGINES.find((e) => e.id === 'google')), true)
  assert.equal(engineNeedsRealBrowser(SEARCH_ENGINES.find((e) => e.id === 'bing')), false)
  assert.equal(describePage('https://example.org/a', 'Page title').title, 'Page title')
})

// ------------------------------------- KherveDB: the embedded browsers

test('KherveDB tabs follow the element; hidden tabs load when selected', () => {
  const homes = (el) => ({ xpsfitting: `https://x.org/${el}`, harwell: `https://h.org/${el}/` })
  let f = rf.follow({}, homes('Iron'), 'xpsfitting')
  assert.equal(f.xpsfitting.shown, 'https://x.org/Iron')
  assert.equal(f.xpsfitting.nav, 1)
  assert.equal(f.harwell.shown, '') // not loaded until selected
  f = rf.sync(f, 'harwell')
  assert.equal(f.harwell.shown, 'https://h.org/Iron/')
  // A new element: the visible tab reloads now, the other one when it is selected again.
  f = rf.follow(f, homes('Copper'), 'harwell')
  assert.equal(f.harwell.shown, 'https://h.org/Copper/')
  assert.equal(f.xpsfitting.shown, 'https://x.org/Iron')
  assert.deepEqual(f.xpsfitting.history, ['https://x.org/Copper'])
  f = rf.sync(f, 'xpsfitting')
  assert.equal(f.xpsfitting.shown, 'https://x.org/Copper')
  // Same element again: nothing reloads.
  assert.equal(rf.follow(f, homes('Copper'), 'xpsfitting'), f)
})

test('KherveDB tabs: redirects, followed links, back / forward / reload', () => {
  let f = rf.follow({}, { thermo: 'https://t.org/iron' }, 'thermo')
  const nav = f.thermo.nav
  f = rf.located(f, 'thermo', nav, 'https://t.org/en/iron.html') // first page: a redirect
  assert.deepEqual(f.thermo.history, ['https://t.org/en/iron.html'])
  f = rf.loaded(f, 'thermo', nav)
  f = rf.located(f, 'thermo', nav, 'https://t.org/en/copper.html') // a link followed in the frame
  assert.deepEqual(f.thermo.history, ['https://t.org/en/iron.html', 'https://t.org/en/copper.html'])
  assert.equal(f.thermo.nav, nav) // same frame
  f = rf.step(f, 'thermo', -1, 'thermo')
  assert.equal(f.thermo.index, 0)
  assert.equal(f.thermo.shown, 'https://t.org/en/iron.html')
  assert.equal(f.thermo.nav, nav + 1) // a fresh frame
  f = rf.step(f, 'thermo', 1, 'thermo')
  assert.equal(f.thermo.shown, 'https://t.org/en/copper.html')
  const reloaded = rf.reload(f, 'thermo')
  assert.equal(reloaded.thermo.nav, f.thermo.nav + 1)
  // Messages from an older frame are ignored.
  assert.equal(rf.located(f, 'thermo', nav, 'https://t.org/elsewhere'), f)
  // A search: a new entry, shown now.
  f = rf.go(f, 'thermo', 'https://t.org/search?q=TiO2', 'thermo')
  assert.equal(f.thermo.shown, 'https://t.org/search?q=TiO2')
  assert.equal(f.thermo.index, 2)
})
