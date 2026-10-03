# Textures

## `grain-256.png`

The Lens grain tile (Direction A §4 and §12): 256×256, tileable, pre-tinted pale blue-white specks with straight alpha, drawn with normal blending. `src/glass/Grain.tsx` repeats it at the spec's opacities: 0.064 on the ground, 0.056 on cards, 0.128 on the fluted lens (`glass.grain` in `src/theme/tokens.ts`).

It is generated, not drawn. To regenerate it, or to check that the committed file matches the generator, run:

```sh
node apps/mobile/scripts/gen-grain.mjs           # writes the tile
node apps/mobile/scripts/gen-grain.mjs --check   # exits 1 if the committed tile differs
```

The script evaluates the boards' SVG grain filter once, as a browser would, and stores the result:

- `feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"`: the SVG 1.1 reference noise, seed 0, stitched so the tile has no seams.
- `feColorMatrix` with alpha = 1.8 × R − 0.62 and a constant tint of (0.86, 0.88, 1) in linearRGB. That tint is `#EFF1FF` in sRGB.

The output is byte-for-byte deterministic. The PNG is palette-indexed: 256 copies of the tint, each with its own alpha. That keeps it at about 60 KB.

React Native can't run SVG filters, so a raster tile is the only faithful option. Each texel is one dp, which matches the boards, where grain is drawn in CSS pixels.
