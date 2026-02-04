import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const router = express.Router();

// @route   POST /api/questions
// @desc    Create a question (Admin, Management)
// @access  Private (Admin, Management)
router.post('/', authenticate, authorize(['ADMIN', 'MANAGEMENT']), [
  body('text').trim().notEmpty().withMessage('Question text is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { text, description, category } = req.body;

  const question = await prisma.question.create({
    data: {
      text,
      description,
      category,
      createdById: req.user.id
    }
  });

  res.status(201).json({
    success: true,
    data: question
  });
}));

// @route   GET /api/questions
// @desc    Get all questions
// @access  Private
router.get('/', authenticate, [
  query('isActive').optional().isBoolean(),
  query('category').optional().trim()
], asyncHandler(async (req, res) => {
  const { isActive, category, page = 1, limit = 20 } = req.query;
  const where = {};

  if (isActive !== undefined) {
    where.isActive = isActive === 'true';
  }
  if (category) {
    where.category = category;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [questions, total] = await Promise.all([
    prisma.question.findMany({
      where,
      include: {
        createdBy: {
          select: {
            username: true,
            email: true
          }
        },
        _count: {
          select: {
            responses: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit)
    }),
    prisma.question.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      questions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

// @route   GET /api/questions/:id
// @desc    Get single question with responses
// @access  Private
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const question = await prisma.question.findUnique({
    where: { id: req.params.id },
    include: {
      createdBy: {
        select: {
          username: true,
          email: true
        }
      },
      responses: {
        include: {
          counselor: {
            include: {
              user: {
                select: {
                  username: true,
                  email: true
                }
              }
            }
          },
          scores: {
            include: {
              createdBy: {
                select: {
                  username: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }
    }
  });

  if (!question) {
    return res.status(404).json({
      success: false,
      message: 'Question not found'
    });
  }

  res.json({
    success: true,
    data: question
  });
}));

// @route   PUT /api/questions/:id
// @desc    Update question
// @access  Private (Admin, Management)
router.put('/:id', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const question = await prisma.question.update({
    where: { id: req.params.id },
    data: req.body
  });

  res.json({
    success: true,
    data: question
  });
}));

// @route   POST /api/questions/:id/responses
// @desc    Submit response to question (Counselor)
// @access  Private (Counselor)
router.post('/:id/responses', authenticate, authorize('COUNSELOR'), [
  body('answer').trim().notEmpty().withMessage('Answer is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { answer, sessionId, leadId, context } = req.body;
  const counselorId = req.user.counselorProfile.id;

  const response = await prisma.response.create({
    data: {
      questionId: req.params.id,
      counselorId,
      sessionId: sessionId || null,
      leadId: leadId || null,
      answer,
      context: context || null
    },
    include: {
      question: true,
      counselor: {
        include: {
          user: {
            select: {
              username: true,
              email: true
            }
          }
        }
      }
    }
  });

  res.status(201).json({
    success: true,
    data: response
  });
}));

// @route   POST /api/responses/:id/scores
// @desc    Add score to response (Admin, Management)
// @access  Private (Admin, Management)
router.post('/responses/:id/scores', authenticate, authorize(['ADMIN', 'MANAGEMENT']), [
  body('points').isInt().withMessage('Points must be an integer'),
  body('category').optional().trim()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { points, category, notes } = req.body;

  const score = await prisma.score.create({
    data: {
      responseId: req.params.id,
      points,
      category,
      notes,
      createdById: req.user.id
    },
    include: {
      response: {
        include: {
          question: true,
          counselor: {
            include: {
              user: {
                select: {
                  username: true,
                  email: true
                }
              }
            }
          }
        }
      }
    }
  });

  res.status(201).json({
    success: true,
    data: score
  });
}));

// @route   GET /api/counselors/:id/responses
// @desc    Get all responses by counselor
// @access  Private
router.get('/counselors/:id/responses', authenticate, asyncHandler(async (req, res) => {
  const responses = await prisma.response.findMany({
    where: {
      counselorId: req.params.id
    },
    include: {
      question: true,
      scores: {
        include: {
          createdBy: {
            select: {
              username: true
            }
          }
        }
      },
      session: {
        select: {
          id: true,
          scheduledDate: true
        }
      },
      lead: {
        select: {
          id: true,
          studentName: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  // Calculate total score
  const totalScore = responses.reduce((sum, response) => {
    return sum + response.scores.reduce((s, score) => s + score.points, 0);
  }, 0);

  res.json({
    success: true,
    data: {
      responses,
      totalScore
    }
  });
}));

// @route   DELETE /api/questions/:id
// @desc    Delete question (soft delete)
// @access  Private (Admin, Management)
router.delete('/:id', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  await prisma.question.update({
    where: { id: req.params.id },
    data: { isActive: false }
  });

  res.json({
    success: true,
    message: 'Question deactivated successfully'
  });
}));

export default router;
