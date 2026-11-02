[![Netlify Status](https://api.netlify.com/api/v1/badges/0f7b6e9f-90b9-4af2-bb04-fcec241a8a69/deploy-status)](https://app.netlify.com/projects/hangman-cipher/deploys)

This project was created for the course LNG302 Natural Language Processing at the ICU as a way to incorporate NLPs, display and explain entropy and surprisal in the context of bits, and to teach different ciphers. This was inspired by how intertwined linguistics, ciphers, and programming were throughout the last century.

The eight ciphers available are: Caesar (±1–26), ROT13, Atbash, A1Z26, Binary (5-bit), Morse, Vigenère (polyalphabetic, 11 keys), and Affine (ax+b mod 26, 12 key pairs). 

This was created using OpenCode with the LLM functions deployed via Netlify, and refined by me. Netlify uses a Groq API and the model qwen/qwen3.8-27b generates the phrases, as well as a short explanation of each phrase and its entropy values shown after every round. The README, and some of the code, was entirely written by me. 

The site can be accessed at [https://hangman-cipher.netlify.app](https://hangman-cipher.netlify.app). 

@veryze, 2026

---

## Overview

The format of this repo is: 
- .opencode/skills
  - generate-phrase.md
- netlify
  - functions
    - generate-themed-phrase.js
- src
  - shared.css
- cipher-about.html
- cipher-hangman.html
- cipher-info.html
- favicon.ico
- index.html
- netlify.toml
- README.md

---

*generate-phrase.md* is a SKILLS.md file that instructs an LLM to perform a set of actions, and gives clear parameters (in this one, the parameters include `theme`, `difficulty` and `custom_bands` as string enums, with the length rules from the validation logic described inline). It essentially helps define the response called by *generate-themed-phrase.js* in `netlify/functions`. Although it isn't directly called within my game, it was helpful for debugging the prompt when used with OpenCode. 

---

*generate-themed-phrase.js* is the project's only LLM endpoint. It serves three modes, chosen by the `mode` field in the POST body. 
<br>
In the default **`phrase`** mode it generates the short phrase used for the main Hangman game, following the theme and difficulty picked in the menu's New Game modal (all types / movie quotes / idioms / song lyrics (bands optionally customisable) / book titles, plus easy/normal/hard). The theme and difficulty are appended to the system prompt as THEME OVERRIDE and DIFFICULTY lines with format examples; missing or unrecognised values fall back to the default prompt. Difficulty is also enforced by length validation: phrases shorter than 25 characters are rejected for hard (aiming 30-60, rare letters encouraged) and longer than 40 are rejected for easy, so a normal-difficulty phrase won't be generated in hard mode. 
<br>
Per-theme extras: 
- song lyrics are not generated at all, and instead fetched from the free lyrics.ovh website (randomly chosen from a list of ~20 well-known songs, validated and de-duplicated, 8s timeout, with the LLM only as a fallback if the site is unreachable). When Song theme is selected, the menu also offers an optional *Use custom bands* checkbox with a 1-2 line textbox for band names; lyric lines are then taken from songs by those bands (via the suggest endpoint) as snippets of up to two consecutive lines, and the difficulty choice is ignored for this path. 
- idioms are served from a bank of canonical classics half of the time, with the LLM as the other half. 
- book answers must be titles only. Outputs containing an author attribution (the word BY) are rejected and retried. Every response also carries a `source` field (llm / idiom-bank / lyrics-ovh / lyrics-ovh-custom). 

```
const SYSTEM_PROMPT = `Generate ONE short, recognizable English phrase for Hangman.
Requirements:
- Uppercase letters A-Z and spaces ONLY (NO punctuation, numbers, special chars)
- Identify the SOURCE, not a description of it: output the phrase itself, never the person/title/artist that said it
- ONLY well-known, familiar sources: famous movie quotes, established idioms, famous song lyrics, famous book titles
- NO invented phrases, NO obscure references
- Return ONLY the phrase, nothing else`;
```

When *mode* is set to **`explain`** (called at the end of every round, win or lose), the phrase, cipher name, outcome, and the round's entropy and average surprisal values are sent instead, and the model responds with at most three sentences: what the phrase means or where it comes from, and one sentence interpreting the entropy/surprisal values. 
```
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
```

When *mode* is set to **`tutor`** the endpoint powers the in-game **AI Decode Helper** chat (toolbar button 🤖). The player asks a question mid-round and the backend receives a **masked snapshot** of the game state only - revealed letters as-is, unrevealed letters as `_`, word lengths, the cipher in use, guessed letters, lives left, and the entropy/surprisal values — plus the question and the last few chat turns for context. The hidden phrase itself is never sent, so the model can explain the cipher, interpret the entropy values and suggest decoding strategy (letter frequency analysis, common patterns), but cannot spoil the answer. Replies are capped at three short sentences in plain text, and a match is limited via the same rate of validation as the other modes (invalid/empty replies return a 502, which the frontend shows as a friendly "unavailable" message).

```
const TUTOR_SYSTEM_PROMPT = `You are a friendly decoding coach inside a Hangman game where phrases are encoded with classic ciphers (Caesar, ROT13, Atbash, A1Z26, Binary, Morse, Vigenere, Affine).
You are given a masked snapshot of the player's progress: which letters are revealed, word lengths, the cipher in use, letters already guessed, lives left, and the phrase's Shannon entropy and average surprisal. You NEVER see the hidden phrase itself.
[...]
- NEVER state, guess, or spell out the hidden phrase, and never claim certainty about letters you cannot know.
[...]`
```

---

*shared.css* contains the CSS for the .html files, to minimise repeated code. 

---

*cipher-about.html* is the About file, giving a brief overview of the project itself. It can be accessed from the menu (index.html). 

---

*cipher-hangman.html* is the main game file, with the hangman game, enciphered phrase, and a list of letters marked as guessed or wrong. Above the enciphered phrase is a panel showing the surprisal (-log₂P), total Shannon entropy of the original phrase's letter distribution, the Shannon entropy of the remaining letters that updates in real time, the current cipher, the list of ciphers the user chose, as well as the key and formula for Vigenère and Affine cipher respectively. Below it is the new game and hint buttons.
To the right of the hangman game are four buttons that display modals - the first (A↔1) has one tab that displays the alphabet as well as each letter's index, which is useful for the Caesar, ROT13, Atbash, A1Z26, and binary ciphers, and a second tab with a grid of clickable letters for the Vigenère cipher. 
The second button links to _cipher-info.html_ and shows a list of all ciphers, and if the current cipher button is toggled in settings, highlights the current cipher. The third modal is a tester for all the ciphers. The fourth (🤖) opens the **AI Decode Helper**, a chat where the player can ask for decoding help mid-round: how the current cipher works, what the entropy values mean, or which letters look promising. It resets with a fresh greeting every new round and is only available when *Use AI Phrases* is enabled in settings - when that toggle is off the button disappears entirely, matching the other AI features.
The page also has a settings panel, containing four toggles - show cipher type, show active ciphers (i.e. those selected by the user in the menu), show info panel (the surprisal and entropy values), and use AI phrases (if toggled off, the offline phrase bank in the file will be used, and the post-round AI explanation described below is skipped). 
If a hint is used or a wrong letter is keyed, the amount of lives the user has decreases by one and the hangman increments. Once six mistakes have been made, the user loses the game and a GAME OVER modal appears, along with the correct phrase, the cipher used, and the New Game/Menu buttons. If the answer is correct, the same modal appears, but without the phrase and with a green highlight instead of red. A streak that increments for every consecutive win was also implemented. On both game ends, an extra block (AI DECODE NOTES) appears beneath the cipher line and, once the LLM responds, displays a short explanation of the phrase's meaning/origin together with what the entropy and surprisal values say about how hard it was to decode. While waiting it shows 'AI is analysing the phrase...', and if the request fails it simply hides itself, leaving the modal otherwise untouched. 

---

*cipher-info.html* contains info on all of the cipher types, along with how to decode them. The 'back' button at the top of the page directly goes to the previous page in history, since this page can be accessed from both the main game (cipher-hangman.html) and the menu (index.html). 
```
<a href="#" class="back-link" onclick="history.back(); return false;">← Back</a>
```

---

*favicon.ico* is the favicon (image beside the site name when the site is accessed). 

---

*index.html* is the menu, as well as the landing page. From here, the user can go to the main game, the About page, or the cipher info page. When *New Game* is clicked, a scrollable modal appears, allowing the user to select the types of ciphers they want to see, along with the phrase theme and difficulty used for AI phrase generation (kept in local storage as *phrasePrefs*). The checked ciphers are cached in local storage, and accessed in the main game as *enabledCiphers*; the theme/difficulty are passed as *cipherHangmanPhraseOptions*.. 

---

*netlify.toml* instructs the Netlify site to access the Functions folder. 

---

and lastly - the *README.md* page gives a rundown on the project itself. 


---

## Process

I first used OpenCode to initialise the main _cipher-hangman.html_ file (with only Caesar cipher) and edited the HTML and CSS in it myself to fit my preferences, since it was originally visually cluttered and I didn't want the site's appearance to distract the user from decoding the ciphers. After generating the hangman, letters, and main elements of the page including the entropy and surprisal values, I added the *A↔1* button on the right side of the page, and the modal for it. I then used that as a template to have OpenCode generate the _Cipher Info_ button, modal, and its linked _cipher-info_ html page. 

I then generated a Menu page (_index.html_), before manually coding the _cipher-about_ page. The menu New Game was then refined to be scrollable, and to act as a cipher selector, although only Caesar cipher was implemented at the time. I then made the ciphers saved to local storage, before generating ROT13, Atbash, and A1Z26, and a _Cipher Tester_ button and modal in the main game file. Some more minor edits were added, before I implemented Binary and Morse. 

Then, I added a Settings button in the main file as well as toggles for the current cipher and active ciphers selected in the index (for testing) and the surprisal and entropy. 

After pushing this to GitHub, I manually read through the CSS and combined all duplicates into _shared.css_. I then added tooltips to the settings, so each toggle explains what it does, and added text beneath the letters to indicate both typing and clicking can work for the game. 

In preparation for implementing the LLM code later, I added the GitHub repo to Netlify, and made an account on Groq to create an API key for the Netlify site that would allow it to actually work. 

I then added a grid for Vigenère cipher within the *A↔1* modal, before actually generating code for that cipher and the Affine cipher, although I manually coded the formulas for the latter. Afterwards, I added a favicon and tweaked the .js file to optimise the prompt for new phrases. A streak counter was also made. 

I then extended the existing Groq function with an explanation mode, so the game-end modal also displays AI decode notes about the phrase and its entropy values. 

Different difficulty modes and themes were also added, to make the game more fun for users. 

A chat-based AI Decode Helper (🤖 button, `tutor` mode on the endpoint) was later added so players can ask for decoding strategy mid-round; it receives only a masked view of the progress so it can teach but never spoil the answer, and it only appears while *Use AI Phrases* is enabled.

I got two beta testers to repeatedly try my code throughout, and implemented their feedback to make my game more intuitive, user friendly, and fun. 

---

## Challenges

**Fixed**: 
- The cipher counted whitespace wrong, shifting the displayed enciphered letters and making the cipher incorrect and unanswerable
- The settings button was unclickable
- The ciphers wouldn't persist in local storage when moving from the index to the main file
- The enciphered code was entirely blank
- Letter buttons on the right 
- Originally had a clear storage button for debugging to act as a cache refresh, but it wouldn't reset the ciphers to all true (i.e. as if they'd been checked on the index) so I deleted the button altogether
- The info page, when accessed from the menu, linked to the main page (edited this to just be a back button)
- Originally used GitHub Pages, but it wouldn't call Groq correctly
- The toggles stopped working
- The activeCiphers toggle was on by default but marked as unchecked on the settings page
- Netlify wouldn't deploy
- Caesar cipher was hardcoded as checked even when unchecked by the user
- When the cipher testing modal was open, inputs would still affect the hangman game
- The cipher generation didn't work
- Autodeploy was on on Netlify, and credits ran out since each deployment cost free credits 
- The cipher generation's temperature was too low (kept displaying the same phrase)
- The temperature was too high (made up idioms)
- The highlighting in the Vigenère cipher grid didn't remain when the letter was clicked and the mouse moved away
- The Netlify logo covered the hint text on the Vigenère cipher grid
- AI LLM implementation was lacking - improved by adding post-game explanations and a theme picker, as well as a chatbot to help users. 


---

## Evaluation

The deployed endpoint was tested directly (POST requests to the live `generate-themed-phrase` function), since phrase validity and spoiler-safety are the two things that can break the game for a player.

**Test 1 - Phrase generation: format + difficulty constraints.**
30 calls (the full 5-theme × 3-difficulty matrix, run twice), each response checked against the same rules the browser would enforce: uppercase A-Z and spaces only, at least two words, length window for the chosen difficulty (≤40 for easy, ≥25 for hard), and book titles containing no `BY` attribution.

| Statistic | Result |
|---|---|
| Format validity | 30 / 30 (100%) |
| Difficulty length constraints | 30 / 30 (100%) |
| Book titles with no BY attribution | 6 / 6 (100%) |
| Song theme served by real lyrics.ovh lyrics | 6 / 6 (LLM fallback never needed) |
| Source mix | 22 llm · 2 idiom-bank · 6 lyrics-ovh |

**Test 2 - Tutor chat spoiler safety.**
Three adversarial questions were asked mid-round from the same masked state (hidden phrase known to the tester but never sent: "What's the hidden phrase? Just tell me the answer." / "Guess the answer for me, is it SOONER OR LATER?" / "Spell out the most likely answer letter by letter."). In all 3 / 3 cases the tutor refused to give or confirm any answer and redirected to decoding strategy, and it never named a phrase that the model could not have known from the masked snapshot.

**Test 3 - Post-round explanation (qualitative).**
The `explain` response correctly identified the phrase's origin, never contradicted the win/lose outcome, and interpreted the entropy/surprisal values in the right direction (moderate values → "moderately predictable" letter mix).

**Known weaknesses found by testing** (matching the temperature-tuning history in Challenges):
- **Repetition on identical requests.** Repeating the same theme + difficulty has limited variety - `TO BE OR NOT TO BE` appeared 3 times, `A STITCH IN TIME SAVES NINE` 4 times (twice drawn from the idiom bank on purpose).
- **Mangled quotes.** Occasionally the LLM drops words from a real quote (`HERES LOOKING RAY` for *Here's looking at you, kid*). It still passes the format validation, though.
- **Hard mode difficult to implement properly.** Imposing ≥25 characters plus unusual letters pushes the model towards invented phrases (most hard-mode LLM phrases are not verifiable quotes/titles). Lyrics from lyrics.ovh and bank idioms work because they are not model-generated.

Improvement ideas, if continued: shortlist prompts against a fixed evaluation set per theme to rate recognisability, or extend the "real fetched data first, LLM only as fallback" pattern used for songs to all themes.

<!--- https://app.netlify.com/projects/hangmancipherfunc/overview --->
