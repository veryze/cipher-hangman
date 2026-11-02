# SKILL.md
name: generate-phrase
description: Hangman LLM endpoint via Netlify Function (Groq) — themed phrase generation + post-game explanations
version: 1.3.0

tools:
  - name: generate_phrase
    description: Generate a new Hangman phrase using the deployed Netlify Function, with optional theme/difficulty
    parameters:
      type: object
      properties:
        theme:
          type: string
          description: Theme of the phrase (chosen in the menu's Phrase Theme picker). any mixes all types.
          enum: [any, movie, proverb, idiom, song, book]
          default: any
        difficulty:
          type: string
          description: Difficulty of the phrase (chosen in the menu's Phrase Difficulty picker). easy = short/common, normal = default, hard = longer with more unusual letters.
          enum: [easy, normal, hard]
          default: normal
        min_length:
          type: integer
          description: Minimum phrase length in characters (informational; validation allows 10-70)
          minimum: 10
          maximum: 60
          default: 15
        max_length:
          type: integer
          description: Maximum phrase length in characters (informational; validation allows 10-70)
          minimum: 15
          maximum: 70
          default: 60
    required: []
    returns:
      type: object
      properties:
        phrase:
          type: string
          description: The generated phrase (uppercase A-Z and spaces only)
        source:
          type: string
          description: The function endpoint used
      required: [phrase]

# Implementation Notes
# The actual function lives at: netlify/functions/generate-themed-phrase.js
# Deployed endpoint: https://hangman-cipher.netlify.app/.netlify/functions/generate-themed-phrase
# This is the only LLM endpoint in the project (the old generate-phrase.js was removed).
# It serves both modes; the frontend (cipher-hangman.html) falls back to an offline phrase
# bank in the file if a phrase request fails.
#
# To use as a skill tool, the OpenCode runtime would call the deployed function:
#
# async function generate_phrase({ theme, difficulty, min_length, max_length }) {
#   const body = { mode: 'phrase', theme, difficulty, min_length, max_length };
#   Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
#
#   const res = await fetch('https://hangman-cipher.netlify.app/.netlify/functions/generate-themed-phrase', {
#     method: 'POST',
#     headers: { 'Content-Type': 'application/json' },
#     body: JSON.stringify(body),
#   });
#
#   if (!res.ok) {
#     throw new Error(`Function error: ${res.status}`);
#   }
#
#   const data = await res.json();
#   return { phrase: data.phrase, source: 'netlify-function' };
# }
#
# Request body fields (by 'mode' field, default 'phrase'):
# - mode 'phrase': theme (any | movie | proverb | idiom | song | book, unknown values fall
#   back to any) and difficulty (easy | normal | hard, unknown values fall back to normal).
#   The theme/difficulty are appended to the SYSTEM_PROMPT as THEME OVERRIDE and DIFFICULTY
#   lines, and included in the user prompt ("Give me one <theme> phrase, difficulty: <d>").
# - mode 'explain': post-game explanation; needs phrase, cipher, outcome, entropy, surprisal.
#
# Note: SKILL.md files are documentation for OpenCode agents and are NOT deployed or
# executed by Netlify — only the functions in netlify/functions/ run in production.
#
# The Netlify functions already handle:
# - Groq API call (qwen/qwen3.8-27b)
# - Validation (10-70 chars, A-Z + spaces only, 2+ words)
# - Retry logic (3 attempts)
# - CORS headers