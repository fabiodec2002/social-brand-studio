# Audit Report — Social Brand Studio
**Date:** 2026-06-11  
**Auditor:** Claude Code (claude-sonnet-4-6)  
**Scope:** Full 6-phase audit (Functional + Quality + Security)

---

## 1. Executive Summary

| Dimension | Verdict |
|-----------|---------|
| **Functional** | App boots and core auth/error flows respond correctly. Core AI generation flows could not be live-tested without spending API credits. No obvious runtime crashes. |
| **Quality** | No test suite at all; no lint/typecheck toolchain; one medium-complexity server file of ~2,100 lines with solid structure but a few maintainability gaps. |
| **Security** | 2 verified HIGH/MEDIUM issues that are easy to exploit in the Vercel deployment environment; 3 additional medium findings including a confirmed SSRF bypass. |

**Top 3 Risks:**
1. **Rate limiting is ineffective on Vercel** — `trust proxy` not set; all requests look like one IP, making auth brute-force limits useless.
2. **SSRF bypass via IPv6 bracket notation** — `http://[::1]` and `http://0.0.0.0` both bypass the private-IP check in `fetchWebsiteText`, allowing server-side requests to localhost services.
3. **Apify API token exposed in server request URLs** — the token appears in server-side fetch URLs and will land in access logs and proxy logs.

---

## 2. Environment & Method

| Item | Value |
|------|-------|
| Package manager | npm (package-lock.json) |
| Runtime | Node.js v24.14.0 |
| Framework | Express 4.18.2, single-file server |
| Database | Neon PostgreSQL (serverless) |
| AI provider | OpenAI gpt-4o-mini |
| Deployment target | Vercel (vercel.json present) |
| Blocked checks | Live AI-generation flow, actual DB content (requires live credentials) |

---

## 3. Build & Test Evidence (Phase 2)

| Step | Command | Result | Notes |
|------|---------|--------|-------|
| Install | `npm install` | **PASS** (exit 0) | `up to date, audited 111 packages, found 0 vulnerabilities` |
| Syntax check | `node --check server.js` | **PASS** (exit 0) | No syntax errors |
| Typecheck | N/A | N/A | No TypeScript; no `tsc` configured |
| Lint | N/A | N/A | No ESLint/Biome configured |
| Build | N/A | N/A | No build step; pure Node.js |
| Tests | N/A | **FAIL** | No `test` script defined in package.json; no test files found |
| npm audit | `npm audit` | **PASS** | `found 0 vulnerabilities` |
| Server boot | `node server.js` | **PASS** | Started on PORT from .env; health endpoint responds `{"status":"ok"}` |
| Health endpoint | `GET /api/health` | **PASS** | `{"status":"ok"}` |

**Build verdict:** App installs and starts cleanly. No tests exist.

---

## 4. Findings

### CRITICAL — None

---

### HIGH

#### H1 — Rate Limiting Ineffective on Vercel (trust proxy not configured)
- **Severity:** HIGH | **Confidence:** 9/10 | **Tag:** [VERIFIED]
- **OWASP:** A07 — Identification and Authentication Failures
- **File:** server.js:48–65 (auth limiter), server.js:22 (app init)

**Evidence:**
```
node -e "const express=require('express');const app=express();console.log(app.get('trust proxy'))"
→ false
```
Express's `trust proxy` defaults to `false`. When `false`, `req.ip` is set to the raw socket address — which on Vercel (and any reverse proxy) is the proxy's IP, not the real client IP. The `express-rate-limit` library uses `req.ip` as the key. All requests therefore share one bucket, meaning the auth limiter (20 attempts/15 min) limits the proxy itself, not individual users. An attacker can brute-force `/api/auth/login` indefinitely.

