import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import type { GlyphName } from '../icons';
import { ARRIVAL_STAMP_TTL } from '../motion/entrance';

// The intro (Welcome): three pages a first-time visitor sees before Sign in, once per device or
// browser. It explains what Pocket QA is, what a tester does and what a builder does. It never
// gates sign-in: a returning visitor, a deep link to /sign-in, or storage that can't be read all go
// straight to Sign in.

const KEY = 'pocketqa.introSeen';

/** Whether this device has seen the intro. Storage that can't be read counts as seen (fail open). */
export async function readIntroSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return true;
  }
}

export async function markIntroSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // Not stored: the intro shows again next time, which is harmless.
  }
}

// The hand-over to Sign in. The intro is the launch on a first visit (light first), so Sign in,
// reached from it, arrives with a push like the pages before it instead of replaying the launch.
// Read by the auth layout when Sign in mounts, a few renders after the replace.
let leftAt = -Infinity;

/** The intro is leaving for Sign in (or Sign up, which opens over it). */
export function noteIntroLeft(now = Date.now()): void {
  leftAt = now;
}

/** Whether Sign in is mounting because the intro just handed over to it. */
export function cameFromIntro(now = Date.now()): boolean {
  return now - leftAt <= ARRIVAL_STAMP_TTL;
}

/**
 * Someone with a session (signed in, restored, or reached through a deep link that never opens
 * `/`) already knows the app: the intro never shows them after they sign out. The root layout
 * calls this for the whole app.
 */
export function useIntroSeenWithSession(signedIn: boolean): void {
  useEffect(() => {
    if (signedIn) void markIntroSeen();
  }, [signedIn]);
}

/** `null` until storage answers; then whether the intro has been seen. */
export function useIntroSeen(): boolean | null {
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void readIntroSeen().then((v) => {
      if (live) setSeen(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return seen;
}

export type IntroStep = { glyph: GlyphName; title: string; body: string };
export type IntroPage = { key: 'welcome' | 'testers' | 'builders'; label: string; title: string; body: string; steps?: IntroStep[] };

/**
 * The pages, in order. `testCredits`: the deployment rewards approved work with test credits
 * (the same switch as Sign in's subtitle); otherwise the copy names no reward unit. Never an
 * earnings promise: the app's copy test runs every string here through the banned-copy linter.
 */
export function introPages({ testCredits }: { testCredits: boolean }): IntroPage[] {
  return [
    {
      key: 'welcome',
      label: 'POCKET QA',
      title: 'Usability tests on real phones',
      body: 'Pocket QA connects people who build apps with people who test them on their own devices. Every session is consented, and every result is reviewed by a person.',
    },
    {
      key: 'testers',
      label: 'FOR TESTERS',
      title: 'Test apps on your own phone',
      body: 'Try an app, think out loud, and tell the builder what got in your way.',
      steps: [
        { glyph: 'discover', title: 'Pick a study', body: 'Choose one that fits your device and your time.' },
        { glyph: 'consent', title: 'You decide what’s recorded', body: 'Nothing records until you consent, and you check every clip before it uploads.' },
        {
          glyph: testCredits ? 'credits' : 'approve',
          title: 'Reviewed by the builder',
          body: testCredits
            ? 'Approved work adds test credits. Rewards need approval and are never guaranteed.'
            : 'The builder reviews your work. Rewards need approval and are never guaranteed.',
        },
      ],
    },
    {
      key: 'builders',
      label: 'FOR BUILDERS',
      title: 'See where people get stuck',
      body: 'Watch real people use your app on the devices you choose.',
      steps: [
        { glyph: 'studies', title: 'Set up a study', body: 'Write the tasks and choose the devices you need.' },
        { glyph: 'eye', title: 'Watch what happened', body: 'Review consented recordings and the tester’s notes, then write your findings.' },
        { glyph: 'approve', title: 'Approve with care', body: 'Approve good work, or reject it with a reason the tester can dispute.' },
      ],
    },
  ];
}

/** The page a horizontal offset rests on, clamped to the pages. */
export function pageAt(offsetX: number, pageWidth: number, count: number): number {
  'worklet';
  if (pageWidth <= 0 || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offsetX / pageWidth)));
}
