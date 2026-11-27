import { ICON_SVG } from "@design-kit/src/icons";
import type { ShareCard } from "./shareCard";

/**
 * Draws the year's share image (MAZ-292 phase 2) on a canvas, in the browser: a PNG of
 * 1080 × 1920, always light, laid out as the cards draw it at 270 × 480 (`.img` in
 * `docs/design/penny-ios/web/year-review-share.html`), four times larger. It draws only the
 * `ShareCard` it's given (see `shareCard.ts`), and nothing is uploaded.
 */

export const SHARE_WIDTH = 1080;
export const SHARE_HEIGHT = 1920;
const S = SHARE_WIDTH / 270;

const INK = "#16120F";
const INK_2 = "#57524D";
const INK_3 = "#A9A49D";
const PAPER = "#FBF7F2";
const TINT = "#E4572E";
const FONT = 'Inter, -apple-system, "Segoe UI", system-ui, sans-serif';

const font = (weight: number, size: number) => `${String(weight)} ${String(size * S)}px ${FONT}`;

/** Waits for Inter in the weights the image uses, so the first image isn't drawn in a fallback face. */
async function fontsReady(): Promise<void> {
  if (!("fonts" in document)) return;
  try {
    await Promise.all([800, 700, 600, 500, 400].map((weight) => document.fonts.load(font(weight, 13))));
  } catch {
    // A font that fails to load leaves the fallback: the image is still right.
  }
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x * S, y * S, width * S, height * S, radius * S);
}

/** Splits `text` into lines no wider than `width` (card units), at spaces. */
function wrap(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > width * S) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The glow behind the title, as the card's two blurred radial gradients. */
function glow(context: CanvasRenderingContext2D) {
  const left = -60;
  const top = -90;
  const width = 270 + 120;
  const height = 300;
  context.save();
  context.filter = `blur(${String(36 * S)}px)`;
  const spots: [number, number, number, number, string][] = [
    [0.3, 0.45, 0.4, 0.45, "rgba(255,138,76,0.55)"],
    [0.75, 0.35, 0.35, 0.4, "rgba(255,196,120,0.45)"],
  ];
  for (const [cx, cy, rx, ry, color] of spots) {
    context.save();
    context.translate((left + width * cx) * S, (top + height * cy) * S);
    context.scale(rx * width * S, ry * height * S);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.7, color.replace(/[\d.]+\)$/, "0)"));
    context.fillStyle = gradient;
    context.fillRect(-2, -2, 4, 4);
    context.restore();
  }
  context.restore();
}

/** Penny's leaf, the kit's glyph, in white on the copper tile. */
function brand(context: CanvasRenderingContext2D, x: number, y: number) {
  context.fillStyle = TINT;
  roundRect(context, x, y, 20, 20, 6);
  context.fill();
  context.save();
  context.translate((x + 4) * S, (y + 4) * S);
  context.scale((12 * S) / 512, (12 * S) / 512);
  context.strokeStyle = "#fff";
  context.lineWidth = 44;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const [, d] of ICON_SVG.leaf.matchAll(/ d="([^"]+)"/g)) if (d) context.stroke(new Path2D(d));
  context.restore();
  context.fillStyle = INK;
  context.font = font(700, 13);
  context.textBaseline = "middle";
  context.fillText("Penny", (x + 26) * S, (y + 10.5) * S);
}

/** Draws `card` on a new 1080 × 1920 canvas. */
export async function drawShareCard(card: ShareCard): Promise<HTMLCanvasElement> {
  await fontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_WIDTH;
  canvas.height = SHARE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't draw the image.");
  context.fillStyle = PAPER;
  context.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);
  glow(context);

  const left = 20;
  const right = 250;
  brand(context, left, 22);

  context.textBaseline = "alphabetic";
  context.fillStyle = INK;
  context.font = font(800, 30);
  // letter-spacing −0.03em, as the card's h3.
  context.letterSpacing = `${String(-0.9 * S)}px`;
  context.fillText(card.title, left * S, 80 * S);
  context.letterSpacing = "0px";

  // "Where my money went", or "$27,410 spent" with the total bold.
  let x = left;
  if (card.subtitle.strong) {
    context.font = font(700, 14);
    context.fillStyle = INK;
    context.fillText(card.subtitle.strong, x * S, 101 * S);
    x += context.measureText(card.subtitle.strong).width / S;
  }
  context.font = font(400, 14);
  context.fillStyle = INK_2;
  context.fillText(card.subtitle.text, x * S, 101 * S);

  let y = 126;
  for (const category of card.categories) {
    const middle = y + 8.5;
    context.textBaseline = "middle";
    context.font = font(600, 13);
    context.fillStyle = INK_2;
    context.fillText(String(category.rank), left * S, middle * S);
    context.fillStyle = category.color;
    roundRect(context, left + 20, middle - 4.5, 9, 9, 3);
    context.fill();
    context.fillStyle = INK;
    context.fillText(category.name, (left + 37) * S, middle * S);
    context.textAlign = "right";
    context.fillText(category.percent, right * S, middle * S);
    if (category.amount) {
      const percentWidth = context.measureText(category.percent).width / S;
      context.font = font(500, 12);
      context.fillStyle = INK_2;
      context.fillText(category.amount, (right - percentWidth - 4) * S, middle * S);
    }
    context.textAlign = "left";
    y += 17 + 8;
  }

  // The tiles: two columns; a wide tile, or a half tile without a partner, spans both.
  y = y - 8 + 16;
  const gap = 8;
  const half = (right - left - gap) / 2;
  const rows: ShareCard["tiles"][] = [];
  for (const tile of card.tiles) {
    const last = rows[rows.length - 1];
    if (!tile.wide && last?.length === 1 && last[0] && !last[0].wide) last.push(tile);
    else rows.push([tile]);
  }
  for (const row of rows) {
    const width = row.length === 2 ? half : right - left;
    context.font = font(400, 11.5);
    const lines = row.map((tile) => wrap(context, tile.subtitle, width - 20));
    const height = 9 + 20 + Math.max(...lines.map((item) => item.length)) * 14.4 + 9;
    row.forEach((tile, index) => {
      const tileX = left + index * (half + gap);
      context.fillStyle = "rgba(255,255,255,0.75)";
      roundRect(context, tileX, y, width, height, 12);
      context.fill();
      context.textBaseline = "alphabetic";
      context.fillStyle = INK;
      context.font = font(700, 16);
      context.letterSpacing = `${String(-0.32 * S)}px`;
      context.fillText(tile.title, (tileX + 10) * S, (y + 9 + 15) * S, (width - 20) * S);
      context.letterSpacing = "0px";
      context.fillStyle = INK_2;
      context.font = font(400, 11.5);
      (lines[index] ?? []).forEach((line, number) => {
        context.fillText(line, (tileX + 10) * S, (y + 9 + 20 + 11 + number * 14.4) * S);
      });
    });
    y += height + gap;
  }

  context.fillStyle = INK_3;
  context.font = font(400, 11);
  context.textBaseline = "alphabetic";
  context.fillText(card.footer, left * S, (480 - 16 - 2) * S);
  return canvas;
}

/** The PNG of `card`. */
export async function shareImage(card: ShareCard): Promise<Blob> {
  const canvas = await drawShareCard(card);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("This browser can't make the image."));
    }, "image/png");
  });
}
