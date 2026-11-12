// The browser security policy for the app's pages (MAZ-94). Production front ends send the same
// header (nix/module.nix and deploy/web/default.conf.template; see docs/web-receipts.md), and
// `vite preview` sends it so the Playwright suite runs the production build under it.
// Same-origin scripts, workers (the pdf.js worker) and requests only; receipt photos are shown
// from `blob:` URLs. Inline style attributes stay allowed because the design kit's icon SVGs
// carry them. No eval and no WebAssembly: pdf.js runs with `useWasm: false`.
// tests/security-headers.test.ts keeps both front ends in step.
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
