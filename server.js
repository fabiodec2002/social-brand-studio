require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const { neon } = require('@neondatabase/serverless');

const app = express();
const UPLOADS_DIR = path.join(os.tmpdir(), 'uploads');
const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 10 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sql = neon(process.env.DATABASE_URL);
const MODEL = 'gpt-4o-mini';

app.use(express.json());
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
}

initDb().catch(err => console.error('DB init failed:', err));

// Extract text from PDF using pdf-parse
async function extractPdfText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

// Parse personality map from text
async function parsePersonalityMap(text) {
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
${text}`
    }],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

// Generate social strategy from personality map
async function generateStrategy(personalityMap) {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{
      role: 'user',
      content: `You are an expert personal branding strategist. Based on this personality map, create a comprehensive social media strategy.

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

Return ONLY valid JSON, no markdown, no explanation. Make it deeply specific to their personality map data.`
    }],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

function buildInstagramInstructions(format, subType) {
  if (format === 'story') {
    const pillarNotes = {
      personality: 'Story Pillar — My Personality: Draw from an event that changed you, a core value shown through a real situation, a key achievement, your current phase/feeling, or a recurring Q&A / "this or that".',
      life: 'Story Pillar — My Life: Draw from your current routine (nutrition/sleep/workouts/education), something from your phone, how you relax or spend free time, a spontaneous plan shared step by step, or your full day documented.',
      expertise: 'Story Pillar — My Expertise: Draw from your journey becoming an expert, a 3–5 step plan in your field, answering a common question in your niche, current trends or industry challenges, or your learning plan and goals.',
    };
    return `Write an Instagram Story (format as 2–4 text overlay slides: [Slide 1], [Slide 2], etc. — or a short talking script).
      - Stories build daily trust and familiarity — more raw and unfiltered than feed posts.
      - ${pillarNotes[subType] || pillarNotes.personality}
      - Write like you're talking to one person, not broadcasting to an audience.
      - Each slide: 1 punchy idea, 1–2 sentences max.
      - End with a question, poll prompt ("Which are you? A or B?"), or "DM me" CTA to spark replies.
      - No hashtags needed for Stories.`;
  }

  if (format === 'reel') {
    const styleNotes = {
      talking: 'Reel Style — Talking (direct to camera): Share a mindset shift, unpopular opinion, or personal insight. Be direct, personal, confident. Write as a short script. First 3 seconds = a bold statement or provocative question that stops the scroll.',
      motivation: 'Reel Style — Motivation / Values: One powerful value-driven statement with text overlay energy (e.g. "The only way to impress me is being a good person"). Write the hook text (max 15 words) then expand in the caption with the "why" from your real life.',
      'tips-tricks': 'Reel Style — Tips & Tricks: The reel cover/hook grabs attention; the caption delivers the value. Use a proven hook formula then list 3–5 tips as a numbered caption. Hooks: "5 unusual ways to X that actually work", "Most people do this wrong every day…", "X things successful people do — are you doing them?"',
    };
    return `Write a Reel hook + caption (80–150 words total).
      - ${styleNotes[subType] || styleNotes.talking}
      - First 3 seconds are everything — open with a scroll-stopping statement.
      - Short sentences, high energy, punchy rhythm throughout.
      - End with a comment-driving question.
      - Include 8–12 hashtags on a new line at the end.`;
  }

  // Default: carousel post
  const categoryNotes = {
    educational: 'Carousel Category — Educational / Tips: "5 mistakes people make when X" or "5 things to know about Y." Each tip is one clear slide.',
    'how-to': 'Carousel Category — Step-by-step / How-to: Walk through a clear process. Each slide = one step. End with the result they will achieve.',
    transformation: 'Carousel Category — Transformation / Before & After: Show a before state, the journey, and the after. Make it relatable and specific to your real experience.',
    'myth-busting': 'Carousel Category — Myth-busting / Challenges: Directly challenge a common belief in your niche. Be bold and back it with your real experience.',
    storytelling: 'Carousel Category — Storytelling / Personal Example: Structure as situation → problem → insight → lesson. Personal, specific, no generic advice.',
    frameworks: 'Carousel Category — Frameworks / Cheatsheets: Give a practical, repeatable system. Clear steps, no fluff. Make it saveable.',
  };
  return `Write a carousel post with labeled slides:
      - [Slide 1 — Hook]: Thumb-stopping first line. Proven hooks: "Here's what most people get wrong about X…", "Stop making this mistake…", "X things I wish I knew before Y."
      - [Slides 2–5 — Body]: Each slide = 1 clear idea, tip, or step (1–3 short sentences max per slide).
      - [Last Slide — CTA]: "Save this", "DM me to work together", "Try this today", or a compelling question.
      - ${categoryNotes[subType] || categoryNotes.educational}
      - Caption hashtags (8–12) listed after the slides.
      - Visual, emotional language — paint a picture on every slide.`;
}

// Generate a social post
async function generatePost(personalityMap, strategy, platform, pillar, tone, customTopic, instagramOptions = {}) {
  const pillarData = customTopic
    ? { name: 'Custom Topic', description: customTopic }
    : (strategy.content_pillars.find(p => p.id === pillar) || strategy.content_pillars[0]);

  const igFormat = (instagramOptions || {}).format || 'post';
  const igSubType = (instagramOptions || {}).subType || '';

  const platformInstructions = {
    linkedin: `Write a LinkedIn post (150-250 words).

STRUCTURE:
- Hook (1-2 lines): Drop the reader mid-scene or mid-thought. No windup. No "Today I want to talk about..."
- Body (3-5 short paragraphs, 1-3 lines each): One idea per block. Build from the hook.
- Ending: A real question they're still sitting with, or a quiet observation. NOT a call-to-action prompt.

SENTENCE RHYTHM — non-negotiable:
Vary sentence length deliberately. Use fragments for emphasis. Like this. Then a longer sentence that earns the emphasis by adding context and showing you've actually lived through something. Short again. The rhythm itself signals authenticity.

SPECIFICITY RULE:
Every abstract claim needs one concrete anchor: a number, a name, a date, a place, a specific conversation. "We lost the client" is nothing. "We lost the €40k client two days before payroll" is a post.

BANNED OPENERS — the first word must NOT be:
"I" / "Today" / "In" / "As" / "The" / "We"

BANNED PHRASES — never write these:
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

WHAT AUTHENTIC POSTS DO:
- Start with a specific moment already in progress, not a setup
- Let the story prove the point — never state the lesson out loud
- Include one moment of doubt, self-correction, or things not going to plan
- End before the moral, not after it

FORMATTING: 3-5 hashtags on their own line at the end. No emojis unless natural to their voice. Line break between each paragraph.`,
    instagram: buildInstagramInstructions(igFormat, igSubType),
  };

  const toneInstructions = {
    authentic: `Write like you're thinking out loud mid-conversation. Anchor it in one specific real moment — a number, a name, a date. Use at least one sentence fragment for emphasis. Somewhere in the post, show a crack: a mistake, a doubt, something still unresolved. Do NOT tie it up neatly at the end.`,
    educational: `Teach from a specific situation, not from a list of tips. Open with the moment you encountered the problem — not the solution. Each insight must connect to something real from their background. End with a question they're genuinely still sitting with, not one engineered to drive engagement.`,
    storytelling: `First line must drop the reader into a moment already in progress — no setup, no "let me tell you about the time...". Include at least one line of actual dialogue. Include one small physical or situational detail that only they would know. Do NOT explain what the story means — end the story and stop.`,
    motivational: `Motivation through specificity, not inspiration. Show the exact moment of failure or the exact second of doubt — not the lesson from it. Give a number, a name, or a date to make it real. Avoid all motivational poster language. Trust the specific truth to do the inspiring — don't explain it.`,
    casual: `Write like a DM to a smart friend who'd call you out if you were performing. Contractions everywhere. One self-deprecating aside. No professional distance. Something slightly unpolished — a thought that trails off, a sentence that doesn't wrap up cleanly. Should feel like it was written in 15 minutes, then lightly edited.`,
    contrarian: `Name the specific belief you're challenging — quote it or show exactly where you see it repeated. Use one concrete example from their own work to show where it breaks down. Do not hedge. Do not add a balanced take at the end. State your actual position and stop. It's fine if the skeptics aren't convinced.`
  };

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{
      role: 'user',
      content: `You are ghostwriting a social media post for a specific person. You will write in their voice, in first person, as if they typed it themselves.

THEIR PERSONALITY MAP:
${JSON.stringify(personalityMap, null, 2)}

THEIR BRAND VOICE:
${JSON.stringify(strategy.brand_voice, null, 2)}

CONTENT PILLAR: ${pillarData.name} — ${pillarData.description}

PLATFORM: ${platform.toUpperCase()}
${platformInstructions[platform]}

TONE DIRECTION: ${toneInstructions[tone]}

HOW AI-WRITTEN POSTS FAIL — avoid every one of these patterns:
- Explaining the lesson instead of showing it ("This taught me that persistence pays off" → just show the persistence, let the reader conclude)
- Vague time references ("Recently", "A few years ago", "Early in my career") → use specific timeframes from their actual history
- Starting 3 or more sentences in the post with "I"
- Transition words that signal AI: "Moreover", "Furthermore", "In essence", "Ultimately", "Importantly", "Notably"
- Perfect grammar and symmetrical structure throughout — human writing has natural rough edges
- Generic emotional language ("I felt so overwhelmed") → use a specific situation or detail instead
- Building to a neat, resolved conclusion — real stories often just stop
- Any sentence that reads like a motivational poster

WHAT MAKES IT FEEL REAL:
- One specific, surprising detail that only they would know (a real number, a name, a specific place or date from their map)
- At least one sentence fragment used deliberately for emphasis
- The vocabulary and references fit their background and geography — not generic Western corporate English
- Something slightly unresolved at the end — a question they're still holding, not one they've answered

Write ONLY the post text. Nothing else — no preamble, no "here's the post:", no quotation marks around it.`
    }],
  });

  return response.choices[0].message.content.trim();
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

