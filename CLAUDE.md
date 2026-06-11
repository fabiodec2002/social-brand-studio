# Social Brand Studio — Claude Code Guide

## Project overview

AI-powered social media post generator. Users upload a Marketing Mindset personality map PDF (personal brand) or business brief (business brand) → parses it → generates a brand strategy → lets users generate platform-optimized posts (LinkedIn / Instagram / Twitter / TikTok / Email) with 6 tone options.

## Stack

- **Backend**: Node.js + Express (`server.js`)
- **Frontend**: Single-file vanilla HTML/CSS/JS (`public/index.html`) + carousel builder (`public/carousel.js`)
- **AI**: OpenAI SDK (`openai`) — model `gpt-4o-mini`
- **Database**: Neon (serverless PostgreSQL) via `@neondatabase/serverless`
- **Auth**: JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`) — 30-day tokens
- **PDF parsing**: `pdf-parse`
- **File uploads**: `multer` — temp dir via `os.tmpdir()`, auto-cleaned after parse
- **Security**: `helmet` (CSP headers) + `express-rate-limit` (auth: 20/15min, API: 60/min)
- **Scheduling**: `node-cron`
- **Viral scraping**: Apify API (Instagram scraper + LinkedIn profile posts)
- **Config**: `dotenv` — see `.env requirements` below

## .env requirements

```
OPENAI_API_KEY=
DATABASE_URL=          # Neon connection string
JWT_SECRET=            # Required — server exits on startup if missing
APIFY_API_TOKEN=       # Optional — needed for viral trends feature
SEED_USER_EMAIL=       # Optional — seeds website_url on existing user at startup
SEED_USER_WEBSITE=     # Optional — used with SEED_USER_EMAIL
NODE_ENV=              # Set to "production" to hide error details
```

## Project structure

```
Socials/
├── server.js           # Express server + all AI logic
├── public/
│   ├── index.html      # Full frontend — single file, no build step
│   └── carousel.js     # Instagram carousel builder utility
├── dream100.json       # Accounts list for viral scraping (instagram/linkedin handles)
├── package.json
└── .env                # Not committed
```

## Development

```bash
npm run dev    # node --watch server.js — auto-restarts on changes
npm start      # production
```

Server runs at http://localhost:3000

## Database schema (Neon/Postgres)

Tables auto-created on startup via `initDb()`:

| Table | Purpose |
|-------|---------|
| `users` | Auth — id, email, password_hash, website_url, linkedin_profile_url |
| `sessions` | Per-upload brand sessions — personality_map, strategy, brand_context, brand_type, style_fingerprint |
| `generated_posts` | Post library — platform, format, tone, content, voice_score, status, engagement_score |
| `post_analytics` | Imported performance data for viral intelligence context |
| `viral_cache` | Cached Apify scrape results per platform with run_id/status |
| `knowledge_docs` | Persistent reference materials per user |
| `idea_queue` | Agent-generated post ideas per user/session |
| `brain_diary` | Learning log — wins/losses for the evolution agent |
| `agent_runs` | Orchestration state for autonomous agents |
| `prompt_rules` | Self-improving prompt rules per user (from evolution agent) |
| `metrics_runs` | LinkedIn metrics agent run tracking |

## API routes

### Auth
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/register` | Register user → returns JWT |
| POST | `/api/auth/login` | Login → returns JWT |
| GET | `/api/auth/profile` | Get profile (email, websiteUrl, linkedinProfileUrl) |
| PUT | `/api/auth/profile` | Update websiteUrl / linkedinProfileUrl |

