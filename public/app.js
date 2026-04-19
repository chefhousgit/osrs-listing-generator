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
    items: ['Barrows Gloves', 'Dragon Defender', 'Fighter Torso', 'Void Knight (full set)', 'Elite Void (full set)', 'Ardougne Cloak 4', 'Morytania Legs 4', 'Fremennik Sea Boots 4', 'Desert Amulet 4', 'Explorer\'s Ring 4', 'Karamja Gloves 4', 'Varrock Armour 4', 'Wilderness Sword 4', 'Falador Shield 4', 'Kandarin Headgear 4', 'Western Banner 4', 'Rada\'s Blessing 4']
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
      const label = document.createElement('label');
      label.className = 'gear-checkbox';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = item;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + item));
      sec.appendChild(label);
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
  updateGearCount();
});

gearSearch.addEventListener('input', () => {
  const q = gearSearch.value.trim().toLowerCase();
  gearList.querySelectorAll('.gear-checkbox').forEach((label) => {
    label.style.display = !q || label.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
  gearList.querySelectorAll('.gear-section').forEach((sec) => {
    const any = Array.from(sec.querySelectorAll('.gear-checkbox')).some((l) => l.style.display !== 'none');
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
  const selectedItems = getSelectedItems();
  if (selectedItems.length > 0) formData.append('selectedItems', JSON.stringify(selectedItems));

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
