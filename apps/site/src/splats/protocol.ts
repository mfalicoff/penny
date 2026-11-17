import type { Layout, PackedScene } from "./pack.ts";

export type WorkerRequest =
  | { type: "init"; count: number }
  | {
      type: "sort";
      from: number;
      to: number;
      t: number;
      modelA: Float32Array;
      modelB: Float32Array;
      view: Float32Array;
      /** A buffer to reuse for the result (ownership moves to the worker). */
      order: Uint32Array;
    };

export type WorkerReply =
  | { type: "layout"; layout: Layout }
  | { type: "scene"; packed: PackedScene }
  | { type: "order"; order: Uint32Array };
