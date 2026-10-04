import { auditGlyph } from '../../ui/patterns';
import { adminAuditGlyph } from '../adminAudit';

// The patterns barrel pulls in the kit (lucide icons, ESM-only by default) and ThemeProvider
// (AsyncStorage): the same module stand-ins the other screen tests use.
jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

describe('adminAuditGlyph (A-Audit nodes)', () => {
  it('draws stuck-work decisions as the hourglass on a success or rose rim', () => {
    expect(adminAuditGlyph('participation.approve')).toEqual({ glyph: 'stuck', tint: 'success' });
    expect(adminAuditGlyph('participation.reject')).toEqual({ glyph: 'stuck', tint: 'danger' });
  });

  it('keeps the shared mapping for every other subject', () => {
    for (const action of ['user.suspend', 'dispute.overturned', 'dispute.upheld', 'study.suspend', 'something.else']) {
      expect(adminAuditGlyph(action)).toEqual(auditGlyph(action));
    }
    expect(adminAuditGlyph('user.suspend').glyph).toBe('moderation');
    expect(adminAuditGlyph('dispute.overturned').glyph).toBe('disputes');
  });
});
