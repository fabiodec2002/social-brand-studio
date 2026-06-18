require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Set it in .env or Vercel dashboard.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

const app = express();
const UPLOADS_DIR = path.join(os.tmpdir(), 'uploads');
const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 10 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sql = neon(process.env.DATABASE_URL);
const MODEL = 'gpt-4o-mini';
const IS_PROD = process.env.NODE_ENV === 'production';
const serverErr = (res, err) => {
  console.error(err);
  res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message });
};

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com', 'fonts.googleapis.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
    },
  },
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Slow down.' },
});

app.use('/api/auth/', authLimiter);
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      pdf_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      personality_map JSONB NOT NULL,
      strategy JSONB NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS viral_cache (
      platform TEXT PRIMARY KEY,
      posts JSONB NOT NULL DEFAULT '[]',
      cached_at TIMESTAMPTZ DEFAULT NOW(),
      run_id TEXT,
      run_status TEXT DEFAULT 'ready'
    )
  `;
  await sql`ALTER TABLE viral_cache ADD COLUMN IF NOT EXISTS run_id TEXT`;
  await sql`ALTER TABLE viral_cache ADD COLUMN IF NOT EXISTS run_status TEXT DEFAULT 'ready'`;
  await sql`ALTER TABLE viral_cache ADD COLUMN IF NOT EXISTS dataset_id TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS post_analytics (
      session_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      posts JSONB NOT NULL DEFAULT '[]',
      imported_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (session_id, platform)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id TEXT`;
  await sql`ALTER TABLE post_analytics ADD COLUMN IF NOT EXISTS user_id TEXT`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS brand_type TEXT DEFAULT 'personal'`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS website_url TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS website_url TEXT`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS style_fingerprint TEXT`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS brand_context JSONB`;
  await sql`
    CREATE TABLE IF NOT EXISTS generated_posts (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      format TEXT,
      subtype TEXT,
      pillar_name TEXT,
      tone TEXT,
      content TEXT NOT NULL,
      voice_score INTEGER,
      voice_note TEXT,
      status TEXT DEFAULT 'draft',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS generated_posts_user_idx ON generated_posts (user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS generated_posts_session_idx ON generated_posts (session_id, created_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'general',
      summary TEXT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS knowledge_docs_user_idx ON knowledge_docs (user_id, created_at DESC)`;
  if (process.env.SEED_USER_EMAIL && process.env.SEED_USER_WEBSITE) {
    await sql`UPDATE users SET website_url = ${process.env.SEED_USER_WEBSITE} WHERE email = ${process.env.SEED_USER_EMAIL} AND (website_url IS NULL OR website_url = '')`;
  }

  // Phase 1: Agent orchestration
  await sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id          TEXT PRIMARY KEY,
      agent_name  TEXT NOT NULL,
      user_id     TEXT,
      status      TEXT DEFAULT 'idle',
      started_at  TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      last_action TEXT,
      error_msg   TEXT,
      run_count   INTEGER DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Phase 2: Idea queue
  await sql`
    CREATE TABLE IF NOT EXISTS idea_queue (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      session_id   TEXT,
      topic        TEXT NOT NULL,
      hook         TEXT,
      angle        TEXT,
      pillar_name  TEXT,
      platform     TEXT DEFAULT 'linkedin',
      status       TEXT DEFAULT 'pending',
      post_id      TEXT,
      source       TEXT DEFAULT 'agent',
      priority     INTEGER DEFAULT 5,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idea_queue_user_status_idx ON idea_queue (user_id, status, created_at DESC)`;

  // Phase 3: Brain diary
  await sql`
    CREATE TABLE IF NOT EXISTS brain_diary (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      type        TEXT NOT NULL,
      pattern     TEXT NOT NULL,
      insight     TEXT NOT NULL,
      evidence    JSONB DEFAULT '[]',
      metrics     JSONB DEFAULT '{}',
      platform    TEXT,
      pillar_name TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS brain_diary_user_type_idx ON brain_diary (user_id, type, created_at DESC)`;

  // Phase 3: engagement_score on generated_posts
  await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS engagement_score INTEGER`;
  await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS platform_post_id TEXT`;

  // Phase 5: Self-improving prompt rules
  await sql`
    CREATE TABLE IF NOT EXISTS prompt_rules (
      user_id    TEXT PRIMARY KEY,
      rules      JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Phase 4: Metrics Agent
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS linkedin_profile_url TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS metrics_runs (
      user_id      TEXT PRIMARY KEY,
      run_id       TEXT,
      run_status   TEXT DEFAULT 'idle',
      linkedin_url TEXT,
      processed_at TIMESTAMPTZ,
      updated_at   TIMESTAMPTZ DEFAULT NOW(),
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Autonomous loop: OAuth, publish pipeline, notifications
  await sql`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform         TEXT NOT NULL,
      access_token     TEXT NOT NULL,
      refresh_token    TEXT,
      expires_at       TIMESTAMPTZ,
      scope            TEXT,
      platform_user_id TEXT,
      platform_username TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, platform)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS publish_log (
      id               TEXT PRIMARY KEY,
      post_id          TEXT NOT NULL REFERENCES generated_posts(id),
      user_id          TEXT NOT NULL,
      platform         TEXT NOT NULL,
      attempt_at       TIMESTAMPTZ DEFAULT NOW(),
      status           TEXT NOT NULL,
      platform_post_id TEXT,
      error_msg        TEXT,
      response_body    JSONB
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS notification_queue (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      type       TEXT NOT NULL,
      payload    JSONB DEFAULT '{}',
      sent_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ`;
  await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS rejection_reason TEXT`;
  await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS rejection_note TEXT`;
  await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`;
  await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`;
  await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS image_url TEXT`;
  await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS subtext TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram_profile_url TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_timezone TEXT DEFAULT 'UTC'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_email TEXT`;
}

initDb().catch(err => console.error('DB init failed:', err));

// ─── TOKEN ENCRYPTION (AES-256-GCM) ──────────────────────────────────────────

const OAUTH_KEY = process.env.OAUTH_ENCRYPTION_KEY
  ? Buffer.from(process.env.OAUTH_ENCRYPTION_KEY, 'hex')
  : crypto.randomBytes(32); // fallback for dev; set OAUTH_ENCRYPTION_KEY in prod

function encryptToken(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', OAUTH_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ iv: iv.toString('hex'), tag: tag.toString('hex'), ct: encrypted.toString('hex') });
}

function decryptToken(stored) {
  const { iv, tag, ct } = JSON.parse(stored);
  const decipher = crypto.createDecipheriv('aes-256-gcm', OAUTH_KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'hex')), decipher.final()]).toString('utf8');
}

// ─── OPTIMAL SCHEDULING ──────────────────────────────────────────────────────

function getOptimalScheduleTime(platform, timezone = 'UTC') {
  const now = new Date();
  const candidate = new Date(now);
  candidate.setMinutes(0, 0, 0);
  candidate.setHours(candidate.getHours() + 1); // start looking from next hour

  // LinkedIn: Tue(2), Wed(3), Thu(4) — 09:00–12:00 UTC
  // Instagram: Mon(1)–Fri(5) — 11:00–13:00 UTC
  const isLinkedIn = platform === 'linkedin';
  const validDays = isLinkedIn ? new Set([2, 3, 4]) : new Set([1, 2, 3, 4, 5]);
  const targetHour = isLinkedIn ? 10 : 11; // mid-range of optimal window

  for (let i = 0; i < 14; i++) { // look up to 14 days ahead
    if (validDays.has(candidate.getUTCDay())) {
      const slot = new Date(candidate);
      slot.setUTCHours(targetHour, 0, 0, 0);
      if (slot > now) return slot;
    }
    candidate.setDate(candidate.getDate() + 1);
    candidate.setUTCHours(0, 0, 0, 0);
  }

  // Fallback: next weekday at 10:00 UTC
  const fallback = new Date(now);
  fallback.setUTCHours(10, 0, 0, 0);
  fallback.setDate(fallback.getDate() + 1);
  return fallback;
}

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|::ffff:|fc00:|fd)/i;

function isSafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // Strip IPv6 brackets so [::1] and [::ffff:127.0.0.1] are correctly tested
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '0.0.0.0' || PRIVATE_IP_RE.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

// Extract the 5 brand pillars + supporting context from website text + personality map
async function extractBrandContext(websiteText, personalityMap) {
  const mapSnippet = personalityMap
    ? `Name: ${personalityMap.name || 'Unknown'}
Values: ${(personalityMap.values || []).slice(0, 8).join(', ')}
Skills: ${(personalityMap.skills || []).slice(0, 8).join(', ')}
Expertise: ${((personalityMap.professional_experience || {}).areas_of_expertise || []).join(', ')}
Tangible assets (offers): ${(personalityMap.tangible_assets || []).slice(0, 6).join(', ')}
Personality notes: ${personalityMap.personality_notes || ''}`
    : '';

  const response = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `Extract the 5 brand pillars from this content. These are: Missie, Visie, Kernwaarden, Buyer Persona, and Tone of Voice. Set fields to null only if you genuinely cannot determine them — make confident inferences from context where possible.

CONTENT:
${websiteText}

${mapSnippet ? `PERSONALITY/BRAND DATA (additional context):\n${mapSnippet}` : ''}

Return this exact JSON:
{
  "missie": "Why they exist beyond making money — their mission in one powerful sentence. Infer from the work, values, and positioning if not stated explicitly. null only if truly impossible to determine.",
  "visie": "The world they want to create, or where they are taking their clients in the next 3–5 years. One forward-facing sentence. null if not determinable.",
  "kernwaarden": ["core value 1", "core value 2", "core value 3"],
  "buyer_persona": {
    "archetype": "Name or role description for their ideal client (e.g. 'The Ambitious Executive' or 'Senior HR directors at fast-growing companies'). null if unclear.",
    "situation": "Their current situation — what is happening in their life or work that brings them here. null if unclear.",
    "fear": "Their deepest fear or the thing keeping them up at night — the real emotional pain, not the surface problem. null if unclear.",
    "desire": "What they secretly want — the deeper desire beneath the stated goal. null if unclear.",
    "buying_trigger": "What finally makes them take action — the moment or event that pushes them to buy. null if unclear."
  },
  "tone_of_voice": {
    "description": "How they actually sound — 2 concrete sentences capturing their communication style. Quote specific phrases from the content if helpful.",
    "formal_casual": 3,
    "direct_nurturing": 3,
    "serious_playful": 2
  },
  "offer": "What they sell — specific product or service name and format. null if not found.",
  "price_point": "Price range if shown on the site. null if not found.",
  "best_result": "Single most compelling proof point, case study result, or testimonial. One sentence. null if none found.",
  "contrarian_belief": "Any opinion or positioning they state as different from how their industry normally operates. null if not found.",
  "social_goal": "Most likely primary content goal — one of: get_clients / build_thought_leadership / grow_audience / nurture_community. Always infer from context, never null.",
  "off_limits": null,
  "extracted_fields": ["array of top-level field names (missie, visie, kernwaarden, buyer_persona, tone_of_voice, offer, price_point, best_result, contrarian_belief, social_goal) that were filled with confident data"]
}

Note: tone_of_voice sliders use 1–5 scale where 1=left extreme, 5=right extreme:
- formal_casual: 1=very formal, 5=very casual
- direct_nurturing: 1=very direct, 5=very nurturing
- serious_playful: 1=very serious, 5=very playful

Return ONLY valid JSON.`,
    }],
  });
  return JSON.parse(response.choices[0].message.content);
}

// Fetch website and strip to plain text (best-effort)
async function fetchWebsiteText(url) {
  if (!isSafeUrl(url)) return null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    // Strip tags, collapse whitespace, cap at 6000 chars
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);
  } catch {
    return null;
  }
}

