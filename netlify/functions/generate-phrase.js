/**
 * Netlify Function: Generate a new Hangman phrase using Groq LLM
 * 
 * Deploy: Connect repo to Netlify, it auto-detects netlify/functions/
 * Set environment variable LLM_API_KEY in Netlify dashboard (Groq API key)
 * Model: llama-3.1-8b-instant (fast, free tier)
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
  if (!res.ok) {
    console.error("Groq API error:", res.status, data);
    throw new Error(`Groq ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  }
  return data.choices?.[0]?.message?.content?.trim();
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
      const raw = await callGroq(apiKey);
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