// ─── Routes ──────────────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const text = await extractPdfText(req.file.path);
    fs.unlinkSync(req.file.path);

    const personalityMap = await parsePersonalityMap(text);
    const strategy = await generateStrategy(personalityMap);

    const id = Date.now().toString();
    await sql`
      INSERT INTO sessions (id, name, pdf_name, personality_map, strategy)
      VALUES (${id}, ${personalityMap.name || 'Unknown'}, ${req.file.originalname}, ${JSON.stringify(personalityMap)}, ${JSON.stringify(strategy)})
    `;

    res.json({ success: true, id, personalityMap, strategy });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/sessions', async (req, res) => {
  try {
    const rows = await sql`SELECT id, name, pdf_name, created_at FROM sessions ORDER BY created_at DESC`;
    res.json(rows.map(r => ({ id: r.id, name: r.name, pdfName: r.pdf_name, createdAt: r.created_at })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  try {
    const rows = await sql`SELECT personality_map, strategy FROM sessions WHERE id = ${req.params.id}`;
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true, personalityMap: rows[0].personality_map, strategy: rows[0].strategy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await sql`DELETE FROM sessions WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate-post', async (req, res) => {
  try {
    const { personalityMap, strategy, platform, pillar, tone, customTopic, instagramOptions } = req.body;
    const post = await generatePost(personalityMap, strategy, platform, pillar, tone, customTopic, instagramOptions);
    res.json({ success: true, post });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/refine-post', async (req, res) => {
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/viral-trends', async (req, res) => {
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/remake-post', async (req, res) => {
  try {
    const { viralPost, personalityMap, strategy, platform } = req.body;
    if (!viralPost || !personalityMap || !strategy) {
      return res.status(400).json({ error: 'viralPost, personalityMap, and strategy are required' });
    }

    const platformInstructions = {
      linkedin: 'LinkedIn post (180-280 words). Short paragraphs, strong hook, end with a question or CTA. 3-5 hashtags.',
      instagram: 'Instagram caption (100-180 words). Thumb-stopping first line, casual tone, end with a question. 8-12 hashtags.',
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
    console.error(err);
    res.status(500).json({ error: err.message });
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