// Extract text from PDF using pdf-parse
async function extractPdfText(filePath) {
  const dataBuffer = await fs.promises.readFile(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

// Parse personality map from text
async function parsePersonalityMap(text, websiteText = null) {
  const websiteSection = websiteText
    ? `\n\nADDITIONAL CONTEXT — COMPANY WEBSITE:\nUse this to enrich the personality map with real offers, services, pricing, and messaging found on the website. Do NOT invent anything not present in either source.\n${websiteText}`
    : '';
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{
      role: 'user',
      content: `Extract the personality map data from this workshop document and return it as a JSON object with these exact keys:
{
  "name": "person's name if found, otherwise null",
  "values": ["list of values"],
  "achievements": ["list of achievements"],
  "qualities": ["list of qualities"],
  "tangible_assets": ["list of tangible assets"],
  "intangible_assets": ["list of intangible assets"],
  "skills": ["list of skills"],
  "moments_of_happiness": ["list of happy moments"],
  "interesting_facts": ["list of interesting facts"],
  "professional_experience": {
    "better_than_others": "text",
    "learned_over_years": "text",
    "enjoyed_learning": "text",
    "do_easily": "text",
    "eager_to_hear": "text",
    "areas_of_expertise": ["list"]
  },
  "dream_100": ["list of inspirational figures"],
  "personality_notes": "any notes about personality, communication style, how others perceive them"
}

Return ONLY valid JSON, no markdown, no explanation.

Document text:
${text}${websiteSection}`
    }],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

// Parse brand brief from business PDF
async function parseBrandBrief(text, websiteText = null) {
  const websiteSection = websiteText
    ? `\n\nADDITIONAL CONTEXT — COMPANY WEBSITE:\nUse this to enrich the brand brief with real offers, services, pricing, and messaging found on the website. Do NOT invent anything not present in either source.\n${websiteText}`
    : '';
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{
      role: 'user',
      content: `Extract brand and company data from this document and return it as a JSON object with these exact keys:
{
  "name": "company or brand name if found, otherwise null",
  "values": ["company core values"],
  "achievements": ["key results, case studies, client wins, milestones"],
  "qualities": ["brand attributes and personality traits"],
  "tangible_assets": ["products, services, tools, packages offered"],
  "intangible_assets": ["brand reputation, IP, methodology, community, partnerships"],
  "skills": ["core competencies and areas of expertise"],
  "moments_of_happiness": ["proudest client outcomes, company wins, team moments"],
  "interesting_facts": ["unique or surprising facts about the company"],
  "professional_experience": {
    "better_than_others": "what this company does better than competitors",
    "learned_over_years": "key lessons and knowledge built over time",
    "enjoyed_learning": "areas the team is passionate about developing",
    "do_easily": "things that come naturally to this company",
    "eager_to_hear": "questions clients and prospects frequently ask",
    "areas_of_expertise": ["main expertise areas"]
  },
  "dream_100": ["industry influencers, thought leaders, or dream collaborators to follow"],
  "personality_notes": "brand voice, communication style, how the company comes across to clients"
}

Return ONLY valid JSON, no markdown, no explanation.

Document text:
${text}${websiteSection}`
    }],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

// Generate social strategy from personality/brand map
async function generateStrategy(personalityMap, brandType = 'personal') {
  const isPersonal = brandType !== 'business';

  const personalPrompt = `You are an expert personal branding strategist. Based on this personality map, create a comprehensive social media strategy.

PERSONALITY MAP:
${JSON.stringify(personalityMap, null, 2)}

Return a JSON object with this exact structure:
{
  "brand_statement": "One powerful sentence that defines this person's brand",
  "target_audience": "Description of ideal audience",
  "unique_value_proposition": "What makes them uniquely valuable",
  "brand_voice": {
    "adjectives": ["3-4 words describing their tone"],
    "do": ["3 things to always do in posts"],
    "dont": ["3 things to never do in posts"]
  },
  "content_pillars": [
    {
      "id": "unique_id",
      "name": "Pillar name",
      "description": "Why this pillar matters for their brand",
      "audience_pain_point": "The specific frustration, fear, or gap this pillar directly addresses for their target audience — be concrete, not generic",
      "client_language": ["3-5 exact phrases, objections, or fears the target audience actually uses in their own words — not the expert's vocabulary, but the client's raw language. E.g. 'I don't know where to start', 'I feel like a fraud', 'nobody takes me seriously'. These are the words to mirror in posts."],
      "post_frequency": "e.g. 3x per week",
      "platform_fit": ["linkedin", "instagram"],
      "content_ideas": ["3 specific content ideas based on their actual experiences/expertise"]
    }
  ],
  "platform_strategy": {
    "linkedin": {
      "focus": "What to focus on here",
      "posting_frequency": "e.g. 4x per week",
      "content_types": ["types of content that work"],
      "tone": "specific tone guidance for this platform"
    },
    "instagram": {
      "focus": "What to focus on here — note Instagram has 3 distinct formats: Stories (daily presence across personality/life/expertise pillars), Carousel Posts (educational, how-to, transformation, myth-busting, storytelling, or frameworks), and Reels (talking, motivation/values, or tips & tricks). Recommend which mix suits this person.",
      "posting_frequency": "Recommend a frequency across all 3 formats (e.g. Stories daily, 3 carousels/week, 2 reels/week)",
      "content_types": ["Stories — Personality pillar", "Stories — Expertise pillar", "Carousels — category that fits them best", "Reels — style that fits their personality"],
      "tone": "specific tone guidance for Instagram — more casual, emotional, and visual than LinkedIn",
      "highlights_to_set_up": ["About Me / Start Here", "Results / Proof", "Value / Tips", "Lifestyle / Personal"]
    }
  },
  "growth_tactics": ["3 specific growth tactics tailored to their background and skills"]
}

Return ONLY valid JSON, no markdown, no explanation. Make it deeply specific to their personality map data.`;

  const businessPrompt = `You are an expert brand strategist for companies and organizations. Based on this brand brief, create a comprehensive social media strategy.

BRAND BRIEF:
${JSON.stringify(personalityMap, null, 2)}

Return a JSON object with this exact structure:
{
  "brand_statement": "One powerful positioning sentence that defines what this company stands for and who it serves",
  "target_audience": "Detailed ideal customer profile — industry, role, company size, key pain points",
  "unique_value_proposition": "What makes this company the only logical choice for their ideal client",
  "brand_voice": {
    "adjectives": ["3-4 words describing the company's communication style"],
    "do": ["3 things to always do in company posts — use we/our voice"],
    "dont": ["3 things to never do in company posts"]
  },
  "content_pillars": [
    {
      "id": "unique_id",
      "name": "Pillar name",
      "description": "Why this pillar builds authority and trust for this company",
      "audience_pain_point": "The specific customer frustration, fear, or gap this pillar directly addresses — be concrete",
      "client_language": ["3-5 exact phrases, objections, or fears the target audience actually uses in their own words — not the company's vocabulary, but the customer's raw language. E.g. 'we keep losing deals we should win', 'I don't know what our brand actually stands for', 'our team isn't aligned'. These are the words to mirror in posts."],
      "post_frequency": "e.g. 3x per week",
      "platform_fit": ["linkedin", "instagram"],
      "content_ideas": ["3 specific content ideas rooted in this company's actual work, results, and expertise"]
    }
  ],
  "platform_strategy": {
    "linkedin": {
      "focus": "Company page strategy — thought leadership, industry insights, team stories, client results, hiring",
      "posting_frequency": "e.g. 4x per week",
      "content_types": ["Industry insight posts", "Client result case studies", "Behind-the-scenes team posts", "Product/service spotlights"],
      "tone": "Professional but human — written as 'we', showing the team behind the brand"
    },
    "instagram": {
      "focus": "Brand lifestyle and visual identity — choose the right mix: Stories (daily culture/product/behind-scenes), Carousels (educational, proof, frameworks), Reels (brand values, tips, team). Recommend the right mix for this company.",
      "posting_frequency": "Recommended mix across formats",
      "content_types": ["Stories — Company culture", "Stories — Product/service spotlight", "Carousels — Educational / Industry tips", "Reels — Brand values or quick tips"],
      "tone": "Warmer and more visual than LinkedIn — still professional but shows the human side of the brand",
      "highlights_to_set_up": ["About Us / Start Here", "Results / Case Studies", "Products / Services", "Team / Culture"]
    }
  },
  "growth_tactics": ["3 specific growth tactics tailored to this company's market, strengths, and ideal client"]
}

Build 4–5 content pillars. Suggested mix for most companies: 1) Industry Education, 2) Social Proof / Results, 3) Product or Service Spotlight, 4) Company Culture / Team, 5) Thought Leadership.

Return ONLY valid JSON, no markdown, no explanation. Make it deeply specific to this company's actual data.`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: isPersonal ? personalPrompt : businessPrompt }],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

function buildInstagramInstructions(format, subType) {
  if (format === 'story') {
    const pillarNotes = {
      personality: 'Story Pillar — My Personality: Draw from an event that changed you, a core value shown through a real situation, a key achievement, your current phase/feeling, or a recurring Q&A / "this or that".',
      life: 'Story Pillar — My Life: Draw from your current routine (nutrition/sleep/workouts/education), something from your phone, how you relax or spend free time, a spontaneous plan shared step by step, or your full day documented.',
      expertise: 'Story Pillar — My Expertise: Draw from your path becoming an expert, a 3–5 step plan in your field, answering a common question in your niche, current trends or industry challenges, or your learning plan and goals.',
    };
    return `Write an Instagram Story (format as 2–4 text overlay slides: [Slide 1], [Slide 2], etc. — or a short talking script).
      - Stories build daily trust and familiarity — more raw and unfiltered than feed posts.
      - ${pillarNotes[subType] || pillarNotes.personality}
      - Write like you're talking to one specific person, not broadcasting to an audience.
      - Each slide: 1 punchy idea, 1–2 sentences max.
      - MECHANISM RULE: If you mention a result or change, name the specific thing that caused it — even in 2–3 words. "Stopped checking email before noon — changed everything" not "I made a small change and it changed everything."
      - End with a binary-choice poll ("Which are you? A or B?"), a fill-in-the-blank ("The thing I wish I'd done earlier was ___"), or "DM me [specific keyword]" to drive replies. These get responses; "What do you think?" does not.
      - No hashtags needed for Stories.
      - BANNED: transformation / breakthrough / doing the work / showing up / on this journey / manifest / alignment / game changer / hustle culture / thought leader / crushing it.`;
  }

  if (format === 'reel') {
    const styleNotes = {
      talking: "Reel Style — Talking (direct to camera): Share a mindset shift, unpopular opinion, or personal insight. Write as a short spoken script. First 3 seconds = a bold declarative statement — not a question. 'Most people get this completely backwards.' Not 'Have you ever wondered why...?' Be direct, personal, confident.",
      motivation: "Reel Style — Motivation / Values: Write the hook text (max 12 words) — one powerful value-driven statement. Then expand in the caption with a specific real moment that earned this belief. The caption is the proof the hook promises. Without that proof, it's just a poster quote.",
      'tips-tricks': "Reel Style — Tips & Tricks: The reel hook grabs attention; the caption delivers the value. Use an odd number of items (3 or 5 — odd numbers feel more credible than even). Each tip: one sentence, specific, actionable. Hooks: '5 things I stopped doing that changed everything', '3 mistakes I made so you don't have to'.",
    };
    return `Write a Reel hook + caption (80–150 words total).
      - ${styleNotes[subType] || styleNotes.talking}
      - First 3 seconds are everything — open with a scroll-stopping declarative, not a question.
      - COLD OPEN RULE: Start mid-action, mid-thought, or mid-story. Never with an intro or setup. WRONG: "Today I want to talk about something that changed my business." RIGHT: "I lost my biggest client last Tuesday. Here's exactly what I did next." The viewer must feel they interrupted you — not that you're beginning a presentation.
      - Short sentences, high energy, punchy rhythm. Use sentence fragments for emphasis.
      - PRONOUN ARCHITECTURE: Open with "I" (specific experience). Pivot to "you" in the lesson (payoff is about the reader, not the creator).
      - MECHANISM RULE: Never state an outcome without naming HOW. BAD: "This changed my life." GOOD: "Deleting my task list and replacing it with a single weekly goal cut my decision fatigue in half."
      - CTA: one specific ask only. "Comment [keyword] and I'll DM you the full breakdown" drives both comments and DMs simultaneously. Or: "Which of these surprised you most? Comment the number."
      - HASHTAGS: 3–5 specific hashtags after two blank lines. No hashtag with over 500k posts. Hard platform limit: 5 maximum.
      - BANNED COACHING JARGON: transformation / breakthrough / mastery / hustle culture / crushing it / game changer / level up / authentic self / doing the work / showing up / on this journey / manifest / alignment / thought leader / paradigm shift.`;
  }

  if (format === 'normal') {
    const subTypeNotes = {
      personal: `Post type — Personal moment (micro three-act structure):
ACT 1 — Setup (2-3 lines): Name the specific situation with one concrete detail. Time, place, or number. No abstractions.
ACT 2 — Tension (3-4 lines): What went wrong, what was unexpected, what you were feeling in that moment. Do not resolve it yet. This is the emotional core.
ACT 3 — Landing (2-3 lines): The realization — stated as personal experience ("I now think / I stopped / I finally understood"), never as universal advice ("The lesson is / This shows that").
The insight must appear in the LAST paragraph of the body, not the first. Burying the payoff makes people read to the end.`,
      insight: `Post type — Opinion / Insight:
Open with a bold declarative — no warmup, no "I've been thinking about this a lot." Just the claim. "Most people get [X] completely backwards."
Back it immediately with one specific example from their actual work or background — proper noun, number, or named situation.
Do not hedge the claim anywhere in the body. State it as true.
Close with the implication for the reader's next decision, not a summary of the post.`,
      question: `Post type — Open question:
Do NOT open with the question itself — that kills tension. Open with the specific situation that made you start asking it.
Give 2–3 sentences of context showing why this question matters and why you haven't resolved it.
End with the actual question — short, direct, one sentence. It must feel like you genuinely do not know the answer.
The best open-question posts make readers comment because they actually have an answer.`,
    };
    return `Write a single Instagram feed caption (150-220 words).

ABOVE THE FOLD — first ~125 characters (critical):
These appear before the "more" cutoff on mobile. All-or-nothing. Must establish tension and withhold resolution. Must NOT complete its thought.
Proven hook openers (pick the type that fits the content):
- Confession: "I almost [quit/lost everything/fired my best client]..."
- Challenge: "Hard pill:" / "Stop [gerund]." / "Unpopular opinion:"
- Story: "[Specific timeframe]. [One concrete detail, no explanation.]"
- Revelation: "Nobody talks about [specific thing] enough."
- Proof: "I spent [specific time] on [specific thing]. Here's what I found."
NEVER start with: "Have you ever…" / "Did you know…" / a greeting / "Happy [day]" / "Good morning".

BODY STRUCTURE:
- 3–5 short paragraphs, 1–3 lines each, blank line between each.
- Rhythm pattern: short paragraph → longer paragraph → short → CTA. Never all paragraphs the same length.
- At least one sentence fragment used for emphasis (once only — not in every paragraph).
- MID-BODY REHOOK (paragraph 3): One short sentence that resets attention. Options: "Here's the part nobody talks about:" / "This is where it gets counterintuitive:" / A sentence that contradicts or complicates what you just said. This holds dwell time past the first scroll.
- ${subTypeNotes[subType] || subTypeNotes.personal}

PRONOUN ARCHITECTURE:
Open with "I" (establishes credibility through specific experience). Pivot to "you" for the application (transforms creator experience into reader insight). Use "we" only for shared struggle.

TENSE STRATEGY — narrative transportation technique:
Past tense for narrative setup. Shift to PRESENT TENSE for the emotional peak moment ("I'm standing there thinking..."). Return to past or present for the landing. This tense shift extends dwell time — readers slow down at present-tense emotional scenes.

CTA (one line, pick one type and be specific):
- For SHARES (highest algorithm weight): "Send this to [specific type of person] without saying a word."
- For SAVES: "Save this for when you're [specific named situation — not just 'save this']."
- For COMMENTS: binary choice ("A or B?"), fill-in-blank, or "Drop a [emoji] if this is you."
Never: "Let me know in the comments" / "What do you think?" / "Drop your thoughts below."

MECHANISM RULE: Never state an outcome without naming the mechanism.
BAD: "This changed everything for me." — GOOD: "Cutting my offer from 6 services to 1 raised my close rate from 20% to 68%."
Every outcome → specific cause. Every claim → specific evidence or method.

KEYWORD-FIRST: Embed the primary topic keyword naturally in the first 1–2 sentences. Instagram now crawls captions for search ranking.

HASHTAGS: 3–5 specific hashtags after two blank lines. No hashtag broader than 500k posts. Maximum 5 — hard platform limit since December 2025.

BANNED: "In today's world" / "It's no secret that" / "When it comes to" / "At the end of the day" / "I'm excited to share" / "Honored and humbled" / passive voice / capitalizing Success / Mindset / Abundance / Journey as spiritual nouns / any sentence that could appear on a motivational poster unchanged.
COACHING JARGON (also banned): transformation / breakthrough / mastery / outside the box / outside your comfort zone / embrace change / thought leader / guru / paradigm shift / hustle culture / crushing it / game changer / level up / authentic self / passion project / doing the work / showing up / on this journey / manifest / alignment / abundance mindset / SMART goals / learnings (use "lessons") / synergy / incentivize.`;
  }

  // Default: carousel post
  const categoryStructure = {
    educational:
      'FORMAT — Educational / Tips list: Use an odd count (5 or 7, never 4 or 6). Number each item visually on its slide. Order by surprise value — not alphabet, not obvious-first. Put the most counterintuitive item at slide 5–6. Final body slide: condensed "Quick recap" of all items — designed to be screenshot-saved.',
    'how-to':
      'FORMAT — Step-by-step / How-to: Each slide = one step, headline starts with an action verb ("Do this", "Map out", "Cut the"). Add a one-line "why" under each step — never explain what without why. Final body slide: restate the outcome the reader will achieve once all steps are done. "Step X of Y" counter visible on each slide.',
    transformation:
      "FORMAT — Transformation / Story arc: Slide 1 = the after state (outcome) with one specific detail. Slide 2 = the before state — be specific and vulnerable, use exact numbers. Middle slides = what changed (the turning points), written as diary entries, not a report. Never use 'journey'. Final body slide: lesson extracted from the experience — stated as a rule the reader can steal.",
    'myth-busting':
      'FORMAT — Myth vs. Truth: Slide 1 = the most alarming or widely-held myth, stated sympathetically ("You\'ve probably heard that…"). Each myth slide is immediately followed by a truth slide that flips the expectation completely — use data, personal proof, or a named counter-example. Add the consequence: "Believing this costs you [specific thing]". Final body slide: "The real rule is…" — the positive version of the last truth.',
    storytelling:
      'FORMAT — Story arc: Open with the most dramatic moment, not the beginning. Use: one specific scene (time + place + sensory detail) → the conflict or revelation → what changed → the lesson the reader can apply TODAY. First person throughout. Never summarize the moral — show the moment it clicked. End before the lesson becomes a lecture.',
    frameworks:
      'FORMAT — Framework / System: Give the framework a name (2–4 words, acronym optional). Each slide = one component with a short label + one sentence on how to apply it. Final body slide: "When to use this" — the specific trigger situation. Make every slide screenshot-worthy independently.',
  };
  return `Write an Instagram carousel post with clearly labeled slides. Apply ALL rules below.

━━━ SLIDE 1 — HOOK (max 10 words) ━━━
The hook determines reach. It must be readable at thumb-scroll speed (under 0.7 seconds). NO vague promises.
Use EXACTLY ONE of these 6 proven formulas — adapted to the brand's content and voice:
  1. Information gap:   "The one [thing] that determines [outcome] — most people miss it"
  2. Loss / mistake:    "Stop [doing common thing]. Here's what it's costing you."
  3. Specificity:       "I [did X] for [specific timeframe]. Here are the [N] things I learned." (use odd numbers: 3, 5, 7)
  4. Story:             "I [dramatic event]. Here's what happened next." (specific, vulnerable, stakes clear)
  5. Contrarian:        "[Common accepted belief] is wrong. Here's what actually works."
  6. Promise:           "How to [specific outcome] in [timeframe] (even if [the main objection])"
NEVER START WITH: "Today I want to share" / "I've been thinking about" / "In today's world" / vague intros / rhetorical questions with obvious answers.
End Slide 1 with "Swipe →" — this indicator increases swipe-through 15–30%.
Text placement: keep text in the top 60% of the slide (Instagram UI covers the bottom third on mobile).
TARGET: 7–10 slides total. Under 6 feels thin; over 10 loses the audience before the CTA.

━━━ SLIDE 2 — STAKES ━━━
Why does this matter RIGHT NOW for this specific person? What do they lose or miss if they don't know this?
Max 2 short sentences. No slide numbers on this one — it should feel like a natural follow-up to the hook.

━━━ SLIDE 3 — REHOOK (mandatory) ━━━
Audience attention drops sharply after slide 2. Slide 3 must re-engage skimmers before continuing.
Start slide 3 with ONE of these transition openers:
  — "But here's what most people miss:"
  — "The counterintuitive part:"
  — "Wait — this changes everything:"
  — "Here's where it gets interesting:"
Deliver genuine value on this slide AND reset attention for the remaining slides. This is your second hook.

━━━ SLIDES 4–N — BODY (one idea per slide — non-negotiable) ━━━
WORD BUDGET: 15–25 words per slide body. Hard cap: 30 words. NOT 3–5 sentences.
ONE IDEA PER SLIDE. If you find yourself writing "also" or "and", split into two slides.
HEADLINE: 3–6 words, action-verb first ("Fix this first", "Cut the middle step", "Never skip this").
EVERY OTHER slide must include a specific number, name, or concrete example — specificity = credibility.
SWIPE TRIGGER: End each body slide with EITHER a complete, satisfying resolution OR an open loop that forces the next swipe:
  — Open loop examples: "But here's where most people get it wrong…" / "The exception is coming up next." / "This works — unless you make this one mistake."
  — Resolution examples: A complete, punchy sentence that closes the thought satisfyingly.
COUNTERINTUITIVE PEAK: At slides 5–6, place the most surprising or unexpected point. Audience drop-off spikes after slide 5 — max value at max risk.
NEVER: walls of text / restating the same point across slides / multiple ideas on one slide / burying the punchline at slide 8.

━━━ SECOND-TO-LAST SLIDE — SCREENSHOT SLIDE ━━━
Condensed summary. All key points in shortest possible form. Label it "Quick recap:" or the equivalent.
Design rule: this slide should make sense if screenshot in isolation. This is the slide that gets DM'd to friends.

━━━ FINAL SLIDE — CTA ━━━
ONE ask. Not two. Not "save, follow, and comment." One.
Choose based on what serves this content:
  — Save ask:    "Save this for the next time you [specific scenario]" — NEVER "Save this for later" (too generic — name the exact situation)
  — Comment ask: "Comment [specific word or number] if [this applies to you]" — NEVER "Let me know what you think"
  — Share ask:   "Tag a [specific type of person who needs this]" — never generic "tag a friend"
  — Follow ask:  "Follow for [specific weekly value: what, how often, why it's useful]"
  — DM trigger:  "DM me '[one word]' and I'll send you [specific asset]"
Before the ask: restate the value delivered in one sentence ("You now have [X].").

━━━ CAPTION (after slides) ━━━
2–3 sentences. One personal detail or vulnerability NOT in the slides. First sentence contains the primary keyword naturally (Instagram search indexes captions).
HASHTAGS: 3–5 specific hashtags on a new line. Maximum 5. Hard limit since December 2025.

━━━ FORMAT NOTES ━━━
${categoryStructure[subType] || categoryStructure.educational}

━━━ VOICE ━━━
Reading level: 5th–7th grade equivalent. Conversational authority — like a smart friend who knows their stuff.
"You" appears more than "I" in body slides. Second person is dominant.
Sentence length: 7–10 words average. Fragments are fine. No complex subordinate clauses.
Never hedge: remove "maybe", "might", "could be", "kind of", "sort of" from every sentence.
Active verbs, present tense where possible. Concrete nouns over abstract concepts.
MECHANISM RULE: Never state an outcome without naming the mechanism. BAD: "This changed everything." GOOD: "Cutting from 6 offers to 1 tripled my close rate." Every claim → specific cause or evidence.

BANNED: Moreover / Furthermore / That being said / tapestry / resonate / delve / pivotal / showcase / passive voice / "It goes without saying" / "As you can see" / "In today's world" / "It's no secret that" / "When it comes to" / "At the end of the day" / "I'm excited to share" / capitalizing Success/Mindset/Journey as spiritual nouns.
COACHING JARGON (also banned): transformation / breakthrough / mastery / outside the box / outside your comfort zone / embrace change / thought leader / guru / paradigm shift / hustle culture / crushing it / game changer / level up / authentic self / passion project / doing the work / showing up / on this journey / manifest / alignment / SMART goals / learnings (use "lessons") / synergy / incentivize.`;
}

function buildTwitterInstructions(format) {
  if (format === 'thread') {
    return `Write a Twitter/X thread of 5-8 tweets.
Label each tweet [1/N], [2/N] etc. at the end of the tweet text.

- Tweet 1 (Hook): Bold declarative or surprising claim. Under 240 chars. Must make the reader want tweet 2.
- Tweets 2-N-1 (Body): Each tweet = one idea. Short. Punchy. Can end mid-thought to pull forward.
- Final tweet: The real point, or a CTA. One targeted hashtag max in the final tweet only.
- No hashtags in body tweets.
- Sentence rhythm: Mix fragments with full sentences. Never start 3 consecutive tweets with "I".
- Between tweets: use "—" as separator (the caller will split on this).

Return each tweet on its own line separated by ---`;
  }
  return `Write a single tweet (max 280 characters, no exceptions).

- Lead with the most surprising or valuable word in the whole thought.
- No windup, no setup. Direct value only.
- Line breaks for visual emphasis where it helps.
- Optional: one targeted hashtag at the end — only if it adds discovery value.
- Never use "RT if you agree" or engagement bait.
- Output ONLY the tweet text.`;
}

function buildTikTokInstructions() {
  return `Write a TikTok video script (60-90 seconds when spoken at a conversational pace, ~150 words max).

HOOK (first 2-3 seconds — 1-2 sentences):
- Bold declarative or pattern interrupt. NOT a question.
- Examples: "You're doing [X] completely backwards." / "I tried [X] for [Y] — here's what actually happened."
- This determines whether someone swipes. Hard stop only.

BODY (3-5 key points or one story arc):
- Each point: 1-2 spoken sentences. Contractions throughout.
- If story: specific moment → tension → resolution (no more than 3 sentences each)
- One unexpected detail or turn that surprises the viewer
- [TEXT: "..."] markers where bold on-screen text reinforces key points

CLOSE (5-10 seconds):
- One specific CTA: "Follow for [specific type of content]" OR "Comment [word] and I'll send you [specific thing]"
- Never: "Like and subscribe" / "Let me know what you think"

Write as if speaking, not reading. Short sentences. Sound human, not scripted.`;
}

function buildEmailInstructions(subType = 'value') {
  const subTypes = {
    value: 'STRUCTURE — Value / Teaching: One useful insight or framework. Hook → why it matters → the insight → how to apply it → closing thought. Each section 2-4 short paragraphs.',
    story: 'STRUCTURE — Personal story: One specific experience → what happened → what changed → what it means for the reader. Feel like a personal letter, not a post.',
    curation: 'STRUCTURE — Curated roundup: 3-5 hand-picked resources or ideas with a 2-3 sentence personal take on each. Why does THIS reader care about THIS thing? No filler intros.',
  };
  return `Write an email newsletter edition.

SUBJECT LINES (write 3 options, label A / B / C):
- A: Curiosity gap ("The [X] most people ignore")
- B: Specific benefit ("How to [X] in [timeframe]")
- C: Personal / story ("I almost [X]. Then this happened.")

PREVIEW TEXT (1 line, max 90 chars): shown in inbox after subject — complete the intrigue, do not repeat it.

---

BODY (500-900 words):
- Open with a personal hook or specific scene — NOT "Hey [name]" or "Welcome to issue #X"
- ${subTypes[subType] || subTypes.value}
- Short paragraphs, max 3 sentences. Frequent blank lines.
- Write like a smart friend who researched this for you.
- At least one bolded phrase per section as a visual anchor.
- Avoid: passive voice, corporate formality, excessive exclamation marks.

CLOSING CTA (1-2 lines):
- One ask only: reply, click one link, or share with one specific person.

SIGN-OFF: Natural and personal, not "Best regards."

P.S. LINE: One punchy final thought, tease of next edition, or bonus resource.`;
}

async function scoreBrandVoice(post, strategy) {
  const response = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `Rate this social media post against the brand voice guidelines. Score 1-10.

BRAND VOICE:
Adjectives (this post should feel like): ${(strategy.brand_voice?.adjectives || []).join(', ')}
Always do: ${(strategy.brand_voice?.do || []).join(' | ')}
Never do: ${(strategy.brand_voice?.dont || []).join(' | ')}

POST:
${post}

Scoring:
- 8-10 (green): Clearly embodies the voice — adjectives present, do's followed, dont's avoided
- 5-7 (yellow): Mostly aligned, minor drift or missed opportunity
- 1-4 (red): Significant misalignment — multiple dont's or missing core approach

Return ONLY valid JSON:
{"score": 8, "note": "one sentence on key strength or main issue"}`,
    }],
  });
  return JSON.parse(response.choices[0].message.content);
}

async function selfCritiquePost(post, platform) {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{
      role: 'user',
      content: `Audit this ${platform} post against 6 rules. Fix every violation. Return ONLY the final post — no preamble, no explanation, no quotes around it.

POST TO AUDIT:
${post}

RULES — check every one, fix any that fail:

1. SPECIFICITY: Check whether the first 3 sentences contain at least one concrete detail: a number, a name, a date, a place, or a measurable outcome. If a specific detail is already present, good. If absent, do NOT invent one — instead, sharpen the existing language to be more precise and direct without fabricating facts.

2. RHYTHM VARIETY: The post must contain (a) at least one sentence of 5 words or fewer used for emphasis, and (b) at least one sentence of 25+ words. If either is missing, adjust a sentence to create it. No two consecutive paragraphs may be the same length — if they are, break one with a standalone short sentence.

3. BANNED WORDS AND CHARACTERS — replace any of these with plain, direct alternatives:
   delve / delve into / leverage (as verb) / landscape (as metaphor for industry) / tapestry / journey (as metaphor for career or growth) / resonate / illuminate / navigate (metaphorically) / showcase / fostering / bolstered / pivotal / crucial / testament / cornerstone / vibrant / meticulous / Moreover / Furthermore / Additionally / In conclusion / In summary / That being said / Having said that / With that being said / It is worth noting / It's worth noting / Let's dive in / serves as (as a replacement for "is") / stands as / Not only X but also Y (as structural pattern) / nuanced (without specific elaboration following it)
   EM DASH (—): Replace every em dash with a colon, comma, or rewrite the clause. This character must not appear anywhere in the final post.

4. NON-RESOLUTION: The ending must NOT summarize the lesson, state the takeaway, or tell the reader what to conclude. If it does, cut that sentence. End at the last real moment, observation, or question the writer is genuinely still holding — not one engineered to sound humble.

5. NO METRONOMIC RHYTHM: If more than 2 consecutive sentences are the same approximate length, break the pattern. Add a fragment. Or let one sentence run long.

6. TEMPORAL OR SENSORY GROUNDING: Check whether the post contains at least one grounding detail — a specific time, place, or physical sensation. If one is present, good. If absent, do NOT fabricate one — instead, check whether there is a vague reference ("recently", "one morning") that can be made more concrete based on what is already in the post. Never invent a location, date, or detail not implied by the existing text.

7. MECHANISM CHECK: Scan for vague outcome claims — phrases like "this changed everything", "I grew significantly", "it worked", "it made a huge difference", "I saw results". For each, either (a) sharpen the language using the mechanism or cause already implied in the post — or (b) remove the vague claim entirely. Do NOT invent specifics not in the original text. Declarative outcomes without mechanisms destroy credibility with personal brand audiences.

Return ONLY the revised post. If all 7 rules pass, return the original unchanged.`,
    }],
  });
  return response.choices[0].message.content.trim();
}

async function verifyAndFixFabrications(post, personalityMap) {
  const auditResponse = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `You are a fact-checker. Identify every specific claim in this social media post and verify each one against the source data.

SOURCE DATA (the ONLY facts this post is allowed to reference):
${JSON.stringify(personalityMap, null, 2)}

POST TO CHECK:
${post}

A "specific claim" is: any number, statistic, date, timeframe, person's name, place name, client result, dollar amount, percentage, or measurable outcome mentioned in the post.

For each specific claim, determine:
- SUPPORTED: the value appears in the source data (exact or reasonable paraphrase of something there)
- UNSUPPORTED: the value does not appear anywhere in the source data — it was invented

Return ONLY valid JSON:
{"claims":[{"claim":"exact text of the claim","supported":true,"source_field":"field name or null"}],"has_fabrications":false}`,
    }],
  });

  const audit = JSON.parse(auditResponse.choices[0].message.content);
  const fabricated = (audit.claims || []).filter(c => !c.supported);
  if (!fabricated.length) return post;

  const fixResponse = await openai.chat.completions.create({
    model: MODEL,
    messages: [{
      role: 'user',
      content: `This social media post contains fabricated claims — specific details invented by AI that don't exist in the source data. Revise the post to remove or generalize every fabricated claim listed below.

FABRICATED CLAIMS TO FIX:
${fabricated.map(c => `- "${c.claim}"`).join('\n')}

Rules for each fabrication:
- Specific number or statistic not in source: remove the number, rewrite the sentence without it. Use a general qualifier only if the underlying point is still supported.
- Name or place not in source: remove it, rewrite without the specific reference.
- Entire sentence depends on the fabrication with no source grounding: cut it.
- Do NOT replace one invented detail with another — remove or generalize only.

SOURCE DATA (the only facts allowed):
${JSON.stringify(personalityMap, null, 2)}

ORIGINAL POST:
${post}

Return ONLY the revised post text. No explanation, no preamble.`,
    }],
  });

  return fixResponse.choices[0].message.content.trim();
}

