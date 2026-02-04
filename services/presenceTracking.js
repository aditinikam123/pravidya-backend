import { prisma } from '../prisma/client.js';

/**
 * Presence Tracking Service
 * Handles counselor login, activity tracking, and status management
 */

// Validate Prisma client is available
if (!prisma) {
  console.error('❌ ERROR: Prisma client is not initialized in presenceTracking.js');
  throw new Error('Prisma client is not available');
}

if (!prisma.counselorPresence) {
  console.error('❌ ERROR: counselorPresence model not found in Prisma client');
  console.error('Available models:', Object.keys(prisma).filter(key => !key.startsWith('$')));
  throw new Error('CounselorPresence model not found in Prisma client. Run: npm run prisma:generate');
}

// Update counselor presence on login
export const recordLogin = async (counselorId) => {
  try {
    const now = new Date();
    
    // Get or create presence record
    let presence = await prisma.counselorPresence.findUnique({
      where: { counselorId }
    });

  if (!presence) {
    presence = await prisma.counselorPresence.create({
      data: {
        counselorId,
        lastLoginAt: now,
        lastActivityAt: now,
        status: 'ACTIVE',
        activeMinutesToday: 0
      }
    });
  } else {
    presence = await prisma.counselorPresence.update({
      where: { counselorId },
      data: {
        lastLoginAt: now,
        lastActivityAt: now,
        status: 'ACTIVE',
        lastStatusChange: now
      }
    });
  }

  // Update daily attendance
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  await prisma.dailyAttendance.upsert({
    where: {
      counselorId_date: {
        counselorId,
        date: today
      }
    },
    create: {
      counselorId,
      presenceId: presence.id,
      date: today,
      loginTime: now,
      status: 'PRESENT',
      activeMinutes: 0
    },
    update: {
      loginTime: now,
      status: 'PRESENT'
    }
  });

    return presence;
  } catch (error) {
    console.error('❌ Error in recordLogin:', error);
    console.error('Prisma client state:', {
      isDefined: !!prisma,
      hasCounselorPresence: !!prisma?.counselorPresence,
      availableModels: prisma ? Object.keys(prisma).filter(key => !key.startsWith('$')) : []
    });
    throw error;
  }
};

// Update last activity timestamp (heartbeat)
export const updateActivity = async (counselorId) => {
  const now = new Date();
  
  const presence = await prisma.counselorPresence.findUnique({
    where: { counselorId }
  });

  if (!presence) {
    return null;
  }

  // If status is OFFLINE, don't update
  if (presence.status === 'OFFLINE') {
    return presence;
  }

  // Check if was AWAY and should become ACTIVE
  let newStatus = presence.status;
  if (presence.status === 'AWAY') {
    newStatus = 'ACTIVE';
  }

  // Calculate active minutes increment
  const lastActivity = new Date(presence.lastActivityAt || presence.lastLoginAt);
  const minutesSinceLastActivity = Math.floor((now - lastActivity) / (1000 * 60));
  
  // Only count minutes if status is ACTIVE (not AWAY)
  const activeMinutesIncrement = presence.status === 'ACTIVE' && minutesSinceLastActivity <= 5 
    ? Math.min(minutesSinceLastActivity, 5) // Cap at 5 minutes per heartbeat
    : 0;

  const updatedActiveMinutes = presence.activeMinutesToday + activeMinutesIncrement;

  return await prisma.counselorPresence.update({
    where: { counselorId },
    data: {
      lastActivityAt: now,
      status: newStatus,
      lastStatusChange: newStatus !== presence.status ? now : presence.lastStatusChange,
      activeMinutesToday: updatedActiveMinutes,
      totalActiveMinutes: (presence.totalActiveMinutes || 0) + activeMinutesIncrement
    }
  });
};

// Mark counselor as away (inactive > 15 minutes)
export const markAsAway = async (counselorId) => {
  const presence = await prisma.counselorPresence.findUnique({
    where: { counselorId }
  });

  if (!presence || presence.status === 'OFFLINE') {
    return null;
  }

  if (presence.status !== 'AWAY') {
    return await prisma.counselorPresence.update({
      where: { counselorId },
      data: {
        status: 'AWAY',
        lastStatusChange: new Date()
      }
    });
  }

  return presence;
};

