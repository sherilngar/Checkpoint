(function (CP) {
  const $ = (id) => document.getElementById(id);
  const VIEWS = ['departures', 'checkouts', 'waiting', 'tools'];
  let current = 'departures';

  // ---------- header actions per tab ----------
  const ACTIONS = {
    departures: [
      { id: 'import', label: 'Import export', primary: true },
      { id: 'reset-dep', label: 'Reset departures' }
    ],
    checkouts: [
      { id: 'reset-co', label: 'Reset checkouts' }
    ],
    waiting: [],
    tools: []
  };

  function renderActions() {
    $('view-actions').innerHTML = (ACTIONS[current] || []).map(a =>
      `<button class="btn ${a.primary ? 'primary' : ''}" data-action="${a.id}" type="button">${a.label}</button>`).join('');
  }

  // ---------- routing ----------
  function go(view) {
    if (!VIEWS.includes(view)) view = 'departures';
    current = view;
    VIEWS.forEach(v => { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('.nav-btn[data-view]').forEach(b => {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('view-title').textContent = $('view-' + view).dataset.title;
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    renderActions();
    window.scrollTo(0, 0);
  }
  CP.go = go;
  CP.currentView = () => current;

  function importNow() { go('departures'); $('dep-file').click(); }

  function confirm(title, body, yesLabel, onYes) {
    CP.sheet(`
      <div class="sheet-head"><div><h2>${title}</h2><p class="meta">${body}</p></div>
      <button class="icon-btn" data-close type="button" aria-label="Close">✕</button></div>
      <div class="sheet-actions"><button class="btn primary danger" data-yes type="button">${yesLabel}</button><button class="btn" data-no type="button">Cancel</button></div>`,
    (el, close) => {
      el.querySelector('[data-close]').onclick = close;
      el.querySelector('[data-no]').onclick = close;
      el.querySelector('[data-yes]').onclick = () => { close(); onYes(); };
      setTimeout(() => el.querySelector('[data-yes]').focus(), 30);
    });
  }

  function runAction(id) {
    if (id === 'import') return importNow();
    if (id === 'reset-dep') return confirm('Reset departures?',
      'Clears the imported due-out list, the check history, the comparison and the balance tags. Your cutoff time stays. The checkout log is not touched.',
      'Reset departures', CP.resetDepartures);
    if (id === 'reset-co') return confirm('Reset checkouts?',
      'Clears the screenshot result and today\'s checkout log. Rooms Concierge reported go back onto the physical check list.',
      'Reset checkouts', CP.resetCheckouts);
  }

  // ---------- theme / new shift ----------
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    CP.update(s => { s.theme = t; });
  }
  const toggleTheme = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

  function confirmNewShift() {
    confirm('Start a new shift?',
      'Clears departures, the checkout log, balance tags and waiting cards. Your cutoff time and theme stay.',
      'Clear and start fresh',
      () => { const cut = CP.state().cutoff; CP.newShift(); CP.update(s => { s.cutoff = cut; }); CP.toast('New shift started'); go('departures'); });
  }

  // ---------- command palette ----------
  function commands() {
    const s = CP.state();
    return [
      { label: 'Import due-out export', hint: 'Departures', run: importNow },
      { label: 'Copy list for Concierge', hint: `${CP.dep.checkRooms(s).length} rooms`, run: () => { go('departures'); CP.copy(CP.dep.conciergeText(s), 'Concierge list copied'); } },
      { label: 'Copy rooms to check as Opera list', hint: 'Departures', run: () => { const r = CP.sortRooms(CP.dep.checkRooms(s)); CP.copy(r.join(','), `Copied ${CP.plural(r.length, 'room')}`); } },
      { label: 'Read a checkout screenshot', hint: 'Or just paste it', run: () => { go('checkouts'); $('ex-drop').focus(); } },
      { label: 'Copy checkouts to process in Opera', hint: `${CP.unprocessedCheckouts().length} rooms`, run: () => { const r = CP.unprocessedCheckouts(); CP.copy(r.join(','), `Copied ${CP.plural(r.length, 'room')}`); } },
      { label: 'Reset departures', hint: '', run: () => runAction('reset-dep') },
      { label: 'Reset checkouts', hint: '', run: () => runAction('reset-co') },
      { label: 'New waiting card', hint: 'Waiting cards', run: () => { go('waiting'); setTimeout(() => $('wc-form').querySelector('[name=name]').focus(), 30); } },
      { label: 'Turn any text into an Opera list', hint: 'Room lists', run: () => { go('tools'); setTimeout(() => $('tl-input').focus(), 30); } },
      { label: 'Go to Departures', hint: '1', run: () => go('departures') },
      { label: 'Go to Checkouts', hint: '2', run: () => go('checkouts') },
      { label: 'Go to Waiting cards', hint: '3', run: () => go('waiting') },
      { label: 'Go to Room lists', hint: '4', run: () => go('tools') },
      { label: document.documentElement.getAttribute('data-theme') === 'dark' ? 'Switch to day mode' : 'Switch to night mode', hint: '', run: toggleTheme },
      { label: 'Start new shift', hint: 'Clears today', run: confirmNewShift }
    ];
  }

  function openPalette() {
    const list = commands();
    CP.sheet(`
      <div class="palette">
        <input id="pal-q" class="pal-input" placeholder="Type a command or a room number" autocomplete="off" spellcheck="false">
        <ul id="pal-list" class="pal-list" role="listbox"></ul>
      </div>`, (el, close) => {
      const q = el.querySelector('#pal-q'), ul = el.querySelector('#pal-list');
      let sel = 0, shown = [];
      const draw = () => {
        const t = q.value.trim().toLowerCase();
        shown = list.filter(c => !t || c.label.toLowerCase().includes(t));
        if (/^\d{4}$/.test(t)) shown.unshift({ label: `Open room ${t}`, hint: CP.building(t), run: () => CP.openRoom(t), keepOpen: true });
        sel = Math.min(sel, Math.max(0, shown.length - 1));
        ul.innerHTML = shown.map((c, i) => `<li role="option" aria-selected="${i === sel}" data-i="${i}"><span>${CP.esc(c.label)}</span><em>${CP.esc(c.hint)}</em></li>`).join('') || `<li class="pal-none">No command matches.</li>`;
      };
      const runSel = (i) => { const c = shown[i]; if (!c) return; if (!c.keepOpen) close(); c.run(); };
      q.addEventListener('input', () => { sel = 0; draw(); });
      q.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); draw(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
        else if (e.key === 'Enter') { e.preventDefault(); runSel(sel); }
      });
      ul.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) runSel(+li.dataset.i); });
      draw();
      setTimeout(() => q.focus(), 20);
    });
  }
  CP.openPalette = openPalette;

  // ---------- clock + render loop ----------
  function renderClock() {
    const d = new Date();
    $('clock').innerHTML = `<span class="clock-time">${CP.nowHHMM()}</span><span class="clock-date">${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>`;
    $('theme-btn').textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? 'Day mode' : 'Night mode';
  }

  function renderAll() {
    [CP.renderDepartures, CP.renderCheckouts, CP.renderWaiting, CP.renderTools, renderClock]
      .forEach(fn => { try { fn && fn(); } catch (e) { console.error(e); } });
  }

  let lastMinute = -1;
  function tick() {
    const s = CP.state();
    if (s.day !== CP.todayStr()) { CP.newShift(); return; }
    if (CP.tickWaiting) CP.tickWaiting();
    const m = CP.nowMinutes();
    if (m !== lastMinute) { lastMinute = m; renderClock(); if (CP.renderDepLast) CP.renderDepLast(); }
  }

  // ---------- events ----------
  function bind() {
    const t = CP.state().theme;
    if (t) document.documentElement.setAttribute('data-theme', t);

    document.addEventListener('click', e => {
      const nav = e.target.closest('.nav-btn[data-view]');
      if (nav) { go(nav.dataset.view); return; }
      const a = e.target.closest('[data-action]');
      if (a) runAction(a.dataset.action);
    });
    $('theme-btn').addEventListener('click', toggleTheme);
    $('newshift-btn').addEventListener('click', confirmNewShift);

    const dlg = $('sheet');
    dlg.addEventListener('click', e => { if (e.target === dlg) CP.closeSheet(); });

    const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
      if (typing(document.activeElement) || dlg.open || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); openPalette(); return; }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= VIEWS.length) go(VIEWS[n - 1]);
    });

    // paste a screenshot anywhere and it gets read
    document.addEventListener('paste', e => {
      if (typing(e.target) && e.target.id !== 'ex-drop') return;
      const items = Array.from((e.clipboardData || {}).items || []);
      const img = items.find(i => i.type && i.type.startsWith('image'));
      if (img) { e.preventDefault(); go('checkouts'); CP.readCheckoutImage(img.getAsFile()); return; }
      const text = e.clipboardData.getData('text');
      if (!text) return;
      e.preventDefault();
      if (current === 'tools') { $('tl-input').value = text; CP.renderTools(); return; }
      go('checkouts');
      $('ex-text').value = text;
      CP.readCheckoutText(text);
    });

    // drop files anywhere: images to Checkouts, exports to Departures
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (!f) return;
      if (f.type.startsWith('image')) { go('checkouts'); CP.readCheckoutImage(f); }
      else { go('departures'); CP.dep.importFile(f); }
    });

    CP.onChange(renderAll);
    go((location.hash || '#departures').slice(1));
    renderAll();
    setInterval(tick, 1000);
  }

  document.addEventListener('DOMContentLoaded', bind);
})(window.CP);
