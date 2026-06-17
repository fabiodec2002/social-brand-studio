// ─── Quote Studio ─────────────────────────────────────────────────────────────

const quoteState = {
  text: '',
  subtext: '',
  authorName: '',
  authorHandle: '',
  avatarImage: null,
  style: 'twitter',
  ratio: 'square',
  accentColor: '#c9a96e',
  bgColor: '#0c0c0b',
  initialized: false,
};

const QUOTE_DIMS = {
  square:   { w: 500, h: 500,  ew: 1000, eh: 1000  },
  portrait: { w: 500, h: 625,  ew: 1000, eh: 1250  },
  wide:     { w: 500, h: 281,  ew: 1000, eh: 562   },
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function quoteInit() {
  if (quoteState.initialized) { quoteRenderPreview(); return; }

  // Restore persisted state
  try {
    const saved = JSON.parse(localStorage.getItem('quote_state_v1') || '{}');
    if (saved.text)        quoteState.text        = saved.text;
    if (saved.subtext)     quoteState.subtext     = saved.subtext;
    if (saved.authorName)  quoteState.authorName  = saved.authorName;
    if (saved.authorHandle)quoteState.authorHandle= saved.authorHandle;
    if (saved.style)       quoteState.style       = saved.style;
    if (saved.ratio)       quoteState.ratio       = saved.ratio;
    if (saved.accentColor) quoteState.accentColor = saved.accentColor;
    if (saved.bgColor)     quoteState.bgColor     = saved.bgColor;
  } catch (_) {}

  // Sync inputs from restored state
  _quoteSyncInputs();

  // Ensure html2canvas is available (shared with carousel)
  if (!window.html2canvas) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Ensure shared render target exists (carousel may have already created it)
  if (!document.getElementById('carousel-render-target')) {
    const rt = document.createElement('div');
    rt.id = 'carousel-render-target';
    rt.style.cssText = 'position:fixed;left:-9999px;top:-9999px;pointer-events:none;z-index:-1;';
    document.body.appendChild(rt);
  }

  quoteState.initialized = true;
  quoteRenderPreview();
}

// ─── Sync UI inputs to state ──────────────────────────────────────────────────

function _quoteSyncInputs() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('quote-text-input', quoteState.text);
  set('quote-subtext-input', quoteState.subtext);
  set('quote-author-name', quoteState.authorName);
  set('quote-author-handle', quoteState.authorHandle);
  set('quote-accent-color', quoteState.accentColor);
  set('quote-bg-color', quoteState.bgColor);

  // Style preset buttons
  document.querySelectorAll('.quote-style-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.style === quoteState.style);
  });

  // Ratio buttons
  document.querySelectorAll('.quote-ratio-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ratio === quoteState.ratio);
  });

  _quoteToggleColorPickers();
}

function _quoteToggleColorPickers() {
  const showColors = ['dark', 'gradient', 'bold', 'minimal'].includes(quoteState.style);
  const row = document.getElementById('quote-color-row');
  if (row) row.style.display = showColors ? 'flex' : 'none';
}

// ─── State persistence ────────────────────────────────────────────────────────

function _quotePersist() {
  const { text, subtext, authorName, authorHandle, style, ratio, accentColor, bgColor } = quoteState;
  localStorage.setItem('quote_state_v1', JSON.stringify({ text, subtext, authorName, authorHandle, style, ratio, accentColor, bgColor }));
}

// ─── Public setters (called from HTML) ───────────────────────────────────────

function quoteSetStyle(style) {
  quoteState.style = style;
  document.querySelectorAll('.quote-style-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.style === style);
  });
  _quoteToggleColorPickers();
  _quotePersist();
  quoteRenderPreview();
}

function quoteSetRatio(ratio) {
  quoteState.ratio = ratio;
  document.querySelectorAll('.quote-ratio-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ratio === ratio);
  });
  _quotePersist();
  quoteRenderPreview();
}

function quoteUpdateField(field, value) {
  quoteState[field] = value;
  _quotePersist();
  quoteRenderPreview();
}

// ─── Preview render ───────────────────────────────────────────────────────────

