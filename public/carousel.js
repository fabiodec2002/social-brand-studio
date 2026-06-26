// ─── Instagram Carousel Builder ──────────────────────────────────────────────
// Canvas: 540×675px preview (4:5 ratio) → html2canvas scale:2 → 1080×1350px export
// Safe zone: 40px left/right, 40px top, 100px bottom (= 80/80/200px at export)
// Fonts: Poppins (headlines 700/800) + Open Sans (body 400) → 28px+ body at export

const CAROUSEL_ACCENT_PRESETS = ['#39FF14','#ffffff','#c9a96e','#c13584','#0d3b8c','#ff6b35','#a855f7','#ef4444'];
const CAROUSEL_BG_PRESETS = ['#0a0a0a','#141413','#0f0f0f','#1a1a1a','#0d0d14','#14140a','#0a0d14','#140a0a'];
const CAROUSEL_TEMPLATE_KEY = 'carousel_template_v1';
const CAROUSEL_AVATAR_KEY = 'carousel_avatar_v1';
const SLIDE_W = 540;
const SLIDE_H = 675;
const SLIDE_FONT = "'Poppins','Open Sans',sans-serif";

// Named themes — selecting one sets accentColor, bgColor, slideStyle
const CAROUSEL_THEMES = [
  { id: 'dark',   name: 'Dark',   bg: '#0a0a0a', accent: '#39FF14', slideStyle: 'dark' },
  { id: 'light',  name: 'Light',  bg: '#ffffff', accent: '#0d3b8c', slideStyle: 'light' },
  { id: 'navy',   name: 'Navy',   bg: '#0d1b2a', accent: '#4fc3f7', slideStyle: 'dark' },
  { id: 'forest', name: 'Forest', bg: '#0f1f15', accent: '#81c784', slideStyle: 'dark' },
  { id: 'rose',   name: 'Rose',   bg: '#fdf2f4', accent: '#d4647a', slideStyle: 'light' },
  { id: 'sand',     name: 'Sand',     bg: '#f5efe6', accent: '#a0785a', slideStyle: 'light' },
  { id: 'electric', name: 'Electric', bg: '#1a0533', accent: '#a855f7', slideStyle: 'dark' },
];

// Named full-carousel presets — each loads a complete set of slides + settings
const CAROUSEL_PRESETS = [
  {
    id: 'dark-oracle',
    name: 'Dark Oracle',
    description: 'Luxury dark · gold',
    settings: { accentColor: '#c9a96e', bgColor: '#0c0c0c', slideStyle: 'dark', theme: 'dark', logoText: 'BRAND.' },
    slides: [
      { type: 'title', heading: 'The thing nobody tells you', subheading: "Until it's too late.", tag: 'INSIGHT', username: '@yourhandle' },
      { type: 'content', number: '01', heading: 'Most people wait for permission', description: "They wait for someone to validate their idea, tell them it's good enough. Permission never comes.", highlight: 'Start before you\'re ready.' },
      { type: 'content', number: '02', heading: 'The cost of waiting', description: 'Every day you wait is a day someone else builds the thing you were supposed to build.', highlight: 'Action beats perfection.' },
      { type: 'stat', number: '92%', label: 'of ideas die waiting', context: "They never leave the note app. Don't let yours be one of them." },
      { type: 'cta', heading: 'Save this for later.', subtext: 'Send it to someone who needs to hear this.', action: 'Follow @yourhandle for daily insights.' },
    ],
  },
  {
    id: 'clean-founder',
    name: 'Clean Founder',
    description: 'Minimal white · black',
    settings: { accentColor: '#111111', bgColor: '#ffffff', slideStyle: 'light', theme: 'light', logoText: 'FOUNDER.' },
    slides: [
      { type: 'title', heading: '5 things I wish I knew', subheading: 'Before starting my business.', tag: '', username: '@yourname' },
      { type: 'content', number: '01', heading: 'Revenue ≠ profit', description: 'You can make a million and lose it all to overhead. Understand your margins from day one.', highlight: 'Know your numbers.' },
      { type: 'content', number: '02', heading: 'Your network is your net worth', description: 'The right introduction changes everything. Build relationships before you need them.', highlight: 'Invest in people.' },
      { type: 'content', number: '03', heading: 'Done beats perfect', description: 'Shipping something imperfect and iterating is always better than waiting for the perfect version.', highlight: 'Ship and improve.' },
      { type: 'cta', heading: 'Which hit closest?', subtext: 'Drop it in the comments.', action: 'Follow for more founder lessons.' },
    ],
  },
  {
    id: 'magazine-edit',
    name: 'Magazine Edit',
    description: 'Editorial · rose',
    settings: { accentColor: '#d4647a', bgColor: '#fdf2f4', slideStyle: 'light', theme: 'rose', logoText: 'EDIT.' },
    slides: [
      { type: 'title', heading: 'The truth about burnout', subheading: 'No one talks about this part.', tag: '', username: '@yourname' },
      { type: 'quote', text: "Burnout isn't about working too much. It's about working on the wrong things for too long.", attribution: '' },
      { type: 'content', number: '01', heading: 'It sneaks up on you', description: "You don't notice burnout happening. You just stop caring — about the work, the outcomes, yourself.", highlight: 'Awareness is the first step.' },
      { type: 'content', number: '02', heading: 'Recovery takes longer than you think', description: "A weekend off doesn't fix months of depletion. Real recovery means changing the conditions that caused it.", highlight: 'Rest is not a reward.' },
      { type: 'cta', heading: 'Save for the moment you need it.', subtext: 'Share with someone who needs this.', action: 'Follow for more honest conversations.' },
    ],
  },
  {
    id: 'navy-brief',
    name: 'Navy Brief',
    description: 'Corporate authority · sky',
    settings: { accentColor: '#4fc3f7', bgColor: '#0d1b2a', slideStyle: 'dark', theme: 'navy', logoText: 'BRIEF.' },
    slides: [
      { type: 'title', heading: 'How top performers think differently', subheading: 'A 5-point framework.', tag: 'FRAMEWORK', username: '@yourhandle' },
      { type: 'stat', number: '10×', label: 'output gap', context: 'Between average and elite performers — not from talent, but from how they structure their thinking.' },
      { type: 'content', number: '01', heading: 'They work on the right problems', description: "High performers don't work harder — they work on higher-leverage problems. The 20% that drives 80% of results.", highlight: 'Leverage, not effort.' },
      { type: 'content', number: '02', heading: 'They say no more than yes', description: 'Every yes to something good is a no to something great. Ruthless prioritization creates space for excellence.', highlight: 'Protect your time ruthlessly.' },
      { type: 'cta', heading: 'Forward this to your team.', subtext: 'These frameworks work.', action: 'Follow @yourhandle for weekly strategy frameworks.' },
    ],
  },
  {
    id: 'warm-story',
    name: 'Warm Story',
    description: 'Coaching · warm earth',
    settings: { accentColor: '#c2714f', bgColor: '#f5efe6', slideStyle: 'light', theme: 'sand', logoText: 'STORY.' },
    slides: [
      { type: 'title', heading: 'A year ago I was exhausted', subheading: "Here's what changed everything.", tag: '', username: '@yourname' },
      { type: 'quote', text: "You don't need more motivation. You need a better system.", attribution: '' },
      { type: 'checklist', heading: 'What I changed', items: ['Set 3 non-negotiables each morning', 'Blocked 2 hours of deep work before 10am', 'Said no to 80% of requests', 'Reviewed my priorities every Sunday'] },
      { type: 'content', number: '01', heading: 'The result?', description: 'Less hustle, more output. More peace, better work. It was a system built around my energy.', highlight: 'Structure creates freedom.' },
      { type: 'cta', heading: 'Save this if you needed it.', subtext: "Share with someone who's running on empty.", action: 'Follow for more real conversations.' },
    ],
  },
  {
    id: 'bold-framework',
    name: 'Bold Framework',
    description: 'How-to · orange',
    settings: { accentColor: '#ff6b35', bgColor: '#ffffff', slideStyle: 'light', theme: 'light', logoText: 'METHOD.' },
    slides: [
      { type: 'title', heading: 'Write better content in 3 steps', subheading: 'The exact framework I use daily.', tag: 'FRAMEWORK', username: '@yourhandle' },
      { type: 'content', number: '01', heading: 'Start with the insight, not the topic', description: "Don't write about \"marketing.\" Write about the one counterintuitive thing you believe that others don't.", highlight: 'Specific beats generic.' },
      { type: 'content', number: '02', heading: 'Write the ending first', description: 'What do you want them to feel or do after reading? Write that last line first. Let it guide everything else.', highlight: 'Work backwards.' },
      { type: 'content', number: '03', heading: 'Cut the first paragraph', description: 'Your real opening is almost never your first paragraph. Delete it and see if the next one is stronger. It usually is.', highlight: 'When in doubt, cut.' },
      { type: 'cta', heading: 'Save this for your next writing session.', subtext: 'Tag someone who needs this framework.', action: 'Follow @yourhandle for more writing frameworks.' },
    ],
  },
  {
    id: 'emerald-authority',
    name: 'Emerald Auth.',
    description: 'Premium dark · sage',
    settings: { accentColor: '#7ba05b', bgColor: '#0f1f15', slideStyle: 'dark', theme: 'forest', logoText: 'AUTHORITY.' },
    slides: [
      { type: 'title', heading: 'Why most strategies fail', subheading: "And how to build one that doesn't.", tag: 'STRATEGY', username: '@yourhandle' },
      { type: 'content', number: '01', heading: "They're built on assumptions", description: "Most strategies are based on what the team wants to be true, not what's actually happening in the market.", highlight: 'Test before you scale.' },
      { type: 'stat', number: '67%', label: 'strategies fail', context: "Not because they're bad ideas — because they were never validated against real customer behavior." },
      { type: 'content', number: '02', heading: 'Build feedback loops early', description: 'Successful strategies are designed to be wrong and corrected quickly. Measure from the start, not as an afterthought.', highlight: 'Measure to improve.' },
      { type: 'cta', heading: 'Save this to your strategy folder.', subtext: 'Share with your team.', action: 'Follow @yourhandle for weekly strategy insights.' },
    ],
  },
  {
    id: 'neon-signal',
    name: 'Neon Signal',
    description: 'High-energy · neon',
    settings: { accentColor: '#39FF14', bgColor: '#0a0a0a', slideStyle: 'dark', theme: 'dark', logoText: 'SIGNAL.' },
    slides: [
      { type: 'title', heading: 'Hard truth about growth', subheading: "Most people don't want to hear this.", tag: 'GROWTH', username: '@yourhandle' },
      { type: 'content', number: '01', heading: 'Consistency is boring and essential', description: 'Not one viral post. Not one big launch. Daily, boring, consistent effort compounded over time. That\'s the game.', highlight: 'Boring wins.' },
      { type: 'content', number: '02', heading: 'Your biggest competitor is distraction', description: 'You have the ideas. You have the skills. What kills most creators is the inability to focus long enough to execute.', highlight: 'Focus is the skill.' },
      { type: 'stat', number: '18mo', label: 'to real traction', context: "Most creators quit at month 3. The ones who make it are the ones who stayed." },
      { type: 'cta', heading: 'Save this for the hard days.', subtext: 'Send to a creator friend who needs it.', action: 'Follow @yourhandle for real growth talk.' },
    ],
  },
];

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
  theme: 'dark',        // id from CAROUSEL_THEMES
  logoText: 'BRAND.',
  websiteUrl: '',
  initialized: false,
};

