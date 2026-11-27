import type { YearReview } from "@domain/yearReview.ts";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog } from "../../design/ModalDialog";
import { Button } from "../../design/controls";
import { CardGlyph } from "../../design/Icon";
import { motionMode, play } from "../../design/motion";
import { LoadingState, useToast } from "../../design/states";
import { shareCard, shareCardText } from "./shareCard";
import { SHARE_HEIGHT, SHARE_WIDTH, shareImage } from "./shareImage";

/**
 * Share your year (MAZ-292 phase 2; cards `web-year-review-share`, `web-year-review-share-amounts`).
 * The image is made here, in the browser, from the year's numbers (`shareCard`): a PNG of
 * 1080 × 1920, always light. "Show amounts and names" is off by default. Copy image puts it on the
 * clipboard and Download saves it; nothing is uploaded and nothing goes over the network.
 *
 * Motion (docs/design/motion.md §7): the dialog's own motion; until the image is ready a
 * placeholder of the same size shows a spinner, then the image fades in, and the switch swaps the
 * image in place with a `quick` fade.
 */
export function ShareDialog({ review, currency, onClose }: { review: YearReview; currency: string; onClose: () => void }) {
  const [showAmounts, setShowAmounts] = useState(false);
  const card = useMemo(() => shareCard(review, currency, showAmounts), [review, currency, showAmounts]);
  const [image, setImage] = useState<{ blob: Blob; url: string; amounts: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  // The toast sits behind the modal dialog, where assistive technology can't hear it: the dialog says it too.
  const [announced, setAnnounced] = useState("");
  const picture = useRef<HTMLImageElement>(null);
  const toast = useToast();
  const switchId = useId();
  const descriptionId = useId();

  useEffect(() => {
    let current = true;
    let url: string | null = null;
    shareImage(card).then(
      (blob) => {
        if (!current) return;
        url = URL.createObjectURL(blob);
        setImage({ blob, url, amounts: card.showAmounts });
        setFailed(false);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [card]);

  // The image fades in when it's ready, and again when the switch changes it.
  useEffect(() => {
    const mode = motionMode();
    if (image && mode !== "off") play(picture.current, [{ opacity: 0 }, { opacity: 1 }], { duration: "quick", mode });
  }, [image]);

  const ready = image !== null && image.amounts === showAmounts;
  const name = `penny-${review.year}.png`;

  async function copy() {
    if (!image) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": image.blob })]);
      toast.show({ title: "Image copied" });
      setAnnounced("Image copied");
    } catch {
      toast.show({ title: "Penny couldn't copy the image", detail: "Download it instead.", tone: "error" });
      setAnnounced("Penny couldn't copy the image. Download it instead.");
    }
  }

  function download() {
    if (!image) return;
    const link = document.createElement("a");
    link.href = image.url;
    link.download = name;
    link.click();
  }

  return (
    <Dialog
      title="Share your year"
      onClose={onClose}
      wide
      className="share-year"
      hint={`PNG, ${String(SHARE_WIDTH)} × ${String(SHARE_HEIGHT)}`}
      actions={
        <>
          <Button icon="copy" disabled={!ready} onClick={() => void copy()}>
            Copy image
          </Button>
          <button type="button" className="wbtn wbtn--primary" disabled={!ready} onClick={download}>
            <CardGlyph name="download" size={16} weight={44} />
            Download
          </button>
        </>
      }
    >
      <div className="share-year__body">
        <div className="share-year__image">
          {image ? (
            <img ref={picture} src={image.url} width={270} height={480} alt={`Your share image: ${shareCardText(card).join(". ")}`} />
          ) : failed ? (
            <p className="share-year__failed">This browser couldn't make the image.</p>
          ) : (
            <LoadingState label="Making your image…" />
          )}
        </div>
        <div className="share-year__side">
          <div className="share-year__option">
            <span className="share-year__option-icon" aria-hidden="true">
              <CardGlyph name={showAmounts ? "eye" : "eye-off"} size={17} weight={40} />
            </span>
            <label htmlFor={switchId} className="share-year__option-text">
              Show amounts and names
              <small id={descriptionId}>{showAmounts ? "Amounts and who paid are on the image" : "Only percentages, rankings and counts"}</small>
            </label>
            <input
              id={switchId}
              type="checkbox"
              role="switch"
              className="switch"
              checked={showAmounts}
              aria-describedby={descriptionId}
              onChange={(event) => {
                setShowAmounts(event.currentTarget.checked);
              }}
            />
          </div>
          <p className="share-year__privacy">Penny makes this image in your browser and uploads nothing. It leaves your computer only when you copy or download it.</p>
          <ul className="share-year__rules">
            <li>Never includes entry names, notes or receipts</li>
            <li>Trip and household names stay off the image</li>
          </ul>
          <p role="status" className="visually-hidden">
            {announced}
          </p>
        </div>
      </div>
    </Dialog>
  );
}
