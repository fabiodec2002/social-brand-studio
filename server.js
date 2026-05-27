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
app.use(express.static(path.join(__dirname, 'public')));

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
  if (process.env.SEED_USER_EMAIL && process.env.SEED_USER_WEBSITE) {
    await sql`UPDATE users SET website_url = ${process.env.SEED_USER_WEBSITE} WHERE email = ${process.env.SEED_USER_EMAIL} AND (website_url IS NULL OR website_url = '')`;
  }
}

initDb().catch(err => console.error('DB init failed:', err));

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc00:|fd)/i;

function isSafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname;
    if (host === 'localhost' || PRIVATE_IP_RE.test(host)) return false;
    return true;
  } catch {
    return false;
  }
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
      - End with a binary-choice poll ("Which are you? A or B?"), a fill-in-the-blank ("The thing I wish I'd done earlier was ___"), or "DM me [specific keyword]" to drive replies. These get responses; "What do you think?" does not.
      - No hashtags needed for Stories.`;
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
      - Short sentences, high energy, punchy rhythm. Use sentence fragments for emphasis.
      - PRONOUN ARCHITECTURE: Open with "I" (specific experience). Pivot to "you" in the lesson (payoff is about the reader, not the creator).
      - CTA: one specific ask only. "Comment [keyword] and I'll DM you the full breakdown" drives both comments and DMs simultaneously. Or: "Which of these surprised you most? Comment the number."
      - HASHTAGS: 3–5 specific hashtags after two blank lines. No hashtag with over 500k posts. Hard platform limit: 5 maximum.`;
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

ABOVE THE FOLD — first ~20 words (critical):
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

KEYWORD-FIRST: Embed the primary topic keyword naturally in the first 1–2 sentences. Instagram now crawls captions for search ranking.

HASHTAGS: 3–5 specific hashtags after two blank lines. No hashtag broader than 500k posts. Maximum 5 — hard platform limit since December 2025.

BANNED: "In today's world" / "It's no secret that" / "When it comes to" / "At the end of the day" / "I'm excited to share" / "Honored and humbled" / passive voice / capitalizing Success / Mindset / Abundance / Journey as spiritual nouns / any sentence that could appear on a motivational poster unchanged.`;
  }

  // Default: carousel post
  const categoryNotes = {
    educational: 'Carousel Category — Educational / Tips: Use an odd number of items (5 or 7, never 4 or 6 — odd numbers feel more credible and less calculated). Each tip = one clear, actionable sentence.',
    'how-to': 'Carousel Category — Step-by-step / How-to: Each slide = one step with an action verb that tells the reader exactly what to do. End with the specific measurable result they will have achieved.',
    transformation: "Carousel Category — Transformation: Slide 1 = the before state with one specific detail ('47 unread emails, no system'). Last body slide = the after state, equally specific. The transformation must be real and measurable.",
    'myth-busting': "Carousel Category — Myth-busting: Slide 1 names the myth as it is commonly stated — quote it or show exactly where you've heard it. Each subsequent slide dismantles one aspect with a specific counter-example from their real work.",
    storytelling: 'Carousel Category — Storytelling: Structure as: specific moment (time + place) → what happened → what changed → what you do differently now. End before the moral — stop after the last real event.',
    frameworks: 'Carousel Category — Frameworks / Cheatsheets: Each slide = one component of the system with a clear label. Last slide = the trigger (when to use this framework). Make it screenshot-worthy.',
  };
  return `Write a carousel post with labeled slides:

[Slide 1 — Hook]: Contains a specific problem or outcome — not a vague promise.
Proven structures:
- "X things I wish I knew before [specific situation]" (use odd numbers)
- "Here's what most [specific role] get wrong about [specific thing]"
- "Stop [doing specific thing]. Here's what to do instead."

[Slides 2–6 — Body]: 1–3 short sentences per slide. Vary lengths — never all slides identical.
At least one slide must contain a specific number, name, or concrete example.
Use odd total item counts (5 or 7 items feel more authentic than 4 or 6).

[Last Slide — CTA]: Optimize for SAVES — highest-value engagement signal on Instagram.
- "Save this for when you're [specific named situation]" outperforms "Save this post" by 3x.
- Or: "Comment [number] of the step you need most" (drives comments and reach simultaneously).
- Never: "Let me know what you think" / "Drop your thoughts."

${categoryNotes[subType] || categoryNotes.educational}