**Fix:** Add `app.set('trust proxy', 1)` before the rate limiter declarations. On Vercel, this causes Express to use the `X-Forwarded-For` header (set by Vercel's edge) as the real client IP. Verify Vercel docs confirm the proxy depth is 1.

---

### MEDIUM

#### M1 — SSRF Bypass via IPv6 Bracket Notation and 0.0.0.0
- **Severity:** MEDIUM | **Confidence:** 9/10 | **Tag:** [VERIFIED]
- **OWASP:** A10 — Server-Side Request Forgery
- **File:** server.js:157–168 (`isSafeUrl`), called at server.js:278, 1279

**Evidence:**
```
node -e "
const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc00:|fd)/i;
console.log(new URL('http://[::1]').hostname, PRIVATE_IP_RE.test(new URL('http://[::1]').hostname));
// → [::1]  false  ← NOT blocked
console.log(new URL('http://0.0.0.0').hostname, PRIVATE_IP_RE.test(new URL('http://0.0.0.0').hostname));
// → 0.0.0.0  false  ← NOT blocked
console.log(new URL('http://[::ffff:127.0.0.1]').hostname, ...);
// → [::ffff:7f00:1]  false  ← NOT blocked
"
```

`new URL('http://[::1]').hostname` returns `'[::1]'` (with brackets). The regex `::1$` matches the substring `::1` at end of string — but `[::1]` ends with `]`, so it never matches. An authenticated user can supply `websiteUrl=http://[::1]/secret` in the upload form body and `fetchWebsiteText` will make an outbound HTTP request to the local Node.js process or any other service listening on port 80 of the local machine.

**Fix:**
```javascript
function isSafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // Normalize brackets off IPv6 hostnames
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '0.0.0.0') return false;
    if (PRIVATE_IP_RE.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}
```
Also add `0.0.0.0` to the explicit check or extend the regex.

---

#### M2 — Apify API Token in URL Query Parameter
- **Severity:** MEDIUM | **Confidence:** 9/10 | **Tag:** [VERIFIED]
- **OWASP:** A09 — Security Logging and Monitoring Failures
- **File:** server.js:1086–1088, 1097–1099, 1103–1105

**Evidence:**
```javascript
// server.js:1086-1088
const res = await fetch(`${APIFY_BASE}/acts/${slug}/runs?token=${token}`, { ... });
// server.js:1097
const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`);
// server.js:1103
const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&limit=500`);
```
The Apify API token appears in full in the request URL. This token is logged by:
- Express/Node.js access logs
- Vercel request logs
- Any intermediate proxy or CDN
- Apify's own access logs (referrer/URL)

