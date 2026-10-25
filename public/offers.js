// Offers manager: your Eldorado account offers with price, pause / resume, edit text and delete,
// one at a time or in bulk. Talks only to the local server (/eldorado/offers*), which holds the
// API credentials. "Listed" days come from the 24/7 worker's records.

(function () {
  const $ = (id) => document.getElementById(id);
  const rowsEl = $('offerRows');
  const searchEl = $('offerSearch');
  const stateEl = $('offerState');
  const staleEl = $('offerStale');
  const expiringEl = $('offerExpiring');
  const sortEl = $('offerSort');
  const countEl = $('offerCount');
  const statusEl = $('offerStatus');
  const allEl = $('offerAll');
  const bulkBar = $('bulkBar');
  const bulkCount = $('bulkCount');
  const bulkMode = $('bulkMode');
  const bulkAmount = $('bulkAmount');
  const bulkApply = $('bulkApply');

  const STALE_DAYS = 14;
  const COLS = 9;
  // Auto-drop schedule (same as the Worker): from day 14, -5% every 7 days, floor 75%.
  const DROP = { start: 14, every: 7, pct: 0.05, floor: 0.75 };
  const MARKET_CONFIDENT = 10; // listings needed before the gap is highlighted
  let market = null;         // offer id -> market info (loaded after the table)
  let offers = [];
  let agesAvailable = false;
  const selected = new Set();
  let preview = new Map(); // offer id -> new price (bulk price preview)
  let editing = null;      // offer id with the text editor open
  let busy = false;

  // ---------- helpers ----------
  const money = (n) => (n == null ? '?' : '$' + Number(n).toFixed(2));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function status(kind, text) {
    statusEl.className = 'status-box ' + kind;
    statusEl.textContent = text;
    statusEl.classList.toggle('hidden', !text);
  }

  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  }

  const byId = (id) => offers.find((o) => o.id === id);

  // ---------- load / filter ----------
  // The list is the 24/7 checks' copy (hourly, plus your changes made here); Refresh (live) reads
  // Eldorado now, which costs requests against its rate limit.
  let source = null;

  async function load(live) {
    status('loading', live === true ? 'Reading your offers from Eldorado...' : 'Loading your offers...');
    try {
      const data = await call('GET', '/eldorado/offers' + (live === true ? '?live=1' : ''));
      offers = data.offers;
      source = data.source;
      agesAvailable = data.agesAvailable;
      staleEl.disabled = !agesAvailable;
      status('', '');
      render();
      loadMarket();
    } catch (err) {
      status('error', err.message);
    }
  }

  async function loadMarket() {
    market = null;
    try {
      market = (await call('GET', '/eldorado/market')).market;
    } catch (err) {
      market = { error: err.message };
    }
    render();
  }

  function visibleOffers() {
    const q = searchEl.value.trim().toLowerCase();
    const list = offers.filter((o) => (!q || o.title.toLowerCase().includes(q))
      && (!stateEl.value || o.state === stateEl.value)
      && (!staleEl.checked || (o.daysListed != null && o.daysListed >= STALE_DAYS))
      && (!expiringEl.checked || (o.expiresInDays != null && o.expiresInDays <= 3)));
    const days = (o) => (o.daysListed == null ? -1 : o.daysListed);
    const sorts = {
      'days-desc': (a, b) => days(b) - days(a),
      'days-asc': (a, b) => days(a) - days(b),
      'price-desc': (a, b) => (b.price || 0) - (a.price || 0),
      'price-asc': (a, b) => (a.price || 0) - (b.price || 0),
      title: (a, b) => a.title.localeCompare(b.title)
    };
    return list.sort(sorts[sortEl.value]);
  }

  // ---------- render ----------
  function render() {
    const list = visibleOffers();
    rowsEl.innerHTML = '';
    list.forEach((o) => {
      rowsEl.appendChild(offerRow(o));
      if (editing === o.id) rowsEl.appendChild(editorRow(o));
    });
    if (!list.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = COLS;
      td.className = 'offers-empty';
      td.textContent = offers.length ? 'No offers match.' : 'No account offers on Eldorado.';
      tr.appendChild(td);
      rowsEl.appendChild(tr);
    }
    const active = offers.filter((o) => o.state === 'Active').length;
    const mins = source && source.at ? Math.max(0, Math.round((Date.now() - Date.parse(source.at)) / 60000)) : null;
    const from = !source ? '' : source.from === 'worker'
      ? ` · from the 24/7 checks${mins != null ? `, ${mins < 1 ? 'just now' : mins + ' min ago'}` : ''}`
      : ' · read from Eldorado just now';
    countEl.textContent = `${list.length} shown · ${active} active · ${offers.length - active} paused${from}`;
    allEl.checked = list.length > 0 && list.every((o) => selected.has(o.id));
    renderBulk();
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(text, cls, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function offerRow(o) {
    const tr = el('tr', 'offer-row ' + (o.state || '').toLowerCase());
    tr.dataset.id = o.id;

    const tdCb = el('td');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(o.id);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(o.id); else selected.delete(o.id);
      preview.delete(o.id);
      render();
    });
    tdCb.appendChild(cb);

    const tdImg = el('td');
    if (o.image) {
      const img = el('img', 'offer-thumb');
      img.src = o.image;
      img.alt = '';
      img.loading = 'lazy';
      tdImg.appendChild(img);
    }

    const tdTitle = el('td', 'offer-title-cell');
    tdTitle.appendChild(el('div', 'offer-title', o.title));
    tdTitle.appendChild(el('div', 'offer-meta', [o.type, o.total ? o.total + ' total' : '', o.delivery].filter(Boolean).join(' · ')));

    const tdPrice = el('td', 'offer-price-cell');
    const priceInput = el('input', 'offer-price');
    priceInput.type = 'text';
    priceInput.inputMode = 'decimal';
    priceInput.value = o.price != null ? Number(o.price).toFixed(2) : '';
    const save = button('Save', 'secondary-btn small-btn hidden', () => savePrice(o, priceInput.value, save));
    priceInput.addEventListener('input', () => save.classList.toggle('hidden', priceInput.value.trim() === Number(o.price).toFixed(2)));
    priceInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    tdPrice.append('$', priceInput, save);
    if (preview.has(o.id)) tdPrice.appendChild(el('span', 'price-preview', '→ ' + money(preview.get(o.id))));

    const tdMarket = marketCell(o, priceInput, save);

    const tdState = el('td');
    tdState.appendChild(el('span', 'state-pill ' + (o.state || '').toLowerCase(), o.state));

    const days = o.daysListed;
    const tdDays = el('td', days != null && days >= STALE_DAYS ? 'offer-days stale' : 'offer-days',
      days == null ? '-' : days === 0 ? 'today' : days + (days === 1 ? ' day' : ' days'));
    if (o.expiresInDays != null) {
      const left = o.expiresInDays;
      tdDays.appendChild(el('div', 'offer-expiry' + (left <= 3 ? ' soon' : ''),
        left < 0 ? 'expired' : left === 0 ? 'expires today' : `expires in ${left}d`));
    }

    const tdDrop = dropCell(o);

    const tdActions = el('td', 'offer-actions');
    tdActions.appendChild(button(o.state === 'Paused' ? 'Resume' : 'Pause', 'secondary-btn small-btn', () => setState(o, o.state === 'Paused' ? 'resume' : 'pause')));
    tdActions.appendChild(button(editing === o.id ? 'Close' : 'Edit', 'secondary-btn small-btn', () => { editing = editing === o.id ? null : o.id; render(); }));
    tdActions.appendChild(confirmButton('Delete', 'Confirm delete', () => remove([o.id])));

    tr.append(tdCb, tdImg, tdTitle, tdPrice, tdMarket, tdState, tdDays, tdDrop, tdActions);
    return tr;
  }

  function marketCell(o, priceInput, save) {
    const td = el('td', 'offer-market');
    if (!market) return td.appendChild(el('span', 'offer-meta', 'loading...')), td;
    if (market.error) return td.appendChild(el('span', 'offer-meta', 'unavailable')), td;
    const m = market[o.id];
    if (!m || m.error) return td.appendChild(el('span', 'offer-meta', '-')), td;
    if (!m.count) return td.appendChild(el('span', 'offer-meta', 'no other listings')), td;
    td.title = `${m.count} other live listing${m.count === 1 ? '' : 's'} (${m.scope === 'close' ? 'same type, total and combat bracket' : 'same type and total bracket only'}). Middle half priced ${money(m.low)} to ${money(m.high)}.`;
    td.appendChild(el('div', 'market-median', 'median ' + money(m.median)));
    td.appendChild(el('div', 'offer-meta', `${m.count} listing${m.count === 1 ? '' : 's'} · ${money(m.low)}-${money(m.high)}${m.scope === 'broad' ? ' · broad' : ''}`));
    if (m.scope === 'close' && m.count >= MARKET_CONFIDENT && m.gapPct != null) {
      const cls = m.gapPct > 10 ? 'above' : m.gapPct < -10 ? 'below' : 'near';
      td.appendChild(el('span', 'market-gap ' + cls, (m.gapPct > 0 ? '+' : '') + m.gapPct + '% vs median'));
    } else {
      td.appendChild(el('span', 'market-gap few', m.scope === 'broad' ? 'rough: type + total only' : 'few listings'));
    }
    const use = button('Use median', 'link-btn market-use', () => {
      priceInput.value = Number(m.median).toFixed(2);
      priceInput.dispatchEvent(new Event('input'));
      priceInput.focus();
      save.classList.remove('hidden');
    });
    td.appendChild(use);
    return td;
  }

  function scheduled(base, days) {
    if (days == null || days < DROP.start) return null;
    const steps = 1 + Math.floor((days - DROP.start) / DROP.every);
    return Math.round(Math.max(base * Math.pow(1 - DROP.pct, steps), base * DROP.floor) * 100) / 100;
  }

  function dropCell(o) {
    const td = el('td', 'offer-drop');
    const label = el('label', 'card-check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(o.autodrop);
    cb.addEventListener('change', () => setAutoDrop(o, cb.checked, cb));
    label.append(cb, el('span', null, o.autodrop ? 'On' : 'Off'));
    td.appendChild(label);
    if (o.autodrop) {
      const base = o.autodrop.base;
      const floor = Math.round(base * DROP.floor * 100) / 100;
      const days = o.daysListed;
      let next;
      if (o.price <= floor + 0.004) next = 'at floor ' + money(floor);
      else if (days == null || days < DROP.start) next = `first -5% at day ${DROP.start}`;
      else {
        const nextDay = DROP.start + (Math.floor((days - DROP.start) / DROP.every) + 1) * DROP.every;
        next = `next ${money(scheduled(base, nextDay))} at day ${nextDay}`;
      }
      td.appendChild(el('div', 'offer-meta', next));
      td.title = `Opted in at ${money(base)}. Floor ${money(floor)}.`;
    }
    return td;
  }

  async function setAutoDrop(o, enabled, cb) {
    cb.disabled = true;
    try {
      const out = await call('POST', `/eldorado/offers/${encodeURIComponent(o.id)}/autodrop`, { enabled, base: o.price });
      o.autodrop = out.autodrop;
      status('ok', enabled
        ? `Auto price drops on for "${o.title}": -5% at day ${DROP.start}, then every ${DROP.every} days, never below ${money(o.price * DROP.floor)}.`
        : `Auto price drops off for "${o.title}".`);
    } catch (err) {
      status('error', err.message);
    }
    render();
  }

  // Two-step button: first click arms it for 4 seconds, second click runs it.
  function confirmButton(label, armedLabel, action) {
    const b = button(label, 'secondary-btn small-btn danger-btn', () => {
      if (b.dataset.armed) {
        delete b.dataset.armed;
        action();
        return;
      }
      b.dataset.armed = '1';
      b.textContent = armedLabel;
      setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = label; } }, 4000);
    });
    return b;
  }

  function editorRow(o) {
    const tr = el('tr', 'offer-editor');
    const td = el('td');
    td.colSpan = COLS;
    const title = el('input', 'editor-title');
    title.type = 'text';
    title.value = o.title;
    const desc = el('textarea', 'editor-desc');
    desc.rows = 8;
    desc.value = o.description;
    const note = el('span', 'editor-note', 'Only the title and description change; images, fields, price and login details are sent back as they are and checked afterwards.');
    const actions = el('div', 'editor-actions');
    const saveBtn = button('Save text', 'primary-btn', () => saveText(o, title.value, desc.value, saveBtn));
    actions.append(saveBtn, button('Cancel', 'secondary-btn', () => { editing = null; render(); }), note);
    const l1 = el('label', 'card-field');
    l1.append(el('span', null, 'Title'), title);
    const l2 = el('label', 'card-field');
    l2.append(el('span', null, 'Description'), desc);
    td.append(l1, l2, actions);
    tr.appendChild(td);
    return tr;
  }

  // ---------- single-offer actions ----------
  async function savePrice(o, value, btn) {
    btn.disabled = true;
    try {
      const data = await call('POST', `/eldorado/offers/${encodeURIComponent(o.id)}/price`, { price: String(value).replace(',', '.') });
      o.price = data.price;
      status('ok', `Price of "${o.title}" set to ${money(o.price)}.`);
    } catch (err) {
      status('error', err.message);
    }
    render();
  }

  async function setState(o, action) {
    try {
      const data = await call('POST', `/eldorado/offers/${encodeURIComponent(o.id)}/${action}`);
      o.state = data.state;
      status('ok', `"${o.title}" ${action === 'pause' ? 'paused' : 'resumed'}.`);
    } catch (err) {
      status('error', err.message);
    }
    render();
  }

  async function saveText(o, title, description, btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const data = await call('POST', `/eldorado/offers/${encodeURIComponent(o.id)}/text`, { title, description });
      Object.assign(o, { title: data.offer.title, description: data.offer.description });
      editing = null;
      if (data.warnings && data.warnings.length) {
        status('error', `Saved, but check "${o.title}" on Eldorado: ${data.warnings.join('; ')}.`);
      } else {
        status('ok', `Title and description of "${o.title}" saved. Everything else checked unchanged.`);
      }
    } catch (err) {
      status('error', err.message);
    }
    render();
  }

  // ---------- bulk ----------
  function renderBulk() {
    // Selection only counts offers that still exist.
    Array.from(selected).forEach((id) => { if (!byId(id)) selected.delete(id); });
    bulkBar.classList.toggle('hidden', selected.size === 0);
    bulkCount.textContent = `${selected.size} selected`;
    bulkApply.disabled = busy || preview.size === 0;
  }

  // Runs one request per offer, a little apart (Eldorado rate-limits), with progress.
  async function runBulk(ids, label, fn) {
    busy = true;
    renderBulk();
    let done = 0;
    const failed = [];
    for (const id of ids) {
      const o = byId(id);
      status('loading', `${label}: ${done + 1} of ${ids.length}...`);
      try {
        await fn(o);
      } catch (err) {
        failed.push(`${o ? o.title : id}: ${err.message}`);
      }
      done++;
      await sleep(350);
    }
    busy = false;
    if (failed.length) status('error', `${label}: ${ids.length - failed.length} done, ${failed.length} failed. ${failed.join(' | ')}`);
    else status('ok', `${label}: all ${ids.length} done.`);
    render();
  }

  function newPrice(old) {
    const n = Number(String(bulkAmount.value).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return null;
    const p = { 'pct-down': old * (1 - n / 100), 'pct-up': old * (1 + n / 100), 'amt-down': old - n, 'amt-up': old + n, set: n }[bulkMode.value];
    return Math.round(p * 100) / 100;
  }

  $('bulkPreview').addEventListener('click', () => {
    preview = new Map();
    for (const id of selected) {
      const o = byId(id);
      const p = o && o.price != null ? newPrice(o.price) : null;
      if (p == null || p <= 0) {
        status('error', 'Enter an amount that keeps every price above $0.');
        preview = new Map();
        render();
        return;
      }
      preview.set(id, p);
    }
    status('', '');
    render();
  });
  [bulkMode, bulkAmount].forEach((e) => e.addEventListener('input', () => { preview = new Map(); render(); }));

  bulkApply.addEventListener('click', () => {
    const changes = new Map(preview);
    preview = new Map();
    runBulk(Array.from(changes.keys()), 'Changing prices', async (o) => {
      const data = await call('POST', `/eldorado/offers/${encodeURIComponent(o.id)}/price`, { price: changes.get(o.id) });
      o.price = data.price;
    });
  });

  $('bulkPause').addEventListener('click', () => runBulk(Array.from(selected).filter((id) => byId(id).state !== 'Paused'), 'Pausing', async (o) => {
    o.state = (await call('POST', `/eldorado/offers/${encodeURIComponent(o.id)}/pause`)).state;
  }));
  $('bulkResume').addEventListener('click', () => runBulk(Array.from(selected).filter((id) => byId(id).state === 'Paused'), 'Resuming', async (o) => {
    o.state = (await call('POST', `/eldorado/offers/${encodeURIComponent(o.id)}/resume`)).state;
  }));

  const bulkDeleteBtn = $('bulkDelete');
  bulkDeleteBtn.addEventListener('click', () => {
    if (!bulkDeleteBtn.dataset.armed) {
      bulkDeleteBtn.dataset.armed = '1';
      bulkDeleteBtn.textContent = `Confirm delete ${selected.size}`;
      setTimeout(() => { delete bulkDeleteBtn.dataset.armed; bulkDeleteBtn.textContent = 'Delete'; }, 4000);
      return;
    }
    delete bulkDeleteBtn.dataset.armed;
    bulkDeleteBtn.textContent = 'Delete';
    remove(Array.from(selected));
  });

  function remove(ids) {
    return runBulk(ids, ids.length === 1 ? 'Deleting' : 'Deleting offers', async (o) => {
      await call('DELETE', `/eldorado/offers/${encodeURIComponent(o.id)}`);
      offers = offers.filter((x) => x.id !== o.id);
      selected.delete(o.id);
    });
  }

  $('bulkClear').addEventListener('click', () => { selected.clear(); preview = new Map(); render(); });
  allEl.addEventListener('change', () => {
    visibleOffers().forEach((o) => { if (allEl.checked) selected.add(o.id); else selected.delete(o.id); });
    preview = new Map();
    render();
  });

  [searchEl, stateEl, staleEl, expiringEl, sortEl].forEach((e) => e.addEventListener('input', render));
  $('offerRefresh').addEventListener('click', () => load(true));

  load();
})();
