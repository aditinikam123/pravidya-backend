import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../prismaClient.js';
import { generateEmbedding, generateAnswer, generateAnswerStream } from '../utils/geminiClient.js';
import { chunkText } from '../utils/chunkText.js';

const CHUNK_SIZE = 900;
const OVERLAP = 150;
const TOP_K = 30; // retrieve more candidates; we'll keyword-rerank before prompting
const NO_INFO_ANSWER = 'No relevant information found.';
const DOC_ONLY_NO_INFO = 'Information not available in the uploaded documents.';

/** Filler phrases to strip from the start of questions so "tell me about the campus" and "campus" retrieve the same chunks. */
const LEADING_FILLER_PHRASES = [
  'tell me about the ', 'tell me about ', 'tell me ', 'can you tell me about the ', 'can you tell me about ', 'can you tell me ',
  'what is the ', 'what is ', 'what are the ', 'what are ', 'could you tell me ', 'please tell me about the ', 'please tell me about ', 'please tell me ',
  'i want to know about the ', 'i want to know about ', 'i want to know ', 'i would like to know about the ', 'i would like to know about ', 'i would like to know ',
  'describe the ', 'describe ', 'explain the ', 'explain ', 'give me information about the ', 'give me information about ', 'information about the ', 'information about ',
  'tell us about the ', 'tell us about ', 'can you explain the ', 'can you explain ', 'could you explain the ', 'could you explain ',
];

/**
 * Strip leading filler so retrieval is driven by key terms. E.g. "tell me about the campus" → "the campus".
 * Ensures "campus" and "tell me about the campus" produce similar embeddings and same answer.
 */
function coreQueryForRetrieval(query) {
  let q = String(query).trim().toLowerCase();
  for (const phrase of LEADING_FILLER_PHRASES) {
    if (q.startsWith(phrase)) {
      q = q.slice(phrase.length).trim();
      break;
    }
  }
  return q || query.trim();
}

/** Education/school synonym map: query terms → terms that may appear in docs (same meaning). */
const QUERY_SYNONYMS = {
  grades: ['grades', 'classes', 'standards', 'divisions', 'levels', 'year', 'sections'],
  classes: ['classes', 'grades', 'standards', 'divisions', 'levels', 'sections'],
  standards: ['standards', 'grades', 'classes', 'divisions', 'sections'],
  divisions: ['divisions', 'classes', 'grades', 'standards'],
  levels: ['levels', 'grades', 'classes', 'standards'],
  sections: ['sections', 'classes', 'grades', 'divisions'],
  available: ['available', 'offered', 'present', 'running', 'have', 'provide'],
  offered: ['offered', 'available', 'present', 'running', 'provide'],
  present: ['present', 'available', 'offered', 'running'],
  tell: ['tell', 'list', 'what', 'which', 'name', 'mention'],
  list: ['list', 'tell', 'what', 'which', 'name', 'available', 'offered'],
};

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'was',
  'were',
  'be',
  'as',
  'by',
  'at',
  'from',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'what',
  'which',
  'who',
  'whom',
  'when',
  'where',
  'why',
  'how',
]);

