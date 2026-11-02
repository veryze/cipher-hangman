/**
 * Netlify Function: Generate a new Hangman phrase using Groq LLM
 * 
 * Deploy: Connect repo to Netlify, it auto-detects netlify/functions/
 * Set environment variable LLM_API_KEY in Netlify dashboard (Groq API key)
 * Model: qwen/qwen3-27b (fast, free tier)
 */

const SYSTEM_PROMPT = `Generate ONE short, recognizable English phrase for Hangman.
Requirements:
- 15-60 characters (including spaces)
- MUST be a well-known: movie quote, proverb, idiom, famous saying, song lyric, book title
- IDIOMS MUST be real, established English idioms (e.g., "BITE THE BULLET", "BREAK A LEG", "PIECE OF CAKE")
- NO invented phrases, NO obscure references
- ONLY uppercase letters A-Z and spaces (NO punctuation, numbers, special chars)
- Return ONLY the phrase, nothing else`;

const EXPLAIN_SYSTEM_PROMPT = `You are a friendly teacher explaining a finished round of a Hangman + cipher decoding game used to teach information theory.
You are given the English phrase, the cipher type used, whether the player won or lost, and the phrase's Shannon entropy and average surprisal in bits.
Write AT MOST 3 short sentences (max 60 words total):
1. Where the phrase comes from or what it means/when people say it (it is a known quote, proverb, idiom, song lyric, or book title).
2. One sentence connecting to information theory: interpret the entropy/surprisal values (low entropy or low surprisal means predictable letters like E, T, A dominate; high values mean an unusual letter mix or long phrase that was harder to decode).
Rules:
- PLAIN TEXT only: NO markdown, NO bullet points, NO quotation marks around the phrase, NO emojis
- Friendly, encouraging tone for NLP students
- Do NOT contradict the given outcome (never claim the player won if they lost)
- Return ONLY the explanation text, nothing else`;

function callGroq(apiKey, systemPrompt, userPrompt, options = {}) {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen/qwen3.8-27b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: options.max_tokens || 64,
      temperature: options.temperature !== undefined ? options.temperature : 0.9,
      top_p: options.top_p !== undefined ? options.top_p : 0.9,
      presence_penalty: options.presence_penalty !== undefined ? options.presence_penalty : 0.5,
      frequency_penalty: options.frequency_penalty !== undefined ? options.frequency_penalty : 0.5,
    }),
  })
  .then(async res => {
    const data = await res.json();
    if (!res.ok) {
      console.error("Groq API error:", res.status, data);
      throw new Error(`Groq ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
    }
    return data.choices?.[0]?.message?.content?.trim();
  });
}

function callGroqForPhrase(apiKey) {
  // Add random seed to prompt for variety
  const seed = Math.random().toString(36).substring(7);
  const userPrompt = `Give me one phrase (variation: ${seed}):`;

  return callGroq(apiKey, SYSTEM_PROMPT, userPrompt, {
    max_tokens: 64,
    temperature: 0.9,
    top_p: 0.9,
    presence_penalty: 0.5,
    frequency_penalty: 0.5,
  });
}

function callGroqForExplanation(apiKey, { phrase, cipher, outcome, entropy, surprisal }) {
  const userPrompt = [
    `Phrase: "${phrase}"`,
    `Cipher used: ${cipher}`,
    `Result: ${outcome}`,
    entropy !== undefined ? `Shannon entropy of the phrase's letter distribution: ${Number(entropy).toFixed(2)} bits` : null,
    surprisal !== undefined ? `Average surprisal per letter: ${Number(surprisal).toFixed(2)} bits` : null,
  ].filter(Boolean).join("\n");

  return callGroq(apiKey, EXPLAIN_SYSTEM_PROMPT, userPrompt, {
    max_tokens: 150,
    temperature: 0.6,
    top_p: 0.9,
    presence_penalty: 0.1,
    frequency_penalty: 0.1,
  });
}

function validatePhrase(phrase) {
  if (!phrase) return false;
  // Strip any non-A-Z/space chars instead of rejecting outright
  const cleaned = phrase.trim().toUpperCase().replace(/[^A-Z\s]/g, '');
  if (cleaned.length < 10 || cleaned.length > 70) return false;
  // Only A-Z and spaces
  if (!/^[A-Z\s]+$/.test(cleaned)) return false;
  // At least 2 words (more lenient)
  if (cleaned.split(" ").filter(w => w.length > 0).length < 2) return false;
  return cleaned;
}

export async function handler(event, context) {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  
  const apiKey = process.env.LLM_API_KEY;
  
  console.log('ENV CHECK:', { 
    hasKey: !!apiKey, 
    prefix: apiKey?.slice(0, 4),  // logs "gsk_" if Groq
    length: apiKey?.length,
    allEnvKeys: Object.keys(process.env).filter(k => k.includes('LLM') || k.includes('GROQ') || k.includes('API'))
  });
  
  if (!apiKey) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Server not configured" }) };
  }

  // Parse request body (optional; used to request explain mode)
  let body = {};
  try {
    if (event.body) body = JSON.parse(event.body);
  } catch (e) {
    // Malformed body falls back to default phrase mode
  }

  const CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  // ---- Explain mode: post-game explanation of phrase + entropy ----
  if (body.mode === "explain") {
    const { phrase, cipher, outcome, entropy, surprisal } = body;
    const cleanPhrase = typeof phrase === "string" ? phrase.trim().toUpperCase() : "";
    if (!cleanPhrase || !/^[A-Z\s]+$/.test(cleanPhrase)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing or invalid phrase" }) };
    }
    const safeOutcome = outcome === "win" ? "The player WON this round." : "The player lost this round.";

    try {
      const raw = await callGroqForExplanation(apiKey, {
        phrase: cleanPhrase,
        cipher: typeof cipher === "string" ? cipher.slice(0, 80) : "Unknown cipher",
        outcome: safeOutcome,
        entropy,
        surprisal,
      });
      const explanation = raw ? raw.replace(/^["'\s]+|["'\s]+$/g, '') : "";
      if (!explanation || explanation.length < 20 || explanation.length > 600) {
        return { statusCode: 502, body: JSON.stringify({ error: "Failed to generate valid explanation" }), headers: CORS_HEADERS };
      }
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, "Cache-Control": "no-cache, no-store, must-revalidate" },
        body: JSON.stringify({ explanation }),
      };
    } catch (e) {
      console.error("Explain attempt failed:", e);
      return { statusCode: 502, body: JSON.stringify({ error: "Failed to generate explanation" }), headers: CORS_HEADERS };
    }
  }

  // ---- Default: phrase mode (existing behaviour) ----
  let phrase = null;
  let attempts = 0;
  const maxAttempts = 3;

  while (!phrase && attempts < maxAttempts) {
    attempts++;
    try {
      const raw = await callGroqForPhrase(apiKey);
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
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
    body: JSON.stringify({ phrase }),
  };
}
