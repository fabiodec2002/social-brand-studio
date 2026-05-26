// ─── Instagram Carousel Builder ──────────────────────────────────────────────

const CAROUSEL_ACCENT_PRESETS = ['#39FF14','#ffffff','#c9a96e','#c13584','#0d3b8c','#ff6b35','#a855f7','#ef4444'];
const CAROUSEL_BG_PRESETS = ['#0a0a0a','#141413','#0f0f0f','#1a1a1a','#0d0d14','#14140a','#0a0d14','#140a0a'];
const CAROUSEL_TEMPLATE_KEY = 'carousel_template_v1';

let carouselState = {
  slides: getDefaultCarouselSlides(),
  currentSlide: 0,
  coverImage: null,
  coverScale: 130,
  coverX: 0,
  coverY: 0,
  avatarImage: null,
  accentColor: '#39FF14',
  bgColor: '#0a0a0a',
  slideStyle: 'dark',   // 'dark' | 'light'
  logoText: 'BRAND.',
  websiteUrl: '',
  initialized: false,
};

function getDefaultCarouselSlides() {
  return [
    {
      type: 'title',
      heading: 'Your carousel topic here',
      subheading: 'A short line about what this is',
      tag: 'TOPIC',
      username: '@yourhandle',
    },
    {
      type: 'content',
      number: '01',
      heading: 'First point',
      description: 'Explain this point briefly. One or two clear, specific sentences.',
      highlight: 'The key takeaway in one line.',
      image: null,
    },
    {
      type: 'content',
      number: '02',
      heading: 'Second point',
      description: 'Keep each slide to one idea. Short, specific, actionable.',
      highlight: 'What to remember from this.',
      image: null,
    },
    {
      type: 'content',
      number: '03',
      heading: 'Third point',
      description: 'End with a concrete step or insight. Make it screenshot-worthy.',
      highlight: 'Save this for when you need it.',
      image: null,
    },
  ];
}

// ─── Initialization ───────────────────────────────────────────────────────────

function carouselInit() {
  if (carouselState.initialized) return;
  carouselState.initialized = true;
  _carouselLoadHtml2Canvas();
  carouselLoadTemplate();
  _carouselBuildColorPresets();
  carouselUpdatePreview();
  carouselRenderEditor();
}

function _carouselLoadHtml2Canvas() {
  if (window.html2canvas) return;
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  document.head.appendChild(s);
}

// ─── Slide HTML building ──────────────────────────────────────────────────────

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _carouselBuildSlideHTML(slide, idx) {
  const total = carouselState.slides.length;
  if (carouselState.slideStyle === 'light') {
    return slide.type === 'title'
      ? _carouselBuildLightTitleHTML(slide)
      : _carouselBuildLightContentHTML(slide, idx, total);
  }
  if (slide.type === 'title') return _carouselBuildTitleHTML(slide);
  return _carouselBuildContentHTML(slide, idx, total);
}

// ─── Light / Brand Card style ─────────────────────────────────────────────────