function getDefaultCarouselSlides() {
  return [
    {
      type: 'title',
      heading: 'Stop doing this.',
      subheading: "It's killing your reach.",
      tag: 'CONTENT',
      username: '@yourhandle',
    },
    {
      type: 'content',
      number: '01',
      heading: 'The mistake most creators make',
      description: 'Posting without a strategy. One great post per week beats seven generic ones.',
      highlight: 'Consistency matters more than frequency.',
      image: null,
    },
    {
      type: 'content',
      number: '02',
      heading: 'What actually works',
      description: 'Lead with a hook, deliver one clear insight per slide, and save the CTA for the end.',
      highlight: 'One idea per slide. No exceptions.',
      image: null,
    },
    {
      type: 'stat',
      number: '3×',
      label: 'more saves',
      context: 'Carousels get 3× more saves than single-image posts — the algorithm rewards depth.',
    },
    {
      type: 'cta',
      heading: 'Save this for later.',
      subtext: 'Send it to someone who needs it.',
      action: 'Follow @yourhandle for more daily insights.',
    },
  ];
}

// ─── Initialization ───────────────────────────────────────────────────────────

function carouselInit() {
  if (carouselState.initialized) return;
  carouselState.initialized = true;
  _carouselLoadHtml2Canvas();
  carouselLoadTemplate();
  carouselLoadAvatar();
  _carouselBuildColorPresets();
  carouselBuildThemeSelector();
  carouselBuildPresetGrid();
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

function _escMultiline(str) {
  return _esc(str).replace(/\n/g, '<br>');
}

function _carouselBuildSlideHTML(slide, idx) {
  const total = carouselState.slides.length;
  const style = carouselState.slideStyle;

  // Layout types (work in both styles)
  if (slide.type === 'quote')     return _carouselBuildQuoteHTML(slide, style);
  if (slide.type === 'stat')      return _carouselBuildStatHTML(slide, style);
  if (slide.type === 'split')     return _carouselBuildSplitHTML(slide);
  if (slide.type === 'checklist') return _carouselBuildChecklistHTML(slide);

  if (style === 'light') {
    if (slide.type === 'title') return _carouselBuildLightTitleHTML(slide);
    if (slide.type === 'cta')   return _carouselBuildLightCtaHTML(slide);
    return _carouselBuildLightContentHTML(slide, idx, total);
  }
  if (slide.type === 'title') return _carouselBuildTitleHTML(slide);
  if (slide.type === 'cta')   return _carouselBuildDarkCtaHTML(slide);
  return _carouselBuildContentHTML(slide, idx, total);
}

// ─── Quote slide ──────────────────────────────────────────────────────────────

function _carouselBuildQuoteHTML(slide) {
  const { accentColor, bgColor, slideStyle, logoText, avatarImage, websiteUrl } = carouselState;
  const isLight = slideStyle === 'light';
  const bg = isLight ? (bgColor === '#0a0a0a' ? '#ffffff' : bgColor) : bgColor;
  const textColor = isLight ? '#111111' : '#ffffff';
  const subColor = isLight ? '#666666' : 'rgba(255,255,255,0.6)';
  const logo = logoText || 'BRAND.';
  const site = websiteUrl || '';
  const username = (carouselState.slides[0]?.username) || '@yourhandle';

  const attributionHtml = slide.attribution
    ? `<div style="font-size:13px;color:${subColor};margin-top:18px;font-style:normal;letter-spacing:0.04em;">${_esc(slide.attribution)}</div>`
    : '';

  const siteHtml = site
    ? `<div style="position:absolute;bottom:28px;left:40px;font-size:11px;color:${subColor};font-style:italic;">${_esc(site)}</div>`
    : '';

  const avatarSrc = avatarImage
    ? `<div style="width:26px;height:26px;border-radius:50%;background-image:url(${avatarImage});background-size:cover;background-position:center center;background-repeat:no-repeat;border:1.5px solid rgba(255,255,255,0.25);flex-shrink:0;"></div>`
    : `<div style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.2);flex-shrink:0;"></div>`;

  return `<div style="width:${SLIDE_W}px;height:${SLIDE_H}px;background:${bg};position:relative;overflow:hidden;font-family:${SLIDE_FONT};">
  <div style="position:absolute;top:22px;right:28px;font-size:14px;font-weight:900;color:${accentColor};letter-spacing:-0.3px;">${_esc(logo)}</div>
  <div style="position:absolute;left:40px;right:40px;top:50%;transform:translateY(-54%);text-align:center;">
    <div style="width:48px;height:3px;background:${accentColor};margin:0 auto 32px;"></div>
    <div style="font-size:26px;font-weight:700;color:${textColor};line-height:1.35;letter-spacing:-0.4px;font-style:italic;">"${_esc(slide.text || '')}"</div>
    ${attributionHtml}
    <div style="width:48px;height:3px;background:${accentColor};margin:28px auto 0;"></div>
  </div>
  <div style="position:absolute;bottom:28px;right:28px;display:flex;align-items:center;gap:6px;">${isLight ? '' : avatarSrc}<span style="font-size:11px;color:${subColor};">${_esc(username)}</span></div>
  ${siteHtml}
</div>`;
}

// ─── Stat slide ───────────────────────────────────────────────────────────────

function _carouselBuildStatHTML(slide) {
  const { accentColor, bgColor, slideStyle, logoText, websiteUrl } = carouselState;
  const isLight = slideStyle === 'light';
  const bg = isLight ? (bgColor === '#0a0a0a' ? '#ffffff' : bgColor) : bgColor;
  const textColor = isLight ? '#111111' : '#ffffff';
  const subColor = isLight ? '#555555' : 'rgba(255,255,255,0.6)';
  const logo = logoText || 'BRAND.';
  const site = websiteUrl || '';
  const username = (carouselState.slides[0]?.username) || '@yourhandle';

  const siteHtml = site
    ? `<div style="position:absolute;bottom:28px;left:40px;font-size:11px;color:${subColor};font-style:italic;">${_esc(site)}</div>`
    : '';

  return `<div style="width:${SLIDE_W}px;height:${SLIDE_H}px;background:${bg};position:relative;overflow:hidden;font-family:${SLIDE_FONT};">
  <div style="position:absolute;top:22px;right:28px;font-size:14px;font-weight:900;color:${accentColor};letter-spacing:-0.3px;">${_esc(logo)}</div>
  <div style="position:absolute;left:40px;right:40px;top:50%;transform:translateY(-54%);text-align:center;">
    <div style="font-size:88px;font-weight:900;color:${textColor};line-height:1;letter-spacing:-3px;margin-bottom:4px;">${_esc(slide.number || '0')}</div>
    <div style="width:64px;height:4px;background:${accentColor};margin:0 auto 16px;border-radius:2px;"></div>
    <div style="font-size:18px;font-weight:700;color:${accentColor};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">${_esc(slide.label || '')}</div>
    ${slide.context ? `<div style="font-size:13px;color:${subColor};line-height:1.6;max-width:340px;margin:0 auto;">${_escMultiline(slide.context)}</div>` : ''}
  </div>
  <div style="position:absolute;bottom:28px;right:28px;font-size:11px;color:${subColor};">${_esc(username)}</div>
  ${siteHtml}
</div>`;
}

// ─── Split layout slide ───────────────────────────────────────────────────────

function _carouselBuildSplitHTML(slide) {
  const { accentColor, bgColor, slideStyle, logoText, websiteUrl } = carouselState;
  const isLight = slideStyle === 'light';
  const textBg = isLight ? (bgColor === '#0a0a0a' ? '#ffffff' : bgColor) : bgColor;
  const textColor = isLight ? '#111111' : '#ffffff';
  const subColor = isLight ? '#555555' : 'rgba(255,255,255,0.65)';
  const logo = logoText || 'BRAND.';
  const site = websiteUrl || '';
  const halfW = Math.floor(SLIDE_W / 2); // 270px each half

  const watermarkHtml = slide.number
    ? `<div style="position:absolute;bottom:-16px;right:-10px;font-size:150px;font-weight:900;color:rgba(0,0,0,0.1);line-height:1;pointer-events:none;user-select:none;">${_esc(slide.number)}</div>`
    : '';

  const highlightHtml = slide.highlight
    ? `<div style="font-size:12px;color:${accentColor};font-weight:700;margin-top:14px;padding-top:12px;border-top:1.5px solid ${accentColor}44;line-height:1.5;letter-spacing:0.02em;">${_esc(slide.highlight)}</div>`
    : '';

  const siteHtml = site
    ? `<div style="position:absolute;bottom:20px;left:12px;font-size:10px;color:${subColor};font-style:italic;">${_esc(site)}</div>`
    : '';

  return `<div style="width:${SLIDE_W}px;height:${SLIDE_H}px;position:relative;overflow:hidden;font-family:${SLIDE_FONT};display:flex;">
  <div style="width:${halfW}px;min-width:${halfW}px;height:${SLIDE_H}px;background:${accentColor};position:relative;overflow:hidden;">
    ${watermarkHtml}
    <div style="position:absolute;top:20px;left:14px;font-size:11px;font-weight:900;color:rgba(0,0,0,0.3);letter-spacing:0.06em;">${_esc(logo)}</div>
  </div>
  <div style="width:${halfW}px;min-width:${halfW}px;height:${SLIDE_H}px;background:${textBg};position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:40px 28px 40px 24px;box-sizing:border-box;">
    <div style="font-size:21px;font-weight:800;color:${textColor};line-height:1.25;letter-spacing:-0.4px;margin-bottom:12px;">${_esc(slide.heading || '')}</div>
    <div style="font-size:13px;color:${subColor};line-height:1.65;">${_escMultiline(slide.description || '')}</div>
    ${highlightHtml}
    ${siteHtml}
  </div>
</div>`;
}

// ─── Checklist slide ──────────────────────────────────────────────────────────

function _carouselBuildChecklistHTML(slide) {
  const { accentColor, bgColor, slideStyle, logoText, websiteUrl } = carouselState;
  const isLight = slideStyle === 'light';
  const bg = isLight ? (bgColor === '#0a0a0a' ? '#ffffff' : bgColor) : bgColor;
  const textColor = isLight ? '#111111' : '#ffffff';
  const subColor = isLight ? '#555555' : 'rgba(255,255,255,0.65)';
  const dividerColor = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)';
  const logo = logoText || 'BRAND.';
  const site = websiteUrl || '';
  const items = Array.isArray(slide.items) ? slide.items.slice(0, 5) : [];
  const username = (carouselState.slides[0]?.username) || '@yourhandle';

  const itemsHtml = items.map(item =>
    `<div style="display:flex;align-items:flex-start;gap:12px;padding:11px 0;border-bottom:1px solid ${dividerColor};">
      <div style="width:14px;height:14px;min-width:14px;background:${accentColor};border-radius:2px;margin-top:2px;flex-shrink:0;"></div>
      <div style="font-size:14px;color:${textColor};line-height:1.5;font-weight:500;">${_esc(item)}</div>
    </div>`
  ).join('');

  const siteHtml = site
    ? `<div style="position:absolute;bottom:28px;left:40px;font-size:11px;color:${subColor};font-style:italic;">${_esc(site)}</div>`
    : '';

  return `<div style="width:${SLIDE_W}px;height:${SLIDE_H}px;background:${bg};position:relative;overflow:hidden;font-family:${SLIDE_FONT};">
  <div style="position:absolute;top:22px;right:28px;font-size:14px;font-weight:900;color:${accentColor};letter-spacing:-0.3px;">${_esc(logo)}</div>
  <div style="position:absolute;left:40px;right:40px;top:72px;bottom:80px;display:flex;flex-direction:column;justify-content:center;">
    <div style="font-size:22px;font-weight:800;color:${textColor};line-height:1.25;letter-spacing:-0.3px;margin-bottom:18px;">${_esc(slide.heading || '')}</div>
    <div style="border-top:1px solid ${dividerColor};">
      ${itemsHtml}
    </div>
  </div>
  <div style="position:absolute;bottom:28px;right:28px;font-size:11px;color:${subColor};">${_esc(username)}</div>
  ${siteHtml}
</div>`;
}

