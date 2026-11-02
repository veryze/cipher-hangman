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
 *     (falls back to the LLM if the site is unavailable). If the request
 *     also carries 'customBands' (comma-separated band names), lyric lines
 *     are taken from songs by those bands via the suggest endpoint, snippets
 *     may span 1-2 consecutive lines (up to ~120 chars), and difficulty is
 *     ignored for this path
 *   - idiom: 50% drawn from a canonical idiom bank (the LLM often mangles
 *     classic idioms), otherwise the LLM
 *   - movie/book/any: the LLM, with theme overrides; book output containing
 *     a BY-author attribution is rejected and retried
 *   A phrase too short/long for the chosen difficulty is rejected and retried.
 * - explain: post-game explanation of the phrase's origin + entropy values
 *   (needs phrase, cipher, outcome, entropy, surprisal).
 * - tutor: in-game decoding helper. A masked snapshot of the player's progress
 *   (revealed letters, word lengths, cipher in use, guessed letters, lives,
 *   entropy values) plus a short question and the last few chat turns are sent.
 *   The model NEVER receives the hidden phrase, so it can teach cipher
 *   strategy and information-theory concepts without spoiling the answer.
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
1. Where the phrase comes from or what it means/when people say it (it is a known quote, proverb, idiom, song lyric, or book title). If the user message contains a PHRASE ORIGIN line, that origin is VERIFIED data: state it as fact, use the exact song title / artist / band given there, and NEVER invent or substitute a different source.
2. One sentence connecting to information theory: interpret the entropy/surprisal values (low entropy or low surprisal means predictable letters like E, T, A dominate; high values mean an unusual letter mix or long phrase that was harder to decode).
Rules:
- PLAIN TEXT only: NO markdown, NO bullet points, NO quotation marks around the phrase, NO emojis
- Friendly, encouraging tone for NLP students
- Do NOT contradict the given outcome (never claim the player won if they lost)
- Return ONLY the explanation text, nothing else`;

const TUTOR_SYSTEM_PROMPT = `You are a friendly decoding coach inside a Hangman game where phrases are encoded with classic ciphers (Caesar, ROT13, Atbash, A1Z26, Binary, Morse, Vigenere, Affine).
You are given a masked snapshot of the player's progress: which letters are revealed, word lengths, the cipher in use, letters already guessed, lives left, and the phrase's Shannon entropy and average surprisal. You NEVER see the hidden phrase itself.
Help the player decode the phrase THEMSELVES:
- Explain how the current cipher works and how to attack it (letter frequency analysis, word lengths, common patterns).
- Interpret what the entropy/surprisal values suggest about the letter mix.
- Comment on the letters already guessed and suggest a sensible next move.
- If a theme is given, describe kinds of well-known phrases that fit it, without claiming any specific one is the answer.
Rules:
- NEVER state, guess, or spell out the hidden phrase, and never claim certainty about letters you cannot know.
- Answer in AT MOST 3 short sentences (max 60 words total).
- PLAIN TEXT only: no markdown, no bullet points, no emojis.
- Friendly, encouraging tone for NLP students.
- Return ONLY your reply, nothing else`;

// Slightly constrained decoding-helper calls: short, steady answers
const TUTOR_CALL_OPTIONS = {
  max_tokens: 150,
  temperature: 0.6,
  top_p: 0.9,
  presence_penalty: 0.1,
  frequency_penalty: 0.1,
};

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

// Sanitize free-text explain fields (band names, song artist/title) so they can
// never inject prompt control characters; keep letters, digits and light punctuation.
function sanitizeExplainText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[^\p{L}\p{N} &.'\-/]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// Parse a comma-separated band list (same shape the phrase path uses)
function parseBandList(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const names = [...new Set(value.split(",").map(b => sanitizeExplainText(b, 40)).filter(b => b))];
  return names.length ? names.slice(0, 8) : null;
}

// Turn picker state (theme + custom bands + fetched song metadata) into a
// verified-origin line for the explanation prompt. Backend callers that do not
// pass these fields (e.g. the frontend after an offline-bank fallback) keep the
// model's old behavior of inferring the origin itself.
function buildExplainOrigin({ theme, bands, songArtist, songTitle }) {
  const isSong = theme === "song";
  if (isSong && songArtist && songTitle) {
    const via = bands && bands.length ? ` (custom band: ${bands.join(", ")})` : "";
    return `PHRASE ORIGIN (verified - use as fact): a REAL lyric line from the song "${songTitle}" by ${songArtist}${via}.`;
  }
  if (isSong) {
    const via = bands && bands.length
      ? ` Mention it comes from a song by ${bands.join(", ")} if it fits naturally; do NOT name a specific song or artist.`
      : "";
    return `PHRASE ORIGIN (use as fact): a well-known SONG LYRIC line — the artist is not verified, so phrase its origin generally without inventing a song.${via}`;
  }
  const label = {
    movie: "a well-known MOVIE QUOTE",
    idiom: "an established English IDIOM",
    book: "the exact title of a well-known published BOOK",
  }[theme || "any"];
  return `PHRASE ORIGIN (use as fact): ${label || "a well-known famous phrase"}.`;
}

function callGroqForExplanation(apiKey, { phrase, cipher, outcome, entropy, surprisal, theme, bands, songArtist, songTitle }) {
  const origin = buildExplainOrigin({ theme, bands, songArtist, songTitle });
  const userPrompt = [
    `Phrase: "${phrase}"`,
    origin,
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

// Sanitize free-text chat fields (helper questions, conversation memory, the
// masked reveal pattern) so they can never inject prompt control characters;
// keep letters, digits, natural question punctuation and the "_" mask marker.
function sanitizeChatText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[^\p{L}\p{N}_. ,!?'()\-:/&]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function callGroqForTutor(apiKey, { cipher, theme, pattern, wordLengths, guessed, lives, entropy, surprisal, question, history }) {
  const lines = [
    `Cipher in use: ${cipher}`,
    theme ? `Theme (the player picked it, they know this): ${theme}` : null,
    wordLengths ? `Word lengths: ${wordLengths}` : null,
    pattern ? `Reveal pattern (uppercase = revealed, _ = still hidden, " / " separates words): ${pattern}` : null,
    guessed ? `Letters guessed so far: ${guessed}` : null,
    `Lives left: ${lives}`,
    entropy !== undefined ? `Shannon entropy of the phrase's letter distribution: ${Number(entropy).toFixed(2)} bits` : null,
    surprisal !== undefined ? `Average surprisal per letter: ${Number(surprisal).toFixed(2)} bits` : null,
  ].filter(Boolean).join("\n");

  let userPrompt = lines;
  if (history && history.length) {
    userPrompt += "\n\nRecent conversation:\n" + history.join("\n");
  }
  userPrompt += `\n\nStudent's question: "${question}"`;

  return callGroq(apiKey, TUTOR_SYSTEM_PROMPT, userPrompt, TUTOR_CALL_OPTIONS);
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

