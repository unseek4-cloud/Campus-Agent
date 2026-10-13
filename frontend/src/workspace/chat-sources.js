function score(value) { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
export function bestSourceIndex(sources = []) {
  let best = -1, bestRank = -Infinity, bestScore = -Infinity;
  sources.forEach((source, index) => {
    if (!source) return;
    const rank = score(source.finalScore) ?? score(source.rerankScore) ?? score(source.score) ?? -Infinity;
    const similarity = score(source.score) ?? -Infinity;
    if (best === -1 || rank > bestRank || (rank === bestRank && similarity > bestScore)) {
      best = index; bestRank = rank; bestScore = similarity;
    }
  });
  return best;
}
export function sourceDocumentUrl(source, apiBase = '') {
  if (!source?.documentId) return '';
  const page = Number(source.pageNumber);
  return `${apiBase}/api/knowledge/documents/${encodeURIComponent(source.documentId)}/file${Number.isInteger(page) && page > 0 ? '#page=' + page : ''}`;
}