function quoteRenderPreview() {
  const display = document.getElementById('quote-preview-display');
  if (!display) return;

  const dims = QUOTE_DIMS[quoteState.ratio];

  // Resize container
  display.style.width  = dims.w + 'px';
  display.style.height = dims.h + 'px';
  display.style.overflow = 'hidden';
  display.style.position = 'relative';
  display.style.flexShrink = '0';

  display.innerHTML = _quoteBuildCardHTML(quoteState, dims.w, dims.h);
}

// ─── Card HTML builders ───────────────────────────────────────────────────────

function _quoteBuildCardHTML(state, w, h) {
  switch (state.style) {
    case 'dark':     return _buildDarkCard(state, w, h);
    case 'minimal':  return _buildMinimalCard(state, w, h);
    case 'gradient': return _buildGradientCard(state, w, h);
    case 'bold':     return _buildBoldCard(state, w, h);
    default:         return _buildTwitterCard(state, w, h);
  }
}

function _esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _avatarHTML(avatarImage, size, border = 'none') {
  if (avatarImage) {
    return `<img src="${avatarImage}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:${border};flex-shrink:0;" crossorigin="anonymous">`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#c9a96e22;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:${border};"><span style="font-size:${Math.floor(size*0.4)}px;color:#c9a96e;">✦</span></div>`;
}

// 1. Twitter/X style (Hormozi layout — no logo, verified badge next to name)
function _buildTwitterCard(state, w, h) {
  const pad = Math.round(w * 0.1);
  const authorSize = Math.round(w * 0.038);
  const handleSize = Math.round(w * 0.032);
  const quoteSize  = _calcFontSize(state.text, w, h, 0.072, 0.048, pad);
  const subtextSize = Math.round(w * 0.034);
  const avatarSize = Math.round(w * 0.12);
  const checkSize  = Math.round(w * 0.036);
  const name = _esc(state.authorName || 'Your Name');
  const handle = _esc(state.authorHandle ? '@' + state.authorHandle.replace(/^@/, '') : '@yourhandle');

  // Blue verified checkmark SVG (Twitter blue #1D9BF0)
  const verifiedBadge = `<svg width="${checkSize}" height="${checkSize}" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle;flex-shrink:0;margin-left:${Math.round(checkSize*0.15)}px;"><path fill="#1D9BF0" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91-1.01-1-2.52-1.26-3.91-.8C14.67 2.88 13.43 2 12 2c-1.43 0-2.67.88-3.34 2.19-1.39-.46-2.9-.2-3.91.81-1 1.01-1.26 2.52-.8 3.91C2.88 9.33 2 10.57 2 12c0 1.43.88 2.67 2.19 3.34-.46 1.39-.2 2.9.81 3.91 1.01 1 2.52 1.26 3.91.8C9.33 21.12 10.57 22 12 22c1.43 0 2.67-.88 3.34-2.19 1.39.46 2.9.2 3.91-.81 1-1.01 1.26-2.52.8-3.91C21.12 14.67 22 13.43 22 12zm-11.22 3.1L7.48 11.5l1.42-1.42 2.08 2.08 4.62-4.62 1.42 1.42-6.06 6.14z"/></svg>`;

  return `<div style="
    width:${w}px;height:${h}px;box-sizing:border-box;
    background:#ffffff;
    font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;
    padding:${pad}px;
    display:flex;flex-direction:column;
  ">
    <div style="display:flex;align-items:center;gap:${Math.round(w*0.03)}px;margin-bottom:${Math.round(h*0.05)}px;">
      ${_avatarHTML(state.avatarImage, avatarSize)}
      <div>
        <div style="display:flex;align-items:center;font-weight:700;font-size:${authorSize}px;color:#0f1419;line-height:1.2;">${name}${verifiedBadge}</div>
        <div style="font-size:${handleSize}px;color:#536471;margin-top:3px;">${handle}</div>
      </div>
    </div>
    <p style="
      margin:0;font-size:${quoteSize}px;font-weight:400;
      color:#0f1419;line-height:1.5;letter-spacing:-0.01em;
      word-break:break-word;
    ">${_esc(state.text) || '<span style="color:#9ca3af;font-style:italic;">Your quote will appear here…</span>'}</p>
    ${state.subtext ? `<p style="margin:${Math.round(h*0.04)}px 0 0;font-size:${subtextSize}px;color:#536471;line-height:1.4;">${_esc(state.subtext)}</p>` : ''}
  </div>`;
}

// 2. Dark luxury style
function _buildDarkCard(state, w, h) {
  const pad    = Math.round(w * 0.1);
  const qSize  = _calcFontSize(state.text, w, h, 0.068, 0.042, pad);
  const aSize  = Math.round(w * 0.032);
  const stSize = Math.round(w * 0.030);
  const accent = state.accentColor || '#c9a96e';
  const bg     = state.bgColor || '#0c0c0b';
  const name   = _esc(state.authorName || '');

  return `<div style="
    width:${w}px;height:${h}px;box-sizing:border-box;
    background:${bg};
    font-family:'Cormorant Garamond','Georgia',serif;
    padding:${pad}px;
    display:flex;flex-direction:column;justify-content:center;
    position:relative;overflow:hidden;
  ">
    <div style="position:absolute;top:${Math.round(h*0.06)}px;left:${pad}px;font-size:${Math.round(w*0.22)}px;color:${accent};opacity:0.18;line-height:1;font-family:Georgia,serif;pointer-events:none;">"</div>
    <div style="position:relative;z-index:1;">
      <p style="
        margin:0;font-size:${qSize}px;font-weight:400;
        color:#f5f0e8;line-height:1.55;letter-spacing:0.01em;
        word-break:break-word;font-style:italic;
      ">${_esc(state.text) || '<span style="opacity:0.35;">Your quote will appear here…</span>'}</p>
      ${state.subtext ? `<p style="margin:${Math.round(h*0.04)}px 0 0;font-size:${stSize}px;color:${accent};font-style:normal;font-family:'Outfit',sans-serif;letter-spacing:0.03em;">${_esc(state.subtext)}</p>` : ''}
      ${name ? `<div style="margin-top:${Math.round(h*0.05)}px;display:flex;align-items:center;gap:${Math.round(w*0.025)}px;">
        <div style="width:${Math.round(w*0.04)}px;height:1px;background:${accent};"></div>
        <span style="font-size:${aSize}px;color:${accent};font-style:normal;font-family:'Outfit',sans-serif;letter-spacing:0.06em;">${name}</span>
      </div>` : ''}
    </div>
    <div style="position:absolute;bottom:${Math.round(h*0.05)}px;right:${pad}px;font-size:${Math.round(w*0.022)}px;color:${accent};opacity:0.4;font-family:'Outfit',sans-serif;letter-spacing:0.08em;">${_esc(state.authorHandle ? state.authorHandle.replace(/^@/,'@') : '')}</div>
  </div>`;
}

// 3. Minimal style
function _buildMinimalCard(state, w, h) {
  const pad    = Math.round(w * 0.1);
  const qSize  = _calcFontSize(state.text, w, h, 0.064, 0.040, pad);
  const aSize  = Math.round(w * 0.030);
  const stSize = Math.round(w * 0.028);
  const accent = state.accentColor || '#c9a96e';
  const name   = _esc(state.authorName || '');
  const bar    = Math.round(w * 0.006);

  return `<div style="
    width:${w}px;height:${h}px;box-sizing:border-box;
    background:#ffffff;
    font-family:'Georgia',serif;
    border:1px solid #e5e5e5;
    padding:${pad}px;
    display:flex;flex-direction:column;justify-content:center;
    position:relative;
  ">
    <div style="position:absolute;left:0;top:${Math.round(h*0.15)}px;bottom:${Math.round(h*0.15)}px;width:${bar}px;background:${accent};"></div>
    <div style="padding-left:${Math.round(w*0.06)}px;">
      <p style="
        margin:0;font-size:${qSize}px;font-weight:400;
        color:#1a1a1a;line-height:1.6;
        word-break:break-word;font-style:italic;
      ">${_esc(state.text) || '<span style="color:#9ca3af;">Your quote will appear here…</span>'}</p>
      ${state.subtext ? `<p style="margin:${Math.round(h*0.04)}px 0 0;font-size:${stSize}px;color:#555;font-style:normal;font-family:sans-serif;">${_esc(state.subtext)}</p>` : ''}
      ${name ? `<p style="margin:${Math.round(h*0.05)}px 0 0;font-size:${aSize}px;color:#1a1a1a;font-style:normal;font-family:sans-serif;font-weight:500;">— ${name}</p>` : ''}
    </div>
  </div>`;
}

// 4. Gradient style
function _buildGradientCard(state, w, h) {
  const pad    = Math.round(w * 0.1);
  const qSize  = _calcFontSize(state.text, w, h, 0.070, 0.044, pad);
  const aSize  = Math.round(w * 0.030);
  const stSize = Math.round(w * 0.028);
  const name   = _esc(state.authorName || '');

  return `<div style="
    width:${w}px;height:${h}px;box-sizing:border-box;
    background:linear-gradient(135deg,#1a1a2e 0%,#16213e 60%,#0f3460 100%);
    font-family:'Outfit','Helvetica Neue',sans-serif;
    padding:${pad}px;
    display:flex;flex-direction:column;justify-content:center;
    position:relative;overflow:hidden;
  ">
    <div style="position:absolute;top:-${Math.round(h*0.2)}px;right:-${Math.round(w*0.1)}px;width:${Math.round(w*0.6)}px;height:${Math.round(w*0.6)}px;border-radius:50%;background:rgba(255,255,255,0.03);"></div>
    <div style="position:absolute;bottom:-${Math.round(h*0.15)}px;left:-${Math.round(w*0.1)}px;width:${Math.round(w*0.5)}px;height:${Math.round(w*0.5)}px;border-radius:50%;background:rgba(255,255,255,0.03);"></div>
    <div style="position:relative;z-index:1;">
      <p style="
        margin:0;font-size:${qSize}px;font-weight:600;
        color:#ffffff;line-height:1.45;letter-spacing:-0.01em;
        word-break:break-word;
      ">${_esc(state.text) || '<span style="opacity:0.35;">Your quote will appear here…</span>'}</p>
      ${state.subtext ? `<p style="margin:${Math.round(h*0.04)}px 0 0;font-size:${stSize}px;color:rgba(255,255,255,0.65);font-weight:400;">${_esc(state.subtext)}</p>` : ''}
      ${name ? `<p style="margin:${Math.round(h*0.055)}px 0 0;font-size:${aSize}px;color:rgba(255,255,255,0.5);font-weight:400;letter-spacing:0.05em;">— ${name}</p>` : ''}
    </div>
  </div>`;
}

// 5. Bold style
function _buildBoldCard(state, w, h) {
  const pad    = Math.round(w * 0.1);
  const qSize  = _calcFontSize(state.text, w, h, 0.082, 0.050, pad);
  const aSize  = Math.round(w * 0.030);
  const stSize = Math.round(w * 0.028);
  const accent = state.accentColor || '#c9a96e';
  const name   = _esc(state.authorName || '');

  return `<div style="
    width:${w}px;height:${h}px;box-sizing:border-box;
    background:${accent};
    font-family:'Outfit','Helvetica Neue',sans-serif;
    padding:${pad}px;
    display:flex;flex-direction:column;justify-content:center;
    position:relative;
  ">
    <p style="
      margin:0;font-size:${qSize}px;font-weight:700;
      color:#ffffff;line-height:1.35;letter-spacing:-0.02em;
      word-break:break-word;
      text-shadow:0 2px 16px rgba(0,0,0,0.18);
    ">${_esc(state.text) || '<span style="opacity:0.45;">Your quote will appear here…</span>'}</p>
    ${state.subtext ? `<p style="margin:${Math.round(h*0.04)}px 0 0;font-size:${stSize}px;color:rgba(255,255,255,0.8);font-weight:400;">${_esc(state.subtext)}</p>` : ''}
    ${name ? `<div style="position:absolute;bottom:${pad}px;right:${pad}px;font-size:${aSize}px;color:rgba(255,255,255,0.7);font-weight:500;">${name}</div>` : ''}
  </div>`;
}

// ─── Font size calculator ─────────────────────────────────────────────────────
// Scales font down when text is long so it fits the card.
function _calcFontSize(text, w, h, maxRatio, minRatio, pad) {
  const len = (text || '').length;
  const max = Math.round(w * maxRatio);
  const min = Math.round(w * minRatio);
  // Rough heuristic: shrink after ~80 chars
  if (len <= 60)  return max;
  if (len <= 120) return Math.round(max - (max - min) * 0.35);
  if (len <= 200) return Math.round(max - (max - min) * 0.65);
  return min;
}

// ─── PNG export ───────────────────────────────────────────────────────────────

async function quoteExportPNG() {
  const btn = document.getElementById('quote-download-btn');
  if (btn) { btn.textContent = 'Rendering…'; btn.disabled = true; }

  try {
    const dims = QUOTE_DIMS[quoteState.ratio];
    const target = document.getElementById('carousel-render-target');
    target.style.width  = dims.ew + 'px';
    target.style.height = dims.eh + 'px';
    target.innerHTML = _quoteBuildCardHTML(quoteState, dims.ew, dims.eh);

    const canvas = await window.html2canvas(target, {
      width: dims.ew,
      height: dims.eh,
      scale: 1,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: null,
    });

    target.innerHTML = '';

    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'quote-card.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  } finally {
    if (btn) { btn.textContent = 'Download PNG'; btn.disabled = false; }
  }
}

// ─── Avatar upload ────────────────────────────────────────────────────────────

function quoteHandleAvatarUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    quoteState.avatarImage = e.target.result;
    const preview = document.getElementById('quote-avatar-preview');
    if (preview) preview.src = e.target.result;
    const wrap = document.getElementById('quote-avatar-preview-wrap');
    if (wrap) wrap.style.display = 'block';
    quoteRenderPreview();
  };
  reader.readAsDataURL(file);
}