function tokenizeQuery(q) {
  const tokens = String(q)
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  if (!tokens) return [];
  return tokens.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Expand tokens with synonyms so "grades" also matches "classes", "standards" in content. */
function tokensWithSynonyms(tokens) {
  const out = new Set(tokens);
  for (const t of tokens) {
    const syns = QUERY_SYNONYMS[t];
    if (syns) syns.forEach((s) => out.add(s));
  }
  return Array.from(out);
}

function keywordHits(content, tokens, useSynonyms = true) {
  if (!content || !tokens?.length) return 0;
  const c = String(content).toLowerCase();
  const terms = useSynonyms ? tokensWithSynonyms(tokens) : tokens;
  let hits = 0;
  for (const t of terms) {
    if (c.includes(t)) hits += 1;
  }
  return hits;
}

/**
 * Get a semantic expansion of the question (rephrases/synonyms) so retrieval is meaning-based.
 * E.g. "grades available" → also "classes offered", "standards present". Used to build a richer query for embedding.
 * @param {string} query
 * @returns {Promise<string>} Original query plus one line of rephrases (or empty on failure)
 */
async function expandQueryForRetrieval(query) {
  if (process.env.INTELLIGENCE_DISABLE_QUERY_EXPANSION === 'true') return query;
  try {
    const prompt = `You are a query expander for a school/academy Q&A system. The user will ask a question. Do two things:
1. If there are any spelling or typo errors (e.g. "greades" → "grades", "clases" → "classes", "Veman" vs "Veeman"), include the correctly spelled version.
2. Add 1-2 short alternative phrasings that mean the SAME thing, using common synonyms in education (e.g. grades = classes = standards, available = offered = present).
Output ONLY the corrected spellings and alternative phrasings on one line, separated by spaces. No numbering, no explanation. Example: if user says "greades avaliable" output something like "grades available classes offered".

User question: ${query}`;
    const rephrases = await generateAnswer(prompt, { temperature: 0.1 });
    const trimmed = String(rephrases).trim().replace(/\n+/g, ' ').slice(0, 400);
    if (trimmed) return `${query} ${trimmed}`;
  } catch (err) {
    console.warn('[intelligence/expandQuery]', err.message);
  }
  return query;
}

/**
 * Train from a knowledge source: chunk text, generate embeddings via Gemini, store in KnowledgeChunk.
 * @param {{ sourceId: string, text: string, organizationId: string }} opts
 * @returns {{ chunksCreated: number }}
 */
export async function trainFromSource({ sourceId, text, organizationId }) {
  const source = await prisma.knowledgeSource.findFirst({
    where: { id: sourceId, organizationId },
  });
  if (!source) {
    throw new Error('Knowledge source not found');
  }

  const chunks = chunkText(text, CHUNK_SIZE, OVERLAP);
  if (chunks.length === 0) {
    return { chunksCreated: 0 };
  }

  let created = 0;
  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i];
    let embedding;
    try {
      embedding = await generateEmbedding(content);
    } catch (err) {
      console.error('[intelligence/train] Gemini embedding failed for chunk', i + 1, err.message);
      throw err;
    }
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Embedding missing or empty for chunk');
    }

    const embeddingStr = '[' + embedding.join(',') + ']';
    const id = crypto.randomUUID();
    const metadata = {};

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO knowledge_chunks (id, "sourceId", "organizationId", content, embedding, metadata, "createdAt")
        VALUES (${id}, ${sourceId}, ${organizationId}, ${content}, ${embeddingStr}::vector, ${JSON.stringify(metadata)}::jsonb, NOW())
      `
    );
    created += 1;
  }

  console.log('[intelligence/train] chunks stored:', created);
  return { chunksCreated: created };
}

/**
 * Query RAG: cache check → embed query → similarity search → generate answer → cache.
 * @param {{ query: string, organizationId: string }}
 * @returns {{ answer: string, fromCache?: boolean }}
 */
export async function queryIntelligence({ query, organizationId }) {
  const normalizedQuery = String(query).trim();
  if (!normalizedQuery) {
    throw new Error('query is required');
  }

  // Step 1: Check QueryCache
  const cached = await prisma.queryCache.findFirst({
    where: { organizationId, query: normalizedQuery },
    orderBy: { createdAt: 'desc' },
  });
  // Don't get stuck returning an old "no info" after retraining or prompt updates
  // Also, only trust cache entries that include Evidence (prevents older "general" cached answers).
  const cachedHasEvidence = cached?.response && /\bEvidence:\s*\n\s*-\s*\".+\"/i.test(cached.response);
  if (cached?.response && cachedHasEvidence && cached.response !== NO_INFO_ANSWER && cached.response !== DOC_ONLY_NO_INFO) {
    return { answer: cached.response, fromCache: true };
  }

  // Step 2: Normalize to key terms (so "tell me about the campus" and "campus" retrieve the same chunks)
  const coreQuery = coreQueryForRetrieval(normalizedQuery);
  // Step 3: Semantic query expansion (so "grades" retrieves content that says "classes")
  const queryForEmbedding = await expandQueryForRetrieval(coreQuery);

  // Step 3: Generate query embedding (use expanded query for meaning-based retrieval)
  let queryEmbedding;
  try {
    queryEmbedding = await generateEmbedding(queryForEmbedding);
  } catch (err) {
    console.error('[intelligence/query] Gemini embedding failed:', err.message);
    throw err;
  }
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    throw new Error('Query embedding missing or empty');
  }

  const embeddingStr = '[' + queryEmbedding.join(',') + ']';

  // Step 4: Similarity search — ORDER BY embedding <=> $1 LIMIT TOP_K, filter by organizationId
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT id, content, (embedding <=> ${embeddingStr}::vector) AS distance
      FROM knowledge_chunks
      WHERE "organizationId" = ${organizationId}
      ORDER BY distance
      LIMIT ${TOP_K}
    `
  );

  let chunks = Array.isArray(rows) ? rows : [];
  const tokens = tokenizeQuery(coreQuery);

  // Keyword rerank with synonyms: "grades" also matches chunks containing "classes", "standards"
  if (tokens.length && chunks.length > 1) {
    chunks = chunks
      .map((r) => {
        const hits = keywordHits(r.content, tokens, true);
        return { ...r, _keywordHits: hits };
      })
      .sort((a, b) => {
        if ((b._keywordHits || 0) !== (a._keywordHits || 0)) return (b._keywordHits || 0) - (a._keywordHits || 0);
        const da = Number(a.distance);
        const db = Number(b.distance);
        if (!Number.isNaN(da) && !Number.isNaN(db)) return da - db;
        return 0;
      });
  }

  // Keyword boost: if query mentions gender/male/female/students, prefer chunks containing those terms so "how many male students" finds Gender Distribution
  const qLower = normalizedQuery.toLowerCase();
  const hasGenderTerms = /\b(male|female|gender|students?|distribution)\b/.test(qLower);
  if (hasGenderTerms && chunks.length > 1) {
    const scored = chunks.map((r) => {
      const c = (r.content || '').toLowerCase();
      let boost = 0;
      if (c.includes('male')) boost += 2;
      if (c.includes('female')) boost += 2;
      if (c.includes('gender')) boost += 2;
      if (c.includes('distribution')) boost += 1;
      return { ...r, boost };
    });
    scored.sort((a, b) => b.boost - a.boost);
    chunks = scored;
  }
  // Send more chunks so answers are grounded in uploaded content (RAG). Override with INTELLIGENCE_MAX_CHUNKS in .env
  const maxChunks = Math.min(Number(process.env.INTELLIGENCE_MAX_CHUNKS) || 10, chunks.length);
  const chunksForPrompt = chunks.slice(0, maxChunks);
  console.log(
    '[intelligence/query] org:',
    organizationId,
    'retrieved:',
    chunks.length,
    'sending:',
    chunksForPrompt.length,
    'topKeywordHits:',
    chunksForPrompt[0]?._keywordHits ?? 'n/a'
  );

  // Step 5: No chunks → return no-info message
  if (chunksForPrompt.length === 0) {
    const answer = NO_INFO_ANSWER;
    return { answer };
  }

  // Step 6: Build strict RAG prompt — answer ONLY from the uploaded document context
  const maxContextChars = Number(process.env.INTELLIGENCE_MAX_CONTEXT_CHARS) || 12_000;
  let contextBlock = chunksForPrompt.map((r) => r.content).join('\n\n');
  if (contextBlock.length > maxContextChars) {
    contextBlock = contextBlock.slice(0, maxContextChars) + '\n[...]';
  }
  const fullPrompt = `You are a RAG assistant. Your ONLY source of information is the "Document content" below, which comes from files uploaded by the admin. You must NOT use any general knowledge or information outside this document.

STRICT RULES:
1. Answer ONLY using facts that appear verbatim or clearly stated in the Document content below.
2. Interpret the question by MEANING, not just exact words: the user may use different words than the document (e.g. "grades" vs "classes", "standards", "divisions"; "available" vs "offered", "present"). Ignore minor spelling or typo errors in the question; match to document content that fits the intent.
3. Do NOT add, infer, or assume anything that is not written in the document.
4. If the document does not contain enough information to answer the question, reply with exactly: "${DOC_ONLY_NO_INFO}"
5. Keep your answer grounded in the document: quote or paraphrase only what the document says.
6. If the question is a topic/heading, summarize the relevant parts from the document.
7. Do not cut off mid-sentence; give a complete answer within the document's scope.
8. You MUST include an Evidence section with 1–3 short direct quotes (verbatim) copied from the Document content. If you cannot find quotes, you MUST return: "${DOC_ONLY_NO_INFO}"

Document content (from uploaded files):
---
${contextBlock}
---

Question: ${normalizedQuery}

Answer format (MUST follow):
Answer: <your answer from the document>
Evidence:
- "<verbatim quote 1>"
- "<verbatim quote 2>"`;

  console.log('[intelligence/query] prompt length:', fullPrompt.length);

  // Step 7: Generate answer via Gemini
  let answer;
  try {
    answer = await generateAnswer(fullPrompt, { temperature: 0.2 });
  } catch (err) {
    console.error('[intelligence/query] Gemini generate failed:', err.message);
    throw err;
  }

  answer = typeof answer === 'string' ? answer.trim() : String(answer);

  // If the model didn't include evidence quotes, treat as not grounded.
  const hasEvidence = /\bEvidence:\s*\n\s*-\s*\".+\"/i.test(answer);
  if (!hasEvidence) {
    answer = DOC_ONLY_NO_INFO;
  }

  // Cache response (avoid caching "no info" so retraining/prompt changes can take effect quickly)
  if (answer && answer !== NO_INFO_ANSWER && answer !== DOC_ONLY_NO_INFO) {
    await prisma.queryCache.create({
      data: { organizationId, query: normalizedQuery, response: answer },
    });
  }

  return { answer };
}

