import type { DeviceCriteria, DeviceProfile } from '@pocket-qa/contracts';

/** Eligibility is computed from the tester's self-reported device; it is never a verification. */
export function checkEligibility(criteria: DeviceCriteria, device: DeviceProfile | null): { eligible: boolean; reasons: string[] } {
  if (!device) return { eligible: false, reasons: ['Add your device profile to see matching studies.'] };
  const reasons: string[] = [];
  if (!criteria.platforms.includes(device.platform)) {
    reasons.push(`Needs ${criteria.platforms.join(' or ')}.`);
  }
  if (criteria.minAndroidApi !== null && device.platform === 'android') {
    if (device.androidApiLevel === null || device.androidApiLevel < criteria.minAndroidApi) {
      reasons.push(`Needs Android API ${criteria.minAndroidApi} or newer.`);
    }
  }
  if (criteria.languages.length > 0) {
    const base = (tag: string) => tag.toLowerCase().split('-')[0];
    const wanted = new Set(criteria.languages.map(base));
    if (!device.languages.some((l) => wanted.has(base(l)))) {
      reasons.push(`Needs one of: ${criteria.languages.join(', ')}.`);
    }
  }
  return { eligible: reasons.length === 0, reasons };
}
