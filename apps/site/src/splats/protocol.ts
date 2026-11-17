import type { PackedScenes } from "./pack.ts";

export type WorkerRequest =
  | { type: "init"; count: number }
  | {
      type: "sort";
      frame: number;
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
  | { type: "scenes"; packed: PackedScenes }
  | { type: "order"; frame: number; order: Uint32Array };