/**
 * Same as queryIntelligence but streams chunks so the client can show progress.
 * Yields text chunks; caches the full answer when done.
 * @param {{ query: string, organizationId: string }}
 * @yields {string} Response text chunks
 */
export async function* queryIntelligenceStream({ query, organizationId }) {
  const normalizedQuery = String(query).trim();
  if (!normalizedQuery) throw new Error('query is required');

  const cached = await prisma.queryCache.findFirst({
    where: { organizationId, query: normalizedQuery },
    orderBy: { createdAt: 'desc' },
  });
  const cachedHasEvidence = cached?.response && /\bEvidence:\s*\n\s*-\s*\".+\"/i.test(cached.response);
  if (cached?.response && cachedHasEvidence && cached.response !== NO_INFO_ANSWER && cached.response !== DOC_ONLY_NO_INFO) {
    yield cached.response;
    return;
  }

  const coreQuery = coreQueryForRetrieval(normalizedQuery);
  const queryForEmbedding = await expandQueryForRetrieval(coreQuery);

  let queryEmbedding;
  try {
    queryEmbedding = await generateEmbedding(queryForEmbedding);
  } catch (err) {
    console.error('[intelligence/query] Gemini embedding failed:', err.message);
    throw err;
  }
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    throw new Error('Query embedding missing or empty');
  }

  const embeddingStr = '[' + queryEmbedding.join(',') + ']';
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT id, content, (embedding <=> ${embeddingStr}::vector) AS distance
      FROM knowledge_chunks
      WHERE "organizationId" = ${organizationId}
      ORDER BY distance
      LIMIT ${TOP_K}
    `
  );

  let chunks = Array.isArray(rows) ? rows : [];
  const tokens = tokenizeQuery(coreQuery);
  if (tokens.length && chunks.length > 1) {
    chunks = chunks
      .map((r) => {
        const hits = keywordHits(r.content, tokens, true);
        return { ...r, _keywordHits: hits };
      })
      .sort((a, b) => {
        if ((b._keywordHits || 0) !== (a._keywordHits || 0)) return (b._keywordHits || 0) - (a._keywordHits || 0);
        const da = Number(a.distance);
        const db = Number(b.distance);
        if (!Number.isNaN(da) && !Number.isNaN(db)) return da - db;
        return 0;
      });
  }
  const qLower = coreQuery.toLowerCase();
  const hasGenderTerms = /\b(male|female|gender|students?|distribution)\b/.test(qLower);
  if (hasGenderTerms && chunks.length > 1) {
    const scored = chunks.map((r) => {
      const c = (r.content || '').toLowerCase();
      let boost = 0;
      if (c.includes('male')) boost += 2;
      if (c.includes('female')) boost += 2;
      if (c.includes('gender')) boost += 2;
      if (c.includes('distribution')) boost += 1;
      return { ...r, boost };
    });
    scored.sort((a, b) => b.boost - a.boost);
    chunks = scored;
  }

  const maxChunks = Math.min(Number(process.env.INTELLIGENCE_MAX_CHUNKS) || 10, chunks.length);
  const chunksForPrompt = chunks.slice(0, maxChunks);

  if (chunksForPrompt.length === 0) {
    const answer = NO_INFO_ANSWER;
    yield answer;
    return;
  }

  const maxContextChars = Number(process.env.INTELLIGENCE_MAX_CONTEXT_CHARS) || 12_000;
  let contextBlock = chunksForPrompt.map((r) => r.content).join('\n\n');
  if (contextBlock.length > maxContextChars) {
    contextBlock = contextBlock.slice(0, maxContextChars) + '\n[...]';
  }
  const fullPrompt = `You are a RAG assistant. Your ONLY source of information is the "Document content" below, which comes from files uploaded by the admin. You must NOT use any general knowledge or information outside this document.

