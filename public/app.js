const usernameInput = document.getElementById('usernameInput');
const fileInput = document.getElementById('fileInput');
const gearToggle = document.getElementById('gearToggle');
const gearDrawer = document.getElementById('gearDrawer');
const gearBackdrop = document.getElementById('gearBackdrop');
const gearClose = document.getElementById('gearClose');
const gearList = document.getElementById('gearList');
const gearSearch = document.getElementById('gearSearch');
const gearCountEl = document.getElementById('gearCount');
const gearClearAll = document.getElementById('gearClearAll');
const gearSelectedText = document.getElementById('gearSelectedText');

const GEAR_CATEGORIES = [
  {
    name: 'Capes',
    items: ['Fire Cape', 'Infernal Cape', 'Max Cape', 'Completionist Cape', 'Mythical Cape', 'Imbued Saradomin Cape', 'Imbued Zamorak Cape', 'Imbued Guthix Cape', "Ava's Assembler", 'Dizana\'s Quiver', 'Ranger Cape']
  },
  {
    name: 'BiS Weapons',
    items: ['Scythe of Vitur', 'Twisted Bow', "Tumeken's Shadow", 'Ghrazi Rapier', 'Sanguinesti Staff', 'Toxic Blowpipe', 'Dragon Claws', 'Zaryte Crossbow', 'Abyssal Whip', 'Abyssal Tentacle', 'Saradomin Godsword', 'Armadyl Godsword', 'Bandos Godsword']
  },
  {
    name: 'BiS Armor',
    items: ['Torva (full set)', 'Ancestral (full set)', 'Masori (f) (full set)', 'Virtus (full set)', 'Bandos Chestplate', 'Bandos Tassets', 'Armadyl Chestplate', 'Armadyl Chainskirt', 'Avernic Defender', 'Primordial Boots', 'Pegasian Boots', 'Eternal Boots', 'Justiciar (full set)']
  },
  {
    name: 'Amulets & Jewelry',
    items: ['Amulet of Torture', 'Amulet of Anguish', 'Necklace of Anguish', 'Occult Necklace', 'Amulet of Fury', 'Tormented Bracelet', 'Berserker Ring (i)', 'Archers Ring (i)', 'Seers Ring (i)', 'Warrior Ring (i)', 'Ring of Endurance', 'Salve Amulet (ei)', 'Magus Ring', 'Bellator Ring', 'Ultor Ring', 'Venator Ring', 'Lightbearer']
  },
  {
    name: 'Slayer',
    items: ['Slayer Helmet (i)', 'Black Mask (i)', 'Ferocious Gloves', 'Bonecrusher Necklace', 'Tyrannical Ring (i)']
  },
  {
    name: 'Quest & Diary Rewards',
    items: ['Barrows Gloves', 'Mithril Gloves', 'Dragon Defender', 'Fighter Torso', 'Void Knight (full set)', 'Elite Void (full set)', 'Ardougne Cloak 4', 'Morytania Legs 4', 'Fremennik Sea Boots 4', 'Desert Amulet 4', 'Explorer\'s Ring 4', 'Karamja Gloves 4', 'Varrock Armour 4', 'Wilderness Sword 4', 'Falador Shield 4', 'Kandarin Headgear 4', 'Western Banner 4', 'Rada\'s Blessing 4']
  },
  {
    name: 'Skilling Outfits',
    items: ['Graceful (full set)', 'Prospector (full set)', 'Angler (full set)', 'Lumberjack (full set)', 'Pyromancer (full set)', 'Farmer (full set)', "Zealot's (full set)", 'Rogue (full set)', 'Carpenter (full set)', 'Smith\'s uniform (full set)', 'Raiments of the Eye (Runecrafting)']
  },
  {
    name: 'Clue & Rare',
    items: ['Ranger Boots', '3rd Age item(s)', 'Bloodhound pet', 'Gilded armour pieces', 'Heavy Casket(s) banked', 'God cape (i) - MA2']
  },
  {
    name: 'Other',
    items: ['Rune Pouch', 'Divine Rune Pouch', 'Colossal Pouch', 'Bottomless Compost Bucket', 'Book of the Dead', 'Sire Hilt', 'Dinh\'s Bulwark', 'Elder Maul', 'Hill Giant Club', 'Dragon Hunter Crossbow', 'Dragon Hunter Lance']
  }
];

