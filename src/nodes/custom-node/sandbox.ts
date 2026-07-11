import type { CustomNodeLlm } from './runtime';

// Custom Node code is untrusted (it can arrive inside imported workflows), so it
// never runs in the app window. Each run builds a sandboxed iframe with an opaque
// origin and a deny-all Content-Security-Policy, and the code executes in a Web
// Worker inside that iframe. The sandbox has no access to the filesystem, the
// network, browser storage, or the Electron preload bridge; the only channel to
// the app is postMessage, which carries the run payload in, LLM requests out to
// the host-controlled `llm` callback, and the result back.

export type SandboxRunPayload = {
  code: string;
  inputs: Record<string, unknown>;
  controls: Record<string, unknown>;
  state: Record<string, unknown>;
};

export type SandboxRunResult = {
  outputs?: unknown;
  displays?: unknown;
  state?: unknown;
};

type SandboxMessage =
  | { type: 'sandbox-ready' }
  | { type: 'llm-request'; id: number; request: unknown }
  | { type: 'result'; result: SandboxRunResult }
  | { type: 'error'; message: string };

const READY_TIMEOUT_MS = 5000;
// Watchdog for pure compute time: reset on every message from the sandbox and
// paused while an LLM request is pending, so long model calls never trip it.
const COMPUTE_TIMEOUT_MS = 30000;

// The worker source below is plain JavaScript kept as a string so it can be
// shipped into the sandbox verbatim. It re-implements the Custom Node helper
// functions (json/number/text/clamp/words/lines/llmJson) because host functions
// cannot cross the postMessage boundary. Keep the runner argument list in sync
// with `customNodeRunnerArgs` in runtime.ts.
const WORKER_SOURCE = String.raw`'use strict';
(() => {
  const post = self.postMessage.bind(self);
  // CSP and the opaque origin already block network and storage; removing the
  // entry points as well is defense in depth.
  const blocked = [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts',
    'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker',
    'WebTransport', 'navigator',
  ];
  for (const key of blocked) {
    try { self[key] = undefined; } catch (_) { /* ignore */ }
    try { delete self[key]; } catch (_) { /* ignore */ }
    try {
      Object.defineProperty(self, key, { value: undefined, writable: false, configurable: false });
    } catch (_) { /* ignore */ }
  }

  const pendingLlm = new Map();
  let nextLlmId = 1;
  function llm(request) {
    return new Promise((resolve, reject) => {
      const id = nextLlmId;
      nextLlmId += 1;
      pendingLlm.set(id, { resolve, reject });
      post({ type: 'llm-request', id, request });
    });
  }

  function stripJsonFence(text) {
    const trimmed = text.trim();
    const fenced = /^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/i.exec(trimmed);
    return fenced ? fenced[1].trim() : trimmed;
  }
  const json = (value, fallback = null) => {
    if (typeof value !== 'string') {
      return value === undefined || value === null ? fallback : value;
    }
    try {
      return JSON.parse(stripJsonFence(value));
    } catch (_) {
      const objectMatch = value.match(/\{[\s\S]*\}/);
      const arrayMatch = value.match(/\[[\s\S]*\]/);
      const candidate = (objectMatch && objectMatch[0]) || (arrayMatch && arrayMatch[0]);
      if (candidate) {
        try {
          return JSON.parse(candidate);
        } catch (_) {
          return fallback;
        }
      }
      return fallback;
    }
  };
  const number = (value, fallback = 0) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const text = (value, fallback = '') => {
    if (value === undefined || value === null) {
      return fallback;
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, number(value, min)));
  const words = (value) => text(value).trim().split(/\s+/).filter(Boolean);
  const lines = (value) => text(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const llmJson = async (request, fallback = null) => {
    const normalized = typeof request === 'string' ? { prompt: request } : request;
    const response = await llm(Object.assign({}, normalized, {
      prompt: [
        normalized.prompt,
        '',
        'Return valid JSON only. Do not include markdown, prose, or code fences.',
      ].join('\n'),
    }));
    return json(response, fallback);
  };

  const runnerArgs = [
    'inputs', 'controls', 'state', 'llm', 'llmJson',
    'json', 'number', 'text', 'clamp', 'words', 'lines',
  ];
  const prelude = '"use strict";\n'
    + 'const window = undefined, document = undefined, globalThis = undefined, '
    + 'self = undefined, fetch = undefined, XMLHttpRequest = undefined, '
    + 'WebSocket = undefined, EventSource = undefined, require = undefined, '
    + 'process = undefined, postMessage = undefined, importScripts = undefined;\n';

  async function run(payload) {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const runner = AsyncFunction.apply(null, runnerArgs.concat(prelude + payload.code));
    const result = await runner(
      payload.inputs, payload.controls, payload.state,
      llm, llmJson, json, number, text, clamp, words, lines,
    );
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Custom Node code must return an object.');
    }
    return result;
  }

  self.onmessage = (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }
    if (data.type === 'run') {
      run(data).then(
        (result) => {
          try {
            post({ type: 'result', result });
          } catch (error) {
            post({
              type: 'error',
              message: 'Custom Node result is not transferable: '
                + (error && error.message ? error.message : String(error)),
            });
          }
        },
        (error) => {
          post({
            type: 'error',
            message: error && error.message ? error.message : String(error),
          });
        },
      );
      return;
    }
    if (data.type === 'llm-response') {
      const pending = pendingLlm.get(data.id);
      if (!pending) {
        return;
      }
      pendingLlm.delete(data.id);
      if (data.ok) {
        pending.resolve(data.value);
      } else {
        pending.reject(new Error(data.message || 'The Custom Node LLM request failed.'));
      }
    }
  };

  post({ type: 'sandbox-ready' });
})();
`;