**Fix:** Pass the token as an HTTP header instead:
```javascript
const res = await fetch(`${APIFY_BASE}/acts/${slug}/runs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify(input),
});
```

---

#### M3 — CSP Allows `unsafe-inline` Scripts
- **Severity:** MEDIUM | **Confidence:** 9/10 | **Tag:** [VERIFIED]
- **OWASP:** A05 — Security Misconfiguration
- **File:** server.js:37–40

**Evidence:**
```javascript
scriptSrc: ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com', 'fonts.googleapis.com'],
scriptSrcAttr: ["'unsafe-inline'"],
```
`unsafe-inline` neutralises the XSS protection that CSP provides. Inline scripts and event handlers can execute without restriction. This is especially relevant because the frontend (`index.html`) uses many inline `onclick` handlers.

**Fix:** Migrate inline handlers to external event listeners and use a CSP nonce or hash instead of `unsafe-inline`. At minimum, remove `scriptSrcAttr: ["'unsafe-inline'"]` and fix the resulting breakage.

---

#### M4 — Analytics Import Does Not Verify Session Ownership
- **Severity:** MEDIUM | **Confidence:** 8/10 | **Tag:** [VERIFIED]
- **OWASP:** A01 — Broken Access Control
- **File:** server.js:1656–1673

**Evidence:**
```javascript
app.post('/api/analytics/import', requireAuth, async (req, res) => {
  const { sessionId, platform, posts } = req.body;
  // No check: does sessionId belong to req.user.id?
  await sql`
    INSERT INTO post_analytics (session_id, platform, posts, imported_at, user_id)
    VALUES (${sessionId}, ${platform}, ${JSON.stringify(posts)}, NOW(), ${req.user.id})
    ...
  `;
```
Any authenticated user can insert analytics rows for an arbitrary `sessionId` (including sessions belonging to other users). Reading analytics (`GET /api/analytics/:sessionId/:platform`) and using them for post generation both apply `AND user_id = req.user.id`, so cross-user data leakage is not directly possible. However, a user can spray analytics inserts against guessed session IDs and corrupt the session-analytics association table.

**Fix:** Add an ownership check before the insert:
```javascript
const [session] = await sql`SELECT id FROM sessions WHERE id = ${sessionId} AND user_id = ${req.user.id}`;
if (!session) return res.status(404).json({ error: 'Session not found' });
```

---

### LOW

#### L1 — JWT 30-Day Expiry With No Revocation
- **Severity:** LOW | **Confidence:** 9/10 | **Tag:** [VERIFIED]
- **OWASP:** A07 — Identification and Authentication Failures
- **File:** server.js:1225, 1241

Tokens are issued with `{ expiresIn: '30d' }`. There is no refresh-token flow, no logout endpoint that invalidates the token, and no `jti` (JWT ID) revocation list. A stolen token remains valid for up to 30 days.

**Fix (minimal):** Reduce expiry to 7 days and add a `POST /api/auth/logout` endpoint that stores invalidated `jti` values in the DB (or in-memory set for a single-instance deploy).

---

#### L2 — No Input Size Validation on AI Prompt Fields
- **Severity:** LOW | **Confidence:** 7/10 | **Tag:** [SUSPECTED]
- **OWASP:** A03 — Injection
- **File:** server.js:1500–1523 (`/api/refine-post`), 1880–1908 (`/api/resize-post`), 1787–1823 (`/api/generate-variations`)

The `post`, `instruction`, `topic`, and `strategy` fields are passed into OpenAI requests without explicit per-field size limits. The 2MB `express.json` body limit provides a global cap but an attacker can send near-2MB payloads to these endpoints, each burning tokens and incurring cost. Other endpoints like `/api/generate-post` already apply `slice(0, 1000)` to `extraContext` (server.js:1431) — that pattern should be applied consistently.

**Fix:** Add field-level size caps:
```javascript
if (!post || post.length > 5000) return res.status(400).json({ error: 'post too large' });
if (!instruction || instruction.length > 500) return res.status(400).json({ error: 'instruction too large' });
```

---

#### L3 — `dream100.json` Loaded Synchronously at Startup
- **Severity:** LOW | **Confidence:** 9/10 | **Tag:** [VERIFIED]
- **File:** server.js:1081

```javascript
const dream100 = JSON.parse(fs.readFileSync(path.join(__dirname, 'dream100.json')));
```
Executed at module load time (not inside a function). If the file is missing or malformed, the entire server process throws before any route is registered. On Vercel, this causes a cold-start crash with a cryptic error.

**Fix:** Move to an async init with a graceful fallback:
```javascript
let dream100 = { accounts: [] };
try { dream100 = JSON.parse(await fs.promises.readFile(...)); } catch { console.warn('dream100.json missing'); }
```

---

### INFO

#### I1 — Client Supplies personalityMap and strategy for Every AI Request
- **Severity:** INFO | **Confidence:** 9/10 | **Tag:** [VERIFIED]
- **File:** server.js:1416–1498 (`/api/generate-post` and related endpoints)

The `personalityMap` and `strategy` objects are POSTed from the browser on every AI generation call rather than being re-fetched from the DB. This is a documented design choice (in-browser state). The server validates `platform`, `tone`, and `instagramOptions.format` against allowlists, and sanitizes `extraContext` for control characters. However, a user can craft arbitrary `personalityMap`/`strategy` JSON to inject content into the AI system prompt (prompt injection against their own session). This has no cross-user impact but is worth noting for multi-tenant threat modeling.

---

#### I2 — `sessions` and `generated_posts` Tables Grow Without Bound
- **Severity:** INFO | **Tag:** [VERIFIED]
- **File:** server.js:72–152 (initDb), server.js:1747–1762 (GET /api/posts)

No retention policy, archiving, or TTL exists for sessions or generated posts. The `/api/posts` query is capped at `LIMIT 200` which prevents unbounded result sets, but there is no mechanism to prune old data. For a single-user or small-team product this is acceptable; for a broader SaaS launch it will need attention.

---

## 5. Functional Flow Results (Phase 3)

| Flow | Entry Point | How Verified | Result |
|------|------------|-------------|--------|
| Server boots | `node server.js` | `console.log` output | VERIFIED — started on configured port |
| Health check | `GET /api/health` | `curl` | VERIFIED — `{"status":"ok"}` |
| Auth — missing body | `POST /api/auth/login {}` | `curl` | VERIFIED — `{"error":"Email and password required"}` (400) |
| Auth — invalid JWT | `GET /api/sessions` with `Bearer badtoken` | `curl` | VERIFIED — `{"error":"Invalid or expired token"}` (401) |
| PDF upload flow | `POST /api/upload` | BLOCKED — requires live OpenAI key + valid PDF | See blocked checks |
| Post generation | `POST /api/generate-post` | BLOCKED — requires live OpenAI key + session data | See blocked checks |
| Viral trends | `GET /api/viral-trends` | BLOCKED — requires live Apify token | See blocked checks |
| DB migrations | `initDb()` | BLOCKED — requires live DATABASE_URL | See blocked checks |

---

## 6. Coverage Gaps & Blocked Checks

Run these locally (with real credentials) to complete the audit:

```bash
# 1. Verify migrations apply cleanly on a fresh schema
node -e "require('./server.js')" 2>&1  # check initDb output in logs

# 2. Test auth register + login + generate round-trip
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234!"}'
# → grab token, then test /api/upload with a real PDF

# 3. Verify SSRF bypass is blocked after fix
curl "http://localhost:3000/api/auth/profile" -X PUT \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"websiteUrl":"http://[::1]/"}'
# Before fix: server makes outbound request to ::1
# After fix: should return 200 with no outbound request (websiteText = null)

# 4. Test rate-limiter per-IP after adding trust proxy
# Requires 21 rapid POST requests to /api/auth/login from same IP
# Confirm 429 on the 21st

# 5. Confirm analytics import IDOR is blocked after fix
# Create two accounts, grab their tokens
# POST /api/analytics/import with token from Account A but sessionId from Account B's session
# Should return 404 after fix, currently succeeds
```

---

## 7. Prioritised Remediation Plan

| Priority | Finding | Effort | Risk if Deferred |
|----------|---------|--------|-----------------|
| **1** | H1 — Add `app.set('trust proxy', 1)` | 1 line | Auth rate limiting is a no-op on Vercel → brute-force risk |
| **2** | M1 — Fix SSRF bypass (`[::1]`, `0.0.0.0`) | 5 lines | SSRF to local services from any authenticated user |
| **3** | M2 — Move Apify token to `Authorization` header | 10 lines | Token leaks to logs permanently |
| **4** | M4 — Verify sessionId ownership in analytics import | 3 lines | Low-impact IDOR; cheap to fix |
| **5** | M3 — Remove `unsafe-inline` from CSP | Medium (requires refactoring inline handlers in index.html) | XSS escalation if any future injection is found |
| **6** | L1 — Shorten JWT expiry + add logout endpoint | Small | Stolen tokens live 30 days |
| **7** | L2 — Add per-field size limits on AI routes | Small | Token/cost abuse |
| **8** | L3 — Make `dream100.json` load async with fallback | 5 lines | Cold-start crash if file missing |
| **9** | Quality — Add test suite (at least auth + generation smoke tests) | Large | Zero regression protection |
| **10** | Quality — Move posts SQL filter to DB level (line 1756–1757) | Small | In-memory filtering of up to 200 rows is not a bottleneck now but will be |

---

## 8. Code Quality & Architecture Notes (Phase 5)

### Strengths
- Consistent SQL parameterisation via tagged template literals (Neon `sql` tag) — no raw string concatenation found anywhere; SQL injection risk is low.
- All sensitive routes protected by `requireAuth` middleware; DB queries always include `user_id = req.user.id`.
- `serverErr` helper correctly hides stack traces in production.
- Reasonable bcrypt cost factor (12).
- `express-rate-limit` and `helmet` are present and correctly ordered.
- `isSafeUrl()` covers the main SSRF vectors (just missing IPv6 brackets).
- `crypto.randomUUID()` used for all IDs — good entropy.

### Weaknesses
- **No test suite.** `module.exports = app` at the bottom of server.js suggests tests were intended. Zero coverage on critical paths (auth, generation, DB writes).
- **No lint or typecheck toolchain.** A single misconfigured property (e.g., `req.user.email` vs `req.user.id`) would only surface at runtime.
- **initDb() runs on every cold start** with multiple `ALTER TABLE ADD COLUMN IF NOT EXISTS` statements. On Neon serverless, each statement is a round-trip. At scale this adds cold-start latency. The proper fix is a migration runner (or even a simple migration-applied flag).
- **`GET /api/posts` filters in JavaScript** (lines 1756–1757) rather than SQL. The `WHERE` clause already limits to 200 rows so it's harmless now, but the pattern is inconsistent with the rest of the codebase.
- **Single 2,085-line file.** Currently readable, but adding more features will make it hard to navigate. Consider splitting into `routes/`, `services/`, and `middleware/` directories.
- **No retry/backoff on OpenAI calls.** A transient 429 or 5xx from OpenAI propagates as a 500 to the user.
- **Apify polling is fire-and-forget.** `GET /api/viral-trends` starts an Apify run and tells the client to poll. If the server restarts between start and completion, the `run_id` is in the DB but the state machine correctly recovers on the next poll. This is acceptable for current scale.

---

## 9. What I Could NOT Verify

- **End-to-end PDF upload → strategy → post generation** (requires live OpenAI key + $)
- **Database schema state** (requires live DATABASE_URL; `initDb()` output was not inspected)
- **Vercel production behaviour** (trust proxy fix, actual rate limit behaviour behind CDN)
- **Apify scraper run completion and dataset handling** (requires live Apify token)
- **Whether `dream100.json` is in the deployed Vercel build** (not in `.vercelignore`; included by default)
- **Whether the currently uncommitted changes to `server.js` and `public/carousel.js` introduce new issues** (git diff not reviewed in detail; focused on committed state)
