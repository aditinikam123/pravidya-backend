/**
 * Ollama client for embeddings and answer generation.
 * Uses fetch (no SDK). Base URL: http://localhost:11434
 */

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBED_TIMEOUT_MS = Number(process.env.OLLAMA_EMBED_TIMEOUT_MS) || 60_000;
// Generate can be slow when llama3 is cold or on weaker hardware; default 5 min (set OLLAMA_GENERATE_TIMEOUT_MS in .env to override)
const GENERATE_TIMEOUT_MS = Number(process.env.OLLAMA_GENERATE_TIMEOUT_MS) || 300_000;
// Max tokens to generate; lower = faster (set OLLAMA_NUM_PREDICT in .env; default 80 for speed)
const NUM_PREDICT = Number(process.env.OLLAMA_NUM_PREDICT) || 80;
// Chat model; use phi3:mini or llama3.2:3b for much faster replies (ollama pull phi3:mini)
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'llama3';

/**
 * Generate embedding for text via Ollama POST /api/embed.
 * Uses model "nomic-embed-text". Response must contain embedding array.
 * @param {string} text - Input text
 * @returns {Promise<number[]>} Embedding vector (normalized to 1536 dims for pgvector if needed)
 */
export async function generateEmbedding(text) {
  if (text == null || String(text).trim() === '') {
    throw new Error('generateEmbedding: text is required and must be non-empty');
  }

  const url = `${OLLAMA_BASE}/api/embed`;
  const body = {
    model: 'nomic-embed-text',
    input: String(text).trim(),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama embeddings failed (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    if (data == null) {
      throw new Error('Ollama embeddings: empty response');
    }

    // Support both single-embedding response { embedding: [...] } and array response
    let embedding = Array.isArray(data.embeddings) ? data.embeddings[0] : data.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error('Ollama embeddings: embedding missing or not an array');
    }

    // pgvector schema is vector(1536); normalize length without changing schema
    const targetDim = 1536;
    if (embedding.length !== targetDim) {
      if (embedding.length < targetDim) {
        embedding = [...embedding, ...new Array(targetDim - embedding.length).fill(0)];
      } else {
        embedding = embedding.slice(0, targetDim);
      }
    }

    console.log('[ollama] embedding length:', embedding.length);
    return embedding;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Ollama embeddings timeout after ${EMBED_TIMEOUT_MS}ms`);
    }
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
      throw new Error(
        `Cannot reach Ollama at ${OLLAMA_BASE}. Start Ollama (e.g. run "ollama serve" or open the Ollama app) and ensure nomic-embed-text is pulled ("ollama pull nomic-embed-text").`
      );
    }
    throw err;
  }
}

/**
 * Generate answer from a single prompt via Ollama POST /api/generate.
 * @param {string} prompt - Full prompt (e.g. system + context + question)
 * @param {{ model?: string, temperature?: number }} [opts] - Optional model and temperature
 * @returns {Promise<string>} response.response
 */
export async function generateAnswer(prompt, opts = {}) {
  if (prompt == null || String(prompt).trim() === '') {
    throw new Error('generateAnswer: prompt is required and must be non-empty');
  }

  const url = `${OLLAMA_BASE}/api/generate`;
  const body = {
    model: opts.model || CHAT_MODEL,
    prompt: String(prompt).trim(),
    stream: false,
    options: {
      temperature: opts.temperature ?? 0.2,
      num_predict: opts.num_predict ?? NUM_PREDICT,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama generate failed (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    if (data == null) {
      throw new Error('Ollama generate: empty response');
    }

    const answer = data.response;
    if (answer == null) {
      throw new Error('Ollama generate: response.response missing');
    }
    return typeof answer === 'string' ? answer : String(answer);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Ollama generate timeout after ${GENERATE_TIMEOUT_MS}ms`);
    }
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
      throw new Error(
        `Cannot reach Ollama at ${OLLAMA_BASE}. Start Ollama and ensure llama3 is pulled ("ollama pull llama3").`
      );
    }
    throw err;
  }
}

/**
 * Stream answer from Ollama so the client can show text as it arrives.
 * @param {string} prompt - Full prompt
 * @param {{ model?: string, temperature?: number, num_predict?: number }} [opts]
 * @yields {string} Partial response chunks
 */
export async function* generateAnswerStream(prompt, opts = {}) {
  if (prompt == null || String(prompt).trim() === '') {
    throw new Error('generateAnswerStream: prompt is required');
  }

  const url = `${OLLAMA_BASE}/api/generate`;
  const body = {
    model: opts.model || CHAT_MODEL,
    prompt: String(prompt).trim(),
    stream: true,
    options: {
      temperature: opts.temperature ?? 0.2,
      num_predict: opts.num_predict ?? NUM_PREDICT,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama generate failed (${res.status}): ${errText || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.response) yield data.response;
        } catch (_) {}
      }
    }
  } finally {
    reader.releaseLock();
  }
}
