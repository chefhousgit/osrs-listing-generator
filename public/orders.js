// Orders page: your Eldorado sales with the account folder each belongs to. Copy the buyer handover
// message (RSN + 2FA key from the folder's .txt), mark manual-delivery orders delivered, link
// older listed folders to their offer, and run the Listed -> Sold folder sync on demand
// (it also runs every hour while the app is open).

(function () {
  const $ = (id) => document.getElementById(id);
  const rowsEl = $('orderRows');
  const filterEl = $('orderFilter');
  const accountsEl = $('orderAccounts');
  const statusEl = $('orderStatus');
  const syncInfo = $('orderSyncInfo');

  const LINK_DAYS = 14; // older sales are long gone from Listed: no link picker for them
  const OPEN = ['Paid', 'Delivered', 'Received', 'PendingReview', 'Disputed', 'DeliveredDisputed'];
  let data = { orders: [], unlinked: [], lastSync: null };

  const money = (n) => (n == null ? '?' : '$' + Number(n).toFixed(2));

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
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Request failed (' + res.status + ')');
    return out;
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

  function showSync(sync) {
    if (!sync) {
      syncInfo.textContent = 'Folder sync runs every hour while the app is open.';
      return;
    }
    const when = new Date(sync.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    syncInfo.textContent = sync.error
      ? `Last folder sync ${when} failed: ${sync.error}`
      : `Last folder sync ${when}: ${sync.moves.length ? sync.moves.length + ' moved' : 'nothing to move'}`;
  }

  async function load() {
    status('loading', 'Loading your orders from Eldorado...');
    try {
      data = await call('GET', '/orders');
      status('', '');
      showSync(data.lastSync);
      render();
    } catch (err) {
      status('error', err.message);
    }
  }

  function visible() {
    return data.orders.filter((o) => (!accountsEl.checked || o.category === 'Account')
      && (filterEl.value === '' || (filterEl.value === 'open' ? OPEN.includes(o.state) : o.state === filterEl.value)));
  }

  function render() {
    const list = visible();
    rowsEl.innerHTML = '';
    list.forEach((o) => rowsEl.appendChild(orderRow(o)));
    if (!list.length) {
      const tr = el('tr');
      const td = el('td', 'offers-empty', data.orders.length ? 'No orders match.' : 'No sales yet.');
      td.colSpan = 6;
      tr.appendChild(td);
      rowsEl.appendChild(tr);
    }
  }

  function orderRow(o) {
    const tr = el('tr', 'offer-row');

    const tdImg = el('td');
    if (o.image) {
      const img = el('img', 'offer-thumb');
      img.src = o.image;
      img.alt = '';
      img.loading = 'lazy';
      tdImg.appendChild(img);
    }

    const tdTitle = el('td', 'offer-title-cell');
    tdTitle.appendChild(el('div', 'offer-title', o.title || 'Order'));
    const date = o.createdDate ? new Date(o.createdDate).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    tdTitle.appendChild(el('div', 'offer-meta', [date, o.delivery].filter(Boolean).join(' · ')));

    const tdPrice = el('td', 'offer-price-cell', money(o.price));
    const tdState = el('td');
    tdState.appendChild(el('span', 'state-pill ' + String(o.state || '').toLowerCase(), o.state));

    const tdFolder = el('td', 'order-folder');
    if (o.folder) {
      tdFolder.appendChild(el('span', 'folder-badge ' + o.folder.where, o.folder.where === 'sold' ? 'Sold' : 'Listed'));
      tdFolder.appendChild(el('span', 'folder-name', o.folder.name));
    } else if (o.category === 'Account' && o.state !== 'Canceled' && data.unlinked.length && Date.now() - Date.parse(o.createdDate) < LINK_DAYS * 86400000) {
      // Older listings (before folders recorded their offer): pick the folder once.
      const select = el('select', 'link-select');
      select.appendChild(new Option('Link a Listed folder...', ''));
      data.unlinked.forEach((name) => select.appendChild(new Option(name, name)));
      const linkBtn = button('Link', 'secondary-btn small-btn', () => linkFolder(o, select.value, linkBtn));
      tdFolder.append(select, linkBtn);
    } else {
      tdFolder.appendChild(el('span', 'offer-meta', o.category === 'Account' ? 'No folder' : '-'));
    }

    const tdActions = el('td', 'offer-actions');
    if (o.folder) {
      const copyBtn = button('Copy handover', 'secondary-btn small-btn', () => copyHandover(o, copyBtn));
      tdActions.appendChild(copyBtn);
    }
    if (o.state === 'Paid') {
      const deliverBtn = button('Mark delivered', 'primary-btn small-btn', () => markDelivered(o, deliverBtn));
      tdActions.appendChild(deliverBtn);
    }

    tr.append(tdImg, tdTitle, tdPrice, tdState, tdFolder, tdActions);
    return tr;
  }

  async function copyHandover(o, btn) {
    try {
      const h = await call('GET', `/orders/${encodeURIComponent(o.id)}/handover`);
      await navigator.clipboard.writeText(window.buildHandover(h.rsn, h.key));
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy handover'; btn.classList.remove('copied'); }, 1500);
      status(h.key ? 'ok' : 'error', h.key
        ? `Handover message for ${h.rsn} copied. Paste it in the buyer's chat on Eldorado.`
        : `Copied for ${h.rsn}, but its folder has no 2FA key in the .txt: add it before sending.`);
    } catch (err) {
      status('error', err.message);
    }
  }

  async function markDelivered(o, btn) {
    btn.disabled = true;
    try {
      const out = await call('POST', `/orders/${encodeURIComponent(o.id)}/deliver`);
      o.state = out.state;
      status('ok', `"${o.title}" marked delivered.`);
    } catch (err) {
      status('error', err.message);
    }
    render();
  }

  async function linkFolder(o, folder, btn) {
    if (!folder) {
      status('error', 'Pick the folder this order belongs to.');
      return;
    }
    btn.disabled = true;
    try {
      const sync = await call('POST', `/orders/${encodeURIComponent(o.id)}/link`, { folder });
      await load(); // (clears the status line, so the result goes after it)
      status('ok', `"${folder}" linked to "${o.title}".` + (sync.moves && sync.moves.length ? ` ${sync.moves.length} folder(s) moved.` : ''));
    } catch (err) {
      status('error', err.message);
      btn.disabled = false;
    }
  }

  $('orderSync').addEventListener('click', async () => {
    status('loading', 'Checking orders and moving sold accounts...');
    try {
      const sync = await call('POST', '/orders/sync');
      await load();
      status(sync.error ? 'error' : 'ok', sync.error
        ? 'Sync failed: ' + sync.error
        : sync.moves.length ? sync.moves.map((m) => `"${m.folder}" → ${m.to}`).join(', ') : 'Nothing to move: every sold account is already in Sold.');
    } catch (err) {
      status('error', err.message);
    }
  });
  $('orderRefresh').addEventListener('click', load);
  [filterEl, accountsEl].forEach((e) => e.addEventListener('input', render));

  load();
})();
