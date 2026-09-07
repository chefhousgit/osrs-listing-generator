// Skill redaction tool. Exposes window.openRedactTool(file, state, onApply).
//
// state: { grid: {x,y,w,h} | null, skills: string[], boxes: [{x,y,w,h}] } in IMAGE pixel space.
// onApply(newFile, newState) is called when the user hits "Apply to upload".
//
// The OSRS skills tab is a fixed 3 x 8 grid, read row by row:
const SKILL_GRID = [
  ['Attack', 'Hitpoints', 'Mining'],
  ['Strength', 'Agility', 'Smithing'],
  ['Defence', 'Herblore', 'Fishing'],
  ['Ranged', 'Thieving', 'Cooking'],
  ['Prayer', 'Crafting', 'Firemaking'],
  ['Magic', 'Fletching', 'Woodcutting'],
  ['Runecraft', 'Slayer', 'Farming'],
  ['Construction', 'Hunter', 'Overall']
];
const GRID_COLS = 3;
const GRID_ROWS = SKILL_GRID.length;
const GRID_STORAGE_KEY = 'osrs-redact-grid-v1';

(function () {
  const modal = document.getElementById('redactModal');
  const closeBtn = document.getElementById('redactClose');
  const help = document.getElementById('redactHelp');
  const canvas = document.getElementById('redactCanvas');
  const ctx = canvas.getContext('2d');
  const modeBoxes = document.getElementById('modeBoxes');
  const modeCalibrate = document.getElementById('modeCalibrate');
  const skillToggleGrid = document.getElementById('skillToggleGrid');
  const undoBtn = document.getElementById('redactUndo');
  const resetBtn = document.getElementById('redactReset');
  const summary = document.getElementById('redactSummary');
  const saveBtn = document.getElementById('redactSave');
  const applyBtn = document.getElementById('redactApply');

  let image = null;          // HTMLImageElement of the ORIGINAL (unredacted) file
  let sourceFile = null;
  let state = null;
  let onApply = null;
  let mode = 'boxes';
  let drag = null;           // {x0,y0,x1,y1} in image px while dragging

  // ---------- grid memory ----------
  function loadSavedGrid(w, h) {
    try {
      const raw = localStorage.getItem(GRID_STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !saved.grid) return null;
      if (saved.imgW === w && saved.imgH === h) return saved.grid;
      // Different screenshot size: scale the remembered box proportionally.
      const sx = w / saved.imgW;
      const sy = h / saved.imgH;
      return { x: saved.grid.x * sx, y: saved.grid.y * sy, w: saved.grid.w * sx, h: saved.grid.h * sy };
    } catch (e) {
      return null;
    }
  }

  function saveGrid(grid, w, h) {
    try {
      localStorage.setItem(GRID_STORAGE_KEY, JSON.stringify({ grid, imgW: w, imgH: h }));
    } catch (e) { /* ignore */ }
  }

  // ---------- geometry ----------
  function cellRect(skill) {
    if (!state.grid) return null;
    for (let r = 0; r < GRID_ROWS; r++) {
      const c = SKILL_GRID[r].indexOf(skill);
      if (c !== -1) {
        const cw = state.grid.w / GRID_COLS;
        const ch = state.grid.h / GRID_ROWS;
        return { x: state.grid.x + c * cw, y: state.grid.y + r * ch, w: cw, h: ch };
      }
    }
    return null;
  }

  function normRect(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y)
    };
  }

  function canvasToImage(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const p = evt.touches ? evt.touches[0] : evt;
    return {
      x: Math.max(0, Math.min(canvas.width, (p.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (p.clientY - rect.top) * scaleY))
    };
  }

  // ---------- drawing ----------
  function drawRedactions(target, forExport) {
    target.fillStyle = '#000';
    state.skills.forEach((s) => {
      const r = cellRect(s);
      if (r) target.fillRect(r.x, r.y, r.w, r.h);
    });
    state.boxes.forEach((b) => target.fillRect(b.x, b.y, b.w, b.h));

    if (forExport) return;

    if (state.grid) {
      target.strokeStyle = 'rgba(228, 176, 74, 0.9)';
      target.lineWidth = Math.max(1, canvas.width / 600);
      target.strokeRect(state.grid.x, state.grid.y, state.grid.w, state.grid.h);
      target.strokeStyle = 'rgba(228, 176, 74, 0.35)';
      const cw = state.grid.w / GRID_COLS;
      const ch = state.grid.h / GRID_ROWS;
      for (let c = 1; c < GRID_COLS; c++) {
        target.beginPath();
        target.moveTo(state.grid.x + c * cw, state.grid.y);
        target.lineTo(state.grid.x + c * cw, state.grid.y + state.grid.h);
        target.stroke();
      }
      for (let r = 1; r < GRID_ROWS; r++) {
        target.beginPath();
        target.moveTo(state.grid.x, state.grid.y + r * ch);
        target.lineTo(state.grid.x + state.grid.w, state.grid.y + r * ch);
        target.stroke();
      }
    }

    if (drag) {
      const r = normRect({ x: drag.x0, y: drag.y0 }, { x: drag.x1, y: drag.y1 });
      if (mode === 'calibrate') {
        target.strokeStyle = '#e4b04a';
        target.lineWidth = Math.max(1, canvas.width / 400);
        target.strokeRect(r.x, r.y, r.w, r.h);
      } else {
        target.fillStyle = 'rgba(0,0,0,0.75)';
        target.fillRect(r.x, r.y, r.w, r.h);
      }
    }
  }

  function render() {
    if (!image) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    drawRedactions(ctx, false);
    updateSide();
  }

  function exportCanvas() {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext('2d');
    octx.drawImage(image, 0, 0);
    drawRedactions(octx, true);
    return out;
  }

  // ---------- side panel ----------
  function buildSkillToggles() {
    skillToggleGrid.innerHTML = '';
    SKILL_GRID.flat().forEach((skill) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'skill-toggle';
      btn.dataset.skill = skill;
      btn.textContent = skill === 'Overall' ? 'Total' : skill;
      btn.addEventListener('click', () => {
        if (!state.grid) return;
        const i = state.skills.indexOf(skill);
        if (i === -1) state.skills.push(skill); else state.skills.splice(i, 1);
        render();
      });
      skillToggleGrid.appendChild(btn);
    });
  }

  function updateSide() {
    const hasGrid = !!state.grid;
    skillToggleGrid.querySelectorAll('.skill-toggle').forEach((btn) => {
      btn.disabled = !hasGrid;
      btn.classList.toggle('on', state.skills.includes(btn.dataset.skill));
    });
    modeBoxes.classList.toggle('active', mode === 'boxes');
    modeCalibrate.classList.toggle('active', mode === 'calibrate');
    undoBtn.disabled = state.boxes.length === 0;

    if (mode === 'calibrate') {
      help.textContent = 'Drag one box from the top-left corner of the Attack cell to the bottom-right corner of the Total level cell. The grid is remembered for your next screenshot.';
    } else if (!hasGrid) {
      help.textContent = 'Drag anywhere on the image to draw a black box. To black out skills by name, click "Set skill grid" first.';
    } else {
      help.textContent = 'Click a skill on the right to black it out, or drag on the image to draw a box anywhere. Black boxes are what the model will see.';
    }

    const parts = [];
    if (state.skills.length) parts.push(state.skills.length + ' skill' + (state.skills.length === 1 ? '' : 's'));
    if (state.boxes.length) parts.push(state.boxes.length + ' custom box' + (state.boxes.length === 1 ? '' : 'es'));
    summary.textContent = parts.length ? 'Hidden: ' + parts.join(', ') : 'Nothing hidden';
  }

  // ---------- events ----------
  function onDown(evt) {
    if (!image) return;
    evt.preventDefault();
    const p = canvasToImage(evt);
    drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    render();
  }

  function onMove(evt) {
    if (!drag) return;
    evt.preventDefault();
    const p = canvasToImage(evt);
    drag.x1 = p.x;
    drag.y1 = p.y;
    render();
  }

  function onUp(evt) {
    if (!drag) return;
    evt.preventDefault();
    const r = normRect({ x: drag.x0, y: drag.y0 }, { x: drag.x1, y: drag.y1 });
    drag = null;
    if (r.w < 3 || r.h < 3) { render(); return; }
    if (mode === 'calibrate') {
      state.grid = r;
      saveGrid(r, canvas.width, canvas.height);
      mode = 'boxes';
    } else {
      state.boxes.push(r);
    }
    render();
  }

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onDown, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onUp, { passive: false });

  modeBoxes.addEventListener('click', () => { mode = 'boxes'; render(); });
  modeCalibrate.addEventListener('click', () => { mode = 'calibrate'; render(); });

  undoBtn.addEventListener('click', () => {
    state.boxes.pop();
    render();
  });

  resetBtn.addEventListener('click', () => {
    state.skills = [];
    state.boxes = [];
    render();
  });

  saveBtn.addEventListener('click', () => {
    const out = exportCanvas();
    const a = document.createElement('a');
    const base = (sourceFile && sourceFile.name ? sourceFile.name : 'screenshot').replace(/\.[^.]+$/, '');
    a.download = base + '-redacted.png';
    a.href = out.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  applyBtn.addEventListener('click', () => {
    const out = exportCanvas();
    const callback = onApply;
    const base = (sourceFile && sourceFile.name ? sourceFile.name : 'screenshot').replace(/\.[^.]+$/, '');
    const snapshot = {
      grid: state.grid ? { ...state.grid } : null,
      skills: [...state.skills],
      boxes: state.boxes.map((b) => ({ ...b }))
    };
    out.toBlob((blob) => {
      const newFile = new File([blob], base + '-redacted.png', { type: 'image/png' });
      close();
      if (callback) callback(newFile, snapshot);
    }, 'image/png');
  });

  function close() {
    modal.classList.add('hidden');
    image = null;
    sourceFile = null;
    onApply = null;
    drag = null;
  }

  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  buildSkillToggles();

  window.openRedactTool = function (file, existingState, applyCallback) {
    sourceFile = file;
    onApply = applyCallback;
    state = existingState
      ? { grid: existingState.grid ? { ...existingState.grid } : null, skills: [...existingState.skills], boxes: existingState.boxes.map((b) => ({ ...b })) }
      : { grid: null, skills: [], boxes: [] };
    mode = 'boxes';
    drag = null;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      image = img;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      if (!state.grid) state.grid = loadSavedGrid(img.naturalWidth, img.naturalHeight);
      if (!state.grid) mode = 'calibrate';
      modal.classList.remove('hidden');
      render();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert('Could not load that image.');
    };
    img.src = url;
  };
})();
