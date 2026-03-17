import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { prisma } from '../prisma/client.js';
import { createEmbedding } from '../utils/aiClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaTraining = path.join(__dirname, '..', 'media', 'training');

let pdfParse, mammoth;
try {
  pdfParse = (await import('pdf-parse')).default;
} catch {
  pdfParse = null;
}
try {
  mammoth = (await import('mammoth')).default;
} catch {
  mammoth = null;
}

function normalizeText(t) {
  return (t || '').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
}

function chunkText(text, maxWords = 600, overlapWords = 80) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += Math.max(1, maxWords - overlapWords)) {
    const slice = words.slice(i, i + maxWords);
    if (slice.length) chunks.push(slice.join(' '));
  }
  return chunks;
}

async function extractTextFromModule(module) {
  const url = module.fileUrl || module.contentUrl || module.documentUrl || module.videoUrl || '';
  const fallback = normalizeText([module.title, module.description].filter(Boolean).join('\n'));

  if (module.contentType === 'LINK' || !url || typeof url !== 'string') {
    return fallback || module.title || '';
  }

  if (!url.startsWith('/media/') && !url.includes('media/training')) {
    return fallback;
  }

  const filename = path.basename(url.replace(/^\//, ''));
  const filePath = path.join(mediaTraining, filename);

  try {
    await fs.access(filePath);
  } catch {
    return fallback;
  }

  const buf = await fs.readFile(filePath);
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.pdf' && pdfParse) {
    try {
      const data = await pdfParse(buf);
      return normalizeText(data?.text) || fallback;
    } catch (e) {
      console.warn('pdf-parse failed', e?.message);
      return fallback;
    }
  }

  if ((ext === '.doc' || ext === '.docx') && mammoth) {
    try {
      const result = await mammoth.extractRawText({ buffer: buf });
      return normalizeText(result?.value) || fallback;
    } catch (e) {
      console.warn('mammoth failed', e?.message);
      return fallback;
    }
  }

  try {
    return normalizeText(buf.toString('utf8')) || fallback;
  } catch {
    return fallback;
  }
}

export async function embedTrainingModule(trainingModuleId) {
  const module = await prisma.trainingModule.findUnique({
    where: { id: trainingModuleId },
  });
  if (!module) throw new Error('Training module not found');

  const text = await extractTextFromModule(module);
  if (!text) throw new Error('No text to embed for this module');

  const chunks = chunkText(text, 600, 80);
  await prisma.trainingEmbedding.deleteMany({ where: { trainingModuleId } });

  for (const chunk of chunks) {
    const vector = await createEmbedding(chunk);
    await prisma.trainingEmbedding.create({
      data: {
        trainingModuleId,
        chunk,
        embeddingVector: vector,
      },
    });
  }

  return { trainingModuleId, chunksCreated: chunks.length };
}