STRICT RULES:
1. Answer ONLY using facts that appear verbatim or clearly stated in the Document content below.
2. Interpret the question by MEANING, not just exact words: the user may use different words than the document (e.g. "grades" vs "classes", "standards", "divisions"; "available" vs "offered", "present"). Ignore minor spelling or typo errors in the question; match to document content that fits the intent.
3. Do NOT add, infer, or assume anything that is not written in the document.
4. If the document does not contain enough information to answer the question, reply with exactly: "${DOC_ONLY_NO_INFO}"
5. Keep your answer grounded in the document: quote or paraphrase only what the document says.
6. If the question is a topic/heading, summarize the relevant parts from the document.
7. Do not cut off mid-sentence; give a complete answer within the document's scope.
8. You MUST include an Evidence section with 1–3 short direct quotes (verbatim) copied from the Document content. If you cannot find quotes, you MUST return: "${DOC_ONLY_NO_INFO}"

Document content (from uploaded files):
---
${contextBlock}
---

Question: ${normalizedQuery}

Answer format (MUST follow):
Answer: <your answer from the document>
Evidence:
- "<verbatim quote 1>"
- "<verbatim quote 2>"`;

  let fullAnswer = '';
  try {
    for await (const chunk of generateAnswerStream(fullPrompt, { temperature: 0.2 })) {
      fullAnswer += chunk;
      yield chunk;
    }
  } catch (err) {
    console.error('[intelligence/query] Gemini stream failed:', err.message);
    throw err;
  }
  fullAnswer = fullAnswer.trim();
  const hasEvidence = /\bEvidence:\s*\n\s*-\s*\".+\"/i.test(fullAnswer);
  if (!hasEvidence) {
    fullAnswer = DOC_ONLY_NO_INFO;
  }
  if (fullAnswer && fullAnswer !== NO_INFO_ANSWER && fullAnswer !== DOC_ONLY_NO_INFO) {
    await prisma.queryCache.create({
      data: { organizationId, query: normalizedQuery, response: fullAnswer },
    });
  }
}
