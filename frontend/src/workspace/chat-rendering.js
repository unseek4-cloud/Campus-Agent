import { renderAnswerMarkdown } from './answer-markdown.js';
import { bestSourceIndex, sourceDocumentUrl } from './chat-sources.js';
export function createTurnRenderer({ escapeHtml, renderGuide, apiBase = '' }) {
function citeChipsHtml(sources, readOnly) {
  if (!sources || !sources.length) return "";
  const index = bestSourceIndex(sources), source = sources[index];
  if (!source) return '';
  const url = sourceDocumentUrl(source, apiBase);
  const label = `<span class="cite-label">引用来源</span><span>${escapeHtml(source.fileName || source.documentId || '来源')}${source.pageNumber != null ? ' · 第 ' + escapeHtml(source.pageNumber) + ' 页' : ''}</span>`;
  return `<div class="msg-cite">${url && !readOnly
    ? `<a class="cite-chip" data-cite-index="${index}" href="${escapeHtml(url).replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${label}<span class="cite-open-icon" aria-hidden="true">↗</span></a>`
    : readOnly ? `<span class="cite-chip">${label}</span>` : `<button type="button" class="cite-chip" data-cite-index="${index}">${label}</button>`}</div>`;
}

function renderChatTurn(turn, { readOnly = false } = {}) {
  if (!turn) return `<div class="msg-bubble">（后端未返回内容）</div>`;
  const answer = renderAnswerMarkdown(turn.answer || "（未返回答案）", escapeHtml);
  const sources = turn.sources || [];
  // 注意：后端 ChatResponse.qa(...) 的 aiEnhanced 恒为 false，只有 SERVICE_GUIDE 分支才有意义，
  // 因此这里只在事项引导的回答上展示该标签，避免把 LLM 生成的 QA 回答误标成“数据库引导”。
  const modeTag = turn.type === "SERVICE_GUIDE"
    ? (turn.aiEnhanced
        ? `<span class="tag tag-active" style="font-size:10px">AI 叙述</span>`
        : `<span class="tag tag-draft" style="font-size:10px">数据库引导</span>`)
    : "";
  const hasDebug = turn.retrievalCount != null || turn.rewrittenQuery;
  const meta = !readOnly && hasDebug ? `<details class="msg-debug"><summary>本轮检索信息</summary><div class="msg-extra"><span>检索候选 ${turn.retrievalCount ?? 0} · 重排 ${turn.rerankCount ?? 0} · 采用 ${turn.usedContextCount ?? 0}</span>${modeTag}${turn.rewrittenQuery ? `<p>检索问题：${escapeHtml(turn.rewrittenQuery)}</p>` : ''}</div></details>` : '';

  // 事项引导分支：后端返回结构化事项 + 步骤 + 来源
  if (turn.type === "SERVICE_GUIDE" && turn.service) {
    return `<div class="msg-bubble answer-markdown">${answer}</div>${renderGuide(turn, { readOnly })}${citeChipsHtml(sources, readOnly)}${meta}`;
  }

  const related = !readOnly && turn.relatedService
    ? `<div class="msg-related">识别到相关事项：<b>${escapeHtml(turn.relatedService.name || turn.relatedService.code)}</b>
         <span class="link-btn" onclick="CampusActions.recognizeToAffair()">去办事引导查看 ›</span></div>`
    : "";
  return `<div class="msg-bubble answer-markdown">${answer}</div>${citeChipsHtml(sources, readOnly)}${related}
    ${sources.length ? "" : `<div style="font-size:11.5px;color:var(--text-3);margin-top:8px">未检索到可用证据，系统按“无依据不生成确定结论”的策略回应。</div>`}
    ${meta}`;
}

return renderChatTurn;
}
