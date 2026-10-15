// Settings page: a setup check for this PC (Worker, Eldorado, Discord, folder sync, backup) and the
// account folder paths in .env (ACCOUNTS_DIR, LISTED_DIR, SOLD_DIR). Browse opens the Windows folder
// picker on this PC; Save writes .env and applies the paths right away.

(function () {
  const $ = (id) => document.getElementById(id);
  const fieldsEl = $('settingsFields');
  const saveBtn = $('settingsSave');
  const resetBtn = $('settingsReset');
  let data = null; // last answer from /settings
  const inputs = {};

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function status(kind, text) {
    const s = $('settingsStatus');
    s.className = 'status-box ' + kind;
    s.textContent = text;
    s.classList.toggle('hidden', !text);
  }

  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Request failed (' + res.status + ')');
    return out;
  }

  const changed = () => data.fields.filter((f) => inputs[f.key].value.trim() !== f.value);

  function refreshButtons() {
    const n = data ? changed().length : 0;
    saveBtn.disabled = n === 0;
    resetBtn.disabled = n === 0;
  }

  function where(f) {
    if (!f.effective) return { cls: 'missing', text: f.key === 'ACCOUNTS_DIR' ? 'Not set: account folders are off.' : 'Set the accounts folder first.' };
    const prefix = f.value ? '' : 'Default: ';
    if (f.exists) return { cls: 'ok', text: `${prefix}${f.effective} ✓` };
    return f.key === 'ACCOUNTS_DIR'
      ? { cls: 'missing', text: `${f.effective} doesn't exist on this PC.` }
      : { cls: 'pending', text: `${prefix}${f.effective} (made on the first move)` };
  }

  function render() {
    fieldsEl.innerHTML = '';
    data.fields.forEach((f) => {
      const row = el('div', 'settings-field');
      const label = el('label', 'settings-label', f.label);
      label.htmlFor = 'set-' + f.key;
      const line = el('div', 'settings-line');
      const input = el('input');
      input.type = 'text';
      input.id = 'set-' + f.key;
      input.spellcheck = false;
      input.placeholder = f.key === 'ACCOUNTS_DIR' ? 'C:\\Accounts' : 'Empty = default';
      input.value = f.value;
      input.addEventListener('input', refreshButtons);
      inputs[f.key] = input;
      line.appendChild(input);
      if (data.canBrowse) {
        const browse = el('button', 'secondary-btn small-btn', 'Browse…');
        browse.type = 'button';
        browse.addEventListener('click', () => pick(f, input, browse));
        line.appendChild(browse);
      }
      if (f.key !== 'ACCOUNTS_DIR') {
        const clear = el('button', 'secondary-btn small-btn', 'Use default');
        clear.type = 'button';
        clear.addEventListener('click', () => { input.value = ''; refreshButtons(); });
        line.appendChild(clear);
      }
      const state = where(f);
      row.append(label, line, el('div', 'settings-where ' + state.cls, state.text), el('div', 'offer-meta', f.hint + ` (${f.key})`));
      fieldsEl.appendChild(row);
    });
    refreshButtons();
  }

  async function pick(f, input, btn) {
    btn.disabled = true;
    status('loading', 'A folder picker opened on this PC. If you don\'t see it, check the taskbar.');
    try {
      const out = await call('POST', '/settings/pick', { key: f.key, start: input.value.trim() || f.effective });
      status('', '');
      if (out.path) {
        input.value = out.path;
        refreshButtons();
      }
    } catch (err) {
      status('error', err.message);
    }
    btn.disabled = false;
  }

  async function save(e) {
    e.preventDefault();
    const values = {};
    changed().forEach((f) => { values[f.key] = inputs[f.key].value.trim(); });
    saveBtn.disabled = true;
    try {
      data = await call('POST', '/settings', { values });
      render();
      status('ok', 'Saved. The app is using the new folders now.');
      loadHealth();
    } catch (err) {
      status('error', err.message);
      refreshButtons();
    }
  }

  // ---------- setup check ----------
  const ICONS = { ok: '✓', warn: '!', bad: '✕', off: '–' };

  async function loadHealth() {
    const box = $('healthRows');
    const btn = $('healthRefresh');
    btn.disabled = true;
    try {
      const h = await call('GET', '/settings/health');
      $('healthPc').textContent = '· ' + h.pc;
      box.innerHTML = '';
      h.rows.forEach((r) => {
        const line = el('div', 'health-row ' + r.status);
        const icon = el('span', 'health-icon', ICONS[r.status] || '?');
        icon.setAttribute('aria-label', r.status);
        const body = el('div', 'health-body');
        body.append(el('div', 'health-label', r.label), el('div', 'health-text', r.text));
        if (r.detail) body.appendChild(el('div', 'offer-meta', r.detail));
        line.append(icon, body);
        box.appendChild(line);
      });
    } catch (err) {
      box.innerHTML = '';
      box.appendChild(el('p', 'settings-where missing', err.message));
    }
    btn.disabled = false;
  }

  async function load() {
    try {
      data = await call('GET', '/settings');
      render();
    } catch (err) {
      status('error', err.message);
    }
  }

  $('settingsForm').addEventListener('submit', save);
  resetBtn.addEventListener('click', render);
  $('healthRefresh').addEventListener('click', loadHealth);
  load();
  loadHealth();
})();