// ─── AI generation ────────────────────────────────────────────────────────────

async function quoteGenerateAI() {
  const topicEl  = document.getElementById('quote-ai-topic');
  const toneEl   = document.getElementById('quote-ai-tone');
  const statusEl = document.getElementById('quote-ai-status');
  const btn      = document.getElementById('quote-generate-btn');

  const topic = topicEl ? topicEl.value.trim() : '';

  if (typeof appData === 'undefined' || !appData.personalityMap || !appData.strategy) {
    if (statusEl) { statusEl.textContent = 'Load a brand session first.'; statusEl.style.color = '#e87070'; }
    return;
  }

  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
  if (statusEl) { statusEl.textContent = ''; }

  try {
    const res = await authFetch('/api/generate-quote-post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalityMap: appData.personalityMap,
        strategy: appData.strategy,
        brandContext: appData.brandContext || null,
        brandType: appData.brandType || 'personal',
        sessionId: appData.sessionId || null,
        topic: topic || null,
        tone: toneEl ? toneEl.value : 'authentic',
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Generation failed');

    quoteState.text    = data.quote;
    quoteState.subtext = data.subtext || '';
    _quotePersist();

    const textEl    = document.getElementById('quote-text-input');
    const subtextEl = document.getElementById('quote-subtext-input');
    if (textEl)    textEl.value    = quoteState.text;
    if (subtextEl) subtextEl.value = quoteState.subtext;

    quoteRenderPreview();

    if (statusEl) { statusEl.textContent = 'Quote generated ✓'; statusEl.style.color = '#7dc47d'; }
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message; statusEl.style.color = '#e87070'; }
  } finally {
    if (btn) { btn.textContent = 'Generate Quote'; btn.disabled = false; }
  }
}