function buildGearList() {
  gearList.innerHTML = '';
  GEAR_CATEGORIES.forEach((cat) => {
    const sec = document.createElement('section');
    sec.className = 'gear-section';
    const h = document.createElement('h3');
    h.textContent = cat.name;
    sec.appendChild(h);
    cat.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'gear-row';

      const label = document.createElement('label');
      label.className = 'gear-checkbox';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = item;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + item));

      const titleStar = document.createElement('button');
      titleStar.type = 'button';
      titleStar.className = 'gear-title-star';
      titleStar.innerHTML = '<span class="star-icon">★</span><span class="star-label">Title</span>';
      titleStar.title = 'Also feature this item in the listing TITLE (not just the description)';
      titleStar.setAttribute('aria-pressed', 'false');
      titleStar.addEventListener('click', (e) => {
        e.stopPropagation();
        const on = titleStar.classList.toggle('active');
        titleStar.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on && !input.checked) {
          input.checked = true;
          updateGearCount();
        }
      });

      input.addEventListener('change', () => {
        if (!input.checked && titleStar.classList.contains('active')) {
          titleStar.classList.remove('active');
          titleStar.setAttribute('aria-pressed', 'false');
        }
      });

      row.appendChild(label);
      row.appendChild(titleStar);
      sec.appendChild(row);
    });
    gearList.appendChild(sec);
  });
  gearList.addEventListener('change', (e) => {
    if (e.target && e.target.matches('input[type=checkbox]')) updateGearCount();
  });
}

function updateGearCount() {
  const checked = gearList.querySelectorAll('input[type=checkbox]:checked');
  const n = checked.length;
  if (n > 0) {
    gearCountEl.textContent = n;
    gearCountEl.classList.remove('hidden');
    gearSelectedText.textContent = n + ' item' + (n === 1 ? '' : 's') + ' selected';
  } else {
    gearCountEl.classList.add('hidden');
    gearSelectedText.textContent = 'No items selected';
  }
}

function getSelectedItems() {
  return Array.from(gearList.querySelectorAll('input[type=checkbox]:checked')).map((c) => c.value);
}

function getTitleItems() {
  return Array.from(gearList.querySelectorAll('.gear-row')).reduce((acc, row) => {
    const cb = row.querySelector('input[type=checkbox]');
    const star = row.querySelector('.gear-title-star');
    if (cb && cb.checked && star && star.classList.contains('active')) acc.push(cb.value);
    return acc;
  }, []);
}

function openGearDrawer() {
  gearDrawer.classList.add('open');
  gearDrawer.setAttribute('aria-hidden', 'false');
  gearBackdrop.classList.add('visible');
}

function closeGearDrawer() {
  gearDrawer.classList.remove('open');
  gearDrawer.setAttribute('aria-hidden', 'true');
  gearBackdrop.classList.remove('visible');
}

gearToggle.addEventListener('click', () => {
  if (gearDrawer.classList.contains('open')) closeGearDrawer();
  else openGearDrawer();
});
gearClose.addEventListener('click', closeGearDrawer);
gearBackdrop.addEventListener('click', closeGearDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && gearDrawer.classList.contains('open')) closeGearDrawer();
});

gearClearAll.addEventListener('click', () => {
  gearList.querySelectorAll('input[type=checkbox]:checked').forEach((c) => { c.checked = false; });
  gearList.querySelectorAll('.gear-title-star.active').forEach((s) => {
    s.classList.remove('active');
    s.setAttribute('aria-pressed', 'false');
  });
  updateGearCount();
});

gearSearch.addEventListener('input', () => {
  const q = gearSearch.value.trim().toLowerCase();
  gearList.querySelectorAll('.gear-row').forEach((row) => {
    const label = row.querySelector('.gear-checkbox');
    const text = label ? label.textContent.toLowerCase() : '';
    row.style.display = !q || text.includes(q) ? '' : 'none';
  });
  gearList.querySelectorAll('.gear-section').forEach((sec) => {
    const any = Array.from(sec.querySelectorAll('.gear-row')).some((r) => r.style.display !== 'none');
    sec.style.display = any ? '' : 'none';
  });
});

buildGearList();
const dropzone = document.getElementById('dropzone');
const browseBtn = document.getElementById('browseBtn');
const previewSection = document.getElementById('previewSection');
const previewGrid = document.getElementById('previewGrid');
const imageCount = document.getElementById('imageCount');
const generateBtn = document.getElementById('generateBtn');
const clearBtn = document.getElementById('clearBtn');
const cardBtn = document.getElementById('cardBtn');
const statusBox = document.getElementById('statusBox');
const resultsSection = document.getElementById('resultsSection');
const metaRow = document.getElementById('metaRow');
const notesBox = document.getElementById('notesBox');
const auditPanel = document.getElementById('auditPanel');
const auditBody = document.getElementById('auditBody');

