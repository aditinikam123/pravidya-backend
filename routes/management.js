import express from 'express';
import { query } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import * as presenceService from '../services/presenceTracking.js';

const router = express.Router();

// @route   GET /api/management/dashboard
// @desc    Get management dashboard overview
// @access  Private (Admin, Management)
router.get('/dashboard', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get attendance stats
  const attendance = await presenceService.getDailyAttendance(today);
  const absentCounselors = await presenceService.getAbsentCounselors(today);
  const activeCounselors = await presenceService.getActiveCounselors();

  // Get presence status breakdown
  const presenceStats = await prisma.counselorPresence.groupBy({
    by: ['status'],
    _count: {
      status: true
    }
  });

  // Get inactivity alerts (counselors away > 15 min or offline > 30 min)
  const awayCounselors = await prisma.counselorPresence.findMany({
    where: {
      status: 'AWAY'
    },
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
      }
    }
  });

  const offlineCounselors = await prisma.counselorPresence.findMany({
    where: {
      status: 'OFFLINE'
    },
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
      }
    }
  });

  // Get appointment reassignment needs
  const sessionsNeedingReassignment = await prisma.counselingSession.findMany({
    where: {
      status: 'CANCELLED',
      remarks: {
        contains: 'requires reassignment'
      },
      scheduledDate: {
        gte: today
      }
    },
    include: {
      lead: {
        select: {
          id: true,
          studentName: true,
          parentName: true,
          parentMobile: true
        }
      },
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

  // Get training completion stats
  const trainingStats = await prisma.trainingProgress.groupBy({
    by: ['status'],
    _count: {
      status: true
    }
  });

  // Get question-response stats
  const totalQuestions = await prisma.question.count({
    where: { isActive: true }
  });

  const totalResponses = await prisma.response.count();
  const totalScores = await prisma.score.aggregate({
    _sum: {
      points: true
    }
  });

  res.json({
    success: true,
    data: {
      attendance: {
        present: attendance.length,
        absent: absentCounselors.length,
        active: activeCounselors.length
      },
      presence: {
        active: presenceStats.find(s => s.status === 'ACTIVE')?._count.status || 0,
        away: presenceStats.find(s => s.status === 'AWAY')?._count.status || 0,
        offline: presenceStats.find(s => s.status === 'OFFLINE')?._count.status || 0
      },
      alerts: {
        awayCounselors: awayCounselors.map(c => ({
          id: c.counselorId,
          name: c.counselor.fullName,
          username: c.counselor.user.username,
          lastActivity: c.lastActivityAt,
          inactiveMinutes: c.lastActivityAt 
            ? Math.floor((new Date() - new Date(c.lastActivityAt)) / (1000 * 60))
            : 0
        })),
        offlineCounselors: offlineCounselors.map(c => ({
          id: c.counselorId,
          name: c.counselor.fullName,
          username: c.counselor.user.username,
          lastActivity: c.lastActivityAt
        }))
      },
      reassignments: {
        count: sessionsNeedingReassignment.length,
        sessions: sessionsNeedingReassignment
      },
      training: {
        notStarted: trainingStats.find(s => s.status === 'NOT_STARTED')?._count.status || 0,
        inProgress: trainingStats.find(s => s.status === 'IN_PROGRESS')?._count.status || 0,
        completed: trainingStats.find(s => s.status === 'COMPLETED')?._count.status || 0
      },
      questions: {
        total: totalQuestions,
        responses: totalResponses,
        totalScore: totalScores._sum.points || 0
      }
    }
  });
}));

// @route   GET /api/management/attendance-report
// @desc    Get attendance report
// @access  Private (Admin, Management)
router.get('/attendance-report', authenticate, authorize(['ADMIN', 'MANAGEMENT']), [
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
], asyncHandler(async (req, res) => {
  const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date();
  startDate.setHours(0, 0, 0, 0);

  const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
  endDate.setHours(23, 59, 59, 999);

  const attendance = await prisma.dailyAttendance.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate
      }
    },
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
      }
    },
    orderBy: {
      date: 'desc'
    }
  });

  // Group by counselor
  const report = attendance.reduce((acc, record) => {
    const counselorId = record.counselorId;
    if (!acc[counselorId]) {
      acc[counselorId] = {
        counselor: record.counselor,
        days: [],
        totalActiveMinutes: 0,
        presentDays: 0,
        absentDays: 0
      };
    }

    acc[counselorId].days.push({
      date: record.date,
      loginTime: record.loginTime,
      logoutTime: record.logoutTime,
      activeMinutes: record.activeMinutes,
      status: record.status
    });

    acc[counselorId].totalActiveMinutes += record.activeMinutes;
    if (record.status === 'PRESENT' || record.status === 'PARTIAL') {
      acc[counselorId].presentDays++;
    } else {
      acc[counselorId].absentDays++;
    }

    return acc;
  }, {});

  res.json({
    success: true,
    data: {
      period: {
        startDate,
        endDate
      },
      report: Object.values(report)
    }
  });
}));

