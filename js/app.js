(function (CP) {
  const $ = (id) => document.getElementById(id);
  const VIEWS = ['today', 'departures', 'checkouts', 'waiting', 'tools'];
  let current = 'today';

  // ---------- shift rhythm ----------
  const PHASES = [
    { at: '09:00', title: 'Departure balances', does: 'Clear VCC, city ledger and refund cases on today\'s due-outs.' },
    { at: '10:00', title: 'Arrivals and early check-ins', does: 'Waiting cards, room swaps, rooms on Q for housekeeping.' },
    { at: '11:30', title: 'Departure calls', does: 'Operators log departure codes 12:01 to 12:06.' },
    { at: '12:00', title: 'Physical checks', does: 'Import due-outs, send Concierge the list, repeat every 30 minutes.' },
    { at: '14:30', title: 'Lunch', does: 'Half an hour. The re-check timer keeps running.' },
    { at: '15:00', title: 'Q rooms and email', does: 'Tell guests their rooms are ready, clear urgent email.' },
    { at: '16:00', title: 'Tomorrow\'s allocation', does: 'Go through tomorrow\'s arrivals one by one.' }
  ];
  const SHIFT_END = '18:00';

  function phaseNow() {
    const now = CP.nowMinutes();
    const start = CP.toMinutes(PHASES[0].at), end = CP.toMinutes(SHIFT_END);
    if (now < start) return { idx: -1, label: `Shift starts at ${PHASES[0].at}` };
    if (now >= end) return { idx: PHASES.length, label: 'Shift over' };
    let idx = 0;
    PHASES.forEach((p, i) => { if (now >= CP.toMinutes(p.at)) idx = i; });
    const next = PHASES[idx + 1] ? PHASES[idx + 1].at : SHIFT_END;
    const left = CP.toMinutes(next) - now;
    return { idx, label: `${PHASES[idx].title}, ${CP.fmtDur(left)} left` };
  }

  // ---------- routing ----------
  function go(view, opts) {
    if (!VIEWS.includes(view)) view = 'today';
    current = view;
    VIEWS.forEach(v => { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('[data-view]').forEach(b => {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('view-title').textContent = $('view-' + view).dataset.title;
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    if (!opts || !opts.keepScroll) window.scrollTo(0, 0);
  }
  CP.go = go;
  CP.currentView = () => current;

  // ---------- today ----------
  function stats(s) {
    const rows = CP.dep.activeRows(s);
    const st = rows.map(r => CP.roomStatus(r, s));
    const bal = rows.filter(r => CP.parseBalance(r.balance) !== 0);
    const active = s.cards.filter(c => c.status !== 'done');
    return {
      loaded: !!s.dueouts,
      check: st.filter(x => x === 'check').length,
      cleared: st.filter(x => x === 'co' || x === 'left').length,
      ext: st.filter(x => x === 'ext').length,
      total: rows.length,
      unprocessed: CP.unprocessedCheckouts(),
      balTodo: bal.filter(r => !s.tags[CP.dep.tagKey(r)]),
      waiting: active.filter(c => c.status === 'waiting'),
      onQ: active.filter(c => c.status === 'q'),
      ready: active.filter(c => c.status === 'ready'),
      longest: active.length ? Math.max(...active.map(CP.cardWaitMins)) : 0
    };
  }

  function renderToday() {
    const s = CP.state();
    const k = stats(s);
    const bs = s.dueouts ? CP.dep.buildingStats(s) : null;

    const cell = (n, label, note, view, tone) => `
      <button class="bcell ${tone || ''}" data-go="${view}" type="button">
        <span class="bnum">${n}</span>
        <span class="blabel">${label}</span>
        <span class="bnote">${note}</span>
      </button>`;

    const bldNote = bs ? CP.BUILDINGS.map(b => `${b.name} ${bs[b.name].check}`).join(', ') : 'Import the due-out export';
    $('board').innerHTML = `
      <div class="board-grid">
        ${cell(k.loaded ? k.check : '–', 'Rooms to check', bldNote, 'departures', k.check ? 'lit' : '')}
        ${cell(k.loaded ? `${k.cleared}<small>/${k.total}</small>` : '–', 'Departures cleared', k.loaded ? (k.ext ? CP.plural(k.ext, 'extension') : 'No extensions') : 'No export yet', 'departures')}
        ${cell(k.unprocessed.length, 'To check out in Opera', k.unprocessed.length ? 'Reported by Concierge, not processed' : 'Log is clear', 'checkouts', k.unprocessed.length ? 'lit' : '')}
        ${cell(k.waiting.length + k.onQ.length, 'Guests waiting', k.longest ? `Longest wait ${CP.fmtDur(k.longest)}` : 'No waiting cards', 'waiting', k.longest >= 60 ? 'hot' : '')}
        ${cell(k.ready.length, 'Ready, not told', k.ready.length ? 'Send to the Q group' : 'Nobody to call', 'waiting', k.ready.length ? 'lit' : '')}
      </div>`;

    // needs attention
    const items = [];
    const now = Date.now();
    if (s.recheckAt && now >= s.recheckAt && k.check) {
      items.push({ tone: 'hot', text: `Departure re-check is due. ${CP.plural(k.check, 'room')} still on the Concierge list.`, act: 'import', label: 'Import new export' });
    }
    if (!s.dueouts && CP.nowMinutes() >= CP.toMinutes('11:30')) {
      items.push({ tone: 'warm', text: 'No due-out export imported yet today.', act: 'import', label: 'Import export' });
    }
    k.ready.forEach(c => items.push({ tone: 'warm', text: `${c.room} is ready for ${c.name}. Guest not told yet.`, act: 'go:waiting', label: 'Open card' }));
    s.cards.filter(c => c.status !== 'done' && CP.cardWaitMins(c) >= 30).sort((a, b) => CP.cardWaitMins(b) - CP.cardWaitMins(a)).forEach(c => {
      const m = CP.cardWaitMins(c);
      items.push({ tone: m >= 60 ? 'hot' : 'warm', text: `${c.name} has waited ${CP.fmtDur(m)}${c.room ? ' for ' + c.room : ' with no room yet'}.`, act: 'go:waiting', label: 'Open card' });
    });
    s.cards.filter(c => c.status === 'q' || c.status === 'waiting').forEach(c => {
      const n = CP.cardRoomNote(c, s);
      if (n && n.kind === 'alert') items.push({ tone: 'warm', text: `${c.name} in ${c.room}: ${n.text.toLowerCase()}.`, act: 'go:waiting', label: 'Change room' });
    });
    if (k.unprocessed.length) items.push({ tone: '', text: `${CP.plural(k.unprocessed.length, 'reported checkout')} waiting to be processed in Opera.`, act: 'copy-unprocessed', label: 'Copy Opera list' });
    if (k.balTodo.length) items.push({ tone: '', text: `${CP.plural(k.balTodo.length, 'departure')} with a balance nobody has tagged yet.`, act: 'go:departures', label: 'Review' });

    $('feed').innerHTML = items.length
      ? items.slice(0, 9).map((it, i) => `<li class="feed-item ${it.tone}"><p>${CP.esc(it.text)}</p><button class="btn small" data-act="${it.act}" type="button">${it.label}</button></li>`).join('')
      : `<li class="feed-empty">Nothing is waiting on you. New issues show up here as they happen.</li>`;

    const ph = phaseNow();
    $('rhythm').innerHTML = PHASES.map((p, i) => `
      <li class="${i < ph.idx ? 'past' : i === ph.idx ? 'now' : ''}">
        <time>${p.at}</time>
        <div><strong>${p.title}</strong><span>${p.does}</span></div>
      </li>`).join('') + `<li class="${ph.idx >= PHASES.length ? 'now' : ''}"><time>${SHIFT_END}</time><div><strong>Shift ends</strong></div></li>`;
  }

  // ---------- topbar ----------
  function renderTop() {
    const s = CP.state();
    const d = new Date();
    $('clock').innerHTML = `<span class="clock-time">${CP.nowHHMM()}</span><span class="clock-date">${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>`;
    $('phase').textContent = phaseNow().label;
    const btn = $('recheck-btn');
    if (!s.recheckAt || !s.dueouts) { btn.hidden = true; return; }
    btn.hidden = false;
    const left = Math.round((s.recheckAt - Date.now()) / 1000);
    if (left <= 0) {
      btn.classList.add('due');
      btn.innerHTML = `<span>Re-check due</span><b>Import</b>`;
    } else {
      btn.classList.remove('due');
      const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0');
      btn.innerHTML = `<span>Next re-check</span><b>${mm}:${ss}</b>`;
    }
    $('theme-btn').textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? 'Day mode' : 'Night mode';
  }

  // ---------- actions ----------
  function importNow() { go('departures'); $('dep-file').click(); }
  function act(a) {
    if (a === 'import') return importNow();
    if (a.startsWith('go:')) return go(a.slice(3));
    if (a === 'copy-unprocessed') { const r = CP.unprocessedCheckouts(); return CP.copy(r.join(','), `Copied ${CP.plural(r.length, 'room')}`); }
  }

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0B1F25' : '#EDF1F0');
    CP.update(s => { s.theme = t; });
  }
  const toggleTheme = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

  function confirmNewShift() {
    CP.sheet(`
      <div class="sheet-head"><div><h2>Start a new shift?</h2><p class="meta">Clears the due-out import, checkout log, balance tags and waiting cards on this device. Your cutoff time and theme stay.</p></div>
      <button class="icon-btn" data-close type="button" aria-label="Close">✕</button></div>
      <div class="sheet-actions"><button class="btn primary danger" data-yes type="button">Clear and start fresh</button><button class="btn" data-close2 type="button">Keep working</button></div>`,
    (el, close) => {
      el.querySelector('[data-close]').onclick = close;
      el.querySelector('[data-close2]').onclick = close;
      el.querySelector('[data-yes]').onclick = () => { const cut = CP.state().cutoff; CP.newShift(); CP.update(s => { s.cutoff = cut; }); close(); CP.toast('New shift started'); go('today'); };
    });
  }

  // ---------- command palette ----------
  function commands() {
    const s = CP.state();
    return [
      { label: 'Import due-out export', hint: 'Departures', run: importNow },
      { label: 'Copy list for Concierge', hint: `${CP.dep.checkRooms(s).length} rooms`, run: () => { go('departures'); CP.copy(CP.dep.conciergeText(s), 'Concierge list copied'); } },
      { label: 'Copy rooms to check as Opera list', hint: 'Departures', run: () => { const r = CP.sortRooms(CP.dep.checkRooms(s)); CP.copy(r.join(','), `Copied ${CP.plural(r.length, 'room')}`); } },
      { label: 'Read a checkout screenshot', hint: 'Or just paste it anywhere', run: () => { go('checkouts'); $('ex-drop').focus(); } },
      { label: 'Copy checkouts to process in Opera', hint: `${CP.unprocessedCheckouts().length} rooms`, run: () => act('copy-unprocessed') },
      { label: 'New waiting card', hint: 'Waiting cards', run: () => { go('waiting'); setTimeout(() => $('wc-form').querySelector('[name=name]').focus(), 30); } },
      { label: 'Turn any text into an Opera list', hint: 'Room lists', run: () => { go('tools'); setTimeout(() => $('tl-input').focus(), 30); } },
      { label: 'Go to Today', hint: '1', run: () => go('today') },
      { label: 'Go to Departures', hint: '2', run: () => go('departures') },
      { label: 'Go to Checkouts', hint: '3', run: () => go('checkouts') },
      { label: 'Go to Waiting cards', hint: '4', run: () => go('waiting') },
      { label: 'Go to Room lists', hint: '5', run: () => go('tools') },
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

  // ---------- render loop ----------
  function renderAll() {
    [CP.renderDepartures, CP.renderCheckouts, CP.renderWaiting, CP.renderTools, renderToday, renderTop]
      .forEach(fn => { try { fn && fn(); } catch (e) { console.error(e); } });
  }

  let alerted = null;
  function tick() {
    const s = CP.state();
    if (s.day !== CP.todayStr()) { CP.newShift(); return; }
    renderTop();
    if (CP.tickWaiting) CP.tickWaiting();
    if (s.recheckAt && Date.now() >= s.recheckAt && alerted !== s.recheckAt && s.dueouts) {
      alerted = s.recheckAt;
      CP.toast('Time for the next departure re-check');
      renderToday();
    }
  }

  // ---------- events ----------
  function bind() {
    const t = CP.state().theme;
    if (t) document.documentElement.setAttribute('data-theme', t);

    document.addEventListener('click', e => {
      const nav = e.target.closest('[data-view]');
      if (nav && (nav.classList.contains('nav-btn') || nav.classList.contains('tab'))) { go(nav.dataset.view); return; }
      const g = e.target.closest('[data-go]');
      if (g) { go(g.dataset.go); return; }
      const a = e.target.closest('#feed [data-act]');
      if (a) { act(a.dataset.act); }
    });
    $('recheck-btn').addEventListener('click', importNow);
    $('theme-btn').addEventListener('click', toggleTheme);
    $('newshift-btn').addEventListener('click', confirmNewShift);

    // close sheet on backdrop tap
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
    go((location.hash || '#today').slice(1), { keepScroll: true });
    renderAll();
    setInterval(tick, 1000);
    setInterval(renderToday, 30000);
  }

  document.addEventListener('DOMContentLoaded', bind);
})(window.CP);
