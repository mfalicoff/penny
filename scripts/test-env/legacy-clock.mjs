// Preloaded into the legacy Node server for the cutover rehearsal (MAZ-64) only:
// `node --import ./scripts/test-env/legacy-clock.mjs server/index.ts` with
// PENNY_LEGACY_CLOCK_FILE naming a file that holds an ISO instant (or is empty for
// real time). Date.now() and `new Date()` then follow that instant, advancing in real
// time from the moment it was written, so a dataset can be built month by month in the
// past through the unchanged legacy HTTP API. The legacy server reads time only through
// Date.now() and `new Date()`.
import { readFileSync, statSync } from "node:fs";

const file = process.env.PENNY_LEGACY_CLOCK_FILE;
if (file) {
  const realNow = Date.now.bind(Date);
  const RealDate = Date;
  let checkedAt = 0;
  let modifiedAt = -1;
  let offset = 0;
  const current = () => {
    const real = realNow();
    if (real - checkedAt >= 20) {
      checkedAt = real;
      try {
        const stat = statSync(file);
        if (stat.mtimeMs !== modifiedAt) {
          modifiedAt = stat.mtimeMs;
          const text = readFileSync(file, "utf8").trim();
          offset = text ? new RealDate(text).getTime() - real : 0;
          if (Number.isNaN(offset)) throw new Error(`Invalid legacy clock instant: ${text}`);
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        offset = 0;
      }
    }
    return real + offset;
  };
  class ShiftedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [current()]));
    }
    static now() {
      return current();
    }
  }
  globalThis.Date = ShiftedDate;
}
