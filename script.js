// ---------- Tab switching ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ---------- Checkout Extractor ----------
const dropzone = document.getElementById('dropzone');
const dropzoneLabel = document.getElementById('dropzone-label');
const previewImg = document.getElementById('preview-img');
const ocrStatus = document.getElementById('ocr-status');
const rawTextInput = document.getElementById('raw-text-input');
const extractTextBtn = document.getElementById('extract-text-btn');
const resultsBox = document.getElementById('results');
const dedupeToggle = document.getElementById('dedupe-toggle');
const roomCountEl = document.getElementById('room-count');
const operaFormatEl = document.getElementById('opera-format');
const copyBtn = document.getElementById('copy-btn');
const rawMatchesEl = document.getElementById('raw-matches');
const browseBtn = document.getElementById('browse-btn');
const browseInput = document.getElementById('browse-input');
const totalRoomsBox = document.getElementById('total-rooms-box');
const totalRoomsNumber = document.getElementById('total-rooms-number');

let lastRawMatches = []; // room numbers in first-seen order, with duplicates

// Room number: 4 digits, followed (allowing a little whitespace) by "co", "c.o", "check out", or "checkout"
// Word-boundary-ish on the left so we don't grab the tail end of a longer number/timestamp.
const CHECKOUT_REGEX = /(?<![0-9])(\d{4})\s*(?:c\s*\/?\s*o\b|check\s*-?\s*out\b|checkout\b|vacant\b)/gi;

function extractRooms(text) {
  const matches = [];
  let m;
  const re = new RegExp(CHECKOUT_REGEX); // fresh instance (regex has lastIndex state)
  while ((m = re.exec(text)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

function renderResults(matches) {
  lastRawMatches = matches;
  if (matches.length === 0) {
    resultsBox.style.display = 'block';
    roomCountEl.textContent = 'No room numbers found — try pasting the raw text instead, or check the screenshot is clear.';
    operaFormatEl.value = '';
    rawMatchesEl.textContent = '';
    totalRoomsBox.style.display = 'none';
    return;
  }

  const dedupe = dedupeToggle.checked;
  let list = matches.slice();
  if (dedupe) {
    list = [...new Set(list)];
  }
  list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  resultsBox.style.display = 'block';
  roomCountEl.textContent = `${list.length} room${list.length === 1 ? '' : 's'}${dedupe && matches.length !== list.length ? ` (${matches.length - list.length} duplicate${matches.length - list.length === 1 ? '' : 's'} removed)` : ''}`;
  operaFormatEl.value = list.join(',');

  totalRoomsBox.style.display = 'flex';
  totalRoomsNumber.textContent = list.length;

  // Show duplicates explicitly if dedupe is off or if there were any, so nothing gets silently hidden
  const counts = {};
  matches.forEach(r => counts[r] = (counts[r] || 0) + 1);
  const dupes = Object.entries(counts).filter(([, c]) => c > 1);
  if (dupes.length > 0) {
    rawMatchesEl.textContent = 'Seen more than once: ' + dupes.map(([r, c]) => `${r} (×${c})`).join(', ');
  } else {
    rawMatchesEl.textContent = '';
  }
}

dedupeToggle.addEventListener('change', () => renderResults(lastRawMatches));

extractTextBtn.addEventListener('click', () => {
  const text = rawTextInput.value;
  if (!text.trim()) return;
  renderResults(extractRooms(text));
});

async function runOCR(imageSource) {
  ocrStatus.style.display = 'block';
  ocrStatus.textContent = 'Reading screenshot…';
  try {
    const { data: { text } } = await Tesseract.recognize(imageSource, 'eng');
    ocrStatus.textContent = 'Done reading. Extracting room numbers…';
    const matches = extractRooms(text);
    renderResults(matches);
    ocrStatus.textContent = `OCR complete. If a number looks wrong, paste the exact text below instead for 100% accuracy.`;
  } catch (err) {
    ocrStatus.textContent = 'OCR failed — try pasting the text directly below instead.';
    console.error(err);
  }
}

function handlePastedImage(blob) {
  const url = URL.createObjectURL(blob);
  previewImg.src = url;
  previewImg.style.display = 'block';
  dropzoneLabel.style.display = 'none';
  runOCR(url);
}

dropzone.addEventListener('paste', (e) => {
  e.preventDefault();
  const items = e.clipboardData.items;
  let handledImage = false;
  for (const item of items) {
    if (item.type.indexOf('image') === 0) {
      const blob = item.getAsFile();
      handlePastedImage(blob);
      handledImage = true;
      break;
    }
  }
  if (!handledImage) {
    const text = e.clipboardData.getData('text');
    if (text) {
      rawTextInput.value = text;
      renderResults(extractRooms(text));
    }
  }
});

dropzone.addEventListener('click', (e) => {
  if (e.target === browseBtn) return; // let the browse button handle its own click
  dropzone.focus();
});

browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  browseInput.click();
});

browseInput.addEventListener('change', () => {
  const file = browseInput.files[0];
  if (file) handlePastedImage(file);
});

['dragover', 'dragenter'].forEach(evt => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
});
['dragleave', 'dragend'].forEach(evt => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  });
});
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files && files.length > 0 && files[0].type.indexOf('image') === 0) {
    handlePastedImage(files[0]);
    return;
  }
  const text = e.dataTransfer.getData('text');
  if (text) {
    rawTextInput.value = text;
    renderResults(extractRooms(text));
  }
});

copyBtn.addEventListener('click', () => {
  operaFormatEl.select();
  operaFormatEl.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(operaFormatEl.value).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => copyBtn.textContent = 'Copy to clipboard', 1200);
  }).catch(() => {
    document.execCommand('copy');
  });
});
