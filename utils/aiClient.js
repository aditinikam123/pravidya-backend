import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('⚠️ GEMINI_API_KEY is not set. Training Assistant chatbot will be disabled.');
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';

export const isAiConfigured = () => Boolean(genAI);

export const createEmbedding = async (input) => {
  if (!genAI) throw new Error('AI not configured. Set GEMINI_API_KEY.');
  const text = typeof input === 'string' ? input : String(input);
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(text);
  return result.embedding?.values ?? [];
};

export const generateAnswerFromContext = async ({ question, contextChunks, systemPrompt }) => {
  if (!genAI) throw new Error('AI not configured. Set GEMINI_API_KEY.');
  const contextText = contextChunks
    .map((c, i) => `Source ${i + 1} — ${c.title}:\n${c.chunk}`)
    .join('\n\n');
  const prompt =
    (systemPrompt ||
      'Answer ONLY using the provided training context. If the answer is not in the context, say: "This information is not available in the training materials."') +
    `\n\nTraining context:\n${contextText}\n\nQuestion: ${question}`;
  const model = genAI.getGenerativeModel({ model: CHAT_MODEL });
  const result = await model.generateContent(prompt);
  const text = result.response?.text?.();
  return (text && text.trim()) || '';
};

export const cosineSimilarity = (a, b) => {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};
