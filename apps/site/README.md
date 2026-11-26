# Product page

Penny's public product page: one static page, served by Cloudflare Workers static assets (no Worker script, no server).

The page follows the design in [docs/design](docs/design/README.md): the product above the fold, a showcase, a grid of feature tiles, principles, self-hosting and a closing call to action. Sections size to their content; nothing is a full screen per feature.

| Section | What's in it |
| --- | --- |
| Hero | The headline and calls to action, and the **coin** (splat scene `coin`): a copper coin with the app icon's leaf in relief |
| Showcase | The web app (Insights clip) and the iPhone home, with the **money-flow ribbons** (splat scene `flow`) streaming behind them |
| Features | The bento: Left to spend (Overview clip), Split (Entries clip), receipts, search, households and trips, recurring, widgets, Face ID, offline and sign-in. Each tile shows a real screen cropped to the part that matters |
| Principles | Your server, no bank connection, open source |
| Self-host | Three steps and the terminal, linking to `/docs` |

## Screens

- `web-insights*.webp`: the real web app (`apps/web`) in its demo mode (sample data, no account), dark appearance, captured at 2×.
- `iphone-*.webp`: the native app's design renders from `docs/design/penny-ios/previews` (dark), cropped to the screen at full size (804 × 1748), because the iOS simulator doesn't run on Linux. Tiles crop them further with `object-position` (`--crop`), so a clip laid over a still crops the same way.
- `widgets.webp`: the widgets from the iOS design's `system-widgets` card.

`scripts/capture-screens.ts` re-captures the web screens; its header has the crop and WebP commands. Icons are the apps' own (Ionicons v7 outline, MIT, from `design-kit/src/icons.ts`), inlined into the HTML at build time; the typeface is the apps' Inter (OFL), subset to Latin as WOFF2.

## Clips of the apps in use

Three frames play a short loop of the app in use instead of their still: the showcase's browser and the Left to spend and Split tiles. [docs/product-videos.md](docs/product-videos.md) has the storyboard, the license check (Remotion, free license) and the owner's decisions.

| Clip | Frame | Source | Status |
| --- | --- | --- | --- |
| `insights` | Showcase, browser | web demo | rendered |
| `overview` | Left to spend tile | iOS simulator | rendered |
| `entries` | Split tile | iOS simulator | rendered |
| `apps` | none in the redesign | web demo | rendered, not placed |

**On the page** (`src/clips.ts`, about 1.5 kB gzipped). A frame opts in with `data-clip="<id>"`; its captions are the `<ol data-clip-captions="<id>">` beside it, HTML rather than words in the video, with `data-at` seconds for the beat each one describes. When the section is about a screen away, the loader lays a `<video muted loop playsinline>` over the still (AV1 WebM, then H.264 MP4 for Safari; the 720-pixel variants below 701 CSS px) and fades it in once it plays. It plays only in view, pauses when the tab is hidden, and has a pause button (WCAG 2.2.2). Reduced motion, Save-Data (`navigator.connection.saveData` or `prefers-reduced-data`), no JavaScript, or no playable format keep the still; captions show for every clip that's rendered. A slot without files keeps its still and hides its captions. The tiles have no caption lists: their headings say what the clip shows.

**The files** are committed in `src/assets/clips`: `<id>.webm`, `<id>.mp4`, `<id>-720.webm`, `<id>-720.mp4` (browser frames only) and `<id>-poster.webp`. `npm test` checks each against its budget in `video/src/clips.ts`.

**Rendering** happens in `video/`, its own package (Remotion, used at render time only; the page never loads it):

```bash
npm --prefix apps/web ci && npm --prefix apps/site/video ci
npm --prefix apps/web run dev                    # note the port it prints
cd apps/site/video
PENNY_WEB_ORIGIN=http://localhost:<port> npm run capture:web   # captures/<clip>: 2× frames + capture.json
npm run render                                   # out/<clip>.mp4 master, then the files above
npm run studio                                   # optional: preview and tune the compositions
```