const titleEmojiToggle = document.getElementById('titleEmojiToggle');
const titleEmojiState = document.getElementById('titleEmojiState');
const descEmojiToggle = document.getElementById('descEmojiToggle');
const descEmojiState = document.getElementById('descEmojiState');
let titleEmojis = true;
let descEmojis = true;
titleEmojiToggle.addEventListener('click', () => {
  titleEmojis = !titleEmojis;
  titleEmojiToggle.classList.toggle('active', titleEmojis);
  titleEmojiToggle.setAttribute('aria-pressed', titleEmojis ? 'true' : 'false');
  titleEmojiState.textContent = titleEmojis ? 'On' : 'Off';
});
descEmojiToggle.addEventListener('click', () => {
  descEmojis = !descEmojis;
  descEmojiToggle.classList.toggle('active', descEmojis);
  descEmojiToggle.setAttribute('aria-pressed', descEmojis ? 'true' : 'false');
  descEmojiState.textContent = descEmojis ? 'On' : 'Off';
});

let selectedFiles = [];

// Per-file redaction info: File -> { original: File, state: {grid, skills, boxes} }
// Only files that have been redacted have an entry. selectedFiles holds the
// redacted File (what gets uploaded); `original` is kept so the tool can be reopened.
const redactions = new Map();

let accountType = 'auto';
let loginMethod = 'jagex';
let banHistory = 'clean';

function wirePillGroup(groupEl, onChange) {
  groupEl.querySelectorAll('.pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      groupEl.querySelectorAll('.pill').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      onChange(btn.dataset.value);
    });
  });
}
wirePillGroup(document.getElementById('accountTypeGroup'), (v) => { accountType = v; });
wirePillGroup(document.getElementById('loginMethodGroup'), (v) => { loginMethod = v; });
wirePillGroup(document.getElementById('banHistoryGroup'), (v) => { banHistory = v; });

function getHiddenSkills() {
  const set = new Set();
  redactions.forEach((r) => r.state.skills.forEach((s) => set.add(s)));
  return Array.from(set);
}

function openRedactFor(idx) {
  const current = selectedFiles[idx];
  const existing = redactions.get(current);
  const original = existing ? existing.original : current;
  window.openRedactTool(original, existing ? existing.state : null, (newFile, newState) => {
    const isEmpty = newState.skills.length === 0 && newState.boxes.length === 0;
    redactions.delete(current);
    if (isEmpty) {
      selectedFiles[idx] = original;
    } else {
      selectedFiles[idx] = newFile;
      redactions.set(newFile, { original, state: newState });
    }
    refreshPreviews();
    // The card builder may be open underneath (redacting from the card): show the new version.
    if (window.cardFilesChanged) window.cardFilesChanged(selectedFiles.slice());
    if (window.refreshEldoradoCard) window.refreshEldoradoCard();
  });
}

// Redact a screenshot by file (used by the card builder's Redact buttons).
function redactFile(file) {
  const idx = selectedFiles.indexOf(file);
  if (idx >= 0) openRedactFor(idx);
}
window.redactFile = redactFile;

// Mark a screenshot that was redacted before it reached the app (nothing hidden by us), so it
// can go on the card. Redacting it here afterwards works as normal. Top-level, so also
// window.markRedacted for the Eldorado panel.
const PRE_REDACTED_NAME = /redact/i;
function markRedacted(file) {
  if (!selectedFiles.includes(file) || redactions.has(file)) return;
  redactions.set(file, { original: file, state: { grid: null, skills: [], boxes: [] }, preRedacted: true });
  refreshPreviews();
  if (window.cardFilesChanged) window.cardFilesChanged(selectedFiles.slice());
  if (window.refreshEldoradoCard) window.refreshEldoradoCard();
}

// Card builder right after an account folder loads: redact the skills and overview screenshots
// here, before Generate, so the model never sees hidden skills. Only redacted shots go on a card.
// From the queue, Done also starts this account generating and loads the next one.
function openCardForRedaction() {
  const more = jobs.some((j) => j.status === 'waiting');
  window.openCardTool({
    files: selectedFiles.slice(),
    isRedacted: (file) => redactions.has(file),
    title: '',
    loginMethod,
    onRedact: redactFile,
    onMarkRedacted: markRedacted,
    prep: true,
    doneLabel: currentJob ? (more ? 'Done, generate & next' : 'Done & generate') : 'Done',
    onDone: currentJob ? generateJobAndNext : null
  });
}

