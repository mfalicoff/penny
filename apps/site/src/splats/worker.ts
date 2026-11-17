// Off the main thread: builds the scenes (posting each as soon as it is ready), then sorts
// splats back to front every frame.
import { SCENE_IDS } from "../scenes/ids.ts";
import { buildScene } from "../scenes/index.ts";
import { morphedViewZ } from "./morph.ts";
import { layoutFor, morphDelays, packScene } from "./pack.ts";
import type { WorkerReply, WorkerRequest } from "./protocol.ts";
import { DepthSorter } from "./sort.ts";

const positions: Float32Array[] = [];
let delays: Float32Array = new Float32Array(0);
let sorter: DepthSorter | undefined;

const post = (reply: WorkerReply, transfer: Transferable[] = []) => self.postMessage(reply, { transfer });

async function init(count: number): Promise<void> {
  const layout = layoutFor(count, SCENE_IDS.length);
  delays = morphDelays(count);
  sorter = new DepthSorter(count);
  post({ type: "layout", layout });
  for (const [index, id] of SCENE_IDS.entries()) {
    const scene = buildScene(id, count);
    positions[index] = scene.positions;
    const packed = packScene(scene, index, layout, delays);
    post({ type: "scene", packed }, [packed.centers.buffer, packed.covA.buffer, packed.covB.buffer, packed.colors.buffer, packed.normals.buffer]);
    // Let sort requests in between scenes, so the first scenes animate while the rest build.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "init") {
    void init(request.count);
    return;
  }
  const a = positions[request.from];
  const b = positions[request.to];
  if (!sorter || !a || !b) {
    post({ type: "order", order: request.order }, [request.order.buffer]);
    return;
  }
  const { t, modelA, modelB, view } = request;
  const order = request.order.length === sorter.count ? request.order : new Uint32Array(sorter.count);
  sorter.sort((i) => morphedViewZ(a, b, i, delays[i]!, t, modelA, modelB, view), order);
  post({ type: "order", order }, [order.buffer]);
});
