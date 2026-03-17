/**
 * Validation for lead updates: priority and qualification are never manually editable.
 * - status = HIGH_PRIORITY is set only by qualify flow (calculateHighPriority).
 * - priority_flag, qualification_status, intent, timeline, budget_status, decision_maker
 *   are set only via POST /api/leads/:id/qualify.
 * This middleware strips those fields from req.body so they cannot be set via PUT /api/leads/:id.
 */
const DISALLOWED_LEAD_UPDATE_FIELDS = [
  'priority_flag',
  'qualification_status',
  'intent',
  'timeline',
  'budget_status',
  'decision_maker',
];

export function validateLeadUpdate(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    DISALLOWED_LEAD_UPDATE_FIELDS.forEach((key) => delete req.body[key]);
    if (req.body.status === 'HIGH_PRIORITY') {
      delete req.body.status;
    }
  }
  next();
}