// ─── Light / Brand Card style ─────────────────────────────────────────────────

function _carouselBuildLightTitleHTML(slide) {
  const { accentColor, logoText, websiteUrl, avatarImage } = carouselState;
  const logo = logoText || 'BRAND.';
  const site = websiteUrl || '';

  const avatarHtml = avatarImage
    ? `<div style="width:38px;height:38px;border-radius:50%;background-image:url(${avatarImage});background-size:cover;background-position:center center;background-repeat:no-repeat;border:2px solid ${accentColor};flex-shrink:0;"></div>`
    : `<div style="width:38px;height:38px;border-radius:50%;background:#e8e8e8;border:2px solid ${accentColor};flex-shrink:0;"></div>`;

  const username = slide.username ? slide.username.replace(/^@/, '') : 'Your Name';

  const headingHtml = slide.heading
    ? `<div style="font-size:32px;font-weight:300;color:#000;line-height:1.15;letter-spacing:-0.5px;margin-bottom:10px;">${_esc(slide.heading)}</div>`
    : '';
  const subHtml = slide.subheading
    ? `<div style="display:inline-block;background:${accentColor};color:#fff;font-size:26px;font-weight:700;padding:5px 12px;border-radius:4px;line-height:1.2;letter-spacing:-0.3px;">${_esc(slide.subheading)}</div>`
    : '';

  const siteHtml = site
    ? `<div style="position:absolute;bottom:80px;left:40px;font-size:12px;color:#555;font-style:italic;letter-spacing:0.02em;">${_esc(site)}</div>`
    : '';

  return `<div style="width:${SLIDE_W}px;height:${SLIDE_H}px;background:#fff;position:relative;overflow:hidden;font-family:${SLIDE_FONT};">
  <div style="position:absolute;top:24px;right:28px;font-size:18px;font-weight:900;color:${accentColor};letter-spacing:-0.5px;">${_esc(logo)}</div>
  <div style="position:absolute;top:68px;left:0;right:0;height:3px;background:${accentColor};"></div>
  <div style="position:absolute;top:62px;left:20px;width:5px;height:16px;background:${accentColor};"></div>
  <div style="position:absolute;left:40px;right:40px;top:130px;">
    ${headingHtml}
    ${subHtml}
  </div>
  <div style="position:absolute;left:40px;bottom:120px;display:flex;align-items:center;gap:10px;right:40px;">
    ${avatarHtml}
    <div style="background:#f0f0f0;padding:6px 14px;border-radius:20px;font-size:13px;color:#222;white-space:nowrap;">${_esc(username)}</div>
    <div style="flex:1;height:3px;background:${accentColor};margin-left:4px;"></div>
  </div>
  ${siteHtml}
</div>`;
}

