/**
 * Netlify Function: Generate a new Hangman phrase using an LLM
 * 
 * Deploy: Connect repo to Netlify, it auto-detects netlify/functions/
 * Set environment variable LLM_API_KEY in Netlify dashboard
 * Set LLM_PROVIDER: "groq" | "openai" | "anthropic" | "gemini"
 */

const SYSTEM_PROMPT = `Generate ONE short, recognizable English phrase for a Hangman game.
Requirements:
- 15-60 characters (including spaces)
- Well-known: movie quote, proverb, idiom, famous saying, song lyric, book title
- ONLY uppercase letters A-Z and spaces (NO punctuation, numbers, special chars)
- Return ONLY the phrase, nothing else`;

const USER_PROMPT = "Give me one phrase:";

async function callGroq(apiKey) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_PROMPT },
      ],
      max_tokens: 64,
      temperature: 0.8,
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim();
}

async function callOpenAI(apiKey) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_PROMPT },
      ],
      max_tokens: 64,
      temperature: 0.8,
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim();
}

async function callAnthropic(apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 64,
      temperature: 0.8,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: USER_PROMPT }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text?.trim();
}

async function callGemini(apiKey) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${USER_PROMPT}` }] }],
      generationConfig: { maxOutputTokens: 64, temperature: 0.8 },
    }),
  });
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
}

function validatePhrase(phrase) {
  if (!phrase) return false;
  const cleaned = phrase.trim().toUpperCase();
  if (cleaned.length < 15 || cleaned.length > 60) return false;
  // Only A-Z and spaces
  if (!/^[A-Z\s]+$/.test(cleaned)) return false;
  // At least 3 words
  if (cleaned.split(" ").filter(w => w.length > 0).length < 3) return false;
  return cleaned;
}

export async function handler(event, context) {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const provider = process.env.LLM_PROVIDER || "groq";
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    console.error("LLM_API_KEY not set");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server not configured" }),
    };
  }

  let phrase = null;
  let attempts = 0;
  const maxAttempts = 3;

  while (!phrase && attempts < maxAttempts) {
    attempts++;
    try {
      let raw;
      switch (provider) {
        case "groq": raw = await callGroq(apiKey); break;
        case "openai": raw = await callOpenAI(apiKey); break;
        case "anthropic": raw = await callAnthropic(apiKey); break;
        case "gemini": raw = await callGemini(apiKey); break;
        default: throw new Error(`Unknown provider: ${provider}`);
      }
      phrase = validatePhrase(raw);
      if (!phrase) console.log(`Attempt ${attempts}: Invalid phrase:`, raw);
    } catch (e) {
      console.error(`Attempt ${attempts} failed:`, e);
    }
  }

  if (!phrase) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Failed to generate valid phrase" }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({ phrase }),
  };
}