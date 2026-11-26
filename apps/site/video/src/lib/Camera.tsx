import type { ReactNode } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Box } from "../capture.ts";
import { keyed, type Key } from "./motion.ts";

interface Size {
  width: number;
  height: number;
}

/** The whole screen: where every clip starts and ends, so the loop doesn't jump. */
export function full(screen: Size): Box {
  return { x: 0, y: 0, width: screen.width, height: screen.height };
}

/** A shot `zoom`× closer, centred on `on` but kept inside the screen. */
export function closeUp(screen: Size, on: { x: number; y: number }, zoom: number): Box {
  const width = screen.width / zoom;
  const height = screen.height / zoom;
  const x = Math.min(Math.max(on.x - width / 2, 0), screen.width - width);
  const y = Math.min(Math.max(on.y - height / 2, 0), screen.height - height);
  return { x, y, width, height };
}

/**
 * Films its children (the screen, highlights and cursor, in screen CSS pixels) through a camera
 * that moves between `shots`. Each shot is a box of the screen with the output's aspect ratio.
 */
export function Camera({ screen, shots, children }: { screen: Size; shots: readonly Key<Box>[]; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const shot = keyed(shots, frame / fps);
  const scale = width / shot.width;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}>
      <div
        style={{
          position: "absolute",
          width: screen.width,
          height: screen.height,
          transformOrigin: "0 0",
          transform: `scale(${scale}) translate(${-shot.x}px, ${-shot.y}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
