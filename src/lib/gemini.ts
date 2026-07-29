/**
 * MESH Platform — Google Gen AI (Gemini) client.
 *
 * Wraps `@google/genai` for the PDR vision engine. The client is memoized and
 * initialized lazily so importing this module never throws at build time; the
 * missing-key error surfaces only when the model is actually invoked.
 */
import { GoogleGenAI } from '@google/genai';

/** Model id used across the MESH vision engine. */
export const GEMINI_MODEL = 'gemini-2.0-flash' as const;

export class GeminiConfigError extends Error {
  constructor() {
    super('Missing environment variable: GEMINI_API_KEY.');
    this.name = 'GeminiConfigError';
  }
}

let client: GoogleGenAI | undefined;

/**
 * Returns a memoized GoogleGenAI client.
 * @throws {GeminiConfigError} when GEMINI_API_KEY is not set.
 */
export function getGeminiClient(): GoogleGenAI {
  if (client) return client;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiConfigError();

  client = new GoogleGenAI({ apiKey });
  return client;
}

// Re-export the schema Type enum so callers can build responseSchema configs
// without importing `@google/genai` directly.
export { Type } from '@google/genai';
