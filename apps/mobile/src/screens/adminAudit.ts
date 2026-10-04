import { auditGlyph } from '../ui/patterns';

/**
 * A-Audit's node glyphs, by the admin's subject rather than the verb. A participation decision in
 * the admin log is always a stuck-work decision (the only admin path that decides one), so the
 * board draws it as the hourglass on a success (approve) or rose (reject) rim, not the Review
 * screen's check / x. Every other action keeps the shared mapping (user.suspend → moderation,
 * dispute.overturned → disputes).
 */
export function adminAuditGlyph(action: string): ReturnType<typeof auditGlyph> {
  if (action.startsWith('participation.')) return { glyph: 'stuck', tint: action.endsWith('.approve') ? 'success' : 'danger' };
  return auditGlyph(action);
}