function _carouselBuildLightTitleHTML(slide) {
  const { accentColor, logoText, websiteUrl, avatarImage } = carouselState;
  const logo = logoText || 'BRAND.';
  const site = websiteUrl || '';

  const avatarHtml = avatarImage
    ? `<img src="${avatarImage}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;border:2px solid ${accentColor};flex-shrink:0;" crossorigin="anonymous">`
    : `<div style="width:38px;height:38px;border-radius:50%;background:#e8e8e8;border:2px solid ${accentColor};flex-shrink:0;"></div>`;

  const username = slide.username ? slide.username.replace(/^@/, '') : 'Your Name';

  // Split heading: first line normal black, subheading in highlight box
  const headingHtml = slide.heading
    ? `<div style="font-size:46px;font-weight:300;color:#000;line-height:1.1;letter-spacing:-1px;margin-bottom:8px;">${_esc(slide.heading)}</div>`
    : '';
  const subHtml = slide.subheading
    ? `<div style="display:inline-block;background:${accentColor};color:#fff;font-size:42px;font-weight:700;padding:4px 10px;border-radius:6px;line-height:1.2;letter-spacing:-0.5px;">${_esc(slide.subheading)}</div>`
    : '';

  const siteHtml = site
    ? `<div style="position:absolute;bottom:68px;left:28px;font-size:13px;color:#555;font-style:italic;letter-spacing:0.02em;">${_esc(site)}</div>`
    : '';

  return `<div style="width:360px;height:640px;background:#fff;position:relative;overflow:hidden;font-family:Arial,'Helvetica Neue',sans-serif;">
  <!-- Logo -->
  <div style="position:absolute;top:20px;right:20px;font-size:22px;font-weight:900;color:${accentColor};letter-spacing:-0.5px;">${_esc(logo)}</div>
  <!-- Divider -->
  <div style="position:absolute;top:60px;left:0;right:0;height:2.5px;background:${accentColor};"></div>
  <div style="position:absolute;top:54px;left:16px;width:4px;height:14px;background:${accentColor};"></div>
  <!-- Heading block -->
  <div style="position:absolute;left:28px;right:28px;top:110px;">
    ${headingHtml}
    ${subHtml}
  </div>
  <!-- Author pill -->
  <div style="position:absolute;left:28px;bottom:110px;display:flex;align-items:center;gap:10px;right:28px;">
    ${avatarHtml}
    <div style="background:#f0f0f0;padding:6px 14px;border-radius:20px;font-size:13px;color:#222;white-space:nowrap;">${_esc(username)}</div>
    <div style="flex:1;height:2.5px;background:${accentColor};margin-left:4px;"></div>
  </div>
  ${siteHtml}
</div>`;
}

function _carouselBuildLightContentHTML(slide, idx, total) {
  const { accentColor, logoText, websiteUrl } = carouselState;
  const logo = logoText || 'BRAND.';
  const site = websiteUrl || '';
  const counter = String(idx + 1).padStart(2, '0');

  // Progress bar segments at bottom
  const segW = Math.floor(340 / total);
  const progressHtml = Array.from({ length: total }, (_, i) => {
    const filled = i < idx + 1;
    const bg = filled ? accentColor : `${accentColor}33`;
    return `<div style="width:${segW}px;height:100%;background:${bg};"></div>`;
  }).join('');

  const headingHtml = slide.heading
    ? `<div style="font-size:28px;font-weight:400;color:#111;line-height:1.3;margin-bottom:12px;">${_esc(slide.heading)}</div>`
    : '';

  const highlightHtml = slide.highlight
    ? `<div style="background:${accentColor};color:#fff;font-size:24px;font-weight:600;line-height:1.35;padding:10px 14px;border-radius:6px;margin-bottom:12px;">${_esc(slide.highlight)}</div>`
    : '';

  const descHtml = slide.description
    ? `<div style="font-size:22px;font-weight:400;color:#111;line-height:1.4;">${_esc(slide.description)}</div>`
    : '';

  const siteHtml = site
    ? `<div style="position:absolute;bottom:26px;left:40px;font-size:12px;color:#555;font-style:italic;">${_esc(site)}</div>`
    : '';

  return `<div style="width:360px;height:640px;background:#fff;position:relative;overflow:hidden;font-family:Arial,'Helvetica Neue',sans-serif;">
  <!-- Logo -->
  <div style="position:absolute;top:18px;right:20px;font-size:20px;font-weight:900;color:${accentColor};letter-spacing:-0.5px;">${_esc(logo)}</div>
  <!-- Divider + counter -->
  <div style="position:absolute;top:56px;left:0;right:0;height:2.5px;background:${accentColor};"></div>
  <div style="position:absolute;top:48px;right:16px;font-size:12px;font-weight:700;color:${accentColor};letter-spacing:0.12em;">─ ${counter} ─</div>
  <!-- Progress arrow -->
  <div style="position:absolute;left:0;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;padding:0 6px;">
    <div style="width:2px;height:40px;background:${accentColor};border-radius:1px;"></div>
    <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:10px solid ${accentColor};margin-top:0;"></div>
  </div>
  <!-- Content -->
  <div style="position:absolute;left:36px;right:20px;top:85px;bottom:56px;display:flex;flex-direction:column;justify-content:center;">
    ${headingHtml}
    ${highlightHtml}
    ${descHtml}
  </div>
  ${siteHtml}
  <!-- Footer bar -->
  <div style="position:absolute;bottom:0;left:0;right:0;height:14px;display:flex;overflow:hidden;">
    ${progressHtml}
  </div>
</div>`;
}