// Mark counselor as offline (inactive > 30 minutes)
export const markAsOffline = async (counselorId) => {
  const presence = await prisma.counselorPresence.findUnique({
    where: { counselorId }
  });

  if (!presence) {
    return null;
  }

  if (presence.status !== 'OFFLINE') {
    // Calculate active minutes before going offline
    const activeMinutes = await calculateActiveMinutes(counselorId, presence);
    
    await prisma.counselorPresence.update({
      where: { counselorId },
      data: {
        status: 'OFFLINE',
        lastStatusChange: new Date(),
        activeMinutesToday: activeMinutes
      }
    });

    // Update daily attendance
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    await prisma.dailyAttendance.updateMany({
      where: {
        counselorId,
        date: today
      },
      data: {
        logoutTime: new Date(),
        activeMinutes: activeMinutes,
        status: 'PARTIAL'
      }
    });

    // Release appointments if needed
    await releaseAppointments(counselorId);
  }

  return presence;
};

// Calculate active minutes for today
const calculateActiveMinutes = async (counselorId, presence) => {
  if (!presence.lastLoginAt || !presence.lastActivityAt) {
    return 0;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const loginTime = new Date(presence.lastLoginAt);
  const activityTime = new Date(presence.lastActivityAt);
  
  // Only count minutes from today
  if (loginTime < today) {
    loginTime.setTime(today.getTime());
  }

  const diffMs = activityTime - loginTime;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  
  return Math.max(0, diffMinutes);
};

// Release appointments for offline counselor
const releaseAppointments = async (counselorId) => {
  const now = new Date();
  const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);

  // Find upcoming sessions in next 30 minutes
  const upcomingSessions = await prisma.counselingSession.findMany({
    where: {
      counselorId,
      status: 'SCHEDULED',
      scheduledDate: {
        lte: thirtyMinutesFromNow
      }
    },
    include: {
      lead: true
    }
  });

  // Mark sessions for reassignment
  for (const session of upcomingSessions) {
    await prisma.counselingSession.update({
      where: { id: session.id },
      data: {
        status: 'CANCELLED',
        remarks: 'Counselor went offline - requires reassignment'
      }
    });

    // Update lead to allow reassignment
    await prisma.lead.update({
      where: { id: session.leadId },
      data: {
        assignedCounselorId: null,
        autoAssigned: false,
        status: 'NEW'
      }
    });
  }
};

// Check and update status based on inactivity
export const checkInactivity = async (counselorId) => {
  const presence = await prisma.counselorPresence.findUnique({
    where: { counselorId }
  });

  if (!presence || presence.status === 'OFFLINE') {
    return presence;
  }

  const now = new Date();
  const lastActivity = new Date(presence.lastActivityAt || presence.lastLoginAt);
  const inactiveMinutes = Math.floor((now - lastActivity) / (1000 * 60));

  if (inactiveMinutes > 30) {
    return await markAsOffline(counselorId);
  } else if (inactiveMinutes > 15) {
    return await markAsAway(counselorId);
  }

  return presence;
};

// Get counselor presence status
export const getPresenceStatus = async (counselorId) => {
  const presence = await prisma.counselorPresence.findUnique({
    where: { counselorId },
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

  if (!presence) {
    return {
      status: 'OFFLINE',
      lastLoginAt: null,
      activeMinutesToday: 0,
      totalActiveMinutes: 0
    };
  }

  // Check inactivity
  await checkInactivity(counselorId);

  // Refresh presence data
  const updated = await prisma.counselorPresence.findUnique({
    where: { counselorId }
  });

  return {
    status: updated.status,
    lastLoginAt: updated.lastLoginAt,
    lastActivityAt: updated.lastActivityAt,
    activeMinutesToday: updated.activeMinutesToday,
    totalActiveMinutes: updated.totalActiveMinutes
  };
};

// Get all active counselors
export const getActiveCounselors = async () => {
  return await prisma.counselorPresence.findMany({
    where: {
      status: 'ACTIVE'
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
      lastActivityAt: 'desc'
    }
  });
};

// Get daily attendance summary
export const getDailyAttendance = async (date = new Date()) => {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  return await prisma.dailyAttendance.findMany({
    where: {
      date: targetDate
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
      loginTime: 'desc'
    }
  });
};

// Get counselors absent for full day
export const getAbsentCounselors = async (date = new Date()) => {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  const allCounselors = await prisma.counselorProfile.findMany({
    include: {
      user: {
        select: {
          username: true,
          email: true
        }
      }
    }
  });

  const attendance = await prisma.dailyAttendance.findMany({
    where: {
      date: targetDate,
      status: {
        in: ['PRESENT', 'PARTIAL']
      }
    }
  });

  const presentCounselorIds = new Set(attendance.map(a => a.counselorId));
  
  return allCounselors.filter(c => !presentCounselorIds.has(c.id));
};
