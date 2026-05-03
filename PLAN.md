# Social Brand Studio — Product Plan

## Status key
- [ ] Planned
- [~] In progress
- [x] Done

---

## Phase 1 — Core (current)
- [x] PDF upload → personality map parsing
- [x] Brand strategy generation
- [x] LinkedIn / Instagram post generation (6 tones)
- [x] Dark luxury UI

---

## Phase 2 — Viral Intelligence (next)

### Weekly Viral Content Scraper (Apify) — Dream 100

**Goal:** Find viral posts from your Dream 100 that align with your personality map, so you can remake them in your own voice. Every Monday the system surfaces posts that went viral AND match your values, skills, and story — ready to be rewritten as your own content.

**Why Dream 100, not hashtags:** These are the exact people whose audience you want to reach. Their viral posts are proven concepts. Your job is to take the hook/angle/structure and rewrite it authentically through your own lens.

**The pipeline (3 stages):**
1. **Scrape** — Apify pulls recent posts from all 41 Dream 100 accounts on Instagram + LinkedIn
2. **Filter** — keep only posts above the viral threshold (≥10k likes on IG, ≥500 reactions on LinkedIn)
3. **Score** — GPT-4o-mini reads each viral post and scores it 1–10 on fit with your personality map (values: honesty, family, freedom; skills: AI automation, sales, intercultural communication; expertise: airline industry, stock trading, entrepreneurship). Only posts scoring ≥7 surface in the UI.

**Output:** "Remake this" cards — each shows the original viral post + a "Remake in my voice" button that pre-fills the post generator with the post's topic, hook structure, and angle, then generates a new version in your brand voice.

**Dream 100 accounts (from personality map):**
Dan Martell, Daniel Priestley, Alex Hormozi, Jordan Belfort, Jeremy Miner, Grant Cardone, Jack Roberts, Nik Setting, Nate Herk, Casey Neistat, Matthew McConaughey, Steven Bartlett, Andrew Huberman, Nicholas Crown, Chris Josephs, Brian Schardt, James Kardatzke, Luigi Lauro, Pirrone Massimo, Nick Saraev, Brian Tracy, Chris Williamson, Tony Robbins, Yes Theory, Andrej Karpathy, Dario Amodei, Russell Brunson, Gary Vaynerchuk, Scott Galloway, Andy Frisella, Lex Fridman, Jeff Cavaliere, Brett Bartholomew, Peter Zeihan, George Friedman, Ray Dalio, Dylan Lewis, Bill Ackman, Jay Baer, Chris Do, Ryan Serhant

**Approach:**
- Use **Apify** actors to scrape posts from these specific accounts weekly
  - Instagram: `apify/instagram-profile-scraper` — pass the 41 usernames, sort by likes/engagement, return top 5 posts per account
  - LinkedIn: `bebity/linkedin-profile-posts-scraper` — pass profile URLs for each person, return top 5 posts by reactions
- Each run: collect posts from the past 7 days, rank by engagement rate, surface top 20 across all accounts
- Schedule via **Apify's built-in scheduler** (weekly, every Monday 06:00 UTC)
- Results stored in **Apify Dataset** — fetched by the backend on demand via Apify REST API
- Backend exposes `GET /api/viral-trends?platform=instagram|linkedin` — returns top matched posts (author, caption snippet, likes/reactions, url, personality map fit score, why it matches)
- `POST /api/remake-post` — takes a viral post + personality map + strategy → returns a remade version in user's voice
- Frontend shows a "Remake This" panel — cards show original post, engagement, fit score, and one-click remake button

**Account mapping file** (`dream100.json` at project root):
```json
{
  "instagram": ["danthemartell", "danielpriestley", "alexhormozi", "grantcardone", ...],
  "linkedin": ["https://linkedin.com/in/danmartell", "https://linkedin.com/in/danielpriestley", ...]
}
```
_(Exact handles to be verified manually per platform — some may not be on both)_

**New env vars needed:**
```
APIFY_API_TOKEN=your_token_here
```

**New API routes:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/viral-trends?platform=instagram\|linkedin` | Fetch this week's top Dream 100 posts |

**Apify actors to configure:**
| Platform | Actor | Key inputs |
|----------|-------|------------|
| Instagram | `apify/instagram-profile-scraper` | usernames array from `dream100.json` |
| LinkedIn | `bebity/linkedin-profile-posts-scraper` | profile URLs array from `dream100.json` |

**Weekly schedule:** Every Monday 06:00 UTC via Apify Scheduler (no cron needed on our server)

**UI additions:**
- "Remake This" panel — shows after strategy is generated
- Platform toggle (Instagram / LinkedIn)
- Each card: author name, caption snippet, engagement count, fit score badge, "Remake in my voice" button
- Clicking "Remake in my voice" calls `/api/remake-post` and drops the result into the post editor

**Implementation tasks:**
- [ ] Set up Apify account + get API token
- [ ] Create `dream100.json` with verified Instagram handles + LinkedIn profile URLs for all 41 people
- [ ] Configure Instagram profile scraper actor in Apify + set weekly schedule
- [ ] Configure LinkedIn profile posts scraper actor in Apify + set weekly schedule
- [x] Add `APIFY_API_TOKEN` to `.env`
- [x] Create `dream100.json` with verified handles
- [x] Test Apify actors (Instagram ✓, LinkedIn actor in progress)
- [ ] Confirm correct Apify actor IDs for Instagram + LinkedIn
- [ ] Add `GET /api/viral-trends` route — scrapes → filters by engagement → GPT scores vs personality map → returns top matches
- [ ] Add `POST /api/remake-post` route — takes viral post + map + strategy → returns remade post in user's voice
- [ ] Add "Remake This" panel to `index.html`
- [ ] Wire up "Remake in my voice" button → calls remake route → loads result into post editor
- [ ] Update CLAUDE.md with new routes + env var

---

## Phase 3 — Future Ideas
- [ ] Save generated posts to history (localStorage or light backend)
- [ ] Export posts as formatted image (canvas/html-to-image)
- [ ] Multi-user sessions with saved brand profiles
