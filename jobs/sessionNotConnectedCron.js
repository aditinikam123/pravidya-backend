/**
 * Session NOT_CONNECTED Handling Cron Job
 *
 * Runs every 5 minutes. For sessions that are SCHEDULED, past scheduled time + 20 minutes,
 * and not completed:
 * 1. Mark as NOT_CONNECTED, increment attempt_count, set last_attempt_at
 * 2. If attempt_count < max_attempts: reschedule to +4 hours (retry slot)
 * 3. If attempt_count >= max_attempts: set is_overdue = true
 *
 * No session is directly marked as "MISSED" without retry attempts.
 */

import { prisma } from '../prisma/client.js';

const GRACE_MINUTES = 20;
const RETRY_HOURS = 4;

export async function runSessionNotConnectedJob() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - GRACE_MINUTES * 60 * 1000);

  const sessions = await prisma.counselingSession.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledDate: { lt: cutoff },
      completedAt: null,
    },
    select: {
      id: true,
      leadId: true,
      counselorId: true,
      scheduledDate: true,
      attemptCount: true,
      maxAttempts: true,
      mode: true,
      meetingLink: true,
      lead: { select: { parentEmail: true } },
      counselor: { select: { staticMeetLink: true } },
    },
  });

  if (sessions.length === 0) return { processed: 0, retried: 0, overdue: 0 };

  let retried = 0;
  let overdue = 0;

  for (const session of sessions) {
    const newAttemptCount = (session.attemptCount ?? 0) + 1;
    const maxAttempts = session.maxAttempts ?? 3;

    if (newAttemptCount >= maxAttempts) {
      await prisma.counselingSession.update({
        where: { id: session.id },
        data: {
          status: 'NOT_CONNECTED',
          attemptCount: newAttemptCount,
          lastAttemptAt: now,
          isOverdue: true,
        },
      });
      overdue++;
    } else {
      const retryAt = new Date(now.getTime() + RETRY_HOURS * 60 * 60 * 1000);
      await prisma.counselingSession.update({
        where: { id: session.id },
        data: {
          status: 'SCHEDULED',
          attemptCount: newAttemptCount,
          lastAttemptAt: now,
          scheduledDate: retryAt,
          remarks: [session.remarks, `Retry #${newAttemptCount} scheduled for ${retryAt.toISOString()}`].filter(Boolean).join('\n'),
        },
      });
      retried++;
    }
  }

  return { processed: sessions.length, retried, overdue };
}
