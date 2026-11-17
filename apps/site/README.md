# Product page

Penny's public product page: one static page, served by Cloudflare Workers static assets (no Worker script, no server). Its hero and section art are live **3D Gaussian splats** that morph into each other as you scroll:

| Section | Scene (`src/scenes`) |
| --- | --- |
| Intro | `nebula`: warm dust that condenses into the coin when the page loads |
| Hero, overview | `coin`: a copper coin with the app icon's leaf embossed, spinning |
| Follow your money | `flow`: the money-flow (Sankey) diagram in depth |
| Add it, split it, keep the receipt | `receipt`: the README's 74.40 dinner, split three ways, printed in a 5×7 font |
| Apps | `devices`: an iPhone and a browser window showing Penny, synced through a server |
| Together, self-host | `coin` again |

## How it works

- **The splats are generated, not captured.** Each scene is a deterministic generator (seeded PRNG, low-discrepancy surface sampling) that emits standard 3DGS splats: centre, per-axis scale, rotation quaternion, colour and opacity. Generation runs in a Web Worker on load (about 1 s for 5 × 120 000 splats on a laptop; phones and `deviceMemory < 4` get 60 000). Nothing is downloaded but ~35 kB of JavaScript.
- **The renderer is ours** (`src/splats`): WebGL2, one instanced draw per frame, no dependencies. The vertex shader projects each splat's 3D covariance to a screen-space ellipse with the camera Jacobian (Kerbl et al. 2023), and splats are blended back to front, sorted every frame in the worker with a 16-bit counting sort.
- **Morphing.** Every scene has the same splat count and the same left-to-right order, so splat *i* of one scene flies to splat *i* of the next. Each splat starts after a delay that follows that order, swings out of its path and shrinks to a spark mid-flight, so a morph sweeps across the frame. `src/splats/morph.ts` and the shader implement the same formula; the sort uses the former.
- **Choreography** (`src/choreography.ts`): each section's `data-stage` picks a scene; scrolling between two sections scrubs the morph, holding each scene while its section is in view. Each scene also has a slow resting motion.
- **Fallbacks.** `prefers-reduced-motion` gets still scenes that switch without the flight. Without WebGL2 the page shows the logo over the glow. `?splats=N` overrides the splat count for profiling.

## Develop

```bash
npm --prefix apps/site ci
npm --prefix apps/site run dev          # Vite dev server
npm --prefix apps/site run lint
npm --prefix apps/site run typecheck
npm --prefix apps/site test             # generators, sorting, morph, choreography, .ply export
npm --prefix apps/site run build        # static site in apps/site/dist
```

The page shows the README screenshots straight from `docs/screenshots`, so they stay in sync with the README.

To look at a scene in a splat editor (SuperSplat, for example) or to replace a generated scene with a captured or Blender-made one, export the scenes as standard 3DGS `.ply` files:

```bash
npm --prefix apps/site run splats:export -- 120000 /tmp/penny-splats
```

A replacement scene must have the same splat count as the others; `buildScenes` sorts it into the shared morph order.

## Deploy

```bash
cd apps/site
npx wrangler login         # or CLOUDFLARE_API_TOKEN scoped to Workers for this account
npm run deploy             # vite build, then wrangler deploy of ./dist
```

`wrangler.toml` has no routes: attach a custom domain in the Cloudflare dashboard (Workers & Pages → `penny-site` → Domains & Routes) or add a `routes` entry. `public/_headers` sets a strict Content-Security-Policy and long-lived caching for the hashed `/assets/*`. CI builds and dry-runs the deploy but never holds Cloudflare credentials.
