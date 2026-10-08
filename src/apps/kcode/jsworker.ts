// The JavaScript runner of kCode: the source of a Web Worker (loaded from a blob), so the
// learner's code runs off the page — it cannot touch the OS and an endless loop is only
// terminated by the timeout. The source is a string, so Node can run it in the tests too
// (with a fake `self`). It must not contain backticks or dollar-brace sequences.
//
// Message in:  { code: string, checks?: { label, test }[] }
// Messages out: { type: 'log', level, text }  while it runs
//               { type: 'done', ok, value?, error?: { name, message, line }, checks? }

export const JS_WORKER_SOURCE = String.raw`
var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
var realSetTimeout = self.setTimeout.bind(self);
var realSetInterval = self.setInterval.bind(self);
var realClearTimeout = self.clearTimeout.bind(self);
var realClearInterval = self.clearInterval.bind(self);

function isIdent(k) { return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k); }

function inspect(v, depth, seen, top) {
  depth = depth || 0; seen = seen || [];
  var t = typeof v;
  if (v === null) return 'null';
  if (t === 'undefined') return 'undefined';
  if (t === 'string') return top ? v : "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  if (t === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (t === 'bigint') return String(v) + 'n';
  if (t === 'boolean') return String(v);
  if (t === 'symbol') return v.toString();
  if (t === 'function') {
    var src = Function.prototype.toString.call(v);
    if (/^class[\s{]/.test(src)) return '[class ' + (v.name || '(anonymous)') + (Object.getPrototypeOf(v) && Object.getPrototypeOf(v).name ? ' extends ' + Object.getPrototypeOf(v).name : '') + ']';
    return '[' + (/^async\b/.test(src) ? 'AsyncFunction' : 'Function') + (v.name ? ': ' + v.name : ' (anonymous)') + ']';
  }
  if (seen.indexOf(v) >= 0) return '[Circular]';
  if (v instanceof Error) {
    var head = (v.name || 'Error') + ': ' + v.message;
    return depth === 0 ? head : '[' + head + ']';
  }
  if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
  if (v instanceof RegExp) return String(v);
  if (typeof Promise !== 'undefined' && v instanceof Promise) return 'Promise { <pending> }';
  if (typeof WeakMap !== 'undefined' && (v instanceof WeakMap || v instanceof WeakSet)) return v.constructor.name + ' { <items unknown> }';
  var isArr = Array.isArray(v);
  var isTyped = ArrayBuffer.isView(v) && !(v instanceof DataView);
  var isMap = v instanceof Map, isSet = v instanceof Set;
  if (depth > 3) return isArr ? '[Array]' : (isMap ? '[Map]' : (isSet ? '[Set]' : '[Object]'));
  var next = seen.concat([v]);
  var parts = [], prefix = '', open = '{', close = '}';
  var ctor = v.constructor && v.constructor.name;
  if (isArr || isTyped) {
    open = '['; close = ']';
    if (isTyped) prefix = ctor + '(' + v.length + ') ';
    var n = Math.min(v.length, 100);
    var holes = 0;
    for (var i = 0; i < n; i++) {
      if (isArr && !(i in v)) { holes++; continue; }
      if (holes) { parts.push('<' + holes + ' empty item' + (holes > 1 ? 's' : '') + '>'); holes = 0; }
      parts.push(inspect(v[i], depth + 1, next));
    }
    if (holes) parts.push('<' + holes + ' empty item' + (holes > 1 ? 's' : '') + '>');
    if (v.length > n) parts.push('... ' + (v.length - n) + ' more item' + (v.length - n > 1 ? 's' : ''));
    if (isArr) Object.keys(v).filter(function (k) { return !/^\d+$/.test(k); }).forEach(function (k) { parts.push((isIdent(k) ? k : "'" + k + "'") + ': ' + inspect(v[k], depth + 1, next)); });
    if (isArr && ctor && ctor !== 'Array') prefix = ctor + '(' + v.length + ') ';
  } else if (isMap) {
    prefix = 'Map(' + v.size + ') ';
    v.forEach(function (val, key) { parts.push(inspect(key, depth + 1, next) + ' => ' + inspect(val, depth + 1, next)); });
  } else if (isSet) {
    prefix = 'Set(' + v.size + ') ';
    v.forEach(function (val) { parts.push(inspect(val, depth + 1, next)); });
  } else {
    if (ctor && ctor !== 'Object') prefix = ctor + ' ';
    else if (!ctor && Object.getPrototypeOf(v) === null) prefix = '[Object: null prototype] ';
    var keys = Object.keys(v);
    keys.slice(0, 100).forEach(function (k) {
      var d = Object.getOwnPropertyDescriptor(v, k);
      var shown = d && (d.get || d.set) ? (d.get && d.set ? '[Getter/Setter]' : d.get ? '[Getter]' : '[Setter]') : inspect(v[k], depth + 1, next);
      parts.push((isIdent(k) ? k : "'" + k + "'") + ': ' + shown);
    });
    if (keys.length > 100) parts.push('... ' + (keys.length - 100) + ' more properties');
    Object.getOwnPropertySymbols(v).forEach(function (s) { parts.push('[' + s.toString() + ']: ' + inspect(v[s], depth + 1, next)); });
  }
  if (!parts.length) return prefix + open + close;
  var one = prefix + open + ' ' + parts.join(', ') + ' ' + close;
  if (one.length <= 72 && one.indexOf('\n') < 0) return one;
  var pad = '  ';
  return prefix + open + '\n' + parts.map(function (p) { return pad + p.replace(/\n/g, '\n' + pad); }).join(',\n') + '\n' + close;
}

function show(args) {
  return args.map(function (a) { return typeof a === 'string' ? a : inspect(a, 0, [], false); }).join(' ');
}

function table(data) {
  if (data === null || typeof data !== 'object') return inspect(data, 0, [], true);
  var rows = [], cols = [], hasValues = false;
  var entries = data instanceof Map ? Array.from(data.entries()) : Object.keys(data).map(function (k) { return [k, data[k]]; });
  entries.forEach(function (e) {
    var row = { __idx: String(e[0]) };
    var val = e[1];
    if (val !== null && typeof val === 'object') {
      Object.keys(val).forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); row[c] = inspect(val[c], 1, [], false); });
    } else { hasValues = true; row.__val = inspect(val, 1, [], false); }
    rows.push(row);
  });
  var heads = ['(index)'].concat(cols).concat(hasValues ? ['Values'] : []);
  var keys = ['__idx'].concat(cols).concat(hasValues ? ['__val'] : []);
  var widths = heads.map(function (h, i) { return Math.max(h.length, Math.max.apply(null, rows.map(function (r) { return (r[keys[i]] || '').length; }).concat([0]))); });
  var cell = function (s, i) { s = s || ''; var gap = widths[i] - s.length; var l = Math.floor(gap / 2); return ' ' + ' '.repeat(l) + s + ' '.repeat(gap - l) + ' '; };
  var line = function (l, m, r) { return l + widths.map(function (w) { return '─'.repeat(w + 2); }).join(m) + r; };
  var out = [line('┌', '┬', '┐'), '│' + heads.map(cell).join('│') + '│', line('├', '┼', '┤')];
  rows.forEach(function (r) { out.push('│' + keys.map(function (k, i) { return cell(r[k], i); }).join('│') + '│'); });
  out.push(line('└', '┴', '┘'));
  return out.join('\n');
}

// Where an error happened in the learner's code: the function body starts on line 3 of
// the compiled text ("(async function anonymous(args\n) {\n").
var LINE_OFFSET = 2;
function lineOf(err) {
  var m = err && err.stack && /<anonymous>:(\d+):(\d+)/.exec(String(err.stack));
  return m ? Number(m[1]) - LINE_OFFSET : null;
}

function compile(params, body) { return new AsyncFunction(params, body); }
var PARAMS = ['console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', '__logs'];

// The first line n for which the first n lines already fail with the same message.
function syntaxLine(lines, message) {
  for (var n = 1; n <= lines.length; n++) {
    try { compile(PARAMS, lines.slice(0, n).join('\n')); }
    catch (e) { if (e && e.message === message) return n; }
  }
  return null;
}

var STATEMENT_START = /^\s*(function|class|async\s+function|const|let|var|if|for|while|do|return|throw|try|switch|import|export|break|continue|\}|\)|\])/;

// Split off a trailing expression so its value can be shown ("2 + 3" on the last line).
function splitLast(code) {
  var lines = code.split('\n');
  var end = lines.length;
  while (end > 0 && (!lines[end - 1].trim() || /^\s*\/\//.test(lines[end - 1]))) end--;
  for (var k = end - 1; k >= 0 && k >= end - 40; k--) {
    var tail = lines.slice(k, end).join('\n').replace(/[;\s]+$/, '');
    if (!tail.trim() || STATEMENT_START.test(tail)) continue;
    try { compile(PARAMS, 'return (\n' + tail + '\n)'); } catch (e) { continue; }
    var prefix = lines.slice(0, k);
    try { compile(PARAMS, prefix.join('\n')); } catch (e) { continue; }
    return { prefix: prefix, tail: tail.split('\n'), rest: lines.slice(end) };
  }
  return null;
}

// The text that is compiled: the code (its lines unchanged), the value of its last
// expression, then the checks, which run in the same scope.
function buildProgram(code, checks) {
  var src = 'var __kc_last; ';
  var split = splitLast(code);
  if (split) {
    var body = split.prefix.slice();
    body.push(';__kc_last = (' + split.tail[0]);
    for (var i = 1; i < split.tail.length; i++) body.push(split.tail[i]);
    body.push(');');
    src += body.join('\n') + '\n' + split.rest.join('\n');
  } else {
    src += code;
  }
  src += '\n;var __kc_checks = [];\n';
  (checks || []).forEach(function (c) {
    src += '__kc_checks.push(await (async function () { var __label = ' + JSON.stringify(c.label) + '; try { var __r = await (async function () { return (\n' + c.test +
      '\n); })(); if (__r === true || (__r && typeof __r !== "string")) return { label: __label, ok: true, detail: "" };' +
      ' return { label: __label, ok: false, detail: typeof __r === "string" ? __r : "" }; } catch (__e) { return { label: __label, ok: false, detail: (__e && __e.name ? __e.name + ": " : "") + (__e && __e.message ? __e.message : String(__e)) }; } })());\n';
  });
  src += 'return { last: __kc_last, checks: __kc_checks };';
  return src;
}

function describe(err, lines, compiling) {
  var name = err && err.name ? err.name : 'Error';
  var message = err && err.message !== undefined ? String(err.message) : String(err);
  var line = compiling ? null : lineOf(err);
  if (line === null && name === 'SyntaxError' && lines) line = syntaxLine(lines, message);
  return { name: name, message: message, line: line };
}

self.onmessage = async function (e) {
  var data = e.data || {};
  var code = String(data.code || '');
  var post = function (m) { self.postMessage(m); };
  var indent = '';
  var logs = [];
  var MAX_LINES = 5000, lines_out = 0;
  var level = function (lv) {
    return function () {
      if (++lines_out > MAX_LINES) {
        if (lines_out === MAX_LINES + 1) post({ type: 'log', level: 'warn', text: '(more than ' + MAX_LINES + ' lines logged: the rest is not shown)' });
        return;
      }
      var text = show(Array.prototype.slice.call(arguments));
      text = indent ? text.split('\n').map(function (l) { return indent + l; }).join('\n') : text;
      logs.push(text);
      post({ type: 'log', level: lv, text: text });
    };
  };
  var counts = {}, timers = {};
  var con = {
    log: level('log'), info: level('info'), debug: level('log'), warn: level('warn'), error: level('error'), trace: level('log'),
    dir: function (v) { level('log')(inspect(v, 0, [], true)); },
    table: function (d) { level('log')(table(d)); },
    group: function () { if (arguments.length) level('log')(...arguments); indent += '  '; },
    groupEnd: function () { indent = indent.slice(0, -2); },
    assert: function (c) { if (!c) { var rest = Array.prototype.slice.call(arguments, 1); level('error')('Assertion failed' + (rest.length ? ': ' + show(rest) : '')); } },
    count: function (l) { l = l === undefined ? 'default' : String(l); counts[l] = (counts[l] || 0) + 1; level('log')(l + ': ' + counts[l]); },
    countReset: function (l) { counts[l === undefined ? 'default' : String(l)] = 0; },
    time: function (l) { timers[l === undefined ? 'default' : String(l)] = Date.now(); },
    timeEnd: function (l) { l = l === undefined ? 'default' : String(l); if (l in timers) { level('log')(l + ': ' + (Date.now() - timers[l]) + 'ms'); delete timers[l]; } },
    timeLog: function (l) { l = l === undefined ? 'default' : String(l); if (l in timers) level('log')(l + ': ' + (Date.now() - timers[l]) + 'ms'); },
  };

  // Timers are counted, so the run waits for them before it is done.
  var pending = new Set();
  var uncaught = function (err) { level('error')('Uncaught ' + (err && err.name ? err.name + ': ' + err.message : String(err))); };
  var wrapTimer = function (real, repeat) {
    return function (fn, ms) {
      var extra = Array.prototype.slice.call(arguments, 2);
      var id = real(function () {
        if (!repeat) pending.delete(id);
        try { var r = typeof fn === 'function' ? fn.apply(null, extra) : undefined; if (r && typeof r.catch === 'function') r.catch(uncaught); } catch (err) { uncaught(err); }
      }, ms);
      pending.add(id);
      return id;
    };
  };
  var mySetTimeout = wrapTimer(realSetTimeout, false);
  var mySetInterval = wrapTimer(realSetInterval, true);
  var myClearTimeout = function (id) { pending.delete(id); realClearTimeout(id); };
  var myClearInterval = function (id) { pending.delete(id); realClearInterval(id); };
  self.onunhandledrejection = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); uncaught(ev && ev.reason); };

  var program = buildProgram(code, data.checks);
  var lines = code.split('\n');
  var fn;
  try {
    fn = compile(PARAMS, program);
  } catch (err) {
    post({ type: 'done', ok: false, error: describe(err, lines, true) });
    return;
  }
  try {
    var r = await fn(con, mySetTimeout, mySetInterval, myClearTimeout, myClearInterval, logs);
    while (pending.size) await new Promise(function (res) { realSetTimeout(res, 10); });
    post({
      type: 'done', ok: true,
      value: r && r.last !== undefined ? inspect(r.last, 0, [], false) : undefined,
      checks: r && r.checks,
    });
  } catch (err) {
    post({ type: 'done', ok: false, error: describe(err, lines), pending: pending.size });
  }
};
`
