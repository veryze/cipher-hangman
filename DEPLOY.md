# Deployment Guide: Cipher Hangman with AI Phrases

## Quick Start (Netlify - Recommended)

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Add AI phrase generation"
   git push origin main
   ```

2. **Connect to Netlify**
   - Go to [netlify.com](https://netlify.com) → "Add new site" → "Import from Git"
   - Select your GitHub repo
   - Build settings auto-detected from `netlify.toml`:
     - Publish directory: `.` (root)
     - Functions directory: `netlify/functions`
   - Click "Deploy site"

3. **Add API Key in Netlify Dashboard**
   - Site settings → Environment variables → Add variable
   - `LLM_API_KEY` = your API key (see providers below)
   - `LLM_PROVIDER` = `groq` (recommended, free tier) or `openai` / `anthropic` / `gemini`
   - Redeploy (triggers automatically on env var change)

4. **Test**
   - Visit your `*.netlify.app` URL
   - Open Settings → Enable "Use AI Phrases"
   - Click "NEW GAME" → should show "GENERATING..." then load a fresh AI phrase

---

## LLM Providers (Free Tiers)

| Provider | Model | Free Tier | Get API Key |
|----------|-------|-----------|-------------|
| **Groq** | Llama 3.1 8B | 14,400 req/day | [console.groq.com](https://console.groq.com/keys) |
| **OpenAI** | GPT-4o-mini | $5 credit | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Anthropic** | Claude 3 Haiku | $5 credit | [console.anthropic.com](https://console.anthropic.com/) |
| **Google** | Gemini 1.5 Flash | 1,500 req/day | [aistudio.google.com](https://aistudio.google.com/apikey) |

**Groq recommended** — fastest, generous free tier, OpenAI-compatible API.

---

## Alternative: GitHub Pages + Separate Functions

If you want to stay on GitHub Pages, deploy the function separately:

### Option A: Netlify Functions Only
- Deploy just the `netlify/functions` folder to Netlify as a "Functions only" site
- Update `fetch()` URL in `cipher-hangman.html` to `https://your-functions-site.netlify.app/.netlify/functions/generate-phrase`

### Option B: Vercel
```bash
npm i -g vercel
cd netlify/functions
vercel deploy
```
- Set env vars in Vercel dashboard
- Update fetch URL in HTML

### Option C: Cloudflare Workers
- Create a Worker at `workers.cloudflare.com`
- Paste `generate-phrase.js` content (adapt for Workers runtime)
- Add env vars in Worker settings
- Update fetch URL

---

## Local Development

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Run locally (serves site + functions)
netlify dev
# Opens http://localhost:8888

# Set local env vars in .env file (gitignored)
echo "LLM_API_KEY=your_key" > .env
echo "LLM_PROVIDER=groq" >> .env
netlify dev
```

---

## How It Works

1. User clicks "NEW GAME"
2. If "Use AI Phrases" enabled in Settings:
   - Frontend calls `POST /.netlify/functions/generate-phrase`
   - Netlify Function calls LLM API with your key (hidden server-side)
   - LLM returns a validated phrase (15-60 chars, A-Z + spaces only)
   - Game starts with that phrase
3. If API fails or setting disabled → falls back to local `PHRASES` array

---

## Customization

**Change prompt/style:** Edit `SYSTEM_PROMPT` in `netlify/functions/generate-phrase.js`

**Adjust validation:** Modify `validatePhrase()` function

**Add more providers:** Add new `callXxx()` functions and extend the switch statement

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Server not configured" | Set `LLM_API_KEY` in Netlify env vars |
| CORS error | Netlify handles CORS via `netlify.toml` headers |
| "Failed to generate valid phrase" | Check function logs in Netlify dashboard; LLM may need prompt tuning |
| Works locally but not deployed | Ensure env vars set in Netlify dashboard (not just local `.env`) |
| Phrases too long/short | Adjust `validatePhrase()` length bounds |