# SKILL.md
name: generate-phrase
description: Generate a Hangman phrase via Netlify Function (Groq LLM)
version: 1.0.0

tools:
  - name: generate_phrase
    description: Generate a new Hangman phrase using the deployed Netlify Function
    parameters:
      type: object
      properties:
        category:
          type: string
          description: Optional category hint for the phrase (movie, proverb, idiom, quote, song, book)
          enum: [movie, proverb, idiom, quote, song, book]
        min_length:
          type: integer
          description: Minimum phrase length in characters
          minimum: 10
          maximum: 60
          default: 15
        max_length:
          type: integer
          description: Maximum phrase length in characters
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
# The actual function lives at: netlify/functions/generate-phrase.js
# Deployed endpoint: https://hangman-cipher.netlify.app/.netlify/functions/generate-phrase
# 
# To use as a skill tool, the OpenCode runtime would call the deployed function:
#
# async function generate_phrase({ category, min_length, max_length }) {
#   const params = new URLSearchParams();
#   if (category) params.set('category', category);
#   if (min_length) params.set('min_length', String(min_length));
#   if (max_length) params.set('max_length', String(max_length));
#   
#   const res = await fetch(`https://hangman-cipher.netlify.app/.netlify/functions/generate-phrase?${params}`, {
#     method: 'POST',
#     headers: { 'Content-Type': 'application/json' },
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
# The Netlify function already handles:
# - Groq API call (qwen/qwen3-27b)
# - Validation (15-60 chars, A-Z + spaces only, 2+ words)
# - Retry logic (3 attempts)
# - CORS headers