function refreshPreviews() {
  previewGrid.innerHTML = '';
  if (selectedFiles.length === 0) {
    previewSection.classList.add('hidden');
    generateBtn.disabled = true;
    cardBtn.disabled = true;
    return;
  }
  previewSection.classList.remove('hidden');
  generateBtn.disabled = false;
  cardBtn.disabled = false;
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
      redactions.delete(selectedFiles[idx]);
      selectedFiles.splice(idx, 1);
      refreshPreviews();
    });
    const redactBtn = document.createElement('button');
    redactBtn.className = 'preview-redact';
    redactBtn.type = 'button';
    redactBtn.textContent = redactions.has(file) ? 'Edit redaction' : 'Redact skills';
    redactBtn.title = 'Black out skills or areas on this screenshot';
    redactBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRedactFor(idx);
    });
    wrap.appendChild(img);
    if (redactions.has(file)) {
      const badge = document.createElement('span');
      badge.className = 'preview-badge';
      badge.textContent = redactions.get(file).preRedacted ? 'Already redacted' : 'Redacted';
      wrap.appendChild(badge);
    }
    wrap.appendChild(removeBtn);
    wrap.appendChild(redactBtn);
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

cardBtn.addEventListener('click', () => {
  if (selectedFiles.length === 0) return;
  const titleEl = document.querySelector('.version-card .output-title');
  window.openCardTool({
    files: selectedFiles.slice(),
    isRedacted: (file) => redactions.has(file),
    title: resultsSection.classList.contains('hidden') ? '' : (titleEl && titleEl.textContent) || '',
    loginMethod,
    onRedact: redactFile,
    onMarkRedacted: markRedacted
  });
});

