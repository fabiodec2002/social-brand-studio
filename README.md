# Social Brand Studio

An AI-powered social media strategy and post generator based on personality maps from the Marketing Mindset workshop.

## Features

- **PDF Upload** — Upload any Marketing Mindset personality map PDF
- **Auto-parsed** — Claude extracts all your values, achievements, qualities, expertise automatically
- **Full Strategy** — Get a custom brand statement, target audience, UVP, and brand voice
- **Content Pillars** — AI-generated pillars based on your unique background
- **Platform Guide** — Tailored instructions for LinkedIn vs Instagram
- **Post Generator** — Generate platform-optimized posts with 6 tone options
- **Multi-user** — Each upload gets its own fresh strategy, works for any user

## Setup

### 1. Install dependencies

```bash
cd social-brand-studio
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and add your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-ant-...
PORT=3000
```

Get your API key at: https://console.anthropic.com

### 3. Run the app

```bash
# Production
npm start

# Development (auto-restarts on changes)
npm run dev
```

Open http://localhost:3000

## How to use

1. Go to http://localhost:3000
2. Upload your Marketing Mindset personality map PDF
3. Wait ~15 seconds while Claude analyzes your map and builds your strategy
4. Explore your brand strategy, content pillars, and platform guide
5. Go to **Post Generator** to create posts:
   - Choose platform (LinkedIn / Instagram / Both)
   - Select a content pillar
   - Pick a tone
   - Hit **Generate post**
   - Copy and post!

## Tone options

| Tone | Best for |
|------|----------|
| Authentic | Personal stories, vulnerable moments |
| Educational | Tips, how-tos, expertise sharing |
| Storytelling | Specific experiences and journeys |
| Motivational | Lessons learned, achievements |
| Casual | Day-to-day, relatable content |
| Contrarian | Bold opinions, challenging norms |

## Project structure

```
social-brand-studio/
├── src/
│   └── server.js        # Express backend + AI logic
├── public/
│   └── index.html       # Full frontend (single file)
├── uploads/             # Temp folder (auto-cleared)
├── .env                 # Your API key (create from .env.example)
├── .env.example
└── package.json
```

## Deploying

To deploy for multiple users online, you can use:
- **Railway** — push to GitHub, connect repo, add ANTHROPIC_API_KEY env var
- **Render** — free tier available
- **Fly.io** — fast global deployment
- **VPS** — any Ubuntu server with Node.js

For production, consider adding:
- Rate limiting (express-rate-limit)
- File size validation
- User sessions if you want to save strategies
