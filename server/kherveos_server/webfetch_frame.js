/* KherveOS page fetcher: the helper put at the top of every fetched page (see webfetch.py).
 *
 * The page runs in a sandboxed frame without allow-same-origin, so this script
 * (like the page's own) can't reach KherveOS's cookies or storage. It:
 *   - tells the KherveOS Browser where the page is (postMessage), so its address bar follows;
 *   - keeps link clicks inside the frame, through the fetcher;
 *   - hands new-tab links, window.open and mailto: to the Browser instead;
 *   - sends the page's own GET fetch / XMLHttpRequest calls through the fetcher;
 *   - declines cookie banners (the desktop KherveDB's src-tauri/src/cookie_banner.js).
 * window.__KHERVEOS_WEB__ = {url, prefix, origin} is set just before this script.
 */
(function () {
  'use strict';
  var C = window.__KHERVEOS_WEB__ || {};
  try { delete window.__KHERVEOS_WEB__; } catch (e) { /* ignore */ }
  var PAGE = String(C.url || '');
  var PREFIX = String(C.prefix || '');
  var ORIGIN = String(C.origin || '');
  if (!PAGE || !PREFIX) return;
  var framed = window.parent !== window;

  function post(msg) {
    if (!framed) return;
    msg.source = 'kherveos-web';
    // Only the KherveOS window gets it (a fetched page framed inside another one does not).
    try { window.parent.postMessage(msg, ORIGIN || '*'); } catch (e) { /* ignore */ }
  }

  /** A fetcher address back to the real one ("https://host/path"). */
  function real(u) {
    u = String(u);
    if (u.indexOf(PREFIX) !== 0) return u;
    var rest = u.slice(PREFIX.length);
    var i = rest.indexOf('/');
    if (i < 0) return u;
    return rest.slice(0, i) + '://' + rest.slice(i + 1);
  }

  /** A web address (relative to the page) as a fetcher address, or null for other kinds. */
  function proxied(u) {
    var x;
    try { x = new URL(String(u), document.baseURI); } catch (e) { return null; }
    if (x.href.indexOf(PREFIX) === 0) return x.href;
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return null;
    if (x.username || x.password) return null;
    return PREFIX + x.protocol.slice(0, -1) + '/' + x.host + x.pathname + x.search + x.hash;
  }

  function here() {
    var hash = location.hash || '';
    return PAGE.split('#')[0] + hash;
  }

  function report() {
    post({ type: 'location', url: here(), title: document.title || '' });
  }

  function go(url) {
    var p = proxied(url);
    if (!p) return;
    post({ type: 'navigate', url: real(p) });
    location.href = p;
  }

  // ------------------------------------------------------------ links
  function linkOf(e) {
    var t = e.target;
    return t && t.closest ? t.closest('a[href], area[href]') : null;
  }

  function onClick(e, aux) {
    if (e.defaultPrevented) return;
    var a = linkOf(e);
    if (!a || a.hasAttribute('download')) return;
    var raw = (a.getAttribute('href') || '').trim();
    if (raw.charAt(0) === '#') {
      if (aux) return;
      e.preventDefault(); // a jump inside the page (the <base> points at the real site)
      if (raw.length > 1) location.hash = raw;
      else window.scrollTo(0, 0);
      return;
    }
    var href = real(a.href);
    if (/^javascript:/i.test(href)) return;
    var target = (a.getAttribute('target') || '').toLowerCase();
    var background = aux || e.metaKey || e.ctrlKey;
    var newTab = background || e.shiftKey ||
      (target !== '' && target !== '_self' && target !== '_parent' && target !== '_top');
    e.preventDefault();
    if (!/^https?:/i.test(href)) {
      post({ type: 'open', url: href, background: false }); // mailto:, tel:…
      return;
    }
    if (newTab) post({ type: 'open', url: href, background: background });
    else go(href);
  }
  window.addEventListener('click', function (e) { if (e.button === 0) onClick(e, false); }, false);
  window.addEventListener('auxclick', function (e) { if (e.button === 1) onClick(e, true); }, false);

  // ------------------------------------------------------------ forms
  window.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    var f = e.target;
    if (!f || f.tagName !== 'FORM') return;
    var s = e.submitter || null;
    var method = ((s && s.getAttribute('formmethod')) || f.getAttribute('method') || 'get').toLowerCase();
    if (method === 'dialog') return;
    var action = (s && s.getAttribute('formaction')) || f.getAttribute('action') || '';
    var target;
    try { target = new URL(action ? real(new URL(action, document.baseURI).href) : PAGE); } catch (err) { return; }
    e.preventDefault();
    if (method !== 'get') {
      post({ type: 'form', url: target.href, method: method });
      return;
    }
    try {
      var data = s ? new FormData(f, s) : new FormData(f);
      var q = new URLSearchParams();
      data.forEach(function (v, k) { q.append(k, typeof v === 'string' ? v : v.name); });
      target.search = q.toString();
      target.hash = '';
    } catch (err) { /* keep the bare action */ }
    go(target.href);
  }, false);

  // ------------------------------------------ new windows, page requests
  try {
    window.open = function (u) {
      if (u) {
        try { post({ type: 'open', url: real(new URL(String(u), document.baseURI).href), background: false }); } catch (e) { /* ignore */ }
      }
      return null;
    };
  } catch (e) { /* ignore */ }

  var ofetch = window.fetch;
  if (ofetch) {
    window.fetch = function (input, init) {
      try {
        var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (method === 'GET') {
          if (typeof input === 'string' || input instanceof URL) {
            var p = proxied(input);
            if (p) {
              input = p;
              init = Object.assign({}, init || {}, { credentials: 'omit', mode: 'cors' });
            }
          } else if (typeof Request !== 'undefined' && input instanceof Request) {
            var p2 = proxied(input.url);
            if (p2 && p2 !== input.url) input = new Request(p2, { headers: input.headers, credentials: 'omit', mode: 'cors' });
          }
        }
      } catch (e) { /* send it as it was */ }
      return ofetch.call(this, input, init);
    };
  }
  var oopen = window.XMLHttpRequest && XMLHttpRequest.prototype.open;
  if (oopen) {
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      try {
        if (String(method).toUpperCase() === 'GET') {
          var p = proxied(url);
          if (p) args[1] = p;
        }
      } catch (e) { /* ignore */ }
      return oopen.apply(this, args);
    };
  }
  ['pushState', 'replaceState'].forEach(function (k) {
    var o = history[k];
    if (!o) return;
    history[k] = function (state, title, u) {
      var args = Array.prototype.slice.call(arguments);
      if (u != null) {
        var p = proxied(u);
        if (p) args[2] = p;
      }
      var r = o.apply(this, args);
      try {
        var at = real(location.href);
        PAGE = at;
        post({ type: 'location', url: at, title: document.title || '' });
      } catch (e) { /* ignore */ }
      return r;
    };
  });

  report();
  document.addEventListener('DOMContentLoaded', report);
  window.addEventListener('load', report);
  window.addEventListener('hashchange', report);

  // ------------------------------------------------- cookie banners
  // From KherveDB-React src-tauri/src/cookie_banner.js: reject / necessary only.
  var REJECT = /^(reject all|reject|reject all cookies|reject non-essential|reject non-essential cookies|reject optional cookies|deny all|decline|decline all|refuse|refuse all|deny|only necessary|necessary only|use necessary cookies only|allow necessary cookies only|essential cookies only|only essential cookies|continue without accepting|tout refuser|refuser)$/i;
  var IDS = ['onetrust-reject-all-handler', 'CybotCookiebotDialogBodyButtonDecline', 'truste-consent-required', 'cookieChoiceDismiss'];
  var SEL = '[data-testid=uc-deny-all-button], button[data-action=deny], .cmpboxbtnno';
  var HIDE = '#onetrust-consent-sdk,#onetrust-banner-sdk,.onetrust-pc-dark-filter,#CybotCookiebotDialog,' +
    '#usercentrics-root,#cookieChoiceInfo,.cc-window,.cookie-banner,#cookie-banner,.cookie-notice,#cookie-notice,.cmp-container,#truste-consent-track';
  // Only buttons inside something that looks like a consent banner: a "Decline" elsewhere is the page's own.
  var BANNER = /cookie|consent|gdpr|privacy|cmp|onetrust|didomi|usercentrics|cookiebot|truste|sp_message|qc-cmp/i;
  function inBanner(el) {
    for (var n = el, depth = 0; n && depth < 25; depth++) {
      if (n.nodeType === 1) {
        var label = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '') + ' ' + (n.getAttribute('aria-label') || '');
        if (BANNER.test(label)) return true;
        n = n.parentNode;
      } else {
        n = n.host || null; // out of a shadow root
      }
    }
    return false;
  }
  function decline() {
    try {
      for (var i = 0; i < IDS.length; i++) {
        var b = document.getElementById(IDS[i]);
        if (b && b.offsetParent !== null) { b.click(); return true; }
      }
      var roots = [document];
      document.querySelectorAll('*').forEach(function (el) { if (el.shadowRoot) roots.push(el.shadowRoot); });
      for (var r = 0; r < roots.length; r++) {
        var d = roots[r].querySelector(SEL);
        if (d) { d.click(); return true; }
        var els = roots[r].querySelectorAll('button, [role=button], input[type=button], input[type=submit], a');
        for (var j = 0; j < els.length; j++) {
          var t = (els[j].innerText || els[j].value || '').trim().replace(/\s+/g, ' ');
          if (t.length < 50 && REJECT.test(t) && els[j].getClientRects().length && inBanner(els[j])) { els[j].click(); return true; }
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  function style(css) {
    if (!document.head) { setTimeout(function () { style(css); }, 50); return; }
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }
  // Banners with no reject button (TrustArc) are hidden straight away. (Scrolling is
  // only forced back on when a banner was there: other pages may lock it on purpose.)
  var TRUSTE = '#truste-consent-track,.truste_overlay,.truste_box_overlay,#truste-consent-content';
  style(TRUSTE + '{display:none !important;}');
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (tries === 4 && document.querySelector(TRUSTE)) style('html,body{overflow:auto !important;}');
    if (decline() || tries > 40) {
      clearInterval(timer);
      if (tries > 40 && document.querySelector(HIDE)) style(HIDE + '{display:none !important;} body{overflow:auto !important;}');
    }
  }, 500);
})();
