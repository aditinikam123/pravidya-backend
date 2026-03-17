/**
 * Chunk document text for RAG: 800–1000 chars per chunk, 150 char overlap.
 */

const DEFAULT_CHUNK_SIZE = 900;
const DEFAULT_OVERLAP = 150;
const MIN_CHUNK_LENGTH = 100;

/**
 * Split text into overlapping chunks for embedding.
 * @param {string} text - Full document text
 * @param {number} [chunkSize] - Target chunk size in characters (default 900, range 800–1000)
 * @param {number} [overlap] - Overlap in characters (default 150)
 * @returns {string[]} Non-empty chunks
 */
export function chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP) {
  if (text == null || typeof text !== 'string') return [];
  const cleaned = text.replace(/\r/g, '\n').trim();
  if (!cleaned) return [];

  const safeOverlap = Math.min(Math.max(0, overlap), chunkSize - 1);
  const chunks = [];
  let start = 0;

  while (start < cleaned.length) {
    let end = Math.min(start + chunkSize, cleaned.length);
    let slice = cleaned.slice(start, end);

    // Prefer breaking at sentence or newline near the end
    if (end < cleaned.length) {
      const lastBreak = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('.\n'),
        slice.lastIndexOf('\n')
      );
      if (lastBreak > chunkSize / 2) {
        slice = slice.slice(0, lastBreak + 1);
        end = start + lastBreak + 1;
      }
    }

    const trimmed = slice.trim();
    if (trimmed.length >= MIN_CHUNK_LENGTH) {
      chunks.push(trimmed);
    }

    if (end >= cleaned.length) break;
    start = end - safeOverlap;
    if (start < 0) start = 0;
  }

  return chunks;
}