function _carouselBuildTitleHTML(slide) {
  const { accentColor, bgColor, coverImage, coverScale, coverX, coverY } = carouselState;

  const coverLayer = coverImage
    ? `<div style="position:absolute;inset:0;overflow:hidden;">
         <img src="${coverImage}" style="width:100%;height:100%;object-fit:cover;transform-origin:center center;transform:scale(${coverScale / 100}) translate(${coverX}px,${coverY}px);">
       </div>`
    : `<div style="position:absolute;inset:0;background:${bgColor};"></div>`;

  const gradient = `<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.9) 0%,rgba(0,0,0,0.35) 55%,transparent 100%);"></div>`;

  const tagHtml = slide.tag
    ? `<div style="display:inline-block;background:${accentColor};color:#000;font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:4px 10px;margin-bottom:14px;border-radius:1px;">${_esc(slide.tag)}</div><br>`
    : '';

  const words = (slide.heading || '').trim().split(/\s+/);
  const last = words.pop() || '';
  const rest = words.join(' ');
  const headingHtml = rest
    ? `${_esc(rest)} <span style="color:${accentColor};">${_esc(last)}</span>`
    : `<span style="color:${accentColor};">${_esc(last)}</span>`;

  const avatarHtml = _carouselAvatarHTML(34);
  const username = slide.username || '@yourhandle';

  return `<div style="width:360px;height:640px;position:relative;overflow:hidden;font-family:Arial,'Helvetica Neue',sans-serif;background:${bgColor};">
  ${coverLayer}
  ${gradient}
  <div style="position:absolute;left:28px;right:28px;bottom:70px;display:flex;flex-direction:column;">
    ${tagHtml}
    <h1 style="font-size:30px;font-weight:800;color:#fff;line-height:1.2;margin:0 0 10px;letter-spacing:-0.5px;">${headingHtml}</h1>
    <p style="font-size:15px;color:rgba(255,255,255,0.72);margin:0 0 8px;line-height:1.4;">${_esc(slide.subheading || '')}</p>
    <p style="font-size:11px;color:rgba(255,255,255,0.38);margin:0 0 18px;font-style:italic;">(save it so you don't lose it)</p>
    <div style="display:flex;align-items:center;gap:8px;">${avatarHtml}<span style="font-size:13px;color:rgba(255,255,255,0.82);">${_esc(username)}</span><span style="color:#1d9bf0;font-size:15px;font-weight:bold;">✓</span></div>
  </div>
</div>`;
}

function _carouselBuildContentHTML(slide, idx, total) {
  const { accentColor, bgColor, slides } = carouselState;
  const username = (slides[0] && slides[0].username) || '@yourhandle';
  const counter = `${idx + 1}/${total}`;

  const imgHtml = slide.image
    ? `<img src="${slide.image}" style="width:100%;height:130px;object-fit:cover;margin-bottom:14px;border-radius:2px;" crossorigin="anonymous">`
    : '';

  const highlightHtml = slide.highlight
    ? `<div style="display:flex;gap:10px;align-items:flex-start;margin-top:14px;">
         <div style="width:3px;min-width:3px;background:${accentColor};align-self:stretch;border-radius:2px;"></div>
         <p style="font-size:13px;color:${accentColor};line-height:1.5;font-style:italic;margin:0;">${_esc(slide.highlight)}</p>
       </div>`
    : '';

  return `<div style="width:360px;height:640px;position:relative;overflow:hidden;font-family:Arial,'Helvetica Neue',sans-serif;background:${bgColor};">
  <div style="position:absolute;top:18px;right:20px;font-size:11px;color:rgba(255,255,255,0.18);letter-spacing:0.08em;font-family:'Courier New',monospace;">${counter}</div>
  <div style="position:absolute;left:28px;right:28px;top:64px;bottom:90px;display:flex;flex-direction:column;">
    <div style="font-size:11px;font-weight:700;color:${accentColor};letter-spacing:0.18em;text-transform:uppercase;margin-bottom:10px;">${_esc(slide.number || '')}</div>
    <h2 style="font-size:26px;font-weight:800;color:#fff;line-height:1.25;margin:0 0 14px;letter-spacing:-0.3px;">${_esc(slide.heading || '')}</h2>
    ${imgHtml}
    <p style="font-size:14px;color:rgba(255,255,255,0.58);line-height:1.65;margin:0;">${_esc(slide.description || '')}</p>
    ${highlightHtml}
  </div>
  <div style="position:absolute;bottom:24px;left:28px;right:28px;display:flex;align-items:center;gap:8px;">${_carouselAvatarHTML(30)}<span style="font-size:12px;color:rgba(255,255,255,0.7);">${_esc(username)}</span><span style="color:#1d9bf0;font-size:14px;font-weight:bold;">✓</span></div>
</div>`;
}

