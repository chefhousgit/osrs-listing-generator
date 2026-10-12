// Publish to Eldorado panel, shown in the results and filled in every time a listing is generated
// (window.fillEldoradoPanel / window.resetEldoradoPanel, called from app.js). Talks only to the local
// server (/eldorado/*), which holds the API credentials. Delivery details typed here are sent once and
// wiped after a publish, a new generate, or Clear.

(function () {
  const panel = document.getElementById('eldoradoPanel');
  const versionsGrid = document.querySelector('.versions-grid');
  const form = document.getElementById('eldoradoForm');
  const submitBtn = document.getElementById('eldoradoSubmit');
  const noteEl = document.getElementById('eldoradoNote');
  const titleInput = document.getElementById('edTitle');
  const descInput = document.getElementById('edDescription');
  const priceInput = document.getElementById('edPrice');
  const deliverySelect = document.getElementById('edDelivery');
  const buildSelect = document.getElementById('edBuild');
  const attrsEl = document.getElementById('edAttributes');
  const numericEl = document.getElementById('edNumeric');
  const additionalInput = document.getElementById('edAdditional');
  const originalEmailInput = document.getElementById('edOriginalEmail');
  const imagePreview = document.getElementById('edImagePreview');
  const imageSourceEl = document.getElementById('edImageSource');
  const editCardBtn = document.getElementById('edEditCard');
  const pickFileBtn = document.getElementById('edPickFile');
  const autoCardBtn = document.getElementById('edAutoCard');
  const imageFileInput = document.getElementById('edImageFile');
  const accountPick = document.getElementById('edAccountPick');
  const accountHint = document.getElementById('edAccountHint');
  const accountReloadBtn = document.getElementById('edAccountReload');
  const accountFileBtn = document.getElementById('edAccountFileBtn');
  const accountFileInput = document.getElementById('edAccountFileInput');
  const secretInputs = ['edAccountLogin', 'edAccountPassword', 'edEmailLogin', 'edEmailPassword', 'edEmailProvider']
    .map((id) => document.getElementById(id));

  const DELIVERY_LABELS = {
    Instant: 'Instant (auto, needs login)', Minute20: '20 minutes', Hour1: '1 hour', Hour5: '5 hours', Hour12: '12 hours', Day1: '1 day'
  };
  // Lister account type -> Eldorado osrs-account-type value.
  const TYPE_MAP = { main: 'regular', ironman: 'ironman', hcim: 'hcim', uim: 'uim' };
  const LOGIN_MAP = { jagex: 'jagex-launcher', legacy: 'legacy-email-login' };

  let config = null;
  let ctx = null;       // listing snapshot taken when the dialog opens
  let mainImage = null; // { blob, source: 'auto' | 'edited' | 'file' }
  let previewUrl = null;
  let cardTimer = null;
  const SOURCE_LABELS = {
    auto: '(listing card, built from your screenshots)',
    edited: '(listing card, edited)',
    file: '(your file)'
  };
  const attrSelects = {}; // attribute id -> <select>

  function option(value, label) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  // Exact-number attribute -> the bracket select it drives.
  const NUMERIC_TO_SELECT = {
    'osrs-total-level-numeric': 'osrs-total-level',
    'osrs-combat-level-numeric': 'osrs-combat-level',
    'osrs-quest-points-numeric': 'osrs-quest-points',
    'osrs-pets-count-numeric': 'osrs-pets'
  };
  // Used when nothing in the listing says otherwise; shown in amber so they get checked.
  const FALLBACKS = { 'osrs-account-type': 'regular', 'osrs-quest-points': 'points-099', 'osrs-pets': 'pets-0' };

  const numInputs = {}; // numeric attribute id -> <input>

  function markSelect(select, state) {
    select.classList.toggle('needs-pick', !select.value);
    select.classList.toggle('guessed', Boolean(select.value) && state === 'guessed');
  }

  function field(labelText, control) {
    const label = document.createElement('label');
    label.className = 'card-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(span, control);
    return label;
  }

  function buildForm() {
    config.deliveryTimes.forEach((t) => deliverySelect.appendChild(option(t, DELIVERY_LABELS[t] || t)));
    config.osrs.tradeEnvironments.forEach((t) => buildSelect.appendChild(option(t.id, t.name)));
    config.osrs.attributes.forEach((attr) => {
      const select = document.createElement('select');
      select.appendChild(option('', 'Pick...'));
      attr.values.forEach((v) => select.appendChild(option(v.id, v.name)));
      select.addEventListener('change', () => markSelect(select, 'picked'));
      attrsEl.appendChild(field(attr.name, select));
      attrSelects[attr.id] = select;
    });
    config.osrs.numericAttributes.forEach((attr) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.placeholder = `${attr.min}-${attr.max}`;
      input.addEventListener('input', () => {
        const select = attrSelects[NUMERIC_TO_SELECT[attr.id]];
        const id = bracketFor(NUMERIC_TO_SELECT[attr.id], toNumber(input.value));
        if (select && id) {
          select.value = id;
          markSelect(select, 'picked');
        }
      });
      numericEl.appendChild(field('Exact ' + attr.name.toLowerCase(), input));
      numInputs[attr.id] = input;
    });
  }

  function toNumber(v) {
    const n = typeof v === 'number' ? v : parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  // Pick the option ("36-46", "300+", "2000-2376", "7") whose range contains n.
  function bracketFor(attrId, n) {
    if (n == null) return '';
    const attr = config.osrs.attributes.find((a) => a.id === attrId);
    const hit = attr && attr.values.find((v) => {
      const range = v.name.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) return n >= Number(range[1]) && n <= Number(range[2]);
      const plus = v.name.match(/^(\d+)\+$/);
      if (plus) return n >= Number(plus[1]);
      return /^\d+$/.test(v.name) && Number(v.name) === n;
    });
    return hit ? hit.id : '';
  }

  // Eldorado osrs-account-type value: forced pill, then a non-main hiscore board, then the model.
  function accountTypeValue(ctx) {
    if (TYPE_MAP[ctx.accountType]) return TYPE_MAP[ctx.accountType];
    const board = ctx.result.hiscoresUsed && ctx.result.hiscoresUsed.accountType;
    const BOARD_MAP = { ironman: 'ironman', hardcore: 'hcim', ultimate: 'uim' };
    if (BOARD_MAP[board]) return BOARD_MAP[board];
    const s = String(ctx.result.accountType || '').toLowerCase();
    if (/hardcore group|hcgim/.test(s)) return 'hcgim';
    if (/unranked group|ugim/.test(s)) return 'ugim';
    if (/group|gim/.test(s)) return 'gim';
    if (/ultimate|uim/.test(s)) return 'uim';
    if (/hardcore|hcim/.test(s)) return 'hcim';
    if (/iron/.test(s)) return 'ironman';
    if (/main|regular|normal/.test(s)) return 'regular';
    return '';
  }

  function computeCombat(levels) {
    const need = ['Attack', 'Strength', 'Defence', 'Hitpoints', 'Prayer', 'Ranged', 'Magic'];
    if (!need.every((k) => levels[k])) return null;
    const base = 0.25 * (levels.Defence + levels.Hitpoints + Math.floor(levels.Prayer / 2));
    const melee = 0.325 * (levels.Attack + levels.Strength);
    const range = 0.325 * (Math.floor(levels.Ranged / 2) + levels.Ranged);
    const mage = 0.325 * (Math.floor(levels.Magic / 2) + levels.Magic);
    return Math.floor(base + Math.max(melee, range, mage));
  }

  // Exact numbers from everything the listing knows: hiscores first (authoritative), then the
  // model's key stats, then per-screenshot reads, then skill levels seen on a stats screenshot.
  function stats(result) {
    const hs = result.hiscoresUsed || {};
    const overall = Array.isArray(hs.skills) ? hs.skills.find((s) => s.name === 'Overall') : null;
    const shots = (result.extractedData && result.extractedData.perScreenshot) || [];
    const key = result.keyStats || {};
    const first = (...vals) => vals.map(toNumber).find((n) => n != null) ?? null;
    const fromShots = (k) => first(...shots.map((s) => s[k]));

    const levels = {};
    shots.forEach((s) => (s.skillsVisible || []).forEach((sk) => {
      const n = toNumber(sk.level);
      if (sk.skill && n) levels[sk.skill] = n;
    }));

    return {
      total: first(overall && overall.level, key.totalLevel, fromShots('totalLevel')),
      combat: first(hs.combatLevel, key.combatLevel, fromShots('combatLevel'), computeCombat(levels)),
      questPoints: first(key.questPoints, fromShots('questPoints')),
      pets: first(key.petsCount)
    };
  }

  function prefill(ctx) {
    const s = stats(ctx.result);
    const exact = {
      'osrs-total-level-numeric': s.total,
      'osrs-combat-level-numeric': s.combat,
      'osrs-quest-points-numeric': s.questPoints,
      'osrs-pets-count-numeric': s.pets
    };
    Object.entries(numInputs).forEach(([id, input]) => { input.value = exact[id] != null ? String(exact[id]) : ''; });

    const values = {
      'osrs-account-type': accountTypeValue(ctx),
      'osrs-login-method': LOGIN_MAP[ctx.loginMethod] || '',
      'osrs-combat-level': bracketFor('osrs-combat-level', s.combat),
      'osrs-total-level': bracketFor('osrs-total-level', s.total),
      'osrs-quest-points': bracketFor('osrs-quest-points', s.questPoints),
      'osrs-pets': bracketFor('osrs-pets', s.pets)
    };
    Object.entries(attrSelects).forEach(([id, select]) => {
      const guessed = !values[id] && FALLBACKS[id];
      select.value = values[id] || FALLBACKS[id] || '';
      markSelect(select, guessed ? 'guessed' : 'picked');
    });

    titleInput.value = ctx.title.trim();
    descInput.value = ctx.description.trim();
    deliverySelect.value = 'Instant';
    buildSelect.value = '0';
    additionalInput.value = ctx.handover || '';
  }

  // ---------- main image ----------
  function setMainImage(blob, source) {
    mainImage = blob ? { blob, source } : null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = blob ? URL.createObjectURL(blob) : null;
    if (previewUrl) imagePreview.src = previewUrl; else imagePreview.removeAttribute('src');
    imagePreview.classList.toggle('hidden', !previewUrl);
    imageSourceEl.textContent = blob ? SOURCE_LABELS[source] : '(none yet)';
    autoCardBtn.classList.toggle('hidden', !blob || source === 'auto');
  }

  function cardOptions() {
    return {
      files: ctx.files,
      isRedacted: ctx.isRedacted,
      title: ctx.title,
      loginMethod: ctx.loginMethod,
      price: priceInput.value.trim()
    };
  }

  // Build the default card (price included) unless the user edited it or picked a file.
  async function refreshAutoCard() {
    if (!ctx || (mainImage && mainImage.source !== 'auto')) return;
    if (!ctx.files.length) {
      setMainImage(null);
      imageSourceEl.textContent = '(no screenshots uploaded: use a file)';
      return;
    }
    try {
      const blob = await window.buildListingCard(cardOptions());
      if (!mainImage || mainImage.source === 'auto') setMainImage(blob, 'auto');
    } catch (err) {
      imageSourceEl.textContent = '(could not build the card: ' + err.message + ')';
    }
  }

  function queueAutoCard() {
    clearTimeout(cardTimer);
    cardTimer = setTimeout(refreshAutoCard, 400);
  }

  priceInput.addEventListener('input', queueAutoCard);
  editCardBtn.addEventListener('click', () => {
    if (!ctx || !ctx.files.length) return;
    window.openCardTool(Object.assign(cardOptions(), { onUse: (blob) => setMainImage(blob, 'edited') }));
  });
  pickFileBtn.addEventListener('click', () => imageFileInput.click());
  imageFileInput.addEventListener('change', () => {
    const file = imageFileInput.files[0];
    if (file) setMainImage(file, 'file');
    imageFileInput.value = '';
  });
  autoCardBtn.addEventListener('click', () => {
    mainImage = null;
    refreshAutoCard();
  });

  function setNote(text, kind) {
    noteEl.textContent = text;
    noteEl.classList.toggle('eldorado-error', kind === 'error');
    noteEl.classList.toggle('eldorado-ok', kind === 'ok');
  }

  function fill() {
    if (!config) return;
    reset();
    ctx = window.getListingContext && window.getListingContext();
    if (!ctx) return;
    prefill(ctx);
    priceInput.value = '';
    setMainImage(null);
    refreshAutoCard();
    originalEmailInput.checked = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create offer (paused)';
    setNote('Red: still needs picking. Amber: best guess, check it.', null);
  }

  function reset() {
    // Wipe credentials so they don't sit in the page.
    secretInputs.forEach((el) => { el.value = ''; });
    additionalInput.value = '';
    clearTimeout(cardTimer);
    setMainImage(null);
    ctx = null;
    accountPick.value = '';
    // Don't carry the last account's key into the next listing's handover message.
    if (keyFilled && window.setHandoverKey) window.setHandoverKey('');
    keyFilled = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const missing = Object.entries(attrSelects).filter(([, sel]) => !sel.value);
    if (missing.length) {
      setNote('Pick a value for: ' + missing.map(([id]) => config.osrs.attributes.find((a) => a.id === id).name).join(', '), 'error');
      return;
    }
    if (!mainImage) {
      setNote('Eldorado needs a main image. Upload screenshots for the card, or use a file.', 'error');
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
      numeric: Object.fromEntries(Object.entries(numInputs).map(([id, input]) => [id, input.value.trim()])),
      hasOriginalEmail: originalEmailInput.checked,
      delivery: { accountLogin, accountPassword, emailLogin, emailPassword, emailProviderUrl, additionalInfo: additionalInput.value }
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
    setNote('Uploading the image and creating the offer...', null);
    const body = new FormData();
    body.append('payload', JSON.stringify(payload));
    body.append('mainImage', mainImage.blob, mainImage.source === 'file' && mainImage.blob.name ? mainImage.blob.name : 'listing-card.png');
    try {
      const res = await fetch('/eldorado/publish', { method: 'POST', body });
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
        setNote(`Created and paused (offer ${data.offerId}) with the listing card as its main image. Add more images on Eldorado if you like, then resume it there.${noDelivery}`, 'ok');
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

  // ---------- accounts file ----------
  // Source is ACCOUNTS_FILE on the server (list = emails only; one account fetched when picked),
  // or a file loaded in the browser with Load file..., kept in memory for this page only.
  let localAccounts = null; // [{ email, password, key }] from Load file...
  let keyFilled = false;    // the handover message got a key from here

  function parseAccountLine(line) {
    const text = line.trim();
    const first = text.indexOf(':');
    const last = text.lastIndexOf(':');
    if (first <= 0 || last <= first) return null;
    const email = text.slice(0, first).trim();
    const password = text.slice(first + 1, last);
    if (!email || !password) return null;
    return { email, password, key: text.slice(last + 1).trim() };
  }

  function listAccounts(emails, source) {
    accountPick.innerHTML = '';
    accountPick.appendChild(option('', emails.length ? 'Pick an account...' : 'No accounts found'));
    emails.forEach((email, id) => accountPick.appendChild(option(String(id), email)));
    accountHint.textContent = emails.length ? `(${emails.length} from ${source})` : '(email:password:key, one per line)';
  }

  async function loadServerAccounts() {
    localAccounts = null;
    try {
      const data = await fetch('/accounts').then((r) => r.json());
      if (!data.configured) {
        listAccounts([], '');
        accountHint.textContent = '(set ACCOUNTS_FILE in .env, or use Load file...)';
        accountReloadBtn.classList.add('hidden');
        return;
      }
      accountReloadBtn.classList.remove('hidden');
      if (data.error) {
        listAccounts([], '');
        accountHint.textContent = '(' + data.error + ')';
        return;
      }
      listAccounts(data.accounts.map((a) => a.email), 'ACCOUNTS_FILE');
    } catch (e) {
      accountHint.textContent = '(could not load the accounts list)';
    }
  }

  function applyAccount(acc) {
    const [loginInput, passwordInput] = secretInputs;
    loginInput.value = acc.email;
    passwordInput.value = acc.password;
    if (acc.key) {
      additionalInput.value = window.withSecretKey(additionalInput.value, acc.key);
      if (window.setHandoverKey) window.setHandoverKey(acc.key);
      keyFilled = true;
    }
  }

  accountPick.addEventListener('change', async () => {
    const id = accountPick.value;
    if (id === '') return;
    if (localAccounts) {
      applyAccount(localAccounts[Number(id)]);
      return;
    }
    const res = await fetch('/accounts/' + encodeURIComponent(id), { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(data.error || 'Could not read that account.', 'error');
      return;
    }
    applyAccount(data);
  });
  accountReloadBtn.addEventListener('click', loadServerAccounts);
  accountFileBtn.addEventListener('click', () => accountFileInput.click());
  accountFileInput.addEventListener('change', async () => {
    const file = accountFileInput.files[0];
    accountFileInput.value = '';
    if (!file) return;
    localAccounts = (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/).map(parseAccountLine).filter(Boolean);
    listAccounts(localAccounts.map((a) => a.email), file.name);
  });

  window.fillEldoradoPanel = fill;
  window.resetEldoradoPanel = reset;

  fetch('/eldorado/config')
    .then((r) => r.json())
    .then((cfg) => {
      if (!cfg.configured) return;
      config = cfg;
      buildForm();
      // The panel's title/description replace the plain listing card.
      panel.classList.remove('hidden');
      versionsGrid.classList.add('hidden');
      loadServerAccounts();
      if (window.getListingContext && window.getListingContext()) fill();
    })
    .catch(() => {});
})();
