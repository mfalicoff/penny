import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Security } from "../application/ports.ts";

const scrypt = promisify(scryptCallback);

export const security: Security = {
  randomId: (bytes) => randomBytes(bytes).toString("hex"),
  hashToken: (token) => createHash("sha256").update(token).digest("hex"),
  async hashPassword(password, salt) {
    return ((await scrypt(password, salt, 64)) as Buffer).toString("hex");
  },
  async verifyPassword(password, salt, expected) {
    const candidate = (await scrypt(password, salt, 64)) as Buffer;
    const stored = Buffer.from(expected, "hex");
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
  },
};