function _carouselAvatarHTML(size) {
  if (carouselState.avatarImage) {
    return `<img src="${carouselState.avatarImage}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:1.5px solid rgba(255,255,255,0.25);flex-shrink:0;" crossorigin="anonymous">`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.2);flex-shrink:0;"></div>`;
}

// ─── Preview updates ──────────────────────────────────────────────────────────

function carouselUpdatePreview() {
  const display = document.getElementById('carousel-preview-display');
  if (!display) return;

  const { slides, currentSlide } = carouselState;
  const slide = slides[currentSlide];
  if (!slide) return;

  display.innerHTML = _carouselBuildSlideHTML(slide, currentSlide);

  const prevBtn = document.getElementById('carousel-prev-btn');
  const nextBtn = document.getElementById('carousel-next-btn');
  if (prevBtn) prevBtn.disabled = currentSlide === 0;
  if (nextBtn) nextBtn.disabled = currentSlide === slides.length - 1;

  const saveNum = document.getElementById('carousel-save-num');
  if (saveNum) saveNum.textContent = currentSlide + 1;

  _carouselUpdateDots();
  _carouselUpdateCropVisibility();
  _carouselUpdateSettingsPreview();
}

function _carouselUpdateDots() {
  const dotsEl = document.getElementById('carousel-dots');
  if (!dotsEl) return;
  dotsEl.innerHTML = carouselState.slides.map((_, i) =>
    `<button class="carousel-dot ${i === carouselState.currentSlide ? 'active' : ''}" onclick="carouselGoTo(${i})"></button>`
  ).join('');
}

function _carouselUpdateCropVisibility() {
  const cropEl = document.getElementById('carousel-crop-controls');
  if (!cropEl) return;
  const show = !!carouselState.coverImage && carouselState.currentSlide === 0;
  cropEl.classList.toggle('visible', show);
}

