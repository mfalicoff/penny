import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import type { AvatarMime } from "../../api/profile";
import { ModalDialog } from "../../design/ModalDialog";

/** The square the picture is cropped to, in CSS pixels (smaller on narrow screens). */
const STAGE_MAX = 340;
/** The longest side Penny uploads; the server shrinks it to 512 px anyway. */
const OUTPUT_MAX = 1024;
const ZOOM_MAX = 4;
const KEY_STEP = 12;

/** Full width on phones (the card's picture runs edge to edge), a 340px square wider. */
const stageSize = () => (window.innerWidth < 768 ? Math.max(200, window.innerWidth) : STAGE_MAX);

export interface CropState {
  /** 1 fills the square with the picture's shorter side. */
  zoom: number;
  /** The picture's offset from centred, in stage pixels. */
  x: number;
  y: number;
}

/** Keeps the picture covering the whole square: no empty edge can end up in the crop. */
export function clampCrop(state: CropState, width: number, height: number, stage: number): CropState {
  const zoom = Math.min(ZOOM_MAX, Math.max(1, state.zoom));
  const scale = (stage / Math.min(width, height)) * zoom;
  const spareX = Math.max(0, (width * scale - stage) / 2);
  const spareY = Math.max(0, (height * scale - stage) / 2);
  return { zoom, x: Math.min(spareX, Math.max(-spareX, state.x)), y: Math.min(spareY, Math.max(-spareY, state.y)) };
}

/** The square of the source picture the stage shows, in source pixels. */
export function cropRect(state: CropState, width: number, height: number, stage: number) {
  const scale = (stage / Math.min(width, height)) * state.zoom;
  const left = (stage - width * scale) / 2 + state.x;
  const top = (stage - height * scale) / 2 + state.y;
  return { x: Math.max(0, -left / scale), y: Math.max(0, -top / scale), size: stage / scale };
}

/**
 * "Move and scale" (card `iphone-profile-photo`, MAZ-171): drag to move, scroll, pinch or use the
 * slider (or the arrow, + and − keys) to zoom, then Choose crops in the browser. The crop is drawn
 * on a canvas, so it carries no metadata; the server re-encodes it anyway. A picture the browser
 * can't show (HEIC outside Safari) is sent as it is, and the server uses its centre.
 */
export function PictureCropDialog({ file, mime, onCancel, onChoose }: { file: File; mime: AvatarMime; onCancel: () => void; onChoose: (picture: Blob, mime: AvatarMime) => void }) {
  const titleId = useId();
  const noteId = useId();
  const [url] = useState(() => URL.createObjectURL(file));
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [crop, setCrop] = useState<CropState>({ zoom: 1, x: 0, y: 0 });
  // The card's words are for touch; a mouse zooms with its wheel.
  const [coarse] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const [stage, setStage] = useState(() => stageSize());
  const drag = useRef<{ id: number; x: number; y: number; start: CropState } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(
    () => () => {
      URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(() => {
    const resize = () => {
      setStage(stageSize());
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
    };
  }, []);

  const width = image?.naturalWidth ?? 1;
  const height = image?.naturalHeight ?? 1;
  const update = (next: CropState) => {
    setCrop(clampCrop(next, width, height, stage));
  };

  function choose() {
    if (!image) {
      // Nothing to crop in the browser: the server centres the picture.
      onChoose(file, mime);
      return;
    }
    const rect = cropRect(clampCrop(crop, width, height, stage), width, height, stage);
    const size = Math.max(1, Math.min(OUTPUT_MAX, Math.round(rect.size)));
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      onChoose(file, mime);
      return;
    }
    // JPEG has no transparency: a transparent PNG gets a white background, not black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size, size);
    context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, size, size);
    canvas.toBlob(
      (blob) => {
        if (blob) onChoose(blob, "image/jpeg");
        else onChoose(file, mime);
      },
      "image/jpeg",
      0.92,
    );
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: crop.zoom };
      drag.current = null;
    } else drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: crop };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) update({ ...crop, zoom: pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance) });
      return;
    }
    const start = drag.current;
    if (start?.id === event.pointerId) update({ ...start.start, x: start.start.x + event.clientX - start.x, y: start.start.y + event.clientY - start.y });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    update({ ...crop, zoom: crop.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08) });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = { ArrowLeft: [KEY_STEP, 0], ArrowRight: [-KEY_STEP, 0], ArrowUp: [0, KEY_STEP], ArrowDown: [0, -KEY_STEP] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      update({ ...crop, x: crop.x + move[0], y: crop.y + move[1] });
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      update({ ...crop, zoom: crop.zoom * 1.15 });
    } else if (event.key === "-" || event.key === "−") {
      event.preventDefault();
      update({ ...crop, zoom: crop.zoom / 1.15 });
    }
  }

  const scale = (stage / Math.min(width, height)) * crop.zoom;
  return (
    <ModalDialog labelledBy={titleId} describedBy={noteId} onClose={onCancel} panelClassName="crop">
      <div className="crop__head">
        <h2 id={titleId}>Move and scale</h2>
        <p>{failed ? "This browser can't show this picture" : coarse ? "Pinch to zoom, drag to move" : "Scroll to zoom, drag to move"}</p>
      </div>
      {failed ? (
        <p className="crop__fallback">Penny will use the centre of the picture. You can change it again later.</p>
      ) : (
        <div
          className="crop__stage"
          style={{ width: stage, height: stage }}
          role="application"
          aria-roledescription="picture crop"
          aria-label="Picture position. Use the arrow keys to move it, and plus or minus to zoom."
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
        >
          <img
            src={url}
            alt=""
            draggable={false}
            onLoad={(event) => {
              setImage(event.currentTarget);
            }}
            onError={() => {
              setFailed(true);
            }}
            style={
              image
                ? {
                    width: width * scale,
                    height: height * scale,
                    transform: `translate(${String((stage - width * scale) / 2 + crop.x)}px, ${String((stage - height * scale) / 2 + crop.y)}px)`,
                  }
                : { opacity: 0 }
            }
          />
          <span className="crop__mask" aria-hidden="true" />
        </div>
      )}
      <p className="crop__note" id={noteId}>
        People in your households and trips see this picture. Penny removes the photo's location and other details before saving it.
      </p>
      <div className="crop__actions">
        <button type="button" className="crop__button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="crop__button crop__button--choose" onClick={choose} disabled={!image && !failed}>
          Choose
        </button>
      </div>
    </ModalDialog>
  );
}