// @route   GET /api/management/released-appointments
// @desc    Get appointments requiring reassignment
// @access  Private (Admin, Management)
router.get('/released-appointments', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get cancelled sessions that need reassignment
  const releasedSessions = await prisma.counselingSession.findMany({
    where: {
      status: 'CANCELLED',
      remarks: {
        contains: 'requires reassignment'
      },
      scheduledDate: {
        gte: today
      }
    },
    include: {
      lead: {
        select: {
          id: true,
          leadId: true,
          studentName: true,
          parentName: true,
          parentMobile: true,
          parentEmail: true,
          course: {
            select: {
              name: true
            }
          },
          institution: {
            select: {
              name: true
            }
          }
        }
      },
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
    },
    orderBy: {
      scheduledDate: 'asc'
    }
  });

  // Also get unassigned leads (released from offline counselors)
  const unassignedLeads = await prisma.lead.findMany({
    where: {
      assignedCounselorId: null,
      status: 'NEW',
      submittedAt: {
        gte: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
      }
    },
    include: {
      course: {
        select: {
          name: true
        }
      },
      institution: {
        select: {
          name: true
        }
      }
    },
    orderBy: {
      submittedAt: 'desc'
    },
    take: 50
  });

  res.json({
    success: true,
    data: {
      releasedSessions,
      unassignedLeads,
      total: releasedSessions.length + unassignedLeads.length
    }
  });
}));

// @route   POST /api/management/reassign-appointment
// @desc    Reassign appointment to another counselor
// @access  Private (Admin, Management)
router.post('/reassign-appointment', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const { sessionId, newCounselorId } = req.body;

  if (!sessionId || !newCounselorId) {
    return res.status(400).json({
      success: false,
      message: 'sessionId and newCounselorId are required'
    });
  }

  const session = await prisma.counselingSession.findUnique({
    where: { id: sessionId },
    include: {
      lead: true
    }
  });

  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session not found'
    });
  }

  // Update session and lead
  const updated = await prisma.$transaction(async (tx) => {
    // Update session
    const updatedSession = await tx.counselingSession.update({
      where: { id: sessionId },
      data: {
        counselorId: newCounselorId,
        status: 'SCHEDULED',
        remarks: `Reassigned from ${session.counselorId} to ${newCounselorId}`
      }
    });

    // Update lead assignment
    await tx.lead.update({
      where: { id: session.leadId },
      data: {
        assignedCounselorId: newCounselorId,
        autoAssigned: false
      }
    });

    return updatedSession;
  });

  res.json({
    success: true,
    data: updated,
    message: 'Appointment reassigned successfully'
  });
}));

// @route   GET /api/management/counselor-performance
// @desc    Get counselor performance metrics
// @access  Private (Admin, Management)
router.get('/counselor-performance', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const counselorId = req.query.counselorId;

  if (!counselorId) {
    return res.status(400).json({
      success: false,
      message: 'counselorId is required'
    });
  }

  // Get counselor stats
  const counselor = await prisma.counselorProfile.findUnique({
    where: { id: counselorId },
    include: {
      user: {
        select: {
          username: true,
          email: true
        }
      },
      presence: true,
      assignedLeads: {
        select: {
          status: true
        }
      },
      sessions: {
        select: {
          status: true
        }
      },
      trainingProgress: {
        include: {
          module: {
            select: {
              title: true
            }
          }
        }
      },
      responses: {
        include: {
          question: {
            select: {
              text: true
            }
          },
          scores: true
        }
      }
    }
  });

  if (!counselor) {
    return res.status(404).json({
      success: false,
      message: 'Counselor not found'
    });
  }

  // Calculate metrics
  const totalLeads = counselor.assignedLeads.length;
  const enrolledLeads = counselor.assignedLeads.filter(l => l.status === 'ENROLLED').length;
  const totalSessions = counselor.sessions.length;
  const completedSessions = counselor.sessions.filter(s => s.status === 'COMPLETED').length;
  
  const totalScore = counselor.responses.reduce((sum, response) => {
    return sum + response.scores.reduce((s, score) => s + score.points, 0);
  }, 0);

  const trainingCompleted = counselor.trainingProgress.filter(t => t.status === 'COMPLETED').length;
  const trainingTotal = counselor.trainingProgress.length;

  res.json({
    success: true,
    data: {
      counselor: {
        id: counselor.id,
        name: counselor.fullName,
        username: counselor.user.username,
        email: counselor.user.email
      },
      metrics: {
        leads: {
          total: totalLeads,
          enrolled: enrolledLeads,
          conversionRate: totalLeads > 0 ? (enrolledLeads / totalLeads * 100).toFixed(2) : 0
        },
        sessions: {
          total: totalSessions,
          completed: completedSessions,
          completionRate: totalSessions > 0 ? (completedSessions / totalSessions * 100).toFixed(2) : 0
        },
        training: {
          completed: trainingCompleted,
          total: trainingTotal,
          completionRate: trainingTotal > 0 ? (trainingCompleted / trainingTotal * 100).toFixed(2) : 0
        },
        scoring: {
          totalScore,
          averageScore: counselor.responses.length > 0 
            ? (totalScore / counselor.responses.length).toFixed(2) 
            : 0,
          totalResponses: counselor.responses.length
        },
        presence: {
          status: counselor.presence?.status || 'OFFLINE',
          activeMinutesToday: counselor.presence?.activeMinutesToday || 0,
          totalActiveMinutes: counselor.presence?.totalActiveMinutes || 0,
          lastLoginAt: counselor.presence?.lastLoginAt
        }
      }
    }
  });
}));

export default router;
