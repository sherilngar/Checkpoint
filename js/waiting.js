(function (CP) {
  const $ = (id) => document.getElementById(id);
  const COLS = [
    ['waiting', 'Waiting for a room'],
    ['q', 'On Q'],
    ['ready', 'Ready, guest not told yet'],
  ];

  const waitMins = (c) => CP.minsSince(c.eta, c.createdAt);
  const level = (m) => m >= 60 ? 'hot' : m >= 30 ? 'warm' : 'calm';

  // what the due-out list says about the assigned room
  function roomNote(c, s) {
    s = s || CP.state();
    if (!c.room) return null;
    const clash = s.cards.find(o => o.id !== c.id && o.room === c.room && o.status !== 'done');
    if (clash) return { kind: 'alert', text: `Also given to ${clash.name}` };
    if (s.co.reported[c.room]) return { kind: 'good', text: 'Guest checked out, room is with housekeeping' };
    const r = CP.rowByRoom(c.room, s);
    if (!r) return null;
    const st = CP.roomStatus(r, s);
    if (st === 'ext') return { kind: 'alert', text: 'Current guest has an extension' };
    if (st === 'left') return { kind: 'good', text: 'Current guest has left' };
    if (st === 'check' || st === 'later') return { kind: 'alert', text: 'Still occupied, due out today' + (CP.ETD_CODES[r.etd] ? ' (' + CP.ETD_CODES[r.etd].toLowerCase() + ')' : r.etd ? ' (ETD ' + r.etd + ')' : '') };
    return null;
  }
  CP.cardRoomNote = roomNote;

  const readyMsg = (c) => `Room ${c.room} is ready for ${c.name}${c.conf ? ' (conf ' + c.conf + ')' : ''}. Please call the guest to collect the keys.`;

  function render() {
    const s = CP.state();
    const active = s.cards.filter(c => c.status !== 'done');
    const done = s.cards.filter(c => c.status === 'done');
    const ready = active.filter(c => c.status === 'ready');
    const onQ = active.filter(c => c.status === 'q' && c.room);

    const card = (c) => {
      const m = waitMins(c);
      const note = roomNote(c, s);
      const actions = {
        waiting: `<button class="btn primary" data-w="assign" type="button">Assign room</button>`,
        q: `<button class="btn primary" data-w="ready" type="button">Room ready</button><button class="btn" data-w="assign" type="button">Change room</button>`,
        ready: `<button class="btn primary" data-w="msg" type="button">Copy message</button><button class="btn" data-w="done" type="button">Keys collected</button>`
      }[c.status];
      return `<article class="wcard lvl-${level(m)}" data-id="${c.id}">
        <header>
          <h3>${CP.esc(c.name)}</h3>
          <span class="wait" data-wait="${c.id}">${CP.fmtDur(m)}</span>
        </header>
        <p class="wc-meta">${[c.conf ? 'Conf ' + CP.esc(c.conf) : '', c.pax ? CP.esc(c.pax) + ' pax' : '', c.eta ? 'arrived ' + CP.esc(c.eta) : ''].filter(Boolean).join(', ')}</p>
        ${c.prefs ? `<p class="wc-prefs">${CP.esc(c.prefs)}</p>` : ''}
        ${c.room ? `<div class="wc-room">${CP.tile(c.room, note && note.kind === 'alert' ? 's-alert' : 's-q', CP.building(c.room))}${note ? `<span class="note ${note.kind}">${CP.esc(note.text)}</span>` : ''}</div>` : ''}
        <div class="actions">${actions}<button class="btn ghost" data-w="edit" type="button">Edit</button></div>
      </article>`;
    };

    $('wc-board').innerHTML = `
      <div class="wc-toolbar">
        <button class="btn" data-wall="ready" type="button" ${ready.length ? '' : 'disabled'}>Copy all ready rooms for the Q group</button>
        <button class="btn" data-wall="q" type="button" ${onQ.length ? '' : 'disabled'}>Copy Q rooms as Opera list</button>
      </div>
      <div class="wc-cols">${COLS.map(([k, label]) => {
        const list = active.filter(c => c.status === k).sort((a, b) => waitMins(b) - waitMins(a));
        return `<section class="wc-col"><h2>${label}<b>${list.length}</b></h2>${list.map(card).join('') || `<p class="empty">None</p>`}</section>`;
      }).join('')}</div>
      ${done.length ? `<details class="done-list"><summary>Keys collected today (${done.length})</summary><ul>${done.map(c =>
        `<li><span>${CP.esc(c.room || '')}</span> ${CP.esc(c.name)}, waited ${CP.fmtDur(c.waited || 0)} <button class="inline-btn" data-undo="${c.id}" type="button">Reopen</button></li>`).join('')}</ul></details>` : ''}`;
  }

  function tick() {
    const s = CP.state();
    document.querySelectorAll('[data-wait]').forEach(el => {
      const c = s.cards.find(x => x.id === el.dataset.wait);
      if (!c) return;
      const m = waitMins(c);
      el.textContent = CP.fmtDur(m);
      const art = el.closest('.wcard');
      if (art) art.className = 'wcard lvl-' + level(m);
    });
  }
  CP.tickWaiting = tick;

  function editSheet(c) {
    const isNew = !c;
    c = c || {};
    CP.sheet(`
      <div class="sheet-head"><div><h2>${isNew ? 'New card' : CP.esc(c.name)}</h2><p class="meta">${c.status === 'waiting' ? 'Waiting for a room' : ''}</p></div>
      <button class="icon-btn" data-close type="button" aria-label="Close">✕</button></div>
      <div class="form-grid">
        <label class="f-name">Guest name<input name="name" value="${CP.esc(c.name || '')}"></label>
        <label>Confirmation<input name="conf" inputmode="numeric" value="${CP.esc(c.conf || '')}"></label>
        <label>Pax<input name="pax" value="${CP.esc(c.pax || '')}"></label>
        <label>Arrived at<input name="eta" inputmode="numeric" maxlength="5" value="${CP.esc(c.eta || '')}"></label>
        <label>Room<input name="room" inputmode="numeric" maxlength="4" value="${CP.esc(c.room || '')}"></label>
        <label class="f-wide">Preferences<input name="prefs" value="${CP.esc(c.prefs || '')}"></label>
      </div>
      <p class="warn-text" id="sheet-note"></p>
      <div class="sheet-actions">
        <button class="btn primary" data-save type="button">Save</button>
        ${isNew ? '' : `<button class="btn ghost danger" data-del type="button">Remove card</button>`}
      </div>`, (el, close) => {
      const roomIn = el.querySelector('[name=room]');
      const note = el.querySelector('#sheet-note');
      const showNote = () => {
        const v = roomIn.value.trim();
        const n = /^\d{4}$/.test(v) ? roomNote({ ...c, id: c.id || '_new', room: v }) : null;
        note.textContent = n && n.kind === 'alert' ? n.text : '';
      };
      roomIn.addEventListener('input', showNote); showNote();
      el.querySelector('[data-close]').onclick = close;
      el.querySelector('[data-save]').onclick = () => {
        const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
        if (!v('name')) { el.querySelector('[name=name]').focus(); return; }
        CP.update(s => {
          const target = s.cards.find(x => x.id === c.id);
          const data = { name: v('name'), conf: v('conf'), pax: v('pax'), eta: CP.normTime(v('eta')) || v('eta'), room: v('room'), prefs: v('prefs') };
          if (target) {
            Object.assign(target, data);
            if (target.status === 'waiting' && target.room) target.status = 'q';
            if (!target.room && target.status !== 'done') target.status = 'waiting';
          }
        });
        close();
      };
      const del = el.querySelector('[data-del]');
      if (del) del.onclick = () => { CP.update(s => { s.cards = s.cards.filter(x => x.id !== c.id); }); close(); CP.toast('Card removed'); };
      setTimeout(() => (isNew ? el.querySelector('[name=name]') : roomIn).focus(), 50);
    });
  }

  function bind() {
    const form = $('wc-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const g = (k) => String(f.get(k) || '').trim();
      if (!g('name')) return;
      const room = /^\d{4}$/.test(g('room')) ? g('room') : '';
      const card = {
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        name: g('name'), conf: g('conf'), pax: g('pax'),
        eta: CP.normTime(g('eta')) || CP.nowHHMM(),
        room, prefs: g('prefs'),
        status: room ? 'q' : 'waiting',
        createdAt: Date.now()
      };
      CP.update(s => { s.cards.push(card); });
      form.reset();
      form.querySelector('[name=name]').focus();
      const n = roomNote(card);
      CP.toast(n && n.kind === 'alert' ? `Card added. Heads up: ${n.text.toLowerCase()}.` : 'Card added');
    });

    $('wc-board').addEventListener('click', (e) => {
      const s = CP.state();
      const all = e.target.closest('[data-wall]');
      if (all) {
        if (all.dataset.wall === 'ready') {
          const ready = s.cards.filter(c => c.status === 'ready');
          CP.copy(ready.map(readyMsg).join('\n'), `Copied ${CP.plural(ready.length, 'ready room')}`);
        } else {
          const q = CP.sortRooms(s.cards.filter(c => c.status === 'q' && c.room).map(c => c.room));
          CP.copy(q.join(','), `Copied ${CP.plural(q.length, 'room')}`);
        }
        return;
      }
      const undo = e.target.closest('[data-undo]');
      if (undo) { CP.update(st => { const c = st.cards.find(x => x.id === undo.dataset.undo); if (c) c.status = 'ready'; }); return; }
      const tile = e.target.closest('.tile[data-room]');
      if (tile) { CP.openRoom(tile.dataset.room); return; }
      const btn = e.target.closest('[data-w]');
      if (!btn) return;
      const id = btn.closest('.wcard').dataset.id;
      const c = s.cards.find(x => x.id === id);
      if (!c) return;
      const a = btn.dataset.w;
      if (a === 'edit' || a === 'assign') return editSheet(c);
      if (a === 'msg') return CP.copy(readyMsg(c), 'Message copied');
      CP.update(st => {
        const t = st.cards.find(x => x.id === id);
        if (a === 'ready') { t.status = 'ready'; t.readyAt = Date.now(); }
        if (a === 'done') { t.status = 'done'; t.waited = waitMins(t); t.doneAt = Date.now(); }
      });
      if (a === 'ready') CP.copy(readyMsg(c), `${c.room} ready. Message copied for the Q group.`);
    });
  }

  CP.renderWaiting = render;
  CP.cardWaitMins = waitMins;
  document.addEventListener('DOMContentLoaded', bind);
})(window.CP);