// `blob:` in script-src/worker-src is required to start the worker; everything
// else stays blocked ('unsafe-eval' only allows compiling the user function).
const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:";

function buildSandboxHtml() {
  // <-escape the embedded source so it can never close the <script> tag.
  const workerSource = JSON.stringify(WORKER_SOURCE).replace(/</g, '\\u003c');
  return [
    '<!doctype html><html><head>',
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`,
    '</head><body><script>',
    `const workerUrl = URL.createObjectURL(new Blob([${workerSource}], { type: 'text/javascript' }));`,
    'const worker = new Worker(workerUrl);',
    "worker.onmessage = (event) => parent.postMessage(event.data, '*');",
    "worker.onerror = (event) => parent.postMessage({ type: 'error', message: event.message || 'Custom Node sandbox worker failed.' }, '*');",
    'window.onmessage = (event) => { if (event.source === parent) worker.postMessage(event.data); };',
    '<' + '/script></body></html>',
  ].join('\n');
}

export function runCustomNodeCodeInSandbox(
  payload: SandboxRunPayload,
  llm: CustomNodeLlm,
): Promise<SandboxRunResult> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.display = 'none';
    iframe.srcdoc = buildSandboxHtml();

    let settled = false;
    let pendingLlmCalls = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const finish = (settle: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (watchdog) {
        clearTimeout(watchdog);
      }
      window.removeEventListener('message', onMessage);
      iframe.remove();
      settle();
    };

    const armWatchdog = (delayMs: number, message: string) => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = undefined;
      }
      if (pendingLlmCalls > 0) {
        return;
      }
      watchdog = setTimeout(() => finish(() => reject(new Error(message))), delayMs);
    };
    const computeTimeoutMessage =
      'Custom Node code ran too long without finishing and was stopped.';

    const postToSandbox = (message: unknown) => {
      iframe.contentWindow?.postMessage(message, '*');
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) {
        return;
      }
      const data = event.data as SandboxMessage | undefined;
      if (!data || typeof data !== 'object') {
        return;
      }
      if (data.type === 'sandbox-ready') {
        armWatchdog(COMPUTE_TIMEOUT_MS, computeTimeoutMessage);
        postToSandbox({ type: 'run', ...payload });
        return;
      }
      if (data.type === 'llm-request') {
        pendingLlmCalls += 1;
        if (watchdog) {
          clearTimeout(watchdog);
          watchdog = undefined;
        }
        void Promise.resolve()
          .then(() => llm(data.request as Parameters<CustomNodeLlm>[0]))
          .then(
            (value) => postToSandbox({ type: 'llm-response', id: data.id, ok: true, value }),
            (error) => postToSandbox({
              type: 'llm-response',
              id: data.id,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            }),
          )
          .finally(() => {
            pendingLlmCalls -= 1;
            if (!settled) {
              armWatchdog(COMPUTE_TIMEOUT_MS, computeTimeoutMessage);
            }
          });
        return;
      }
      if (data.type === 'result') {
        finish(() => resolve(data.result));
        return;
      }
      if (data.type === 'error') {
        finish(() => reject(new Error(data.message || 'Custom Node code failed in the sandbox.')));
      }
    };

    window.addEventListener('message', onMessage);
    armWatchdog(READY_TIMEOUT_MS, 'The Custom Node sandbox did not start in time.');
    document.body.appendChild(iframe);
  });
}
