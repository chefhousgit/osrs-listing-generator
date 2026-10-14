// Stats page: headline numbers, revenue per week (one series, hover for details, table view),
// and breakdowns by account type and total level. Data from /stats (stats.js on the server).

(function () {
  const $ = (id) => document.getElementById(id);
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  const moneyShort = (n) => '$' + (Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const MIN_WEEKS = 6;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function status(kind, text) {
    const s = $('statsStatus');
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

  function renderTiles(d) {
    const t = d.totals;
    const box = $('statTiles');
    box.innerHTML = '';
    box.append(
      tile('Account sales', String(t.sales), t.firstSale ? 'since ' + new Date(t.firstSale).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''),
      tile('Revenue', money(t.revenue), `${money(t.avgPrice)} average`),
      tile('Last 7 days', money(t.last7.revenue), `${t.last7.count} sale${t.last7.count === 1 ? '' : 's'}`),
      tile('Last 30 days', money(t.last30.revenue), `${t.last30.count} sale${t.last30.count === 1 ? '' : 's'}`),
      tile('Days to sell', d.daysToSell ? `${d.daysToSell.median} days` : '-',
        d.daysToSell ? `median of ${d.daysToSell.count} (avg ${d.daysToSell.avg})` : 'builds up as listings sell')
    );
    if (t.smallItems && t.smallItems.count) {
      box.appendChild(tile(`Small items (< $${t.smallItems.under})`, money(t.smallItems.revenue), `${t.smallItems.count} sales, not counted above`));
    }
  }

  // ---------- weekly revenue chart ----------
  function renderWeeks(weeks) {
    // Start at the first week with a sale (but show at least MIN_WEEKS).
    const first = weeks.findIndex((w) => w.count > 0);
    const shown = weeks.slice(Math.max(0, Math.min(first < 0 ? weeks.length : first, weeks.length - MIN_WEEKS)));
    const chart = $('weekChart');
    chart.innerHTML = '';
    const W = 760, H = 240, padL = 48, padR = 8, padT = 12, padB = 28;
    const max = Math.max(...shown.map((w) => w.revenue), 1);
    const step = niceStep(max / 4);
    const top = Math.ceil(max / step) * step;
    const y = (v) => padT + (H - padT - padB) * (1 - v / top);
    const slot = (W - padL - padR) / shown.length;
    const barW = Math.max(6, Math.min(36, slot - 2 - slot * 0.35));

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'week-svg');
    const add = (tag, attrs, text) => {
      const n = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
      if (text != null) n.textContent = text;
      svg.appendChild(n);
      return n;
    };

    for (let v = 0; v <= top + 0.001; v += step) {
      add('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: v === 0 ? 'axis-line' : 'grid-line' });
      add('text', { x: padL - 8, y: y(v) + 4, class: 'axis-text', 'text-anchor': 'end' }, moneyShort(v));
    }

    const tip = $('weekTip');
    shown.forEach((w, i) => {
      const cx = padL + slot * i + slot / 2;
      const label = new Date(w.start).toLocaleDateString([], { month: 'short', day: 'numeric' });
      if (shown.length <= 12 || i % 2 === 0) add('text', { x: cx, y: H - 8, class: 'axis-text', 'text-anchor': 'middle' }, label);
      if (w.revenue > 0) {
        const top = y(w.revenue), base = y(0), r = Math.min(4, barW / 2);
        // Rounded data end (top), square at the baseline.
        add('path', {
          class: 'week-bar',
          d: `M${cx - barW / 2},${base} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${base} Z`
        });
      }
      // Hit target: the whole column, bigger than the bar.
      const hit = add('rect', { x: padL + slot * i, y: padT, width: slot, height: H - padT - padB, class: 'week-hit', tabindex: 0 });
      const show = () => {
        tip.innerHTML = '';
        tip.append(el('strong', null, 'Week of ' + label), el('div', null, money(w.revenue)), el('div', 'stat-sub', `${w.count} sale${w.count === 1 ? '' : 's'}`));
        tip.classList.remove('hidden');
        const box = chart.getBoundingClientRect();
        const left = ((cx / W) * box.width);
        tip.style.left = Math.min(Math.max(left - 60, 0), box.width - 130) + 'px';
        tip.style.top = Math.max(0, ((y(w.revenue) / H) * box.height) - 70) + 'px';
        hit.classList.add('on');
      };
      const hide = () => { tip.classList.add('hidden'); hit.classList.remove('on'); };
      hit.addEventListener('mouseenter', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('mouseleave', hide);
      hit.addEventListener('blur', hide);
    });
    chart.appendChild(svg);

    const total = shown.reduce((s, w) => s + w.revenue, 0);
    $('weekNote').textContent = `${shown.length} weeks · ${money(total)}`;

    const table = $('weekTable');
    table.innerHTML = '<thead><tr><th>Week of</th><th>Sales</th><th>Revenue</th></tr></thead>';
    const body = el('tbody');
    shown.slice().reverse().forEach((w) => {
      const tr = el('tr');
      tr.append(el('td', null, new Date(w.start).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })), el('td', null, String(w.count)), el('td', null, money(w.revenue)));
      body.appendChild(tr);
    });
    table.appendChild(body);
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  function breakdown(tableId, rows, label) {
    const table = $(tableId);
    table.innerHTML = `<thead><tr><th>${label}</th><th>Sales</th><th>Revenue</th><th>Avg price</th></tr></thead>`;
    const body = el('tbody');
    const maxCount = Math.max(...rows.map((r) => r.count), 1);
    rows.forEach((r) => {
      const tr = el('tr');
      const countTd = el('td', 'count-cell');
      const bar = el('span', 'count-bar');
      bar.style.width = Math.max(4, (r.count / maxCount) * 60) + 'px';
      countTd.append(bar, document.createTextNode(' ' + r.count));
      tr.append(el('td', null, r.key), countTd, el('td', null, money(r.revenue)), el('td', null, money(r.avgPrice)));
      body.appendChild(tr);
    });
    if (!rows.length) {
      const tr = el('tr');
      const td = el('td', 'offers-empty', 'No sales yet.');
      td.colSpan = 4;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    table.appendChild(body);
  }

  async function load() {
    status('loading', 'Loading your sales history from Eldorado...');
    try {
      const res = await fetch('/stats');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Request failed (' + res.status + ')');
      status('', '');
      renderTiles(d);
      renderWeeks(d.weeks);
      breakdown('typeTable', d.byType, 'Type');
      breakdown('bracketTable', d.byBracket, 'Total level');
      $('statsFoot').textContent = `Account sales only, canceled orders left out (${d.totals.canceled} canceled).`
        + (d.capped ? ' Based on your latest 500 orders.' : '')
        + ' Days to sell needs accounts listed and sold through the app (from their listing.json / sale.json).';
    } catch (err) {
      status('error', err.message);
    }
  }

  load();
})();
