(function (CP) {
  const $ = (id) => document.getElementById(id);

  // ---------- extraction ----------
  // A room (or a short list of rooms on one line) followed by a checkout word.
  const NUM = '(?<![\\d:./])\\d{4}(?![\\d:/])';
  const KW = '(?:c\\s*[\\/.]?\\s*[o0](?![a-z])|checked\\s*-?\\s*out\\b|check\\s*-?\\s*out\\b|checkout\\b|chk\\s*out\\b|vacant\\b|vac\\b|vd\\b)';
  const SEQ = `((?:${NUM}[ \\t]*(?:,|&|and|\\/|\\+)?[ \\t]*)+)${KW}`;

  function extract(text) {
    const re = new RegExp(SEQ, 'gi');
    const found = [];
    let m;
    while ((m = re.exec(String(text))) !== null) {
      (m[1].match(new RegExp(NUM, 'g')) || []).forEach(n => found.push(n));
    }
    return found;
  }
  CP.extractCheckouts = extract;

  let last = null; // { found: [...with duplicates], source: 'image'|'text' }

  // ---------- OCR ----------
  let workerP = null;
  function getWorker() {
    if (!workerP) workerP = Tesseract.createWorker('eng');
    return workerP;
  }

  function prep(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 3200;
        const scale = Math.min(2, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const p = d.data;
        let sum = 0;
        for (let i = 0; i < p.length; i += 16) sum += 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
        const dark = sum / (p.length / 16) < 128; // dark-mode chat → invert to black on white
        for (let i = 0; i < p.length; i += 4) {
          let g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
          if (dark) g = 255 - g;
          g = g < 150 ? Math.max(0, g - 40) : 255; // push text darker, wash background out
          p[i] = p[i + 1] = p[i + 2] = g;
        }
        ctx.putImageData(d, 0, 0);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function setStatus(msg) {
    const el = $('ex-status');
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  async function readImage(blob) {
    const url = URL.createObjectURL(blob);
    const prev = $('ex-preview');
    prev.src = url; prev.hidden = false;
    $('ex-drop-inner').classList.add('compact');
    try {
      if (!window.Tesseract) {
        setStatus('Loading the screenshot reader (first time only)…');
        await CP.loadScript(CP.LIB.ocr);
      }
      setStatus('Cleaning up the image…');
      const img = await prep(url);
      const w = await getWorker();
      // Two passes with different layout modes; keep whichever finds more rooms.
      setStatus('Reading the screenshot (pass 1 of 2)…');
      await w.setParameters({ tessedit_pageseg_mode: '3' });
      const a = (await w.recognize(img)).data.text;
      setStatus('Reading the screenshot (pass 2 of 2)…');
      await w.setParameters({ tessedit_pageseg_mode: '11' });
      const b = (await w.recognize(img)).data.text;
      const fa = extract(a), fb = extract(b);
      const found = fb.length > fa.length ? fb : fa;
      last = { found, source: 'image' };
      setStatus(found.length
        ? `Found ${CP.plural(found.length, 'checkout mention')}. Compare the count with the screenshot before you process.`
        : 'No checkout mentions found. If the screenshot is blurry, paste the text instead.');
      render();
    } catch (e) {
      console.error(e);
      setStatus(window.Tesseract ? 'The screenshot could not be read. Paste the text instead.' : 'The screenshot reader could not load. Check the connection, or paste the text instead.');
    }
  }

  function readText(text) {
    last = { found: extract(text), source: 'text' };
    setStatus(last.found.length ? '' : 'No checkout mentions in that text.');
    render();
  }
  CP.readCheckoutImage = readImage;
  CP.readCheckoutText = readText;

  const unprocessed = (s) => CP.sortRooms(Object.keys(s.co.reported).filter(r => !s.co.processed[r]));
  CP.unprocessedCheckouts = () => unprocessed(CP.state());

  // ---------- rendering ----------
  function render() {
    const s = CP.state();
    const res = $('ex-result');

    if (!last) {
      res.innerHTML = `<div class="panel-head"><h2>Result</h2></div><p class="empty">Rooms from the screenshot appear here as tags, checked against today's due-outs.</p>`;
    } else {
      const counts = {};
      last.found.forEach(r => counts[r] = (counts[r] || 0) + 1);
      const unique = CP.sortRooms(Object.keys(counts));
      const dupes = unique.filter(r => counts[r] > 1);
      const dayRooms = CP.dayListRooms(s);
      const known = (r) => (s.dueouts && CP.rowByRoom(r)) || (s.dayList && dayRooms.has(r));
      const notDue = (s.dueouts || s.dayList) ? unique.filter(r => !known(r)) : [];
      const already = unique.filter(r => s.co.reported[r]);
      const fresh = unique.filter(r => !s.co.reported[r] && !notDue.includes(r));
      res.innerHTML = `
        <div class="panel-head"><h2>Result</h2><span class="meta">from ${last.source === 'image' ? 'screenshot' : 'text'}</span></div>
        <div class="tally">
          <div><strong>${last.found.length}</strong><span>mentions found</span></div>
          <div><strong>${unique.length}</strong><span>unique rooms</span></div>
          ${dupes.length ? `<div><strong>${dupes.length}</strong><span>said twice</span></div>` : ''}
        </div>
        ${notDue.length ? `<p class="warn-text">Not found in today's departures${s.dayList ? ' (due-out export or full-day list)' : ''}: ${notDue.join(', ')}. Check in Opera — wrong room number, or checking out a different day. ${notDue.length === 1 ? 'It is' : 'They are'} left out of the log; tap the tag to log it by hand.</p>` : ''}
        ${already.length ? `<p class="fine">Already logged: ${already.join(', ')}</p>` : ''}
        <div class="tiles">${unique.map(r => CP.tile(r,
          (notDue.includes(r) ? 's-alert' : s.co.reported[r] ? 's-co' : 's-fresh'),
          counts[r] > 1 ? '×' + counts[r] : (notDue.includes(r) ? 'Not due out' : CP.building(r)))).join('')}</div>
        ${CP.operaBox(unique)}
        <div class="actions">
          <button class="btn primary" id="ex-log" type="button" ${fresh.length ? '' : 'disabled'}>Log ${fresh.length || ''} as checked out</button>
          <button class="btn" id="ex-copy" type="button">Copy Opera list</button>
          <button class="btn ghost" id="ex-clear" type="button">Clear</button>
        </div>`;
      $('ex-copy').onclick = () => CP.copy(unique.join(','), `Copied ${CP.plural(unique.length, 'room')}`);
      $('ex-log').onclick = () => {
        CP.update(st => { const t = Date.now(); fresh.forEach(r => { st.co.reported[r] = t; }); });
        CP.toast(`Logged ${CP.plural(fresh.length, 'checkout')}. They're off the Concierge list.`);
      };
      $('ex-clear').onclick = () => {
        last = null; setStatus('');
        $('ex-preview').hidden = true;
        $('ex-drop-inner').classList.remove('compact');
        render();
      };
    }

    // today's log
    const all = CP.sortRooms(Object.keys(s.co.reported));
    const todo = unprocessed(s);
    const done = all.length - todo.length;
    $('ex-today').innerHTML = `
      <div class="panel-head">
        <h2>Today's checkout log</h2>
        <span class="meta">${CP.plural(all.length, 'room')} reported, ${done} processed in Opera</span>
      </div>
      ${all.length ? `
        <div class="log-grid">
          <div>
            <h3 class="small-head">Waiting to be checked out in Opera <b>${todo.length}</b></h3>
            ${todo.length ? `${CP.operaBox(todo)}
            <div class="actions">
              <button class="btn primary" id="log-copy" type="button">Copy Opera list</button>
              <button class="btn" id="log-done" type="button">Mark all processed</button>
            </div>` : `<p class="empty">All reported checkouts are processed.</p>`}
          </div>
          <div class="tiles">${all.map(r => CP.tile(r, s.co.processed[r] ? 's-done' : 's-co', s.co.processed[r] ? 'Processed' : 'Reported')).join('')}</div>
        </div>` : `<p class="empty">Nothing logged yet. Read a screenshot and log the rooms, or mark rooms from the key rack.</p>`}`;
    const lc = $('log-copy'), ld = $('log-done');
    if (lc) lc.onclick = () => CP.copy(todo.join(','), `Copied ${CP.plural(todo.length, 'room')}`);
    if (ld) ld.onclick = () => { CP.update(st => { const t = Date.now(); todo.forEach(r => { st.co.processed[r] = t; }); }); CP.toast('Marked as processed'); };
  }

  // ---------- events ----------
  function bind() {
    const drop = $('ex-drop');
    const file = $('ex-file');
    $('ex-browse').addEventListener('click', (e) => { e.stopPropagation(); file.click(); });
    file.addEventListener('change', () => { if (file.files[0]) readImage(file.files[0]); file.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => {
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image')) return readImage(f);
      const t = e.dataTransfer.getData('text');
      if (t) { $('ex-text').value = t; readText(t); }
    });
    $('ex-text-btn').addEventListener('click', () => readText($('ex-text').value));
    ['ex-result', 'ex-today'].forEach(id => $(id).addEventListener('click', e => {
      const t = e.target.closest('.tile[data-room]');
      if (t) CP.openRoom(t.dataset.room);
    }));
  }

  CP.resetCheckouts = () => {
    last = null; setStatus('');
    $('ex-preview').hidden = true;
    $('ex-drop-inner').classList.remove('compact');
    $('ex-text').value = '';
    CP.update(s => { s.co = { reported: {}, processed: {} }; });
    CP.toast('Checkouts reset');
  };

  CP.renderCheckouts = render;
  document.addEventListener('DOMContentLoaded', bind);
})(window.CP);