// Generate a social post
async function generatePost(personalityMap, strategy, platform, pillar, tone, customTopic, instagramOptions = {}, topPosts = [], brandType = 'personal', extraContext = null, referenceSummaries = null, styleFingerprint = null, brandContext = null, learnedRules = null, machineCTA = null, monetizationPaths = null) {
  const pillarData = customTopic
    ? { name: 'Custom Topic', description: customTopic }
    : (strategy.content_pillars.find(p => p.id === pillar) || strategy.content_pillars[0]);

  const igFormat = (instagramOptions || {}).format || 'post';
  const igSubType = (instagramOptions || {}).subType || '';

  const isPersonal = brandType !== 'business';

  const linkedinPersonal = `Write a LinkedIn post (150-250 words).

STRUCTURE:
- Hook (1-2 lines): Drop the reader mid-scene or mid-thought. No windup. No "Today I want to talk about..."
- Body (3-5 short paragraphs, 1-3 lines each): One idea per block. Build from the hook.
- Ending: A real question they're still sitting with, or a quiet observation. NOT a lesson summary. NOT a call-to-action prompt.

SENTENCE RHYTHM — mandatory, not optional:
The post MUST contain:
- At least one sentence of 5 words or fewer (used for raw emphasis)
- At least one sentence of 25+ words (earns the short sentence by grounding context)
- At least one sentence beginning with "And", "But", "So", or "Because" — humans do this constantly
- No two consecutive sentences beginning with the same word class (noun → verb → clause → fragment — mix it)

SPECIFICITY RULE:
Every abstract claim should be grounded in a real detail from their personality map — a number, a name, a date, a place, or a specific situation. Only use details that actually appear in their data. Do not invent specifics. If no matching detail exists, state the claim generally or cut it.

GROUNDING REQUIREMENT:
If their personality map contains a specific time, place, or physical detail, use it to ground the post. If not, do not invent one — write without it rather than fabricating.

NON-RESOLUTION — mandatory:
Do NOT summarize the lesson at the end. Do NOT tell the reader what to take away or conclude. End before the moral — stop at the last real moment, the genuine question still open, or the quiet observation. The reader should feel like they caught you mid-thought, not received a packaged insight.

BANNED OPENERS — the first word must NOT be:
"I" / "Today" / "In" / "As" / "The" / "We"

BANNED PHRASES — never write any of these:
"In today's world/landscape/fast-paced environment"
"I'm excited/humbled/thrilled/honored to share"
"Let that sink in."
"Here's the thing:" / "Here's what I've learned:" / "Here's the truth:"
"Not many people talk about this" / "Unpopular opinion:"
"This changed everything" / "game-changer" / "game changer"
"Key takeaway:" / "The lesson here is:" / "What this taught me:"
"Moving the needle" / "leverage" (as verb) / "synergy" / "bandwidth"
"I'm passionate about" / "I'm on a mission to"
"At the end of the day"
"Drop your thoughts in the comments" / "What do you think? Let me know below"
"I am grateful for" / "I am blessed"
"delve" / "delve into"
"resonate" / "illuminate" / "navigate" (metaphorically)
"tapestry" / "journey" (as metaphor for career or growth)
"Moreover" / "Furthermore" / "Additionally" / "In conclusion" / "In summary"
"That being said" / "Having said that" / "It is worth noting"
"serves as" (as replacement for "is") / "stands as a testament to"
"fostering" / "bolstered" / "pivotal" / "cornerstone" / "vibrant" / "meticulous"
"Not only X but also Y" (as structural template)
"showcase" / "showcasing"
"mindset" / "mindset shift" / "mental shift" (replace with the concrete outcome — never the method)
"resonates with" / "resonating with" (when used to describe your offer's effect on people)
"energy" / "vibration" / "alignment" (as vague transformation descriptors)
"transformation journey" / "holistic approach" / "unique combination of X and Y"
"I help you with [process name]" — always replace with the concrete result the client will have

OUTCOME RULE — mandatory:
Never describe the method, tool, or process you use. Describe only the concrete result the client will have.
BAD: "I help you shift your mindset" / "I provide a holistic approach to growth"
GOOD: "Your calendar fills up. You stop second-guessing your prices." / "Three months later, you raise your rates and clients say yes."
Every benefit claim must name a specific, observable change in the reader's life or business.

CTA RULE — one action only:
End with exactly ONE specific action. If the post implies multiple things the reader could do, pick the most important and cut the rest.

WHAT AUTHENTIC POSTS DO:
- Start with a specific moment already in progress, not a setup
- Let the story prove the point — never state the lesson out loud
- Include one moment of doubt, self-correction, or things not going to plan
- Name something slightly embarrassing or unresolved — not wrapped up
- Repeat a key word deliberately rather than rotating synonyms for it

FORMATTING: 3-5 hashtags on their own line at the end. No emojis unless natural to their voice. Line break between each paragraph.`;

  const linkedinBusiness = `Write a LinkedIn post (150-250 words) for a company brand page.

VOICE: First person plural — "we", "our", "us". Written as the company, not an individual. Natural and human, not corporate-speak.

STRUCTURE:
- Hook (1-2 lines): Drop the reader into a real situation the company faced or a sharp industry observation. No "We're excited to announce..."
- Body (3-5 short paragraphs, 1-3 lines each): Show the company's thinking, a client result, a lesson learned, or a contrarian take. One idea per block.
- Ending: A genuine question for their audience OR a quiet, specific observation. NOT a lesson summary.

SPECIFICITY RULE:
Every claim must be grounded in real data from the brand brief — actual client results, specific projects, named outcomes. Only use details that appear in their data. Do not fabricate case study numbers or invent client scenarios. If no specific result exists for a claim, describe the work generally rather than inventing metrics.

GROUNDING: If the brand brief contains a specific timeframe, location, or project context, use it. If not, do not invent one.

NON-RESOLUTION: Do NOT summarize the lesson. End at the last real moment or genuine open question.

BANNED OPENERS — first word must NOT be:
"Today" / "In" / "As" / "The" / "We're excited"

BANNED PHRASES:
"We're thrilled/excited/honored to announce" / "game-changer" / "synergy" / "leverage" (as verb) / "At the end of the day" / "In today's fast-paced world" / "delve" / "Moreover" / "Furthermore" / "That being said" / "serves as" / "fostering" / "pivotal" / "cornerstone" / "showcase"
"mindset" / "mindset shift" (replace with the concrete outcome delivered)
"resonates with" / "resonating with" (when describing your offer's effect)
"holistic approach" / "unique combination of X and Y" / "transformation journey"
"We help you with [process name]" — always state the result the client achieves, not the service delivered

OUTCOME RULE — mandatory:
Never describe the service, method, or process. Describe the concrete result the client will have.
BAD: "We provide a holistic approach to business growth" / "We help align your team's mindset"
GOOD: "Their close rate went from 20% to 41% in six weeks." / "The team stopped losing deals they should have won."
Every benefit claim must name a specific, observable change in the client's situation.

CTA RULE — one action only:
End with exactly ONE specific action. If multiple options exist, choose the most important and cut the rest.

WHAT STRONG COMPANY POSTS DO:
- Show real client or team situations, not abstract principles
- Let results and specifics do the talking
- Have a distinct company point of view, not generic industry wisdom
- Sound like a smart team talking openly, not a PR department

FORMATTING: 3-5 hashtags on their own line at the end. No emojis unless aligned with brand voice. Line break between each paragraph.`;

  const twitterFormat = (instagramOptions || {}).format || 'single';
  const emailSubType = (instagramOptions || {}).subType || 'value';

  const platformInstructions = {
    linkedin: isPersonal ? linkedinPersonal : linkedinBusiness,
    instagram: buildInstagramInstructions(igFormat, igSubType),
    twitter: buildTwitterInstructions(twitterFormat),
    tiktok: buildTikTokInstructions(),
    email: buildEmailInstructions(emailSubType),
  };

  const toneInstructions = {
    authentic: `Behavioral requirements: Write as if you're mid-thought, not presenting. At least one sentence must begin with "And" or "But" — humans do this in natural speech. Show a crack somewhere in the post: a mistake, a doubt, something you got wrong, or something still unresolved. Do NOT explain what the crack means — name it and keep moving. Do not tie the ending up neatly. Use "I" at most once per paragraph. Anchor the whole post in one specific real moment — a number, a name, a date from their background — not a general claim.`,
    educational: `Behavioral requirements: Open with the specific moment you encountered the problem — not the solution, not the lesson. Each insight must trace back to something real from their background, not generic advice. Express conviction at the moment of specific experience ("I know this because in 2021 I..."), then let uncertainty return in the closing question. End with a question you are genuinely still holding — not one engineered to get comments. The question should feel like you wrote the post to think something through, not to teach.`,
    storytelling: `Behavioral requirements: First line must land the reader mid-action — no setup sentence, no "let me tell you." Include at least one line of actual dialogue (even an internal one: "I kept thinking, just say no."). Include one physical or temporal anchor — a time of day, a specific place, a sensation you remember. Repeat the key noun deliberately rather than using synonyms for it. Do NOT explain what the story means — end the story and stop. Cut the last sentence if it sounds like a lesson.`,
    motivational: `Behavioral requirements: Show the exact specific moment of failure or doubt — not the lesson extracted from it. Give a real number, a real name, or a real date to ground the moment. The inspiration must come from the specificity of the truth, not from inspiring language — never write a sentence that would look good on a wall poster. Do not start the post with an inspiration frame. Start in the failure, not in the recovery. Allow the ending to point forward without stating the outcome.`,
    casual: `Behavioral requirements: Write like a DM to a smart friend who'd call you out if you were performing. Use contractions throughout. Include one self-deprecating aside in parentheses. Allow one "anyway," "honestly," or "look:" to create natural register shifts. One thought should trail off or not fully resolve. Should feel like it was written in 15 minutes, then barely edited. No professional distance — use "you" to mean one specific type of person, not everyone.`,
    contrarian: `Behavioral requirements: The first sentence must name the specific advice, belief, or claim being challenged — not "conventional wisdom" but the actual thing ("Everyone says you need to post daily to grow. I don't buy it."). Use one concrete example from their actual work or background to show where the conventional belief breaks down. Do not hedge after making the claim. Do not add a "but of course it depends" balance at the end. State your actual position and stop. The post is stronger if the skeptics are not satisfied.`
  };

  const systemPrompt = isPersonal
    ? `You are ghostwriting a social media post for a specific person. You will write in their voice, in first person, as if they typed it themselves.

CRITICAL — NO FABRICATION: You may ONLY reference details that appear in the personality map data provided. Do not invent names, dates, numbers, client results, places, or specific situations that are not in the data. If a detail is not in the map, describe the experience generally or leave it out. Fake specificity is worse than honest vagueness.`
    : `You are ghostwriting a social media post for a company brand. Write in first person plural (we/our/us) from the company's perspective, as if a senior team member typed it. The voice should reflect the company's character, not any single individual.

CRITICAL — NO FABRICATION: You may ONLY reference details, results, and situations that appear in the brand brief provided. Do not invent client names, revenue figures, timelines, case study outcomes, or specific scenarios not in the data. If a detail is not in the brief, describe it generally or omit it. Made-up specifics destroy trust when readers notice them.`;

  const clientLanguageNote = pillarData.client_language?.length
    ? `\n\nCLIENT LANGUAGE — these are the exact words and phrases their target audience actually uses. Mirror this vocabulary in the post; do not replace it with expert jargon:\n${pillarData.client_language.map(p => `• ${p}`).join('\n')}`
    : '';

  const mapBlock = isPersonal
    ? `THEIR PERSONALITY MAP:\n${JSON.stringify(personalityMap, null, 2)}\n\nTHEIR BRAND VOICE:\n${JSON.stringify(strategy.brand_voice, null, 2)}${clientLanguageNote}`
    : `COMPANY BRIEF:\n${JSON.stringify(personalityMap, null, 2)}\n\nCOMPANY BRAND VOICE:\n${JSON.stringify(strategy.brand_voice, null, 2)}${clientLanguageNote}`;

  const realityAnchors = isPersonal
    ? `WHAT MAKES IT FEEL REAL:
- Draw on specific details from their personality map — real experiences, achievements, skills, or values they listed
- Use sentence fragments deliberately for emphasis
- The vocabulary and references fit their background and geography — not generic Western corporate English
- Something slightly unresolved at the end — a question they're still holding, not one they've answered
- Do NOT invent details not in their map — write around gaps honestly rather than filling them with fiction`
    : `WHAT MAKES IT FEEL REAL:
- Draw on real data from the brand brief — actual services, achievements, client outcomes, or team moments listed there
- Show the company's thinking or perspective on their actual work — not invented scenarios
- Vocabulary fits their industry and culture — not generic corporate speak
- Something slightly open at the end — a genuine question or honest tension the company navigates
- Do NOT invent client results, case study numbers, or scenarios not in the brand brief`;

  const aiFails = isPersonal
    ? `HOW AI-WRITTEN POSTS FAIL — avoid every one of these patterns:
- Explaining the lesson instead of showing it ("This taught me that persistence pays off" → just show the persistence, let the reader conclude)
- Vague time references ("Recently", "A few years ago", "Early in my career") → use specific timeframes from their actual history
- Starting 3 or more sentences in the post with "I"
- Transition words that signal AI: "Moreover", "Furthermore", "In essence", "Ultimately", "Importantly", "Notably"
- Perfect grammar and symmetrical structure throughout — human writing has natural rough edges
- Generic emotional language ("I felt so overwhelmed") → use a specific situation or detail instead
- Building to a neat, resolved conclusion — real stories often just stop
- Any sentence that reads like a motivational poster`
    : `HOW AI-WRITTEN POSTS FAIL — avoid every one of these patterns:
- Corporate announcement voice ("We're thrilled to share...", "We're proud to announce...")
- Starting 3 or more sentences with "We"
- Vague impact claims ("We helped a client succeed") → replace with concrete specifics ("One client reduced churn by 23% in 8 weeks")
- Transition words that signal AI: "Moreover", "Furthermore", "In essence", "Ultimately", "Importantly", "Notably"
- Generic values statements ("We believe in transparency and innovation") — show it, don't state it
- Building to a neat marketing conclusion — real company stories have messiness and trade-offs
- Any sentence that would look good on a company careers page poster`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.4,
    messages: [{
      role: 'user',
      content: `${systemPrompt}

${mapBlock}

CONTENT PILLAR: ${pillarData.name} — ${pillarData.description}

CONTENT ARCHITECTURE — think through these before writing a single word:
1. Core Concept: pick ONE pain point from this pillar. State it in one sentence.
2. Clou: why that pain point persists, and what it costs them. 2–3 sentences max.
3. Style Figure: choose ONE device from the list below to make the clou visceral and concrete. Do not use plain narrative if a style figure fits — it almost always does.
4. Pain Bridge: one sentence on the cost of inaction. ("This can lead to [specific outcome].")
5. Bridge: one sentence that pivots to the reader's situation. ("But what does this mean for you?")
6. Resolution: one sentence on what becomes possible when this is solved.
7. CTA: one action only — never two.

STYLE FIGURES — pick one and use it to carry the Core Concept:
• Metaphor: map your concept onto a familiar object or everyday situation (e.g., avoiding grief = staying on the train you hate every morning because getting a license feels hard)
• Equation: X + Y = Z (e.g., avoidance behavior + suppression = eventual burnout — spell it out like a math problem)
• Binary Framing: force a vivid either/or choice (e.g., "60-hour work weeks or 6 focused hours — those are your two options")
• Reframe: flip a limiting belief the audience holds (e.g., "The longer you delay dealing with this, the bigger it grows — delay isn't rest, it's compound interest on pain")
• Borrowed Authority: name a credible external source that validates the claim (e.g., "Harvard's research on avoidance shows..." — only use if data appears in their map or is widely known)
• Paradox: state something that sounds impossible but is true (e.g., "The client who worked fewer hours this quarter generated more revenue than any previous quarter")
• Temporal Shift: create urgency using what is happening right now (e.g., "While you're reading this, your competitor who stopped avoiding this is booking the clients you're not")
• Personification: give an abstract thing human traits (e.g., "Your calendar doesn't lie to you — but you've been lying to it for months")
• Contrast: I own X, not Y (e.g., "I own a process, not a panic" / "We ship decisions, not decks")
• Statistic + Source: ground the pain in real data with a cited source (e.g., "60% of caregivers in the Netherlands show burnout symptoms within 3 years — source: TNO 2023")

PLATFORM: ${platform.toUpperCase()}
${platformInstructions[platform]}

TONE DIRECTION: ${toneInstructions[tone]}

${aiFails}

${realityAnchors}
${topPosts.length > 0 ? `
TOP PERFORMING POSTS — study the emotional tone, level of specificity, and structural approach that made each one work. Do not copy them — extract the pattern and apply it:
${topPosts.slice(0, 3).map((p, i) => `[Top post ${i + 1} — ${p.likes} likes${p.saves ? `, ${p.saves} saves` : ''}${p.comments ? `, ${p.comments} comments` : ''}]
"${p.text.slice(0, 350)}"`).join('\n\n')}
` : ''}
${brandContext ? (() => {
  const bc = brandContext;
  const p = bc.buyer_persona || {};
  const tov = bc.tone_of_voice || {};
  const tovScale = (val, left, right) => {
    if (!val) return '';
    if (val <= 2) return `leans ${left}`;
    if (val >= 4) return `leans ${right}`;
    return 'balanced';
  };
  const lines = [
    '\nBRAND DNA (confirmed by the writer — treat as ground truth for every post):',
    bc.missie    ? `MISSIE (why they exist): ${bc.missie}` : '',
    bc.visie     ? `VISIE (where they're going): ${bc.visie}` : '',
    (bc.kernwaarden || []).length ? `KERNWAARDEN: ${bc.kernwaarden.join(' · ')}` : '',
    (p.archetype || p.situation || p.fear || p.desire) ? [
      'BUYER PERSONA:',
      p.archetype      ? `  Who: ${p.archetype}` : '',
      p.situation      ? `  Situation: ${p.situation}` : '',
      p.fear           ? `  Deepest fear: ${p.fear}` : '',
      p.desire         ? `  Real desire: ${p.desire}` : '',
      p.buying_trigger ? `  Buying trigger: ${p.buying_trigger}` : '',
    ].filter(Boolean).join('\n') : '',
    tov.description ? `TONE OF VOICE: ${tov.description}` : '',
    [
      tovScale(tov.formal_casual, 'formal', 'casual'),
      tovScale(tov.direct_nurturing, 'direct', 'nurturing'),
      tovScale(tov.serious_playful, 'serious', 'playful'),
    ].filter(Boolean).length ? `Voice calibration: ${[tovScale(tov.formal_casual,'formal','casual'),tovScale(tov.direct_nurturing,'direct','nurturing'),tovScale(tov.serious_playful,'serious','playful')].filter(Boolean).join(', ')}` : '',
    bc.offer       ? `OFFER: ${bc.offer}${bc.price_point ? ` (${bc.price_point})` : ''}` : '',
    bc.best_result ? `PROOF POINT: ${bc.best_result}` : '',
    bc.contrarian_belief ? `CONTRARIAN TAKE: ${bc.contrarian_belief}` : '',
    bc.social_goal ? `CONTENT GOAL: ${bc.social_goal.replace(/_/g, ' ')}` : '',
    bc.off_limits  ? `OFF-LIMITS: ${bc.off_limits}` : '',
    '',
    'Use the buyer persona fear and desire to make posts land emotionally. Use the missie to keep posts purposeful. Use the proof point when the pillar calls for credibility. Mirror the tone of voice calibration in every sentence.',
  ];
  return lines.filter(Boolean).join('\n');
})() : ''}${extraContext ? `\nADDITIONAL CONTEXT FROM THE WRITER:\n${extraContext}\n\nUse this as background knowledge and voice calibration. Do not quote it directly — let it inform the specificity and perspective of what you write.\n` : ''}${referenceSummaries && referenceSummaries.length ? `\nREFERENCE MATERIALS — insights from books/articles the writer wants to draw from:\n${referenceSummaries.map(r => `[${r.title}]\n${r.summary}`).join('\n\n')}\n\nDraw on these frameworks and vocabulary where relevant. Don't cite them explicitly unless it fits naturally.\n` : ''}${styleFingerprint ? `\nSTYLE FINGERPRINT — learned from this writer's actual posts. Mirror these patterns:\n${styleFingerprint}\n` : ''}${learnedRules ? `\nLEARNED FROM THIS WRITER'S PERFORMANCE DATA — these rules come from what actually performed well vs. poorly. Follow them closely:
${(learnedRules.do || []).length ? `DO:\n${(learnedRules.do).map(r => `• ${r}`).join('\n')}` : ''}
${(learnedRules.dont || []).length ? `AVOID:\n${(learnedRules.dont).map(r => `• ${r}`).join('\n')}` : ''}
${learnedRules.platform_notes?.[platform] ? `FOR ${platform.toUpperCase()}: ${learnedRules.platform_notes[platform]}` : ''}\n` : ''}${(machineCTA || monetizationPaths) ? `\nCONVERSION MACHINE — the post should organically lead the reader toward this:\n${machineCTA ? `Pillar CTA: ${typeof machineCTA === 'object' ? (machineCTA.ctaText || machineCTA.magnet || '') : machineCTA}` : ''}${machineCTA && (typeof machineCTA === 'object') && machineCTA.link ? ` (${machineCTA.link})` : ''}\n${monetizationPaths ? `Monetization paths: ${monetizationPaths}` : ''}\nWeave this naturally — do not paste the CTA verbatim. End the post in a way that points toward this next step without being salesy.\n` : ''}FORMATTING RULE — ABSOLUTE: Never use the em dash character (—) anywhere in the post. Replace any em dash with a colon, comma, or rewrite the sentence to avoid it entirely.

