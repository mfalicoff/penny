# Product videos: licenses, storyboard and pipeline

Status: **proposal for the owner's review.** This is step 1 of the "apps in motion" work: nothing is rendered and no dependency is added yet. The owner approves or adjusts the [license findings](#1-licenses), the [storyboard](#2-storyboard) and the [pipeline](#3-pipeline-outline), and the build follows from that.

The goal is short pre-rendered clips of Penny's real screens, played inside the product page's existing device frames, with the splat scenes still around them. Only synthetic demo data appears: the web demo's sample data and the iOS demo.

## 1. Licenses

Checked on 2026-11-25. This summarises the published terms. It isn't legal advice.

### Remotion: usable for free if Penny's owner is an individual or a company of 3 people or fewer

Sources: [remotion.dev/docs/license](https://www.remotion.dev/docs/license), [LICENSE.md](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md), [pricing](https://www.remotion.dev/docs/license/pricing), [FAQ](https://www.remotion.dev/docs/license/faq).

- **Source-available, not open source.** The FAQ says Remotion is "source-available software, but it is not open source software according to the Open Source Initiative's Open Source Definition".
- **Who uses it for free:** "an individual; a for-profit organization with up to 3 employees; a non-profit or not-for-profit organization; evaluating whether Remotion is a good fit". Headcount is the organisation's total. Free users get every feature.
- **Above that, a Company License:** "Remotion for Creators" at $25 per month per seat for people making videos, and "Remotion for Automators" at $0.01 per render with a $100 monthly minimum. The two can be combined. Enterprise starts at $500 per month.
- **What we'd do is allowed:** the license allows use "non-commercially or commercially for the purpose of creating videos and images". The FAQ allows "any commercial use case ... as long as you are not selling Remotion as a product itself". Nothing restricts publishing the rendered clips or keeping our own compositions in a public repository. What's forbidden is copying or modifying Remotion's code to sell or relicense a derivative of Remotion. We won't vendor Remotion: it stays an npm dependency.
- **Telemetry:** the FAQ says client-side rendering telemetry can't be turned off, and that Remotion 5 makes telemetry mandatory for Automators customers. We render with the CLI on a developer's machine, not in the browser, and the page never loads Remotion, so visitors are never affected.
- **The license is changing:** LICENSE.md says "In Remotion 5.0, the license will slightly change". Recheck the terms when the pipeline is built.

**Verdict:** Penny can use Remotion under the free license **if the owner renders as an individual, or as a company of 3 people or fewer.** If Penny is ever developed by a larger company, that company needs a Creators seat per person who renders. **The owner confirms which case applies.**

### remocn: MIT, copying scene code is allowed

Sources: [LICENSE](https://github.com/Remocn/remocn/blob/main/LICENSE), [repository](https://github.com/Remocn/remocn), [terms, section 07](https://remocn.dev/legal), [remocn.dev](https://remocn.dev).

- The repository's LICENSE is the MIT License, "Copyright (c) 2026 Remocn". Its `package.json` has no `license` field. The LICENSE file and the site are the source.
- The site's terms (last updated November 18, 2026), section 07: "The free components in the registry are released under the MIT license". You can "copy them, modify them, and ship them in personal or commercial projects without attribution."
- Paid products (terms, section 08) are not MIT and can't be redistributed. We'd use only the free registry.
- remocn is a community project, "not affiliated with Remotion or shadcn". Its scenes are Remotion components, so Remotion's license applies to them too ("Remotion's own licence still applies to every library here").
- Geist is remocn's default font. We use Penny's Inter (OFL), which is already in `apps/site`.

**Verdict:** Penny can use remocn. Free scenes may be copied and adapted. We'd still keep the MIT notice in a header of any file adapted from a remocn scene, and add remocn to `public/licenses`, even though the terms waive attribution. Not checked: per-file notices inside remocn's `registry/` sources. Look again when copying a specific scene. Rebuilding the patterns ourselves (camera, highlight, cursor and caption, about 200 lines) is just as viable, and avoids `shadcn` tooling in a repository that doesn't use it. **Recommendation: rebuild the four patterns and borrow remocn's timings and easing as reference.**

## 2. Storyboard

Each clip plays in a device frame that already exists on the page, and replaces the still screenshot there. The still stays as the clip's poster.

| Section | Clip | Shows | Source | Length |
| --- | --- | --- | --- | --- |
| Intro, Hero | No | The splat coin already moves. The hero has no device frame. | | |
| Overview (iPhone home) | **Yes** | Adding an expense: Left to spend ticks down | iOS simulator (phase 2) | 7 s |
| Insights (web money flow) | **Yes** | Focusing bands in the money flow | Web demo (phase 1) | 7 s |
| Entries (iPhone split, receipt inbox) | **Yes**, first phone | Splitting a dinner three ways | iOS simulator (phase 2) | 6 s |
| Apps (web home, iPhone home) | **Yes**, browser | Searching every entry | Web demo (phase 1) | 6 s |
| Together (iPhone household, trip) | **Later** | A shared expense and the balances | iOS simulator (phase 2, optional) | 6 s |
| Self-host (terminal) | No | Text. A CSS typing effect would be a separate change. | | |

Four clips in the first round. Together is optional: it's the third iPhone clip, and the Entries clip already shows a split.

**Common rules for every clip:**

- **Seamless loop.** The last second eases the camera back to the first frame's framing and resets the UI state, so the loop doesn't jump.
- **Camera:** slow push-ins, at most 2× zoom, eased (`spring` with no overshoot, or ease-in-out). No rotation or 3D tilt: the splat scene around the frame already gives depth.
- **Highlights:** a soft Penny-orange (`#ff7a45`) ring that fades in around the element being used. At most one at a time.
- **Cursor (web only):** a soft white dot with a press ripple, moving on an eased curve. iOS clips use the simulator's touch indicator instead.
- **Captions:** at most two per clip, at most 6 words each, in Inter 600 on a dark pill at the bottom of the frame, burned into the video. The section's own text stays the full description. The captions below are drafts for the owner to rewrite.
- **Dark appearance, 2×**, matching the stills on the page today.
- **Synthetic data only:** the web demo's sample data and the iOS demo. Never a real account.

### Overview: "Add it in seconds" (iPhone, 7 s, phase 2)

The issue's "adding an entry". The phone frame shows the iPhone home.

| Time | Screen | Camera, highlight | Caption |
| --- | --- | --- | --- |
| 0.0 s (poster) | Home, Left to spend $1,116.65 | Full screen | |
| 1.0 s | Tap +, Add expense sheet rises | Push in 1.2× on the sheet | "Add it in seconds" |
| 2.0–4.0 s | Type 18.50, pick Food & drinks, Save | Highlight: amount, then the category | |
| 4.5 s | Saved toast, sheet closes | Ease out to full screen | |
| 5.0–6.0 s | Left to spend counts down to $1,098.15 | Highlight: Left to spend | "Your month, always current" |
| 6.0–7.0 s | Hold, then return to the first frame | | |

Rough frames (design renders until the simulator is recorded): [home](../../../docs/design/penny-ios/previews/iphone-home.dark.png), [add expense](../../../docs/design/penny-ios/previews/iphone-add-expense.dark.png), [saved toast](../../../docs/design/penny-ios/previews/iphone-saved-toast.dark.png).

To verify on the Mac: that the iOS demo saves an entry. The web demo doesn't (see [the blocker](#the-web-demo-cant-add-entries)). If the iOS demo doesn't either, record against a disposable `penny-env` server with a synthetic seeded account.

### Insights: "Follow every dollar" (web, 7 s, phase 1)

The issue's "money flow". The browser frame shows Insights.

| Time | Screen | Camera, highlight | Caption |
| --- | --- | --- | --- |
| 0.0 s (poster) | Insights, the full flow | Wide, slow push-in | "Follow every dollar from pay to spending" |
| 1.5 s | Cursor moves to Groceries | | |
| 2.5 s | Groceries selected: the other bands dim | Zoom 1.6× on the bands. Highlight: Groceries | "Select a band to focus it" |
| 4.0 s | Groceries cleared, Left over selected | Pan down to Left over. Highlight: Left over | |
| 5.0–7.0 s | Left over cleared | Ease back out to the poster framing | |

![Insights at 0 s: the full money flow, with the camera's starting frame and the cursor](storyboard/web-insights-1.webp)
![Insights at 2.5 s: Groceries selected, camera zoomed on the bands](storyboard/web-insights-2.webp)
![Insights at 5 s: Left over selected, camera easing back out](storyboard/web-insights-3.webp)

Dashed blue boxes are the camera's frame, orange boxes the highlights, and the white dot the cursor. The pill at the bottom is the caption. The caption placement will be tuned to sit below the flow, not on the category table.

### Entries: "Split it the way you paid" (iPhone, 6 s, phase 2)

The issue's "splitting a cost". It plays on the first phone of the pair. The receipt inbox phone stays still.

| Time | Screen | Camera, highlight | Caption |
| --- | --- | --- | --- |
| 0.0 s (poster) | A $74.40 dinner, not split yet | Full screen | |
| 1.0 s | Tap Split, choose Equally, add two people | Push in 1.3× on the split controls | "Split it the way you paid" |
| 3.0 s | Your share: $24.80 | Highlight: your share | "Only your share counts" |
| 4.5–6.0 s | Save, then back to the first frame | Ease out | |

Rough frames: [split](../../../docs/design/penny-ios/previews/iphone-split.dark.png), [entry detail](../../../docs/design/penny-ios/previews/iphone-entry-detail.dark.png).

### Apps: "Search every entry" (web, 6 s, phase 1)

The browser frame in Apps. The iPhone next to it stays still.

| Time | Screen | Camera, highlight | Caption |
| --- | --- | --- | --- |
| 0.0 s (poster) | Web home | Full page. Highlight: Left to spend | "Your month on the web" |
| 1.5 s | Cursor to the search field, types "groc" | Zoom 2× on the search field | "Search every entry from anywhere" |
| 3.5 s | Enter: Activity lists the matches across months | Ease out to the results | |
| 5.0–6.0 s | Clear the search, back to Home | Return to the poster framing | |

![Apps at 0 s: the web home, with Left to spend highlighted](storyboard/web-apps-1.webp)
![Apps at 2 s: "groc" typed in the search field, camera zoomed on it](storyboard/web-apps-2.webp)
![Apps at 4.5 s: Activity listing the two grocery entries](storyboard/web-apps-3.webp)

Alternative if the owner prefers it: the iPhone and the browser side by side, an entry added on the phone appearing on the web. That needs a real server for both apps and two recordings synchronised in Remotion, so it would come after the four clips above.

### Together: "Record it once" (iPhone, 6 s, optional, phase 2)

Add a shared expense to a household, then show the balances and the suggested payment. The web demo's household shows the same story:

![The web demo's Apartment household: two shared expenses, the balances and a suggested payment](storyboard/web-together.webp)

Rough iOS frames: [shared expense](../../../docs/design/penny-ios/previews/iphone-shared-expense-add.dark.png), [balances](../../../docs/design/penny-ios/previews/iphone-shared-balances.dark.png).

### The web demo can't add entries

![The web demo's New entry dialog: "The demo doesn't save entries"](storyboard/web-blocker-add-entry.webp)

The web demo refuses to save an entry, so no web clip shows adding one. The storyboard puts adding and splitting on the iPhone clips. If the owner wants a web add-entry clip too, record it against a disposable full-stack environment (`node scripts/test-env/penny-env.mjs up`) with a synthetic account, rather than changing the demo.

### Poster, reduced motion and Save-Data

- **Poster:** the clip's first frame, which is the screenshot the page shows today (re-rendered from the same capture, so the poster and the clip match exactly). The existing `<img>` stays in the HTML as the poster.
- **Reduced motion** (`prefers-reduced-motion: reduce`), **Save-Data** (`navigator.connection.saveData`, or `prefers-reduced-data` where supported), **no JavaScript**, and browsers that can't play either format: the still stays. No video is requested.
- **Pause:** each playing clip gets a small pause/play button in the frame's corner. A loop that plays for more than 5 seconds needs one (WCAG 2.2.2, Pause, Stop, Hide). Clips also pause when they scroll out of view or the tab is hidden.
- **Accessibility:** the clips have no audio. The `<video>` takes the still's `alt` as its `aria-label`, so screen readers hear the same description.

### Size budget

| Clip | Encoded size | AV1 WebM | H.264 MP4 (Safari) |
| --- | --- | --- | --- |
| Web (Insights, Apps) | 1440 × 900, 30 fps, 6–7 s | ≤ 1.2 MB | ≤ 2 MB |
| Web, phone widths | 720 × 450 (served below 700 px) | ≤ 0.4 MB | ≤ 0.7 MB |
| iPhone (Overview, Entries, Together) | 590 × 1284, 30 fps, 6–7 s | ≤ 0.8 MB | ≤ 1.3 MB |

- Frames display at most 720 CSS px wide (browser) and 290 CSS px wide (iPhone), so these sizes are 2× of the displayed size.
- A visitor downloads one format per clip, and only for sections they scroll near. For all four clips: at most about 4 MB on desktop in AV1 (6.6 MB in Safari's MP4), and about 2.4 MB on a phone.
- Posters add nothing: they're the screenshots already on the page.
- The page's JavaScript grows by about 1 kB (the loader below). No Remotion or React at run time.
- If the outputs are committed, the four clips take at most about 13 MB in the repository (both formats, both web sizes), and each re-render adds as much again to the history.

## 3. Pipeline outline

Not built in this step. This is what the next step would add.

```text
apps/site/video/                 its own package.json and lockfile (Remotion, React, Playwright from apps/web)
  capture/web.ts                 drives the web demo, records frames and a timeline
  capture/ios.sh                 Mac only: simulator recording through an XCUITest
  captures/                      raw recordings (gitignored)
  src/Root.tsx                   one <Composition> per clip
  src/clips/*.tsx                insights, apps, overview, entries (together)
  src/lib/                       camera, highlight, cursor, caption (rebuilt remocn-style patterns)
  render.mjs                     renders every clip, then encodes AV1 WebM, H.264 MP4 and the poster
apps/site/src/assets/clips/      the encoded clips and posters the page imports
```

### Capture

- **Web** (`capture/web.ts`, Linux): starts from the same demo setup as `scripts/capture-screens.ts`, at 1440 × 900, 2×, dark. It records lossless frames with Chromium's screencast (CDP `Page.startScreencast`, PNG) instead of Playwright's `recordVideo`, which is low-bitrate VP8. Each scripted step (click, type, select) also writes a timeline entry with the time and the target element's bounding box. The compositions read that timeline, so camera moves, highlights and the cursor follow the real layout instead of hand-tuned coordinates.
- **iOS** (`capture/ios.sh`, the Mac): a UI test in the iOS project drives the demo. `xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100` cleans the status bar, and `xcrun simctl io booted recordVideo --codec h264` records. Timeline entries come from the UI test's element frames, as on the web.
- `scripts/capture-screens.ts` clicks "Explore a demo", but the sign-in button is now "Take a look around with sample data". The capture step fixes that script too, and both share the demo setup.

### Render and encode

1. `npx remotion render` renders each composition to a high-quality master (ProRes or H.264 at CRF 12) in `captures/`.
2. ffmpeg encodes the masters:
   - AV1 WebM: `libsvtav1`, `-crf 38 -preset 6`, no audio;
   - H.264 MP4 for Safari: `libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart`, no audio;
   - the poster: frame 0 as WebP (`vips`, Q 86).
3. `render.mjs` fails if a clip exceeds its budget.

VP9 is left out: current Chrome, Edge and Firefox play AV1, and Safari takes the MP4 when it can't play AV1. That halves what we store. VP9 can come back as a middle `<source>` if needed.

**Outputs are committed**, in `apps/site/src/assets/clips`. CI can't run the iOS simulator, and renders aren't byte-for-byte reproducible, so CI only checks that every clip the page references exists and is within budget. The captures and masters stay out of git. **The owner decides** whether to commit them or to host them elsewhere.

### How the page loads them

The HTML keeps today's `<img>` in each frame. Clips are opt-in through data attributes:

```html
<figure class="browser" data-clip="insights">
  <img src="./src/assets/screens/web-insights-1440.webp" alt="…" loading="lazy" />
</figure>
```

A small loader in `src/main.ts`, about 1 kB:

1. Does nothing when reduced motion or Save-Data is on, or when the browser can play neither `video/webm; codecs="av01.0.05M.08"` nor `video/mp4; codecs="avc1.640028"`.
2. Watches each `[data-clip]` frame with an `IntersectionObserver` (root margin of about one screen height). When a frame comes near, it creates `<video muted loop playsinline preload="none" poster=…>` with the AV1 and MP4 `<source>`s, the small variants under `media="(max-width: 700px)"`, places it over the `<img>`, and fades it in on `canplay`. Until then the still shows, so nothing shifts or flickers.
3. Plays when the frame is in view, pauses when it leaves or the tab is hidden, and adds the pause button.
4. Stops and keeps the still if `prefers-reduced-motion` changes to reduce while the page is open.

Vite imports the clips as hashed URLs, so they're served from `/assets/*` with the existing immutable cache headers. The CSP needs no change: `default-src 'self'` already covers `media-src`. Clips sit well under the Workers static assets' 25 MiB per-file limit.

### Phases

1. **Linux:** the pipeline, the web capture, the Insights and Apps clips, the page loader, the README section.
2. **The Mac:** the iOS capture script and the Overview and Entries clips (Together if approved).

## Decisions for the owner

1. **Remotion license:** confirm that Penny renders as an individual or a company of 3 people or fewer, which makes Remotion free.
2. **remocn:** rebuild the four patterns (recommended), or copy MIT scenes with the notice.
3. **Sections:** the four clips above, with Together later or never.
4. **Captions:** rewrite or approve the drafts. Burned in (recommended) or no captions.
5. **Adding an entry:** on the iPhone only (recommended), or a web clip recorded against a full-stack test server too.
6. **Outputs:** commit the encoded clips (at most about 13 MB for the first four, recommended), or host them elsewhere.
