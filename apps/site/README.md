# Product page

Penny's public product page: one static page, served by Cloudflare Workers static assets (no Worker script, no server).

Each section pairs real app screens in device frames with a live **3D Gaussian splat** scene that sits around them and morphs into the next one as you scroll:

| Section | Screens (`src/assets/screens`) | Splat scene (`src/scenes`) |
| --- | --- | --- |
| Intro | | `nebula`: warm dust that condenses into the coin on load |
| Hero | | `coin`: a minted copper coin with the app icon's leaf in relief |
| Overview | iPhone home | `rings`: orbits in the overview's colours with small coins |
| Insights | web Insights (money flow) | `flow`: the money-flow ribbons streaming out of the browser |
| Entries | iPhone split, receipt inbox | `papers`: receipts caught in a slow vortex |
| Apps | web home, iPhone home | `loop`: a figure-eight sync loop between the devices |
| Together | iPhone household, trip | `trio`: three coins in different metals |
| Self-host | terminal | `coin` again |

## Screens

- `web-*.webp`: the real web app (`apps/web`) in its demo mode (sample data, no account), dark appearance, captured at 2×.
- `iphone-*.webp`: the native app's design renders from `docs/design/penny-ios/previews` (dark), cropped to the screen. The web demo has no shared households or trips, and the iOS simulator doesn't run on Linux.

`scripts/capture-screens.ts` re-captures the web screens; its header has the crop and WebP commands. Icons are the apps' own (Ionicons v7 outline, MIT, from `design-kit/src/icons.ts`), inlined into the HTML at build time; the typeface is the apps' Inter (OFL), subset to Latin as WOFF2.

Short pre-rendered clips of the apps in use are planned for four frames: see [docs/product-videos.md](docs/product-videos.md) for the license check, the approved storyboard and the pipeline outline.

## How the splats work

- **Generated, not captured.** Each scene is a deterministic generator (seeded PRNG, Vogel and R2 low-discrepancy surface sampling, so surfaces have no holes) that emits standard 3DGS splats: centre, per-axis scale, rotation, colour and opacity, plus a surface normal and how much the splat is lit. Generation runs in a Web Worker; scenes are posted one by one, so the coin shows while the rest build. 160 000 splats per scene, 70 000 on phones and devices with `deviceMemory < 4`. Nothing is downloaded but ~35 kB of JavaScript.
- **Our own renderer** (`src/splats`, WebGL2, no dependencies): each splat's 3D covariance is projected to a screen-space ellipse with the camera Jacobian (Kerbl et al. 2023) and blended back to front, sorted every frame in the worker with a 16-bit counting sort. Splats smaller than a pixel keep their energy instead of turning into hard dots (the Mip-Splatting 2D filter), which keeps edges smooth. It renders at the device's full resolution (up to 2×), stepping down only while frames are slow.
- **Lighting.** Splats with a normal are lit in the vertex shader: a warm key light, a cool rim light and a fresnel sheen, with metal-tinted highlights. The coin's domed faces, bevel and reeded rim catch the light as it turns.
- **Morphing.** Every scene has the same splat count and the same left-to-right order, so splat *i* of one scene flies to splat *i* of the next, after a delay that follows that order, swinging out of its path and shrinking to a spark mid-flight. `src/splats/morph.ts` and the shader implement the same formula; the sort uses the former.
- **Placement** (`src/choreography.ts`). Each section has a `data-stage` (its scene) and a `[data-splat]` box with a `data-fit` scale. Every frame the camera's distance and lens shift put the scene on that box, so the scene stays attached to the screenshots as the page scrolls, and travels from one box to the next during a morph.
- **Fallbacks.** `prefers-reduced-motion` gets still scenes that switch without the flight. Without WebGL2 the coin boxes show the app icon. `?splats=N` overrides the splat count for profiling.

## Documentation (`/docs`)

The site also serves the public documentation: the self-hosting guides and the app guide from the repository's `docs/`, as static pages in the page's look. Nothing is copied: the build renders the Markdown at the commit being deployed, so the pages always match `docs/`.

- `scripts/docs/pages.ts` lists the published documents, their URLs, sidebar labels and summaries. To publish another document, add it there. Development notes, plans, references and design cards stay on GitHub.
- `scripts/docs/render.ts` renders them with [marked](https://marked.js.org) (build time only):
  - Headings get GitHub's anchors, so links written for GitHub keep working.
  - Links to published documents stay under `/docs/`, and links to anything else in the repository go to GitHub.
  - The breadcrumb line under each title, written for GitHub readers, is dropped: the sidebar replaces it.
- `scripts/docs/plugin.ts` serves the pages on the dev server (`/docs/`, reloading when a document changes) and writes them into `dist/docs/` at build time. The stylesheet is `src/docs/docs.css`, which shares `src/tokens.css` with the page, and the pages ship no JavaScript.
- `npm test` checks that every link in the published documents leads somewhere: a published page and its heading, a heading on the same page, or a file that exists in the repository.

## Develop

```bash
npm --prefix apps/site ci
npm --prefix apps/site run dev          # Vite dev server
npm --prefix apps/site run lint
npm --prefix apps/site run typecheck
npm --prefix apps/site test             # generators, lighting data, sorting, morph, placement, .ply export
npm --prefix apps/site run build        # static site in apps/site/dist
```

To look at a scene in a splat editor (SuperSplat, for example), or to replace a generated scene with a captured or Blender-made one, export the scenes as standard 3DGS `.ply` files:

```bash
npm --prefix apps/site run splats:export -- 160000 /tmp/penny-splats
```

A replacement scene must have the same splat count as the others; `buildScene` sorts it into the shared morph order.

## Deploy

```bash
cd apps/site
npx wrangler login         # or CLOUDFLARE_API_TOKEN scoped to Workers for this account
npm run deploy             # vite build, then wrangler deploy of ./dist
```

`wrangler.toml` has no routes: attach a custom domain in the Cloudflare dashboard (Workers & Pages → `penny-site` → Domains & Routes) or add a `routes` entry. `public/_headers` sets a strict Content-Security-Policy and long-lived caching for the hashed `/assets/*`. CI builds and dry-runs the deploy but never holds Cloudflare credentials.
