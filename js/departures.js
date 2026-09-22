(function (CP) {
  const $ = (id) => document.getElementById(id);
  let rackFilter = 'check';

  // ---------- parsing ----------
  const HEADERS = {
    conf: ['Confirmation Number', 'Confirmation', 'Conf'],
    room: ['Room', 'Room No', 'Room Number'],
    name: ['Name', 'Guest Name'],
    etd: ['ETD'],
    balance: ['Balance'],
    vip: ['VIP Code', 'VIP'],
    ta: ['Travel Agent'],
    company: ['Company'],
    roomType: ['Room Type'],
    linked: ['Linked Name'],
    adults: ['Adults'],
    children: ['Children'],
    nights: ['Nights'],
    memberType: ['Membership Type'],
    memberLevel: ['Membership Level']
  };

  function normalize(objs) {
    return objs.map(o => {
      const r = {};
      for (const k in HEADERS) {
        const h = HEADERS[k].find(h => Object.prototype.hasOwnProperty.call(o, h));
        r[k] = h ? String(o[h] ?? '').trim() : '';
      }
      r.room = r.room.replace(/\s+/g, '');
      if (r.vip === '0') r.vip = '';
      return r;
    }).filter(r => r.room || r.name);
  }

  function parseHTMLText(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return [];
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) return [];
    const headers = Array.from(rows[0].querySelectorAll('th,td')).map(c => c.textContent.trim());
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = Array.from(rows[i].querySelectorAll('td'));
      if (!cells.length) continue;
      const o = {};
      headers.forEach((h, idx) => { o[h] = cells[idx] ? cells[idx].textContent.trim() : ''; });
      out.push(o);
    }
    return normalize(out);
  }

  async function parseFile(file) {
    const buf = await file.arrayBuffer();
    const head = new TextDecoder().decode(buf.slice(0, 800)).trim().toLowerCase();
    if (head.startsWith('<') || head.includes('<table') || head.includes('<html')) {
      return parseHTMLText(new TextDecoder().decode(buf));
    }
    if (!window.XLSX) await CP.loadScript(CP.LIB.xlsx);
    if (window.XLSX) {
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return normalize(XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }));
    }
    throw new Error('unsupported');
  }

  // ---------- derived data ----------
  const activeRows = (s) => (s.dueouts ? s.dueouts.rows.filter(r => CP.roomStatus(r, s) !== 'na') : []);
  const checkRooms = (s) => activeRows(s).filter(r => CP.roomStatus(r, s) === 'check').map(r => r.room);
  const tagKey = (r) => r.conf || r.room;

  function conciergeText(s) {
    const rooms = checkRooms(s);
    const g = CP.groupByBuilding(rooms);
    const order = CP.BUILDING_ORDER.filter(b => g[b]);
    let t = `Total physical checks: ${rooms.length}\n`;
    t += order.map(b => `${b}: ${g[b].length}`).join(' · ') + '\n\n';
    order.forEach(b => { t += b + '\n' + g[b].join('\n') + '\n\n'; });
    return t.trim();
  }

  function buildingStats(s) {
    const out = {};
    CP.BUILDING_ORDER.forEach(b => out[b] = { total: 0, check: 0, cleared: 0, ext: 0, later: 0 });
    activeRows(s).forEach(r => {
      const st = CP.roomStatus(r, s), b = out[CP.building(r.room)];
      b.total++;
      if (st === 'check') b.check++;
      else if (st === 'co' || st === 'left') b.cleared++;
      else if (st === 'ext') b.ext++;
      else if (st === 'later') b.later++;
    });
    return out;
  }

  function linkedGroups(s) {
    if (!s.dueouts) return [];
    const rows = s.dueouts.rows;
    const groups = {};
    rows.forEach(r => {
      if (!r.linked) return;
      const m = /^(\d{6,})\s*(.*)$/.exec(r.linked);
      const key = m ? m[1] : r.linked;
      const g = groups[key] || (groups[key] = { key, leadName: m ? m[2] : r.linked, departing: [] });
      g.departing.push(r);
    });
    Object.values(groups).forEach(g => {
      const lead = rows.find(r => r.conf === g.key);
      if (lead && !g.departing.includes(lead)) g.departing.push(lead);
      g.leadDeparting = !!lead;
      // a linked lead whose reservation isn't on today's due-out list is staying longer
      g.staying = lead ? [] : [g.leadName];
    });
    return Object.values(groups);
  }

  const vipRows = (s) => activeRows(s).filter(r => r.vip || r.memberLevel);

  CP.dep = { parseHTMLText, parseFile, checkRooms, conciergeText, linkedGroups, vipRows, tagKey, activeRows, buildingStats, importRows, importFile };

  // ---------- import ----------
  function importRows(rows, fileName) {
    const s = CP.state();
    const before = s.dueouts ? checkRooms(s) : null;
    const beforeAt = s.dueouts ? s.dueouts.importedAt : null;
    CP.update(st => { st.dueouts = { rows, importedAt: Date.now(), fileName: fileName || '' }; });
    const after = checkRooms(CP.state());
    CP.update(st => {
      st.diff = before ? {
        vsAt: beforeAt,
        resolved: CP.sortRooms(before.filter(r => !after.includes(r))),
        newly: CP.sortRooms(after.filter(r => !before.includes(r))),
        pending: after.filter(r => before.includes(r)).length
      } : null;
      st.recheckAt = Date.now() + 30 * 60000;
    });
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const rows = await parseFile(file);
      if (!rows.length) throw new Error('empty');
      importRows(rows, file.name);
      CP.toast(`Imported ${rows.length} due-outs. Re-check timer set for 30 min.`);
    } catch (e) {
      console.error(e);
      CP.toast('That file has no due-out table. Export it from Opera again and drop it here unedited.');
    }
  }

  // ---------- rendering ----------
  function render() {
    const s = CP.state();
    const body = $('dep-body');
    const meta = $('dep-meta');
    const cutoff = $('cutoff');
    if (document.activeElement !== cutoff) cutoff.value = s.cutoff || '';

    if (!s.dueouts) {
      meta.textContent = 'Use the .xls exactly as Opera gives it.';
      body.innerHTML = '';
      $('dep-table-panel').hidden = true;
      return;
    }
    meta.textContent = `${s.dueouts.fileName || 'Export'} with ${s.dueouts.rows.length} rows, imported ${CP.ago(s.dueouts.importedAt)}. Drop a newer one to compare.`;

    const rows = activeRows(s);
    const counts = { check: 0, cleared: 0, ext: 0, later: 0 };
    rows.forEach(r => {
      const st = CP.roomStatus(r, s);
      if (st === 'co' || st === 'left') counts.cleared++; else if (counts[st] !== undefined) counts[st]++;
    });

    let html = '';

    // diff
    if (s.diff) {
      html += `<div class="panel diff">
        <div class="panel-head"><h2>Since the last import</h2><span class="meta">compared with ${CP.ago(s.diff.vsAt)}</span></div>
        <div class="diff-grid">
          <div class="diff-cell good"><strong>${s.diff.resolved.length}</strong><span>resolved</span><p>${s.diff.resolved.join(', ') || 'None'}</p></div>
          <div class="diff-cell warn"><strong>${s.diff.newly.length}</strong><span>new to check</span><p>${s.diff.newly.join(', ') || 'None'}</p></div>
          <div class="diff-cell"><strong>${s.diff.pending}</strong><span>still pending</span></div>
        </div>
      </div>`;
    }

    // key rack
    const filters = [
      ['check', 'To check', counts.check],
      ['cleared', 'Cleared', counts.cleared],
      ['ext', 'Extension', counts.ext],
      ['later', 'Not yet', counts.later],
      ['all', 'All', rows.length]
    ];
    const show = rows.filter(r => {
      const st = CP.roomStatus(r, s);
      if (rackFilter === 'all') return true;
      if (rackFilter === 'cleared') return st === 'co' || st === 'left';
      return st === rackFilter;
    });
    const g = {};
    show.forEach(r => { const b = CP.building(r.room); (g[b] = g[b] || []).push(r); });

    html += `<div class="panel rack-panel">
      <div class="panel-head">
        <h2>Key rack</h2>
        <div class="actions">
          <button class="btn primary" data-act="copy-concierge" type="button">Copy for Concierge (${counts.check})</button>
          <button class="btn" data-act="copy-check-opera" type="button">Copy as Opera list</button>
        </div>
      </div>
      <div class="chips" role="tablist">${filters.map(([k, l, n]) =>
        `<button class="chip ${rackFilter === k ? 'on' : ''}" data-rack="${k}" type="button">${l}<b>${n}</b></button>`).join('')}</div>
      ${show.length ? CP.BUILDING_ORDER.filter(b => g[b]).map(b => `
        <div class="rack-group">
          <h3 class="bld-name">${b}<span>${g[b].length}</span></h3>
          <div class="tiles">${CP.sortRooms(g[b].map(r => r.room)).map(room => {
            const r = g[b].find(x => x.room === room);
            const st = CP.roomStatus(r, s);
            const sub = st === 'co' ? 'Checked out' : (CP.ETD_CODES[r.etd] || r.etd || 'No time');
            return CP.tile(room, 's-' + st + (r.vip || r.memberLevel ? ' vip' : ''), sub);
          }).join('')}</div>
        </div>`).join('') : `<p class="empty">Nothing in this group right now.</p>`}
    </div>`;

    // side lists
    const bal = rows.map(r => ({ r, v: CP.parseBalance(r.balance) })).filter(x => x.v !== 0)
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    const TAGS = ['VCC missing', 'City ledger', 'Refund due', 'Collect', 'Settled'];
    const vips = vipRows(s);
    const linked = linkedGroups(s);

    html += `<div class="split">
      <div class="panel">
        <div class="panel-head"><h2>Balances on departure</h2><span class="meta">${bal.length ? CP.plural(bal.filter(x => !s.tags[tagKey(x.r)]).length, 'to review', 'to review') : ''}</span></div>
        ${bal.length ? `<ul class="list">${bal.map(({ r, v }) => {
          const tag = s.tags[tagKey(r)];
          return `<li class="bal ${tag ? 'tagged' : ''}">
            <div class="li-main"><button class="room-link" data-room="${r.room}" type="button">${r.room}</button>
              <span class="li-name">${CP.esc(r.name)}</span>
              <span class="amt ${v < 0 ? 'neg' : ''}">${CP.esc(r.balance)}</span></div>
            <div class="tagrow">${TAGS.map(t => `<button class="mini ${tag === t ? 'on' : ''}" data-tag="${CP.esc(t)}" data-key="${CP.esc(tagKey(r))}" type="button">${t}</button>`).join('')}</div>
          </li>`;
        }).join('')}</ul>` : `<p class="empty">Every due-out is at zero.</p>`}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>VIPs and members leaving</h2><span class="meta">${vips.length || ''}</span></div>
        ${vips.length ? `<ul class="list">${vips.map(r => {
          const st = CP.roomStatus(r, s);
          return `<li><div class="li-main"><button class="room-link" data-room="${r.room}" type="button">${r.room}</button>
            <span class="li-name">${CP.esc(r.name)}</span>
            <span class="pill s-${st}">${CP.STATUS_LABEL[st]}</span></div>
            <div class="li-sub">${[r.vip ? 'VIP ' + CP.esc(r.vip) : '', r.memberLevel ? CP.esc(r.memberLevel) : '', r.ta ? CP.esc(r.ta) : ''].filter(Boolean).join(', ')}</div></li>`;
        }).join('')}</ul>` : `<p class="empty">No VIP or member departures today.</p>`}
        <div class="panel-head sub-head"><h2>Linked reservations</h2><span class="meta">${linked.length || ''}</span></div>
        ${linked.length ? `<ul class="list">${linked.map(gp => `
          <li><div class="li-main">${gp.departing.map(r => `<button class="room-link" data-room="${r.room}" type="button">${r.room}</button>`).join('')}
            <span class="li-name">${CP.esc(gp.leadName || gp.departing[0].name)}</span></div>
            ${gp.staying.length ? `<div class="li-sub warn-text">Linked booking is not on today's departures, so part of the family may be staying on.</div>` : `<div class="li-sub">All linked rooms leave today.</div>`}
          </li>`).join('')}</ul>` : `<p class="empty">No linked reservations departing.</p>`}
      </div>
    </div>`;

    body.innerHTML = html;
    $('dep-table-panel').hidden = false;
    renderTable();
  }

  function renderTable() {
    const s = CP.state();
    if (!s.dueouts) return;
    const q = ($('dep-search').value || '').toLowerCase().trim();
    const rows = s.dueouts.rows
      .filter(r => !q || [r.room, r.name, r.ta, r.conf, r.company].join(' ').toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
    $('dep-table').innerHTML = `<thead><tr><th>Room</th><th>Guest</th><th>Departure</th><th>Status</th><th>Balance</th><th>VIP</th><th>Agent</th></tr></thead><tbody>` +
      rows.map(r => {
        const st = CP.roomStatus(r, s);
        return `<tr data-room="${CP.esc(r.room)}"><td class="t-room">${CP.esc(r.room)}</td><td>${CP.esc(r.name)}</td><td>${CP.esc(r.etd)}${CP.ETD_CODES[r.etd] ? ' <span class="muted">' + CP.ETD_CODES[r.etd] + '</span>' : ''}</td><td><span class="pill s-${st}">${CP.STATUS_LABEL[st]}</span></td><td>${CP.esc(r.balance)}</td><td>${CP.esc(r.vip)}</td><td>${CP.esc(r.ta)}</td></tr>`;
      }).join('') + '</tbody>';
  }

  // ---------- room detail sheet (used everywhere) ----------
  CP.openRoom = (room) => {
    const s = CP.state();
    const r = CP.rowByRoom(room);
    const reported = s.co.reported[room];
    const processed = s.co.processed[room];
    const st = r ? CP.roomStatus(r) : null;
    const cards = s.cards.filter(c => c.room === room && c.status !== 'done');
    const fields = r ? [
      ['Guest', r.name], ['Confirmation', r.conf], ['Departure time', r.etd ? r.etd + (CP.ETD_CODES[r.etd] ? ', ' + CP.ETD_CODES[r.etd] : '') : 'Not given'],
      ['Balance', r.balance], ['VIP', r.vip], ['Membership', [r.memberType, r.memberLevel].filter(Boolean).join(' ')],
      ['Travel agent', r.ta], ['Room type', r.roomType], ['Pax', [r.adults, r.children].filter(x => x !== '').join('+')], ['Linked', r.linked]
    ].filter(([, v]) => v) : [];
    CP.sheet(`
      <div class="sheet-head">
        <div class="sheet-tag s-${st || (reported ? 'co' : 'na')}"><span>${CP.esc(room)}</span></div>
        <div><h2>${CP.esc(CP.building(room))}</h2>
          <p class="meta">${st ? CP.STATUS_LABEL[st] : 'Not on today\'s due-out list'}${reported ? ', reported checked out ' + CP.ago(reported) : ''}${processed ? ', processed in Opera' : ''}</p></div>
        <button class="icon-btn" data-close type="button" aria-label="Close">✕</button>
      </div>
      ${fields.length ? `<dl class="facts">${fields.map(([k, v]) => `<div><dt>${k}</dt><dd>${CP.esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${cards.length ? `<p class="warn-text">Waiting card: ${cards.map(c => CP.esc(c.name)).join(', ')} is assigned to this room.</p>` : ''}
      <div class="sheet-actions">
        ${reported
          ? `<button class="btn" data-a="undo" type="button">Undo checkout</button>
             ${processed ? `<button class="btn" data-a="unprocess" type="button">Mark not processed</button>` : `<button class="btn primary" data-a="process" type="button">Mark processed in Opera</button>`}`
          : `<button class="btn primary" data-a="co" type="button">Mark checked out</button>`}
        <button class="btn" data-a="copy" type="button">Copy room number</button>
      </div>`, (el, close) => {
      el.querySelector('[data-close]').onclick = close;
      el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'copy') { CP.copy(room, `Copied ${room}`); return; }
        CP.update(st2 => {
          if (a === 'co') st2.co.reported[room] = Date.now();
          if (a === 'undo') { delete st2.co.reported[room]; delete st2.co.processed[room]; }
          if (a === 'process') st2.co.processed[room] = Date.now();
          if (a === 'unprocess') delete st2.co.processed[room];
        });
        close();
        CP.toast(a === 'co' ? `${room} marked checked out` : a === 'undo' ? `${room} back on the list` : 'Updated');
      });
    });
  };

  // ---------- events ----------
  function bind() {
    const drop = $('dep-drop');
    const file = $('dep-file');
    $('dep-browse').addEventListener('click', () => file.click());
    file.addEventListener('change', () => { importFile(file.files[0]); file.value = ''; });
    const view = $('view-departures');
    ['dragenter', 'dragover'].forEach(ev => view.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => view.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === view) drop.classList.remove('over'); }));
    view.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) importFile(f); });

    const cutoff = $('cutoff');
    cutoff.addEventListener('input', () => {
      const v = cutoff.value.trim();
      if (v === '' || CP.toMinutes(v) !== null) CP.update(s => { s.cutoff = v; });
    });
    cutoff.addEventListener('blur', () => { const n = CP.normTime(cutoff.value); if (n) cutoff.value = n; });

    document.querySelectorAll('[data-cut]').forEach(b => b.addEventListener('click', () => {
      const s = CP.state();
      let v = b.dataset.cut;
      if (v === 'now') v = CP.nowHHMM();
      else if (v === '+30') { const m = CP.toMinutes(s.cutoff); v = CP.fromMinutes((m === null ? CP.nowMinutes() : m) + 30); }
      CP.update(st => { st.cutoff = v; });
      cutoff.value = v;
    }));

    $('dep-body').addEventListener('click', e => {
      const rk = e.target.closest('[data-rack]');
      if (rk) { rackFilter = rk.dataset.rack; render(); return; }
      const tg = e.target.closest('[data-tag]');
      if (tg) {
        CP.update(s => { const k = tg.dataset.key; if (s.tags[k] === tg.dataset.tag) delete s.tags[k]; else s.tags[k] = tg.dataset.tag; });
        return;
      }
      const rm = e.target.closest('[data-room]');
      if (rm) CP.openRoom(rm.dataset.room);
    });
    $('dep-search').addEventListener('input', renderTable);
    $('dep-table').addEventListener('click', e => { const tr = e.target.closest('tr[data-room]'); if (tr) CP.openRoom(tr.dataset.room); });
  }

  CP.renderDepartures = render;
  document.addEventListener('DOMContentLoaded', bind);
})(window.CP);
