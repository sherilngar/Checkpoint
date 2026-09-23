(function (CP) {
  const $ = (id) => document.getElementById(id);
  const NUM = '(?<![\\d:./])\\d{4}(?![\\d:/])';

  // ---------- extraction ----------
  async function pdfToText(file) {
    if (!window.pdfjsLib) {
      await CP.loadScript(CP.LIB.pdf);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CP.LIB.pdfWorker;
    }
    const buf = await file.arrayBuffer();
    const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
    }
    return text;
  }

  function candidateRooms(text) {
    const year = new Date().getFullYear();
    const skip = new Set([String(year), String(year + 1), String(year - 1)]);
    const all = String(text).match(new RegExp(NUM, 'g')) || [];
    const counts = {};
    all.forEach(n => { if (!skip.has(n) && CP.building(n) !== 'Other') counts[n] = (counts[n] || 0) + 1; });
    return counts; // room -> how many times it appeared in the report
  }

  // ---------- state ----------
  CP.dayListRooms = (s) => new Set((s.dayList && s.dayList.rooms) || []);

  // ---------- draft (review-before-save) ----------
  let draft = null; // { fileName, counts: {room: n}, removed: Set }

  function draftRooms() {
    return CP.sortRooms(Object.keys(draft.counts).filter(r => !draft.removed.has(r)));
  }

  function renderDraft() {
    const box = $('dl-draft');
    if (!draft) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    const kept = draftRooms();
    box.innerHTML = `
      <div class="panel-head">
        <h2>Check the list before saving</h2>
        <span class="meta">${kept.length} of ${Object.keys(draft.counts).length} rooms from ${CP.esc(draft.fileName)}</span>
      </div>
      <p class="fine">Pulled every 4-digit number in the report that matches a real room range. Remove anything that isn't actually a room (a confirmation or reference number can occasionally slip through), or add one that's missing below.</p>
      <div class="tiles" id="dl-tiles">${kept.map(r => CP.tile(r, 's-fresh', draft.counts[r] > 1 ? '×' + draft.counts[r] : CP.building(r), 'data-remove')).join('')}</div>
      <div class="dl-add">
        <input id="dl-add-input" inputmode="numeric" maxlength="4" placeholder="Add room, e.g. 1240">
        <button class="btn" id="dl-add-btn" type="button">Add</button>
      </div>
      <div class="sheet-actions">
        <button class="btn primary" id="dl-save" type="button">Save list (${kept.length} rooms)</button>
        <button class="btn ghost" id="dl-discard" type="button">Discard</button>
      </div>`;
    $('dl-tiles').addEventListener('click', e => {
      const t = e.target.closest('[data-remove]');
      if (!t) return;
      draft.removed.add(t.dataset.room);
      renderDraft();
    });
    const addOne = () => {
      const v = $('dl-add-input').value.trim();
      if (!/^\d{4}$/.test(v)) return;
      draft.counts[v] = (draft.counts[v] || 0) + 1;
      draft.removed.delete(v);
      $('dl-add-input').value = '';
      renderDraft();
    };
    $('dl-add-btn').addEventListener('click', addOne);
    $('dl-add-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addOne(); } });
    $('dl-save').addEventListener('click', () => {
      const rooms = draftRooms();
      CP.update(s => { s.dayList = { rooms, fileName: draft.fileName, importedAt: Date.now() }; });
      draft = null;
      CP.toast(`Saved ${CP.plural(rooms.length, 'room')} to the day list`);
      render();
    });
    $('dl-discard').addEventListener('click', () => { draft = null; renderDraft(); });
  }

  async function handleFile(file) {
    const status = $('dl-status');
    status.hidden = false;
    status.textContent = 'Reading the PDF…';
    try {
      const text = await pdfToText(file);
      const counts = candidateRooms(text);
      if (!Object.keys(counts).length) {
        status.textContent = "Couldn't find any room numbers in that PDF. If it's a scanned image rather than a text report, this won't be able to read it.";
        return;
      }
      status.hidden = true;
      draft = { fileName: file.name, counts, removed: new Set() };
      renderDraft();
    } catch (e) {
      console.error(e);
      status.textContent = 'Could not read that file. Make sure it\'s a PDF.';
    }
  }

  // ---------- main render ----------
  function render() {
    const s = CP.state();
    const box = $('dl-body');
    if (!box) return;

    if (!s.dayList) {
      box.innerHTML = `<div class="panel dl-empty">
        <h2>No full-day list yet</h2>
        <p class="meta">Upload today's full departures report — the one that lists every room checking out today, not just what's still outstanding. Every checkout you read on the Checkouts tab is then checked against it, so a room that isn't actually departing today gets flagged instead of silently logged.</p>
      </div>`;
    } else {
      const hhmm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
      box.innerHTML = `<div class="panel">
        <div class="panel-head">
          <h2>Today's full departure list</h2>
          <span class="meta">${s.dayList.fileName}, saved ${hhmm(s.dayList.importedAt)}</span>
        </div>
        <div class="tiles">${CP.sortRooms(s.dayList.rooms).map(r => CP.tile(r, 's-plain', CP.building(r))).join('')}</div>
      </div>`;
    }
  }

  function bind() {
    const drop = $('dl-drop');
    const file = $('dl-file');
    $('dl-browse').addEventListener('click', () => file.click());
    file.addEventListener('change', () => { if (file.files[0]) handleFile(file.files[0]); file.value = ''; });
    const view = $('view-daylist');
    ['dragenter', 'dragover'].forEach(ev => view.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => view.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === view) drop.classList.remove('over'); }));
    view.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  }

  CP.renderDayList = render;
  CP.importDayListFile = handleFile;
  document.addEventListener('DOMContentLoaded', bind);
})(window.CP);