function _carouselUpdateSettingsPreview() {
  const el = document.getElementById('carousel-settings-preview');
  if (!el) return;
  const { slides } = carouselState;
  const previewSlide = slides[Math.min(1, slides.length - 1)];
  if (!previewSlide) return;
  const previewIdx = Math.min(1, slides.length - 1);
  el.innerHTML = `<div style="transform:scale(0.5);transform-origin:top left;width:360px;height:640px;pointer-events:none;">${_carouselBuildSlideHTML(previewSlide, previewIdx)}</div>`;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function carouselPrev() {
  if (carouselState.currentSlide > 0) {
    carouselState.currentSlide--;
    carouselUpdatePreview();
  }
}

function carouselNext() {
  if (carouselState.currentSlide < carouselState.slides.length - 1) {
    carouselState.currentSlide++;
    carouselUpdatePreview();
  }
}

function carouselGoTo(idx) {
  carouselState.currentSlide = idx;
  carouselUpdatePreview();
}

// ─── Inner tab switching ──────────────────────────────────────────────────────

function carouselSwitchTab(tab) {
  ['preview', 'editor', 'settings'].forEach(t => {
    const tabEl = document.getElementById(`ctab-${t}`);
    const panelEl = document.getElementById(`cpanel-${t}`);
    if (tabEl) tabEl.classList.toggle('active', t === tab);
    if (panelEl) panelEl.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'editor') carouselRenderEditor();
  if (tab === 'settings') { _carouselBuildColorPresets(); _carouselUpdateSettingsPreview(); }
}

// ─── Image uploads ────────────────────────────────────────────────────────────

function carouselHandleCover(input) {
  const file = input.files[0];
  if (!file) return;
  _carouselReadFile(file, dataUrl => {
    carouselState.coverImage = dataUrl;
    document.getElementById('carousel-cover-scale').value = carouselState.coverScale;
    document.getElementById('carousel-cover-x').value = carouselState.coverX;
    document.getElementById('carousel-cover-y').value = carouselState.coverY;
    carouselUpdatePreview();
  });
}

function carouselHandleAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  _carouselReadFile(file, dataUrl => {
    carouselState.avatarImage = dataUrl;
    carouselUpdatePreview();
    carouselSaveTemplate();
  });
}

function _carouselReadFile(file, cb) {
  const reader = new FileReader();
  reader.onload = e => cb(e.target.result);
  reader.readAsDataURL(file);
}

function carouselUpdateCrop() {
  carouselState.coverScale = parseInt(document.getElementById('carousel-cover-scale').value);
  carouselState.coverX = parseInt(document.getElementById('carousel-cover-x').value);
  carouselState.coverY = parseInt(document.getElementById('carousel-cover-y').value);
  carouselUpdatePreview();
}

function carouselResetCrop() {
  carouselState.coverScale = 130;
  carouselState.coverX = 0;
  carouselState.coverY = 0;
  document.getElementById('carousel-cover-scale').value = 130;
  document.getElementById('carousel-cover-x').value = 0;
  document.getElementById('carousel-cover-y').value = 0;
  carouselUpdatePreview();
}

// ─── Save slide ───────────────────────────────────────────────────────────────

async function carouselSaveSlide() {
  const { slides, currentSlide, bgColor } = carouselState;
  const slide = slides[currentSlide];
  if (!slide) return;

  const btn = document.querySelector('.carousel-save-btn');
  if (btn) { btn.textContent = 'Rendering…'; btn.disabled = true; }

  try {
    if (!window.html2canvas) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    const target = document.getElementById('carousel-render-target');
    if (!target) throw new Error('Render target missing');
    target.innerHTML = _carouselBuildSlideHTML(slide, currentSlide);

    const canvas = await window.html2canvas(target.firstElementChild, {
      width: 360,
      height: 640,
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: bgColor,
      logging: false,
    });

    const dataUrl = canvas.toDataURL('image/png');
    const modal = document.getElementById('carousel-save-modal');
    const img = document.getElementById('carousel-save-img');
    if (modal && img) { img.src = dataUrl; modal.classList.add('active'); }
  } catch (err) {
    console.error('Carousel save error:', err);
    alert('Save failed — see console for details.');
  } finally {
    if (btn) { btn.textContent = `Save slide ${currentSlide + 1}`; btn.disabled = false; }
  }
}

// ─── Editor ───────────────────────────────────────────────────────────────────

function carouselRenderEditor() {
  const list = document.getElementById('carousel-slides-list');
  if (!list) return;
  list.innerHTML = carouselState.slides.map((slide, i) => _carouselSlideItemHTML(slide, i)).join('');

  // Bind image inputs (can't use inline onchange with dynamic file inputs reliably across browsers)
  carouselState.slides.forEach((slide, i) => {
    if (slide.type !== 'content') return;
    const inp = document.getElementById(`cslide-img-input-${i}`);
    if (inp) {
      inp.addEventListener('change', function () {
        if (!this.files[0]) return;
        _carouselReadFile(this.files[0], dataUrl => {
          carouselState.slides[i].image = dataUrl;
          const preview = document.getElementById(`cslide-img-preview-${i}`);
          if (preview) { preview.src = dataUrl; preview.classList.add('visible'); }
          // re-render editor to update Remove button
          carouselRenderEditor();
          carouselUpdatePreview();
        });
      });
    }
  });
}

function _escAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _escContent(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _carouselSlideItemHTML(slide, i) {
  const label = slide.type === 'title'
    ? `🖼 ${_esc(slide.heading || 'Title slide')}`
    : `📋 ${_esc(slide.heading || `Slide ${i}`)}`;

  const fields = slide.type === 'title'
    ? `<div class="carousel-field">
         <label class="carousel-field-label">Heading</label>
         <input type="text" value="${_escAttr(slide.heading)}" oninput="carouselUpdateField(${i},'heading',this.value)">
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Subheading</label>
         <input type="text" value="${_escAttr(slide.subheading || '')}" oninput="carouselUpdateField(${i},'subheading',this.value)">
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Tag badge (optional)</label>
         <input type="text" value="${_escAttr(slide.tag || '')}" oninput="carouselUpdateField(${i},'tag',this.value)">
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Username</label>
         <input type="text" value="${_escAttr(slide.username || '')}" oninput="carouselUpdateField(${i},'username',this.value)">
       </div>`
    : `<div class="carousel-field">
         <label class="carousel-field-label">Slide number label</label>
         <input type="text" value="${_escAttr(slide.number || '')}" oninput="carouselUpdateField(${i},'number',this.value)">
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Heading</label>
         <input type="text" value="${_escAttr(slide.heading || '')}" oninput="carouselUpdateField(${i},'heading',this.value)">
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Description</label>
         <textarea oninput="carouselUpdateField(${i},'description',this.value)">${_escContent(slide.description || '')}</textarea>
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Highlighted phrase (optional)</label>
         <input type="text" value="${_escAttr(slide.highlight || '')}" oninput="carouselUpdateField(${i},'highlight',this.value)">
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Slide image (optional)</label>
         <input type="file" id="cslide-img-input-${i}" accept="image/*" style="display:none">
         <div class="carousel-img-btns">
           <button class="carousel-img-btn" onclick="document.getElementById('cslide-img-input-${i}').click()">${slide.image ? 'Replace image' : 'Upload image'}</button>
           ${slide.image ? `<button class="carousel-img-btn danger" onclick="carouselRemoveSlideImage(${i})">Remove</button>` : ''}
         </div>
         <img id="cslide-img-preview-${i}" class="carousel-img-preview${slide.image ? ' visible' : ''}" src="${slide.image || ''}" alt="">
       </div>
       <button class="carousel-delete-slide-btn" onclick="carouselDeleteSlide(${i})">Delete slide</button>`;

  return `<div class="carousel-slide-item" id="cslide-item-${i}">
  <div class="carousel-slide-item-header" onclick="carouselToggleSlideItem(${i})">
    <div class="carousel-slide-item-title">
      <span class="carousel-slide-num">${i + 1}</span>
      <span>${label}</span>
    </div>
    <span class="carousel-slide-item-chevron">▾</span>
  </div>
  <div class="carousel-slide-item-body">${fields}</div>
</div>`;
}

function carouselToggleSlideItem(i) {
  const item = document.getElementById(`cslide-item-${i}`);
  if (item) item.classList.toggle('open');
}

function carouselUpdateField(i, key, value) {
  if (!carouselState.slides[i]) return;
  carouselState.slides[i][key] = value;
  carouselUpdatePreview();
  if (i === 0 && key === 'username') carouselSaveTemplate();
}

function carouselRemoveSlideImage(i) {
  if (!carouselState.slides[i]) return;
  carouselState.slides[i].image = null;
  carouselRenderEditor();
  carouselUpdatePreview();
}

function carouselDeleteSlide(i) {
  if (carouselState.slides.length <= 1) return;
  carouselState.slides.splice(i, 1);
  if (carouselState.currentSlide >= carouselState.slides.length) {
    carouselState.currentSlide = carouselState.slides.length - 1;
  }
  carouselRenderEditor();
  carouselUpdatePreview();
}

function carouselAddSlide() {
  const contentCount = carouselState.slides.filter(s => s.type === 'content').length;
  carouselState.slides.push({
    type: 'content',
    number: String(contentCount + 1).padStart(2, '0'),
    heading: 'New slide',
    description: 'Add your content here.',
    highlight: '',
    image: null,
  });
  carouselRenderEditor();
  carouselUpdatePreview();
  // open the new slide item
  setTimeout(() => carouselToggleSlideItem(carouselState.slides.length - 1), 50);
}

// ─── Template persistence ─────────────────────────────────────────────────────

function carouselSaveTemplate() {
  try {
    const username = (carouselState.slides[0] && carouselState.slides[0].username) || '@yourhandle';
    localStorage.setItem(CAROUSEL_TEMPLATE_KEY, JSON.stringify({
      accentColor: carouselState.accentColor,
      bgColor: carouselState.bgColor,
      slideStyle: carouselState.slideStyle,
      logoText: carouselState.logoText,
      websiteUrl: carouselState.websiteUrl,
      avatarImage: carouselState.avatarImage,
      username,
    }));
  } catch (e) {}
}

function carouselLoadTemplate() {
  try {
    const raw = localStorage.getItem(CAROUSEL_TEMPLATE_KEY);
    if (!raw) return;
    const t = JSON.parse(raw);
    if (t.accentColor) {
      carouselState.accentColor = t.accentColor;
      const picker = document.getElementById('carousel-accent-picker');
      const hex = document.getElementById('carousel-accent-hex');
      if (picker) picker.value = t.accentColor;
      if (hex) hex.textContent = t.accentColor;
    }
    if (t.bgColor) {
      carouselState.bgColor = t.bgColor;
      const picker = document.getElementById('carousel-bg-picker');
      const hex = document.getElementById('carousel-bg-hex');
      if (picker) picker.value = t.bgColor;
      if (hex) hex.textContent = t.bgColor;
    }
    if (t.slideStyle) {
      carouselState.slideStyle = t.slideStyle;
      document.querySelectorAll('.carousel-style-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.style === t.slideStyle);
      });
      const bgSection = document.getElementById('carousel-bg-section');
      if (bgSection) bgSection.style.display = t.slideStyle === 'dark' ? 'block' : 'none';
    }
    if (t.logoText !== undefined) {
      carouselState.logoText = t.logoText;
      const el = document.getElementById('carousel-logo-text');
      if (el) el.value = t.logoText;
    }
    if (t.websiteUrl !== undefined) {
      carouselState.websiteUrl = t.websiteUrl;
      const el = document.getElementById('carousel-website-url');
      if (el) el.value = t.websiteUrl;
    }
    if (t.avatarImage) carouselState.avatarImage = t.avatarImage;
    if (t.username && carouselState.slides[0]) {
      carouselState.slides[0].username = t.username;
    }
  } catch (e) {}
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function carouselSetStyle(style) {
  carouselState.slideStyle = style;
  document.querySelectorAll('.carousel-style-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.style === style);
  });
  // Show/hide bg presets (only relevant for dark style)
  const bgSection = document.getElementById('carousel-bg-section');
  if (bgSection) bgSection.style.display = style === 'dark' ? 'block' : 'none';
  carouselUpdatePreview();
  _carouselUpdateSettingsPreview();
  carouselSaveTemplate();
}

function carouselSetLogoText(val) {
  carouselState.logoText = val;
  carouselUpdatePreview();
  carouselSaveTemplate();
}

function carouselSetWebsiteUrl(val) {
  carouselState.websiteUrl = val;
  carouselUpdatePreview();
  carouselSaveTemplate();
}

function _carouselBuildColorPresets() {
  const accentContainer = document.getElementById('carousel-accent-presets');
  const bgContainer = document.getElementById('carousel-bg-presets');

  if (accentContainer) {
    accentContainer.innerHTML = CAROUSEL_ACCENT_PRESETS.map(color =>
      `<div class="carousel-color-swatch${color === carouselState.accentColor ? ' active' : ''}"
            style="background:${color};"
            onclick="carouselSetAccent('${color}',true)"
            title="${color}"></div>`
    ).join('');
  }

  if (bgContainer) {
    bgContainer.innerHTML = CAROUSEL_BG_PRESETS.map(color =>
      `<div class="carousel-color-swatch${color === carouselState.bgColor ? ' active' : ''}"
            style="background:${color};border:1px solid rgba(255,255,255,0.15);"
            onclick="carouselSetBg('${color}',true)"
            title="${color}"></div>`
    ).join('');
  }
}

function carouselSetAccent(color, fromPreset) {
  carouselState.accentColor = color;
  const picker = document.getElementById('carousel-accent-picker');
  const hex = document.getElementById('carousel-accent-hex');
  if (picker) picker.value = color;
  if (hex) hex.textContent = color;
  if (fromPreset) _carouselBuildColorPresets();
  carouselUpdatePreview();
  carouselSaveTemplate();
}

function carouselSetBg(color, fromPreset) {
  carouselState.bgColor = color;
  const picker = document.getElementById('carousel-bg-picker');
  const hex = document.getElementById('carousel-bg-hex');
  if (picker) picker.value = color;
  if (hex) hex.textContent = color;
  if (fromPreset) _carouselBuildColorPresets();
  carouselUpdatePreview();
  carouselSaveTemplate();
}

// ─── Template import / export ─────────────────────────────────────────────────

function carouselExportTemplate() {
  const template = {
    version: 1,
    accentColor: carouselState.accentColor,
    bgColor: carouselState.bgColor,
    slideStyle: carouselState.slideStyle,
    logoText: carouselState.logoText,
    websiteUrl: carouselState.websiteUrl,
    slides: carouselState.slides.map(s => {
      const copy = { ...s };
      copy.image = null; // strip binary image data from export
      return copy;
    }),
  };
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'carousel-template.json';
  a.click();
  URL.revokeObjectURL(url);
}

function carouselImportTemplate() {
  document.getElementById('carousel-template-input').click();
}

function carouselHandleTemplateUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const template = JSON.parse(e.target.result);
      if (!Array.isArray(template.slides)) throw new Error('Invalid template — missing slides array');
      carouselState.slides = template.slides;
      carouselState.currentSlide = 0;
      if (template.accentColor) carouselSetAccent(template.accentColor, false);
      if (template.bgColor) carouselSetBg(template.bgColor, false);
      if (template.slideStyle) carouselSetStyle(template.slideStyle);
      if (template.logoText !== undefined) {
        carouselState.logoText = template.logoText;
        const logoInput = document.getElementById('carousel-logo-text');
        if (logoInput) logoInput.value = template.logoText;
      }
      if (template.websiteUrl !== undefined) {
        carouselState.websiteUrl = template.websiteUrl;
        const siteInput = document.getElementById('carousel-website-url');
        if (siteInput) siteInput.value = template.websiteUrl;
      }
      carouselUpdatePreview();
      carouselRenderEditor();
      carouselSwitchTab('preview');
      carouselSaveTemplate();
    } catch (err) {
      alert('Invalid template: ' + err.message);
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function carouselReset() {
  if (!confirm('Reset to default content? This will clear all slides, images, and saved brand settings.')) return;
  localStorage.removeItem(CAROUSEL_TEMPLATE_KEY);
  carouselState.slides = getDefaultCarouselSlides();
  carouselState.currentSlide = 0;
  carouselState.coverImage = null;
  carouselState.avatarImage = null;
  carouselState.accentColor = '#39FF14';
  carouselState.bgColor = '#0a0a0a';
  carouselState.slideStyle = 'dark';
  carouselState.logoText = 'BRAND.';
  carouselState.websiteUrl = '';
  const logoInput = document.getElementById('carousel-logo-text');
  if (logoInput) logoInput.value = 'BRAND.';
  const siteInput = document.getElementById('carousel-website-url');
  if (siteInput) siteInput.value = '';
  carouselSetStyle('dark');
  carouselUpdatePreview();
  carouselRenderEditor();
  _carouselBuildColorPresets();
}
