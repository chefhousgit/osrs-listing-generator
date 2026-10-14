// Reviews page: buyer feedback on your account sales (positive rate, tags, by account type) and
// every review, filterable. Data from /reviews (stats.js on the server). New reviews also reach
// Discord from the Worker.

(function () {
  const $ = (id) => document.getElementById(id);
  const money = (n) => (n == null ? '?' : '$' + Number(n).toFixed(2));
  const pct = (n) => (n == null ? '-' : Math.round(n) + '%');
  const prettyTag = (t) => ({ GGWP: 'GG WP', GOAT: 'GOAT', TOAD: 'TOAD' }[t] || t.replace(/([a-z])([A-Z])/g, '$1 $2'));
  let data = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function status(kind, text) {
    const s = $('reviewsStatus');
    s.className = 'status-box ' + kind;
    s.textContent = text;
    s.classList.toggle('hidden', !text);
  }

  function tile(label, value, sub) {
    const t = el('div', 'stat-tile');
    t.append(el('div', 'stat-label', label), el('div', 'stat-value', value));
    if (sub) t.appendChild(el('div', 'stat-sub', sub));
    return t;
  }

  function renderTiles(t) {
    const box = $('reviewTiles');
    box.innerHTML = '';
    box.append(
      tile('Positive', pct(t.positivePct), `${t.positive} of ${t.reviewed} reviews`),
      tile('Last 30 days', pct(t.last30.positivePct), `${t.last30.reviewed} review${t.last30.reviewed === 1 ? '' : 's'}`),
      tile('Negative', String(t.negative), t.negative ? 'filter below to see them' : 'none so far'),
      tile('Review rate', t.sales ? pct((t.reviewed / t.sales) * 100) : '-', `${t.reviewed} of ${t.sales} sales reviewed`)
    );
  }

  function table(id, head, rows, empty) {
    const tableEl = $(id);
    tableEl.innerHTML = '<thead><tr>' + head.map((h) => `<th>${h}</th>`).join('') + '</tr></thead>';
    const body = el('tbody');
    rows.forEach((cells) => {
      const tr = el('tr');
      cells.forEach((c) => tr.appendChild(c instanceof Node ? wrap(c) : el('td', null, c)));
      body.appendChild(tr);
    });
    if (!rows.length) {
      const tr = el('tr');
      const td = el('td', 'offers-empty', empty);
      td.colSpan = head.length;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    tableEl.appendChild(body);
  }
  const wrap = (node) => { const td = el('td'); td.appendChild(node); return td; };

  function ratingBadge(r) {
    return el('span', 'review-badge ' + (r.rating === 'Positive' ? 'positive' : 'negative'), r.rating === 'Positive' ? '👍 Positive' : '👎 Negative');
  }

  function renderRows() {
    const filter = $('reviewFilter').value;
    const shown = data.reviews.filter((r) => !filter
      || (filter === 'message' ? r.message : filter === 'changed' ? r.changed : r.rating === filter));
    $('reviewCount').textContent = `${shown.length} review${shown.length === 1 ? '' : 's'}`;
    const body = $('reviewRows');
    body.innerHTML = '';
    shown.forEach((r) => {
      const tr = el('tr', 'offer-row');
      const tdImg = el('td');
      if (r.image) {
        const img = el('img', 'offer-thumb');
        img.src = r.image;
        img.alt = '';
        img.loading = 'lazy';
        tdImg.appendChild(img);
      }
      const tdTitle = el('td', 'offer-title-cell');
      tdTitle.appendChild(el('div', 'offer-title', r.title || 'Account'));
      const date = r.createdDate ? new Date(r.createdDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      tdTitle.appendChild(el('div', 'offer-meta', [date, money(r.price), r.type].filter(Boolean).join(' · ')));
      const tdRating = el('td');
      tdRating.appendChild(ratingBadge(r));
      if (r.changed) tdRating.appendChild(el('div', 'offer-meta', 'rating changed'));
      const tdText = el('td', 'review-text');
      if (r.message) tdText.appendChild(el('div', null, '“' + r.message + '”' + (r.hidden ? ' (hidden on Eldorado)' : '')));
      if (r.tags.length) tdText.appendChild(el('div', 'offer-meta', r.tags.map(prettyTag).join(' · ')));
      if (!r.message && !r.tags.length) tdText.appendChild(el('span', 'offer-meta', 'No message'));
      tr.append(tdImg, tdTitle, tdRating, tdText);
      body.appendChild(tr);
    });
    if (!shown.length) {
      const tr = el('tr');
      const td = el('td', 'offers-empty', data.reviews.length ? 'No reviews match.' : 'No reviews yet.');
      td.colSpan = 4;
      tr.appendChild(td);
      body.appendChild(tr);
    }
  }

  async function load() {
    status('loading', 'Loading your reviews from Eldorado...');
    try {
      const res = await fetch('/reviews');
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
      status('', '');
      renderTiles(data.totals);
      table('tagTable', ['Tag', 'On positive', 'On negative'],
        data.tags.map((t) => [prettyTag(t.tag), String(t.positive), String(t.negative)]), 'No tags yet.');
      table('reviewTypeTable', ['Type', 'Sales', 'Positive', 'Negative'],
        data.byType.map((t) => [t.key, String(t.sales), String(t.positive), String(t.negative)]), 'No sales yet.');
      renderRows();
      $('reviewsFoot').textContent = 'Account sales only, canceled orders left out. Buyers can review days after the sale.'
        + (data.capped ? ' Based on your latest 500 orders.' : '');
    } catch (err) {
      status('error', err.message);
    }
  }

  $('reviewFilter').addEventListener('change', renderRows);
  load();
})();
