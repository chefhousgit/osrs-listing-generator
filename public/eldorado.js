// Publish to Eldorado dialog. Talks only to the local server (/eldorado/*), which holds the
// API credentials. Delivery details typed here are sent once and wiped when the dialog closes.

(function () {
  const btn = document.getElementById('eldoradoBtn');
  const modal = document.getElementById('eldoradoModal');
  const closeBtn = document.getElementById('eldoradoClose');
  const form = document.getElementById('eldoradoForm');
  const submitBtn = document.getElementById('eldoradoSubmit');
  const noteEl = document.getElementById('eldoradoNote');
  const titleInput = document.getElementById('edTitle');
  const descInput = document.getElementById('edDescription');
  const priceInput = document.getElementById('edPrice');
  const deliverySelect = document.getElementById('edDelivery');
  const buildSelect = document.getElementById('edBuild');
  const attrsEl = document.getElementById('edAttributes');
  const additionalInput = document.getElementById('edAdditional');
  const originalEmailInput = document.getElementById('edOriginalEmail');
  const secretInputs = ['edAccountLogin', 'edAccountPassword', 'edEmailLogin', 'edEmailPassword', 'edEmailProvider']
    .map((id) => document.getElementById(id));

  const DELIVERY_LABELS = {
    Instant: 'Instant', Minute20: '20 minutes', Hour1: '1 hour', Hour5: '5 hours', Hour12: '12 hours', Day1: '1 day'
  };
  // Lister account type -> Eldorado osrs-account-type value.
  const TYPE_MAP = { main: 'regular', ironman: 'ironman', hcim: 'hcim', uim: 'uim' };
  const LOGIN_MAP = { jagex: 'jagex-launcher', legacy: 'legacy-email-login' };

  let config = null;
  const attrSelects = {}; // attribute id -> <select>

  function option(value, label) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  function buildForm() {
    config.deliveryTimes.forEach((t) => deliverySelect.appendChild(option(t, DELIVERY_LABELS[t] || t)));
    config.osrs.tradeEnvironments.forEach((t) => buildSelect.appendChild(option(t.id, t.name)));
    config.osrs.attributes.forEach((attr) => {
      const label = document.createElement('label');
      label.className = 'card-field';
      const span = document.createElement('span');
      span.textContent = attr.name;
      const select = document.createElement('select');
      select.appendChild(option('', 'Pick...'));
      attr.values.forEach((v) => select.appendChild(option(v.id, v.name)));
      select.addEventListener('change', () => select.classList.toggle('needs-pick', !select.value));
      label.append(span, select);
      attrsEl.appendChild(label);
      attrSelects[attr.id] = select;
    });
  }

  // Pick the bracket ("36-46", "300+", "2000-2376") whose range contains n.
  function bracketFor(attrId, n) {
    if (n == null || !Number.isFinite(Number(n))) return '';
    const attr = config.osrs.attributes.find((a) => a.id === attrId);
    const hit = attr && attr.values.find((v) => {
      const range = v.name.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) return n >= Number(range[1]) && n <= Number(range[2]);
      const plus = v.name.match(/^(\d+)\+$/);
      return plus ? n >= Number(plus[1]) : false;
    });
    return hit ? hit.id : '';
  }

  function accountTypeKey(ctx) {
    if (TYPE_MAP[ctx.accountType]) return ctx.accountType;
    const s = String(ctx.result.accountType || '').toLowerCase();
    if (/ultimate|uim/.test(s)) return 'uim';
    if (/hardcore|hcim/.test(s)) return 'hcim';
    if (/iron/.test(s)) return 'ironman';
    if (/main|regular/.test(s)) return 'main';
    return '';
  }

  // Stats: hiscores first (authoritative), then what the model read off the screenshots.
  function stats(result) {
    const hs = result.hiscoresUsed;
    const overall = hs && Array.isArray(hs.skills) ? hs.skills.find((s) => s.name === 'Overall') : null;
    const shots = (result.extractedData && result.extractedData.perScreenshot) || [];
    const fromShots = (key) => shots.map((s) => s[key]).find((v) => typeof v === 'number');
    const key = result.keyStats || {};
    return {
      combat: (hs && hs.combatLevel) || key.combatLevel || fromShots('combatLevel'),
      total: (overall && overall.level) || key.totalLevel || fromShots('totalLevel'),
      questPoints: fromShots('questPoints')
    };
  }

  function prefill(ctx) {
    const s = stats(ctx.result);
    const values = {
      'osrs-account-type': TYPE_MAP[accountTypeKey(ctx)] || '',
      'osrs-login-method': LOGIN_MAP[ctx.loginMethod] || '',
      'osrs-combat-level': bracketFor('osrs-combat-level', s.combat),
      'osrs-total-level': bracketFor('osrs-total-level', s.total),
      'osrs-quest-points': bracketFor('osrs-quest-points', s.questPoints),
      'osrs-pets': ''
    };
    Object.entries(attrSelects).forEach(([id, select]) => {
      select.value = values[id] || '';
      select.classList.toggle('needs-pick', !select.value);
    });

    titleInput.value = ctx.title.trim();
    descInput.value = ctx.description.trim();
    deliverySelect.value = 'Instant';
    buildSelect.value = '0';
    additionalInput.value = ctx.handover || '';
  }

  function setNote(text, kind) {
    noteEl.textContent = text;
    noteEl.classList.toggle('eldorado-error', kind === 'error');
    noteEl.classList.toggle('eldorado-ok', kind === 'ok');
  }

  function open() {
    const ctx = window.getListingContext && window.getListingContext();
    if (!ctx) return;
    prefill(ctx);
    priceInput.value = '';
    originalEmailInput.checked = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create offer (paused)';
    setNote('Fields marked in red still need picking.', null);
    modal.classList.remove('hidden');
    priceInput.focus();
  }

  function close() {
    modal.classList.add('hidden');
    // Wipe credentials so they don't sit in the page.
    secretInputs.forEach((el) => { el.value = ''; });
    additionalInput.value = '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const missing = Object.entries(attrSelects).filter(([, sel]) => !sel.value);
    if (missing.length) {
      setNote('Pick a value for: ' + missing.map(([id]) => config.osrs.attributes.find((a) => a.id === id).name).join(', '), 'error');
      return;
    }

    const [accountLogin, accountPassword, emailLogin, emailPassword, emailProviderUrl] = secretInputs.map((el) => el.value);
    const payload = {
      title: titleInput.value,
      description: descInput.value,
      price: priceInput.value.replace(',', '.'),
      deliveryTime: deliverySelect.value,
      build: buildSelect.value,
      attributes: Object.fromEntries(Object.entries(attrSelects).map(([id, sel]) => [id, sel.value])),
      hasOriginalEmail: originalEmailInput.checked,
      delivery: { accountLogin, accountPassword, emailLogin, emailPassword, emailProviderUrl, additionalInfo: additionalInput.value }
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
    setNote('Sending to Eldorado...', null);
    try {
      const res = await fetch('/eldorado/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(data.error || ('Request failed with status ' + res.status), 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create offer (paused)';
        return;
      }
      secretInputs.forEach((el) => { el.value = ''; });
      if (data.paused) {
        const noDelivery = data.withDelivery ? '' : ' No delivery details were sent, so add them there too.';
        setNote(`Created and paused (offer ${data.offerId}). Add the images on Eldorado, then resume it there.${noDelivery}`, 'ok');
      } else {
        setNote(`Created (offer ${data.offerId}) but it could NOT be paused, so it is LIVE without images. Pause it on Eldorado now. ${data.pauseError || ''}`, 'error');
      }
      submitBtn.textContent = 'Done';
    } catch (err) {
      setNote('Network error: ' + err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create offer (paused)';
    }
  });

  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  fetch('/eldorado/config')
    .then((r) => r.json())
    .then((cfg) => {
      if (!cfg.configured) return;
      config = cfg;
      buildForm();
      btn.classList.remove('hidden');
    })
    .catch(() => {});
})();