const LYRICS_API = "https://api.lyrics.ovh/v1/";
const LYRICS_SUGGEST_API = "https://api.lyrics.ovh/suggest/";

const LYRICS_TIMEOUT_MS = 8000;

function cleanLyricLine(line, minLen, maxLen) {
  const cleaned = (line || "").trim().toUpperCase().replace(/[^A-Z\s]/g, '').replace(/\s+/g, ' ').trim();
  return validatePhrase(cleaned, minLen, maxLen);
}

// Build candidate snippets of 1..maxLines consecutive lyric lines (each line already
// validated alone), so short lines can combine instead of being hard-capped
function pickLyricSnippet(lyricsText, minLen, maxLen, maxLines) {
  const rawLines = (lyricsText || "").split(/\r?\n/);
  const snippets = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (!rawLines[i].trim()) continue;
    for (let n = 1; n <= maxLines; n++) {
      const chunk = rawLines.slice(i, i + n);
      if (chunk.length < n) break;
      if (chunk.some(l => !l.trim())) continue; // lines must be consecutive non-blank
      const cleaned = validatePhrase(chunk.join(' '), minLen, maxLen);
      if (cleaned) snippets.push(cleaned);
    }
  }
  return snippets.length ? snippets[Math.floor(Math.random() * snippets.length)] : null;
}

