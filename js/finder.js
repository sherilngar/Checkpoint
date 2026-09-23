(function (CP) {
  const $ = (id) => document.getElementById(id);
  let type = 'all';
  let bld = 'all';
  let seaView = false;

  // how close a departing room is to being free, lower is sooner
  const CODE_RANK = { '12:05': 0, '12:02': 1, '12:01': 2, '12:04': 3 };
  const LANES = [
    { key: 'free', title: 'Free now', note: 'Guest has checked out. Room is with housekeeping, put it on Q.' },
    { key: 'going', title: 'Leaving now', note: 'Due out before your cutoff. Physical check pending.' },
    { key: 'later', title: 'Leaving later', note: 'Due out after your cutoff, earliest first.' }
  ];

  const baseType = (t) => t.replace(/OV$/, '');
  const isSea = (t) => /OV$/.test(t);

  function lane(r, s) {
    const st = CP.roomStatus(r, s);
    if (st === 'co' || st === 'left') return 'free';
    if (st === 'check') return 'going';
    if (st === 'later') return 'later';
    if (st === 'ext') return 'ext';
    return null;
  }

  function rank(r, s) {
    const st = CP.roomStatus(r, s);
    if (st === 'co') return -1;                       // Concierge confirmed out
    if (r.etd in CODE_RANK) return CODE_RANK[r.etd];
    const m = CP.toMinutes(r.etd);
    return m === null ? 5 : 10 + m;
  }

  function describe(r, s) {
    const st = CP.roomStatus(r, s);
    if (st === 'co') return 'Checked out';
    if (st === 'left') return 'Guest left';
    if (CP.ETD_CODES[r.etd]) return CP.ETD_CODES[r.etd];
    if (st === 'later') return r.etd ? 'Due ' + r.etd : 'No time';
    return r.etd ? 'ETD ' + r.etd : 'No time given';
  }

  function render() {
    const s = CP.state();
    const box = $('fd-body');
    if (!box) return;
    if (!s.dueouts) {
      $('fd-controls').innerHTML = '';
      box.innerHTML = `<div class="panel fd-empty">
        <h2>Import today's due-out export first</h2>
        <p class="meta">The finder works from the same Opera export as Departures. Once it's in, pick the room type a waiting guest needs and every matching departing room is ranked by how soon it frees up.</p>
        <button class="btn primary" data-fd="import" type="button">Import export</button>
      </div>`;
      return;
    }

    const rows = CP.dep.activeRows(s).filter(r => r.roomType && r.roomType !== 'PM');
    // type chips grouped by base type so KGA and KGAOV sit together
    const types = {};
    rows.forEach(r => { types[r.roomType] = (types[r.roomType] || 0) + 1; });
    const typeKeys = Object.keys(types).sort((a, b) => baseType(a).localeCompare(baseType(b)) || (isSea(a) - isSea(b)));

    const match = rows.filter(r =>
      (type === 'all' || (seaView ? r.roomType === type : baseType(r.roomType) === baseType(type))) &&
      (bld === 'all' || CP.building(r.room) === bld));

    const groups = { free: [], going: [], later: [], ext: [] };
    match.forEach(r => { const l = lane(r, s); if (l) groups[l].push(r); });
    Object.values(groups).forEach(g => g.sort((a, b) => (rank(a, s) - rank(b, s)) || a.room.localeCompare(b.room, undefined, { numeric: true })));

    $('fd-controls').innerHTML = `
      <div class="fd-row">
        <span class="fd-label">Room type</span>
        <div class="chips">
          <button class="chip ${type === 'all' ? 'on' : ''}" data-type="all" type="button">All<b>${rows.length}</b></button>
          ${typeKeys.map(t => `<button class="chip ${type === t ? 'on' : ''} ${isSea(t) ? 'sea' : ''}" data-type="${CP.esc(t)}" type="button">${CP.esc(t)}<b>${types[t]}</b></button>`).join('')}
        </div>
      </div>
      <div class="fd-row">
        <span class="fd-label">Building</span>
        <div class="chips">
          ${['all'].concat(CP.BUILDINGS.map(b => b.name)).map(b => `<button class="chip ${bld === b ? 'on' : ''}" data-bld="${b}" type="button">${b === 'all' ? 'All buildings' : b}</button>`).join('')}
        </div>
        ${type !== 'all' ? `<label class="check-row fd-exact"><input type="checkbox" id="fd-exact" ${seaView ? 'checked' : ''}> Exact type only${isSea(type) ? '' : ' (hide sea view)'}</label>` : ''}
      </div>`;

    const total = groups.free.length + groups.going.length + groups.later.length;
    const label = type === 'all' ? 'any type' : (seaView ? type : baseType(type) + (typeKeys.some(t => isSea(t) && baseType(t) === baseType(type)) ? ' incl. sea view' : ''));

    box.innerHTML = `
      <div class="fd-summary">
        <div class="fd-big"><strong>${groups.free.length}</strong><span>free now</span></div>
        <div class="fd-big"><strong>${groups.going.length}</strong><span>leaving now</span></div>
        <div class="fd-big"><strong>${groups.later.length}</strong><span>leaving later</span></div>
        <p class="meta">${CP.plural(total, 'departing room')} for ${CP.esc(label)}${bld !== 'all' ? ' in ' + bld : ''}${groups.ext.length ? `. ${CP.plural(groups.ext.length, 'extension')} not counted` : ''}.</p>
      </div>
      <div class="fd-lanes">${LANES.map(L => `
        <section class="fd-lane lane-${L.key}">
          <header><h2>${L.title}</h2><b>${groups[L.key].length}</b></header>
          <p class="fd-note">${L.note}</p>
          ${groups[L.key].length ? `<ol class="fd-list">${groups[L.key].map((r, i) => `
            <li>
              <button class="fd-room" data-room="${CP.esc(r.room)}" type="button">
                <span class="fd-rank">${i + 1}</span>
                <span class="fd-num">${CP.esc(r.room)}</span>
                <span class="fd-type">${CP.esc(r.roomType)}</span>
                <span class="fd-bld b-${CP.building(r.room).toLowerCase()}">${CP.building(r.room)}</span>
                <span class="fd-when">${CP.esc(describe(r, s))}</span>
              </button>
            </li>`).join('')}</ol>` : `<p class="empty">None</p>`}
        </section>`).join('')}
      </div>
      <p class="fine">Only rooms checking out today are in the due-out export. Rooms that were already vacant this morning won't show here.</p>`;
  }

  function bind() {
    const view = $('view-finder');
    view.addEventListener('click', e => {
      const t = e.target.closest('[data-type]');
      if (t) { type = t.dataset.type; if (type === 'all') seaView = false; render(); return; }
      const b = e.target.closest('[data-bld]');
      if (b) { bld = b.dataset.bld; render(); return; }
      if (e.target.closest('[data-fd=import]')) { CP.go('departures'); $('dep-file').click(); return; }
      const r = e.target.closest('[data-room]');
      if (r) CP.openRoom(r.dataset.room);
    });
    view.addEventListener('change', e => {
      if (e.target.id === 'fd-exact') { seaView = e.target.checked; render(); }
    });
  }

  CP.renderFinder = render;
  document.addEventListener('DOMContentLoaded', bind);
})(window.CP);
