import type { ComponentType } from "react";
import { Composition, staticFile, type CalculateMetadataFunction } from "remotion";
import type { Capture } from "./capture.ts";
import { CLIPS, FPS } from "./clips.ts";
import { Apps } from "./clips/Apps.tsx";
import { Insights } from "./clips/Insights.tsx";

type Props = { capture: Capture | null };

/**
 * One composition per clip that has one. The iOS clips (overview, entries) get theirs with
 * their recordings from the Mac; until then the render script skips them.
 */
const COMPONENTS: Record<string, ComponentType<{ capture: Capture }>> = { insights: Insights, apps: Apps };

/** Loads the clip's capture (captures/<clip>/capture.json) before rendering. */
function loadCapture(id: string): CalculateMetadataFunction<Props> {
  return async () => {
    const response = await fetch(staticFile(`${id}/capture.json`));
    if (!response.ok) throw new Error(`No capture for "${id}": run the capture first (see apps/site/video/README.md)`);
    return { props: { capture: (await response.json()) as Capture } };
  };
}

export function Root() {
  return (
    <>
      {CLIPS.map((clip) => {
        const Clip = COMPONENTS[clip.id];
        if (!Clip) return null;
        return (
          <Composition
            key={clip.id}
            id={clip.id}
            component={({ capture }: Props) => (capture ? <Clip capture={capture} /> : null)}
            width={clip.width}
            height={clip.height}
            fps={FPS}
            durationInFrames={clip.seconds * FPS}
            defaultProps={{ capture: null }}
            calculateMetadata={loadCapture(clip.id)}
          />
        );
      })}
    </>
  );
}