### Sessions & Content
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/upload` | Upload PDF → parses map/brief, extracts brand context, saves session |
| POST | `/api/upload-reference` | Upload PDF reference doc → returns summary for post context |
| GET | `/api/sessions` | List user's sessions |
| GET | `/api/sessions/:id` | Load session (personalityMap, strategy, brandContext, brandType) |
| PUT | `/api/sessions/:id` | Update session strategy |
| PUT | `/api/sessions/:id/brand-context` | Update brand context (Brand DNA editor) |
| DELETE | `/api/sessions/:id` | Delete session |
| POST | `/api/generate-post` | Generate post — main AI call with 4-stage pipeline |
| POST | `/api/refine-post` | Edit existing post via natural language instruction |
| POST | `/api/generate-variations` | Generate 4 angle variations of a post |
| POST | `/api/generate-hooks` | Generate 10 hooks for a topic |
| POST | `/api/resize-post` | Make post shorter or longer |
| POST | `/api/generate-ideas` | Generate 18 post concept ideas |
| POST | `/api/parse-carousel` | Convert post text → structured carousel slide data |
| POST | `/api/remake-post` | Rewrite viral post using borrowed authority technique |

### Analytics & Viral
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/analytics/import` | Import performance data (top posts) for a session/platform |
| GET | `/api/analytics/:sessionId/:platform` | Get imported analytics |
| GET | `/api/viral-trends` | Fetch/trigger Apify scrape; returns personality-scored viral posts |

### Posts Library
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/posts` | List generated posts (filterable by sessionId, platform, status) |
| PATCH | `/api/posts/:id/status` | Update status (draft → approved → published) |
| PATCH | `/api/posts/:id/feedback` | Log engagement metrics → seeds brain_diary learning loop |
| DELETE | `/api/posts/:id` | Delete post |

### Knowledge Base
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/knowledge` | List user's knowledge docs |
| POST | `/api/knowledge` | Save a knowledge doc |
| DELETE | `/api/knowledge/:id` | Delete a knowledge doc |

### Agents (Autonomous)
Routes for concept, scoring, evolution, and metrics agents — see agent_runs table.

### Other
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check |

## AI calls (server.js)

The generate-post pipeline has 4 stages:
1. **`generatePost`** — first draft (detailed platform + tone + brand architecture prompts)
2. **`selfCritiquePost`** — audits against 6 rules (specificity, rhythm, banned words, non-resolution, etc.)
3. **`verifyAndFixFabrications`** — fact-checks claims against personality map; removes invented details
4. **`scoreBrandVoice`** — scores 1–10 against brand voice guidelines

Other AI calls:
- **`parsePersonalityMap`** — extracts structured JSON from personal brand PDF text
- **`parseBrandBrief`** — extracts structured JSON from business brand PDF text
- **`generateStrategy`** — builds full brand strategy (personal or business variant)
- **`extractBrandContext`** — extracts Brand DNA (missie, visie, kernwaarden, buyer persona, tone of voice) from website + map
- **`scorePostsVsPersonalityMap`** — scores viral posts 1–10 for brand fit

All AI calls use `gpt-4o-mini`. JSON-output calls use `response_format: { type: 'json_object' }` — no markdown stripping needed.

## Supported platforms & tones

**Platforms**: `linkedin`, `instagram`, `twitter`, `tiktok`, `email`

**Instagram formats**: `post` (carousel), `normal` (feed caption), `story`, `reel`

**Tones**: `authentic`, `educational`, `storytelling`, `motivational`, `casual`, `contrarian`

**Brand types**: `personal` (first person singular, personality map PDF) or `business` (first person plural we/our, brand brief PDF)

## Frontend design

- Dark luxury aesthetic: near-black backgrounds (`#0c0c0b`), gold accents (`#c9a96e`)
- Fonts: Cormorant Garamond (headings), Outfit (body), DM Mono (code/mono)
- No framework, no build step — pure vanilla JS with fetch calls to the API
- Auth state in `localStorage` (JWT token + email)
- All other state (session, personality map, strategy, brand context) in JS variables per session

## Key conventions

- Auth is required on all routes except `/api/auth/register`, `/api/auth/login`, `/api/health`
- `uploads/` is `os.tmpdir()` — files deleted immediately after PDF text extraction
- All AI JSON responses use `response_format: { type: 'json_object' }` — prompts say "Return ONLY valid JSON"
- `isSafeUrl()` guards all outbound `fetch()` calls to prevent SSRF (blocks localhost, private IPs)
- `serverErr()` hides error details in production (`NODE_ENV=production`)
- Do not add frameworks or build tooling unless explicitly requested
- Viral trends use a polling model: first call starts Apify run, subsequent calls check status
