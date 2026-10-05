**Sequence** (milliseconds from the Approved notice appearing, full motion):

| Time | What | Duration · easing |
|---|---|---|
| +120 → 1380 | **U5**, Earned on the Approved notice (existing) | 560 ease-uplight, 700 ease-lens |
| 1380 → 2400 | **Reading beat.** In React Native the sheet also waits for 600 ms without a touch | — |
| 2400 | **The sheet rises.** Backdrop 0 → 1; key pool → 0.4 | `SPRING.sheet` (web 420 ease-lens); 320 ease-lens |
| 2400 → 2580 | **U5 hands over:** the notice's light goes to 0 | 180 ease-exit |
| 2940 | **The medallion lifts:** the lit layer translates (1, 2) → 0 and crossfades in | 560 ease-lens; 320 crossfade |
| 2940 → 4200 | **The U9 Earned grade** on the medallion: uplit layers and under-glow | 560 ease-uplight to 1, 700 ease-lens to 0.45 |
| 3360 | **One glint crosses the rim** (a 105° band masked to the bezel). On a tier-up, the newest bead seats as it passes | 560 ease-refract; seat 320 ease-lens |
| 4200 → | **At rest:** U9 at 0.45 while the sheet is open | static |

**The points never roll.** The sheet shows them as the recessed held chip ("+150 held"), present from the moment the sheet opens. Points from a fresh approval are held, and held points are never lit or animated. The number roll stays with credit balances (U5, U6).

**Tier-ups.** On a tier-up the medallion starts lit, showing the tier already held. Only the new bead, the stacked ring and the light mark the change; a badge the tester holds is never shown as locked.
| Done | The sheet leaves, U5 returns to 0.45, and the key pool returns to 0.72 | 240 ease-exit; 700 ease-lens |
