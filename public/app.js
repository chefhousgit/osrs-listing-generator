const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const browseBtn = document.getElementById('browseBtn');
const previewSection = document.getElementById('previewSection');
const previewGrid = document.getElementById('previewGrid');
const imageCount = document.getElementById('imageCount');
const generateBtn = document.getElementById('generateBtn');
const clearBtn = document.getElementById('clearBtn');
const statusBox = document.getElementById('statusBox');
const resultsSection = document.getElementById('resultsSection');
const metaRow = document.getElementById('metaRow');
const notesBox = document.getElementById('notesBox');

let selectedFiles = [];

function refreshPreviews() {
  previewGrid.innerHTML = '';
  if (selectedFiles.length === 0) {
    previewSection.classList.add('hidden');
    generateBtn.disabled = true;
    return;
  }
  previewSection.classList.remove('hidden');
  generateBtn.disabled = false;
  imageCount.textContent = selectedFiles.length;

  selectedFiles.forEach((file, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'preview-item';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'preview-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedFiles.splice(idx, 1);
      refreshPreviews();
    });
    wrap.appendChild(img);
    wrap.appendChild(removeBtn);
    previewGrid.appendChild(wrap);
  });
}

function addFiles(files) {
  for (const f of files) {
    if (f.type.startsWith('image/')) {
      selectedFiles.push(f);
    }
  }
  refreshPreviews();
}

dropzone.addEventListener('click', (e) => {
  if (e.target === browseBtn) return;
  fileInput.click();
});
browseBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  addFiles(Array.from(e.target.files));
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((ev) => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((ev) => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  });
});
dropzone.addEventListener('drop', (e) => {
  addFiles(Array.from(e.dataTransfer.files));
});

clearBtn.addEventListener('click', () => {
  selectedFiles = [];
  refreshPreviews();
  resultsSection.classList.add('hidden');
  statusBox.classList.add('hidden');
  statusBox.innerHTML = '';
  clearCards();
});

function showStatus(kind, message) {
  statusBox.className = 'status-box ' + kind;
  statusBox.classList.remove('hidden');
  if (kind === 'loading') {
    statusBox.innerHTML = '<div class="spinner"></div><span>' + message + '</span>';
  } else {
    statusBox.textContent = message;
  }
}

function hideStatus() {
  statusBox.classList.add('hidden');
  statusBox.innerHTML = '';
}

function clearCards() {
  document.querySelectorAll('.version-card').forEach((card) => {
    card.querySelector('.output-title').textContent = '';
    card.querySelector('.output-desc').textContent = '';
  });
  metaRow.innerHTML = '';
  notesBox.classList.add('hidden');
  notesBox.textContent = '';
}

function renderResults(data) {
  clearCards();

  metaRow.innerHTML = '';
  const typeBadge = document.createElement('span');
  typeBadge.className = 'badge active';
  typeBadge.textContent = 'Type: ' + (data.accountType || 'Unknown');
  metaRow.appendChild(typeBadge);

  if (data.keyStats) {
    const { combatLevel, totalLevel, totalXP, quests } = data.keyStats;
    if (combatLevel) metaRow.appendChild(makeBadge('Combat ' + combatLevel));
    if (totalLevel) metaRow.appendChild(makeBadge('Total ' + totalLevel));
    if (totalXP) metaRow.appendChild(makeBadge('XP ' + totalXP));
    if (quests) metaRow.appendChild(makeBadge('Quests ' + quests));
  }

  if (data.dataAvailable) {
    const da = data.dataAvailable;
    const flags = [
      ['Stats', da.stats],
      ['Overview', da.overview],
      ['Bank/Gear', da.bankOrGear],
      ['Quests', da.quests],
      ['Achievements', da.achievements]
    ];
    flags.forEach(([label, on]) => {
      const b = document.createElement('span');
      b.className = 'badge' + (on ? ' active' : '');
      b.textContent = (on ? '✓ ' : '– ') + label;
      metaRow.appendChild(b);
    });
    if (da.other) metaRow.appendChild(makeBadge('Other: ' + da.other));
  }

  if (data.notes) {
    notesBox.textContent = data.notes;
    notesBox.classList.remove('hidden');
  }

  const versions = data.versions || {};
  ['professional', 'hype', 'detailed'].forEach((key) => {
    const card = document.querySelector('.version-card[data-version="' + key + '"]');
    if (!card) return;
    const v = versions[key] || { title: '', description: '' };
    card.querySelector('.output-title').textContent = v.title || '';
    card.querySelector('.output-desc').textContent = v.description || '';
  });

  resultsSection.classList.remove('hidden');
}

function makeBadge(text) {
  const b = document.createElement('span');
  b.className = 'badge';
  b.textContent = text;
  return b;
}

generateBtn.addEventListener('click', async () => {
  if (selectedFiles.length === 0) {
    showStatus('error', 'Upload at least one screenshot first.');
    return;
  }

  generateBtn.disabled = true;
  resultsSection.classList.add('hidden');
  showStatus('loading', 'Analyzing screenshots and generating listings...');

  const formData = new FormData();
  selectedFiles.forEach((f) => formData.append('images', f));

  try {
    const res = await fetch('/generate', { method: 'POST', body: formData });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data.error || ('Request failed with status ' + res.status);
      showStatus('error', msg);
      generateBtn.disabled = false;
      return;
    }

    hideStatus();
    renderResults(data);
  } catch (err) {
    showStatus('error', 'Network error: ' + err.message);
  } finally {
    generateBtn.disabled = false;
  }
});

document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const card = btn.closest('.version-card');
    const which = btn.getAttribute('data-copy');
    const target = card.querySelector(which === 'title' ? '.output-title' : '.output-desc');
    const text = target.textContent || '';
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1200);
    } catch (e) {
      alert('Copy failed: ' + e.message);
    }
  });
});
