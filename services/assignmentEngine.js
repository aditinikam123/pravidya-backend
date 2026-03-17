import { prisma } from '../prisma/client.js';

/**
 * Automatic Counselor Assignment Engine
 * Matches leads with counselors based on multiple criteria
 * Migrated from Mongoose to Prisma ORM
 */
class AssignmentEngine {
  /**
   * Find the best matching counselor for a lead
   * @param {Object} lead - The lead object (Prisma Lead model)
   * @returns {Object} - Assignment result with counselor and reason
   */
  /**
   * Parse lead's preferred language(s) - can be single "Telugu" or comma-separated "Telugu, Kannada"
   * @returns {string[]} Normalized language strings (trimmed, lowercase for comparison)
   */
  _parsePreferredLanguages(lead) {
    const raw = (lead.preferredLanguage || 'English').toString().trim();
    if (!raw) return ['english'];
    return raw.split(',').map(l => l.trim().toLowerCase()).filter(Boolean);
  }

  /**
   * Check if counselor has at least one language matching lead's preferred languages
   */
  _counselorMatchesLanguage(counselor, preferredLangs) {
    if (!counselor.languages || counselor.languages.length === 0) return false;
    return counselor.languages.some(cl =>
      cl && preferredLangs.some(pl => (cl.trim().toLowerCase()) === pl)
    );
  }

  async findBestCounselor(lead) {
    try {
      const preferredLangs = this._parsePreferredLanguages(lead);

      // Get course details (optional - for expertise scoring)
      let course = null;
      if (lead.courseId) {
        course = await prisma.course.findUnique({
          where: { id: lead.courseId }
        });
      }

      // Get all active counselors with their user data
      const activeCounselors = await prisma.counselorProfile.findMany({
        where: {
          availability: 'ACTIVE'
        },
        include: {
          user: true
        }
      });

      if (activeCounselors.length === 0) {
        return {
          counselor: null,
          autoAssigned: false,
          assignmentReason: 'No active counselors available',
          needsManualAssignment: true,
          score: 0
        };
      }

      // REQUIRED: Only consider counselors with at least one matching language
      const languageMatchedCounselors = activeCounselors.filter(c =>
        this._counselorMatchesLanguage(c, preferredLangs)
      );

      if (languageMatchedCounselors.length === 0) {
        const langDisplay = (lead.preferredLanguage || 'English').toString().trim();
        return {
          counselor: null,
          autoAssigned: false,
          assignmentReason: `No counselor found with preferred language (${langDisplay}). Please assign manually.`,
          needsManualAssignment: true,
          score: 0
        };
      }

      // Score each language-matched counselor
      const scoredCounselors = languageMatchedCounselors.map(counselor => {
        let score = 0;
        const reasons = ['Language match'];

        // 1. Expertise match (if course available - 40 points)
        if (course && counselor.expertise && counselor.expertise.length > 0) {
          const courseName = course.name.toLowerCase();
          const hasExpertise = counselor.expertise.some(exp =>
            courseName.includes(exp.toLowerCase()) ||
            exp.toLowerCase().includes(courseName)
          );
          if (hasExpertise) {
            score += 40;
            reasons.push('Expertise match');
          }
        }

        // 2. Load capacity check (medium priority - 20 points)
        const loadPercentage = (counselor.currentLoad / counselor.maxCapacity) * 100;
        if (loadPercentage >= 100) {
          return null; // Skip fully loaded counselors
        }
        if (loadPercentage < 50) {
          score += 20;
          reasons.push('Low workload');
        } else if (loadPercentage < 80) {
          score += 10;
          reasons.push('Moderate workload');
        }

        // 3. Current load (lower priority - 10 points)
        if (counselor.currentLoad === 0) {
          score += 10;
          reasons.push('No current load');
        }

        return {
          counselor,
          score,
          reasons: reasons.join(', '),
          loadPercentage
        };
      }).filter(item => item !== null);

      if (scoredCounselors.length === 0) {
        const langDisplay = (lead.preferredLanguage || 'English').toString().trim();
        return {
          counselor: null,
          autoAssigned: false,
          assignmentReason: `No counselor with preferred language (${langDisplay}) has capacity. Please assign manually.`,
          needsManualAssignment: true,
          score: 0
        };
      }

      // Sort by score (highest first), then by load (lowest first)
      scoredCounselors.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.loadPercentage - b.loadPercentage;
      });

      const bestMatch = scoredCounselors[0];

