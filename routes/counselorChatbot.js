import express from 'express';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCounselor } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import { createEmbedding, generateAnswerFromContext, cosineSimilarity, isAiConfigured } from '../utils/aiClient.js';

const router = express.Router();

const NO_MATCH_MESSAGE = 'This information is not available in the training materials.';
const MIN_SIMILARITY = 0.2;
const TOP_K = 5;

router.post(
  '/chatbot',
  requireCounselor,
  [body('message').trim().notEmpty().withMessage('message is required')],
  asyncHandler(async (req, res) => {
    if (!isAiConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Training Assistant is not configured. Set GEMINI_API_KEY.',
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const message = req.body.message;

    const queryEmbedding = await createEmbedding(message);

    const all = await prisma.trainingEmbedding.findMany({
      take: 300,
      include: {
        trainingModule: { select: { id: true, title: true } },
      },
    });

    const scored = all.map((row) => ({
      ...row,
      similarity: cosineSimilarity(queryEmbedding, row.embeddingVector),
    }));
    scored.sort((a, b) => b.similarity - a.similarity);
    const top = scored.slice(0, TOP_K);
    const best = top[0]?.similarity ?? 0;

    if (top.length === 0 || best < MIN_SIMILARITY) {
      return res.json({
        success: true,
        data: { answer: NO_MATCH_MESSAGE, sources: [] },
      });
    }

    const contextChunks = top.map((t) => ({
      title: t.trainingModule?.title ?? 'Training',
      chunk: t.chunk,
    }));

    const answer = await generateAnswerFromContext({
      question: message,
      contextChunks,
      systemPrompt:
        'You are a Training Assistant. Answer ONLY using the provided training context. Use semantic meaning to address natural, incomplete, or informal questions. If the answer is not in the training context, respond exactly: "This information is not available in the training materials."',
    });

    const finalAnswer =
      answer && /not available in the training materials/i.test(answer)
        ? NO_MATCH_MESSAGE
        : (answer && answer.trim()) || NO_MATCH_MESSAGE;

    const sources = top.map((t) => ({
      title: t.trainingModule?.title ?? 'Training',
      similarity: t.similarity,
    }));

    res.json({
      success: true,
      data: { answer: finalAnswer, sources },
    });
  })
);

export default router;
