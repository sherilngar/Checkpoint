(function (CP) {
  const $ = (id) => document.getElementById(id);

  function render() {
    const raw = CP.allRoomNumbers($('tl-input').value);
    const dedupe = $('tl-dedupe').checked;
    const rooms = CP.sortRooms(dedupe ? [...new Set(raw)] : raw);
    const out = $('tl-out');
    if (!rooms.length) {
      out.innerHTML = `<div class="panel-head"><h2>Result</h2></div><p class="empty">Paste text on the left. Four-digit room numbers are pulled out, sorted and joined the way Opera wants them.</p>`;
      return;
    }
    const g = CP.groupByBuilding(rooms);
    const order = CP.BUILDING_ORDER.filter(b => g[b]);
    const split = order.map(b => `${b} (${g[b].length})\n${g[b].join(',')}`).join('\n\n');
    out.innerHTML = `
      <div class="panel-head"><h2>Result</h2><span class="meta">${CP.plural(rooms.length, 'room')}${raw.length !== rooms.length ? `, ${raw.length - rooms.length} duplicates removed` : ''}</span></div>
      ${CP.operaBox(rooms, 'tl-opera')}
      <div class="actions">
        <button class="btn primary" data-tl="opera" type="button">Copy Opera list</button>
        <button class="btn" data-tl="split" type="button">Copy split by building</button>
      </div>
      ${order.map(b => `<div class="rack-group"><h3 class="bld-name">${b}<span>${g[b].length}</span></h3><div class="tiles">${g[b].map(r => CP.tile(r, CP.rowByRoom(r) ? 's-' + CP.roomStatus(CP.rowByRoom(r)) : 's-plain', '')).join('')}</div></div>`).join('')}`;
    out.querySelector('[data-tl=opera]').onclick = () => CP.copy(rooms.join(','), `Copied ${CP.plural(rooms.length, 'room')}`);
    out.querySelector('[data-tl=split]').onclick = () => CP.copy(split, 'Copied by building');
  }

  function bind() {
    $('tl-input').addEventListener('input', render);
    $('tl-dedupe').addEventListener('change', render);
    $('tl-out').addEventListener('click', e => { const t = e.target.closest('.tile[data-room]'); if (t) CP.openRoom(t.dataset.room); });
    render();
  }
  CP.renderTools = render;
  document.addEventListener('DOMContentLoaded', bind);
})(window.CP);
