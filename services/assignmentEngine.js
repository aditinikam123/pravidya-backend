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
  async findBestCounselor(lead) {
    try {
      // Get course details to check expertise
      const course = await prisma.course.findUnique({
        where: { id: lead.courseId }
      });

      if (!course) {
        return await this.getDefaultAssignment('Course not found');
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
        return await this.getDefaultAssignment('No active counselors available');
      }

      // Score each counselor based on matching criteria
      const scoredCounselors = activeCounselors.map(counselor => {
        let score = 0;
        const reasons = [];

        // 1. Expertise match (highest priority - 40 points)
        if (counselor.expertise && counselor.expertise.length > 0) {
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

        // 2. Language match (high priority - 30 points)
        if (counselor.languages && counselor.languages.length > 0) {
          const hasLanguage = counselor.languages.some(lang =>
            lang.toLowerCase() === lead.preferredLanguage.toLowerCase()
          );
          if (hasLanguage) {
            score += 30;
            reasons.push('Language match');
          }
        }

        // 3. Availability check (required - 0 points but must pass)
        if (counselor.availability !== 'ACTIVE') {
          return null; // Skip inactive counselors
        }

        // 4. Load capacity check (medium priority - 20 points)
        const loadPercentage = (counselor.currentLoad / counselor.maxCapacity) * 100;
        if (loadPercentage < 50) {
          score += 20;
          reasons.push('Low workload');
        } else if (loadPercentage < 80) {
          score += 10;
          reasons.push('Moderate workload');
        } else if (loadPercentage >= 100) {
          return null; // Skip fully loaded counselors
        }

        // 5. Current load (lower priority - 10 points)
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
      }).filter(item => item !== null); // Remove null entries

      if (scoredCounselors.length === 0) {
        return await this.getDefaultAssignment('No counselors meet the criteria');
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
        score: bestMatch.score
      };
    } catch (error) {
      console.error('Assignment engine error:', error);
      return await this.getDefaultAssignment(`Error in assignment: ${error.message}`);
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
          autoAssigned: false,
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
        // Update lead
        const updatedLead = await tx.lead.update({
          where: { id: lead.id },
          data: {
            assignedCounselorId: assignmentResult.counselor.id,
            autoAssigned: assignmentResult.autoAssigned,
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
   * @returns {Object} - Updated lead
   */
  async reassignLead(lead, newCounselorId, reason) {
    try {
      const oldCounselorId = lead.assignedCounselorId;

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
              autoAssigned: false, // Manual reassignment overrides auto
              assignmentReason: `Manually reassigned: ${reason}`
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
              assignmentReason: `Unassigned: ${reason}`
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