Write ONLY the post text. Nothing else — no preamble, no "here's the post:", no quotation marks around it.`
    }],
  });

  const firstDraft = response.choices[0].message.content.trim();

  // Short-form platforms skip the LinkedIn/Instagram style critique
  const skipCritique = ['twitter', 'tiktok'].includes(platform);
  const styledDraft = skipCritique ? firstDraft : await selfCritiquePost(firstDraft, platform);
  const finalPost = await verifyAndFixFabrications(styledDraft, personalityMap);

  // 4th stage: brand voice score
  let voiceScore = null;
  let voiceNote = null;
  try {
    const scored = await scoreBrandVoice(finalPost, strategy);
    voiceScore = scored.score;
    voiceNote = scored.note;
  } catch { /* non-fatal */ }

  return { post: finalPost, voiceScore, voiceNote };
}

// ─── Viral Intelligence ──────────────────────────────────────────────────────

const APIFY_BASE = 'https://api.apify.com/v2';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const dream100 = JSON.parse(fs.readFileSync(path.join(__dirname, 'dream100.json')));

function apifyHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}` };
}

async function apifyStartRun(actorId, input) {
  const slug = actorId.replace('/', '~');
  const res = await fetch(`${APIFY_BASE}/acts/${slug}/runs`, {
    method: 'POST',
    headers: apifyHeaders(),
    body: JSON.stringify(input),
  });
  const { data: run } = await res.json();
  if (!run?.id) throw new Error(`Failed to start Apify actor ${actorId}`);
  return run.id;
}

async function apifyCheckRun(runId) {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}`, { headers: apifyHeaders() });
  const { data } = await res.json();
  return data;
}

async function apifyFetchDataset(datasetId) {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?limit=500`, { headers: apifyHeaders() });
  return res.json();
}

function processInstagramItems(raw) {
  return raw
    .filter(p => !p.error && (p.likesCount ?? 0) >= 500)
    .map(p => ({
      platform: 'instagram',
      author: p.ownerUsername ?? p.username ?? 'unknown',
      likes: p.likesCount,
      comments: p.commentsCount,
      text: p.caption ?? '',
      url: p.url ?? '',
    }));
}

function processLinkedInItems(raw) {
  return raw
    .filter(p => (p.engagement?.likes ?? 0) >= 100)
    .map(p => ({
      platform: 'linkedin',
      author: p.author?.name ?? 'unknown',
      likes: p.engagement?.likes ?? 0,
      comments: p.engagement?.comments ?? 0,
      text: p.content ?? '',
      url: p.linkedinUrl ?? '',
    }));
}

async function startInstagramRun() {
  const usernames = dream100.accounts.map(a => a.instagram).filter(Boolean);
  return apifyStartRun('apify/instagram-scraper', {
    directUrls: usernames.map(u => `https://www.instagram.com/${u}/`),
    resultsType: 'posts',
    resultsLimit: 5,
  });
}

async function startLinkedInRun() {
  const profileUrls = dream100.accounts.map(a => a.linkedin).filter(Boolean);
  return apifyStartRun('harvestapi/linkedin-profile-posts', { profileUrls, maxResults: 5 });
}

async function scorePostsVsPersonalityMap(posts, personalityMap) {
  if (!posts.length) return [];
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{
      role: 'user',
      content: `Score these social posts 1-10 for how well they match this person's brand, values, and expertise.
Be generous — a score of 5+ means there's an angle they could authentically borrow.

PERSONALITY MAP:
${JSON.stringify({
  values: personalityMap.values,
  skills: personalityMap.skills,
  expertise: personalityMap.professional_experience?.areas_of_expertise,
  personality: personalityMap.personality_notes,
}, null, 2)}

POSTS:
${posts.map((p, i) => `[${i}] @${p.author} (${p.likes} likes):\n${p.text.slice(0, 300)}`).join('\n\n')}

Return ONLY valid JSON:
{"scores": [{"index": 0, "score": 8, "reason": "one sentence why this fits their brand"}]}`,
    }],
    response_format: { type: 'json_object' },
  });

  const { scores } = JSON.parse(response.choices[0].message.content);
  return posts
    .map((post, i) => {
      const s = scores.find(s => s.index === i) ?? { score: 5, reason: 'Potential angle available' };
      return { ...post, fitScore: s.score, fitReason: s.reason };
    })
    .sort((a, b) => b.fitScore - a.fitScore || b.likes - a.likes);
}

async function generateQuotePost({ personalityMap, strategy, brandContext, topic, tone, brandType }) {
  const isPersonal = brandType !== 'business';
  const brandName = isPersonal
    ? (personalityMap?.name || 'the author')
    : (personalityMap?.company_name || personalityMap?.name || 'the brand');

  const voiceAdjectives = (strategy?.brand_voice?.adjectives || []).join(', ') || 'direct, confident';
  const toneOfVoice = brandContext?.tone_of_voice || voiceAdjectives;

  const toneDirections = {
    authentic: 'Vulnerable, mid-thought. Sounds like something said out loud without editing.',
    educational: 'One sharp observation that reframes how the reader sees a familiar problem.',
    storytelling: 'A captured moment — present tense, sensory, like the first line of a scene.',
    motivational: 'Earned. Grounded in a specific reality, not generic encouragement.',
    casual: 'The thing you say to a smart friend, not a stage. Contractions allowed.',
    contrarian: 'Names a widely-held belief and quietly dismantles it. No hedging.',
  };

  const response = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `Write a short, shareable quote card text for ${brandName}.

TOPIC: ${topic || 'their core expertise and worldview'}

BRAND VOICE: ${toneOfVoice}
TONE DIRECTION: ${toneDirections[tone] || toneDirections.authentic}

RULES — mandatory, non-negotiable:
- 1 to 3 sentences maximum. Shorter is almost always better.
- Every word earns its place. Cut filler ruthlessly.
- No buzzwords: no "game-changer", "synergy", "empower", "unlock", "journey", "elevate", "leverage", "navigate", "thrive"
- No motivational-poster clichés. No rhyming for the sake of it.
- Active voice. Present tense preferred.
- Must feel like it came from a real person with a specific perspective — not a generic caption
- Do NOT start with "I" as the first word
- The subtext (if used) supports the quote — it does NOT repeat it or explain it

BRAND DATA:
${JSON.stringify({
  values: personalityMap?.values,
  expertise: personalityMap?.professional_experience?.areas_of_expertise || personalityMap?.expertise,
  personality: personalityMap?.personality_notes,
  mission: brandContext?.missie || strategy?.unique_value_proposition,
}, null, 2)}

Return ONLY valid JSON:
{
  "quote": "the main quote text (1-3 sentences, max 220 chars)",
  "subtext": "optional supporting line — leave empty string if not needed (max 100 chars)"
}`
    }],
  });

  const parsed = JSON.parse(response.choices[0].message.content);
  return {
    quote: (parsed.quote || '').trim(),
    subtext: (parsed.subtext || '').trim(),
  };
}

async function getCacheRow(platform) {
  const rows = await sql`SELECT posts, cached_at, run_id, run_status FROM viral_cache WHERE platform = ${platform}`;
  return rows[0] ?? null;
}

async function saveCache(platform, posts, datasetId = null) {
  await sql`
    INSERT INTO viral_cache (platform, posts, cached_at, run_id, run_status, dataset_id)
    VALUES (${platform}, ${JSON.stringify(posts)}, NOW(), NULL, 'ready', ${datasetId})
    ON CONFLICT (platform) DO UPDATE SET posts = EXCLUDED.posts, cached_at = NOW(), run_id = NULL, run_status = 'ready', dataset_id = COALESCE(EXCLUDED.dataset_id, viral_cache.dataset_id)
  `;
}

async function saveRunStart(platform, runId) {
  await sql`
    INSERT INTO viral_cache (platform, posts, cached_at, run_id, run_status)
    VALUES (${platform}, '[]', NOW(), ${runId}, 'processing')
    ON CONFLICT (platform) DO UPDATE SET run_id = EXCLUDED.run_id, run_status = 'processing', cached_at = NOW()
  `;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// OAuth initiation routes are browser navigations — can't set headers, so accept token from query param
function requireAuthOrQueryToken(req, res, next) {
  const token = req.query.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const hash = await bcrypt.hash(password, 12);
    const id = crypto.randomUUID();
    await sql`INSERT INTO users (id, email, password_hash) VALUES (${id}, ${email.toLowerCase()}, ${hash})`;
    const token = jwt.sign({ id, email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, email: email.toLowerCase() });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    return serverErr(res, err);
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const rows = await sql`SELECT id, email, password_hash, website_url FROM users WHERE email = ${email.toLowerCase()}`;
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, email: rows[0].email, websiteUrl: rows[0].website_url || '' });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.get('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT email, website_url, linkedin_profile_url FROM users WHERE id = ${req.user.id}`;
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, email: rows[0].email, websiteUrl: rows[0].website_url || '', linkedinProfileUrl: rows[0].linkedin_profile_url || '' });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.put('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const { websiteUrl, linkedinProfileUrl } = req.body;
    await sql`UPDATE users SET website_url = ${websiteUrl || null}, linkedin_profile_url = ${linkedinProfileUrl || null} WHERE id = ${req.user.id}`;
    res.json({ success: true });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.post('/api/upload', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.mimetype.includes('pdf') && !req.file.originalname.toLowerCase().endsWith('.pdf')) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Only PDF files are accepted' });
    }

    const text = await extractPdfText(req.file.path);
    fs.unlinkSync(req.file.path);

    const brandType = req.body.brand_type === 'business' ? 'business' : 'personal';
    const websiteUrl = (req.body.website_url || '').trim();
    const websiteText = websiteUrl ? await fetchWebsiteText(websiteUrl) : null;

    const personalityMap = brandType === 'business'
      ? await parseBrandBrief(text, websiteText)
      : await parsePersonalityMap(text, websiteText);
    const strategy = await generateStrategy(personalityMap, brandType);

    // Extract structured brand context from website (or personality map alone if no site)
    let brandContext = null;
    try {
      const contextSource = websiteText || null;
      if (contextSource) {
        brandContext = await extractBrandContext(contextSource, personalityMap);
      } else {
        // Derive what we can from the personality map itself when no website is provided
        brandContext = await extractBrandContext(
          `Name: ${personalityMap.name || ''}\n` +
          `Skills: ${(personalityMap.skills || []).join(', ')}\n` +
          `Tangible assets (offers): ${(personalityMap.tangible_assets || []).join(', ')}\n` +
          `Professional experience: ${JSON.stringify(personalityMap.professional_experience || {})}`,
          personalityMap
        );
      }
    } catch { /* non-fatal */ }

    const id = crypto.randomUUID();
    await Promise.all([
      sql`
        INSERT INTO sessions (id, name, pdf_name, personality_map, strategy, brand_type, user_id, website_url, brand_context)
        VALUES (${id}, ${personalityMap.name || 'Unknown'}, ${req.file.originalname}, ${JSON.stringify(personalityMap)}, ${JSON.stringify(strategy)}, ${brandType}, ${req.user.id}, ${websiteUrl || null}, ${brandContext ? JSON.stringify(brandContext) : null})
      `,
      websiteUrl
        ? sql`UPDATE users SET website_url = ${websiteUrl} WHERE id = ${req.user.id}`
        : Promise.resolve(),
    ]);

    res.json({ success: true, id, personalityMap, strategy, brandType, brandContext });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.post('/api/upload-reference', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.mimetype.includes('pdf') && !req.file.originalname.toLowerCase().endsWith('.pdf')) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Only PDF files are accepted' });
    }
    const text = await extractPdfText(req.file.path);
    fs.unlinkSync(req.file.path);
    const capped = text.slice(0, 12000);
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{
        role: 'user',
        content: `Extract key insights from this document for a content creator who wants to reference it in social media posts.

Summarize in flowing plain text (~400 words):
1. Core frameworks or models described
2. Key claims or arguments (3–5 points)
3. Specific vocabulary and concepts the creator can use authentically
4. Any statistics, studies, or data points that could ground posts in specificity

Document:
${capped}`,
      }],
    });
    const summary = response.choices[0].message.content.trim();
    const title = req.file.originalname.replace(/\.pdf$/i, '').slice(0, 60);
    res.json({ success: true, title, summary });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/sessions', requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT id, name, pdf_name, created_at FROM sessions WHERE user_id = ${req.user.id} ORDER BY created_at DESC`;
    res.json(rows.map(r => ({ id: r.id, name: r.name, pdfName: r.pdf_name, createdAt: r.created_at })));
  } catch (err) {
    return serverErr(res, err);
  }
});

