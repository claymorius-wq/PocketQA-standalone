// Lens extruded glass glyphs (Direction A v2, spec §7). Geometry is copied verbatim from the one
// glyph source, lens-glyphs.mjs round 4 (CONSISTENCY G: boards never define a glyph), with its
// thin tubes `t`/`tw` written as `s`/`w`. RN keeps four camelCase names for source names:
// signIn = `signin`, signOut = `logout`, fileWarning = `filewarn`, chevronDown = `chevdown`.
// The S6 Disputes parts (dPost, dBeam, dPanL, dPanR) are the source's DISPUTES_PARTS: the disputes
// glyph split so BalanceGlyph can weigh it (the beam turns, the pans hang plumb).
//
// 32-unit grid, 3.5-unit margin. A glyph is a list of parts drawn back to front. A part is a
// closed volume `f` (fill-rule evenodd, so inner subpaths cut slots through it) and/or a tube `s`
// of width `w` (round caps and joins). `hot` marks the record core, painted lit from inside.

export type GlyphPart = {
  /** Tube centre line, stroked at `w` with round caps and joins. */
  s?: string;
  w?: number;
  /** Closed volume, evenodd. */
  f?: string;
  hot?: true;
};

export const GLYPHS = {
  // Discover (Compass): a loupe with a crosshair reticle.
  discover: [
    { f: 'M17.7 21.1L23.3 26.7A2.4 2.4 0 0 0 26.7 23.3L21.1 17.7A2.4 2.4 0 0 0 17.7 21.1Z' },
    { s: 'M6.3 13.5a7.2 7.2 0 1 0 14.4 0a7.2 7.2 0 1 0 -14.4 0Z', w: 4 },
    { s: 'M13.5 8.9V10.3 M13.5 16.7V18.1 M8.9 13.5H10.3 M16.7 13.5H18.1', w: 2, f: 'M12.2 13.5a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0Z' },
  ],
  // My work (ClipboardList): a tray clipboard with ruled slots and a raised clip block.
  work: [
    { f: 'M9.5 7.5H11V10.6A2 2 0 0 0 13 12.6H19A2 2 0 0 0 21 10.6V7.5H22.5A3 3 0 0 1 25.5 10.5V24A3 3 0 0 1 22.5 27H9.5A3 3 0 0 1 6.5 24V10.5A3 3 0 0 1 9.5 7.5ZM11.6 17.9L20.4 17.9A1.1 1.1 0 0 0 20.4 15.7L11.6 15.7A1.1 1.1 0 0 0 11.6 17.9ZM11.6 22.5L16.4 22.5A1.1 1.1 0 0 0 16.4 20.3L11.6 20.3A1.1 1.1 0 0 0 11.6 22.5Z' },
    { f: 'M13.8 4.4H18.2a1.8 1.8 0 0 1 1.8 1.8V9.8a1.8 1.8 0 0 1 -1.8 1.8H13.8a1.8 1.8 0 0 1 -1.8 -1.8V6.2a1.8 1.8 0 0 1 1.8 -1.8Z' },
  ],
  // Credits (Coins), round 4: one coin tilted toward the viewer, so the struck face shows above the
  // ribbed rim (the edge-on coin read as a tin can at 26 muted).
  credits: [
    { f: 'M6.2 13.6A9.8 9.47 0 0 0 25.8 13.6V18.2A9.8 9.47 0 0 1 6.2 18.2ZM8.65 21.9L8.65 23.9A0.75 0.75 0 0 0 10.15 23.9L10.15 21.9A0.75 0.75 0 0 0 8.65 21.9ZM11.95 23.82L11.95 25.82A0.75 0.75 0 0 0 13.45 25.82L13.45 23.82A0.75 0.75 0 0 0 11.95 23.82ZM15.25 24.37L15.25 26.37A0.75 0.75 0 0 0 16.75 26.37L16.75 24.37A0.75 0.75 0 0 0 15.25 24.37ZM18.55 23.82L18.55 25.82A0.75 0.75 0 0 0 20.05 25.82L20.05 23.82A0.75 0.75 0 0 0 18.55 23.82ZM21.85 21.9L21.85 23.9A0.75 0.75 0 0 0 23.35 23.9L23.35 21.9A0.75 0.75 0 0 0 21.85 21.9Z' },
    { f: 'M6.2 12.9a9.8 9.47 0 1 0 19.6 0a9.8 9.47 0 1 0 -19.6 0ZM8.8 12.9a7.2 6.95 0 1 0 14.4 0a7.2 6.95 0 1 0 -14.4 0ZM9.8 12.9a6.2 5.99 0 1 0 12.4 0a6.2 5.99 0 1 0 -12.4 0Z' },
  ],
  // Budget: an offset stack of three coins.
  budget: [
    { f: 'M9.2 18.4a8 3.4 0 1 0 16 0a8 3.4 0 1 0 -16 0ZM9.2 19.8A8 3.4 0 0 0 25.2 19.8V23.2A8 3.4 0 0 1 9.2 23.2Z' },
    { f: 'M6.6 12.8a8 3.4 0 1 0 16 0a8 3.4 0 1 0 -16 0ZM6.6 14.2A8 3.4 0 0 0 22.6 14.2V17.6A8 3.4 0 0 1 6.6 17.6Z' },
    { f: 'M8.8 7.2a8 3.4 0 1 0 16 0a8 3.4 0 1 0 -16 0ZM8.8 8.6A8 3.4 0 0 0 24.8 8.6V12A8 3.4 0 0 1 8.8 12Z' },
  ],
  // Settings, round 4: a knurled rotary dial with its pointer slot cut through, a small dial offset
  // in front (the two plain dials merged into a key shape at 26 muted).
  settings: [
    { f: 'M14.57 3.58L13.76 4.98L16.01 6.28L16.83 4.88A8.5 8.5 0 0 1 19.9 10.2L18.28 10.2L18.28 12.8L19.9 12.8A8.5 8.5 0 0 1 16.83 18.12L16.01 16.72L13.76 18.02L14.57 19.42A8.5 8.5 0 0 1 8.43 19.42L9.24 18.02L6.99 16.72L6.17 18.12A8.5 8.5 0 0 1 3.1 12.8L4.72 12.8L4.72 10.2L3.1 10.2A8.5 8.5 0 0 1 6.17 4.88L6.99 6.28L9.24 4.98L8.43 3.58A8.5 8.5 0 0 1 14.57 3.58ZM10 6.4L10 9.4A1.5 1.5 0 0 0 13 9.4L13 6.4A1.5 1.5 0 0 0 10 6.4Z' },
    { f: 'M17.5 22a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0ZM23.34 22.07L24.47 20.94A1 1 0 0 0 23.06 19.53L21.93 20.66A1 1 0 0 0 23.34 22.07Z' },
  ],
  // Studies (FlaskConical): a flask with liquid and one bubble.
  studies: [
    { f: 'M12.6 18.6H19.4L22.6 24.2A0.9 0.9 0 0 1 21.8 25.5H10.2A0.9 0.9 0 0 1 9.4 24.2ZM16.6 22a1 1 0 1 0 2 0a1 1 0 1 0 -2 0Z' },
    { s: 'M12.4 5.2h7.2 M14 5.2v7.6l-6.2 10.6A2.4 2.4 0 0 0 9.9 27h12.2a2.4 2.4 0 0 0 2.1-3.6L18 12.8V5.2', w: 3.4 },
  ],
  // Disputes (Gavel): a balance with a tilted beam and solid pans.
  disputes: [
    { s: 'M16 9v14.5', w: 4, f: 'M12.4 23.6H19.6a1.9 1.9 0 0 1 1.9 1.9V25.5a1.9 1.9 0 0 1 -1.9 1.9H12.4a1.9 1.9 0 0 1 -1.9 -1.9V25.5a1.9 1.9 0 0 1 1.9 -1.9Z' },
    { s: 'M7 11.6L25 9.4', w: 3.4, f: 'M13.7 8.3a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0Z' },
    { s: 'M7 11.6L4.3 18.5 M7 11.6L9.7 18.5 M25 9.4L22.3 16.3 M25 9.4L27.7 16.3', w: 1.7, f: 'M3.6 18.5h6.8a3.4 3.4 0 0 1-6.8 0Z M21.6 16.3h6.8a3.4 3.4 0 0 1-6.8 0Z' },
  ],
  // Stuck (Hourglass): an hourglass with settled sand.
  stuck: [
    { s: 'M10.5 7.5c0 5.5 5 7 5 8.5s-5 3-5 8.5 M21.5 7.5c0 5.5-5 7-5 8.5s5 3 5 8.5', w: 2.6 },
    { f: 'M12.4 24.4c.7-2.8 2.3-4 3.6-4.4 1.3.4 2.9 1.6 3.6 4.4Z M13 10.4h6c-.7 1.4-1.8 2.4-3 3-1.2-.6-2.3-1.6-3-3Z' },
    { f: 'M9.2 4.2H22.8a1.7 1.7 0 0 1 1.7 1.7V5.9a1.7 1.7 0 0 1 -1.7 1.7H9.2a1.7 1.7 0 0 1 -1.7 -1.7V5.9a1.7 1.7 0 0 1 1.7 -1.7ZM9.2 24.4H22.8a1.7 1.7 0 0 1 1.7 1.7V26.1a1.7 1.7 0 0 1 -1.7 1.7H9.2a1.7 1.7 0 0 1 -1.7 -1.7V26.1a1.7 1.7 0 0 1 1.7 -1.7Z' },
  ],
  // Consent (ShieldCheck): the shield with a raised check.
  consent: [
    { f: 'M16 4.4l9.6 3.7v6.9c0 6.2-4 10.8-9.6 12.9C10.4 25.8 6.4 21.2 6.4 15V8.1Z' },
    { s: 'M11.6 15.8l3.2 3.2 5.8-6.4', w: 3 },
  ],
  // Moderation (ShieldAlert): a solid shield with a cut mark.
  moderation: [
    { f: 'M16 4.4l9.6 3.7v6.9c0 6.2-4 10.8-9.6 12.9C10.4 25.8 6.4 21.2 6.4 15V8.1ZM14.6 11.2L14.6 16A1.4 1.4 0 0 0 17.4 16L17.4 11.2A1.4 1.4 0 0 0 14.6 11.2ZM14.4 20.6a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0Z' },
  ],
  // Audit (ScrollText): a ledger page with ruled lines, index tabs and a turned corner.
  audit: [
    { f: 'M21.8 13.4H23.8a1.3 1.3 0 0 1 1.3 1.3V16.3a1.3 1.3 0 0 1 -1.3 1.3H21.8a1.3 1.3 0 0 1 -1.3 -1.3V14.7a1.3 1.3 0 0 1 1.3 -1.3ZM21.8 19H23.8a1.3 1.3 0 0 1 1.3 1.3V21.9a1.3 1.3 0 0 1 -1.3 1.3H21.8a1.3 1.3 0 0 1 -1.3 -1.3V20.3a1.3 1.3 0 0 1 1.3 -1.3Z' },
    { f: 'M8.5 4.5H17L22.5 10V25.5A2 2 0 0 1 20.5 27.5H8.5A2 2 0 0 1 6.5 25.5V6.5A2 2 0 0 1 8.5 4.5ZM10.3 15.8L18.6 15.8A1 1 0 0 0 18.6 13.8L10.3 13.8A1 1 0 0 0 10.3 15.8ZM10.3 20.2L18.6 20.2A1 1 0 0 0 18.6 18.2L10.3 18.2A1 1 0 0 0 10.3 20.2ZM10.3 24.6L14.6 24.6A1 1 0 0 0 14.6 22.6L10.3 22.6A1 1 0 0 0 10.3 24.6Z' },
    { f: 'M17 6V9.6A0.9 0.9 0 0 0 17.9 10.5H21.5Z' },
  ],
  // Record (Video, "Start screen recording"): a lens ring with a core lit from inside.
  record: [
    { s: 'M6.4 16a9.6 9.6 0 1 0 19.2 0a9.6 9.6 0 1 0 -19.2 0Z', w: 3.8 },
    { f: 'M11 16a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z', hot: true },
  ],
  // Record, idle (before recording starts), round 4: the Record ring and core, the core not lit
  // (plain face paint). Alias `recIdle`.
  recordIdle: [
    { s: 'M6.4 16a9.6 9.6 0 1 0 19.2 0a9.6 9.6 0 1 0 -19.2 0Z', w: 3.8 },
    { f: 'M11 16a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z' },
  ],
  // Send ("Submit for review"): a folded paper plane, the fold line cut through the wing.
  send: [
    { f: 'M15.6 18.6L14.4 26L19.4 21.8Z' },
    { f: 'M4.6 15.2L27 5.4L20.9 26.6L15.6 18.6ZM16.75 18.11L25.15 8.91A0.75 0.75 0 0 0 24.05 7.89L15.65 17.09A0.75 0.75 0 0 0 16.75 18.11Z' },
  ],
  // Stop (Square, "Stop recording").
  stop: [
    { f: 'M11.7 8.5H20.3a3.2 3.2 0 0 1 3.2 3.2V20.3a3.2 3.2 0 0 1 -3.2 3.2H11.7a3.2 3.2 0 0 1 -3.2 -3.2V11.7a3.2 3.2 0 0 1 3.2 -3.2Z' },
  ],
  // Play.
  play: [
    { f: 'M11.5 8.2v15.6a1.2 1.2 0 0 0 1.8 1l12.2-7.8a1.2 1.2 0 0 0 0-2L13.3 7.2a1.2 1.2 0 0 0-1.8 1Z' },
  ],
  // Remove (Trash2): a bin with a lid and cut slots.
  remove: [
    { f: 'M9.4 12h13.2l-1.3 13.2a2 2 0 0 1-2 1.8h-6.6a2 2 0 0 1-2-1.8ZM12.75 15.63L12.95 23.03A0.95 0.95 0 0 0 14.85 22.97L14.65 15.57A0.95 0.95 0 0 0 12.75 15.63ZM17.35 15.57L17.15 22.97A0.95 0.95 0 0 0 19.05 23.03L19.25 15.63A0.95 0.95 0 0 0 17.35 15.57Z' },
    { s: 'M13 7.6V6.2a1.4 1.4 0 0 1 1.4-1.4h3.2A1.4 1.4 0 0 1 19 6.2v1.4', w: 2, f: 'M8.1 7.4H23.9a1.6 1.6 0 0 1 1.6 1.6V9a1.6 1.6 0 0 1 -1.6 1.6H8.1a1.6 1.6 0 0 1 -1.6 -1.6V9a1.6 1.6 0 0 1 1.6 -1.6Z' },
  ],
  // Approve (Check).
  approve: [
    { s: 'M7.5 16.5l5.5 5.5L24.5 10', w: 4.4 },
  ],
  // Reject (X).
  reject: [
    { s: 'M9.5 9.5l13 13 M22.5 9.5l-13 13', w: 4.4 },
  ],
  // Wallet: a body with a card behind and a clasp proud of the edge.
  wallet: [
    { f: 'M9.5 10.4L19.6 5.8a1.6 1.6 0 0 1 2.2 1.1L22.6 10.4Z' },
    { f: 'M8.7 10H22.3a3.2 3.2 0 0 1 3.2 3.2V23.3a3.2 3.2 0 0 1 -3.2 3.2H8.7a3.2 3.2 0 0 1 -3.2 -3.2V13.2a3.2 3.2 0 0 1 3.2 -3.2Z' },
    { f: 'M18.8 14.6H27v6.4h-8.2a3.2 3.2 0 0 1 0-6.4ZM18.1 17.8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0Z' },
  ],
  // Back (stack header).
  back: [
    { s: 'M19 7.5L10.5 16l8.5 8.5', w: 4.4 },
  ],
  // Chevron (ChevronRight).
  chevron: [
    { s: 'M13 7.5l8.5 8.5-8.5 8.5', w: 4.4 },
  ],
  // Info. Also replaces the repo's Sparkles on the "Analysis unavailable" notice (A-Review handoff: no sparkle trope).
  info: [
    { f: 'M5.4 16a10.6 10.6 0 1 0 21.2 0a10.6 10.6 0 1 0 -21.2 0ZM14.5 15L14.5 21A1.5 1.5 0 0 0 17.5 21L17.5 15A1.5 1.5 0 0 0 14.5 15ZM14.2 10.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0Z' },
  ],
  // Warning (AlertTriangle).
  warning: [
    { f: 'M14.1 6.4a2.2 2.2 0 0 1 3.8 0l9.4 16.2a2.2 2.2 0 0 1-1.9 3.3H6.6a2.2 2.2 0 0 1-1.9-3.3ZM14.6 12.4L14.6 17.4A1.4 1.4 0 0 0 17.4 17.4L17.4 12.4A1.4 1.4 0 0 0 14.6 12.4ZM14.4 21.3a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0Z' },
  ],
  // Alert (CircleAlert, danger notices): a disc with the mark cut through.
  alert: [
    { f: 'M5.4 16a10.6 10.6 0 1 0 21.2 0a10.6 10.6 0 1 0 -21.2 0ZM14.5 10.6L14.5 16.4A1.5 1.5 0 0 0 17.5 16.4L17.5 10.6A1.5 1.5 0 0 0 14.5 10.6ZM14.2 21.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0Z' },
  ],
  // Device profile (Smartphone): a slab with the screen cut through and a raised pane in the cut.
  device: [
    { f: 'M11.6 3.2H20.4a4.2 4.2 0 0 1 4.2 4.2V24.6a4.2 4.2 0 0 1 -4.2 4.2H11.6a4.2 4.2 0 0 1 -4.2 -4.2V7.4a4.2 4.2 0 0 1 4.2 -4.2ZM11.8 7.6H20.2a1.8 1.8 0 0 1 1.8 1.8V22a1.8 1.8 0 0 1 -1.8 1.8H11.8a1.8 1.8 0 0 1 -1.8 -1.8V9.4a1.8 1.8 0 0 1 1.8 -1.8ZM14 6.15L18 6.15A0.75 0.75 0 0 0 18 4.65L14 4.65A0.75 0.75 0 0 0 14 6.15ZM14.2 26.9L17.8 26.9A0.8 0.8 0 0 0 17.8 25.3L14.2 25.3A0.8 0.8 0 0 0 14.2 26.9Z' },
    { f: 'M12.8 9.2H19.2a1.2 1.2 0 0 1 1.2 1.2V20.8a1.2 1.2 0 0 1 -1.2 1.2H12.8a1.2 1.2 0 0 1 -1.2 -1.2V10.4a1.2 1.2 0 0 1 1.2 -1.2Z' },
  ],
  // Link devnet wallet (Link2), round 4: two interlocked lens rings; the left ring passes back in
  // front at the lower crossing.
  link: [
    { s: 'M5.4 16a6.6 6.6 0 1 0 13.2 0a6.6 6.6 0 1 0 -13.2 0Z', w: 3.8 },
    { s: 'M13.4 16a6.6 6.6 0 1 0 13.2 0a6.6 6.6 0 1 0 -13.2 0Z', w: 3.8 },
    { s: 'M17.83 19.1A6.6 6.6 0 0 1 13.37 22.46', w: 3.8 },
  ],
  // Sign in (LogIn), round 4: the record ring, a 4.0 tube arrow passing in front of its rim and
  // stopping at the core (source name `signin`).
  signIn: [
    { s: 'M10.2 16a8.2 8.2 0 1 0 16.4 0a8.2 8.2 0 1 0 -16.4 0Z', w: 3.8 },
    { s: 'M5.5 16H18.6 M14.4 11.8L18.6 16L14.4 20.2', w: 4 },
  ],
  // Create account (UserPlus), round 4: a tester seen through the lens ring (the rim crops the
  // shoulders), a plus standing proud of the rim.
  join: [
    { f: 'M11.2 14.2a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0 -6.8 0ZM8.6 24.6A6 5.4 0 0 1 20.6 24.6Z' },
    { s: 'M5.4 17.2a9.2 9.2 0 1 0 18.4 0a9.2 9.2 0 1 0 -18.4 0Z', w: 3.8 },
    { s: 'M23.3 5.6V11.8 M20.2 8.7H26.4', w: 3.6 },
  ],
  // Sign out (LogOut), round 4: the same ring, the arrow starting at the core and leaving through
  // the rim (source name `logout`).
  signOut: [
    { s: 'M4.8 16a7.4 7.4 0 1 0 14.8 0a7.4 7.4 0 1 0 -14.8 0Z', w: 3.8 },
    { s: 'M12.2 16H26.5 M22.3 11.8L26.5 16L22.3 20.2', w: 4 },
  ],
  // Save draft / Save device profile, round 4: the My work tray, the arrow dropping in through the clip notch.
  save: [
    { f: 'M9.5 11H11V14.4A2.4 2.4 0 0 0 13.4 16.8H18.6A2.4 2.4 0 0 0 21 14.4V11H22.5A3 3 0 0 1 25.5 14V24A3 3 0 0 1 22.5 27H9.5A3 3 0 0 1 6.5 24V14A3 3 0 0 1 9.5 11ZM10.4 23.15L21.6 23.15A0.75 0.75 0 0 0 21.6 21.65L10.4 21.65A0.75 0.75 0 0 0 10.4 23.15Z' },
    { s: 'M16 5.5V14.6 M11.8 10.4L16 14.6L20.2 10.4', w: 4 },
  ],
  // Export my data (Download), round 4: the tray, the arrow leaving through the notch past the lit corner.
  download: [
    { f: 'M9.5 11H11V14.4A2.4 2.4 0 0 0 13.4 16.8H18.6A2.4 2.4 0 0 0 21 14.4V11H22.5A3 3 0 0 1 25.5 14V24A3 3 0 0 1 22.5 27H9.5A3 3 0 0 1 6.5 24V14A3 3 0 0 1 9.5 11ZM10.4 23.15L21.6 23.15A0.75 0.75 0 0 0 21.6 21.65L10.4 21.65A0.75 0.75 0 0 0 10.4 23.15Z' },
    { s: 'M14.8 14.4L24.4 4.8 M18.8 4.6H24.6V10.4', w: 4 },
  ],
  // Attach (Paperclip): two nested wire loops, tilted 28deg into the key light.
  attach: [
    { s: 'M23.41 14.84L18.72 23.67A5.6 5.6 0 0 1 8.83 18.41L14.88 7.02A3.4 3.4 0 0 1 20.89 10.22L15.72 19.93', w: 2.9 },
  ],
  // Upload, round 4: the tray, the arrow leaving straight up through the clip notch.
  upload: [
    { f: 'M9.5 11H11V14.4A2.4 2.4 0 0 0 13.4 16.8H18.6A2.4 2.4 0 0 0 21 14.4V11H22.5A3 3 0 0 1 25.5 14V24A3 3 0 0 1 22.5 27H9.5A3 3 0 0 1 6.5 24V14A3 3 0 0 1 9.5 11ZM10.4 23.15L21.6 23.15A0.75 0.75 0 0 0 21.6 21.65L10.4 21.65A0.75 0.75 0 0 0 10.4 23.15Z' },
    { s: 'M16 14.6V5.5 M11.8 9.7L16 5.5L20.2 9.7', w: 4 },
  ],
  // Withdrawn EmptyState (Circle): a plain glass ring.
  ring: [
    { s: 'M16 6.2a9.8 9.8 0 1 1 0 19.6a9.8 9.8 0 1 1 0-19.6Z', w: 4 },
  ],
  // Plus (New, Add task, Add finding), round 4: a filled cross with 1.8 corners.
  plus: [
    { f: 'M14.3 6.6H17.7A1.8 1.8 0 0 1 19.5 8.4V12.5H23.6A1.8 1.8 0 0 1 25.4 14.3V17.7A1.8 1.8 0 0 1 23.6 19.5H19.5V23.6A1.8 1.8 0 0 1 17.7 25.4H14.3A1.8 1.8 0 0 1 12.5 23.6V19.5H8.4A1.8 1.8 0 0 1 6.6 17.7V14.3A1.8 1.8 0 0 1 8.4 12.5H12.5V8.4A1.8 1.8 0 0 1 14.3 6.6Z' },
  ],
  // Pause (Pause study, Pause recording), round 4: two solid bars, one volume.
  pause: [
    { f: 'M11.4 7.4H12.2a2.2 2.2 0 0 1 2.2 2.2V22.4a2.2 2.2 0 0 1 -2.2 2.2H11.4a2.2 2.2 0 0 1 -2.2 -2.2V9.6a2.2 2.2 0 0 1 2.2 -2.2ZM19.8 7.4H20.6a2.2 2.2 0 0 1 2.2 2.2V22.4a2.2 2.2 0 0 1 -2.2 2.2H19.8a2.2 2.2 0 0 1 -2.2 -2.2V9.6a2.2 2.2 0 0 1 2.2 -2.2Z' },
  ],
  // Ban (Close study), round 4: a filled annulus with the slash cut through by evenodd.
  ban: [
    { f: 'M5.4 16a10.6 10.6 0 1 0 21.2 0a10.6 10.6 0 1 0 -21.2 0Z M12.2 9.65L22.35 19.8A7.4 7.4 0 0 0 12.2 9.65Z M9.65 12.2L19.8 22.35A7.4 7.4 0 0 1 9.65 12.2Z' },
  ],
  // Users (Participants), round 4: the second tester behind, the first in front.
  users: [
    { f: 'M17.9 9.8a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0Z M16.6 22.2C17.2 18.1 19.2 15.6 22 15.6C25.1 15.6 27.4 18.4 27.7 22.4A1.1 1.1 0 0 1 26.6 23.6H18.2Z' },
    { f: 'M8 11.2a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0 -8.8 0Z M4.4 25.4C4.8 20.3 8 17.1 12.4 17.1S20 20.3 20.4 25.4A1.3 1.3 0 0 1 19.1 26.8H5.7A1.3 1.3 0 0 1 4.4 25.4Z' },
  ],
  // Publish (Rocket), round 4: fins and nozzle as one volume behind, the body with its window cut
  // through in front. Alias `rocket`.
  publish: [
    { f: 'M12 13.6L7.3 18.9Q6.5 19.8 6.5 21V24.4Q6.5 25.8 7.7 25.1L12 22.4Z M20 13.6L24.7 18.9Q25.5 19.8 25.5 21V24.4Q25.5 25.8 24.3 25.1L20 22.4ZM15.1 19.8H16.9a1.7 1.7 0 0 1 1.7 1.7V23.7a1.7 1.7 0 0 1 -1.7 1.7H15.1a1.7 1.7 0 0 1 -1.7 -1.7V21.5a1.7 1.7 0 0 1 1.7 -1.7Z' },
    { f: 'M16 3.6C19.7 5.9 20.5 9.7 20.5 12.9V18.4A2.6 2.6 0 0 1 17.9 21H14.1A2.6 2.6 0 0 1 11.5 18.4V12.9C11.5 9.7 12.3 5.9 16 3.6ZM13.7 11.8a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0Z' },
  ],
  // No evidence (FileWarning): a page with a turned corner and a cut warning mark (A-Review, A-States).
  fileWarning: [
    { f: 'M8.5 4.5H18L23.5 10V25.5A2 2 0 0 1 21.5 27.5H8.5A2 2 0 0 1 6.5 25.5V6.5A2 2 0 0 1 8.5 4.5ZM13.6 13.6L13.6 18.4A1.4 1.4 0 0 0 16.4 18.4L16.4 13.6A1.4 1.4 0 0 0 13.6 13.6ZM13.4 22.6a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0Z' },
    { f: 'M18 6V9.6A0.9 0.9 0 0 0 18.9 10.5H22.5Z' },
  ],
  // View on devnet explorer (ExternalLink): an open frame behind, the arrow lifting out of its corner (A-Review).
  external: [
    { s: 'M14 8.5H10.5A3 3 0 0 0 7.5 11.5V21.5A3 3 0 0 0 10.5 24.5H20.5A3 3 0 0 0 23.5 21.5V18', w: 3.4 },
    { s: 'M15.6 16.4L24.2 7.8 M18.2 7.8H24.2V13.8', w: 3.8 },
  ],
  // Dispute this decision (Flag): a notched pennant, the pole in front (A-Session).
  flag: [
    { f: 'M12.4 7.4h10.9a1.4 1.4 0 0 1 1.13 2.23L21.5 13.7l2.93 4.07a1.4 1.4 0 0 1-1.13 2.23H12.4Z' },
    { s: 'M10.4 26.2V6.6', w: 3.8 },
  ],
  // Review work (Eye): an almond lid cut through, a solid iris with a glint hole (A-Stuck).
  eye: [
    { f: 'M3.8 16C7.4 10.2 11.4 7.6 16 7.6S24.6 10.2 28.2 16C24.6 21.8 20.6 24.4 16 24.4S7.4 21.8 3.8 16Z M8.6 16C11.2 12.4 13.6 11.1 16 11.1S20.8 12.4 23.4 16C20.8 19.6 18.4 20.9 16 20.9S11.2 19.6 8.6 16Z' },
    { f: 'M12.1 16a3.9 3.9 0 1 0 7.8 0a3.9 3.9 0 1 0 -7.8 0ZM13.6 14.7a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0Z' },
  ],
  // Disclosure chevron, pointing down. Its own volume: rotating a glyph would rotate its baked key light (A-Stuck).
  chevronDown: [
    { s: 'M7.5 12.5l8.5 8.5 8.5-8.5', w: 4.4 },
  ],
  // Forward (ArrowRight, Start session), round 4: one 4.4 tube shaft with the chevron head. Alias `arrow`.
  forward: [
    { s: 'M6.5 16H24.2 M17.2 8.8l7.2 7.2-7.2 7.2', w: 4.4 },
  ],
  // Not allowed (Lock): the shackle behind, a body with the keyhole cut through (A-States).
  lock: [
    { s: 'M11.2 14.6V11.4a4.8 4.8 0 0 1 9.6 0v3.2', w: 3.4 },
    { f: 'M10.4 13.6H21.6a3.2 3.2 0 0 1 3.2 3.2V24.4a3.2 3.2 0 0 1 -3.2 3.2H10.4a3.2 3.2 0 0 1 -3.2 -3.2V16.8a3.2 3.2 0 0 1 3.2 -3.2ZM14.6 18.6L14.6 22.6A1.4 1.4 0 0 0 17.4 22.6L17.4 18.6A1.4 1.4 0 0 0 14.6 18.6Z' },
  ],
  // You’re offline (WifiOff), round 4: two arcs and the source dot behind at 4.0, the cut bar at 4.4
  // standing proud in front.
  offline: [
    { s: 'M10.92 20.44A6.2 6.2 0 0 1 21.08 20.44 M5.93 18.65A11.4 11.4 0 0 1 26.07 18.65', w: 4, f: 'M13.4 24a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0Z' },
    { s: 'M7.5 4.5L25 25', w: 4.4 },
  ],
  // Retry (RefreshCw), round 4: two arcs, each ending in a solid arrowhead.
  refresh: [
    { s: 'M24.34 19.37A9 9 0 0 1 8.21 20.5', w: 3.4, f: 'M6.41 17.38L5.65 22.67L11.36 19.37Z' },
    { s: 'M7.66 12.63A9 9 0 0 1 23.79 11.5', w: 3.4, f: 'M25.59 14.62L26.35 9.33L20.64 12.63Z' },
  ],
  // Unlink wallet (Unlink), round 4: the two Link2 halves pulled apart, the break marks at 2.2.
  unlink: [
    { s: 'M16 5.4V8 M16 24V26.6', w: 2.2 },
    { s: 'M12.2 10.2H10.2A5.8 5.8 0 0 0 10.2 21.8H12.2 M19.8 10.2H21.8A5.8 5.8 0 0 1 21.8 21.8H19.8', w: 3.6 },
  ],
  // Reputation badges (docs/design/reputation-layer.md §4; the boards' lens-rep.mjs REP_GLYPHS, its thin
  // tubes split into their own parts). They sit on the medallion's face, never in a tile.
  // First accepted test: a round seal plate with a check cut through it (not the My work tray).
  accepted: [{ f: 'M5 16a11 11 0 1 0 22 0a11 11 0 1 0 -22 0ZM12.36 14.04L14.43 16.12L19.78 10.31A2.2 2.2 0 0 1 23.02 13.29L14.57 22.48L9.24 17.16A2.2 2.2 0 0 1 12.36 14.04Z' }],
  // Reliable tester: a tuning fork tilted 15°, the reference others are tuned against (never a Y).
  reliable: [
    { s: 'M10.36 4.79L12.54 12.9A3.7 3.7 0 0 0 19.69 10.99L17.51 2.87', w: 4 },
    { s: 'M17.07 15.52L19.58 24.89', w: 3.8, f: 'M16.75 26.63a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0 -6.6 0Z' },
  ],
  // Helpful feedback: a note bubble with its tail and two ruled lines cut through.
  helpful: [
    { f: 'M8.6 5.6H23.4A3.4 3.4 0 0 1 26.8 9V18.4A3.4 3.4 0 0 1 23.4 21.8H15L9.6 26.6A0.7 0.7 0 0 1 8.4 26.1V21.8A3.4 3.4 0 0 1 5.2 18.4V9A3.4 3.4 0 0 1 8.6 5.6ZM10.2 12.5L21.8 12.5A1.1 1.1 0 0 0 21.8 10.3L10.2 10.3A1.1 1.1 0 0 0 10.2 12.5ZM10.2 17.1L17 17.1A1.1 1.1 0 0 0 17 14.9L10.2 14.9A1.1 1.1 0 0 0 10.2 17.1Z' },
  ],
  // Device specialist: the device slab with a loupe standing in front of its lower right.
  deviceSpec: [
    { f: 'M9 3.2H17a3.6 3.6 0 0 1 3.6 3.6V23.2a3.6 3.6 0 0 1 -3.6 3.6H9a3.6 3.6 0 0 1 -3.6 -3.6V6.8a3.6 3.6 0 0 1 3.6 -3.6ZM9.4 6.9H16.6a1.5 1.5 0 0 1 1.5 1.5V20a1.5 1.5 0 0 1 -1.5 1.5H9.4a1.5 1.5 0 0 1 -1.5 -1.5V8.4a1.5 1.5 0 0 1 1.5 -1.5ZM11.2 5.7L14.8 5.7A0.65 0.65 0 0 0 14.8 4.4L11.2 4.4A0.65 0.65 0 0 0 11.2 5.7Z' },
    { s: 'M15.7 19.6a4.9 4.9 0 1 0 9.8 0a4.9 4.9 0 1 0 -9.8 0Z', w: 3.4 },
    { f: 'M22.96 24.64L26.06 27.74A1.9 1.9 0 0 0 28.74 25.06L25.64 21.96A1.9 1.9 0 0 0 22.96 24.64Z' },
  ],
  // S6 (A-Disputes "balance weighs"): DISPUTES_PARTS, the disputes glyph above in four pieces. The
  // post and the beam are its first two parts verbatim; the pans are its third part split in two.
  dPost: [{ s: 'M16 9v14.5', w: 4, f: 'M12.4 23.6H19.6a1.9 1.9 0 0 1 1.9 1.9V25.5a1.9 1.9 0 0 1 -1.9 1.9H12.4a1.9 1.9 0 0 1 -1.9 -1.9V25.5a1.9 1.9 0 0 1 1.9 -1.9Z' }],
  dBeam: [{ s: 'M7 11.6L25 9.4', w: 3.4, f: 'M13.7 8.3a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0Z' }],
  dPanL: [{ s: 'M7 11.6L4.3 18.5 M7 11.6L9.7 18.5', w: 1.7, f: 'M3.6 18.5h6.8a3.4 3.4 0 0 1-6.8 0Z' }],
  dPanR: [{ s: 'M25 9.4L22.3 16.3 M25 9.4L27.7 16.3', w: 1.7, f: 'M21.6 16.3h6.8a3.4 3.4 0 0 1-6.8 0Z' }],
} as const satisfies Record<string, readonly GlyphPart[]>;

export type GlyphName = keyof typeof GLYPHS;
export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];

/** Names used before round 4, mapped to the one source name (lens-glyphs.mjs ALIASES). Never add new aliases. */
export const ALIASES = { ext: 'external', rocket: 'publish', arrow: 'forward', recIdle: 'recordIdle' } as const satisfies Record<string, GlyphName>;
export type GlyphAlias = keyof typeof ALIASES;

/** The source name for a glyph name or a legacy alias. */
export function resolveGlyph(name: GlyphName | GlyphAlias): GlyphName {
  return (ALIASES as Record<string, GlyphName>)[name] ?? (name as GlyphName);
}