- The capture drives the demo with Playwright and records Chromium's screencast at 2×, plus a timeline (`capture.json`): the time of each step and the box of the element involved. The compositions (`src/clips/*.tsx`) put the camera, the highlight ring and the cursor (`src/lib/`, Penny's own code) on those boxes, so they follow the real layout. Every clip starts and ends on the full screen, so the loop doesn't jump.
- `render` needs ffmpeg with libsvtav1, libx264 and libwebp (`FFMPEG` overrides the one on `PATH`) and fails when a file is over budget. On NixOS, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` and `REMOTION_CHROME` to a system Chromium.
- Re-capture and re-render after a visible change to Insights, Home, search or Activity, then refresh the stills with `scripts/capture-screens.ts` so the still and the clip match.

**The iOS clips** (`overview`, `entries`) are recorded on the Mac from the iOS demo (synthetic sample data, no server), with Xcode as in `apps/ios/AGENTS.md`:

```bash
cd apps/site/video
npm run capture:ios                              # captures/overview, captures/entries
npm run render overview entries
```

- `capture/ios.ts` copies `capture/ios/ClipCaptureTests.swift` into `apps/ios/PennyUITests/Clips` for the run only (it's removed when the script ends, so the iOS project never carries it) and runs it with `apps/ios/scripts/ios.sh ui-test full` on that script's own throwaway iPhone simulator. Once the simulator boots, it sets the status bar to 9:41 and records the screen with `simctl io recordVideo`.
- The tests wait for the recording, drive the demo in the dark appearance, and write each step's wall-clock time and the element's frame in points. The script cuts each clip's stretch out of the recording into 2× frames at 60 fps, plus `capture.json` in the web capture's format.
- UI tests tap slower than a person, so the iOS compositions fit the recording to the storyboard's beats with `retime` (`src/capture.ts`). Screen recordings leave out the simulator's touch indicator, so `src/lib/Touch.tsx` draws one on each tap. A clip that ends in another state than it starts (a sheet open, an entry added) fades back to its first frame (`src/lib/LoopBack.tsx`).
- Re-capture after a visible change to Home, Add entry or Split.

## How the splats work

Two scenes, each in its own canvas inside its section (`[data-scene]`), so they scroll with the page: the **coin** in the hero and the **ribbons** behind the showcase. `src/splats/stage.ts` mounts them.

- **Generated, not captured.** Each scene is a deterministic generator that emits standard 3DGS splats: centre, per-axis scale, rotation, colour and opacity, plus a surface normal, how much it's lit and how far it drifts. A Web Worker per scene builds it. About 64 000 splats for the coin and 40 000 for the ribbons, 26 000 and 16 000 on phones and devices with `deviceMemory < 4`. Nothing is downloaded but the page's JavaScript.
- **Our own renderer** (`src/splats`, WebGL2, no dependencies): each splat's 3D covariance is projected to a screen-space ellipse with the camera Jacobian (Kerbl et al. 2023). Splats smaller than a pixel keep their energy instead of turning into hard dots (the Mip-Splatting 2D filter). It always renders at the device's resolution, up to 2×, and never steps down.
- **The coin** is a solid object, blended back to front and sorted every frame in its worker (a 16-bit counting sort). Its splats are lit in the vertex shader: a warm key light, a cool rim light and a fresnel sheen, with a broad and a tight metal highlight. Normals are half floats, because 8-bit normals band the highlight. Every face splat has the same colour, so only the lighting varies it. Splats that straddle the leaf's outline are split into four smaller ones, so the edge is crisp. The leaf is domed across its width, so it reads as relief. The dust is a few hundred faint, soft motes, the only splats that drift.
- **The ribbons** are light: drawn additively, so they need no sorting. Each band is a regular grid of round splats that overlap about ten deep at low opacity. That sums to an even, glowing band, with soft outer rows and a faint bloom along the centre.
- **Only while it's seen.** A scene renders only while its section is on screen and the tab is visible. The coin sways (the leaf always faces you) and the ribbons drift gently, with a little parallax from the pointer.
- **Fallbacks.** `prefers-reduced-motion` draws each scene once, still. Without WebGL2 the coin is the app icon in a glow, and the ribbons are left out. `?splats=N` sets the coin to N splats and the ribbons in proportion, for profiling.

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
npm --prefix apps/site run splats:export -- 64000 /tmp/penny-splats
```

A replacement scene can have any splat count. It needs the same fields as a generated one, including lighting and drift (`src/splats/cloud.ts`), and its entry in `src/splats/stage.ts`: budget, camera fit and resting motion.

## Deploy

```bash
cd apps/site
npx wrangler login         # or CLOUDFLARE_API_TOKEN scoped to Workers for this account
npm run deploy             # vite build, then wrangler deploy of ./dist
```

`wrangler.toml` has no routes: attach a custom domain in the Cloudflare dashboard (Workers & Pages → `penny-site` → Domains & Routes) or add a `routes` entry. `public/_headers` sets a strict Content-Security-Policy and long-lived caching for the hashed `/assets/*`. CI builds and dry-runs the deploy but never holds Cloudflare credentials.