app.get('/api/sessions/:id', requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT personality_map, strategy, brand_type, brand_context FROM sessions WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true, personalityMap: rows[0].personality_map, strategy: rows[0].strategy, brandType: rows[0].brand_type || 'personal', brandContext: rows[0].brand_context || null });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.put('/api/sessions/:id/brand-context', requireAuth, async (req, res) => {
  try {
    const { brandContext } = req.body;
    if (!brandContext || typeof brandContext !== 'object') return res.status(400).json({ error: 'brandContext object required' });
    await sql`UPDATE sessions SET brand_context = ${JSON.stringify(brandContext)} WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    res.json({ success: true });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.delete('/api/sessions/:id', requireAuth, async (req, res) => {
  try {
    await sql`DELETE FROM sessions WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    res.json({ success: true });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.put('/api/sessions/:id', requireAuth, async (req, res) => {
  try {
    const { strategy } = req.body;
    if (!strategy) return res.status(400).json({ error: 'strategy required' });
    await sql`UPDATE sessions SET strategy = ${JSON.stringify(strategy)} WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    res.json({ success: true });
  } catch (err) {
    return serverErr(res, err);
  }
});

const VALID_PLATFORMS = ['linkedin', 'instagram', 'twitter', 'tiktok', 'email'];
const VALID_TONES = ['authentic', 'educational', 'storytelling', 'motivational', 'casual', 'contrarian'];
const VALID_IG_FORMATS = ['post', 'normal', 'story', 'reel'];
const VALID_TWITTER_FORMATS = ['single', 'thread'];
const VALID_EMAIL_SUBTYPES = ['value', 'story', 'curation'];

app.post('/api/generate-post', requireAuth, async (req, res) => {
  try {
    const { personalityMap, strategy, platform, pillar, tone, customTopic, instagramOptions, sessionId, useAnalytics, brandType, extraContext, referenceSummaries, brandContext: bodyBrandContext, machineCTA, monetizationPaths } = req.body;

    if (!VALID_PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Invalid platform' });
    if (tone && !VALID_TONES.includes(tone)) return res.status(400).json({ error: 'Invalid tone' });
    if (platform === 'instagram' && instagramOptions?.format && !VALID_IG_FORMATS.includes(instagramOptions.format)) {
      return res.status(400).json({ error: 'Invalid Instagram format' });
    }
    if (!personalityMap || !strategy) return res.status(400).json({ error: 'personalityMap and strategy are required' });
    if (referenceSummaries !== null && referenceSummaries !== undefined && !Array.isArray(referenceSummaries)) {
      return res.status(400).json({ error: 'referenceSummaries must be an array' });
    }

    const safeContext = typeof extraContext === 'string'
      ? extraContext.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, 1000)
      : null;

    const safeRefs = Array.isArray(referenceSummaries)
      ? referenceSummaries.map(r => ({
          title: String(r.title || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, 100),
          summary: String(r.summary || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, 500),
        })).slice(0, 10)
      : null;

    // Fetch summaries from the persistent knowledge base
    let allRefs = safeRefs ? [...safeRefs] : [];
    const { knowledgeDocIds } = req.body;
    if (Array.isArray(knowledgeDocIds) && knowledgeDocIds.length) {
      const validIds = knowledgeDocIds
        .filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id))
        .slice(0, 10);
      if (validIds.length) {
        const kRows = await sql`SELECT title, summary FROM knowledge_docs WHERE id = ANY(${validIds}) AND user_id = ${req.user.id}`;
        const kRefs = kRows.map(r => ({ title: r.title, summary: r.summary.slice(0, 500) }));
        allRefs = [...kRefs, ...allRefs].slice(0, 10);
      }
    }
    const finalRefs = allRefs.length ? allRefs : null;

    let topPosts = [];
    if (sessionId && useAnalytics && ['linkedin', 'instagram'].includes(platform)) {
      const rows = await sql`SELECT posts FROM post_analytics WHERE session_id = ${sessionId} AND platform = ${platform} AND user_id = ${req.user.id}`;
      if (rows.length && Array.isArray(rows[0].posts)) {
        topPosts = rows[0].posts.slice(0, 3);
      }
    }

    // Load style fingerprint and brand context for this session if available
    let styleFingerprint = null;
    let sessionBrandContext = null;
    if (sessionId) {
      const sfRows = await sql`SELECT style_fingerprint, brand_context FROM sessions WHERE id = ${sessionId} AND user_id = ${req.user.id}`;
      styleFingerprint = sfRows[0]?.style_fingerprint || null;
      sessionBrandContext = sfRows[0]?.brand_context || null;
    }

    // Load learned prompt rules for this user (from evolution agent)
    let learnedRules = null;
    const rulesRows = await sql`SELECT rules FROM prompt_rules WHERE user_id = ${req.user.id}`;
    if (rulesRows[0]?.rules && Object.keys(rulesRows[0].rules).length) {
      learnedRules = rulesRows[0].rules;
    }
    // Body-supplied brandContext (edited by user) takes precedence over DB snapshot
    const resolvedBrandContext = (bodyBrandContext && typeof bodyBrandContext === 'object')
      ? bodyBrandContext
      : sessionBrandContext;

    const { post, voiceScore, voiceNote } = await generatePost(
      personalityMap, strategy, platform, pillar, tone, customTopic,
      instagramOptions, topPosts, brandType || 'personal', safeContext, finalRefs, styleFingerprint, resolvedBrandContext, learnedRules,
      machineCTA || null, typeof monetizationPaths === 'string' ? monetizationPaths : null
    );

    // Save to generated_posts library
    const postId = crypto.randomUUID();
    const pillarName = customTopic
      ? customTopic.slice(0, 80)
      : (strategy.content_pillars?.find(p => p.id === pillar)?.name || pillar || null);
    await sql`
      INSERT INTO generated_posts (id, session_id, user_id, platform, format, subtype, pillar_name, tone, content, voice_score, voice_note, status)
      VALUES (${postId}, ${sessionId || null}, ${req.user.id}, ${platform},
              ${instagramOptions?.format || null}, ${instagramOptions?.subType || null},
              ${pillarName}, ${tone || null}, ${post}, ${voiceScore}, ${voiceNote}, 'draft')
    `;

    res.json({ success: true, post, voiceScore, voiceNote, savedId: postId });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.post('/api/refine-post', requireAuth, async (req, res) => {
  try {
    const { post, instruction, platform, strategy } = req.body;
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{
        role: 'user',
        content: `You are editing a ${platform} post written in the voice of a specific person. Apply the edit instruction below while preserving their voice, tone, and style.

THEIR BRAND VOICE:
${JSON.stringify(strategy.brand_voice, null, 2)}

CURRENT POST:
${post}

EDIT INSTRUCTION: ${instruction}

Return ONLY the updated post text, nothing else.`
      }],
    });
    res.json({ success: true, post: response.choices[0].message.content.trim() });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.get('/api/viral-trends', requireAuth, async (req, res) => {
  const platform = req.query.platform === 'linkedin' ? 'linkedin' : 'instagram';
  const { personalityMap, reload } = req.query;

  if (!personalityMap) return res.status(400).json({ error: 'personalityMap query param required' });
  if (!process.env.APIFY_API_TOKEN) return res.status(500).json({ error: 'APIFY_API_TOKEN not set' });

  try {
    const row = await getCacheRow(platform);

    // reload=true: use stored dataset_id if we have one, otherwise look it up from Apify
    if (reload === 'true') {
      let datasetId = row?.dataset_id ?? null;

      if (!datasetId) {
        const actorId = platform === 'linkedin' ? 'harvestapi/linkedin-profile-posts' : 'apify/instagram-scraper';
        const slug = actorId.replace('/', '~');
        const runsRes = await fetch(`${APIFY_BASE}/acts/${slug}/runs?status=SUCCEEDED&desc=1&limit=1`, { headers: apifyHeaders() });
        const runsJson = await runsRes.json();
        datasetId = runsJson?.data?.items?.[0]?.defaultDatasetId ?? null;
      }

      if (datasetId) {
        const raw = await apifyFetchDataset(datasetId);
        const posts = platform === 'linkedin' ? processLinkedInItems(raw) : processInstagramItems(raw);
        await saveCache(platform, posts, datasetId);
        const map = JSON.parse(decodeURIComponent(personalityMap));
        const scored = await scorePostsVsPersonalityMap(posts, map);
        return res.json({ success: true, status: 'ready', platform, posts: scored.slice(0, 10) });
      }
      return res.json({ success: false, status: 'failed', error: 'No completed scan found on Apify. Run a fresh scan first.' });
    }

    // Fresh cache — score and return immediately
    if (!reload && row && row.run_status === 'ready' && Date.now() - new Date(row.cached_at).getTime() < CACHE_TTL_MS) {
      const map = JSON.parse(decodeURIComponent(personalityMap));
      const scored = await scorePostsVsPersonalityMap(row.posts, map);
      return res.json({ success: true, status: 'ready', platform, posts: scored.slice(0, 10) });
    }

    // Stuck run — processing for > 30 mins means something went wrong, reset it
    if (row?.run_status === 'processing' && Date.now() - new Date(row.cached_at).getTime() > 30 * 60 * 1000) {
      await sql`UPDATE viral_cache SET run_status = 'failed', run_id = NULL WHERE platform = ${platform}`;
      row.run_status = 'failed';
    }

    // Active run — check its current status on Apify
    if (row?.run_status === 'processing' && row.run_id) {
      const runData = await apifyCheckRun(row.run_id);

      if (runData?.status === 'SUCCEEDED') {
        const raw = await apifyFetchDataset(runData.defaultDatasetId);
        const posts = platform === 'linkedin' ? processLinkedInItems(raw) : processInstagramItems(raw);
        await saveCache(platform, posts, runData.defaultDatasetId);
        const map = JSON.parse(decodeURIComponent(personalityMap));
        const scored = await scorePostsVsPersonalityMap(posts, map);
        return res.json({ success: true, status: 'ready', platform, posts: scored.slice(0, 10) });
      }

      if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(runData?.status)) {
        await sql`UPDATE viral_cache SET run_status = 'failed', run_id = NULL WHERE platform = ${platform}`;
        return res.json({ success: false, status: 'failed', error: `Scrape run ended with: ${runData.status}` });
      }

      // Still running
      return res.json({ success: true, status: 'processing' });
    }

    // No active run — kick one off and return immediately
    const runId = platform === 'linkedin' ? await startLinkedInRun() : await startInstagramRun();
    await saveRunStart(platform, runId);
    console.log(`Started Apify ${platform} run: ${runId}`);
    return res.json({ success: true, status: 'processing' });

  } catch (err) {
    return serverErr(res, err);
  }
});

app.post('/api/remake-post', requireAuth, async (req, res) => {
  try {
    const { viralPost, personalityMap, strategy, platform } = req.body;
    if (!viralPost || !personalityMap || !strategy) {
      return res.status(400).json({ error: 'viralPost, personalityMap, and strategy are required' });
    }

    const platformInstructions = {
      linkedin: 'LinkedIn post (180-280 words). Short paragraphs, strong hook, end with a question or CTA. 3-5 hashtags.',
      instagram: 'Instagram caption (100-180 words). Thumb-stopping first line, casual tone, end with a question. 3–5 hashtags maximum (platform limit).',
    };

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{
        role: 'user',
        content: `You are rewriting a viral post using the "borrowed authority" technique. This means the post opens by referencing or reacting to the original creator — borrowing their credibility and the post's proven virality — then immediately pivots to the writer's own unique perspective, experience, and insight.

BORROWED AUTHORITY TECHNIQUE:
- Open with a brief nod to the original: e.g. "@${viralPost.author} said something that stopped me cold.", "I read @${viralPost.author}'s post on this and had to share my take.", "Everyone's sharing @${viralPost.author}'s post about X. Here's what I'd add."
- Do NOT copy or paraphrase their content — just use them as the launch pad
- Immediately pivot to YOUR OWN real story, experience, or contrarian angle
- The borrowed authority gives instant credibility; the personal story makes it yours
- End stronger and more specific than the original

VIRAL POST TO BORROW FROM (${viralPost.likes?.toLocaleString()} likes by @${viralPost.author}):
${viralPost.text}

WHY THIS FITS THEIR BRAND: ${viralPost.fitReason}

THE WRITER'S PERSONALITY MAP:
${JSON.stringify(personalityMap, null, 2)}

THEIR BRAND VOICE:
${JSON.stringify(strategy.brand_voice, null, 2)}

FORMAT: ${platformInstructions[platform] ?? platformInstructions.linkedin}

Write ONLY the post. First person. Ground the pivot in their real experiences from the personality map — not generic advice. Sound like them, not like a paraphrase of the original.`,
      }],
    });

    res.json({ success: true, post: response.choices[0].message.content.trim() });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── Analytics ────────────────────────────────────────────────────────────────

app.post('/api/analytics/import', requireAuth, async (req, res) => {
  try {
    const { sessionId, platform, posts } = req.body;
    if (!sessionId || !platform || !Array.isArray(posts)) {
      return res.status(400).json({ error: 'sessionId, platform, and posts array required' });
    }
    if (!['linkedin', 'instagram'].includes(platform)) {
      return res.status(400).json({ error: 'platform must be linkedin or instagram' });
    }
    const [session] = await sql`SELECT id FROM sessions WHERE id = ${sessionId} AND user_id = ${req.user.id}`;
    if (!session) return res.status(404).json({ error: 'Session not found' });
    await sql`
      INSERT INTO post_analytics (session_id, platform, posts, imported_at, user_id)
      VALUES (${sessionId}, ${platform}, ${JSON.stringify(posts)}, NOW(), ${req.user.id})
      ON CONFLICT (session_id, platform) DO UPDATE SET posts = EXCLUDED.posts, imported_at = NOW(), user_id = EXCLUDED.user_id
    `;
    res.json({ success: true, count: posts.length });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.get('/api/analytics/:sessionId/:platform', requireAuth, async (req, res) => {
  try {
    const { sessionId, platform } = req.params;
    const rows = await sql`
      SELECT posts, imported_at FROM post_analytics WHERE session_id = ${sessionId} AND platform = ${platform} AND user_id = ${req.user.id}
    `;
    if (!rows.length) return res.json({ success: true, posts: [], importedAt: null });
    res.json({ success: true, posts: rows[0].posts, importedAt: rows[0].imported_at });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.post('/api/parse-carousel', requireAuth, async (req, res) => {
  try {
    const { postText } = req.body;
    if (!postText) return res.status(400).json({ error: 'postText required' });

    const response = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `You are a carousel copywriting expert. Convert the post text below into structured slide objects for a visual carousel builder. You must REWRITE the copy — do not paste sentences from the post verbatim. Apply the copywriting rules below to make each slide compelling, swipeable, and save-worthy. Return ONLY valid JSON.

POST TEXT:
${postText}

━━━ COPYWRITING RULES TO APPLY ━━━

SLIDE 1 (title): The hook must stop the scroll in under 0.7 seconds.
— Max 8 words for "heading". Make it specific, not vague.
— Use one of these formulas: information gap ("The one X that determines Y"), loss/mistake ("Stop doing X"), specificity with number ("5 things I learned from Y"), story ("I did X — here's what happened"), contrarian ("Common belief is wrong"), promise ("How to X in Y timeframe").
— "subheading" adds the stakes or promise (max 8 words).
— "tag" = short all-caps category label like STRATEGY / FRAMEWORK / MINDSET / GROWTH.

BODY SLIDES (content, split, checklist):
— Word budget: 15–25 words in "description". Hard cap: 30 words. NOT paragraphs.
— ONE idea per slide. If content has "also" or covers two points, split into two slides.
— "heading": 3–6 words, action-verb first ("Fix this first", "Do this instead", "Never skip this").
— "highlight": the single most memorable, screenshot-worthy phrase — the sentence someone would underline.
— "description": the explanation. Specific > vague. Include a number, name, or concrete example wherever possible.
— Vary tone: some slides punchy (short sentence + period), some analytical (a concrete "this is why").

QUOTE SLIDES: Only use for a genuinely remarkable insight that works standalone as a pullquote. Max 20 words. Write it as a clean first-person or second-person insight — not a paraphrase.

STAT SLIDES: Only use when a number IS the point. The "number" field should be the visual anchor (e.g. "73%", "3×", "$48K"). The "label" is 2–4 words of context. The "context" sentence must answer "so what?" — what does this number mean for the reader?

CHECKLIST SLIDES: Use when the source material has 3–5 parallel action items or criteria. Each item: 5–8 words, action-oriented, scannable.

SPLIT SLIDES: Use for a single bold insight that deserves visual emphasis — one memorable headline on the right panel, very short description. Best for the "peak" insight around slide 5–6.

CTA SLIDE (final): ONE ask only. Choose the highest-value ask for this content:
— Save: "Save this for [SPECIFIC scenario — name the exact moment, not 'for later']"
— Comment: "Comment [specific word or number] if [this applies to you]"
— Share: "Tag a [specific type of person] who needs this"
— Follow: "Follow for [specific value: what + how often]"
"heading" = the value restatement ("You now have X.") + the CTA. "subtext" = secondary nudge. "action" = the specific instruction.

━━━ SLIDE TYPE REFERENCE ━━━

1. title (first slide only):
{ "type": "title", "heading": "hook max 8 words", "subheading": "stakes or promise max 8 words", "tag": "CATEGORY LABEL", "username": "@yourhandle" }

2. content (numbered body slide):
{ "type": "content", "number": "01", "heading": "action verb + point max 6 words", "description": "15–25 words max. One idea. Specific.", "highlight": "most memorable standalone phrase", "image": null }

3. quote (key pullquote moment):
{ "type": "quote", "text": "clean insight phrase max 20 words", "attribution": "— Source if applicable, else omit key" }

4. stat (when a number is the main point):
{ "type": "stat", "number": "73%", "label": "2–4 word context", "context": "1–2 sentence so-what explanation" }

5. checklist (parallel action items or criteria):
{ "type": "checklist", "heading": "what this list is max 5 words", "items": ["Item one 5–8 words", "Item two 5–8 words", "Item three 5–8 words"] }

6. split (single bold insight needing visual emphasis):
{ "type": "split", "number": "01", "heading": "bold insight 4–6 words", "description": "15–20 words max", "highlight": "optional key phrase" }

7. cta (final slide only):
{ "type": "cta", "heading": "value restatement + CTA headline", "subtext": "secondary nudge or share prompt", "action": "specific follow/save/comment/DM instruction" }

Return: { "slides": [ ...array of slide objects in order... ] }

Hard rules:
— First slide MUST be type "title"
— 5–9 slides total (5 minimum, 9 maximum)
— Number content slides sequentially: "01", "02", "03"
— Strip all hashtags, captions, and trailing text from source
— Never use the same sentence from the post verbatim — rewrite for carousel reading level
— Use "split" or "checklist" types when they fit the content better than plain "content"`,
      }],
    });

    const result = JSON.parse(response.choices[0].message.content);
    if (!result.slides || !Array.isArray(result.slides)) throw new Error('Invalid response structure');
    res.json({ success: true, slides: result.slides });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.post('/api/posts/save-carousel', requireAuth, async (req, res) => {
  try {
    const { sessionId, slides, title, settings } = req.body;
    if (!slides || !Array.isArray(slides) || slides.length === 0) {
      return res.status(400).json({ error: 'slides array required' });
    }
    const postId = crypto.randomUUID();
    const pillarName = (title || slides[0]?.heading || 'Carousel').slice(0, 80);
    const content = JSON.stringify({ slides, settings: settings || {} });
    await sql`
      INSERT INTO generated_posts (id, session_id, user_id, platform, format, pillar_name, content, status)
      VALUES (${postId}, ${sessionId || null}, ${req.user.id}, 'instagram', 'carousel',
              ${pillarName}, ${content}, 'draft')
    `;
    res.json({ success: true, postId });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── Posts Library ────────────────────────────────────────────────────────────

app.get('/api/posts', requireAuth, async (req, res) => {
  try {
    const { sessionId, platform, status } = req.query;
    let rows;
    if (sessionId) {
      rows = await sql`SELECT id, platform, format, subtype, pillar_name, tone, content, subtext, voice_score, voice_note, status, created_at FROM generated_posts WHERE user_id = ${req.user.id} AND session_id = ${sessionId} ORDER BY created_at DESC LIMIT 200`;
    } else {
      rows = await sql`SELECT id, platform, format, subtype, pillar_name, tone, content, subtext, voice_score, voice_note, status, created_at FROM generated_posts WHERE user_id = ${req.user.id} ORDER BY created_at DESC LIMIT 200`;
    }
    if (platform) rows = rows.filter(r => r.platform === platform);
    if (status) rows = rows.filter(r => r.status === status);
    res.json({ success: true, posts: rows });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.patch('/api/posts/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['draft', 'approved', 'published'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await sql`UPDATE generated_posts SET status = ${status} WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    res.json({ success: true });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    await sql`DELETE FROM generated_posts WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    res.json({ success: true });
  } catch (err) {
    return serverErr(res, err);
  }
});

// Quick engagement feedback — lets users enter real metrics directly to seed the learning loop
app.patch('/api/posts/:id/feedback', requireAuth, async (req, res) => {
  try {
    const { likes, comments, shares, saves } = req.body;
    const [post] = await sql`SELECT id, platform, pillar_name, tone FROM generated_posts WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const impressions = Math.max((likes || 0) * 50, 1);
    const engScore = Math.min(100, Math.round(
      ((likes || 0) * 1 + (comments || 0) * 3 + (shares || 0) * 5 + (saves || 0) * 4) / impressions * 100
    ));

    await sql`UPDATE generated_posts SET engagement_score = ${engScore} WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;

    // Write to brain_diary so scoring + evolution agents can learn from it
    const toneLabel = post.tone || 'authentic';
    const pillarLabel = post.pillar_name || 'unknown';
    const platform = post.platform;
    if (engScore >= 70) {
      await sql`
        INSERT INTO brain_diary (id, user_id, type, pattern, insight, platform, pillar_name)
        VALUES (${crypto.randomUUID()}, ${req.user.id}, 'win',
          ${`${platform} — ${toneLabel} tone on ${pillarLabel} pillar`},
          ${`User-reported: ${engScore}/100 score. Likes: ${likes || 0}, Comments: ${comments || 0}, Shares: ${shares || 0}, Saves: ${saves || 0}.`},
          ${platform}, ${post.pillar_name || null})
      `;
    } else if (engScore <= 20) {
      await sql`
        INSERT INTO brain_diary (id, user_id, type, pattern, insight, platform, pillar_name)
        VALUES (${crypto.randomUUID()}, ${req.user.id}, 'loss',
          ${`${platform} — ${toneLabel} tone on ${pillarLabel} pillar underperformed`},
          ${`User-reported: ${engScore}/100 score. Likes: ${likes || 0}, Comments: ${comments || 0}, Shares: ${shares || 0}, Saves: ${saves || 0}.`},
          ${platform}, ${post.pillar_name || null})
      `;
    }

    res.json({ success: true, engagementScore: engScore });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── APPROVAL QUEUE ROUTES ───────────────────────────────────────────────────

app.get('/api/posts/review-queue', requireAuth, async (req, res) => {
  try {
    const posts = await sql`
      SELECT gp.id, gp.platform, gp.format, gp.subtype, gp.pillar_name, gp.tone,
             gp.content, gp.voice_score, gp.voice_note, gp.status, gp.created_at,
             iq.topic as idea_topic, iq.hook as idea_hook, iq.angle as idea_angle
      FROM generated_posts gp
      LEFT JOIN idea_queue iq ON iq.post_id = gp.id
      WHERE gp.user_id = ${req.user.id} AND gp.status = 'draft'
      ORDER BY gp.created_at DESC
      LIMIT 50
    `;
    res.json({ posts, count: posts.length });
  } catch (err) {
    serverErr(res, err);
  }
});

app.patch('/api/posts/:id/approve', requireAuth, async (req, res) => {
  try {
    const [post] = await sql`SELECT id, platform FROM generated_posts WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const [user] = await sql`SELECT preferred_timezone FROM users WHERE id = ${req.user.id}`;
    const { scheduled_for } = req.body;
    const scheduledAt = scheduled_for
      ? new Date(scheduled_for)
      : getOptimalScheduleTime(post.platform, user?.preferred_timezone || 'UTC');

    await sql`
      UPDATE generated_posts
      SET status = 'approved', approved_at = NOW(), scheduled_for = ${scheduledAt.toISOString()}
      WHERE id = ${req.params.id} AND user_id = ${req.user.id}
    `;

    await sql`
      INSERT INTO notification_queue (id, user_id, type, payload)
      VALUES (${crypto.randomUUID()}, ${req.user.id}, 'post_approved', ${JSON.stringify({ post_id: post.id, scheduled_for: scheduledAt.toISOString() })})
    `;

    res.json({ success: true, scheduled_for: scheduledAt.toISOString() });
  } catch (err) {
    serverErr(res, err);
  }
});

app.patch('/api/posts/:id/reject', requireAuth, async (req, res) => {
  try {
    const [post] = await sql`SELECT id, session_id, platform, pillar_name, tone FROM generated_posts WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { reason, note } = req.body;
    await sql`
      UPDATE generated_posts
      SET status = 'rejected', rejection_reason = ${reason || null}, rejection_note = ${note || null}
      WHERE id = ${req.params.id} AND user_id = ${req.user.id}
    `;

    // Feed rejection into brain_diary so Evolution Agent learns from it
    await sql`
      INSERT INTO brain_diary (id, user_id, type, pattern, insight, platform, pillar_name)
      VALUES (
        ${crypto.randomUUID()}, ${req.user.id}, 'rejection',
        ${`${post.platform} — ${post.tone || 'unknown'} tone on ${post.pillar_name || 'unknown'} pillar rejected`},
        ${`Reason: ${reason || 'unspecified'}. ${note ? 'Note: ' + note : ''}`},
        ${post.platform}, ${post.pillar_name || null}
      )
    `;

    // Auto-requeue with fix instruction so AutoGen retries with the feedback baked in
    if (reason || note) {
      const parts = [];
      if (reason) parts.push(`Avoid: ${reason}`);
      if (note) parts.push(`Note: ${note}`);
      const fixInstruction = `Fix from previous rejection — ${parts.join('. ')}. Write a fresh take that resolves these issues.`;

      const sessionId = post.session_id || (await sql`SELECT id FROM sessions WHERE user_id = ${req.user.id} ORDER BY created_at DESC LIMIT 1`)[0]?.id || null;
      await sql`
        INSERT INTO idea_queue (id, user_id, session_id, topic, angle, pillar_name, platform, source, priority)
        VALUES (${crypto.randomUUID()}, ${req.user.id}, ${sessionId},
          ${`Retry: ${post.pillar_name || post.platform} post`},
          ${fixInstruction},
          ${post.pillar_name || null}, ${post.platform}, 'rejection_requeue', 7)
      `;
    }

    res.json({ success: true });
  } catch (err) {
    serverErr(res, err);
  }
});

app.patch('/api/posts/:id/image-url', requireAuth, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl || typeof imageUrl !== 'string') return res.status(400).json({ error: 'imageUrl is required' });

    const url = new URL(imageUrl);
    if (!['https:', 'http:'].includes(url.protocol)) return res.status(400).json({ error: 'imageUrl must be http(s)' });

    const [post] = await sql`SELECT id FROM generated_posts WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    await sql`UPDATE generated_posts SET image_url = ${imageUrl} WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    res.json({ success: true });
  } catch (err) {
    serverErr(res, err);
  }
});

// ─── NOTIFICATION ROUTES ─────────────────────────────────────────────────────

app.get('/api/notifications/count', requireAuth, async (req, res) => {
  try {
    const [row] = await sql`
      SELECT COUNT(*) as count FROM notification_queue
      WHERE user_id = ${req.user.id} AND sent_at IS NULL AND type = 'review_ready'
    `;
    const [drafts] = await sql`
      SELECT COUNT(*) as count FROM generated_posts
      WHERE user_id = ${req.user.id} AND status = 'draft'
    `;
    res.json({ pending: parseInt(drafts?.count || 0) });
  } catch (err) {
    serverErr(res, err);
  }
});

// ─── OAUTH ROUTES ─────────────────────────────────────────────────────────────

app.get('/api/oauth/status', requireAuth, async (req, res) => {
  try {
    const tokens = await sql`
      SELECT platform, platform_username, expires_at, updated_at
      FROM oauth_tokens WHERE user_id = ${req.user.id}
    `;
    const status = {};
    for (const t of tokens) {
      const expired = t.expires_at && new Date(t.expires_at) < new Date();
      const expiringSoon = t.expires_at && new Date(t.expires_at) < new Date(Date.now() + 7 * 24 * 3600 * 1000);
      status[t.platform] = {
        connected: !expired,
        username: t.platform_username,
        expires_at: t.expires_at,
        expiring_soon: !expired && expiringSoon,
      };
    }
    res.json({ oauth: status });
  } catch (err) {
    serverErr(res, err);
  }
});

app.get('/api/oauth/linkedin', requireAuthOrQueryToken, (req, res) => {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'LinkedIn OAuth not configured' });
  const state = jwt.sign({ userId: req.user.id }, JWT_SECRET, { expiresIn: '10m' });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/linkedin/callback`,
    scope: 'openid profile email w_member_social',
    state,
  });
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
});

app.get('/api/oauth/linkedin/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/?oauth=linkedin_denied');
    const { userId } = jwt.verify(state, JWT_SECRET);

    const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/linkedin/callback`;
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/?oauth=linkedin_failed');

    // Get the user's LinkedIn URN and display name
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();

    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 5184000) * 1000);
    await sql`
      INSERT INTO oauth_tokens (id, user_id, platform, access_token, expires_at, scope, platform_user_id, platform_username, updated_at)
      VALUES (${crypto.randomUUID()}, ${userId}, 'linkedin', ${encryptToken(tokenData.access_token)}, ${expiresAt.toISOString()}, ${tokenData.scope || ''}, ${profile.sub || ''}, ${profile.name || profile.email || ''}, NOW())
      ON CONFLICT (user_id, platform) DO UPDATE
        SET access_token = EXCLUDED.access_token, expires_at = EXCLUDED.expires_at,
            scope = EXCLUDED.scope, platform_user_id = EXCLUDED.platform_user_id,
            platform_username = EXCLUDED.platform_username, updated_at = NOW()
    `;
    res.redirect('/?oauth=linkedin_connected');
  } catch (err) {
    console.error('LinkedIn OAuth callback error:', err.message);
    res.redirect('/?oauth=linkedin_failed');
  }
});

app.get('/api/oauth/instagram', requireAuthOrQueryToken, (req, res) => {
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) return res.status(503).json({ error: 'Instagram OAuth not configured' });
  const state = jwt.sign({ userId: req.user.id }, JWT_SECRET, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/instagram/callback`,
    scope: 'instagram_basic,instagram_content_publish,pages_read_engagement',
    response_type: 'code',
    state,
  });
  res.redirect(`https://www.facebook.com/v20.0/dialog/oauth?${params}`);
});

app.get('/api/oauth/instagram/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/?oauth=instagram_denied');
    const { userId } = jwt.verify(state, JWT_SECRET);

    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/instagram/callback`;

    // Exchange code for short-lived token
    const tokenRes = await fetch(`https://graph.facebook.com/v20.0/oauth/access_token?` + new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID,
      client_secret: process.env.FACEBOOK_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    }));
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/?oauth=instagram_failed');

    // Exchange for long-lived token (60 days)
    const llRes = await fetch(`https://graph.facebook.com/v20.0/oauth/access_token?` + new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: process.env.FACEBOOK_APP_ID,
      client_secret: process.env.FACEBOOK_APP_SECRET,
      fb_exchange_token: tokenData.access_token,
    }));
    const llData = await llRes.json();
    const longLivedToken = llData.access_token || tokenData.access_token;
    const expiresIn = llData.expires_in || 5184000;

    // Get Instagram Business Account ID
    const pagesRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?access_token=${longLivedToken}`);
    const pagesData = await pagesRes.json();
    const page = (pagesData.data || [])[0];
    let igUserId = null;
    let igUsername = null;
    if (page?.id) {
      const igRes = await fetch(`https://graph.facebook.com/v20.0/${page.id}?fields=instagram_business_account&access_token=${longLivedToken}`);
      const igData = await igRes.json();
      igUserId = igData.instagram_business_account?.id || null;
      if (igUserId) {
        const nameRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}?fields=username&access_token=${longLivedToken}`);
        const nameData = await nameRes.json();
        igUsername = nameData.username || null;
      }
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    await sql`
      INSERT INTO oauth_tokens (id, user_id, platform, access_token, expires_at, scope, platform_user_id, platform_username, updated_at)
      VALUES (${crypto.randomUUID()}, ${userId}, 'instagram', ${encryptToken(longLivedToken)}, ${expiresAt.toISOString()}, 'instagram_content_publish', ${igUserId || ''}, ${igUsername || ''}, NOW())
      ON CONFLICT (user_id, platform) DO UPDATE
        SET access_token = EXCLUDED.access_token, expires_at = EXCLUDED.expires_at,
            platform_user_id = EXCLUDED.platform_user_id, platform_username = EXCLUDED.platform_username, updated_at = NOW()
    `;
    res.redirect('/?oauth=instagram_connected');
  } catch (err) {
    console.error('Instagram OAuth callback error:', err.message);
    res.redirect('/?oauth=instagram_failed');
  }
});

// ─── Post Variations ──────────────────────────────────────────────────────────

app.post('/api/generate-variations', requireAuth, async (req, res) => {
  try {
    const { post, platform, strategy, personalityMap, tone, brandType } = req.body;
    if (!post || !platform || !strategy) return res.status(400).json({ error: 'post, platform, and strategy required' });

    const isPersonal = (brandType || 'personal') !== 'business';
    const response = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      messages: [{
        role: 'user',
        content: `Generate 4 variations of this ${platform} post. Each variation must have a completely different hook and angle while keeping the same core message and brand voice.

