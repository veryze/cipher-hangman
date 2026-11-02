/**
 * Netlify Function: Hangman LLM endpoint — themed phrase generation and
 * post-game explanations using Groq
 *
 * Modes (via 'mode' field in the POST body, default 'phrase'):
 * - phrase: generate a Hangman phrase following the theme/difficulty picked
 *   in the menu (index.html): theme any|movie|idiom|song|book,
 *   difficulty easy|normal|hard.
 *   Sources, depending on theme:
 *   - song: fetched as real lyric lines from the free lyrics.ovh site
 *     (falls back to the LLM if the site is unavailable)
 *   - idiom: 50% drawn from a canonical idiom bank (the LLM often mangles
 *     classic idioms), otherwise the LLM
 *   - movie/book/any: the LLM, with theme overrides; book output containing
 *     a BY-author attribution is rejected and retried
 *   A phrase too short/long for the chosen difficulty is rejected and retried.
 * - explain: post-game explanation of the phrase's origin + entropy values
 *   (needs phrase, cipher, outcome, entropy, surprisal).
 *
 * Set environment variable LLM_API_KEY in Netlify dashboard (Groq API key)
 * Model: qwen/qwen3.8-27b (fast, free tier)
 */

const SYSTEM_PROMPT = `Generate ONE short, recognizable English phrase for Hangman.
Requirements:
- Uppercase letters A-Z and spaces ONLY (NO punctuation, numbers, special chars)
- Identify the SOURCE, not a description of it: output the phrase itself, never the person/title/artist that said it
- ONLY well-known, familiar sources: famous movie quotes, established idioms, famous song lyrics, famous book titles
- NO invented phrases, NO obscure references
- Return ONLY the phrase, nothing else`;

// Optional constraints appended to the system prompt
const THEME_RULES = {
  any: "",
  movie: `THEME OVERRIDE: output ONLY the well-known MOVIE QUOTE itself - a line as it is said in the film.
NEVER include the film title, the character who says it, or the word BY.
Format examples: MAY THE FORCE BE WITH YOU / ILL BE BACK / YOU CANNOT HANDLE THE TRUTH / SHOW ME THE MONEY`,
  idiom: `THEME OVERRIDE: output ONLY one real, established English IDIOM, exactly as people say it.
NEVER explain it, never add words that are not part of the idiom.
These are all idioms and formatted correctly: A STITCH IN TIME SAVES NINE / ONCE IN A BLUE MOON / THE LAST STRAW / ON THIN ICE / BETTER LATE THAN NEVER`,
  song: `THEME OVERRIDE: output ONE actual well-known SONG LYRIC line, exactly as sung in the song.
NEVER include the artist name, the song title, the word BY, or parentheses. Lyrics only, NEVER a description of the song.
Format examples: LET IT BE / HERE COMES THE SUN / IM WALKING ON SUNSHINE / WE WILL ROCK YOU / IM STILL STANDING`,
  book: `THEME OVERRIDE: output ONLY the exact title of a well-known published BOOK.
Add NOTHING: no author name, no BY + name, no series numbering (BOOK ONE), no subtitle that is not part of the title, and NEVER a saying or quote instead of a title.
Format examples: TO KILL A MOCKINGBIRD / PRIDE AND PREJUDICE / THE CATCHER IN THE RYE / JANE EYRE`,
};

const DIFFICULTY_RULES = {
  normal: "DIFFICULTY NORMAL: prefer 15-60 characters total.",
  easy: `DIFFICULTY EASY: the phrase must be AT MOST 40 characters total (aim for 15-30); pick a very common, instantly recognizable phrase whose words repeat common letters (E, T, A, O) often. If your phrase is longer than 40 characters, it will be rejected.`,
  hard: `DIFFICULTY HARD: the phrase must be AT LEAST 25 characters total (aim for 30-60). Pick a longer, rarer phrase with an unusual letter distribution - rare letters like J, K, Q, X, Z are welcome, and avoid phrases where the same common letter repeats many times. If your phrase is shorter than 25 characters, it will be rejected.`,
};

function buildPhraseSystemPrompt(theme, difficulty) {
  const extras = [THEME_RULES[theme] || "", DIFFICULTY_RULES[difficulty] || ""].filter(Boolean);
  if (!extras.length) return SYSTEM_PROMPT;
  return SYSTEM_PROMPT + "\n" + extras.join("\n");
}

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

// Canonical classics the LLM often mangles; used directly so they actually appear
const CANONICAL_IDIOMS = [
  "A STITCH IN TIME SAVES NINE",
  "ONCE IN A BLUE MOON",
  "A BLESSING IN DISGUISE",
  "BARKING UP THE WRONG TREE",
  "THE CALM BEFORE THE STORM",
  "EVERY CLOUD HAS A SILVER LINING",
  "THE LAST STRAW",
  "ON THIN ICE",
  "BETTER LATE THAN NEVER",
  "IGNORANCE IS BLISS",
  "SPLITTING HAIRS",
  "BURNING THE MIDNIGHT OIL",
];

