// Listing card builder. Exposes window.openCardTool({ files, isRedacted, title, loginMethod }).
//
// Draws an OSRS-style framed card (stone border, dark panel, header, screenshots
// side by side, price) on a canvas, with the afkVault logo in the header and as a
// faded watermark over the panel. Pure client side: nothing here talks to the server.

(function () {
  const LOGO_SRC = 'assets/afkvault-logo.jpg';
  const PREFS_KEY = 'osrs-card-prefs-v1';
  const FONT = '"Poppins", "Segoe UI", Arial, sans-serif';
  const MAX_IMAGES = 3;

  // Fixed card geometry (canvas px). Height is computed from content.
  const W = 1200;
  const BORDER = 52;        // stone border thickness
  const PAD = 34;           // panel padding
  const GAP = 18;           // gap between screenshots
  const MAX_IMG_H = 560;

  const modal = document.getElementById('cardModal');
  const closeBtn = document.getElementById('cardClose');
  const canvas = document.getElementById('cardCanvas');
  const ctx = canvas.getContext('2d');
  const titleInput = document.getElementById('cardTitle');
  const tagsInput = document.getElementById('cardTags');
  const dateInput = document.getElementById('cardMemberTill');
  const priceInput = document.getElementById('cardPrice');
  const imagePicker = document.getElementById('cardImagePicker');
  const alphaInput = document.getElementById('cardWatermarkAlpha');
  const alphaValue = document.getElementById('cardWatermarkValue');
  const headerLogoInput = document.getElementById('cardHeaderLogo');
  const saveBtn = document.getElementById('cardSave');
  const noteEl = document.getElementById('cardNote');

  let logo = null;            // HTMLImageElement
  let stonePattern = null;    // CanvasPattern, built once
  let entries = [];           // [{ file, img, url, redacted, checked }]
  let renderQueued = false;

  // ---------- prefs ----------
  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        watermarkAlpha: Number(alphaInput.value),
        headerLogo: headerLogoInput.checked,
        extraTags: extraTagLines(tagsInput.value)
      }));
    } catch (e) { /* ignore */ }
  }

  // Tags we fill in automatically; anything else the user typed is "extra" and remembered.
  const AUTO_TAGS = ['JL', 'Legacy', 'Clean'];
  function tagLines(text) {
    return text.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  function extraTagLines(text) {
    return tagLines(text).filter((t) => !AUTO_TAGS.includes(t));
  }

  // ---------- loading ----------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = src;
    });
  }

  async function ensureLogo() {
    if (!logo) logo = await loadImage(LOGO_SRC);
    return logo;
  }

  async function ensureFont() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.all([
        document.fonts.load('700 40px "Poppins"'),
        document.fonts.load('600 30px "Poppins"')
      ]);
    } catch (e) { /* fall back to system font */ }
  }

  // ---------- drawing helpers ----------
  function buildStonePattern() {
    const size = 160;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#4b4735';
    g.fillRect(0, 0, size, size);
    // Speckle noise: random light / dark flecks for a stone look.
    const img = g.getImageData(0, 0, size, size);
    const d = img.data;
    let seed = 1234567;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 44;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.8));
    }
    g.putImageData(img, 0, 0);
    // Soft larger blotches so it is not pure static.
    for (let k = 0; k < 40; k++) {
      g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
      g.beginPath();
      g.arc(rnd() * size, rnd() * size, 6 + rnd() * 18, 0, Math.PI * 2);
      g.fill();
    }
    return ctx.createPattern(c, 'repeat');
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawFrame(H) {
    if (!stonePattern) stonePattern = buildStonePattern();
    // Outer stone.
    ctx.fillStyle = stonePattern;
    roundRect(ctx, 0, 0, W, H, 18);
    ctx.fill();
    // Outer bevel: dark outline + inner highlight.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 17);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, 5, 5, W - 10, H - 10, 14);
    ctx.stroke();
    // Vertical "pillar" shading on the side bars, like the OSRS frame.
    const grad = ctx.createLinearGradient(0, 0, BORDER, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.25)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, BORDER, BORDER, H - 2 * BORDER);
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.fillRect(0, BORDER, BORDER, H - 2 * BORDER);
    ctx.restore();
    // Inner panel.
    const px = BORDER, py = BORDER, pw = W - 2 * BORDER, ph = H - 2 * BORDER;
    ctx.fillStyle = '#3a3627';
    roundRect(ctx, px, py, pw, ph, 10);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    roundRect(ctx, px + 1.5, py + 1.5, pw - 3, ph - 3, 9);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, px + 4, py + 4, pw - 8, ph - 8, 7);
    ctx.stroke();
  }

  function drawTextShadowed(text, x, y, font, color, align) {
    ctx.font = font;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(text, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function formatDate(iso) {
    // YYYY-MM-DD -> DD-MM-YYYY, matching the reference cards.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
  }

  function formatPrice(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    return s.startsWith('$') ? s : '$' + s;
  }

  // ---------- layout + render ----------
  function layoutImages(imgs) {
    const availW = W - 2 * BORDER - 2 * PAD - GAP * (imgs.length - 1);
    const sumAspect = imgs.reduce((a, im) => a + im.naturalWidth / im.naturalHeight, 0);
    const h = Math.min(MAX_IMG_H, availW / sumAspect);
    const boxes = imgs.map((im) => ({ im, w: (im.naturalWidth / im.naturalHeight) * h, h }));
    const totalW = boxes.reduce((a, b) => a + b.w, 0) + GAP * (imgs.length - 1);
    let x = BORDER + PAD + (availW + GAP * (imgs.length - 1) - totalW) / 2; // centered
    boxes.forEach((b) => { b.x = x; x += b.w + GAP; });
    return { boxes, h };
  }

  function render() {
    const imgs = entries.filter((e) => e.checked).map((e) => e.img);
    const title = titleInput.value.trim();
    const tags = tagLines(tagsInput.value);
    const memberTill = formatDate(dateInput.value);
    const price = formatPrice(priceInput.value);
    const alpha = Number(alphaInput.value) / 100;
    const showHeaderLogo = headerLogoInput.checked;

    // Header metrics.
    const titleSize = 46;
    const tagSize = 30;
    const logoSize = showHeaderLogo ? 76 : 0;
    const titleRowH = Math.max(logoSize, titleSize);
    const headerH = titleRowH + (tags.length ? 12 + tags.length * (tagSize + 10) : 0);
    const { boxes, h: imgH } = imgs.length ? layoutImages(imgs) : { boxes: [], h: 0 };
    const priceH = price ? 64 : 0;

    const y = BORDER + PAD;
    const headerBottom = y + headerH;
    const imgTop = headerBottom + (imgs.length ? 24 : 0);
    const imgBottom = imgTop + imgH;
    const priceTop = imgBottom + (price ? 14 : 0);
    const H = Math.round(priceTop + priceH + PAD + BORDER);

    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    drawFrame(H);

    // Header: logo + title + tags on the left, member till on the right.
    let tx = BORDER + PAD;
    if (showHeaderLogo && logo) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(tx + logoSize / 2, y + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(logo, tx, y, logoSize, logoSize);
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#d9a52a';
      ctx.beginPath();
      ctx.arc(tx + logoSize / 2, y + logoSize / 2, logoSize / 2 - 1, 0, Math.PI * 2);
      ctx.stroke();
      tx += logoSize + 18;
    }
    const titleBaseline = y + titleRowH / 2 + titleSize * 0.36;
    if (title) drawTextShadowed(title, tx, titleBaseline, '700 ' + titleSize + 'px ' + FONT, '#ffffff');
    if (memberTill) {
      drawTextShadowed('Member till ' + memberTill, W - BORDER - PAD, y + titleSize * 0.5 + 8,
        '700 24px ' + FONT, '#ffffff', 'right');
    }
    let ty = y + titleRowH + 12 + tagSize;
    tags.forEach((t) => {
      drawTextShadowed('- ' + t, BORDER + PAD + 4, ty - 6, '700 ' + tagSize + 'px ' + FONT, '#f5c518');
      ty += tagSize + 10;
    });

    // Screenshots.
    boxes.forEach((b) => {
      const upscale = b.w > b.im.naturalWidth;
      ctx.imageSmoothingEnabled = !upscale; // keep pixel art crisp when enlarging
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#000';
      roundRect(ctx, b.x - 3, imgTop - 3, b.w + 6, b.h + 6, 6);
      ctx.fill();
      ctx.drawImage(b.im, Math.round(b.x), Math.round(imgTop), Math.round(b.w), Math.round(b.h));
    });
    ctx.imageSmoothingEnabled = true;

    // Price.
    if (price) {
      drawTextShadowed('Price ' + price, W - BORDER - PAD, priceTop + 48, '700 44px ' + FONT, '#5cf26a', 'right');
    }

    // Watermark over the whole panel.
    if (logo && alpha > 0) {
      const pw = W - 2 * BORDER, ph = H - 2 * BORDER;
      const s = Math.min(pw, ph) * 0.85;
      ctx.save();
      ctx.globalAlpha = alpha;
      // Screen blend: the logo's black background drops out, only the gold shows.
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(logo, BORDER + (pw - s) / 2, BORDER + (ph - s) / 2, s, s);
      ctx.restore();
    }

    noteEl.textContent = imgs.length ? '' : 'Tick at least one screenshot to put on the card.';
    saveBtn.disabled = !imgs.length;
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  // ---------- image picker ----------
  function buildPicker() {
    imagePicker.innerHTML = '';
    entries.forEach((e, idx) => {
      const label = document.createElement('label');
      label.className = 'card-pick' + (e.checked ? ' on' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = e.checked;
      cb.addEventListener('change', () => {
        const checkedCount = entries.filter((x) => x.checked).length;
        if (cb.checked && checkedCount >= MAX_IMAGES) {
          cb.checked = false;
          noteEl.textContent = 'Up to ' + MAX_IMAGES + ' screenshots fit on a card.';
          return;
        }
        e.checked = cb.checked;
        label.classList.toggle('on', e.checked);
        queueRender();
      });
      const thumb = document.createElement('img');
      thumb.src = e.url;
      thumb.alt = 'Screenshot ' + (idx + 1);
      const cap = document.createElement('span');
      cap.textContent = (idx + 1) + '. ' + (e.redacted ? 'Redacted' : 'Original');
      label.appendChild(cb);
      label.appendChild(thumb);
      label.appendChild(cap);
      imagePicker.appendChild(label);
    });
  }

  // Object URLs in entries stay alive until the modal closes (thumbnails use them).
  function releaseEntries() {
    entries.forEach((e) => { if (e.url) URL.revokeObjectURL(e.url); });
    entries = [];
  }

  // ---------- open / close ----------
  function cleanTitle(generated) {
    if (!generated) return '';
    const first = generated.split('|')[0] || '';
    // Strip emojis / symbols and collapse spaces.
    return first.replace(/[\p{Extended_Pictographic}️]/gu, '').replace(/\s+/g, ' ').trim();
  }

  window.openCardTool = async function ({ files, isRedacted, title, loginMethod }) {
    releaseEntries();
    modal.classList.remove('hidden');
    noteEl.textContent = 'Loading...';
    await Promise.all([ensureLogo().catch(() => null), ensureFont()]);

    const loaded = await Promise.all(files.map(async (file) => {
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      return { file, img, url, redacted: !!isRedacted(file), checked: false };
    }));
    entries = loaded;
    // Default: every redacted screenshot (up to the max); if none, the first one.
    let n = 0;
    entries.forEach((e) => { if (e.redacted && n < MAX_IMAGES) { e.checked = true; n++; } });
    if (n === 0 && entries.length) entries[0].checked = true;

    const prefs = loadPrefs();
    titleInput.value = cleanTitle(title);
    const autoTags = [loginMethod === 'jagex' ? 'JL' : 'Legacy', 'Clean'];
    tagsInput.value = autoTags.concat(prefs.extraTags || []).join('\n');
    dateInput.value = '';
    priceInput.value = '';
    alphaInput.value = prefs.watermarkAlpha != null ? prefs.watermarkAlpha : 10;
    headerLogoInput.checked = prefs.headerLogo != null ? prefs.headerLogo : true;
    alphaValue.textContent = alphaInput.value + '%';

    buildPicker();
    render();
  };

  function close() {
    modal.classList.add('hidden');
    releaseEntries();
  }

  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  [titleInput, tagsInput, dateInput, priceInput].forEach((el) => el.addEventListener('input', queueRender));
  tagsInput.addEventListener('change', savePrefs);
  alphaInput.addEventListener('input', () => {
    alphaValue.textContent = alphaInput.value + '%';
    queueRender();
  });
  alphaInput.addEventListener('change', savePrefs);
  headerLogoInput.addEventListener('change', () => { savePrefs(); queueRender(); });

  saveBtn.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const base = (titleInput.value.trim() || 'listing')
        .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
      window.saveImageFile(blob, base + '-card.png');
    }, 'image/png');
  });
})();
