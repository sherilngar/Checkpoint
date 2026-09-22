// ---------- Due-Outs ----------
const dueoutFileInput = document.getElementById('dueout-file');
const dueoutStatus = document.getElementById('dueout-status');
const dueoutResults = document.getElementById('dueout-results');
const concierceList = document.getElementById('concierge-list');
const concergeCountEl = document.getElementById('concierge-count');
const copyConciergeBtn = document.getElementById('copy-concierge-btn');
const balanceListEl = document.getElementById('balance-list');
const balanceCountEl = document.getElementById('balance-count');
const fullCountEl = document.getElementById('full-count');
const excludedNoteEl = document.getElementById('excluded-note');
const fullTable = document.getElementById('full-table');

const CUTOFF_MINUTES = 12 * 60 + 4; // legacy fallback, unused now that the cutoff is user-entered
const NON_ROOM_TYPES = new Set(['PM']); // master/day-use placeholder rows, not real rooms to check
const HARD_EXCLUDE_ETD = new Set(['12:05', '12:06']); // always excluded regardless of cutoff

const cutoffInput = document.getElementById('cutoff-time');
let currentRows = [];

function timeToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function codeLabel(hhmm) {
  switch ((hhmm || '').trim()) {
    case '12:01': return 'preparing';
    case '12:02': return 'luggage assistance';
    case '12:04': return 'unreachable';
    case '12:05': return 'left the property';
    case '12:06': return 'has extension';
    default: return null;
  }
}

function parseBalance(raw) {
  if (!raw) return 0;
  const negative = /-/.test(raw) || /\bCR\b/i.test(raw);
  const num = (raw.match(/[\d,]+\.\d{2}/) || ['0'])[0].replace(/,/g, '');
  const val = parseFloat(num) || 0;
  return negative ? -val : val;
}

function parseOperaTable(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length < 2) return [];
  const headers = Array.from(rows[0].querySelectorAll('th,td')).map(c => c.textContent.trim());
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = Array.from(rows[i].querySelectorAll('td'));
    if (cells.length === 0) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cells[idx] ? cells[idx].textContent.trim() : ''; });
    data.push(obj);
  }
  return data;
}

const BUILDING_NAMES = { '1': 'Zumroud', '2': 'Amwaj', '3': 'Marmar' };
function buildingLabel(room) {
  const lead = room.trim()[0];
  if (!lead) return 'Unknown';
  return BUILDING_NAMES[lead] || `Building ${lead}xxx`;
}

function renderConciergeList(rows) {
  const cutoffMins = timeToMinutes(cutoffInput.value);

  const eligible = rows.filter(r => {
    if (NON_ROOM_TYPES.has(r['Room Type'])) return false;
    const etd = (r['ETD'] || '').trim();
    if (HARD_EXCLUDE_ETD.has(etd)) return false; // always excluded
    if (etd === '') return true; // blank ETD — always included
    const mins = timeToMinutes(etd);
    if (mins === null) return true; // unparseable — include, worth a manual glance
    if (cutoffMins === null) return true; // no cutoff set yet — don't filter on time
    return mins < cutoffMins; // strictly before the cutoff
  });

  // group by building, sort by ETD ascending within each building
  const groups = {};
  eligible.forEach(r => {
    const b = buildingLabel(r['Room']);
    (groups[b] = groups[b] || []).push(r);
  });
  Object.values(groups).forEach(g => g.sort((a, b) => a['Room'].localeCompare(b['Room'], undefined, { numeric: true })));

  const buildingOrder = ['Zumroud', 'Amwaj', 'Marmar'];
  const buildingKeys = Object.keys(groups).sort((a, b) => {
    const ia = buildingOrder.indexOf(a), ib = buildingOrder.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  let text = `Total physical checks: ${eligible.length}\n`;
  text += buildingKeys.map(b => `${b}: ${groups[b].length}`).join(' · ') + '\n\n';
  buildingKeys.forEach(b => {
    text += `${b}\n`;
    groups[b].forEach(r => {
      const label = codeLabel(r['ETD']);
      text += `${r['Room']}${label ? '  (' + label + ')' : r['ETD'] ? '  (' + r['ETD'] + ')' : ''}\n`;
    });
    text += '\n';
  });

  concierceList.value = text.trim();
  concergeCountEl.textContent = `(${eligible.length})`;

  const excludedLeft = rows.filter(r => codeLabel(r['ETD']) === 'left the property').length;
  const excludedExt = rows.filter(r => codeLabel(r['ETD']) === 'has extension').length;
  const excludedPM = rows.filter(r => NON_ROOM_TYPES.has(r['Room Type'])).length;
  const bits = [];
  if (excludedLeft) bits.push(`${excludedLeft} already confirmed left`);
  if (excludedExt) bits.push(`${excludedExt} extension`);
  if (excludedPM) bits.push(`${excludedPM} non-room/master account`);
  excludedNoteEl.textContent = bits.length ? `Excluded from the list above: ${bits.join(', ')}.` : '';
}

function renderBalanceFlags(rows) {
  const flagged = rows
    .map(r => ({ ...r, _bal: parseBalance(r['Balance']) }))
    .filter(r => r._bal !== 0)
    .sort((a, b) => Math.abs(b._bal) - Math.abs(a._bal));

  balanceCountEl.textContent = `(${flagged.length})`;
  if (flagged.length === 0) {
    balanceListEl.innerHTML = '<p class="hint">None.</p>';
    return;
  }
  balanceListEl.innerHTML = flagged.map(r => {
    const kind = r._bal < 0 ? 'Credit — refund due' : 'Owed — collect at checkout';
    return `<div class="balance-row"><strong>${r['Room']}</strong> · ${r['Name']} · ${r['Balance']} <span class="tag">${kind}</span></div>`;
  }).join('');
}

function renderFullTable(rows) {
  fullCountEl.textContent = `(${rows.length})`;
  const cols = ['Room', 'Name', 'ETD', 'Balance', 'VIP Code', 'Travel Agent'];
  let html = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
  rows
    .slice()
    .sort((a, b) => (timeToMinutes(a['ETD']) ?? 9999) - (timeToMinutes(b['ETD']) ?? 9999))
    .forEach(r => {
      html += '<tr>' + cols.map(c => `<td>${r[c] || ''}</td>`).join('') + '</tr>';
    });
  fullTable.innerHTML = html;
}

dueoutFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  dueoutStatus.style.display = 'block';
  dueoutStatus.textContent = 'Reading file…';
  try {
    const text = await file.text();
    const rows = parseOperaTable(text);
    if (!rows || rows.length === 0) {
      dueoutStatus.textContent = "Couldn't find a table in that file — make sure it's the Opera export as downloaded, unedited.";
      return;
    }
    currentRows = rows;
    dueoutResults.style.display = 'block';
    dueoutStatus.textContent = `Loaded ${rows.length} due-outs.`;
    renderConciergeList(currentRows);
    renderBalanceFlags(currentRows);
    renderFullTable(currentRows);
  } catch (err) {
    dueoutStatus.textContent = 'Failed to read that file.';
    console.error(err);
  }
});

cutoffInput.addEventListener('input', () => {
  if (currentRows.length) renderConciergeList(currentRows);
});

copyConciergeBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(concierceList.value).then(() => {
    copyConciergeBtn.textContent = 'Copied!';
    setTimeout(() => copyConciergeBtn.textContent = 'Copy list', 1200);
  });
});