function _carouselBuildLightContentHTML(slide, idx, total) {
  const { accentColor, logoText, websiteUrl } = carouselState;
  const logo = logoText || 'BRAND.';
  const site = websiteUrl || '';
  const counter = String(idx + 1).padStart(2, '0');

  const segW = Math.floor(SLIDE_W / total);
  const progressHtml = Array.from({ length: total }, (_, i) => {
    const filled = i < idx + 1;
    const bg = filled ? accentColor : `${accentColor}33`;
    return `<div style="width:${segW}px;height:100%;background:${bg};"></div>`;
  }).join('');

  const headingHtml = slide.heading
    ? `<div style="font-size:20px;font-weight:600;color:#111;line-height:1.3;margin-bottom:14px;">${_esc(slide.heading)}</div>`
    : '';

  const highlightHtml = slide.highlight
    ? `<div style="background:${accentColor};color:#fff;font-size:17px;font-weight:700;line-height:1.35;padding:10px 14px;border-radius:4px;margin-bottom:14px;">${_esc(slide.highlight)}</div>`
    : '';

  const descHtml = slide.description
    ? `<div style="font-size:14px;font-weight:400;color:#333;line-height:1.6;">${_escMultiline(slide.description)}</div>`
    : '';

  const siteHtml = site
    ? `<div style="position:absolute;bottom:28px;left:50px;font-size:12px;color:#777;font-style:italic;">${_esc(site)}</div>`
    : '';

  return `<div style="width:${SLIDE_W}px;height:${SLIDE_H}px;background:#fff;position:relative;overflow:hidden;font-family:${SLIDE_FONT};">
  <div style="position:absolute;top:22px;right:28px;font-size:16px;font-weight:900;color:${accentColor};letter-spacing:-0.5px;">${_esc(logo)}</div>
  <div style="position:absolute;top:63px;left:0;right:0;height:3px;background:${accentColor};"></div>
  <div style="position:absolute;top:54px;right:24px;font-size:12px;font-weight:700;color:${accentColor};letter-spacing:0.12em;">─ ${counter} ─</div>
  <div style="position:absolute;left:0;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;padding:0 7px;">
    <div style="width:2px;height:48px;background:${accentColor};border-radius:1px;"></div>
    <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:10px solid ${accentColor};"></div>
  </div>
  <div style="position:absolute;left:50px;right:28px;top:95px;bottom:60px;display:flex;flex-direction:column;justify-content:center;gap:10px;">
    ${headingHtml}
    ${highlightHtml}
    ${descHtml}
  </div>
  ${siteHtml}
  <div style="position:absolute;bottom:0;left:0;right:0;height:10px;display:flex;overflow:hidden;">
    ${progressHtml}
  </div>
</div>`;
}

function _carouselBuildLightCtaHTML(slide) {
  const { accentColor, logoText, avatarImage } = carouselState;
  const logo = logoText || 'BRAND.';
  const slides = carouselState.slides;
  const username = (slides[0] && slides[0].username) || '@yourhandle';

  const avatarHtml = avatarImage
    ? `<div style="width:38px;height:38px;border-radius:50%;background-image:url(${avatarImage});background-size:cover;background-position:center center;background-repeat:no-repeat;border:2px solid ${accentColor};flex-shrink:0;"></div>`
    : `<div style="width:38px;height:38px;border-radius:50%;background:#e8e8e8;border:2px solid ${accentColor};flex-shrink:0;"></div>`;

  return `<div style="width:${SLIDE_W}px;height:${SLIDE_H}px;background:#fff;position:relative;overflow:hidden;font-family:${SLIDE_FONT};">
  <div style="position:absolute;top:24px;right:28px;font-size:18px;font-weight:900;color:${accentColor};">${_esc(logo)}</div>
  <div style="position:absolute;top:68px;left:0;right:0;height:3px;background:${accentColor};"></div>
  <div style="position:absolute;left:50px;right:50px;top:50%;transform:translateY(-60%);text-align:center;">
    <div style="width:40px;height:4px;background:${accentColor};margin:0 auto 28px;"></div>
    <div style="font-size:28px;font-weight:700;color:#111;line-height:1.25;margin-bottom:18px;letter-spacing:-0.3px;">${_esc(slide.heading || 'Save this for later.')}</div>
    <div style="font-size:14px;color:#555;line-height:1.6;margin-bottom:28px;">${_esc(slide.subtext || 'Send it to someone who needs it.')}</div>
    <div style="display:inline-block;background:${accentColor};color:#fff;font-size:14px;font-weight:600;padding:13px 28px;border-radius:4px;letter-spacing:0.02em;">${_esc(slide.action || 'Follow for more')}</div>
  </div>
  <div style="position:absolute;left:40px;bottom:100px;display:flex;align-items:center;gap:10px;right:40px;">
    ${avatarHtml}
    <div style="background:#f0f0f0;padding:6px 14px;border-radius:20px;font-size:13px;color:#222;white-space:nowrap;">${_esc(username.replace(/^@/, ''))}</div>
    <div style="flex:1;height:3px;background:${accentColor};margin-left:4px;"></div>
  </div>
</div>`;
}

// ─── Dark / Magazine style ────────────────────────────────────────────────────