Caption (after last slide): 2–4 sentences. Add context, vulnerability, or a personal detail not in the slides.
Embed the primary keyword naturally in the first sentence (Instagram indexes captions for search).
HASHTAGS: 3–5 specific hashtags after two blank lines. Maximum 5 — hard platform limit since December 2025.

BANNED in slides and caption: Moreover, Furthermore, That being said, tapestry, resonate, delve, pivotal, showcase, passive voice, "It goes without saying", "As you can see".`;
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

3. BANNED WORDS — replace any of these with plain, direct alternatives:
   delve / delve into / leverage (as verb) / landscape (as metaphor for industry) / tapestry / journey (as metaphor for career or growth) / resonate / illuminate / navigate (metaphorically) / showcase / fostering / bolstered / pivotal / crucial / testament / cornerstone / vibrant / meticulous / Moreover / Furthermore / Additionally / In conclusion / In summary / That being said / Having said that / With that being said / It is worth noting / It's worth noting / Let's dive in / serves as (as a replacement for "is") / stands as / Not only X but also Y (as structural pattern) / nuanced (without specific elaboration following it)

4. NON-RESOLUTION: The ending must NOT summarize the lesson, state the takeaway, or tell the reader what to conclude. If it does, cut that sentence. End at the last real moment, observation, or question the writer is genuinely still holding — not one engineered to sound humble.

5. NO METRONOMIC RHYTHM: If more than 2 consecutive sentences are the same approximate length, break the pattern. Add a fragment. Or let one sentence run long.

6. TEMPORAL OR SENSORY GROUNDING: Check whether the post contains at least one grounding detail — a specific time, place, or physical sensation. If one is present, good. If absent, do NOT fabricate one — instead, check whether there is a vague reference ("recently", "one morning") that can be made more concrete based on what is already in the post. Never invent a location, date, or detail not implied by the existing text.

Return ONLY the revised post. If all 6 rules pass, return the original unchanged.`,
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
async function generatePost(personalityMap, strategy, platform, pillar, tone, customTopic, instagramOptions = {}, topPosts = [], brandType = 'personal') {
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

WHAT STRONG COMPANY POSTS DO:
- Show real client or team situations, not abstract principles
- Let results and specifics do the talking
- Have a distinct company point of view, not generic industry wisdom
- Sound like a smart team talking openly, not a PR department

FORMATTING: 3-5 hashtags on their own line at the end. No emojis unless aligned with brand voice. Line break between each paragraph.`;

  const platformInstructions = {
    linkedin: isPersonal ? linkedinPersonal : linkedinBusiness,
    instagram: buildInstagramInstructions(igFormat, igSubType),
  };

  const toneInstructions = {
    authentic: `Behavioral requirements: Write as if you're mid-thought, not presenting. At least one sentence must begin with "And" or "But" — humans do this in natural speech. Show a crack somewhere in the post: a mistake, a doubt, something you got wrong, or something still unresolved. Do NOT explain what the crack means — name it and keep moving. Do not tie the ending up neatly. Use "I" at most once per paragraph. Anchor the whole post in one specific real moment — a number, a name, a date from their background — not a general claim.`,
    educational: `Behavioral requirements: Open with the specific moment you encountered the problem — not the solution, not the lesson. Each insight must trace back to something real from their background, not generic advice. Express conviction at the moment of specific experience ("I know this because in 2021 I..."), then let uncertainty return in the closing question. End with a question you are genuinely still holding — not one engineered to get comments. The question should feel like you wrote the post to think something through, not to teach.`,
    storytelling: `Behavioral requirements: First line must land the reader mid-action — no setup sentence, no "let me tell you." Include at least one line of actual dialogue (even an internal one: "I kept thinking, just say no."). Include one physical or temporal anchor — a time of day, a specific place, a sensation you remember. Repeat the key noun deliberately rather than using synonyms for it. Do NOT explain what the story means — end the story and stop. Cut the last sentence if it sounds like a lesson.`,
    motivational: `Behavioral requirements: Show the exact specific moment of failure or doubt — not the lesson extracted from it. Give a real number, a real name, or a real date to ground the moment. The inspiration must come from the specificity of the truth, not from inspiring language — never write a sentence that would look good on a wall poster. Do not start the post with an inspiration frame. Start in the failure, not in the recovery. Allow the ending to point forward without stating the outcome.`,
    casual: `Behavioral requirements: Write like a DM to a smart friend who'd call you out if you were performing. Use contractions throughout. Include one self-deprecating aside in parentheses or em dash. Allow one "anyway," "honestly," or "look —" to create natural register shifts. One thought should trail off or not fully resolve. Should feel like it was written in 15 minutes, then barely edited. No professional distance — use "you" to mean one specific type of person, not everyone.`,
    contrarian: `Behavioral requirements: The first sentence must name the specific advice, belief, or claim being challenged — not "conventional wisdom" but the actual thing ("Everyone says you need to post daily to grow. I don't buy it."). Use one concrete example from their actual work or background to show where the conventional belief breaks down. Do not hedge after making the claim. Do not add a "but of course it depends" balance at the end. State your actual position and stop. The post is stronger if the skeptics are not satisfied.`
  };

  const systemPrompt = isPersonal
    ? `You are ghostwriting a social media post for a specific person. You will write in their voice, in first person, as if they typed it themselves.

CRITICAL — NO FABRICATION: You may ONLY reference details that appear in the personality map data provided. Do not invent names, dates, numbers, client results, places, or specific situations that are not in the data. If a detail is not in the map, describe the experience generally or leave it out. Fake specificity is worse than honest vagueness.`
    : `You are ghostwriting a social media post for a company brand. Write in first person plural (we/our/us) from the company's perspective, as if a senior team member typed it. The voice should reflect the company's character, not any single individual.

CRITICAL — NO FABRICATION: You may ONLY reference details, results, and situations that appear in the brand brief provided. Do not invent client names, revenue figures, timelines, case study outcomes, or specific scenarios not in the data. If a detail is not in the brief, describe it generally or omit it. Made-up specifics destroy trust when readers notice them.`;

  const brandContext = isPersonal
    ? `THEIR PERSONALITY MAP:\n${JSON.stringify(personalityMap, null, 2)}\n\nTHEIR BRAND VOICE:\n${JSON.stringify(strategy.brand_voice, null, 2)}`
    : `COMPANY BRIEF:\n${JSON.stringify(personalityMap, null, 2)}\n\nCOMPANY BRAND VOICE:\n${JSON.stringify(strategy.brand_voice, null, 2)}`;

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

