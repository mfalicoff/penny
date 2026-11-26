import { Config } from "@remotion/cli/config";

// The recordings (gitignored) are the compositions' only assets.
Config.setPublicDir("captures");
Config.setVideoImageFormat("png");
// On NixOS, Remotion's downloaded headless Chrome can't start: point REMOTION_CHROME at a
// system Chromium (as PLAYWRIGHT_CHROMIUM_EXECUTABLE for the captures).
if (process.env.REMOTION_CHROME) Config.setBrowserExecutable(process.env.REMOTION_CHROME);
