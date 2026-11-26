import type { SceneId } from "../scenes/ids.ts";
import type { Layout, PackedScene } from "./pack.ts";

export type WorkerRequest =
  | { type: "init"; scene: SceneId; count: number }
  | {
      type: "sort";
      model: Float32Array;
      view: Float32Array;
      /** A buffer to reuse for the result (ownership moves to the worker). */
      order: Uint32Array;
    };

export type WorkerReply =
  | { type: "scene"; layout: Layout; packed: PackedScene }
  | { type: "order"; order: Uint32Array };