// Clear empties the page; a queued account on it goes back to Waiting (redactions dropped).
clearBtn.addEventListener('click', () => {
  leaveCurrentJob(false);
  clearWorkspace();
  renderQueue();
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
    const desc = card.querySelector('.output-desc');
    if (desc) desc.value = '';
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

let lastResult = null;

function renderResults(data) {
  clearCards();
  lastResult = data;

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
    card.querySelector('.output-desc').value = listing.description || '';
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
  renderResultImages();

  resultsSection.classList.remove('hidden');
  if (window.fillEldoradoPanel) window.fillEldoradoPanel();
}

function renderResultImages() {
  const section = document.getElementById('resultImages');
  const grid = document.getElementById('resultImageGrid');
  grid.innerHTML = '';
  if (selectedFiles.length === 0) {
    section.classList.add('hidden');
    return;
  }
  selectedFiles.forEach((file, idx) => {
    const card = document.createElement('div');
    card.className = 'result-image';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    img.alt = 'Screenshot ' + (idx + 1);
    const row = document.createElement('div');
    row.className = 'result-image-row';
    const label = document.createElement('span');
    const red = redactions.get(file);
    label.textContent = red
      ? 'Redacted' + (red.state.skills.length ? ': ' + red.state.skills.join(', ') : '')
      : 'Original';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'copy-btn';
    save.textContent = 'Save image';
    save.addEventListener('click', () => {
      window.saveImageFile(file, file.name || ('screenshot-' + (idx + 1) + '.png'));
    });
    row.appendChild(label);
    row.appendChild(save);
    card.appendChild(img);
    card.appendChild(row);
    grid.appendChild(card);
  });
  section.classList.remove('hidden');
}

function makeBadge(text) {
  const b = document.createElement('span');
  b.className = 'badge';
  b.textContent = text;
  return b;
}

// Everything Generate sends, captured from the page right now. Queued accounts keep their own
// copy, so changing pills, gear or emojis for the next account doesn't touch one already running.
function snapshotWorkspace() {
  return {
    files: selectedFiles.slice(),
    redactions: new Map(redactions),
    username: usernameInput.value.trim(),
    accountType,
    loginMethod,
    banHistory,
    titleEmojis,
    descEmojis,
    selectedItems: getSelectedItems(),
    titleItems: getTitleItems()
  };
}

function generateForm(snap) {
  const formData = new FormData();
  snap.files.forEach((f) => formData.append('images', f));
  if (snap.username) formData.append('username', snap.username);
  if (snap.selectedItems.length > 0) formData.append('selectedItems', JSON.stringify(snap.selectedItems));
  if (snap.titleItems.length > 0) formData.append('titleItems', JSON.stringify(snap.titleItems));
  formData.append('titleEmojis', snap.titleEmojis ? 'true' : 'false');
  formData.append('descEmojis', snap.descEmojis ? 'true' : 'false');
  formData.append('accountType', snap.accountType);
  formData.append('loginMethod', snap.loginMethod);
  formData.append('cleanAccount', snap.banHistory === 'clean' ? 'true' : 'false');
  const hidden = new Set();
  snap.redactions.forEach((r) => r.state.skills.forEach((sk) => hidden.add(sk)));
  if (hidden.size > 0) formData.append('hiddenSkills', JSON.stringify(Array.from(hidden)));
  return formData;
}

// POST /generate; resolves to the listing data or throws with the server's message.
async function requestListing(snap) {
  let res;
  try {
    res = await fetch('/generate', { method: 'POST', body: generateForm(snap) });
  } catch (err) {
    throw new Error('Network error: ' + err.message);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Request failed with status ' + res.status));
  return data;
}

generateBtn.addEventListener('click', async () => {
  if (selectedFiles.length === 0) {
    showStatus('error', 'Upload at least one screenshot first.');
    return;
  }
  // An account from the queue: generate in the background and move on to the next one.
  if (currentJob) {
    generateJobAndNext();
    return;
  }

  generateBtn.disabled = true;
  resultsSection.classList.add('hidden');
  showStatus('loading', 'Analyzing screenshots and generating listings...');
  try {
    const data = await requestListing(snapshotWorkspace());
    hideStatus();
    renderResults(data);
  } catch (err) {
    showStatus('error', err.message);
  } finally {
    generateBtn.disabled = false;
  }
});

document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const card = btn.closest('.version-card');
    const which = btn.getAttribute('data-copy');
    const target = card.querySelector(which === 'title' ? '.output-title' : '.output-desc');
    const text = (which === 'desc' ? target.value : target.textContent) || '';
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


// ---------- Buyer handover message ----------
// Sent to the buyer after the sale. RSN follows the account name box until the
// user edits the message by hand; Reset template restores it.
const HANDOVER_TEMPLATE = `RSN: {rsn}
2FA Secret Key: 


2FA Secret Key Generator:
https://totp.danhersam.com/

Please send a message confirming you have logged into the account so I can remove the account details from my panel. If you have any other questions or concerns feel free to reach out. Thank you!`;

const handoverText = document.getElementById('handoverText');
const handoverCopy = document.getElementById('handoverCopy');
const handoverReset = document.getElementById('handoverReset');
let handoverEdited = false;

function fillHandover() {
  handoverText.value = HANDOVER_TEMPLATE.replace('{rsn}', usernameInput.value.trim());
}
fillHandover();
usernameInput.addEventListener('input', () => { if (!handoverEdited) fillHandover(); });
handoverText.addEventListener('input', () => { handoverEdited = true; });
handoverReset.addEventListener('click', () => { handoverEdited = false; fillHandover(); });
handoverCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(handoverText.value);
    handoverCopy.textContent = 'Copied!';
    handoverCopy.classList.add('copied');
    setTimeout(() => {
      handoverCopy.textContent = 'Copy message';
      handoverCopy.classList.remove('copied');
    }, 1200);
  } catch (e) {
    alert('Copy failed: ' + e.message);
  }
});

// ---------- Account folders + queue (ACCOUNTS_DIR) ----------
// Tick account folders and Start: they go into a queue and load one at a time. Each account opens
// with its screenshots, the RSN and type/ban from the folder name ("Zezima - hc - temp") and the
// card builder for redacting. "Done, generate & next" (or Generate) starts that account's listing in
// the background from a snapshot of the page and loads the next account straight away. Ready
// accounts open from the queue bar with their results and publish panel (edits kept per account);
// publishing moves the folder to Listed on the server.
const folderRow = document.getElementById('folderRow');
const folderSummary = document.getElementById('folderSummary');
const folderMenu = document.getElementById('folderMenu');
const folderListEl = document.getElementById('folderList');
const folderAll = document.getElementById('folderAll');
const folderSearch = document.getElementById('folderSearch');
const folderStart = document.getElementById('folderStart');
const folderHint = document.getElementById('folderHint');
const folderReload = document.getElementById('folderReload');
const queueBar = document.getElementById('queueBar');
const queueText = document.getElementById('queueText');
const queueProgress = document.getElementById('queueProgress');
const queueChips = document.getElementById('queueChips');
const queueNext = document.getElementById('queueNext');
const queueTidy = document.getElementById('queueTidy');

