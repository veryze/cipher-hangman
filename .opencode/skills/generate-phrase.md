# SKILL.md
name: generate-phrase
description: Hangman phrase generation + post-game explanations — runs DIRECTLY in OpenCode (agentspace), themed generation incl. real lyric fetching (custom bands), idiom bank; no Netlify call, no Groq API key needed
version: 2.2.0

tools:
  - name: generate_phrase
    description: Generate a new Hangman phrase, executed locally by the agent (no deployed endpoint). The agent generates/fetches the phrase itself and self-validates it with the rules below.
    parameters:
      type: object
      properties:
        theme:
          type: string
          description: Theme of the phrase (chosen in the menu's Phrase Theme picker). any mixes all types. custom = the player typed their own theme free-text (custom_theme parameter). song = REAL lyric lines fetched from lyrics.ovh (keyless); idiom = drawn from a canonical idiom bank half the time; book = titles only (BY-author attributions rejected).
          enum: [any, movie, idiom, song, book, custom]
          default: any
        difficulty:
          type: string
          description: Difficulty of the phrase (chosen in the menu's Phrase Difficulty picker). easy = at most 40 chars, normal = default, hard = at least 25 chars with more unusual letters (enforced by validation, not just generation).
          enum: [easy, normal, hard]
          default: normal
        custom_theme:
          type: string
          description: ONLY when theme = custom. The player's free-text theme (max 60 chars, e.g. "space exploration"). The output must still be a REAL famous phrase that fits it; empty text falls back to any.
          default: null
        custom_bands:
          type: string
          description: Custom bands (Song theme only; comma-separated, max 8). Lyric lines are then taken from songs by those bands via the lyrics.ovh suggest endpoint. DIFFICULTY IS IGNORED for this path.
          default: null
      required: []
    returns:
      type: object
      properties:
        phrase:
          type: string
          description: The generated phrase (uppercase A-Z and spaces only)
        source:
          type: string
          description: idiom-bank | lyrics-ovh | lyrics-ovh-custom | agent-llm
        song:
          type: object
          description: Only when the phrase is a fetched lyric line. { artist, title, band } provenance, forwarded to explain calls.
          properties:
            artist:
              type: string
            title:
              type: string
            band:
              type: string
              description: The band picked in the menu, null when no custom bands were used.
      required: [phrase]

# HOW TO EXECUTE — do these steps yourself, do NOT call the Netlify endpoint
# (https://hangman-cipher.netlify.app/.netlify/functions/generate-themed-phrase).
# The frontend (cipher-hangman.html) still calls that endpoint itself and falls
# back to an offline phrase bank; the Netlify function
# (netlify/functions/generate-themed-phrase.js) remains the source of truth for
# the logic below. You never need it: you ARE the LLM, and the only network
# dependency (lyrics.ovh) is free and keyless.
#
# ---- 1. SONG theme (incl. custom bands): run in the `execute` tool ----
# Use `execute` (JS runtime with fetch) and run this replica of the function:
#
# const LYRICS_API = "https://api.lyrics.ovh/v1/";
# const LYRICS_SUGGEST_API = "https://api.lyrics.ovh/suggest/";
#
# // !GOTCHA: the suggest endpoint (a Deezer proxy) returns { data: [...] },
# // NOT { results: [...] }. Do not "fix" this back.
# async function pickSongByBand(band) {
#   const res = await fetch(`${LYRICS_SUGGEST_API}${encodeURIComponent(band.trim())}`);
#   const data = await res.json();
#   const list = Array.isArray(data.data) ? data.data
#     : Array.isArray(data.results) ? data.results : null;
#   if (!list) return null;
#   const bandNorm = band.trim().toLowerCase();
#   const matches = list.filter(r => r && r.artist && typeof r.artist.name === "string"
#     && r.artist.name.toLowerCase().includes(bandNorm));
#   if (!matches.length) return null;
#   const pick = matches[Math.floor(Math.random() * matches.length)];
#   return { artist: pick.artist.name, title: pick.title };
# }
#
# function validatePhrase(phrase, minLen = 10, maxLen = 70) {
#   if (!phrase) return null;
#   const cleaned = phrase.trim().toUpperCase().replace(/[^A-Z\s]/g, "").replace(/\s+/g, " ").trim();
#   if (cleaned.length < minLen || cleaned.length > maxLen) return null;
#   if (!/^[A-Z\s]+$/.test(cleaned)) return null;
#   if (cleaned.split(" ").filter(w => w.length > 0).length < 2) return null;
#   return cleaned; // NOTE: validated alone, the cleaned string is the answer
# }
#
# function pickLyricSnippet(lyricsText, minLen, maxLen, maxLines) {
#   const rawLines = (lyricsText || "").split(/\r?\n/);
#   const snippets = [];
#   for (let i = 0; i < rawLines.length; i++) {
#     if (!rawLines[i].trim()) continue;
#     for (let n = 1; n <= maxLines; n++) {
#       const chunk = rawLines.slice(i, i + n);
#       if (chunk.length < n) break;
#       if (chunk.some(l => !l.trim())) continue; // lines must be consecutive, non-blank
#       const cleaned = validatePhrase(chunk.join(" "), minLen, maxLen);
#       if (cleaned) snippets.push(cleaned);
#     }
#   }
#   return snippets.length ? snippets[Math.floor(Math.random() * snippets.length)] : null;
# }
#
# // Non-bands song bank (exact mirror of SONG_LIST in the function):
# const SONG_LIST = [
#   { artist: "The Beatles", title: "Let It Be" },
#   { artist: "The Beatles", title: "Hey Jude" },
#   { artist: "The Beatles", title: "With a Little Help from My Friends" },
#   { artist: "Queen", title: "Bohemian Rhapsody" },
#   { artist: "Queen", title: "We Are the Champions" },
#   { artist: "Queen", title: "Another One Bites the Dust" },
#   { artist: "Eagles", title: "Hotel California" },
#   { artist: "Simon And Garfunkel", title: "Bridge Over Troubled Water" },
#   { artist: "The Rolling Stones", title: "Paint It Black" },
#   { artist: "Elton John", title: "Rocket Man" },
#   { artist: "Elton John", title: "Your Song" },
#   { artist: "John Lennon", title: "Imagine" },
#   { artist: "Andrea Bocelli And Sarah Brightman", title: "Time to Say Goodbye" },
#   { artist: "Lynyrd Skynyrd", title: "Free Bird" },
#   { artist: "R.E.M.", title: "Losing My Religion" },
#   { artist: "Eric Clapton", title: "Wonderful Tonight" },
#   { artist: "Bob Dylan", title: "Blowin in the Wind" },
#   { artist: "Aerosmith", title: "Dream On" },
#   { artist: "Journey", title: "Dont Stop Believin" },
#   { artist: "Bon Jovi", title: "Livin on a Prayer" },
#   { artist: "Nirvana", title: "Smells Like Teen Spirit" },
#   { artist: "Fleetwood Mac", title: "Landslide" },
#   { artist: "Elvis Presley", title: "Cant Help Falling in Love" },
#   { artist: "Whitney Houston", title: "Greatest Love of All" },
# ];
#
# // customBands: comma-separated band names, sanitise like: b.replace(/[^A-Za-z0-9 &.'\-/]/g, ""), max 8.
# // lyricPhrase({ bands, minLen, maxLen, maxLines, attempts }) — assembled from the helpers above.
# // WHEN customBands USED: minLen=10, maxLen=120, maxLines=2, difficulty IGNORED, attempts=5.
# // WHEN NOT used:     minLen/maxLen per difficulty (easy: 10-40, normal: 10-70, hard: 25-70),
# //                    maxLines=1, attempts=3.
# async function lyricPhrase({ bands, minLen, maxLen, maxLines, attempts }) {
#   const bandList = Array.isArray(bands) ? bands : null;
#   for (let t = 0; t < attempts; t++) {
#     let chosenBand = null;
#     const song = bandList && bandList.length
#       ? (chosenBand = bandList[Math.floor(Math.random() * bandList.length)],
#          await pickSongByBand(chosenBand))
#       : SONG_LIST[Math.floor(Math.random() * SONG_LIST.length)];
#     if (!song) continue;
#     const res = await fetch(`${LYRICS_API}${encodeURIComponent(song.artist)}/${encodeURIComponent(song.title)}`);
#     if (!res.ok) continue;
#     const data = await res.json();
#     const snippet = pickLyricSnippet(data.lyrics || "", minLen, maxLen, maxLines);
#     if (snippet) {
#       return { phrase: snippet,
#                source: bandList ? "lyrics-ovh-custom" : "lyrics-ovh",
#                song: { artist: song.artist, title: song.title, band: chosenBand } };
#     }
#   }
#   return null;
# }
#
# ---- 2. IDIOM theme: no network needed ----
# With probability 0.5 pick verbatim from CANONICAL_IDIOMS (keep typos out; source: idiom-bank):
#   "A STITCH IN TIME SAVES NINE", "ONCE IN A BLUE MOON", "A BLESSING IN DISGUISE",
#   "BARKING UP THE WRONG TREE", "THE CALM BEFORE THE STORM", "EVERY CLOUD HAS A SILVER LINING",
#   "THE LAST STRAW", "ON THIN ICE", "BETTER LATE THAN NEVER", "IGNORANCE IS BLISS",
#   "SPLITTING HAIRS", "BURNING THE MIDNIGHT OIL"
# Otherwise, generate one yourself (see 3) with the idiom theme rules.
#
# ---- 3. MOVIE / BOOK / ANY themes (and any fallback): YOU are the LLM ----
# Generate ONE short, recognizable English phrase for Hangman yourself, following these
# rules (verbatim from the function's SYSTEM_PROMPT):
# - Uppercase letters A-Z and spaces ONLY (NO punctuation, numbers, special chars)
# - Identify the SOURCE, not a description of it: output the phrase itself, never the person/title/artist that said it
# - ONLY well-known, familiar sources: famous movie quotes, established idioms, famous song lyrics, famous book titles
# - NO invented phrases, NO obscure references
# - EXACT and COMPLETE wording: reproduce the real phrase word for word. NEVER abbreviate, truncate, or drop words
#   (HERES LOOKING instead of HERES LOOKING AT YOU KID is incomplete and will be rejected)
# - Vary your selection across calls: do NOT default to the most famous choice every time - pick another
#   well-known example instead of overused classics like TO BE OR NOT TO BE unless asked
# Theme overrides (from THEME_RULES; apply for the chosen theme):
# - movie: ONLY the well-known MOVIE QUOTE itself. NEVER the film title, the character, or the word BY.
#   Examples: MAY THE FORCE BE WITH YOU / ILL BE BACK / YOU CANNOT HANDLE THE TRUTH / SHOW ME THE MONEY
# - book: ONLY the exact title of a well-known published BOOK. Add NOTHING: no author name, no BY + name,
#   no series numbering, no subtitle unless part of the title, never a saying instead of a title.
#   Any output containing the word BY is rejected — regenerate.
#   Examples: TO KILL A MOCKINGBIRD / PRIDE AND PREJUDICE / THE CATCHER IN THE RYE / JANE EYRE
# - custom (custom_theme given): ONE real, famous phrase connected to the player's own theme
#   (a quote, saying, lyric line or title) — still never an invented sentence.
# - any: mix freely across the above and quotes/lyrics/idioms. (The old "proverb" theme was removed.)
# Difficulty checkpoints (enforced by validation, not just generation — re-run validatePhrase on yourself):
# - easy: phrase must be AT MOST 40 characters (aim 15-30); common, instantly recognizable; common letters (E, T, A, O) often.
# - normal: prefer 15-60 characters.
# - hard: phrase must be AT LEAST 25 characters (aim 30-60); unusual letter distribution; rare letters J/K/Q/X/Z welcome.
# Validate with validatePhrase(minLen, maxLen): default 10-70; easy maxLen=40; hard minLen=25.
# hard additionally requires the phrase to stay REAL (never invent/pad to reach 25+ chars):
# fully worded idioms, longer quotes, lyric lines or long book titles only.
# If a recentPhrases list is passed, exclude those phrases exactly (same rejection rule as the endpoint).
# If your phrase fails validation, regenerate (up to 3 total attempts). Report source: "agent-llm".
#
# ---- 4. EXPLAIN mode (+ optional origin data) ----
# When asked to explain a finished round (do NOT call the endpoint; write it yourself), you are given
# phrase, cipher, outcome ("win"/"lose"), entropy (Shannon entropy of the letter distribution),
# surprisal (average per letter), and optionally provenance: theme, customBands, songArtist/songTitle,
# and songBand (the ONE band from the player's custom list that the song actually came from —
# name that single band, never the whole comma-separated list; the actual song the lyric line was
# taken from — verified data).
# Write AT MOST 3 short sentences (max 60 words total):
# 1. Where the phrase comes from or what it means/when people say it. If a PHRASE ORIGIN was supplied
#    (theme = type; songArtist/songTitle = exact song/artist), that origin is VERIFIED: state it as
#    fact, use the exact song title / artist / band given, and NEVER invent or substitute a different source.
#    When bands are given but no song metadata: you may mention the band, but do NOT name a song.
# 2. One sentence connecting to information theory: interpret the entropy/surprisal values (low entropy or
#    low surprisal means predictable letters like E, T, A dominate; high values mean an unusual letter mix
#    or long phrase that was harder to decode).
# Rules:
# - PLAIN TEXT only: NO markdown, NO bullet points, NO quotation marks around the phrase, NO emojis
# - Friendly, encouraging tone for NLP students
# - Do NOT contradict the given outcome (never claim the player won if they lost)
# - Return ONLY the explanation text, nothing else
#
# ---- Notes ----
# - The customBands + data.data fix and the song provenance (`song` on the phrase response,
#   explain's theme/customBands/songArtist/songTitle) are already in
#   netlify/functions/generate-themed-phrase.js (v1.6.0) — but ARE NOT on the deployed
#   endpoint until the project is redeployed. That is another reason this skill runs locally.
# - Since version 2.0.0 execute is the primary path; the previous run-via-Netlify SKILL.md
#   is superseded and should not be preferred.