BRAND VOICE:
${JSON.stringify(strategy.brand_voice, null, 2)}

ORIGINAL POST:
${post}

Rules:
- Variation 1: Different emotional hook (start from a different feeling or reaction)
- Variation 2: Different structural approach (e.g. if original is story → try bold opinion, or vice versa)
- Variation 3: Different opening word/phrase that isn't "I", "Today", "In", or "The"
- Variation 4: Shorter, punchier version that keeps the single most powerful idea only

${isPersonal ? 'Write in first person singular.' : 'Write in first person plural (we/our).'}
Do NOT add any preamble or label. Separate each variation with exactly this delimiter on its own line:
---VARIATION---`
      }],
    });

    const raw = response.choices[0].message.content.trim();
    const variations = raw.split('---VARIATION---').map(v => v.trim()).filter(Boolean);
    res.json({ success: true, variations });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── Hook Generator ───────────────────────────────────────────────────────────

app.post('/api/generate-hooks', requireAuth, async (req, res) => {
  try {
    const { topic, platform, strategy, brandType } = req.body;
    if (!topic || !platform) return res.status(400).json({ error: 'topic and platform required' });

    const isPersonal = (brandType || 'personal') !== 'business';
    const platformNote = {
      linkedin: 'LinkedIn posts (first line only — no banner, no setup)',
      instagram: 'Instagram captions (first ~20 words before the "more" cutoff)',
      twitter: 'Tweets (entire tweet or thread opener)',
      tiktok: 'TikTok video hooks (first 2-3 seconds of spoken script)',
      email: 'Email subject lines (max 60 chars)',
    }[platform] || 'social media posts';

    const response = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.9,
      messages: [{
        role: 'user',
        content: `Generate 10 scroll-stopping hooks for ${platformNote} on this topic.

TOPIC: ${topic}

BRAND VOICE ADJECTIVES: ${(strategy?.brand_voice?.adjectives || []).join(', ') || 'not specified'}

Use all 10 of these proven hook frameworks — one each:
1. Confession: "I almost [bad outcome]..."
2. Contradiction: "[Common belief]. [Why that's wrong in one line]."
3. Specific number: "[Number] [things/mistakes/lessons] about [topic]"
4. Pattern interrupt: "[Unexpected thing] changed [expected thing]."
5. Hard pill: "Hard pill:" or "Unpopular opinion:" + the claim
6. Story drop: "[Specific timeframe or place]. [Single detail, no explanation.]"
7. Revelation: "Nobody talks about [specific thing] enough."
8. Proof: "I spent [specific time] on [specific thing]. Here's what I found."
9. Question subversion: Lead with the specific situation that made you start asking the question — NOT the question itself
10. Bold claim: The most controversial true thing about this topic, stated flatly

${isPersonal ? 'Voice: first person singular, conversational.' : 'Voice: first person plural (we/our), professional but direct.'}
Return ONLY the 10 hooks, one per line, numbered 1-10. No explanations.`
      }],
    });

    const raw = response.choices[0].message.content.trim();
    const hooks = raw.split('\n').map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean).slice(0, 10);
    res.json({ success: true, hooks });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── Resize Post ──────────────────────────────────────────────────────────────

app.post('/api/resize-post', requireAuth, async (req, res) => {
  try {
    const { post, direction, platform, strategy } = req.body;
    if (!post || !['shorter', 'longer'].includes(direction)) return res.status(400).json({ error: 'post and direction (shorter|longer) required' });

    const instructions = direction === 'shorter'
      ? `Make this post significantly shorter — keep only the single most powerful idea and the best sentence. Cut everything else. Do not summarize what was cut. The result should feel complete, not truncated.`
      : `Expand this post — add one specific real moment, a concrete example, or a second layer of insight that earns the original point. Do not repeat what is already there. Do not add a moral or conclusion. Maintain the same voice and rhythm.`;

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{
        role: 'user',
        content: `${instructions}

BRAND VOICE:
${JSON.stringify(strategy?.brand_voice, null, 2)}

ORIGINAL ${platform?.toUpperCase()} POST:
${post}

Return ONLY the resized post text. No preamble.`
      }],
    });

    res.json({ success: true, post: response.choices[0].message.content.trim() });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── Idea Generator ───────────────────────────────────────────────────────────

app.post('/api/generate-ideas', requireAuth, async (req, res) => {
  try {
    const { personalityMap, strategy, platform, pillarId } = req.body;
    if (!personalityMap || !strategy) return res.status(400).json({ error: 'personalityMap and strategy required' });

    const pillars = strategy.content_pillars || [];
    const targetPillar = pillarId ? pillars.find(p => p.id === pillarId) : null;
    const pillarContext = targetPillar
      ? `Focus on this pillar: ${targetPillar.name} — ${targetPillar.description}. Audience pain point: ${targetPillar.audience_pain_point}`
      : `Generate ideas spread across all pillars: ${pillars.map(p => p.name).join(', ')}`;

    const response = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `Generate 18 specific post concept ideas for ${platform || 'social media'} based on this brand data.

PERSONALITY MAP / BRAND BRIEF:
${JSON.stringify({ name: personalityMap.name, values: personalityMap.values, skills: personalityMap.skills, achievements: personalityMap.achievements, professional_experience: personalityMap.professional_experience }, null, 2)}

BRAND VOICE: ${(strategy.brand_voice?.adjectives || []).join(', ')}

${pillarContext}

Each idea = one post concept. Make it specific enough that the writer knows exactly what to write — not "share a tip about X" but "The time you [specific situation] and what it revealed about [specific insight]".