let currentFolder = null; // folder name of the account on the page (publish moves it)
let currentJob = null;    // queue entry on the page
let folderList = [];
const jobs = [];          // { folder, status, snap, result, error, panelState }
const STATUS_LABELS = {
  waiting: 'Waiting', redacting: 'Redacting', generating: 'Generating...',
  ready: 'Ready', error: 'Error', published: 'Published'
};
const DEFAULT_HINT = 'Tick the accounts to list and press Start. Each loads with its screenshots, name, type and login file.';

function setPill(groupId, value) {
  const btn = document.querySelector(`#${groupId} .pill[data-value="${value}"]`);
  if (btn) btn.click();
}

const queuedFolder = (name) => jobs.some((j) => j.folder.name === name && j.status !== 'published');

async function loadFolders() {
  try {
    const data = await fetch('/folders').then((r) => r.json());
    if (!data.configured) return;
    folderRow.classList.remove('hidden');
    folderList = data.folders || [];
    renderFolderList();
    if (data.error) folderHint.textContent = data.error;
    else if (!jobs.length) folderHint.textContent = DEFAULT_HINT;
  } catch (e) {
    folderHint.textContent = 'Could not load the account folders.';
  }
}

function renderFolderList() {
  const ticked = new Set(checkedFolders());
  folderListEl.innerHTML = '';
  if (!folderList.length) {
    folderListEl.textContent = 'No account folders left to list.';
  }
  folderList.forEach((f) => {
    const label = document.createElement('label');
    label.className = 'folder-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = f.name;
    const queued = queuedFolder(f.name);
    cb.disabled = queued;
    cb.checked = !queued && ticked.has(f.name);
    const text = document.createElement('span');
    text.textContent = `${f.name}  (${f.images} img${f.hasLogin ? '' : ', no login file'}${queued ? ', in queue' : ''})`;
    label.append(cb, text);
    folderListEl.appendChild(label);
  });
  filterFolders();
  updateFolderSummary();
}

// Search box: show only folders whose name contains the text (ticks are kept while hidden).
function filterFolders() {
  const q = folderSearch.value.trim().toLowerCase();
  folderListEl.querySelectorAll('.folder-option').forEach((label) => {
    const name = label.querySelector('input').value.toLowerCase();
    label.classList.toggle('hidden', Boolean(q) && !name.includes(q));
  });
}

function checkedFolders() {
  return Array.from(folderListEl.querySelectorAll('input:checked')).map((cb) => cb.value);
}

function updateFolderSummary() {
  const n = checkedFolders().length;
  folderSummary.textContent = n ? `${n} account${n === 1 ? '' : 's'} ticked` : 'Pick accounts...';
  folderStart.textContent = n ? `Start (${n})` : 'Start';
  folderStart.disabled = !n;
}

folderListEl.addEventListener('change', updateFolderSummary);
folderSearch.addEventListener('input', filterFolders);
// Opening the menu puts the cursor in the search box.
folderMenu.addEventListener('toggle', () => { if (folderMenu.open) folderSearch.focus(); });
folderAll.addEventListener('click', () => {
  const boxes = Array.from(folderListEl.querySelectorAll('.folder-option:not(.hidden) input:not(:disabled)'));
  const allOn = boxes.length && boxes.every((cb) => cb.checked);
  boxes.forEach((cb) => { cb.checked = !allOn; });
  updateFolderSummary();
});
folderStart.addEventListener('click', () => {
  const names = checkedFolders();
  names.forEach((name) => {
    const folder = folderList.find((f) => f.name === name);
    if (folder && !queuedFolder(name)) jobs.push({ folder, status: 'waiting', snap: null, result: null, error: null, panelState: null });
  });
  folderMenu.open = false;
  folderSearch.value = '';
  renderFolderList();
  renderQueue();
  // Nothing on the page yet: start on the first account.
  if (!currentJob && selectedFiles.length === 0 && resultsSection.classList.contains('hidden')) loadNextJob();
});
folderReload.addEventListener('click', loadFolders);

