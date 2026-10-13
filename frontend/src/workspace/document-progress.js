// A single, non-overlapping polling loop shared by the list and document details.
export function createDocumentProgress({ apiGet, isActive, onUpdate, onComplete, onError, interval = 2000 }) {
  const records = new Map();
  let timer, running = false, generation = 0;
  const pending = () => [...records.values()].filter(document => document.status === 'PROCESSING');
  function schedule() {
    if (timer || running || !isActive() || !pending().length) return;
    timer = setTimeout(poll, interval);
  }
  function observe(document, { restart = false, notifyTerminal = false } = {}) {
    if (!document?.id) return document;
    const previous = restart ? null : records.get(document.id);
    const next = { ...previous, ...document };
    if (previous?.status === 'PROCESSING' && next.status === 'PROCESSING') {
      if (Number(previous.progress) > Number(next.progress)) next.parseStatus = previous.parseStatus;
      next.progress = Math.max(Number(previous.progress) || 0, Number(next.progress) || 0);
      next.processedPages = Math.max(Number(previous.processedPages) || 0, Number(next.processedPages) || 0);
    }
    records.set(next.id, next);
    if (['SUCCESS', 'FAILED'].includes(next.status) &&
        (previous?.status === 'PROCESSING' || (notifyTerminal && previous?.status !== next.status))) onComplete(next);
    schedule();
    return next;
  }
  async function poll() {
    timer = undefined;
    if (running || !isActive()) return;
    const token = generation, documents = pending();
    running = true;
    try {
      const results = await Promise.allSettled(documents.map(document => apiGet(`/api/admin/documents/${encodeURIComponent(document.id)}/progress`)));
      if (token !== generation || !isActive()) return;
      results.forEach((result, index) => {
        const previous = documents[index];
        // A new upload/rebuild/list response or a deleted document supersedes this request.
        if (records.get(previous.id) !== previous) return;
        if (result.status === 'fulfilled') onUpdate(observe(result.value));
        else {
          if (result.reason?.status === 404) records.delete(previous.id);
          onError(previous, result.reason);
        }
      });
    } finally {
      if (token === generation) { running = false; schedule(); }
    }
  }
  function stop() {
    generation++; clearTimeout(timer); timer = undefined; running = false; records.clear();
  }
  return { observe, stop, forget: id => records.delete(id) };
}
