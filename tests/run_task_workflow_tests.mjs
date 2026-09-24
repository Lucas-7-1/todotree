// Bundle the actual TypeScript/React modules; no duplicated implementation in tests.
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent']) {
  globalThis[key] = dom.window[key];
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const temp = path.resolve('node_modules/.cache/todotree-tests');
await mkdir(temp, { recursive: true });
const output = path.join(temp, 'workflow-tests.mjs');
await build({ entryPoints: ['tests/task-workflow.test.tsx'], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
await import(pathToFileURL(output).href);
process.on('exit', () => dom.window.close());
