// The page's Content-Security-Policy has no `unsafe-eval` (scripts/security-headers.ts). Zod
// probes `new Function` to compile fast object parsers, and Firefox reports that probe as a CSP
// violation even though Zod catches it. Zod reads `jitless` from this global when it loads and
// when each object schema is created, so it must be set before Zod itself is evaluated: main.tsx
// imports this module first, and the build emits it as its own chunk, ahead of the rest.
(globalThis as { __zod_globalConfig?: Record<string, unknown> }).__zod_globalConfig = { jitless: true };

export {};
