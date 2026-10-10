/* Administrator quality dashboard, using the existing shell, cards, modal and pager. */
const qualityIssues = { UNCLASSIFIED:'待分类', KNOWLEDGE_GAP:'知识库内容不足', RETRIEVAL_MISMATCH:'RAG 检索不准确', ANSWER_QUALITY:'回答表达或内容问题', OTHER:'其他' };
const qualityStatuses = { OPEN:'待处理', IN_PROGRESS:'处理中', RESOLVED:'已处理' };
let qualityState = { page:1, pageSize:20, total:0, items:[] }, qualityGeneration = 0;
function renderAIQuality(vp) {
  qualityState = { page:1, pageSize:20, total:0, items:[] };
  vp.innerHTML = `<div class="page-head"><div><div class="page-title">AI 问答质量分析</div><div class="page-desc">从用户反馈发现问题，让校园问答持续变好。</div></div><button class="btn btn-sm" id="qualityRefresh">⟳ 刷新</button></div>
    <form class="quality-filters" id="qualityFilters"><label>评价类型<select class="input" id="qualityRating"><option value="">全部评价</option><option value="POSITIVE">回复优秀</option><option value="NEGATIVE">回复不佳</option></select></label><label>开始日期<input type="date" class="input" id="qualityStart"/></label><label>结束日期<input type="date" class="input" id="qualityEnd"/></label><button class="btn btn-primary" type="submit">查询</button><button class="btn" type="reset">重置</button></form>
    <p class="quality-hint" id="qualityScope">统计当前有效评价，日期按最近一次评价或修改时间筛选；未指定日期时趋势展示最近30天。</p>
    <div id="qualityError" role="alert"></div><div id="qualityStats" class="quality-stats"></div><div id="qualityCharts" class="quality-charts"></div>
    <div class="section-head"><h3>评价记录与差评处理</h3><button class="btn btn-sm" id="qualityBadOnly">只看差评</button></div><div id="qualityRecords" class="quality-records"></div><div id="qualityPager"></div>`;
  $('#qualityFilters').addEventListener('submit',e=>{e.preventDefault();qualityState.page=1;loadAIQuality();});
  $('#qualityFilters').addEventListener('reset',()=>{qualityState.page=1;queueMicrotask(loadAIQuality);});
  $('#qualityRefresh').addEventListener('click',loadAIQuality);
  $('#qualityBadOnly').addEventListener('click',()=>{$('#qualityRating').value='NEGATIVE';qualityState.page=1;loadAIQuality();});
  loadAIQuality();
}
function qualityChartHTML(data) {
  const ratio = data.total ? data.positive/data.total : 0, circumference = 2*Math.PI*66;
  const trend = data.trend || [], max = Math.max(2,...trend.map(t=>Math.max(t.positive,t.negative)));
  const x = i => 42 + (trend.length > 1 ? i/(trend.length-1) : .5)*530, y = n => 160-n/max*120;
  const line = key => trend.map((t,i)=>`${x(i)},${y(t[key])}`).join(' ');
  const dots = key => trend.map((t,i)=>`<circle cx="${x(i)}" cy="${y(t[key])}" r="3" fill="${key==='positive'?'#69a994':'#d88c91'}"><title>${t.date} ${key==='positive'?'优秀':'不佳'} ${t[key]}条</title></circle>`).join('');
  const legend = `<div class="quality-legend"><span><i></i>回复优秀</span><span class="bad"><i></i>回复不佳</span></div>`;
  return `<section class="quality-chart"><h3>评价分布</h3><p>优秀与不佳评价的占比</p><svg viewBox="0 0 260 205" role="img" aria-label="优秀${data.positive}条，不佳${data.negative}条，好评率${data.positiveRate}%"><circle cx="130" cy="95" r="66" fill="none" stroke="${data.total?'#d88c91':'var(--border-strong)'}" stroke-width="14"/><circle cx="130" cy="95" r="66" fill="none" stroke="#69a994" stroke-width="14" stroke-dasharray="${ratio*circumference} ${circumference}" transform="rotate(-90 130 95)"/><text x="130" y="93" text-anchor="middle" fill="currentColor" font-size="26">${data.total?data.positiveRate+'%':'—'}</text><text x="130" y="117" text-anchor="middle" fill="currentColor" font-size="12">${data.total?'好评率':'暂无评价'}</text></svg>${legend}</section>
    <section class="quality-chart"><h3>评价趋势</h3><p>按日统计当前评价；修改评价会归入修改日期，取消评价后不再计数。</p><svg viewBox="0 0 600 205" role="img" aria-label="每日优秀与不佳评价趋势">${[0,.5,1].map(v=>`<path d="M42 ${y(max*v)}H572" stroke="var(--border-strong)"/><text x="30" y="${y(max*v)+4}" text-anchor="end" fill="currentColor" font-size="11">${Math.round(max*v)}</text>`).join('')}<polyline points="${line('positive')}" fill="none" stroke="#69a994" stroke-width="2"/><polyline points="${line('negative')}" fill="none" stroke="#d88c91" stroke-width="2"/>${dots('positive')}${dots('negative')}${trend.filter((t,i)=>i===0||i===trend.length-1||i===Math.floor(trend.length/2)).map(t=>`<text x="${x(trend.indexOf(t))}" y="188" text-anchor="middle" fill="currentColor" font-size="11">${t.date.slice(5)}</text>`).join('')}</svg>${legend}<details class="quality-hint"><summary>查看每日数据</summary>${trend.map(t=>`${t.date}：优秀 ${t.positive}，不佳 ${t.negative}`).join('<br>')}</details></section>`;
}
function qualitySourcesHTML(item) {
  const sources = item.response?.sources || [];
  let result = sources.length ? sources.map(s=>`<div class="quality-source"><strong>${escapeHtml(s.fileName || s.documentId)} · ${s.pageNumber==null?'无页码':'第 '+s.pageNumber+' 页'} · Chunk ${escapeHtml(s.documentId)}:${s.chunkIndex}</strong><p>${escapeHtml(s.content || '')}</p></div>`).join('') : '<p>没有知识库引用。可检查知识库覆盖范围与检索结果。</p>';
  if (item.response?.service) result += `<div class="quality-source">办事引导：${escapeHtml(item.response.service.name)}<br>来源：${escapeHtml(item.response.source?.title || item.response.service.sourceTitle || '未提供')}<br>文档：${escapeHtml(item.response.source?.documentId || item.response.service.sourceDocumentId || '未提供')}</div>`;
  return result;
}
async function loadAIQuality() {
  const holder=$('#qualityRecords'); if (!holder) return;
  const owner=currentUser?.id, generation=++qualityGeneration;
  const valid=()=>holder.isConnected&&currentUser?.id===owner&&generation===qualityGeneration;
  const query = new URLSearchParams();
  for (const [key,id] of [['rating','qualityRating'],['startDate','qualityStart'],['endDate','qualityEnd']]) if ($('#'+id).value) query.set(key,$('#'+id).value);
  holder.innerHTML='<p class="quality-hint">正在加载评价记录…</p>'; $('#qualityError').innerHTML='';
  $('#qualityStats').innerHTML=''; $('#qualityCharts').innerHTML=''; $('#qualityPager').innerHTML='';
  try {
    const [summary,data] = await Promise.all([apiGet('/api/admin/ai-quality/summary?'+query),apiGet('/api/admin/ai-quality/feedback?'+query+`&page=${qualityState.page}&pageSize=${qualityState.pageSize}`)]);
    if (!valid()) return;
    qualityState.items=data.items;qualityState.total=data.total;
    $('#qualityScope').textContent=`数据范围：${summary.accessScope==='ALL'?'全校问答反馈':'已授权用户的问答反馈'}。统计当前有效评价，日期按最近一次评价或修改时间筛选；未指定日期时趋势展示最近30天。`;
    $('#qualityStats').innerHTML=[['累计评价',summary.total],['回复优秀',summary.positive],['回复不佳',summary.negative],['好评率',summary.total?summary.positiveRate+'%':'—']].map(([title,value])=>`<div class="quality-stat"><span>${title}</span><strong>${value}</strong></div>`).join('');
    $('#qualityCharts').innerHTML=qualityChartHTML(summary);
    holder.innerHTML=data.items.length?data.items.map(item=>`<article class="quality-record"><div class="quality-record-head"><span class="tag ${item.rating==='NEGATIVE'?'tag-failed':'tag-active'}">${item.rating==='NEGATIVE'?'回复不佳':'回复优秀'}</span><time>评价时间：${fmtTime(item.updatedAt)}</time></div><h3>${escapeHtml(item.question || '原问题不可用')}</h3><details><summary>查看 AI 回答与知识引用</summary><p>${escapeHtml(item.answer)}</p>${qualitySourcesHTML(item)}</details>${item.rating==='NEGATIVE'?`<div class="quality-record-head" style="margin-top:14px"><span class="quality-hint">${qualityIssues[item.issueType] || '待分类'} · ${qualityStatuses[item.handlingStatus] || '待处理'}</span><button class="btn btn-sm" data-review="${item.id}">标记与处理</button></div>${item.adminNote?`<p>处理备注：${escapeHtml(item.adminNote)}</p>`:''}`:''}</article>`).join(''):'<div class="quality-record quality-hint">当前筛选条件下暂无评价。</div>';
    holder.querySelectorAll('[data-review]').forEach(b=>b.addEventListener('click',()=>openQualityReview(Number(b.dataset.review))));
    renderPager('#qualityPager',qualityState,loadAIQuality);
  } catch(e) { if(valid()) { holder.innerHTML=''; $('#qualityError').innerHTML=errorBlock(e.message); } }
}
function openQualityReview(id) {
  const item=qualityState.items.find(r=>r.id===id);if(!item)return;
  openModal(`<div class="detail-head"><h2>差评标记与处理</h2><button class="icon-btn" onclick="closeModal()">✕</button></div><form class="detail-body quality-review-form" id="qualityReview"><p class="quality-hint">原因由管理员人工判断，请结合原问题、回答及引用核查。</p><label>问题原因<select class="input" name="issueType">${Object.entries(qualityIssues).map(([v,label])=>`<option value="${v}" ${v===item.issueType?'selected':''}>${label}</option>`).join('')}</select></label><label>处理状态<select class="input" name="handlingStatus">${Object.entries(qualityStatuses).map(([v,label])=>`<option value="${v}" ${v===item.handlingStatus?'selected':''}>${label}</option>`).join('')}</select></label><label>处理备注<textarea class="input" name="adminNote" maxlength="2000">${escapeHtml(item.adminNote)}</textarea></label><div role="alert" id="qualityReviewError"></div><button class="btn btn-primary" type="submit">保存处理结果</button></form>`,'affair-modal');
  const form=$('#qualityReview'), owner=currentUser?.id;
  form.addEventListener('submit',async e=>{
    e.preventDefault();const b=form.querySelector('[type="submit"]');b.disabled=true;
    const body=Object.fromEntries(new FormData(form));body.version=item.version;
    try { await apiRequest('PATCH',`/api/admin/ai-quality/feedback/${id}`,body);if(owner===currentUser?.id&&form.isConnected){closeModal();toast('处理结果已保存','success');loadAIQuality();} }
    catch(e){if(form.isConnected)$('#qualityReviewError').textContent=e.message || '保存失败';}
    finally {b.disabled=false;}
  });
}