async function fetchTimedJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LYRICS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) {
      console.error(`Lyrics API ${res.status} for ${url}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`Lyrics fetch failed (${url}):`, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Find a song by one of the user's custom bands via the suggest endpoint
async function pickSongByBand(band) {
  const data = await fetchTimedJson(`${LYRICS_SUGGEST_API}${encodeURIComponent(band.trim())}`);
  // lyrics.ovh suggest (Deezer proxy) returns { data: [...] }; accept legacy { results: [...] } too
  const list = Array.isArray(data?.data) ? data.data
    : Array.isArray(data?.results) ? data.results : null;
  if (!list) return null;
  const bandNorm = band.trim().toLowerCase();
  const matches = list.filter(r =>
    r && r.artist && typeof r.artist.name === 'string' &&
    r.artist.name.toLowerCase().includes(bandNorm));
  if (!matches.length) return null;
  const pick = matches[Math.floor(Math.random() * matches.length)];
  return { artist: pick.artist.name, title: pick.title };
}

async function fetchLyricPhrase(minLen, maxLen, bands, maxLines) {
  for (let t = 0; t < 3; t++) {
    let band = null;
    let song;
    if (bands && bands.length) {
      band = bands[Math.floor(Math.random() * bands.length)];
      song = await pickSongByBand(band);
    } else {
      song = SONG_LIST[Math.floor(Math.random() * SONG_LIST.length)];
    }
    if (!song) continue;

    const data = await fetchTimedJson(`${LYRICS_API}${encodeURIComponent(song.artist)}/${encodeURIComponent(song.title)}`);
    if (!data) continue;
    const snippet = pickLyricSnippet(data.lyrics || "", minLen, maxLen, maxLines);
    if (snippet) {
      // Provenance for the explain mode: which band was picked + the actual song
      return { snippet, song: { artist: song.artist, title: song.title, band } };
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

  // Optional custom bands (Song theme): comma-separated band names from the menu.
  // Present => song theme, and DIFFICULTY IS IGNORED (1-2 line snippets, relaxed length limit).
  let customBands = null;
  if (theme === "song" && typeof body.customBands === "string" && body.customBands.trim()) {
    const names = [...new Set(body.customBands
      .split(",")
      .map(b => b.replace(/[^A-Za-z0-9 &.'\-/]/g, '').trim())
      .filter(b => b && b.length <= 40))];
    if (names.length) customBands = names.slice(0, 8);
  }
  const ignoreDifficulty = theme === "song" && !!customBands;
  const effectiveDifficulty = ignoreDifficulty ? "normal" : difficulty;

  // ---- Explain mode: post-game explanation of phrase + entropy ----
  if (body.mode === "explain") {
    const { phrase, cipher, outcome, entropy, surprisal } = body;
    const cleanPhrase = typeof phrase === "string" ? phrase.trim().toUpperCase() : "";
    if (!cleanPhrase || !/^[A-Z\s]+$/.test(cleanPhrase)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing or invalid phrase" }) };
    }
    const safeOutcome = outcome === "win" ? "The player WON this round." : "The player lost this round.";

    // Picker state sent directly by the frontend (sent with the phrase when known):
    // a) theme picked in the menu; b) custom band list + the actual song the
    // lyric line was taken from (returned by the phrase call as 'song').
    // Unknown values are sanitised/fallback so the prompt cannot be hijacked;
    // absent fields simply fall back to the model inferring the origin itself.
    const explainTheme = THEME_RULES[body.theme] !== undefined ? body.theme : null;
    const explainBands = explainTheme === "song" ? parseBandList(body.customBands) : null;
    const songArtist = sanitizeExplainText(body.songArtist, 60);
    const songTitle = sanitizeExplainText(body.songTitle, 60);

    try {
      const raw = await callGroqForExplanation(apiKey, {
        phrase: cleanPhrase,
        cipher: typeof cipher === "string" ? cipher.slice(0, 80) : "Unknown cipher",
        outcome: safeOutcome,
        entropy,
        surprisal,
        theme: explainTheme,
        bands: explainBands,
        songArtist,
        songTitle,
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

  // ---- Tutor mode: in-game LLM decoding helper (chat) ----
  if (body.mode === "tutor") {
    const question = sanitizeChatText(body.question, 300);
    if (!question) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing or invalid question" }) };
    }

    // Masked progress instead of the hidden phrase: the model can reason about
    // the player's situation but can never leak the answer. Pattern, word
    // lengths and guessed letters come from the client's own game state.
    const lives = Number.isFinite(Number(body.lives))
      ? Math.max(0, Math.min(20, Math.floor(Number(body.lives))))
      : "unknown";

    // Short rolling memory so follow-up questions keep context (last 6 turns)
    const history = Array.isArray(body.history)
      ? body.history
          .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-6)
          .map(m => `${m.role === "user" ? "Student asked" : "Tutor said"}: ${sanitizeChatText(m.content, 200)}`)
      : [];

    try {
      const raw = await callGroqForTutor(apiKey, {
        cipher: sanitizeExplainText(body.cipher, 80) || "Unknown cipher",
        theme: sanitizeChatText(body.theme, 20),
        pattern: sanitizeChatText(body.pattern, 200),
        wordLengths: sanitizeChatText(body.wordLengths, 60),
        guessed: sanitizeChatText(body.guessed, 100),
        lives,
        entropy: body.entropy,
        surprisal: body.surprisal,
        question,
        history,
      });
      const reply = raw ? raw.replace(/^["'\s]+|["'\s]+$/g, '') : "";
      if (!reply || reply.length < 2 || reply.length > 600) {
        return { statusCode: 502, body: JSON.stringify({ error: "Failed to generate valid reply" }), headers: CORS_HEADERS };
      }
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, "Cache-Control": "no-cache, no-store, must-revalidate" },
        body: JSON.stringify({ reply }),
      };
    } catch (e) {
      console.error("Tutor attempt failed:", e);
      return { statusCode: 502, body: JSON.stringify({ error: "Failed to generate reply" }), headers: CORS_HEADERS };
    }
  }

  // ---- Default: phrase mode ----
  // Difficulty length guards: reject normal-difficulty phrases passing as hard (and vice versa).
  // Skipped when custom bands are used (difficulty is ignored there; snippets may span 1-2 lines).
  const minLen = ignoreDifficulty ? 10 : (effectiveDifficulty === "hard" ? 25 : 10);
  const maxLen = ignoreDifficulty ? 120 : (effectiveDifficulty === "easy" ? 40 : 70);

  let phrase = null;
  let source = "llm";

  // Idioms: guarantee canonical classics half of the time
  if (theme === "idiom" && Math.random() < 0.5) {
    const pick = CANONICAL_IDIOMS[Math.floor(Math.random() * CANONICAL_IDIOMS.length)];
    phrase = validatePhrase(pick, minLen, maxLen);
    if (phrase) source = "idiom-bank";
  }

  // Songs: real lyric lines fetched from a lyrics website
  let songInfo = null; // provenance for the explain mode (theme === song)
  if (!phrase && theme === "song") {
    const lyric = await fetchLyricPhrase(minLen, maxLen, customBands, ignoreDifficulty ? 2 : 1);
    if (lyric) {
      phrase = lyric.snippet;
      songInfo = lyric.song;
      source = ignoreDifficulty ? "lyrics-ovh-custom" : "lyrics-ovh";
    }
  }

  let attempts = 0;
  const maxAttempts = 3;

  while (!phrase && attempts < maxAttempts) {
    attempts++;
    try {
      // LLM fallback ignores custom bands (the model cannot search a site);
      // effectiveDifficulty already normalised when bands are in play
      const raw = await callGroqForPhrase(apiKey, theme, effectiveDifficulty);
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

  const response = { phrase, theme, difficulty: effectiveDifficulty, source };
  // Song provenance (only when the phrase really is a fetched lyric line):
  // artist/title of the actual song plus the band picked in the menu, if any.
  if (songInfo) response.song = songInfo;
  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0" },
    body: JSON.stringify(response),
  };
}