Return ONLY valid JSON:
{
  "ideas": [
    { "pillar": "pillar name", "hook": "the opening line or concept in 1 sentence", "angle": "what makes this post unique or interesting" }
  ]
}`
      }],
    });

    const { ideas } = JSON.parse(response.choices[0].message.content);
    res.json({ success: true, ideas: ideas || [] });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── Quote Post ───────────────────────────────────────────────────────────────

app.post('/api/generate-quote-post', requireAuth, async (req, res) => {
  try {
    const { sessionId, topic, tone, brandType, personalityMap, strategy, brandContext, saveOnly, quoteText } = req.body;
    if (!personalityMap || !strategy) return res.status(400).json({ error: 'personalityMap and strategy required' });

    const validTones = ['authentic', 'educational', 'storytelling', 'motivational', 'casual', 'contrarian'];
    const resolvedTone = validTones.includes(tone) ? tone : 'authentic';

    let quote, subtext;
    if (saveOnly && quoteText) {
      quote = String(quoteText).trim().slice(0, 500);
      subtext = String(req.body.subtextText || '').trim().slice(0, 200);
    } else {
      ({ quote, subtext } = await generateQuotePost({ personalityMap, strategy, brandContext, topic, tone: resolvedTone, brandType: brandType || 'personal' }));
    }

    const postId = crypto.randomUUID();
    const pillarName = (topic || 'Quote').slice(0, 80);
    await sql`
      INSERT INTO generated_posts (id, session_id, user_id, platform, format, subtype, pillar_name, tone, content, subtext, voice_score, voice_note, status)
      VALUES (${postId}, ${sessionId || null}, ${req.user.id}, 'instagram', 'quote', ${resolvedTone},
              ${pillarName}, ${resolvedTone}, ${quote}, ${subtext || null}, NULL, NULL, 'draft')
    `;

    res.json({ success: true, quote, subtext: subtext || '', savedId: postId });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── Knowledge Base ───────────────────────────────────────────────────────────

app.get('/api/knowledge', requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT id, title, type, source, created_at FROM knowledge_docs WHERE user_id = ${req.user.id} ORDER BY created_at DESC`;
    res.json({ success: true, docs: rows });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.post('/api/knowledge', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    let text, title, type, source;

    if (req.file) {
      if (!req.file.mimetype.includes('pdf') && !req.file.originalname.toLowerCase().endsWith('.pdf')) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Only PDF files are accepted' });
      }
      text = await extractPdfText(req.file.path);
      fs.unlinkSync(req.file.path);
      title = (req.body.title || req.file.originalname.replace(/\.pdf$/i, '')).slice(0, 100);
      type = req.body.type || 'general';
      source = req.file.originalname;
    } else {
      const rawText = String(req.body.text || '');
      const rawTitle = String(req.body.title || '');
      if (!rawText || !rawTitle) return res.status(400).json({ error: 'title and text required' });
      text = rawText.slice(0, 20000);
      title = rawTitle.slice(0, 100);
      type = String(req.body.type || 'general');
      source = null;
    }

    const capped = text.slice(0, 12000);
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{
        role: 'user',
        content: `Extract key insights from this document for a content creator who wants to reference it in social media posts.

Summarize in flowing plain text (~400 words):
1. Core frameworks or models described
2. Key claims or arguments (3–5 points)
3. Specific vocabulary and concepts the creator can use authentically
4. Any statistics, studies, or data points that could ground posts in specificity

Document:
${capped}`,
      }],
    });
    const summary = response.choices[0].message.content.trim();

    const id = crypto.randomUUID();
    await sql`INSERT INTO knowledge_docs (id, user_id, title, type, summary, source) VALUES (${id}, ${req.user.id}, ${title}, ${type}, ${summary}, ${source})`;
    res.json({ success: true, id, title, type, source, created_at: new Date().toISOString() });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.delete('/api/knowledge/:id', requireAuth, async (req, res) => {
  try {
    await sql`DELETE FROM knowledge_docs WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    res.json({ success: true });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── Style Cloning ────────────────────────────────────────────────────────────

app.post('/api/extract-style', requireAuth, async (req, res) => {
  try {
    const { posts, sessionId } = req.body;
    if (!Array.isArray(posts) || posts.length < 2) return res.status(400).json({ error: 'Provide at least 2 sample posts' });
    if (posts.length > 10) return res.status(400).json({ error: 'Maximum 10 sample posts' });

    const safePosts = posts.map(p => String(p).slice(0, 1000)).join('\n\n---\n\n');

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{
        role: 'user',
        content: `Analyze these social media posts and extract a precise style fingerprint that can be used to clone this writer's voice in future posts.

POSTS:
${safePosts}

Write a style fingerprint as a set of specific, actionable observations — not generic descriptions. Focus on:
1. SENTENCE PATTERNS: Typical length, rhythm, how they mix short and long sentences, use of fragments
2. VOCABULARY: Specific words or phrases they use repeatedly, words they avoid, register (formal/casual)
3. STRUCTURAL HABITS: How they open, how they close, use of line breaks, paragraph length
4. PERSONALITY MARKERS: Self-deprecation, humor style, how they show doubt or vulnerability, use of "I"
5. WHAT THEY NEVER DO: Patterns conspicuously absent from their writing

Be specific — quote actual phrases where possible. This fingerprint will be injected directly into AI generation prompts.
Keep it under 300 words.`
      }],
    });

    const fingerprint = response.choices[0].message.content.trim();

    // Save to session if provided
    if (sessionId) {
      await sql`UPDATE sessions SET style_fingerprint = ${fingerprint} WHERE id = ${sessionId} AND user_id = ${req.user.id}`;
    }

    res.json({ success: true, fingerprint });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── AGENT INFRASTRUCTURE ────────────────────────────────────────────────────

async function runAgent(name, userId, fn) {
  const id = `${name}:${userId || 'system'}`;
  await sql`
    INSERT INTO agent_runs (id, agent_name, user_id, status, started_at, last_action)
    VALUES (${id}, ${name}, ${userId || null}, 'running', NOW(), 'Starting...')
    ON CONFLICT (id) DO UPDATE SET status='running', started_at=NOW(), error_msg=NULL, last_action='Starting...'
  `;
  try {
    const result = await fn();
    await sql`
      UPDATE agent_runs
      SET status='done', finished_at=NOW(), last_action=${result.action}, run_count=run_count+1
      WHERE id=${id}
    `;
    return result;
  } catch (err) {
    await sql`
      UPDATE agent_runs
      SET status='error', finished_at=NOW(), error_msg=${err.message}
      WHERE id=${id}
    `;
    throw err;
  }
}

// ─── CONCEPT AGENT ────────────────────────────────────────────────────────────

async function runConceptAgent() {
  return runAgent('concept', null, async () => {
    const users = await sql`
      SELECT s.user_id, s.id as session_id, s.personality_map, s.strategy, s.brand_context, s.created_at
      FROM sessions s
      WHERE s.user_id IS NOT NULL
      ORDER BY s.created_at DESC
    `;

    // De-duplicate by user_id — keep only the most recent session per user
    const seen = new Set();
    const uniqueUsers = [];
    for (const u of users) {
      if (!seen.has(u.user_id)) { seen.add(u.user_id); uniqueUsers.push(u); }
    }

    let totalIdeas = 0;
    let usersProcessed = 0;

    for (const u of uniqueUsers) {
      try {
        const strategy = u.strategy;
        const pillars = (strategy?.content_pillars || []).slice(0, 5);
        if (!pillars.length) continue;

        // Load brain diary wins/losses for context
        const wins = await sql`
          SELECT pattern, insight FROM brain_diary
          WHERE user_id=${u.user_id} AND type='win'
          AND created_at > NOW() - INTERVAL '30 days'
          ORDER BY created_at DESC LIMIT 5
        `;
        const losses = await sql`
          SELECT pattern FROM brain_diary
          WHERE user_id=${u.user_id} AND type='loss'
          AND created_at > NOW() - INTERVAL '30 days'
          ORDER BY created_at DESC LIMIT 3
        `;

        // Load recent viral cache topics as inspiration
        const viralRows = await sql`SELECT posts FROM viral_cache LIMIT 2`;
        const trendingSnippet = viralRows.flatMap(r => (r.posts || []).slice(0, 5).map(p => String(p.caption || p.text || '').slice(0, 150))).join('\n');

        const winsText = wins.length ? wins.map(w => `- ${w.pattern}: ${w.insight}`).join('\n') : 'None yet.';
        const lossesText = losses.length ? losses.map(l => `- ${l.pattern}`).join('\n') : 'None yet.';

        const pillarsText = pillars.map(p => `${p.name}: ${p.description || ''}`).join('\n');
        const brandName = u.personality_map?.name || u.brand_context?.name || 'this brand';

        const response = await openai.chat.completions.create({
          model: MODEL,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: `You are a content strategist. Generate 7 specific post ideas across these content pillars.

BRAND: ${brandName}
BRAND VOICE: ${JSON.stringify(strategy?.brand_voice || {})}
PILLARS:
${pillarsText}

WHAT WORKED LAST 30 DAYS (use these patterns in new ideas):
${winsText}

AVOID THESE PATTERNS (underperformed):
${lossesText}

TRENDING TOPICS THIS WEEK (for inspiration only, adapt to brand voice):
${trendingSnippet || 'No trending data available.'}

Generate exactly 7 ideas. Spread them across the pillars. Each idea must be specific, not generic.

Return JSON: { "ideas": [{ "topic": "...", "hook": "one compelling opening line", "angle": "what makes this unique or contrarian", "pillar_name": "...", "platform": "linkedin or instagram" }] }`,
          }],
        });

        const parsed = JSON.parse(response.choices[0].message.content);
        const ideas = (parsed.ideas || []).slice(0, 10);

        // De-duplicate against last 7 days
        const recentTopics = await sql`
          SELECT topic FROM idea_queue
          WHERE user_id=${u.user_id} AND created_at > NOW() - INTERVAL '7 days'
        `;
        const recentSet = new Set(recentTopics.map(r => r.topic.toLowerCase().trim()));

        let inserted = 0;
        for (const idea of ideas) {
          if (recentSet.has((idea.topic || '').toLowerCase().trim())) continue;
          const id = crypto.randomUUID();
          await sql`
            INSERT INTO idea_queue (id, user_id, session_id, topic, hook, angle, pillar_name, platform, source)
            VALUES (${id}, ${u.user_id}, ${u.session_id}, ${idea.topic || ''}, ${idea.hook || null}, ${idea.angle || null}, ${idea.pillar_name || null}, ${idea.platform || 'linkedin'}, 'agent')
          `;
          inserted++;
          totalIdeas++;
        }

        usersProcessed++;
      } catch (err) {
        console.error(`Concept agent failed for user ${u.user_id}:`, err.message);
      }
    }

    return { action: `Generated ${totalIdeas} ideas for ${usersProcessed} users` };
  });
}

// ─── SCORING AGENT ────────────────────────────────────────────────────────────

async function runScoringAgent() {
  return runAgent('scoring', null, async () => {
    const analyticsRows = await sql`
      SELECT pa.user_id, pa.platform, pa.posts
      FROM post_analytics pa
      WHERE pa.user_id IS NOT NULL
    `;

    let totalWins = 0;
    let totalLosses = 0;

    // Group by user
    const byUser = {};
    for (const row of analyticsRows) {
      if (!byUser[row.user_id]) byUser[row.user_id] = [];
      const posts = (row.posts || []).filter(p => p && (p.likes !== undefined || p.impressions !== undefined || p.engagement !== undefined));
      byUser[row.user_id].push(...posts);
    }

    for (const [userId, allPosts] of Object.entries(byUser)) {
      if (allPosts.length < 4) continue;

      // Score each post: likes*1 + comments*3 + shares*5 + saves*4
      const scored = allPosts.map(p => ({
        ...p,
        score: ((p.likes || p.reactions || 0) * 1) + ((p.comments || 0) * 3) + ((p.shares || p.reposts || 0) * 5) + ((p.saves || 0) * 4),
      })).sort((a, b) => b.score - a.score);

      const top = scored.slice(0, Math.max(1, Math.floor(scored.length * 0.2)));
      const bottom = scored.slice(Math.floor(scored.length * 0.8));

      if (!top.length || !bottom.length) continue;

      const topText = top.map((p, i) => `Post ${i + 1} (score: ${p.score}): ${String(p.text || p.content || p.caption || '').slice(0, 400)}`).join('\n\n');
      const bottomText = bottom.map((p, i) => `Post ${i + 1} (score: ${p.score}): ${String(p.text || p.content || p.caption || '').slice(0, 400)}`).join('\n\n');

      try {
        const response = await openai.chat.completions.create({
          model: MODEL,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: `You are a content performance analyst. Compare these top-performing vs under-performing social media posts.

TOP POSTS (high engagement):
${topText}

BOTTOM POSTS (low engagement):
${bottomText}

Find 2-3 specific patterns that distinguish winners from losers. Focus on: hook structure (confession/question/stat/story), structural format (story arc vs list vs opinion), tone, and topic type.

Be specific — quote from actual posts when possible.

Return JSON:
{
  "wins": [{ "pattern": "short headline", "insight": "full explanation with evidence", "evidence_indices": [0, 1] }],
  "losses": [{ "pattern": "short headline", "insight": "full explanation with evidence", "evidence_indices": [0] }]
}`,
          }],
        });

        const analysis = JSON.parse(response.choices[0].message.content);

        for (const win of (analysis.wins || [])) {
          // Deduplicate: skip if same pattern in last 14 days
          const existing = await sql`
            SELECT id FROM brain_diary WHERE user_id=${userId} AND type='win' AND pattern=${win.pattern} AND created_at > NOW() - INTERVAL '14 days'
          `;
          if (existing.length) continue;
          const evidencePosts = (win.evidence_indices || []).map(i => String(top[i]?.id || top[i]?.text || '').slice(0, 100));
          await sql`
            INSERT INTO brain_diary (id, user_id, type, pattern, insight, evidence, metrics)
            VALUES (${crypto.randomUUID()}, ${userId}, 'win', ${win.pattern}, ${win.insight}, ${JSON.stringify(evidencePosts)}, ${JSON.stringify({ sample_size: top.length })})
          `;
          totalWins++;
        }

        for (const loss of (analysis.losses || [])) {
          const existing = await sql`
            SELECT id FROM brain_diary WHERE user_id=${userId} AND type='loss' AND pattern=${loss.pattern} AND created_at > NOW() - INTERVAL '14 days'
          `;
          if (existing.length) continue;
          const evidencePosts = (loss.evidence_indices || []).map(i => String(bottom[i]?.id || bottom[i]?.text || '').slice(0, 100));
          await sql`
            INSERT INTO brain_diary (id, user_id, type, pattern, insight, evidence, metrics)
            VALUES (${crypto.randomUUID()}, ${userId}, 'loss', ${loss.pattern}, ${loss.insight}, ${JSON.stringify(evidencePosts)}, ${JSON.stringify({ sample_size: bottom.length })})
          `;
          totalLosses++;
        }
      } catch (err) {
        console.error(`Scoring agent failed for user ${userId}:`, err.message);
      }
    }

    // === GENERATED POSTS ATTRIBUTION LOOP ===
    // Analyze which pillar/tone combinations in our own generated posts perform best.
    // This is richer than post_analytics because it has structured metadata (pillar, tone, platform).
    const scoredGenPosts = await sql`
      SELECT user_id, pillar_name, tone, platform, engagement_score
      FROM generated_posts
      WHERE engagement_score IS NOT NULL AND pillar_name IS NOT NULL AND pillar_name != ''
    `;

    const byUserGen = {};
    for (const p of scoredGenPosts) {
      if (!byUserGen[p.user_id]) byUserGen[p.user_id] = [];
      byUserGen[p.user_id].push(p);
    }

    for (const [userId, posts] of Object.entries(byUserGen)) {
      if (posts.length < 3) continue;

      // Group by pillar + tone + platform to find what combinations work
      const comboMap = {};
      for (const p of posts) {
        const key = `${p.pillar_name}::${p.tone || 'unknown'}::${p.platform}`;
        if (!comboMap[key]) comboMap[key] = { scores: [], pillar: p.pillar_name, tone: p.tone, platform: p.platform };
        comboMap[key].scores.push(p.engagement_score);
      }

      const combos = Object.values(comboMap)
        .map(c => ({ ...c, avg: c.scores.reduce((a, b) => a + b, 0) / c.scores.length, count: c.scores.length }))
        .filter(c => c.count >= 2)
        .sort((a, b) => b.avg - a.avg);

      if (combos.length < 2) continue;

      const topCombo = combos[0];
      const bottomCombo = combos[combos.length - 1];

      try {
        const winPattern = `${topCombo.tone} tone on "${topCombo.pillar}" (${topCombo.platform}) avg ${Math.round(topCombo.avg)}% engagement`;
        const winExists = await sql`SELECT id FROM brain_diary WHERE user_id=${userId} AND type='win' AND pattern=${winPattern} AND created_at > NOW() - INTERVAL '14 days'`;
        if (!winExists.length) {
          await sql`
            INSERT INTO brain_diary (id, user_id, type, pattern, insight, pillar_name, platform, metrics)
            VALUES (${crypto.randomUUID()}, ${userId}, 'win', ${winPattern},
              ${`Your "${topCombo.tone}" tone posts on the "${topCombo.pillar}" pillar are your strongest performers (avg ${Math.round(topCombo.avg)}% engagement rate from ${topCombo.count} posts). Prioritise this combination.`},
              ${topCombo.pillar}, ${topCombo.platform}, ${JSON.stringify({ avg_score: topCombo.avg, sample_size: topCombo.count })})
          `;
          totalWins++;
        }

        const lossPattern = `${bottomCombo.tone} tone on "${bottomCombo.pillar}" (${bottomCombo.platform}) avg ${Math.round(bottomCombo.avg)}% engagement`;
        const lossExists = await sql`SELECT id FROM brain_diary WHERE user_id=${userId} AND type='loss' AND pattern=${lossPattern} AND created_at > NOW() - INTERVAL '14 days'`;
        if (!lossExists.length) {
          await sql`
            INSERT INTO brain_diary (id, user_id, type, pattern, insight, pillar_name, platform, metrics)
            VALUES (${crypto.randomUUID()}, ${userId}, 'loss', ${lossPattern},
              ${`Your "${bottomCombo.tone}" tone posts on the "${bottomCombo.pillar}" pillar consistently underperform (avg ${Math.round(bottomCombo.avg)}% engagement from ${bottomCombo.count} posts). Try a different angle or tone for this pillar.`},
              ${bottomCombo.pillar}, ${bottomCombo.platform}, ${JSON.stringify({ avg_score: bottomCombo.avg, sample_size: bottomCombo.count })})
          `;
          totalLosses++;
        }
      } catch (err) {
        console.error(`Scoring agent: attribution analysis failed for user ${userId}:`, err.message);
      }
    }

    return { action: `Found ${totalWins} win patterns and ${totalLosses} loss patterns` };
  });
}

// ─── FEEDBACK AGENT ───────────────────────────────────────────────────────────

async function runFeedbackAgent() {
  return runAgent('feedback', null, async () => {
    const users = await sql`SELECT DISTINCT user_id FROM brain_diary WHERE user_id IS NOT NULL`;
    let summariesCreated = 0;

    for (const { user_id } of users) {
      const entries = await sql`
        SELECT type, pattern, insight FROM brain_diary
        WHERE user_id=${user_id} AND type IN ('win','loss')
        AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY type, created_at DESC
        LIMIT 20
      `;
      if (!entries.length) continue;

      try {
        const winsText = entries.filter(e => e.type === 'win').map(e => `WIN: ${e.pattern} — ${e.insight}`).join('\n');
        const lossesText = entries.filter(e => e.type === 'loss').map(e => `LOSS: ${e.pattern} — ${e.insight}`).join('\n');

        const response = await openai.chat.completions.create({
          model: MODEL,
          messages: [{
            role: 'user',
            content: `You are a content coach. Based on this week's performance patterns, write a short weekly summary (3-5 sentences) for a creator. Focus on what they should do MORE of and LESS of next week. Be direct and actionable.

${winsText ? 'WINS THIS WEEK:\n' + winsText : ''}
${lossesText ? '\nLOSSES THIS WEEK:\n' + lossesText : ''}

Write 2 things: 1) A one-line headline (the "pattern" field), 2) A 3-5 sentence coaching summary (the "insight" field).

Return JSON: { "pattern": "one-line headline", "insight": "3-5 sentence summary" }`,
          }],
          response_format: { type: 'json_object' },
        });

        const summary = JSON.parse(response.choices[0].message.content);
        await sql`
          INSERT INTO brain_diary (id, user_id, type, pattern, insight)
          VALUES (${crypto.randomUUID()}, ${user_id}, 'weekly_summary', ${summary.pattern}, ${summary.insight})
        `;
        summariesCreated++;
      } catch (err) {
        console.error(`Feedback agent failed for user ${user_id}:`, err.message);
      }
    }

    return { action: `Created ${summariesCreated} weekly summaries` };
  });
}

// ─── EVOLUTION AGENT ─────────────────────────────────────────────────────────
// Reads win/loss patterns from brain_diary → synthesizes user-specific prompt rules →
// those rules are injected into every future generatePost call for that user.
// This closes the loop: performance → patterns → better prompts → better posts.

async function runEvolutionAgent() {
  return runAgent('evolution', null, async () => {
    const users = await sql`SELECT DISTINCT user_id FROM brain_diary WHERE user_id IS NOT NULL`;
    let updated = 0;

    for (const { user_id } of users) {
      const entries = await sql`
        SELECT type, pattern, insight, platform
        FROM brain_diary
        WHERE user_id = ${user_id} AND type IN ('win', 'loss')
        AND created_at > NOW() - INTERVAL '60 days'
        ORDER BY created_at DESC LIMIT 30
      `;
      if (entries.length < 3) continue;

      const wins  = entries.filter(e => e.type === 'win').map(e => `WIN [${e.platform || 'all'}]: ${e.pattern} — ${e.insight}`).join('\n');
      const losses = entries.filter(e => e.type === 'loss').map(e => `LOSS [${e.platform || 'all'}]: ${e.pattern} — ${e.insight}`).join('\n');

      try {
        const response = await openai.chat.completions.create({
          model: MODEL,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: `You are a prompt engineer improving an AI content writer based on real performance data.

WIN PATTERNS (what drove high engagement for this creator):
${wins || 'None yet.'}

LOSS PATTERNS (what caused low engagement):
${losses || 'None yet.'}

Synthesize 3–5 specific, actionable writing rules the AI should follow when generating this creator's posts.
Rules must be derived from the data above — not generic advice.
Each rule must be concrete: "do X when writing Y" or "avoid Z because it lowered engagement".

Return JSON:
{
  "do": ["up to 3 rules derived from win patterns"],
  "dont": ["up to 3 rules derived from loss patterns"],
  "platform_notes": {
    "linkedin": "one specific linkedin instruction from the data, or null",
    "instagram": "one specific instagram instruction from the data, or null"
  }
}`,
          }],
        });

        const rules = JSON.parse(response.choices[0].message.content);
        // Sanitize arrays to strings
        rules.do = (rules.do || []).map(r => String(r).slice(0, 200)).slice(0, 5);
        rules.dont = (rules.dont || []).map(r => String(r).slice(0, 200)).slice(0, 5);
        if (rules.platform_notes) {
          rules.platform_notes.linkedin = rules.platform_notes.linkedin ? String(rules.platform_notes.linkedin).slice(0, 300) : null;
          rules.platform_notes.instagram = rules.platform_notes.instagram ? String(rules.platform_notes.instagram).slice(0, 300) : null;
        }

        await sql`
          INSERT INTO prompt_rules (user_id, rules, updated_at)
          VALUES (${user_id}, ${JSON.stringify(rules)}, NOW())
          ON CONFLICT (user_id) DO UPDATE SET rules = EXCLUDED.rules, updated_at = NOW()
        `;

        // Write a brain_diary entry so users can see what changed
        await sql`
          INSERT INTO brain_diary (id, user_id, type, pattern, insight)
          VALUES (${crypto.randomUUID()}, ${user_id}, 'evolution',
            'Prompt rules updated',
            ${`DO: ${rules.do.join(' | ')} | AVOID: ${rules.dont.join(' | ')}`})
        `;

        updated++;
      } catch (err) {
        console.error(`Evolution agent failed for user ${user_id}:`, err.message);
      }
    }

    return { action: `Updated prompt rules for ${updated} users` };
  });
}

// ─── METRICS AGENT ───────────────────────────────────────────────────────────

async function processMetricsResults(userId, sessionId, raw) {
  const scraped = raw
    .filter(p => (p.content || p.text || '').length > 10)
    .map(p => ({
      platform: 'linkedin',
      author: p.author?.name ?? 'own profile',
      text: p.content ?? p.text ?? '',
      url: p.linkedinUrl ?? p.url ?? '',
      likes: p.engagement?.likes ?? p.numLikes ?? p.likes ?? 0,
      comments: p.engagement?.comments ?? p.numComments ?? p.comments ?? 0,
      shares: p.engagement?.shares ?? p.numShares ?? p.shares ?? 0,
      impressions: p.engagement?.impressions ?? p.numImpressions ?? p.impressions ?? 0,
    }));

  if (!scraped.length) return 0;

  // Store in post_analytics so scoring agent can read this user's own posts
  if (sessionId) {
    await sql`
      INSERT INTO post_analytics (session_id, platform, posts, imported_at, user_id)
      VALUES (${sessionId}, 'linkedin', ${JSON.stringify(scraped)}, NOW(), ${userId})
      ON CONFLICT (session_id, platform) DO UPDATE
        SET posts = EXCLUDED.posts, imported_at = NOW(), user_id = EXCLUDED.user_id
    `;
  }

  // Find unscored generated posts for this user on LinkedIn
  const genPosts = await sql`
    SELECT id, content FROM generated_posts
    WHERE user_id = ${userId} AND platform = 'linkedin' AND engagement_score IS NULL
    ORDER BY created_at DESC LIMIT 40
  `;
  if (!genPosts.length) return scraped.length;

  // AI-match published posts back to their generated drafts
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `Match AI-generated draft posts to actual LinkedIn published posts.
A match means the published post was clearly derived from the draft (same topic, same angle, similar language — the user may have edited it).

GENERATED DRAFTS:
${genPosts.map((p, i) => `[G${i}]\n${p.content.slice(0, 300)}`).join('\n\n---\n\n')}

PUBLISHED POSTS (real engagement data):
${scraped.map((p, i) => `[P${i}] likes:${p.likes} comments:${p.comments} shares:${p.shares}\n${p.text.slice(0, 300)}`).join('\n\n---\n\n')}

Return JSON: { "matches": [{ "generated_index": 0, "published_index": 1, "confidence": 0.9 }] }
Only include pairs with confidence >= 0.75. Return empty matches array if nothing is strong enough.`,
      }],
    });

    const { matches } = JSON.parse(response.choices[0].message.content);

    for (const m of (matches || [])) {
      const gen = genPosts[m.generated_index];
      const pub = scraped[m.published_index];
      if (!gen || !pub) continue;

      // Weighted engagement score out of 100
      const impressions = pub.impressions || Math.max(pub.likes * 50, 1);
      const engScore = Math.min(100, Math.round(
        (pub.likes * 1 + pub.comments * 3 + pub.shares * 5) / impressions * 100
      ));

      await sql`
        UPDATE generated_posts
        SET engagement_score = ${engScore}, platform_post_id = ${pub.url || null}
        WHERE id = ${gen.id}
      `;
    }
  } catch (err) {
    console.error('Metrics agent: AI matching failed:', err.message);
  }

  return scraped.length;
}

async function runMetricsAgent() {
  return runAgent('metrics', null, async () => {
    const users = await sql`
      SELECT u.id as user_id, u.linkedin_profile_url,
        (SELECT id FROM sessions WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as session_id
      FROM users u
      WHERE u.linkedin_profile_url IS NOT NULL AND u.linkedin_profile_url != ''
    `;

    let started = 0;
    let imported = 0;

    for (const u of users) {
      try {
        const [run] = await sql`SELECT * FROM metrics_runs WHERE user_id = ${u.user_id}`;

        if (run?.run_status === 'processing' && run.run_id) {
          // Poll existing run
          const runData = await apifyCheckRun(run.run_id);
          if (runData?.status === 'SUCCEEDED') {
            const raw = await apifyFetchDataset(runData.defaultDatasetId);
            const count = await processMetricsResults(u.user_id, u.session_id, raw);
            await sql`UPDATE metrics_runs SET run_status = 'done', processed_at = NOW(), updated_at = NOW() WHERE user_id = ${u.user_id}`;
            imported += count;
          } else if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(runData?.status)) {
            await sql`UPDATE metrics_runs SET run_status = 'failed', updated_at = NOW() WHERE user_id = ${u.user_id}`;
          }
          // still processing → will pick up on next cron tick
        } else {
          // Start a new Apify profile scrape for this user
          const runId = await apifyStartRun('harvestapi/linkedin-profile-posts', {
            profileUrls: [u.linkedin_profile_url],
            maxResults: 30,
          });
          await sql`
            INSERT INTO metrics_runs (user_id, run_id, run_status, linkedin_url)
            VALUES (${u.user_id}, ${runId}, 'processing', ${u.linkedin_profile_url})
            ON CONFLICT (user_id) DO UPDATE
              SET run_id = ${runId}, run_status = 'processing', linkedin_url = ${u.linkedin_profile_url}, updated_at = NOW()
          `;
          started++;
        }
      } catch (err) {
        console.error(`Metrics agent failed for user ${u.user_id}:`, err.message);
      }
    }

    return { action: `Started ${started} profile scrapes, imported ${imported} posts with metrics` };
  });
}

// ─── AUTO-GENERATION AGENT ───────────────────────────────────────────────────
// Picks up pending ideas from idea_queue and runs the full 4-stage post pipeline.
// Runs every 4 hours. Skips users with >10 unreviewed drafts to avoid queue flood.

async function runAutoGenAgent() {
  return runAgent('autogen', null, async () => {
    const users = await sql`
      SELECT s.user_id, s.id as session_id, s.personality_map, s.strategy,
             s.brand_context, s.brand_type, s.style_fingerprint
      FROM sessions s
      WHERE s.user_id IS NOT NULL
      ORDER BY s.created_at DESC
    `;

    const seen = new Set();
    const uniqueUsers = [];
    for (const u of users) {
      if (!seen.has(u.user_id)) { seen.add(u.user_id); uniqueUsers.push(u); }
    }

    let totalGenerated = 0;

    for (const u of uniqueUsers) {
      try {
        // Skip users who already have too many unreviewed drafts
        const [draftCount] = await sql`
          SELECT COUNT(*) as count FROM generated_posts
          WHERE user_id = ${u.user_id} AND status = 'draft'
        `;
        if (parseInt(draftCount?.count || 0) >= 10) continue;

        // Fetch up to 3 pending ideas (highest priority first)
        const ideas = await sql`
          SELECT * FROM idea_queue
          WHERE user_id = ${u.user_id} AND status = 'pending'
          ORDER BY priority DESC, created_at ASC
          LIMIT 3
        `;
        if (!ideas.length) continue;

        // Load learned rules for this user
        const [rulesRow] = await sql`SELECT rules FROM prompt_rules WHERE user_id = ${u.user_id}`;
        const learnedRules = rulesRow?.rules || null;

        const strategy = u.strategy;
        const pm = u.personality_map || {};

        for (const idea of ideas) {
          try {
            // Mark as generating to prevent double-picks
            await sql`UPDATE idea_queue SET status = 'generating', updated_at = NOW() WHERE id = ${idea.id}`;

            const pillar = (strategy?.content_pillars || []).find(p => p.name === idea.pillar_name);
            const platform = idea.platform || 'linkedin';

            const { post, voiceScore, voiceNote } = await generatePost(
              pm,
              strategy,
              platform,
              pillar?.id || null,
              'authentic',
              idea.topic + (idea.hook ? `\nHook: ${idea.hook}` : '') + (idea.angle ? `\nAngle: ${idea.angle}` : ''),
              {},
              [],
              u.brand_type || 'personal',
              null,
              null,
              u.style_fingerprint || null,
              u.brand_context || null,
              learnedRules,
            );

            const postId = crypto.randomUUID();
            await sql`
              INSERT INTO generated_posts (id, session_id, user_id, platform, pillar_name, tone, content, voice_score, voice_note, status)
              VALUES (${postId}, ${u.session_id}, ${u.user_id}, ${platform}, ${idea.pillar_name || null}, 'authentic', ${post}, ${voiceScore || null}, ${voiceNote || null}, 'draft')
            `;
            await sql`UPDATE idea_queue SET status = 'created', post_id = ${postId}, updated_at = NOW() WHERE id = ${idea.id}`;

            // Enqueue review notification
            await sql`
              INSERT INTO notification_queue (id, user_id, type, payload)
              VALUES (${crypto.randomUUID()}, ${u.user_id}, 'review_ready', ${JSON.stringify({ post_id: postId, platform })})
            `;

            totalGenerated++;
            // Respect OpenAI rate limits
            await new Promise(r => setTimeout(r, 2000));
          } catch (err) {
            console.error(`AutoGen failed for idea ${idea.id}:`, err.message);
            await sql`UPDATE idea_queue SET status = 'pending', updated_at = NOW() WHERE id = ${idea.id}`;
          }
        }
      } catch (err) {
        console.error(`AutoGen agent failed for user ${u.user_id}:`, err.message);
      }
    }

    return { action: `Generated ${totalGenerated} posts from idea queue` };
  });
}

// ─── DECIDE AGENT ─────────────────────────────────────────────────────────────
// Runs Monday 10:00 UTC (after Evolution on Sunday). Reads brain_diary + idea_queue,
// boosts high-priority ideas, creates net-new ideas from winning patterns,
// and archives stale low-priority ideas.

async function runDecideAgent() {
  return runAgent('decide', null, async () => {
    const users = await sql`SELECT DISTINCT user_id FROM brain_diary WHERE user_id IS NOT NULL`;
    let decisionsTotal = 0;

    for (const { user_id } of users) {
      try {
        // Load last 30 days of brain diary
        const diaryEntries = await sql`
          SELECT type, pattern, insight, platform, pillar_name
          FROM brain_diary
          WHERE user_id = ${user_id} AND type IN ('win', 'loss', 'weekly_summary', 'rejection')
          AND created_at > NOW() - INTERVAL '30 days'
          ORDER BY created_at DESC LIMIT 40
        `;
        if (diaryEntries.length < 3) continue;

        const pendingIdeas = await sql`
          SELECT id, topic, pillar_name, priority, created_at
          FROM idea_queue WHERE user_id = ${user_id} AND status = 'pending'
        `;

        const diaryText = diaryEntries.map(e => `[${e.type.toUpperCase()}] ${e.platform || 'all'} — ${e.pattern}: ${e.insight}`).join('\n');
        const ideasText = pendingIdeas.map((i, idx) => `[${idx}] priority:${i.priority} pillar:${i.pillar_name || 'none'} — ${i.topic}`).join('\n');

        const response = await openai.chat.completions.create({
          model: MODEL,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: `You are a content strategist making weekly decisions about what to create next.

BRAIN DIARY (last 30 days of performance data):
${diaryText}

CURRENT PENDING IDEAS:
${ideasText || 'None'}

Based on the data, make strategic decisions:
1. Which pending ideas match winning patterns and should be prioritized? (boost their priority to 9)
2. What 2-3 net-new ideas should be created based on winning patterns that aren't covered yet?
3. Are there any ideas that look like losing patterns and should be archived?

Return JSON:
{
  "boost_indices": [0, 2],
  "new_ideas": [
    { "topic": "...", "hook": "...", "angle": "...", "pillar_name": "...", "platform": "linkedin" }
  ],
  "archive_indices": [1],
  "summary": "one sentence on strategic direction this week"
}`,
          }],
        });

        const decisions = JSON.parse(response.choices[0].message.content);

        // Boost matching ideas
        for (const idx of (decisions.boost_indices || [])) {
          const idea = pendingIdeas[idx];
          if (idea) {
            await sql`UPDATE idea_queue SET priority = 9, updated_at = NOW() WHERE id = ${idea.id}`;
          }
        }

        // Archive low-value ideas
        for (const idx of (decisions.archive_indices || [])) {
          const idea = pendingIdeas[idx];
          if (idea) {
            await sql`UPDATE idea_queue SET status = 'archived', updated_at = NOW() WHERE id = ${idea.id}`;
          }
        }

        // Load session for net-new ideas
        const [session] = await sql`SELECT id FROM sessions WHERE user_id = ${user_id} ORDER BY created_at DESC LIMIT 1`;

        // Create net-new ideas
        for (const newIdea of (decisions.new_ideas || []).slice(0, 3)) {
          const id = crypto.randomUUID();
          await sql`
            INSERT INTO idea_queue (id, user_id, session_id, topic, hook, angle, pillar_name, platform, source, priority)
            VALUES (${id}, ${user_id}, ${session?.id || null}, ${newIdea.topic || ''}, ${newIdea.hook || null}, ${newIdea.angle || null}, ${newIdea.pillar_name || null}, ${newIdea.platform || 'linkedin'}, 'decide', 8)
          `;
        }

        // Write brain_diary decision entry
        await sql`
          INSERT INTO brain_diary (id, user_id, type, pattern, insight)
          VALUES (${crypto.randomUUID()}, ${user_id}, 'decide', 'Weekly strategy decision', ${decisions.summary || 'Strategy updated based on performance patterns'})
        `;

        decisionsTotal++;
      } catch (err) {
        console.error(`Decide agent failed for user ${user_id}:`, err.message);
      }
    }

    return { action: `Made strategic decisions for ${decisionsTotal} users` };
  });
}

// ─── INSTAGRAM METRICS AGENT ─────────────────────────────────────────────────
// Mirror of the LinkedIn metrics agent but for Instagram profile posts.

async function processInstagramMetricsResults(userId, sessionId, raw) {
  const scraped = raw
    .filter(p => (p.caption || p.text || '').length > 5)
    .map(p => ({
      platform: 'instagram',
      text: p.caption ?? p.text ?? '',
      url: p.url ?? p.permalink ?? '',
      likes: p.likesCount ?? p.likes ?? 0,
      comments: p.commentsCount ?? p.comments ?? 0,
      saves: p.savesCount ?? p.saves ?? 0,
      impressions: p.impressionsCount ?? p.impressions ?? Math.max((p.likesCount ?? 0) * 30, 1),
    }));

  if (!scraped.length) return 0;

  const genPosts = await sql`
    SELECT id, content FROM generated_posts
    WHERE user_id = ${userId} AND platform = 'instagram' AND engagement_score IS NULL
    ORDER BY created_at DESC LIMIT 40
  `;
  if (!genPosts.length) return scraped.length;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `Match AI-generated draft posts to actual Instagram published posts.
A match means the published post was clearly derived from the draft (same topic, angle, or similar language).

GENERATED DRAFTS:
${genPosts.map((p, i) => `[G${i}]\n${p.content.slice(0, 300)}`).join('\n\n---\n\n')}

PUBLISHED POSTS:
${scraped.map((p, i) => `[P${i}] likes:${p.likes} comments:${p.comments}\n${p.text.slice(0, 300)}`).join('\n\n---\n\n')}

Return JSON: { "matches": [{ "generated_index": 0, "published_index": 1, "confidence": 0.9 }] }
Only include pairs with confidence >= 0.75.`,
      }],
    });

    const { matches } = JSON.parse(response.choices[0].message.content);
    for (const m of (matches || [])) {
      const gen = genPosts[m.generated_index];
      const pub = scraped[m.published_index];
      if (!gen || !pub) continue;

      const impressions = pub.impressions || Math.max(pub.likes * 30, 1);
      const engScore = Math.min(100, Math.round(
        (pub.likes * 1 + pub.comments * 3 + pub.saves * 4) / impressions * 100,
      ));

      await sql`
        UPDATE generated_posts
        SET engagement_score = ${engScore}, platform_post_id = ${pub.url || null}
        WHERE id = ${gen.id}
      `;
    }
  } catch (err) {
    console.error('Instagram metrics: AI matching failed:', err.message);
  }

  return scraped.length;
}

async function runInstagramMetricsAgent() {
  return runAgent('instagram_metrics', null, async () => {
    const users = await sql`
      SELECT u.id as user_id, u.instagram_profile_url,
        (SELECT id FROM sessions WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as session_id
      FROM users u
      WHERE u.instagram_profile_url IS NOT NULL AND u.instagram_profile_url != ''
    `;

    let started = 0;
    let imported = 0;

    for (const u of users) {
      try {
        const runId = await apifyStartRun('apify/instagram-profile-scraper', {
          usernames: [u.instagram_profile_url.replace('https://www.instagram.com/', '').replace('/', '')],
          resultsLimit: 30,
        });

        // Poll once on next tick (metrics agent runs every 6h so we'll poll next run)
        await sql`
          INSERT INTO metrics_runs (user_id, run_id, run_status, linkedin_url)
          VALUES (${u.user_id + '_ig'}, ${runId}, 'processing', ${u.instagram_profile_url})
          ON CONFLICT (user_id) DO UPDATE
            SET run_id = ${runId}, run_status = 'processing', updated_at = NOW()
        `;
        started++;
      } catch (err) {
        // Check if a previous run is done
        try {
          const [run] = await sql`SELECT * FROM metrics_runs WHERE user_id = ${u.user_id + '_ig'}`;
          if (run?.run_status === 'processing' && run.run_id) {
            const runData = await apifyCheckRun(run.run_id);
            if (runData?.status === 'SUCCEEDED') {
              const raw = await apifyFetchDataset(runData.defaultDatasetId);
              const count = await processInstagramMetricsResults(u.user_id, u.session_id, Array.isArray(raw) ? raw : (raw.items || []));
              await sql`UPDATE metrics_runs SET run_status = 'done', processed_at = NOW(), updated_at = NOW() WHERE user_id = ${u.user_id + '_ig'}`;
              imported += count;
            }
          }
        } catch (innerErr) {
          console.error(`Instagram metrics failed for user ${u.user_id}:`, innerErr.message);
        }
      }
    }

    return { action: `Started ${started} Instagram profile scrapes, imported ${imported} posts with metrics` };
  });
}

// ─── PUBLISH AGENT ────────────────────────────────────────────────────────────
// Runs every 15 minutes. Posts approved content when scheduled_for <= NOW().

const publishingUsers = new Set(); // idempotency guard

async function publishToLinkedIn(accessToken, platformUserId, content) {
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: `urn:li:person:${platformUserId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: content },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`LinkedIn API error: ${JSON.stringify(data)}`);
  // LinkedIn returns the post URN in X-RestLi-Id header or in the response body
  return data.id || res.headers.get('x-restli-id') || null;
}

async function publishToInstagram(accessToken, platformUserId, content, imageUrl) {
  if (!imageUrl) throw new Error('Instagram requires an image URL');

  // Step 1: Create media container
  const containerRes = await fetch(`https://graph.facebook.com/v20.0/${platformUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption: content, access_token: accessToken }),
  });
  const container = await containerRes.json();
  if (!container.id) throw new Error(`Instagram container error: ${JSON.stringify(container)}`);

  // Step 2: Publish the container
  const publishRes = await fetch(`https://graph.facebook.com/v20.0/${platformUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
  });
  const published = await publishRes.json();
  if (!published.id) throw new Error(`Instagram publish error: ${JSON.stringify(published)}`);
  return published.id;
}

