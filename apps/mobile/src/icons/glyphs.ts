// Lens extruded glass glyphs (Direction A v2, spec §7). Geometry is copied verbatim from the
// design boards: the shared set from the system board (Main.dc.html, generated from
// lens-glyphs.mjs) and the screen-local glyphs from the screen boards named in each comment.
// Only `unlink` is new (no board draws it); it is built from `link` in the same language.
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
  // Credits (Coins): one thick coin, edge on, ribbed rim and a struck ring on its lit face.
  credits: [
    { f: 'M5.5 12.9A10.5 5.2 0 0 0 26.5 12.9V19.9A10.5 5.2 0 0 1 5.5 19.9ZM8.45 18.76L8.45 21.96A0.75 0.75 0 0 0 9.95 21.96L9.95 18.76A0.75 0.75 0 0 0 8.45 18.76ZM11.85 19.72L11.85 22.92A0.75 0.75 0 0 0 13.35 22.92L13.35 19.72A0.75 0.75 0 0 0 11.85 19.72ZM15.25 20L15.25 23.2A0.75 0.75 0 0 0 16.75 23.2L16.75 20A0.75 0.75 0 0 0 15.25 20ZM18.65 19.72L18.65 22.92A0.75 0.75 0 0 0 20.15 22.92L20.15 19.72A0.75 0.75 0 0 0 18.65 19.72ZM22.05 18.76L22.05 21.96A0.75 0.75 0 0 0 23.55 21.96L23.55 18.76A0.75 0.75 0 0 0 22.05 18.76Z' },
    { f: 'M5.5 11.2a10.5 5.2 0 1 0 21 0a10.5 5.2 0 1 0 -21 0ZM8.6 11.2a7.4 3.5 0 1 0 14.8 0a7.4 3.5 0 1 0 -14.8 0ZM9.9 11.2a6.1 2.75 0 1 0 12.2 0a6.1 2.75 0 1 0 -12.2 0Z' },
  ],
  // Budget: an offset stack of three coins.
  budget: [
    { f: 'M9.2 18.4a8 3.4 0 1 0 16 0a8 3.4 0 1 0 -16 0ZM9.2 19.8A8 3.4 0 0 0 25.2 19.8V23.2A8 3.4 0 0 1 9.2 23.2Z' },
    { f: 'M6.6 12.8a8 3.4 0 1 0 16 0a8 3.4 0 1 0 -16 0ZM6.6 14.2A8 3.4 0 0 0 22.6 14.2V17.6A8 3.4 0 0 1 6.6 17.6Z' },
    { f: 'M8.8 7.2a8 3.4 0 1 0 16 0a8 3.4 0 1 0 -16 0ZM8.8 8.6A8 3.4 0 0 0 24.8 8.6V12A8 3.4 0 0 1 8.8 12Z' },
  ],
  // Settings: two rotary dials with pointer cuts, the small one in front.
  settings: [
    { f: 'M4.4 12.5a7.6 7.6 0 1 0 15.2 0a7.6 7.6 0 1 0 -15.2 0ZM11.64 10.66L9.24 8.26A1.05 1.05 0 0 0 7.76 9.74L10.16 12.14A1.05 1.05 0 0 0 11.64 10.66Z' },
    { f: 'M15.2 20.6a5.4 5.4 0 1 0 10.8 0a5.4 5.4 0 1 0 -10.8 0ZM22.07 20.47L23.57 18.97A0.95 0.95 0 0 0 22.23 17.63L20.73 19.13A0.95 0.95 0 0 0 22.07 20.47Z' },
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
  // Link devnet wallet (Link2): the bar behind, two open links in front.
  link: [
    { s: 'M12 16H20', w: 3.2 },
    { s: 'M13.2 10.2H10.8A5.8 5.8 0 0 0 10.8 21.8H13.2 M18.8 10.2H21.2A5.8 5.8 0 0 1 21.2 21.8H18.8', w: 3.6 },
  ],
  // Sign in (LogIn): a ring open to the left, an arrow entering it.
  signIn: [
    { s: 'M10.4 9.6A9.2 9.2 0 1 1 10.4 22.4', w: 3.6 },
    { s: 'M4.4 16H12.4', w: 3.6 },
    { f: 'M12.6 10.9a1.1 1.1 0 0 1 1.8-.85l6.1 5.1a1.1 1.1 0 0 1 0 1.7l-6.1 5.1a1.1 1.1 0 0 1-1.8-.85Z' },
  ],
  // Create account (UserPlus): a bust in solid glass, the plus behind its shoulder.
  join: [
    { s: 'M24.9 7v9.4 M20.2 11.7h9.4', w: 3.8 },
    { f: 'M4.4 27.4C4.4 22 8.1 18.9 12.7 18.9S21 22 21 27.4Z' },
    { f: 'M7.4 11.4a5.3 5.3 0 1 0 10.6 0a5.3 5.3 0 1 0 -10.6 0Z' },
  ],
  // Sign out (LogOut): a door bracket, the arrow leaving it.
  signOut: [
    { s: 'M13.5 6.5H9.4A2.4 2.4 0 0 0 7 8.9V23.1A2.4 2.4 0 0 0 9.4 25.5H13.5', w: 3.6 },
    { f: 'M13.4 13.9H19.4V9.8L26.6 16L19.4 22.2V18.1H13.4Z' },
  ],
  // Save: a disk with a chamfered corner and a label window cut through, the shutter proud.
  save: [
    { f: 'M8.6 5.5H20.2L26.5 11.8V24A2.5 2.5 0 0 1 24 26.5H8.6A2.5 2.5 0 0 1 6.1 24V8A2.5 2.5 0 0 1 8.6 5.5ZM11.8 17.2H20.8a1.4 1.4 0 0 1 1.4 1.4V21.8a1.4 1.4 0 0 1 -1.4 1.4H11.8a1.4 1.4 0 0 1 -1.4 -1.4V18.6a1.4 1.4 0 0 1 1.4 -1.4Z' },
    { f: 'M11.8 5.5H17.6a1.2 1.2 0 0 1 1.2 1.2V10.1a1.2 1.2 0 0 1 -1.2 1.2H11.8a1.2 1.2 0 0 1 -1.2 -1.2V6.7a1.2 1.2 0 0 1 1.2 -1.2Z' },
  ],
  // Export my data (Download): a tray, the arrow dropping into it.
  download: [
    { s: 'M6.5 19.4V23A2.5 2.5 0 0 0 9 25.5H23A2.5 2.5 0 0 0 25.5 23V19.4', w: 3.6 },
    { f: 'M13.9 5.2H18.1V13H22.3L16 20.2L9.7 13H13.9Z' },
  ],
  // Attach (Paperclip): two nested wire loops, tilted 28deg into the key light.
  attach: [
    { s: 'M23.41 14.84L18.72 23.67A5.6 5.6 0 0 1 8.83 18.41L14.88 7.02A3.4 3.4 0 0 1 20.89 10.22L15.72 19.93', w: 2.9 },
  ],
  // Upload: an open tray, the arrow standing proud in front of it.
  upload: [
    { s: 'M7 18.6v3.9a3.2 3.2 0 0 0 3.2 3.2h11.6a3.2 3.2 0 0 0 3.2-3.2v-3.9', w: 3.6 },
    { s: 'M16 20.2V7.2 M10.9 12.1L16 7l5.1 5.1', w: 4 },
  ],
  // Withdrawn EmptyState (Circle): a plain glass ring.
  ring: [
    { s: 'M16 6.2a9.8 9.8 0 1 1 0 19.6a9.8 9.8 0 1 1 0-19.6Z', w: 4 },
  ],
  // Plus (A-NewStudy, A-States).
  plus: [
    { s: 'M16 8V24 M8 16H24', w: 4.4 },
  ],
  // Pause: two rounded bars, one volume (A-States).
  pause: [
    { f: 'M10.6 7.4H12a2 2 0 0 1 2 2V22.6a2 2 0 0 1 -2 2H10.6a2 2 0 0 1 -2 -2V9.4a2 2 0 0 1 2 -2ZM20 7.4H21.4a2 2 0 0 1 2 2V22.6a2 2 0 0 1 -2 2H20a2 2 0 0 1 -2 -2V9.4a2 2 0 0 1 2 -2Z' },
  ],
  // Close study (Ban): a ring tube with the bar standing in front (A-States).
  ban: [
    { s: 'M6.2 16a9.8 9.8 0 1 0 19.6 0a9.8 9.8 0 1 0 -19.6 0Z', w: 3.6 },
    { s: 'M9.2 22.8L22.8 9.2', w: 3.6 },
  ],
  // Participants (Users): the second person behind and to the right (A-States).
  users: [
    { f: 'M17.7 10.6a3.7 3.7 0 1 0 7.4 0a3.7 3.7 0 1 0 -7.4 0ZM15.2 25.4V24.6A6.2 6.2 0 0 1 27.6 24.6V25.4A1.2 1.2 0 0 1 26.4 26.6H16.4A1.2 1.2 0 0 1 15.2 25.4Z' },
    { f: 'M7.9 12.2a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0ZM4.4 26.4V25.8A8 8 0 0 1 20.4 25.8V26.4A1.4 1.4 0 0 1 19 27.8H5.8A1.4 1.4 0 0 1 4.4 26.4Z' },
  ],
  // Publish (Rocket): fins behind, a body with the window cut through, a nozzle block (A-States).
  rocket: [
    { f: 'M10.2 16.4L6.4 20.6V25.4L10.6 22.6Z M21.8 16.4L25.6 20.6V25.4L21.4 22.6Z' },
    { f: 'M16 3.8C19.9 6.6 21.8 10.8 21.8 15.4V22.8A1.4 1.4 0 0 1 20.4 24.2H11.6A1.4 1.4 0 0 1 10.2 22.8V15.4C10.2 10.8 12.1 6.6 16 3.8ZM13.5 12.8a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0Z' },
    { f: 'M14.8 25.2H17.2a1.4 1.4 0 0 1 1.4 1.4V27a1.4 1.4 0 0 1 -1.4 1.4H14.8a1.4 1.4 0 0 1 -1.4 -1.4V26.6a1.4 1.4 0 0 1 1.4 -1.4Z' },
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
  // Continue (ArrowRight) (A-Study).
  arrow: [
    { s: 'M6.5 16H24.2 M17.2 8.8l7.2 7.2-7.2 7.2', w: 4.4 },
  ],
  // Not allowed (Lock): the shackle behind, a body with the keyhole cut through (A-States).
  lock: [
    { s: 'M11.2 14.6V11.4a4.8 4.8 0 0 1 9.6 0v3.2', w: 3.4 },
    { f: 'M10.4 13.6H21.6a3.2 3.2 0 0 1 3.2 3.2V24.4a3.2 3.2 0 0 1 -3.2 3.2H10.4a3.2 3.2 0 0 1 -3.2 -3.2V16.8a3.2 3.2 0 0 1 3.2 -3.2ZM14.6 18.6L14.6 22.6A1.4 1.4 0 0 0 17.4 22.6L17.4 18.6A1.4 1.4 0 0 0 14.6 18.6Z' },
  ],
  // You're offline (WifiOff): three signal arcs and the source dot, the cut bar in front (A-States).
  offline: [
    { s: 'M5.2 13.4a15.4 15.4 0 0 1 21.6 0 M9 17.3a9.8 9.8 0 0 1 14 0 M12.7 21.1a4.6 4.6 0 0 1 6.6 0', w: 3.1, f: 'M14.1 25.2a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0Z' },
    { s: 'M7 6.2L25.4 25.6', w: 3.4 },
  ],
  // Retry (RefreshCw): two arcs round one axle, the corner hooks in front (A-States).
  refresh: [
    { s: 'M24.8 14A9 9 0 0 0 8.6 10.6 M7.2 18A9 9 0 0 0 23.4 21.4', w: 3.3 },
    { s: 'M8 5.6V11.2H13.6 M24 26.4V20.8H18.4', w: 3.3 },
  ],
  // Unlink wallet (Unlink). New: the Link2 brackets pulled 0.8 apart with no bar between them, and
  // two short break ticks standing behind the gap. Same tube widths as `link`.
  unlink: [
    { s: 'M16 6.6V9.4 M16 22.6V25.4', w: 2.4 },
    { s: 'M12.4 10.2H10A5.8 5.8 0 0 0 10 21.8H12.4 M19.6 10.2H22A5.8 5.8 0 0 1 22 21.8H19.6', w: 3.6 },
  ],
} as const satisfies Record<string, readonly GlyphPart[]>;

export type GlyphName = keyof typeof GLYPHS;
export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];