// Put a snapshot back on the page (screenshots, redactions, name, pills, emojis).
function restoreWorkspace(snap) {
  selectedFiles = snap.files.slice();
  redactions.clear();
  snap.redactions.forEach((v, k) => redactions.set(k, v));
  refreshPreviews();
  usernameInput.value = snap.username;
  usernameInput.dispatchEvent(new Event('input'));
  setPill('accountTypeGroup', snap.accountType);
  setPill('loginMethodGroup', snap.loginMethod);
  setPill('banHistoryGroup', snap.banHistory);
  if (titleEmojis !== snap.titleEmojis) titleEmojiToggle.click();
  if (descEmojis !== snap.descEmojis) descEmojiToggle.click();
}

// Empty the page (the queue itself is untouched).
function clearWorkspace() {
  if (window.resetEldoradoPanel) window.resetEldoradoPanel();
  selectedFiles = [];
  redactions.clear();
  refreshPreviews();
  resultsSection.classList.add('hidden');
  statusBox.classList.add('hidden');
  statusBox.innerHTML = '';
  clearCards();
}

// Take the current account off the page. keep=true remembers half-done redactions and panel edits.
function leaveCurrentJob(keep) {
  const job = currentJob;
  currentJob = null;
  currentFolder = null;
  if (!job) return;
  if (job.status === 'redacting') {
    job.snap = keep ? snapshotWorkspace() : null;
    job.status = 'waiting';
  } else if (job.status === 'ready' && keep && window.getEldoradoPanelState && !resultsSection.classList.contains('hidden')) {
    job.panelState = window.getEldoradoPanelState();
  }
}

async function fetchFolderFiles(name) {
  const base = '/folders/' + encodeURIComponent(name) + '/images';
  const { images, error } = await fetch(base).then((r) => r.json());
  if (error) throw new Error(error);
  return Promise.all(images.map(async (file) => {
    const blob = await fetch(base + '/' + encodeURIComponent(file)).then((r) => r.blob());
    return new File([blob], file, { type: blob.type });
  }));
}

function folderSummaryText(folder, count) {
  const typeText = folder.type === 'auto' ? 'type: Auto' : 'type: ' + folder.type.toUpperCase();
  return `${folder.rsn}: ${count} screenshot${count === 1 ? '' : 's'}, ${typeText}${folder.tempBan ? ', had a temp ban' : ''}${folder.hasLogin ? ', login file found' : ', no login file'}.`;
}

async function loadJob(job) {
  if (job === currentJob) return;
  leaveCurrentJob(true);
  clearWorkspace();
  currentJob = job;
  currentFolder = job.folder.name;
  const folder = job.folder;

  if (job.status === 'ready') {
    restoreWorkspace(job.snap);
    renderQueue();
    renderResults(job.result);
    if (job.panelState && window.setEldoradoPanelState) window.setEldoradoPanelState(job.panelState);
    folderHint.textContent = `${folder.rsn}: ready. Check the listing below and create the offer.`;
    return;
  }

  // Waiting, or an error being retried: redact (again) and generate.
  const retry = job.status === 'error';
  job.status = 'redacting';
  renderQueue();
  if (job.snap) {
    restoreWorkspace(job.snap);
    folderHint.textContent = retry
      ? `${folder.rsn}: generating failed (${job.error}). Press Generate to try again.`
      : folderSummaryText(folder, job.snap.files.length);
    if (!retry) openCardForRedaction();
    return;
  }

  usernameInput.value = folder.rsn.slice(0, 12);
  usernameInput.dispatchEvent(new Event('input'));
  setPill('accountTypeGroup', folder.type);
  setPill('banHistoryGroup', folder.tempBan ? 'banned' : 'clean');
  folderHint.textContent = `${folder.rsn}: loading screenshots...`;
  try {
    const files = await fetchFolderFiles(folder.name);
    if (currentJob !== job) return; // moved on meanwhile
    addFiles(files);
    files.filter((f) => PRE_REDACTED_NAME.test(f.name)).forEach((f) => {
      redactions.set(f, { original: f, state: { grid: null, skills: [], boxes: [] }, preRedacted: true });
    });
    refreshPreviews();
    folderHint.textContent = folderSummaryText(folder, files.length);
    if (files.length) openCardForRedaction();
  } catch (e) {
    folderHint.textContent = `${folder.rsn}: could not load the screenshots: ${e.message}`;
  }
}

function loadNextJob() {
  const next = jobs.find((j) => j.status === 'waiting');
  if (next) {
    loadJob(next);
    return true;
  }
  return false;
}

