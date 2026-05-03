# Social Brand Studio — Claude Code Guide

## Project overview

AI-powered social media post generator. Users upload a Marketing Mindset personality map PDF → Claude parses it → generates a brand strategy → lets users generate platform-optimized posts (LinkedIn / Instagram) with 6 tone options.

## Stack

- **Backend**: Node.js + Express (`server.js`)
- **Frontend**: Single-file vanilla HTML/CSS/JS (`index.html`)
- **AI**: OpenAI SDK (`openai`) — model `gpt-4o-mini`
- **PDF parsing**: `pdf-parse`
- **File uploads**: `multer` (temp `uploads/` folder, auto-cleaned after parse)
- **Config**: `dotenv` — requires `OPENAI_API_KEY` in `.env`

## Project structure

```
Socials/
├── server.js       # Express server + all AI logic (3 Claude calls)
├── index.html      # Full frontend — single file, no build step
├── package.json
└── .env            # Not committed — needs ANTHROPIC_API_KEY
```

Note: README references a `src/` layout but the actual files are at root level.

## Development

```bash
npm run dev    # node --watch server.js — auto-restarts on changes
npm start      # production
```

Server runs at http://localhost:3000

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/upload` | Upload PDF → returns `{ personalityMap, strategy }` |
| POST | `/api/generate-post` | Generate a post given map + strategy + platform + pillar + tone |

## Claude calls (server.js)

1. **`parsePersonalityMap`** — extracts structured JSON from raw PDF text
2. **`generateStrategy`** — builds full brand strategy from personality map
3. **`generatePost`** — writes a platform + tone specific social post in first person

All three use `gpt-4o-mini`. JSON calls use `response_format: { type: 'json_object' }` for guaranteed valid JSON — no markdown stripping needed.

## Frontend design

- Dark luxury aesthetic: near-black backgrounds (`#0c0c0b`), gold accents (`#c9a96e`)
- Fonts: Cormorant Garamond (headings), Outfit (body), DM Mono (code/mono)
- No framework, no build step — pure vanilla JS with fetch calls to the API
- All UI state managed in JS variables; no persistence between page reloads

## Key conventions

- No database — strategy and personality map are held in-memory in the browser and POSTed back with each generate request
- `uploads/` is ephemeral: files are deleted immediately after PDF text extraction
- All AI responses must be valid JSON (prompts explicitly instruct "Return ONLY valid JSON")
- Do not add frameworks or build tooling unless explicitly requested
