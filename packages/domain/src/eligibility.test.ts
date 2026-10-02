import { describe, expect, it } from 'vitest';
import type { DeviceCriteria, DeviceProfile } from '@pocket-qa/contracts';
import { checkEligibility } from './eligibility';

const criteria: DeviceCriteria = { platforms: ['android'], minAndroidApi: 34, languages: ['en', 'es'] };
const device: DeviceProfile = { platform: 'android', osVersion: '15', androidApiLevel: 35, model: 'Seeker', languages: ['es-MX'] };

describe('checkEligibility', () => {
  it('accepts a matching self-reported device (language prefix match)', () => {
    expect(checkEligibility(criteria, device)).toEqual({ eligible: true, reasons: [] });
  });

  it('requires a device profile', () => {
    expect(checkEligibility(criteria, null)).toEqual({ eligible: false, reasons: ['Add your device profile to see matching studies.'] });
  });

  it('explains every mismatch (the API rule applies only to Android devices)', () => {
    const r = checkEligibility(criteria, { ...device, platform: 'ios', androidApiLevel: null, languages: ['fr'] });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toHaveLength(2);
    const a = checkEligibility(criteria, { ...device, androidApiLevel: 30, languages: ['fr'] });
    expect(a.reasons).toHaveLength(2);
  });

  it('rejects an Android device below the minimum API level, or with unknown level', () => {
    expect(checkEligibility(criteria, { ...device, androidApiLevel: 33 }).eligible).toBe(false);
    expect(checkEligibility(criteria, { ...device, androidApiLevel: null }).eligible).toBe(false);
  });

  it('treats an empty language list as any language and null API as no minimum', () => {
    expect(checkEligibility({ platforms: ['web'], minAndroidApi: null, languages: [] }, { ...device, platform: 'web', androidApiLevel: null }).eligible).toBe(true);
  });
});
