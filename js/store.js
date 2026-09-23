// Checkpoint: shared state + helpers. Everything lives in this browser only.
window.CP = window.CP || {};
(function (CP) {
  const KEY = 'checkpoint_v2';

  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  const blank = () => ({
    day: todayStr(),
    cutoff: '12:04',
    dueouts: null,          // { rows, importedAt, fileName }
    diff: null,             // { vsAt, resolved, newly, pending }
    co: { reported: {}, processed: {} }, // room -> timestamp
    tags: {},               // conf/room -> balance tag
    rounds: [],             // each list sent to Concierge: { at, rooms }
    checks: [],             // timestamps of every due-out import today
    theme: null
  });

  let state;
  function load() {
    try { state = JSON.parse(localStorage.getItem(KEY)) || blank(); } catch (e) { state = blank(); }
    if (state.day !== todayStr()) { const theme = state.theme; state = blank(); state.theme = theme; }
    const b = blank();
    for (const k in b) if (state[k] === undefined) state[k] = b[k];
    if (!state.co.reported) state.co.reported = {};
    if (!state.co.processed) state.co.processed = {};
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ } }

  const listeners = [];
  CP.state = () => state;
  CP.update = (fn) => { fn(state); save(); listeners.forEach(l => { try { l(); } catch (e) { console.error(e); } }); };
  CP.onChange = (l) => listeners.push(l);
  CP.newShift = () => { const theme = state.theme; state = blank(); state.theme = theme; save(); listeners.forEach(l => l()); };
  CP.todayStr = todayStr;
  load();

  // ---------- rooms & buildings ----------
  CP.BUILDINGS = [
    { key: '1', name: 'Zumroud' },
    { key: '2', name: 'Amwaj' },
    { key: '3', name: 'Marmar' }
  ];
  CP.BUILDING_ORDER = ['Zumroud', 'Amwaj', 'Marmar', 'Other'];
  CP.building = (room) => {
    const b = CP.BUILDINGS.find(b => b.key === String(room).trim()[0]);
    return b ? b.name : 'Other';
  };
  CP.sortRooms = (arr) => arr.slice().sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  CP.groupByBuilding = (rooms) => {
    const g = {};
    rooms.forEach(r => { const b = CP.building(r); (g[b] = g[b] || []).push(r); });
    for (const b in g) g[b] = CP.sortRooms(g[b]);
    return g;
  };

  // ---------- time ----------
  CP.toMinutes = (t) => {
    const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(String(t || '').trim());
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  };
  CP.fromMinutes = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  CP.nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  CP.nowHHMM = () => CP.fromMinutes(CP.nowMinutes());
  CP.normTime = (t) => { const m = CP.toMinutes(t); return m === null ? '' : CP.fromMinutes(m); };
  CP.ago = (ts) => {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    return h + ' h ' + (m % 60) + ' min ago';
  };
  CP.minsSince = (hhmm, fallbackTs) => {
    const m = CP.toMinutes(hhmm);
    if (m === null) return fallbackTs ? Math.max(0, Math.round((Date.now() - fallbackTs) / 60000)) : 0;
    return Math.max(0, CP.nowMinutes() - m);
  };
  CP.fmtDur = (mins) => mins < 60 ? mins + ' min' : Math.floor(mins / 60) + ' h ' + String(mins % 60).padStart(2, '0');

  // ---------- departure status ----------
  CP.ETD_CODES = {
    '12:01': 'Preparing',
    '12:02': 'Luggage help',
    '12:04': 'Unreachable',
    '12:05': 'Left',
    '12:06': 'Extension'
  };
  CP.STATUS_LABEL = {
    check: 'To check', co: 'Checked out', left: 'Left', ext: 'Extension', later: 'Not yet', na: 'Not a room'
  };
  CP.roomStatus = (r, s) => {
    s = s || state;
    if (r.roomType === 'PM' || !/^\d{4}$/.test(r.room)) return 'na';
    const etd = (r.etd || '').trim();
    if (s.co.reported[r.room]) return 'co';
    if (etd === '12:05') return 'left';
    if (etd === '12:06') return 'ext';
    const cut = CP.toMinutes(s.cutoff), m = CP.toMinutes(etd);
    if (etd === '' || m === null || cut === null || m < cut) return 'check';
    return 'later';
  };
  CP.rowByRoom = (room, s) => {
    s = s || state;
    if (!s.dueouts) return null;
    return s.dueouts.rows.find(r => r.room === String(room)) || null;
  };

  CP.parseBalance = (raw) => {
    if (!raw) return 0;
    const str = String(raw);
    const negative = /-/.test(str) || /\bCR\b/i.test(str);
    const num = (str.match(/[\d,]+(?:\.\d+)?/) || ['0'])[0].replace(/,/g, '');
    const val = parseFloat(num) || 0;
    return negative ? -val : val;
  };

  // ---------- room number extraction (shared by checkouts + tools) ----------
  const NUM = '(?<![\\d:./])\\d{4}(?![\\d:/])';
  CP.allRoomNumbers = (text) => (String(text).match(new RegExp(NUM, 'g')) || []);

  // ---------- on-demand libraries (keeps first load instant) ----------
  const loading = {};
  CP.loadScript = (src) => loading[src] || (loading[src] = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.async = true;
    el.onload = resolve;
    el.onerror = () => { delete loading[src]; reject(new Error('load failed: ' + src)); };
    document.head.appendChild(el);
  }));
  CP.LIB = {
    ocr: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
  };

  // ---------- UI helpers ----------
  CP.esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  CP.toast = (msg) => {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 1900);
  };
  CP.copy = async (text, label) => {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove();
    }
    CP.toast(label || 'Copied');
  };
  CP.plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  // Opera list box: wraps between rooms, never inside a number. Copy buttons use the plain string.
  CP.operaBox = (rooms, id) =>
    `<div class="opera" ${id ? `id="${id}"` : ''} tabindex="0" aria-label="Opera list">` +
    rooms.map((r, i) => `<span>${CP.esc(r)}${i < rooms.length - 1 ? ',' : ''}</span>`).join('') + `</div>`;

  // key-tag tile markup
  CP.tile = (room, cls, sub, extra) =>
    `<button class="tile ${cls || ''}" type="button" data-room="${CP.esc(room)}" ${extra || ''}>` +
    `<span class="num">${CP.esc(room)}</span>` +
    (sub ? `<span class="sub">${CP.esc(sub)}</span>` : '') +
    `</button>`;

  // bottom sheet / dialog
  CP.sheet = (html, bind) => {
    const dlg = document.getElementById('sheet');
    const body = document.getElementById('sheet-body');
    body.innerHTML = html;
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    if (bind) bind(body, CP.closeSheet);
  };
  CP.closeSheet = () => {
    const dlg = document.getElementById('sheet');
    if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  };
})(window.CP);
