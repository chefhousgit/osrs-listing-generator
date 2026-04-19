const usernameInput = document.getElementById('usernameInput');
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
const auditPanel = document.getElementById('auditPanel');
const auditBody = document.getElementById('auditBody');

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
  auditPanel.classList.add('hidden');
  auditBody.innerHTML = '';
}

function renderAudit(extracted, hiscores) {
  auditBody.innerHTML = '';
  if (!extracted && !hiscores) {
    auditPanel.classList.add('hidden');
    return;
  }

  if (hiscores && Array.isArray(hiscores.skills)) {
    const wrap = document.createElement('div');
    wrap.className = 'audit-screenshot';
    const header = document.createElement('div');
    header.className = 'audit-screenshot-header';
    header.innerHTML = '<span>Hiscores lookup (authoritative): ' + escapeHtml(hiscores.accountType || 'main') + '</span>';
    const conf = document.createElement('span');
    conf.className = 'audit-conf high';
    conf.textContent = 'authoritative';
    header.appendChild(conf);
    wrap.appendChild(header);

    const chipsRow = document.createElement('div');
    chipsRow.className = 'audit-skills';
    const overall = hiscores.skills.find((s) => s.name === 'Overall');
    if (overall && overall.level) {
      const c = document.createElement('span');
      c.className = 'skill-chip';
      c.textContent = 'Total ' + overall.level;
      chipsRow.appendChild(c);
    }
    if (hiscores.combatLevel) {
      const c = document.createElement('span');
      c.className = 'skill-chip';
      c.textContent = 'Combat ' + hiscores.combatLevel;
      chipsRow.appendChild(c);
    }
    hiscores.skills
      .filter((s) => s.name !== 'Overall' && s.level && s.level > 1)
      .sort((a, b) => b.level - a.level)
      .forEach((s) => {
        const c = document.createElement('span');
        c.className = 'skill-chip';
        c.textContent = s.level + ' ' + s.name;
        chipsRow.appendChild(c);
      });
    wrap.appendChild(chipsRow);
    auditBody.appendChild(wrap);
  }

  if (!extracted) {
    auditPanel.classList.remove('hidden');
    return;
  }

  const shots = Array.isArray(extracted.perScreenshot) ? extracted.perScreenshot : [];
  shots.forEach((shot) => {
    const wrap = document.createElement('div');
    wrap.className = 'audit-screenshot';

    const header = document.createElement('div');
    header.className = 'audit-screenshot-header';
    const idx = shot.imageIndex ? ' #' + shot.imageIndex : '';
    header.innerHTML = '<span>Image' + idx + ': ' + escapeHtml(shot.screenshotType || 'unknown') + '</span>';
    if (shot.confidence) {
      const conf = document.createElement('span');
      conf.className = 'audit-conf ' + String(shot.confidence).toLowerCase();
      conf.textContent = shot.confidence + ' confidence';
      header.appendChild(conf);
    }
    wrap.appendChild(header);

    const facts = document.createElement('dl');
    facts.className = 'audit-facts';

    const addRow = (label, value) => {
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
      facts.appendChild(dt);
      facts.appendChild(dd);
    };

    addRow('Combat level', shot.combatLevel);
    addRow('Total level', shot.totalLevel);
    addRow('Total XP', shot.totalXP);
    addRow('Quest points', shot.questPoints);
    addRow('Achievement diary', shot.achievementDiary);
    addRow('Combat achievements', shot.combatAchievements);
    addRow('Collection log', shot.collectionLog);
    addRow('Clue scrolls', shot.clueScrolls);

    if (Array.isArray(shot.skillsVisible) && shot.skillsVisible.length > 0) {
      const dt = document.createElement('dt');
      dt.textContent = 'Skills read';
      const dd = document.createElement('dd');
      const chips = document.createElement('div');
      chips.className = 'audit-skills';
      shot.skillsVisible.forEach((s) => {
        const c = document.createElement('span');
        c.className = 'skill-chip';
        c.textContent = (s.level !== undefined && s.level !== null ? s.level + ' ' : '') + (s.skill || '');
        chips.appendChild(c);
      });
      dd.appendChild(chips);
      facts.appendChild(dt);
      facts.appendChild(dd);
    }

    if (Array.isArray(shot.visibleItemsOrGear) && shot.visibleItemsOrGear.length > 0) {
      addRow('Items/gear', shot.visibleItemsOrGear.join(', '));
    }
    if (Array.isArray(shot.otherFacts) && shot.otherFacts.length > 0) {
      addRow('Other', shot.otherFacts.join('; '));
    }

    wrap.appendChild(facts);
    auditBody.appendChild(wrap);
  });

  const unclear = Array.isArray(extracted.unreadableOrUnclear) ? extracted.unreadableOrUnclear : [];
  if (unclear.length > 0) {
    const box = document.createElement('div');
    box.className = 'audit-unclear';
    const title = document.createElement('strong');
    title.textContent = 'Unreadable or unclear (omitted from listing):';
    box.appendChild(title);
    const ul = document.createElement('ul');
    unclear.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
    box.appendChild(ul);
    auditBody.appendChild(box);
  }

  if (shots.length === 0 && unclear.length === 0) {
    auditPanel.classList.add('hidden');
    return;
  }
  auditPanel.classList.remove('hidden');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  const listing = data.listing || (data.versions && data.versions.hype) || { title: '', description: '' };
  const card = document.querySelector('.version-card[data-version="hype"]');
  if (card) {
    card.querySelector('.output-title').textContent = listing.title || '';
    card.querySelector('.output-desc').textContent = listing.description || '';
  }

  if (data.hiscoresUsed) {
    const b = document.createElement('span');
    b.className = 'badge active';
    b.textContent = '📊 Hiscores: ' + (data.hiscoresUsed.accountType || 'main');
    metaRow.appendChild(b);
  }
  if (data.hiscoresError) {
    const err = document.createElement('div');
    err.className = 'audit-unclear';
    err.innerHTML = '<strong>Hiscore lookup failed:</strong>' + escapeHtml(data.hiscoresError);
    err.style.marginTop = '10px';
    metaRow.after(err);
  }

  renderAudit(data.extractedData, data.hiscoresUsed);

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
  const username = usernameInput.value.trim();
  if (username) formData.append('username', username);

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