// Well-known songs for lyrics fetching (free key-less endpoint)
const SONG_LIST = [
  { artist: "The Beatles", title: "Let It Be" },
  { artist: "The Beatles", title: "Hey Jude" },
  { artist: "The Beatles", title: "With a Little Help from My Friends" },
  { artist: "Queen", title: "Bohemian Rhapsody" },
  { artist: "Queen", title: "We Are the Champions" },
  { artist: "Queen", title: "Another One Bites the Dust" },
  { artist: "Eagles", title: "Hotel California" },
  { artist: "Simon And Garfunkel", title: "Bridge Over Troubled Water" },
  { artist: "The Rolling Stones", title: "Paint It Black" },
  { artist: "Elton John", title: "Rocket Man" },
  { artist: "Elton John", title: "Your Song" },
  { artist: "John Lennon", title: "Imagine" },
  { artist: "Andrea Bocelli And Sarah Brightman", title: "Time to Say Goodbye" },
  { artist: "Lynyrd Skynyrd", title: "Free Bird" },
  { artist: "R.E.M.", title: "Losing My Religion" },
  { artist: "Eric Clapton", title: "Wonderful Tonight" },
  { artist: "Bob Dylan", title: "Blowin in the Wind" },
  { artist: "Aerosmith", title: "Dream On" },
  { artist: "Journey", title: "Dont Stop Believin" },
  { artist: "Bon Jovi", title: "Livin on a Prayer" },
  { artist: "Nirvana", title: "Smells Like Teen Spirit" },
  { artist: "Fleetwood Mac", title: "Landslide" },
  { artist: "Elvis Presley", title: "Cant Help Falling in Love" },
  { artist: "Whitney Houston", title: "Greatest Love of All" },
];

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

function callGroqForPhrase(apiKey, theme, difficulty) {
  // Add random seed to prompt for variety
  const seed = Math.random().toString(36).substring(7);
  const themeLabel = theme === "any" ? "any-theme" : theme;
  const userPrompt = `Give me one ${themeLabel} phrase, difficulty: ${difficulty} (variation: ${seed}):`;

  return callGroq(apiKey, buildPhraseSystemPrompt(theme, difficulty), userPrompt, {
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

function validatePhrase(phrase, minLen = 10, maxLen = 70) {
  if (!phrase) return false;
  // Strip any non-A-Z/space chars instead of rejecting outright
  const cleaned = phrase.trim().toUpperCase().replace(/[^A-Z\s]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length < minLen || cleaned.length > maxLen) return false;
  // Only A-Z and spaces
  if (!/^[A-Z\s]+$/.test(cleaned)) return false;
  // At least 2 words (more lenient)
  if (cleaned.split(" ").filter(w => w.length > 0).length < 2) return false;
  return cleaned;
}

// --- Song lyrics: fetch REAL lines from a lyrics site (no key needed) ---
const LYRICS_API = "https://api.lyrics.ovh/v1/";

function cleanLyricLine(line, minLen, maxLen) {
  const cleaned = (line || "").trim().toUpperCase().replace(/[^A-Z\s]/g, '').replace(/\s+/g, ' ').trim();
  return validatePhrase(cleaned, minLen, maxLen);
}

async function fetchLyricPhrase(minLen, maxLen) {
  for (let t = 0; t < 2; t++) {
    const song = SONG_LIST[Math.floor(Math.random() * SONG_LIST.length)];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${LYRICS_API}${encodeURIComponent(song.artist)}/${encodeURIComponent(song.title)}`, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) {
        console.error(`Lyrics API ${res.status} for ${song.artist} - ${song.title}`);
        continue;
      }
      const data = await res.json();
      const lines = [...new Set((data.lyrics || "").split(/\r?\n/).map(l => cleanLyricLine(l, minLen, maxLen)).filter(Boolean))];
      if (lines.length) {
        return lines[Math.floor(Math.random() * lines.length)];
      }
    } catch (e) {
      console.error(`Lyrics fetch failed for ${song.artist}:`, e);
    }
  }
  return null;
}

export async function handler(event, context) {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server not configured" }),
    };
  }

  // Parse request body (optional)
  let body = {};
  try {
    if (event.body) body = JSON.parse(event.body);
  } catch (e) {
    // Malformed body falls back to defaults
  }

  // Ignore unrecognized values (same fallbacks as the frontend)
  const theme = THEME_RULES[body.theme] !== undefined ? body.theme : "any";
  const difficulty = DIFFICULTY_RULES[body.difficulty] !== undefined ? body.difficulty : "normal";

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

  // ---- Default: phrase mode ----
  // Difficulty length guards: reject normal-difficulty phrases passing as hard (and vice versa)
  const minLen = difficulty === "hard" ? 25 : 10;
  const maxLen = difficulty === "easy" ? 40 : 70;

  let phrase = null;
  let source = "llm";

  // Idioms: guarantee canonical classics half of the time
  if (theme === "idiom" && Math.random() < 0.5) {
    const pick = CANONICAL_IDIOMS[Math.floor(Math.random() * CANONICAL_IDIOMS.length)];
    phrase = validatePhrase(pick, minLen, maxLen);
    if (phrase) source = "idiom-bank";
  }

  // Songs: real lyric lines fetched from a lyrics website
  if (!phrase && theme === "song") {
    phrase = await fetchLyricPhrase(minLen, maxLen);
    if (phrase) source = "lyrics-ovh";
  }

  let attempts = 0;
  const maxAttempts = 3;

  while (!phrase && attempts < maxAttempts) {
    attempts++;
    try {
      const raw = await callGroqForPhrase(apiKey, theme, difficulty);
      phrase = validatePhrase(raw, minLen, maxLen);
      if (phrase) {
        // Book titles must not smuggle in attributions ("HAMLET BY SHAKESPEARE")
        if (theme === "book" && /\bBY\b/.test(phrase)) {
          console.log(`Attempt ${attempts}: Book rejected (contains BY):`, phrase);
          phrase = null;
        }
      }
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
    headers: { ...CORS_HEADERS, "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0" },
    body: JSON.stringify({ phrase, theme, difficulty, source }),
  };
}