      return {
        counselor: bestMatch.counselor,
        autoAssigned: true,
        assignmentReason: `Auto-assigned: ${bestMatch.reasons} (Score: ${bestMatch.score})`,
        score: bestMatch.score,
        needsManualAssignment: false
      };
    } catch (error) {
      console.error('Assignment engine error:', error);
      return {
        counselor: null,
        autoAssigned: false,
        assignmentReason: `Error in assignment: ${error.message}. Please assign manually.`,
        needsManualAssignment: true,
        score: 0
      };
    }
  }

  /**
   * Get default counselor assignment (fallback)
   * @param {String} reason - Reason for default assignment
   * @returns {Object} - Default assignment result
   */
  async getDefaultAssignment(reason) {
    try {
      // Find a default counselor (first available with lowest load)
      const defaultCounselor = await prisma.counselorProfile.findFirst({
        where: {
          availability: 'ACTIVE'
        },
        orderBy: {
          currentLoad: 'asc'
        },
        include: {
          user: true
        }
      });

      if (defaultCounselor) {
        return {
          counselor: defaultCounselor,
          autoAssigned: true,
          assignmentReason: `Default assignment: ${reason}`,
          score: 0
        };
      }

      // If no counselor available at all, return null
      return {
        counselor: null,
        autoAssigned: false,
        assignmentReason: `No counselors available: ${reason}`,
        score: 0
      };
    } catch (error) {
      console.error('Default assignment error:', error);
      return {
        counselor: null,
        autoAssigned: false,
        assignmentReason: `Error: ${error.message}`,
        score: 0
      };
    }
  }

  /**
   * Assign lead to counselor and update load
   * Uses Prisma transaction for atomicity
   * @param {Object} lead - The lead object (Prisma Lead model)
   * @param {Object} assignmentResult - Result from findBestCounselor
   * @returns {Object} - Updated lead
   */
  async assignLead(lead, assignmentResult) {
    try {
      if (!assignmentResult.counselor) {
        // If no counselor found, still save the lead but mark as unassigned
        const updatedLead = await prisma.lead.update({
          where: { id: lead.id },
          data: {
            assignedCounselorId: null,
            autoAssigned: false,
            assignmentReason: assignmentResult.assignmentReason
          }
        });
        return updatedLead;
      }

      // Use transaction to ensure atomicity
      const result = await prisma.$transaction(async (tx) => {
        // Update lead – any assignment via this engine is auto (import, public form, etc.)
        const updatedLead = await tx.lead.update({
          where: { id: lead.id },
          data: {
            assignedCounselorId: assignmentResult.counselor.id,
            autoAssigned: true,
            assignmentReason: assignmentResult.assignmentReason
          }
        });

        // Update counselor load (increment safely)
        await tx.counselorProfile.update({
          where: { id: assignmentResult.counselor.id },
          data: {
            currentLoad: {
              increment: 1
            }
          }
        });

        return updatedLead;
      });

      return result;
    } catch (error) {
      console.error('Assign lead error:', error);
      throw error;
    }
  }

  /**
   * Reassign lead to a different counselor
   * Uses Prisma transaction for atomicity
   * @param {Object} lead - The lead object (Prisma Lead model)
   * @param {String} newCounselorId - New counselor ID (Prisma CUID)
   * @param {String} reason - Reason for reassignment
   * @param {Object} opts - Options
   * @returns {Object} - Updated lead
   */
  async reassignLead(lead, newCounselorId, reason, opts = {}) {
    try {
      const oldCounselorId = lead.assignedCounselorId;
      const isAuto = opts?.isAuto === true;

      // Use transaction to ensure atomicity
      const result = await prisma.$transaction(async (tx) => {
        // Remove from old counselor (decrement load)
        if (oldCounselorId) {
          await tx.counselorProfile.update({
            where: { id: oldCounselorId },
            data: {
              currentLoad: {
                decrement: 1
              }
            }
          });
        }

        // Assign to new counselor or unassign
        if (newCounselorId) {
          // Verify new counselor exists
          const newCounselor = await tx.counselorProfile.findUnique({
            where: { id: newCounselorId }
          });

          if (!newCounselor) {
            throw new Error('New counselor not found');
          }

          // Increment new counselor load
          await tx.counselorProfile.update({
            where: { id: newCounselorId },
            data: {
              currentLoad: {
                increment: 1
              }
            }
          });

          // Update lead
          const updatedLead = await tx.lead.update({
            where: { id: lead.id },
            data: {
              assignedCounselorId: newCounselorId,
              autoAssigned: isAuto ? true : false,
              assignmentReason: isAuto ? `Auto-reassigned: ${reason}` : `Manually reassigned: ${reason}`
            }
          });

          return updatedLead;
        } else {
          // Unassign
          const updatedLead = await tx.lead.update({
            where: { id: lead.id },
            data: {
              assignedCounselorId: null,
              autoAssigned: false,
              assignmentReason: isAuto ? `Auto-unassigned: ${reason}` : `Unassigned: ${reason}`
            }
          });

          return updatedLead;
        }
      });

      return result;
    } catch (error) {
      console.error('Reassign lead error:', error);
      throw error;
    }
  }
}

export default new AssignmentEngine();