${brandContext}

CONTENT PILLAR: ${pillarData.name} — ${pillarData.description}

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
Write ONLY the post text. Nothing else — no preamble, no "here's the post:", no quotation marks around it.`
    }],
  });

  const firstDraft = response.choices[0].message.content.trim();
  const styledDraft = await selfCritiquePost(firstDraft, platform);
  return verifyAndFixFabrications(styledDraft, personalityMap);
}

// ─── Viral Intelligence ──────────────────────────────────────────────────────

const APIFY_BASE = 'https://api.apify.com/v2';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const dream100 = JSON.parse(fs.readFileSync(path.join(__dirname, 'dream100.json')));

async function apifyStartRun(actorId, input) {
  const token = process.env.APIFY_API_TOKEN;
  const slug = actorId.replace('/', '~');
  const res = await fetch(`${APIFY_BASE}/acts/${slug}/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const { data: run } = await res.json();
  if (!run?.id) throw new Error(`Failed to start Apify actor ${actorId}`);
  return run.id;
}

async function apifyCheckRun(runId) {
  const token = process.env.APIFY_API_TOKEN;
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`);
  const { data } = await res.json();
  return data;
}

async function apifyFetchDataset(datasetId) {
  const token = process.env.APIFY_API_TOKEN;
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&limit=500`);
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
    const rows = await sql`SELECT email, website_url FROM users WHERE id = ${req.user.id}`;
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, email: rows[0].email, websiteUrl: rows[0].website_url || '' });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.put('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const { websiteUrl } = req.body;
    await sql`UPDATE users SET website_url = ${websiteUrl || null} WHERE id = ${req.user.id}`;
    res.json({ success: true });
  } catch (err) {
    return serverErr(res, err);
  }
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.post('/api/upload', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const text = await extractPdfText(req.file.path);
    fs.unlinkSync(req.file.path);

    const brandType = req.body.brand_type === 'business' ? 'business' : 'personal';
    const websiteUrl = (req.body.website_url || '').trim();
    const websiteText = websiteUrl ? await fetchWebsiteText(websiteUrl) : null;

    const personalityMap = brandType === 'business'
      ? await parseBrandBrief(text, websiteText)
      : await parsePersonalityMap(text, websiteText);
    const strategy = await generateStrategy(personalityMap, brandType);

    const id = crypto.randomUUID();
    await Promise.all([
      sql`
        INSERT INTO sessions (id, name, pdf_name, personality_map, strategy, brand_type, user_id, website_url)
        VALUES (${id}, ${personalityMap.name || 'Unknown'}, ${req.file.originalname}, ${JSON.stringify(personalityMap)}, ${JSON.stringify(strategy)}, ${brandType}, ${req.user.id}, ${websiteUrl || null})
      `,
      websiteUrl
        ? sql`UPDATE users SET website_url = ${websiteUrl} WHERE id = ${req.user.id}`
        : Promise.resolve(),
    ]);

    res.json({ success: true, id, personalityMap, strategy, brandType });
  } catch (err) {
    return serverErr(res, err);
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
    const rows = await sql`SELECT personality_map, strategy, brand_type FROM sessions WHERE id = ${req.params.id} AND user_id = ${req.user.id}`;
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true, personalityMap: rows[0].personality_map, strategy: rows[0].strategy, brandType: rows[0].brand_type || 'personal' });
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