// ─── Save to library ──────────────────────────────────────────────────────────

async function quoteSaveToLibrary() {
  const btn      = document.getElementById('quote-save-btn');
  const statusEl = document.getElementById('quote-ai-status');

  if (!quoteState.text.trim()) {
    if (statusEl) { statusEl.textContent = 'Nothing to save — write or generate a quote first.'; statusEl.style.color = '#e87070'; }
    return;
  }
  if (typeof appData === 'undefined' || !appData.personalityMap) {
    if (statusEl) { statusEl.textContent = 'Load a brand session first.'; statusEl.style.color = '#e87070'; }
    return;
  }

  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
  try {
    const res = await authFetch('/api/generate-quote-post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalityMap: appData.personalityMap,
        strategy: appData.strategy || {},
        brandContext: appData.brandContext || null,
        brandType: appData.brandType || 'personal',
        sessionId: appData.sessionId || null,
        topic: quoteState.text.slice(0, 80),
        tone: document.getElementById('quote-ai-tone')?.value || 'authentic',
        saveOnly: true,
        quoteText: quoteState.text,
      }),
    });
    const data = await res.json();
    if (statusEl) {
      statusEl.textContent = data.success ? 'Saved to library ✓' : (data.error || 'Save failed');
      statusEl.style.color = data.success ? '#7dc47d' : '#e87070';
    }
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message; statusEl.style.color = '#e87070'; }
  } finally {
    if (btn) { btn.textContent = 'Save to Library'; btn.disabled = false; }
  }
}
