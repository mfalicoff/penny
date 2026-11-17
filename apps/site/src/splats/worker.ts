// Off the main thread: builds the scenes once, then sorts splats back to front every frame.
import { buildScenes } from "../scenes/index.ts";
import { morphedViewZ } from "./morph.ts";
import { packScenes } from "./pack.ts";
import { DepthSorter } from "./sort.ts";
import type { WorkerReply, WorkerRequest } from "./protocol.ts";

let positions: Float32Array[] = [];
let delays: Float32Array = new Float32Array(0);
let sorter: DepthSorter | undefined;

const post = (reply: WorkerReply, transfer: Transferable[] = []) => self.postMessage(reply, { transfer });

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "init") {
    const scenes = buildScenes(request.count);
    const packed = packScenes(scenes);
    positions = scenes.map((s) => s.positions);
    delays = packed.delays;
    sorter = new DepthSorter(packed.count);
    post({ type: "scenes", packed }, [packed.centers.buffer, packed.covA.buffer, packed.covB.buffer, packed.colors.buffer]);
    return;
  }
  if (!sorter) return;
  const { from, to, t, modelA, modelB, view } = request;
  const a = positions[from]!;
  const b = positions[to]!;
  const order = request.order.length === sorter.count ? request.order : new Uint32Array(sorter.count);
  sorter.sort((i) => morphedViewZ(a, b, i, delays[i]!, t, modelA, modelB, view), order);
  post({ type: "order", order, frame: request.frame }, [order.buffer]);
});
