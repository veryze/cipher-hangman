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

function callGroq(apiKey) {
  // Add random seed to prompt for variety
  const seed = Math.random().toString(36).substring(7);
  const userPrompt = `Give me one phrase (variation: ${seed}):`;
  
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen/qwen3.8-27b",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 64,
      temperature: 0.9,
      top_p: 0.9,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
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
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
    body: JSON.stringify({ phrase }),
  };
}
