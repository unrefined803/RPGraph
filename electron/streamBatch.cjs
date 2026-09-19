/** Coalesce provider deltas before IPC and renderer-side full-text parsing. */
function createTextStreamBatch(send, intervalMs = 50) {
  let pending = '';
  let timer;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const text = pending;
    pending = '';
    send(text);
  };
  return {
    push(text) {
      pending += text;
      if (pending && timer === undefined) timer = setTimeout(flush, intervalMs);
    },
    flush,
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = '';
    },
  };
}

module.exports = { createTextStreamBatch };