function _carouselBuildTitleHTML(slide) {
  const { accentColor, bgColor, coverImage, coverScale, coverX, coverY } = carouselState;

  // Use a background-image div (not <img object-fit:cover>): html2canvas renders
  // object-fit:cover as object-fit:fill, stretching the photo's aspect ratio in the
  // exported PNG. background-size:cover is honored correctly, so preview and export match.
  const coverLayer = coverImage
    ? `<div style="position:absolute;inset:0;overflow:hidden;">
         <div style="position:absolute;inset:0;background-image:url(${coverImage});background-repeat:no-repeat;background-size:cover;background-position:center center;transform-origin:center center;transform:scale(${coverScale / 100}) translate(${coverX}px,${coverY}px);"></div>
       </div>`
    : `<div style="position:absolute;inset:0;background:${bgColor};"></div>`;

  const gradient = `<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.92) 0%,rgba(0,0,0,0.3) 60%,transparent 100%);"></div>`;

  const tagHtml = slide.tag
    ? `<div style="display:inline-block;background:${accentColor};color:#000;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:5px 12px;margin-bottom:16px;border-radius:2px;">${_esc(slide.tag)}</div><br>`
    : '';

  const words = (slide.heading || '').trim().split(/\s+/);
  const last = words.pop() || '';
  const rest = words.join(' ');
  const headingHtml = rest
    ? `${_esc(rest)} <span style="color:${accentColor};">${_esc(last)}</span>`
    : `<span style="color:${accentColor};">${_esc(last)}</span>`;

  const avatarHtml = _carouselAvatarHTML(34);
  const username = slide.username || '@yourhandle';

  return `<div style="width:${SLIDE_W}px;height:${SLIDE_H}px;position:relative;overflow:hidden;font-family:${SLIDE_FONT};background:${bgColor};">
  ${coverLayer}
  ${gradient}
  <div style="position:absolute;left:40px;right:40px;bottom:90px;display:flex;flex-direction:column;">
    ${tagHtml}
    <h1 style="font-size:34px;font-weight:800;color:#fff;line-height:1.2;margin:0 0 12px;letter-spacing:-0.5px;">${headingHtml}</h1>
    <p style="font-size:16px;color:rgba(255,255,255,0.7);margin:0 0 8px;line-height:1.45;">${_esc(slide.subheading || '')}</p>
    <p style="font-size:11px;color:rgba(255,255,255,0.35);margin:0 0 20px;font-style:italic;">(save it so you don't lose it)</p>
    <div style="display:flex;align-items:center;gap:8px;">${avatarHtml}<span style="font-size:13px;color:rgba(255,255,255,0.82);">${_esc(username)}</span><span style="color:#1d9bf0;font-size:15px;font-weight:bold;">✓</span></div>
  </div>
</div>`;
}

function _carouselBuildContentHTML(slide, idx, total) {
  const { accentColor, bgColor, slides } = carouselState;
  const username = (slides[0] && slides[0].username) || '@yourhandle';
  const counter = `${idx + 1}/${total}`;

  const imgHtml = slide.image
    ? `<div style="width:100%;height:150px;background-image:url(${slide.image});background-size:cover;background-position:center center;background-repeat:no-repeat;margin-bottom:16px;border-radius:2px;flex-shrink:0;"></div>`
    : '';

  const highlightHtml = slide.highlight
    ? `<div style="display:flex;gap:12px;align-items:flex-start;margin-top:16px;">
         <div style="width:3px;min-width:3px;background:${accentColor};align-self:stretch;border-radius:2px;"></div>
         <p style="font-size:13px;color:${accentColor};line-height:1.55;font-style:italic;margin:0;">${_esc(slide.highlight)}</p>
       </div>`
    : '';

  // Large faint watermark number — defines "premium" depth on dark slides
  const watermarkHtml = slide.number
    ? `<div style="position:absolute;bottom:28px;right:12px;font-size:140px;font-weight:900;color:rgba(255,255,255,0.04);line-height:1;pointer-events:none;user-select:none;">${_esc(slide.number)}</div>`
    : '';

  // Segmented progress bar at the bottom edge
  const segW = Math.floor(SLIDE_W / total);
  const progressSegs = Array.from({ length: total }, (_, i) => {
    const bg = i < idx + 1 ? accentColor : `${accentColor}28`;
    return `<div style="width:${segW}px;height:100%;background:${bg};"></div>`;
  }).join('');

  return `<div style="width:${SLIDE_W}px;height:${SLIDE_H}px;position:relative;overflow:hidden;font-family:${SLIDE_FONT};background:${bgColor};">
  ${watermarkHtml}
  <div style="position:absolute;top:22px;right:28px;font-size:11px;color:rgba(255,255,255,0.18);letter-spacing:0.08em;">${counter}</div>
  <div style="position:absolute;left:40px;right:40px;top:72px;bottom:110px;display:flex;flex-direction:column;justify-content:center;">
    <div style="font-size:12px;font-weight:700;color:${accentColor};letter-spacing:0.18em;text-transform:uppercase;margin-bottom:12px;">${_esc(slide.number || '')}</div>
    <h2 style="font-size:28px;font-weight:800;color:#fff;line-height:1.25;margin:0 0 16px;letter-spacing:-0.3px;">${_esc(slide.heading || '')}</h2>
    ${imgHtml}
    <p style="font-size:14px;color:rgba(255,255,255,0.6);line-height:1.65;margin:0;">${_escMultiline(slide.description || '')}</p>
    ${highlightHtml}
  </div>
  <div style="position:absolute;bottom:38px;left:40px;right:40px;display:flex;align-items:center;gap:8px;">${_carouselAvatarHTML(30)}<span style="font-size:12px;color:rgba(255,255,255,0.7);">${_esc(username)}</span><span style="color:#1d9bf0;font-size:14px;font-weight:bold;">✓</span></div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:8px;display:flex;overflow:hidden;">${progressSegs}</div>
</div>`;
}

function _carouselBuildDarkCtaHTML(slide) {
  const { accentColor, bgColor, slides } = carouselState;
  const username = (slides[0] && slides[0].username) || '@yourhandle';

  return `<div style="width:${SLIDE_W}px;height:${SLIDE_H}px;position:relative;overflow:hidden;font-family:${SLIDE_FONT};background:${bgColor};">
  <div style="position:absolute;top:0;left:0;right:0;height:4px;background:${accentColor};"></div>
  <div style="position:absolute;left:40px;right:40px;top:50%;transform:translateY(-58%);text-align:center;">
    <div style="width:40px;height:3px;background:${accentColor};margin:0 auto 28px;"></div>
    <div style="font-size:34px;font-weight:800;color:#fff;line-height:1.2;margin-bottom:20px;letter-spacing:-0.5px;">${_esc(slide.heading || 'Save this for later.')}</div>
    <div style="width:40px;height:3px;background:${accentColor};margin:0 auto 20px;"></div>
    <div style="font-size:16px;color:rgba(255,255,255,0.6);line-height:1.5;margin-bottom:32px;">${_esc(slide.subtext || 'Send it to someone who needs it.')}</div>
    <div style="font-size:14px;font-weight:600;color:${accentColor};letter-spacing:0.04em;">${_esc(slide.action || 'Follow for more')}</div>
  </div>
  <div style="position:absolute;bottom:28px;left:40px;right:40px;display:flex;align-items:center;gap:8px;">${_carouselAvatarHTML(30)}<span style="font-size:13px;color:rgba(255,255,255,0.75);">${_esc(username)}</span><span style="color:#1d9bf0;font-size:15px;font-weight:bold;">✓</span></div>
</div>`;
}

function _carouselAvatarHTML(size) {
  if (carouselState.avatarImage) {
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background-image:url(${carouselState.avatarImage});background-size:cover;background-position:center center;background-repeat:no-repeat;border:1.5px solid rgba(255,255,255,0.25);flex-shrink:0;"></div>`;
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
  el.innerHTML = `<div style="transform:scale(0.5);transform-origin:top left;width:${SLIDE_W}px;height:${SLIDE_H}px;pointer-events:none;">${_carouselBuildSlideHTML(previewSlide, previewIdx)}</div>`;
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
  if (tab === 'settings') { _carouselBuildColorPresets(); carouselBuildThemeSelector(); _carouselUpdateSettingsPreview(); }
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
    carouselSaveAvatar();
    _carouselUpdateAvatarBtn();
  });
}

function carouselSaveAvatar() {
  try {
    if (carouselState.avatarImage) {
      localStorage.setItem(CAROUSEL_AVATAR_KEY, carouselState.avatarImage);
    } else {
      localStorage.removeItem(CAROUSEL_AVATAR_KEY);
    }
  } catch (e) {}
}

function carouselLoadAvatar() {
  try {
    const data = localStorage.getItem(CAROUSEL_AVATAR_KEY);
    if (data) {
      carouselState.avatarImage = data;
      _carouselUpdateAvatarBtn();
    }
  } catch (e) {}
}