async function runPublishAgent() {
  return runAgent('publish', null, async () => {
    const due = await sql`
      SELECT gp.id, gp.user_id, gp.platform, gp.content, gp.format, gp.image_url
      FROM generated_posts gp
      WHERE gp.status = 'approved'
        AND gp.scheduled_for IS NOT NULL
        AND gp.scheduled_for <= NOW()
      ORDER BY gp.scheduled_for ASC
      LIMIT 20
    `;

    let published = 0;
    let failed = 0;

    for (const post of due) {
      if (publishingUsers.has(post.user_id + ':' + post.platform)) continue;
      publishingUsers.add(post.user_id + ':' + post.platform);

      try {
        const [token] = await sql`
          SELECT access_token, platform_user_id, expires_at
          FROM oauth_tokens
          WHERE user_id = ${post.user_id} AND platform = ${post.platform}
        `;

        if (!token) {
          await sql`
            INSERT INTO publish_log (id, post_id, user_id, platform, status, error_msg)
            VALUES (${crypto.randomUUID()}, ${post.id}, ${post.user_id}, ${post.platform}, 'failed', 'No OAuth token found')
          `;
          failed++;
          continue;
        }

        if (token.expires_at && new Date(token.expires_at) < new Date()) {
          await sql`
            INSERT INTO publish_log (id, post_id, user_id, platform, status, error_msg)
            VALUES (${crypto.randomUUID()}, ${post.id}, ${post.user_id}, ${post.platform}, 'failed', 'OAuth token expired — re-authenticate required')
          `;
          await sql`
            INSERT INTO notification_queue (id, user_id, type, payload)
            VALUES (${crypto.randomUUID()}, ${post.user_id}, 'auth_expired', ${JSON.stringify({ platform: post.platform })})
          `;
          failed++;
          continue;
        }

        const plainToken = decryptToken(token.access_token);
        let platformPostId = null;

        if (post.platform === 'linkedin') {
          platformPostId = await publishToLinkedIn(plainToken, token.platform_user_id, post.content);
        } else if (post.platform === 'instagram') {
          if (!post.image_url) {
            // Log as pending_image instead of failing — user needs to attach an image URL first
            await sql`
              INSERT INTO publish_log (id, post_id, user_id, platform, status, error_msg)
              VALUES (${crypto.randomUUID()}, ${post.id}, ${post.user_id}, ${post.platform}, 'pending_image', 'No image URL set — attach an image via the review panel before publishing')
            `;
            continue;
          }
          platformPostId = await publishToInstagram(plainToken, token.platform_user_id, post.content, post.image_url);
        } else {
          throw new Error(`Unsupported platform: ${post.platform}`);
        }

        await sql`
          UPDATE generated_posts
          SET status = 'published', published_at = NOW(), platform_post_id = ${platformPostId}
          WHERE id = ${post.id}
        `;
        await sql`
          INSERT INTO publish_log (id, post_id, user_id, platform, status, platform_post_id)
          VALUES (${crypto.randomUUID()}, ${post.id}, ${post.user_id}, ${post.platform}, 'success', ${platformPostId})
        `;
        await sql`
          INSERT INTO notification_queue (id, user_id, type, payload)
          VALUES (${crypto.randomUUID()}, ${post.user_id}, 'publish_success', ${JSON.stringify({ post_id: post.id, platform: post.platform })})
        `;
        published++;
      } catch (err) {
        console.error(`Publish agent failed for post ${post.id}:`, err.message);
        await sql`
          INSERT INTO publish_log (id, post_id, user_id, platform, status, error_msg)
          VALUES (${crypto.randomUUID()}, ${post.id}, ${post.user_id}, ${post.platform}, 'failed', ${err.message})
        `;
        await sql`
          INSERT INTO notification_queue (id, user_id, type, payload)
          VALUES (${crypto.randomUUID()}, ${post.user_id}, 'publish_failed', ${JSON.stringify({ post_id: post.id, platform: post.platform, error: err.message })})
        `;
        failed++;
      } finally {
        publishingUsers.delete(post.user_id + ':' + post.platform);
      }
    }

    return { action: `Published ${published} posts, ${failed} failed` };
  });
}

// ─── AGENT API ROUTES ─────────────────────────────────────────────────────────

app.get('/api/agents/status', requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM agent_runs WHERE user_id=${req.user.id} OR user_id IS NULL ORDER BY agent_name`;
    res.json({ agents: rows });
  } catch (err) {
    serverErr(res, err);
  }
});

app.post('/api/agents/:name/run', requireAuth, async (req, res) => {
  const { name } = req.params;
  const agentMap = {
    concept:            runConceptAgent,
    scoring:            runScoringAgent,
    feedback:           runFeedbackAgent,
    metrics:            runMetricsAgent,
    evolution:          runEvolutionAgent,
    autogen:            runAutoGenAgent,
    decide:             runDecideAgent,
    instagram_metrics:  runInstagramMetricsAgent,
    publish:            runPublishAgent,
  };
  if (!agentMap[name]) return res.status(404).json({ error: 'Unknown agent' });
  try {
    res.json({ ok: true, message: `Agent ${name} started` });
    agentMap[name]().catch(err => console.error(`Manual agent run ${name} failed:`, err.message));
  } catch (err) {
    serverErr(res, err);
  }
});

app.get('/api/agents/loop-stats', requireAuth, async (req, res) => {
  try {
    const [agentRows, inFlightRow, brainDiaryRows, postsRow] = await Promise.all([
      sql`SELECT agent_name, status, run_count, started_at, created_at FROM agent_runs`,
      sql`SELECT COUNT(*)::int AS count FROM idea_queue WHERE user_id=${req.user.id} AND status IN ('pending','generating')`,
      sql`SELECT COUNT(*)::int AS count FROM brain_diary WHERE user_id=${req.user.id}`,
      sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='published')::int AS published FROM generated_posts WHERE user_id=${req.user.id}`,
    ]);

    const agentMap = {};
    for (const r of agentRows) {
      agentMap[r.agent_name] = r;
    }

    const KNOWN_AGENTS = ['concept','autogen','scoring','decide','metrics','evolution','feedback','publish'];
    const errorCount = KNOWN_AGENTS.filter(n => agentMap[n]?.status === 'error').length;
    const loopIntegrity = Math.round(((KNOWN_AGENTS.length - errorCount) / KNOWN_AGENTS.length) * 100);

    const throughput = {};
    for (const name of KNOWN_AGENTS) {
      const r = agentMap[name];
      if (!r) { throughput[name] = { total: 0, rate: 0 }; continue; }
      const hoursRunning = r.created_at
        ? Math.max(1, (Date.now() - new Date(r.created_at).getTime()) / 3600000)
        : 24;
      throughput[name] = {
        total: r.run_count || 0,
        rate: Math.round((r.run_count || 0) / hoursRunning * 10) / 10,
        status: r.status || 'idle',
        last_action: r.last_action || null,
        started_at: r.started_at || null,
      };
    }

    const decideAgent = agentMap['decide'];
    const cyclesCompleted = decideAgent?.run_count || 0;

    res.json({
      loopIntegrity,
      inFlight: inFlightRow[0]?.count || 0,
      cyclesCompleted,
      totalPosts: postsRow[0]?.total || 0,
      publishedPosts: postsRow[0]?.published || 0,
      brainEntries: brainDiaryRows[0]?.count || 0,
      throughput,
      nextRuns: {
        concept:   '07:00 UTC daily',
        autogen:   'every 4h',
        scoring:   '09:00 UTC daily',
        decide:    'Mon 10:00 UTC',
        metrics:   'every 6h',
        evolution: 'Sun 05:00 UTC',
        feedback:  'Sun 06:00 UTC',
        publish:   'every 15 min',
      },
    });
  } catch (err) {
    serverErr(res, err);
  }
});

// ─── IDEA QUEUE ROUTES ────────────────────────────────────────────────────────

app.get('/api/ideas', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const rows = status
      ? await sql`SELECT * FROM idea_queue WHERE user_id=${req.user.id} AND status=${status} ORDER BY priority DESC, created_at DESC`
      : await sql`SELECT * FROM idea_queue WHERE user_id=${req.user.id} ORDER BY priority DESC, created_at DESC`;
    res.json({ ideas: rows });
  } catch (err) {
    serverErr(res, err);
  }
});

app.post('/api/ideas', requireAuth, async (req, res) => {
  try {
    const { topic, hook, angle, pillar_name, platform, session_id } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic required' });
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO idea_queue (id, user_id, session_id, topic, hook, angle, pillar_name, platform, source)
      VALUES (${id}, ${req.user.id}, ${session_id || null}, ${topic}, ${hook || null}, ${angle || null}, ${pillar_name || null}, ${platform || 'linkedin'}, 'manual')
    `;
    const [row] = await sql`SELECT * FROM idea_queue WHERE id=${id}`;
    res.json({ idea: row });
  } catch (err) {
    serverErr(res, err);
  }
});

const VALID_IDEA_STATUSES = new Set(['pending','generating','created','scheduled','published','analyzed','archived','rejected']);

app.get('/api/ideas/:id', requireAuth, async (req, res) => {
  try {
    const [row] = await sql`SELECT * FROM idea_queue WHERE id=${req.params.id} AND user_id=${req.user.id}`;
    if (!row) return res.status(404).json({ error: 'Idea not found' });
    res.json({ idea: row });
  } catch (err) {
    serverErr(res, err);
  }
});

app.patch('/api/ideas/:id', requireAuth, async (req, res) => {
  try {
    const { status, priority, platform } = req.body;
    if (status !== undefined && !VALID_IDEA_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });
    if (status !== undefined) await sql`UPDATE idea_queue SET status=${status}, updated_at=NOW() WHERE id=${req.params.id} AND user_id=${req.user.id}`;
    if (priority !== undefined) await sql`UPDATE idea_queue SET priority=${priority}, updated_at=NOW() WHERE id=${req.params.id} AND user_id=${req.user.id}`;
    if (platform !== undefined) await sql`UPDATE idea_queue SET platform=${platform}, updated_at=NOW() WHERE id=${req.params.id} AND user_id=${req.user.id}`;
    if (status === undefined && priority === undefined && platform === undefined) return res.status(400).json({ error: 'Nothing to update' });
    const [row] = await sql`SELECT * FROM idea_queue WHERE id=${req.params.id} AND user_id=${req.user.id}`;
    res.json({ idea: row });
  } catch (err) {
    serverErr(res, err);
  }
});

app.delete('/api/ideas/:id', requireAuth, async (req, res) => {
  try {
    await sql`DELETE FROM idea_queue WHERE id=${req.params.id} AND user_id=${req.user.id}`;
    res.json({ ok: true });
  } catch (err) {
    serverErr(res, err);
  }
});

app.post('/api/ideas/:id/generate', requireAuth, async (req, res) => {
  try {
    const [idea] = await sql`SELECT * FROM idea_queue WHERE id=${req.params.id} AND user_id=${req.user.id}`;
    if (!idea) return res.status(404).json({ error: 'Idea not found' });

    await sql`UPDATE idea_queue SET status='generating', updated_at=NOW() WHERE id=${idea.id}`;

    // Load session for this user
    const sessions = await sql`SELECT * FROM sessions WHERE user_id=${req.user.id} ORDER BY created_at DESC LIMIT 1`;
    if (!sessions.length) return res.status(400).json({ error: 'No session found. Upload a brand brief first.' });
    const session = sessions[0];

    // Build a generation request mirroring the existing /api/generate-post logic
    const fakeReq = {
      user: req.user,
      body: {
        sessionId: idea.session_id || session.id,
        platform: idea.platform || 'linkedin',
        pillarName: idea.pillar_name,
        tone: 'authentic',
        topic: idea.topic,
        hook: idea.hook,
        angle: idea.angle,
        personalityMap: session.personality_map,
        strategy: session.strategy,
        brandContext: session.brand_context,
        brandType: session.brand_type,
        styleFingerprint: session.style_fingerprint,
      },
    };

    const postId = crypto.randomUUID();
    // We call the internal generation function directly via a minimal inline version
    // (avoids duplicating the 4-stage pipeline — instead we forward to existing route logic)
    // For now, create a stub post and return so the UI can react immediately
    // The full generation happens asynchronously
    res.json({ ok: true, postId, message: 'Generating post in background...' });

    // Async generation
    (async () => {
      try {
        // Reuse the generatePost function via an internal HTTP call pattern
        // by importing the strategy directly
        const strategy = session.strategy;
        const pillar = (strategy?.content_pillars || []).find(p => p.name === idea.pillar_name) || {};
        const pm = session.personality_map || {};
        const bc = session.brand_context || {};

        const draft = await openai.chat.completions.create({
          model: MODEL,
          messages: [{
            role: 'user',
            content: `You are a ghostwriter. Write a ${idea.platform} post in first person for this brand.

BRAND: ${pm.name || bc.name || 'Unknown'}
PILLAR: ${idea.pillar_name || 'General'}
TOPIC: ${idea.topic}
HOOK: ${idea.hook || ''}
ANGLE: ${idea.angle || ''}
BRAND VOICE: ${JSON.stringify(strategy?.brand_voice || {})}
PLATFORM: ${idea.platform}

Write 1 complete post. Make it authentic, specific, and platform-native. No hashtags unless Instagram.`,
          }],
        });

        const content = draft.choices[0].message.content.trim();

        await sql`
          INSERT INTO generated_posts (id, session_id, user_id, platform, pillar_name, tone, content, status)
          VALUES (${postId}, ${session.id}, ${req.user.id}, ${idea.platform}, ${idea.pillar_name || null}, 'authentic', ${content}, 'draft')
        `;
        await sql`UPDATE idea_queue SET status='created', post_id=${postId}, updated_at=NOW() WHERE id=${idea.id}`;
      } catch (err) {
        console.error('Background idea generation failed:', err.message);
        await sql`UPDATE idea_queue SET status='pending', updated_at=NOW() WHERE id=${idea.id}`;
      }
    })();
  } catch (err) {
    serverErr(res, err);
  }
});

// ─── BRAIN DIARY ROUTES ───────────────────────────────────────────────────────

app.get('/api/brain-diary', requireAuth, async (req, res) => {
  try {
    const rows = await sql`
      SELECT * FROM brain_diary WHERE user_id=${req.user.id}
      ORDER BY created_at DESC LIMIT 100
    `;
    res.json({ entries: rows });
  } catch (err) {
    serverErr(res, err);
  }
});

app.post('/api/brain-diary', requireAuth, async (req, res) => {
  try {
    const { type, pattern, insight, platform, pillar_name } = req.body;
    if (!type || !pattern || !insight) return res.status(400).json({ error: 'type, pattern, insight required' });
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO brain_diary (id, user_id, type, pattern, insight, platform, pillar_name)
      VALUES (${id}, ${req.user.id}, ${type}, ${pattern}, ${insight}, ${platform || null}, ${pillar_name || null})
    `;
    const [row] = await sql`SELECT * FROM brain_diary WHERE id=${id}`;
    res.json({ entry: row });
  } catch (err) {
    serverErr(res, err);
  }
});

app.delete('/api/brain-diary/:id', requireAuth, async (req, res) => {
  try {
    await sql`DELETE FROM brain_diary WHERE id=${req.params.id} AND user_id=${req.user.id}`;
    res.json({ ok: true });
  } catch (err) {
    serverErr(res, err);
  }
});

// Returns learned prompt rules for the current user (what the evolution agent has learned)
app.get('/api/prompt-rules', requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT rules, updated_at FROM prompt_rules WHERE user_id = ${req.user.id}`;
    res.json({ rules: rows[0]?.rules || null, updatedAt: rows[0]?.updated_at || null });
  } catch (err) {
    serverErr(res, err);
  }
});

// ─── CRON SCHEDULER (only when running as main process) ──────────────────────

function startAgentScheduler() {
  cron.schedule('0 7 * * *',   () => runConceptAgent().catch(e => console.error('Concept agent cron failed:', e.message)));
  cron.schedule('0 9 * * *',   () => runScoringAgent().catch(e => console.error('Scoring agent cron failed:', e.message)));
  // Evolution runs after scoring (Sun 05:00) so rules are fresh before feedback summary (Sun 06:00)
  cron.schedule('0 5 * * 0',   () => runEvolutionAgent().catch(e => console.error('Evolution agent cron failed:', e.message)));
  cron.schedule('0 6 * * 0',   () => runFeedbackAgent().catch(e => console.error('Feedback agent cron failed:', e.message)));
  cron.schedule('0 */6 * * *', () => runMetricsAgent().catch(e => console.error('Metrics agent cron failed:', e.message)));
  // Autonomous loop additions
  cron.schedule('0 */4 * * *', () => runAutoGenAgent().catch(e => console.error('AutoGen agent cron failed:', e.message)));
  cron.schedule('0 10 * * 1',  () => runDecideAgent().catch(e => console.error('Decide agent cron failed:', e.message)));
  cron.schedule('0 3 */6 * *', () => runInstagramMetricsAgent().catch(e => console.error('Instagram metrics cron failed:', e.message)));
  cron.schedule('*/15 * * * *', () => runPublishAgent().catch(e => console.error('Publish agent cron failed:', e.message)));
  console.log('Agent scheduler started (concept 07:00, scoring 09:00, evolution Sun 05:00, feedback Sun 06:00, metrics every 6h, autogen every 4h, decide Mon 10:00, instagram_metrics every 6h offset, publish every 15min)');
}

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    console.log(`Social Brand Studio running at http://localhost:${PORT}`);
    startAgentScheduler();
  });
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${PORT} is already in use. Set a different PORT in .env\n`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}
