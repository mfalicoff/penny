// Off the main thread: builds one scene, then sorts its splats back to front on request.
import { buildScene } from "../scenes/index.ts";
import { layoutFor, packScene } from "./pack.ts";
import type { WorkerReply, WorkerRequest } from "./protocol.ts";
import { DepthSorter, viewZ } from "./sort.ts";

let positions: Float32Array = new Float32Array(0);
let sorter: DepthSorter | undefined;

const post = (reply: WorkerReply, transfer: Transferable[] = []) => self.postMessage(reply, { transfer });

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "init") {
    const scene = buildScene(request.scene, request.count);
    positions = scene.positions;
    sorter = new DepthSorter(scene.count);
    const layout = layoutFor(scene.count);
    const packed = packScene(scene, layout);
    post({ type: "scene", layout, packed }, [packed.centers.buffer, packed.covA.buffer, packed.covB.buffer, packed.colors.buffer, packed.normals.buffer]);
    return;
  }
  if (!sorter) {
    post({ type: "order", order: request.order }, [request.order.buffer]);
    return;
  }
  const { model, view } = request;
  const order = request.order.length === sorter.count ? request.order : new Uint32Array(sorter.count);
  sorter.sort((i) => viewZ(positions, i, model, view), order);
  post({ type: "order", order }, [order.buffer]);
});