const VALID_PLATFORMS = ['linkedin', 'instagram'];
const VALID_TONES = ['professional', 'conversational', 'bold', 'educational', 'inspirational', 'storytelling'];
const VALID_IG_FORMATS = ['post', 'normal', 'story', 'reel'];

app.post('/api/generate-post', requireAuth, async (req, res) => {
  try {
    const { personalityMap, strategy, platform, pillar, tone, customTopic, instagramOptions, sessionId, useAnalytics, brandType } = req.body;

    if (!VALID_PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Invalid platform' });
    if (tone && !VALID_TONES.includes(tone)) return res.status(400).json({ error: 'Invalid tone' });
    if (instagramOptions?.format && !VALID_IG_FORMATS.includes(instagramOptions.format)) return res.status(400).json({ error: 'Invalid Instagram format' });
    if (!personalityMap || !strategy) return res.status(400).json({ error: 'personalityMap and strategy are required' });

    let topPosts = [];
    if (sessionId && useAnalytics && ['linkedin', 'instagram'].includes(platform)) {
      const rows = await sql`SELECT posts FROM post_analytics WHERE session_id = ${sessionId} AND platform = ${platform} AND user_id = ${req.user.id}`;
      if (rows.length && Array.isArray(rows[0].posts)) {
        topPosts = rows[0].posts.slice(0, 3);
      }
    }

    const post = await generatePost(personalityMap, strategy, platform, pillar, tone, customTopic, instagramOptions, topPosts, brandType || 'personal');
    res.json({ success: true, post });
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
        const token = process.env.APIFY_API_TOKEN;
        const runsRes = await fetch(`${APIFY_BASE}/acts/${slug}/runs?token=${token}&status=SUCCEEDED&desc=1&limit=1`);
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
        content: `Convert this Instagram carousel post into structured slide data for a visual carousel builder. Return ONLY valid JSON.

POST TEXT:
${postText}

Return this exact JSON structure:
{
  "slides": [
    {
      "type": "title",
      "heading": "main hook (max 8 words, no punctuation at end)",
      "subheading": "supporting line (max 8 words)",
      "tag": "TOPIC LABEL",
      "username": "@yourhandle"
    },
    {
      "type": "content",
      "number": "01",
      "heading": "slide point heading (max 6 words)",
      "description": "1–2 sentence explanation of this point",
      "highlight": "single most memorable phrase from this slide",
      "image": null
    }
  ]
}

Rules:
- First slide MUST be type "title" — use the opening hook or [Slide 1] content
- Each subsequent slide (body slides + CTA) becomes a "content" slide
- Number content slides sequentially: "01", "02", "03", etc.
- The "tag" for the title slide: 1–2 word ALL CAPS topic category derived from content
- The "highlight" per content slide: the single sentence worth calling out visually
- Omit hashtags, captions, and any text that appears after the last slide
- Maximum 8 slides total
- Keep text concise — these appear on small visual cards`,
      }],
    });

    const result = JSON.parse(response.choices[0].message.content);
    if (!result.slides || !Array.isArray(result.slides)) throw new Error('Invalid response structure');
    res.json({ success: true, slides: result.slides });
  } catch (err) {
    return serverErr(res, err);
  }
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => console.log(`Social Brand Studio running at http://localhost:${PORT}`));
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${PORT} is already in use. Set a different PORT in .env\n`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}
