// Browser/Tauri-frontend stub for `node:fs/promises`.
//
// Some Node-oriented dependencies (e.g. @carllee1983/tagsmith's config.js)
// import fs helpers at module scope even though the frontend only uses their
// pure functions. Vite would otherwise rewrite `node:fs/promises` to the
// `__vite-browser-external` stub, which has no named exports, breaking the
// build. These shims let the named imports resolve and throw loudly if any
// real filesystem call is ever attempted from the frontend.

const unavailable = (name: string): never => {
  throw new Error(`node:fs/promises.${name} is not available in the browser/Tauri frontend`);
};

export const readFile = (): never => unavailable("readFile");
export const writeFile = (): never => unavailable("writeFile");
export const access = (): never => unavailable("access");