// Start the account on the page generating in the background, then load the next one.
function generateJobAndNext() {
  const job = currentJob;
  if (!job) return;
  job.snap = snapshotWorkspace();
  job.status = 'generating';
  job.result = null;
  job.error = null;
  job.panelState = null;
  currentJob = null;
  currentFolder = null;
  runJob(job);
  clearWorkspace();
  if (!loadNextJob()) {
    folderHint.textContent = 'Every queued account is generating or done. Open one from the queue when it shows Ready.';
  }
  renderQueue();
}

async function runJob(job) {
  try {
    job.result = await requestListing(job.snap);
    job.status = 'ready';
  } catch (err) {
    job.error = err.message;
    job.status = 'error';
  }
  renderQueue();
}

function renderQueue() {
  queueBar.classList.toggle('hidden', jobs.length === 0);
  generateBtn.textContent = currentJob && currentJob.status === 'redacting'
    ? (jobs.some((j) => j.status === 'waiting') ? 'Generate & next' : 'Generate')
    : 'Generate Listings';
  if (!jobs.length) return;

  const count = (status) => jobs.filter((j) => j.status === status).length;
  const parts = [];
  [['generating', 'generating'], ['ready', 'ready'], ['published', 'published'], ['error', 'failed'], ['waiting', 'waiting']]
    .forEach(([status, word]) => { const n = count(status); if (n) parts.push(`${n} ${word}`); });
  const pos = currentJob ? jobs.indexOf(currentJob) + 1 : 0;
  queueText.textContent = (pos ? `Account ${pos} of ${jobs.length}` : `${jobs.length} account${jobs.length === 1 ? '' : 's'}`)
    + (parts.length ? '  ·  ' + parts.join('  ·  ') : '');

  queueProgress.innerHTML = '';
  queueChips.innerHTML = '';
  jobs.forEach((job, i) => {
    const seg = document.createElement('span');
    seg.className = `queue-seg ${job.status}${job === currentJob ? ' current' : ''}`;
    seg.title = `${i + 1}. ${job.folder.rsn}: ${STATUS_LABELS[job.status]}`;
    queueProgress.appendChild(seg);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `queue-chip ${job.status}${job === currentJob ? ' current' : ''}`;
    chip.textContent = `${i + 1}. ${job.folder.rsn} · ${STATUS_LABELS[job.status]}`;
    const openable = job !== currentJob && ['waiting', 'ready', 'error'].includes(job.status);
    chip.disabled = !openable;
    if (job.status === 'error') chip.title = job.error + ' (click to retry)';
    if (openable) chip.addEventListener('click', () => loadJob(job));
    queueChips.appendChild(chip);
  });

  const redacting = currentJob && currentJob.status === 'redacting';
  queueNext.classList.toggle('hidden', redacting || !jobs.some((j) => j.status === 'waiting'));
  queueTidy.classList.toggle('hidden', !jobs.some((j) => j.status === 'published'));
  renderFolderList();
}

queueNext.addEventListener('click', loadNextJob);
queueTidy.addEventListener('click', () => {
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].status === 'published') jobs.splice(i, 1);
  renderQueue();
});

loadFolders();

// Called by the Eldorado panel after a publish moved the folder to Listed.
window.folderPublished = function () {
  if (currentJob) {
    currentJob.status = 'published';
    currentJob.panelState = null;
  }
  currentJob = null;
  currentFolder = null;
  renderQueue();
  loadFolders();
  if (jobs.some((j) => j.status === 'ready' || j.status === 'waiting')) {
    folderHint.textContent = 'Published. Pick the next account in the queue.';
  }
};

// Put a 2FA secret key on the "2FA Secret Key:" line of a message (added at the end if missing).
window.withSecretKey = function (text, key) {
  const line = /^2FA Secret Key:.*$/m;
  return line.test(text) ? text.replace(line, '2FA Secret Key: ' + key) : text.replace(/\s*$/, '') + '\n2FA Secret Key: ' + key;
};

// Called by the Eldorado panel when an account is picked from the accounts file.
window.setHandoverKey = function (key) {
  handoverText.value = window.withSecretKey(handoverText.value, key);
};

// Snapshot of the current listing for the Eldorado publish dialog (eldorado.js).
window.getListingContext = function () {
  if (!lastResult) return null;
  const card = document.querySelector('.version-card[data-version="hype"]');
  return {
    result: lastResult,
    title: card ? card.querySelector('.output-title').textContent : '',
    description: card ? card.querySelector('.output-desc').value : '',
    accountType,
    loginMethod,
    handover: handoverText.value,
    files: selectedFiles.slice(),
    isRedacted: (file) => redactions.has(file),
    folder: currentFolder
  };
};