function _carouselUpdateAvatarBtn() {
  const label = document.querySelector('label[for="carousel-avatar-input"]');
  if (!label) return;
  const existing = label.querySelector('.carousel-avatar-thumb');
  if (carouselState.avatarImage) {
    if (!existing) {
      const img = document.createElement('img');
      img.className = 'carousel-avatar-thumb';
      img.style.cssText = 'width:22px;height:22px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px;border:1.5px solid rgba(255,255,255,0.4);';
      label.prepend(img);
    }
    label.querySelector('.carousel-avatar-thumb').src = carouselState.avatarImage;
  } else if (existing) {
    existing.remove();
  }
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

    // Wait one frame so fonts are applied before capture
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const canvas = await window.html2canvas(target.firstElementChild, {
      width: SLIDE_W,
      height: SLIDE_H,
      scale: 2,           // 540×675 × scale:2 = 1080×1350px output
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

// ─── Save to Library ──────────────────────────────────────────────────────────

async function carouselSaveToLibrary() {
  const btn = document.getElementById('carousel-save-library-btn');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
  try {
    const titleSlide = carouselState.slides.find(s => s.type === 'title');
    const title = titleSlide?.heading || 'Carousel';
    const sessionId = (typeof appData !== 'undefined' && appData.sessionId) || null;
    const res = await authFetch('/api/posts/save-carousel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        slides: carouselState.slides,
        title,
        settings: {
          accentColor: carouselState.accentColor,
          bgColor: carouselState.bgColor,
          slideStyle: carouselState.slideStyle,
          theme: carouselState.theme,
          logoText: carouselState.logoText,
          websiteUrl: carouselState.websiteUrl,
        },
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Save failed');
    if (btn) btn.textContent = 'Saved ✓';
    setTimeout(() => { if (btn) { btn.textContent = 'Save to Library'; btn.disabled = false; } }, 2000);
  } catch (err) {
    console.error('carouselSaveToLibrary error:', err);
    alert('Could not save to library. Please try again.');
    if (btn) { btn.textContent = 'Save to Library'; btn.disabled = false; }
  }
}

// ─── Editor ───────────────────────────────────────────────────────────────────

function carouselRenderEditor() {
  const list = document.getElementById('carousel-slides-list');
  if (!list) return;
  list.innerHTML = carouselState.slides.map((slide, i) => _carouselSlideItemHTML(slide, i)).join('');

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
  const total = carouselState.slides.length;
  const typeLabels = { title: '🖼', content: '📋', cta: '↗', quote: '❝', stat: '📊', split: '◫', checklist: '☑' };
  const typeLabel = typeLabels[slide.type] || '▪';
  const previewText = slide.heading || slide.text || slide.number || `Slide ${i + 1}`;
  const label = `${typeLabel} ${_esc(previewText)}`;

  const upDisabled = i === 0 ? 'disabled' : '';
  const downDisabled = i === total - 1 ? 'disabled' : '';
  const reorderBtns = `<div class="carousel-reorder-btns">
    <button class="carousel-reorder-btn" onclick="event.stopPropagation();carouselMoveSlide(${i},-1)" ${upDisabled} title="Move up">↑</button>
    <button class="carousel-reorder-btn" onclick="event.stopPropagation();carouselMoveSlide(${i},1)" ${downDisabled} title="Move down">↓</button>
  </div>`;

  let fields = '';

  if (slide.type === 'title') {
    fields = `<div class="carousel-field">
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
       </div>`;
  } else if (slide.type === 'cta') {
    fields = `<div class="carousel-field">
         <label class="carousel-field-label">Save / CTA heading</label>
         <input type="text" value="${_escAttr(slide.heading || '')}" oninput="carouselUpdateField(${i},'heading',this.value)">
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Share prompt</label>
         <input type="text" value="${_escAttr(slide.subtext || '')}" oninput="carouselUpdateField(${i},'subtext',this.value)">
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Action line (follow / DM / comment)</label>
         <input type="text" value="${_escAttr(slide.action || '')}" oninput="carouselUpdateField(${i},'action',this.value)">
       </div>
       <button class="carousel-delete-slide-btn" onclick="carouselDeleteSlide(${i})">Delete slide</button>`;
  } else if (slide.type === 'quote') {
    fields = `<div class="carousel-field">
         <label class="carousel-field-label">Quote text</label>
         <textarea oninput="carouselUpdateField(${i},'text',this.value)">${_escContent(slide.text || '')}</textarea>
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Attribution (optional)</label>
         <input type="text" value="${_escAttr(slide.attribution || '')}" placeholder="— Name or source" oninput="carouselUpdateField(${i},'attribution',this.value)">
       </div>
       <button class="carousel-delete-slide-btn" onclick="carouselDeleteSlide(${i})">Delete slide</button>`;
  } else if (slide.type === 'stat') {
    fields = `<div class="carousel-field">
         <label class="carousel-field-label">Number / metric</label>
         <input type="text" value="${_escAttr(slide.number || '')}" placeholder="e.g. 73% or 3×" oninput="carouselUpdateField(${i},'number',this.value)">
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Label (max 4 words)</label>
         <input type="text" value="${_escAttr(slide.label || '')}" placeholder="e.g. more saves" oninput="carouselUpdateField(${i},'label',this.value)">
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Context (1–2 sentences)</label>
         <textarea oninput="carouselUpdateField(${i},'context',this.value)">${_escContent(slide.context || '')}</textarea>
       </div>
       <button class="carousel-delete-slide-btn" onclick="carouselDeleteSlide(${i})">Delete slide</button>`;
  } else if (slide.type === 'split') {
    fields = `<div class="carousel-field">
         <label class="carousel-field-label">Slide number (decorative)</label>
         <input type="text" value="${_escAttr(slide.number || '')}" placeholder="e.g. 01" oninput="carouselUpdateField(${i},'number',this.value)">
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
         <label class="carousel-field-label">Highlight phrase (optional)</label>
         <input type="text" value="${_escAttr(slide.highlight || '')}" placeholder="Key takeaway" oninput="carouselUpdateField(${i},'highlight',this.value)">
       </div>
       <button class="carousel-delete-slide-btn" onclick="carouselDeleteSlide(${i})">Delete slide</button>`;
  } else if (slide.type === 'checklist') {
    const items = Array.isArray(slide.items) ? slide.items : [];
    const itemRows = items.map((item, j) =>
      `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
        <input type="text" value="${_escAttr(item)}" style="flex:1;" oninput="carouselUpdateChecklistItem(${i},${j},this.value)" placeholder="Item ${j + 1}">
        ${items.length > 1 ? `<button class="carousel-img-btn danger" onclick="carouselRemoveChecklistItem(${i},${j})" style="padding:4px 8px;font-size:11px;min-width:28px;">✕</button>` : ''}
      </div>`
    ).join('');
    fields = `<div class="carousel-field">
         <label class="carousel-field-label">Heading</label>
         <input type="text" value="${_escAttr(slide.heading || '')}" oninput="carouselUpdateField(${i},'heading',this.value)">
       </div>
       <div class="carousel-field">
         <label class="carousel-field-label">Items (max 5)</label>
         ${itemRows}
         ${items.length < 5 ? `<button class="carousel-img-btn" onclick="carouselAddChecklistItem(${i})" style="margin-top:4px;">+ Add item</button>` : ''}
       </div>
       <button class="carousel-delete-slide-btn" onclick="carouselDeleteSlide(${i})">Delete slide</button>`;
  } else {
    // content type
    fields = `<div class="carousel-field">
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
  }

  return `<div class="carousel-slide-item" id="cslide-item-${i}">
  <div class="carousel-slide-item-header" onclick="carouselToggleSlideItem(${i})">
    <div class="carousel-slide-item-title">
      <span class="carousel-slide-num">${i + 1}</span>
      <span>${label}</span>
    </div>
    <div style="display:flex;align-items:center;gap:0.25rem;">
      ${reorderBtns}
      <span class="carousel-slide-item-chevron">▾</span>
    </div>
  </div>
  <div class="carousel-slide-item-body">${fields}</div>
</div>`;
}

function carouselToggleSlideItem(i) {
  const item = document.getElementById(`cslide-item-${i}`);
  if (item) {
    item.classList.toggle('open');
    if (item.classList.contains('open')) {
      // Navigate preview to the opened slide
      carouselState.currentSlide = i;
      carouselUpdatePreview();
    }
  }
}

function carouselUpdateField(i, key, value) {
  if (!carouselState.slides[i]) return;
  carouselState.slides[i][key] = value;
  // Jump preview to the slide being edited for live feedback
  carouselState.currentSlide = i;
  carouselUpdatePreview();
  carouselSaveTemplate();
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
  carouselSaveTemplate();
}

function carouselMoveSlide(i, dir) {
  const slides = carouselState.slides;
  const newIdx = i + dir;
  if (newIdx < 0 || newIdx >= slides.length) return;
  [slides[i], slides[newIdx]] = [slides[newIdx], slides[i]];
  carouselState.currentSlide = newIdx;
  carouselRenderEditor();
  carouselUpdatePreview();
  carouselSaveTemplate();
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
  carouselSaveTemplate();
  setTimeout(() => carouselToggleSlideItem(carouselState.slides.length - 1), 50);
}

function carouselAddCtaSlide() {
  const username = (carouselState.slides[0] && carouselState.slides[0].username) || '@yourhandle';
  carouselState.slides.push({
    type: 'cta',
    heading: 'Save this for later.',
    subtext: 'Send it to someone who needs it.',
    action: `Follow ${username} for more daily insights.`,
  });
  carouselRenderEditor();
  carouselUpdatePreview();
  carouselSaveTemplate();
  setTimeout(() => carouselToggleSlideItem(carouselState.slides.length - 1), 50);
}

function carouselAddQuoteSlide() {
  carouselState.slides.push({
    type: 'quote',
    text: 'The best time to start was yesterday. The second best time is now.',
    attribution: '',
  });
  carouselRenderEditor();
  carouselUpdatePreview();
  carouselSaveTemplate();
  setTimeout(() => carouselToggleSlideItem(carouselState.slides.length - 1), 50);
}

function carouselAddStatSlide() {
  carouselState.slides.push({
    type: 'stat',
    number: '0×',
    label: 'Add your metric',
    context: 'Add context explaining what this number means and why it matters.',
  });
  carouselRenderEditor();
  carouselUpdatePreview();
  carouselSaveTemplate();
  setTimeout(() => carouselToggleSlideItem(carouselState.slides.length - 1), 50);
}

function carouselAddSplitSlide() {
  const splitCount = carouselState.slides.filter(s => s.type === 'split').length;
  carouselState.slides.push({
    type: 'split',
    number: String(splitCount + 1).padStart(2, '0'),
    heading: 'Key insight',
    description: 'Add your point here. Keep it focused — one idea per slide.',
    highlight: '',
  });
  carouselRenderEditor();
  carouselUpdatePreview();
  carouselSaveTemplate();
  setTimeout(() => carouselToggleSlideItem(carouselState.slides.length - 1), 50);
}

function carouselAddChecklistSlide() {
  carouselState.slides.push({
    type: 'checklist',
    heading: 'What to do',
    items: ['First action item', 'Second action item', 'Third action item'],
  });
  carouselRenderEditor();
  carouselUpdatePreview();
  carouselSaveTemplate();
  setTimeout(() => carouselToggleSlideItem(carouselState.slides.length - 1), 50);
}

function carouselUpdateChecklistItem(slideIdx, itemIdx, value) {
  const slide = carouselState.slides[slideIdx];
  if (!slide || !Array.isArray(slide.items)) return;
  slide.items[itemIdx] = value;
  carouselState.currentSlide = slideIdx;
  carouselUpdatePreview();
  carouselSaveTemplate();
}

function carouselAddChecklistItem(slideIdx) {
  const slide = carouselState.slides[slideIdx];
  if (!slide || !Array.isArray(slide.items) || slide.items.length >= 5) return;
  slide.items.push('New item');
  carouselState.currentSlide = slideIdx;
  carouselRenderEditor();
  carouselUpdatePreview();
  carouselSaveTemplate();
  setTimeout(() => {
    const item = document.getElementById(`cslide-item-${slideIdx}`);
    if (item && !item.classList.contains('open')) carouselToggleSlideItem(slideIdx);
  }, 50);
}

function carouselRemoveChecklistItem(slideIdx, itemIdx) {
  const slide = carouselState.slides[slideIdx];
  if (!slide || !Array.isArray(slide.items) || slide.items.length <= 1) return;
  slide.items.splice(itemIdx, 1);
  carouselState.currentSlide = slideIdx;
  carouselRenderEditor();
  carouselUpdatePreview();
  carouselSaveTemplate();
  setTimeout(() => {
    const item = document.getElementById(`cslide-item-${slideIdx}`);
    if (item && !item.classList.contains('open')) carouselToggleSlideItem(slideIdx);
  }, 50);
}

// ─── Preset templates ─────────────────────────────────────────────────────────

function carouselBuildPresetGrid() {
  const grid = document.getElementById('carousel-presets-grid');
  if (!grid) return;
  grid.innerHTML = CAROUSEL_PRESETS.map(p => {
    const s = p.settings;
    return `<button class="carousel-preset-card" onclick="carouselLoadPreset('${p.id}')" title="${p.name}">
      <div class="carousel-preset-swatch" style="background:${s.bgColor};">
        <div style="position:absolute;bottom:0;left:0;right:0;height:4px;background:${s.accentColor};"></div>
      </div>
      <div class="carousel-preset-info">
        <div class="carousel-preset-name">${p.name}</div>
        <div class="carousel-preset-desc">${p.description}</div>
      </div>
    </button>`;
  }).join('');
}

function carouselLoadPreset(presetId) {
  const preset = CAROUSEL_PRESETS.find(p => p.id === presetId);
  if (!preset) return;
  if (!confirm(`Load "${preset.name}" template? This will replace your current slides.`)) return;
  carouselState.slides = preset.slides.map(s => {
    const copy = { ...s };
    if (Array.isArray(s.items)) copy.items = [...s.items];
    return copy;
  });
  carouselState.currentSlide = 0;
  const s = preset.settings;
  carouselState.theme = s.theme || 'dark';
  carouselSetAccent(s.accentColor, false, true);
  carouselSetBg(s.bgColor, false, true);
  carouselSetStyle(s.slideStyle, true);
  if (s.logoText !== undefined) {
    carouselState.logoText = s.logoText;
    const el = document.getElementById('carousel-logo-text');
    if (el) el.value = s.logoText;
  }
  carouselBuildThemeSelector();
  carouselUpdatePreview();
  carouselRenderEditor();
  carouselSwitchTab('preview');
  carouselSaveTemplate();
}

// ─── Theme selector ───────────────────────────────────────────────────────────

function carouselBuildThemeSelector() {
  const container = document.getElementById('carousel-theme-selector');
  if (!container) return;
  container.innerHTML = CAROUSEL_THEMES.map(t => {
    const isActive = carouselState.theme === t.id;
    return `<button class="carousel-theme-swatch${isActive ? ' active' : ''}"
      onclick="carouselSetTheme('${t.id}')"
      title="${t.name}"
      style="background:${t.bg};border:2px solid ${isActive ? t.accent : 'rgba(255,255,255,0.12)'};position:relative;overflow:hidden;">
      <span style="position:absolute;bottom:3px;left:0;right:0;height:5px;background:${t.accent};"></span>
      <span class="carousel-theme-name">${t.name}</span>
    </button>`;
  }).join('');
}

function carouselSetTheme(themeId) {
  const theme = CAROUSEL_THEMES.find(t => t.id === themeId);
  if (!theme) return;
  carouselState.theme = themeId;
  carouselSetStyle(theme.slideStyle, /* skipSave */ true);
  carouselSetAccent(theme.accent, false, /* skipSave */ true);
  carouselSetBg(theme.bg, false, /* skipSave */ true);
  carouselBuildThemeSelector();
  carouselUpdatePreview();
  _carouselUpdateSettingsPreview();
  carouselSaveTemplate();
}

// ─── Template persistence ─────────────────────────────────────────────────────

function carouselSaveTemplate() {
  try {
    const username = (carouselState.slides[0] && carouselState.slides[0].username) || '@yourhandle';
    // Strip per-slide images before saving — they can be several MB and blow localStorage quota
    // Avatar is persisted separately under CAROUSEL_AVATAR_KEY
    const slides = carouselState.slides.map(s => ({ ...s, image: null }));
    localStorage.setItem(CAROUSEL_TEMPLATE_KEY, JSON.stringify({
      accentColor: carouselState.accentColor,
      bgColor: carouselState.bgColor,
      slideStyle: carouselState.slideStyle,
      theme: carouselState.theme,
      logoText: carouselState.logoText,
      websiteUrl: carouselState.websiteUrl,
      username,
      slides,
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
    if (t.theme) carouselState.theme = t.theme;
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
    if (t.slides && Array.isArray(t.slides) && t.slides.length) {
      carouselState.slides = t.slides;
    } else if (t.username && carouselState.slides[0]) {
      carouselState.slides[0].username = t.username;
    }
  } catch (e) {}
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function carouselSetStyle(style, skipSave) {
  carouselState.slideStyle = style;
  document.querySelectorAll('.carousel-style-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.style === style);
  });
  const bgSection = document.getElementById('carousel-bg-section');
  if (bgSection) bgSection.style.display = style === 'dark' ? 'block' : 'none';
  carouselUpdatePreview();
  _carouselUpdateSettingsPreview();
  if (!skipSave) carouselSaveTemplate();
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

function carouselSetAccent(color, fromPreset, skipSave) {
  carouselState.accentColor = color;
  const picker = document.getElementById('carousel-accent-picker');
  const hex = document.getElementById('carousel-accent-hex');
  if (picker) picker.value = color;
  if (hex) hex.textContent = color;
  if (fromPreset) _carouselBuildColorPresets();
  carouselUpdatePreview();
  if (!skipSave) carouselSaveTemplate();
}

function carouselSetBg(color, fromPreset, skipSave) {
  carouselState.bgColor = color;
  const picker = document.getElementById('carousel-bg-picker');
  const hex = document.getElementById('carousel-bg-hex');
  if (picker) picker.value = color;
  if (hex) hex.textContent = color;
  if (fromPreset) _carouselBuildColorPresets();
  carouselUpdatePreview();
  if (!skipSave) carouselSaveTemplate();
}

// ─── Template import / export ─────────────────────────────────────────────────

function carouselExportTemplate() {
  const template = {
    version: 1,
    accentColor: carouselState.accentColor,
    bgColor: carouselState.bgColor,
    slideStyle: carouselState.slideStyle,
    theme: carouselState.theme,
    logoText: carouselState.logoText,
    websiteUrl: carouselState.websiteUrl,
    slides: carouselState.slides.map(s => {
      const copy = { ...s };
      copy.image = null;
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

async function carouselExportAllPNG() {
  const { slides, bgColor } = carouselState;
  if (!slides.length) return;

  const btn = document.getElementById('carousel-export-png-btn');
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

    for (let i = 0; i < slides.length; i++) {
      if (btn) btn.textContent = `Rendering ${i + 1}/${slides.length}…`;
      target.innerHTML = _carouselBuildSlideHTML(slides[i], i);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const canvas = await window.html2canvas(target.firstElementChild, {
        width: SLIDE_W, height: SLIDE_H, scale: 2,
        useCORS: true, allowTaint: true, backgroundColor: bgColor, logging: false,
      });

      await new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Canvas toBlob returned null — canvas may be tainted')); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `slide-${i + 1}.png`;
          a.click();
          setTimeout(() => { URL.revokeObjectURL(url); resolve(); }, 100);
        }, 'image/png');
      });

      // Small delay to prevent browser download throttling
      if (i < slides.length - 1) await new Promise(r => setTimeout(r, 150));
    }
  } catch (err) {
    console.error('PNG export error:', err);
    alert('PNG export failed — see console for details.');
  } finally {
    if (btn) { btn.textContent = '↓ Download PNG'; btn.disabled = false; }
  }
}

async function carouselExportPDF() {
  const { slides, bgColor } = carouselState;
  if (!slides.length) return;

  const btn = document.getElementById('carousel-export-pdf-btn');
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

    if (!window.jspdf) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    const target = document.getElementById('carousel-render-target');
    if (!target) throw new Error('Render target missing');

    const doc = new window.jspdf.jsPDF({
      orientation: 'portrait',
      unit: 'px',
      format: [1080, 1350],
    });

    for (let i = 0; i < slides.length; i++) {
      if (btn) btn.textContent = `Rendering ${i + 1}/${slides.length}…`;
      target.innerHTML = _carouselBuildSlideHTML(slides[i], i);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const canvas = await window.html2canvas(target.firstElementChild, {
        width: SLIDE_W, height: SLIDE_H, scale: 2,
        useCORS: true, allowTaint: true, backgroundColor: bgColor, logging: false,
      });

      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) doc.addPage([1080, 1350], 'portrait');
      doc.addImage(dataUrl, 'JPEG', 0, 0, 1080, 1350);
    }

    doc.save('carousel.pdf');
  } catch (err) {
    console.error('PDF export error:', err);
    alert('PDF export failed — see console for details.');
  } finally {
    if (btn) { btn.textContent = '↓ Download PDF'; btn.disabled = false; }
  }
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
      if (template.theme) {
        carouselSetTheme(template.theme);
      } else {
        if (template.accentColor) carouselSetAccent(template.accentColor, false, true);
        if (template.bgColor) carouselSetBg(template.bgColor, false, true);
        if (template.slideStyle) carouselSetStyle(template.slideStyle, true);
      }
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

// Used by the library to load a saved carousel back into the editor
function carouselLoadFromData(data) {
  if (!data || !Array.isArray(data.slides)) return false;
  carouselState.slides = data.slides;
  carouselState.currentSlide = 0;
  if (data.settings) {
    const s = data.settings;
    if (s.theme) {
      carouselSetTheme(s.theme);
    } else {
      if (s.accentColor) carouselSetAccent(s.accentColor, false, true);
      if (s.bgColor) carouselSetBg(s.bgColor, false, true);
      if (s.slideStyle) carouselSetStyle(s.slideStyle, true);
    }
    if (s.logoText !== undefined) {
      carouselState.logoText = s.logoText;
      const el = document.getElementById('carousel-logo-text');
      if (el) el.value = s.logoText;
    }
    if (s.websiteUrl !== undefined) {
      carouselState.websiteUrl = s.websiteUrl;
      const el = document.getElementById('carousel-website-url');
      if (el) el.value = s.websiteUrl;
    }
  }
  carouselUpdatePreview();
  carouselRenderEditor();
  carouselBuildThemeSelector();
  carouselSwitchTab('preview');
  return true;
}

function carouselReset() {
  if (!confirm('Reset to default content? This will clear all slides, images, and saved brand settings.')) return;
  localStorage.removeItem(CAROUSEL_TEMPLATE_KEY);
  localStorage.removeItem(CAROUSEL_AVATAR_KEY);
  carouselState.slides = getDefaultCarouselSlides();
  carouselState.currentSlide = 0;
  carouselState.coverImage = null;
  carouselState.avatarImage = null;
  _carouselUpdateAvatarBtn();
  carouselState.accentColor = '#39FF14';
  carouselState.bgColor = '#0a0a0a';
  carouselState.slideStyle = 'dark';
  carouselState.theme = 'dark';
  carouselState.logoText = 'BRAND.';
  carouselState.websiteUrl = '';
  const logoInput = document.getElementById('carousel-logo-text');
  if (logoInput) logoInput.value = 'BRAND.';
  const siteInput = document.getElementById('carousel-website-url');
  if (siteInput) siteInput.value = '';
  carouselSetStyle('dark', true);
  carouselBuildThemeSelector();
  carouselUpdatePreview();
  carouselRenderEditor();
  _carouselBuildColorPresets();
}
