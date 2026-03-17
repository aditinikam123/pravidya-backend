/**
 * Gemini client for embeddings and answer generation.
 * Drop-in replacement for ollamaClient: same API (generateEmbedding, generateAnswer, generateAnswerStream).
 * Uses @google/generative-ai and env: GEMINI_API_KEY, GEMINI_EMBEDDING_MODEL, GEMINI_CHAT_MODEL.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// Read at module load; for correct .env values ensure server calls dotenv.config() before importing routes
const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const TARGET_DIM = 1536; // pgvector schema vector(1536)

function getEmbeddingModel() {
  return process.env.GEMINI_EMBEDDING_MODEL || 'embedding-001';
}

function getChatModel() {
  // Use env if set; otherwise gemini-2.5-flash (v1beta). Do not use gemini-1.5-flash (not found).
  const model = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';
  return model;
}

/**
 * Generate embedding for text via Gemini embedContent.
 * Normalizes to 1536 dimensions for pgvector compatibility.
 * @param {string} text - Input text
 * @returns {Promise<number[]>} Embedding vector
 */
export async function generateEmbedding(text) {
  if (text == null || String(text).trim() === '') {
    throw new Error('generateEmbedding: text is required and must be non-empty');
  }
  if (!genAI) {
    throw new Error('Gemini not configured. Set GEMINI_API_KEY in .env.');
  }

  const model = genAI.getGenerativeModel({ model: getEmbeddingModel() });
  let result;
  try {
    result = await model.embedContent(String(text).trim());
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('API key') || msg.includes('400') || msg.includes('401')) {
      throw new Error('Gemini API key is invalid or missing. Set a valid GEMINI_API_KEY in backend/.env (get one at https://aistudio.google.com/app/apikey).');
    }
    throw err;
  }
  let embedding = result.embedding?.values;
  if (!Array.isArray(embedding)) {
    throw new Error('Gemini embeddings: embedding.values missing or not an array');
  }

  if (embedding.length !== TARGET_DIM) {
    if (embedding.length < TARGET_DIM) {
      embedding = [...embedding, ...new Array(TARGET_DIM - embedding.length).fill(0)];
    } else {
      embedding = embedding.slice(0, TARGET_DIM);
    }
  }

  console.log('[gemini] embedding length:', embedding.length);
  return embedding;
}

/**
 * Generate answer from a single prompt via Gemini generateContent.
 * @param {string} prompt - Full prompt
 * @param {{ model?: string, temperature?: number }} [opts] - Optional; temperature supported
 * @returns {Promise<string>} Response text
 */
export async function generateAnswer(prompt, opts = {}) {
  if (prompt == null || String(prompt).trim() === '') {
    throw new Error('generateAnswer: prompt is required and must be non-empty');
  }
  if (!genAI) {
    throw new Error('Gemini not configured. Set GEMINI_API_KEY in .env.');
  }

  const maxTokens = opts.num_predict ?? (Number(process.env.INTELLIGENCE_MAX_OUTPUT_TOKENS) || 1024);
  const modelName = opts.model || getChatModel();
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: maxTokens,
    },
  });

  let result;
  try {
    result = await model.generateContent(String(prompt).trim());
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('API key') || msg.includes('400') || msg.includes('401')) {
      throw new Error('Gemini API key is invalid or missing. Set a valid GEMINI_API_KEY in backend/.env (get one at https://aistudio.google.com/app/apikey).');
    }
    throw err;
  }
  const text = result.response?.text?.();
  if (text == null) {
    throw new Error('Gemini generate: empty or blocked response');
  }
  return typeof text === 'string' ? text : String(text);
}

/**
 * Stream answer from Gemini so the client can show text as it arrives.
 * @param {string} prompt - Full prompt
 * @param {{ model?: string, temperature?: number, num_predict?: number }} [opts]
 * @yields {string} Partial response chunks
 */
export async function* generateAnswerStream(prompt, opts = {}) {
  if (prompt == null || String(prompt).trim() === '') {
    throw new Error('generateAnswerStream: prompt is required');
  }
  if (!genAI) {
    throw new Error('Gemini not configured. Set GEMINI_API_KEY in .env.');
  }

  const maxTokens = opts.num_predict ?? (Number(process.env.INTELLIGENCE_MAX_OUTPUT_TOKENS) || 1024);
  const modelName = opts.model || getChatModel();
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: maxTokens,
    },
  });

  let stream;
  try {
    const res = await model.generateContentStream(String(prompt).trim());
    stream = res.stream;
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('API key') || msg.includes('400') || msg.includes('401')) {
      throw new Error('Gemini API key is invalid or missing. Set a valid GEMINI_API_KEY in backend/.env (get one at https://aistudio.google.com/app/apikey).');
    }
    throw err;
  }
  for await (const chunk of stream) {
    try {
      const t = chunk.text?.();
      if (t) yield t;
    } catch (_) {}
  }
}
