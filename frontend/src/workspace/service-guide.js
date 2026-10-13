/* Structured guides use the existing backend DTO and the original V1.1 progress domain. */
export function createServiceGuide(environment) {
  const { ServiceProgressStore, orderSteps } = environment.progress;


  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const contexts = new WeakMap();
  let owner = null, admin = false, store, unsubscribe;
  function setUser(id, isAdmin = false) {
    if (owner === id && admin === isAdmin && store) return;
    unsubscribe?.();
    owner = id;
    admin = isAdmin;
    // Progress is a personal checklist, never a school approval status.
    store = new ServiceProgressStore(() => {
      const storage = window.localStorage;
      const prefix = `campusagent:user:${owner}:`;
      return {
        getItem: key => storage.getItem(prefix + key),
        setItem: (key, value) => storage.setItem(prefix + key, value),
        removeItem: key => storage.removeItem(prefix + key)
      };
    });
    unsubscribe = store.subscribe(code => {
      document.querySelectorAll('[data-guide]').forEach(node => {
        const context = contexts.get(node);
        if (context?.track && context.service.code === code) paint(node, context);
      });
    });
  }
  function safeUrl(value, api = false) {
    try {
      const url = new URL(value, window.location.origin);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      if (api && url.origin !== new URL(environment.apiBase).origin) return '';
      return url.href;
    } catch { return ''; }
  }
  function html(turn, { readOnly = false } = {}) {
    const data = { service: turn.service, steps: turn.steps || [], source: turn.source, readOnly };
    return `<section class="msg-service service-guide" data-guide="${esc(JSON.stringify(data))}" aria-label="办事流程引导"></section>`;
  }
  function content(context) {
    const { service: s, steps, source, readOnly, track } = context;
    const state = track ? store.peek(s.code) : null;
    const stale = track && (state.serviceVersion !== s.version || state.serviceId !== s.id);
    const index = state ? steps.findIndex(step => step.order === state.currentStep) : -1;
    const current = steps[index];
    const percentage = steps.length && state ? Math.round(state.completedSteps.length / steps.length * 100) : 0;
    const api = environment.apiBase;
    const material = m => {
      const attachment = m.attachment;
      const download = attachment ? safeUrl(attachment.downloadUrl?.startsWith('/') ? api + attachment.downloadUrl : attachment.downloadUrl, true) : '';
      return `<div class="guide-material">
        ${track ? `<input type="checkbox" aria-label="已准备${esc(m.name)}" data-material="${esc(m.name)}" ${state.checkedMaterials.includes(m.name) ? 'checked' : ''} ${stale ? 'disabled' : ''}>` : '<span class="guide-material-dot">•</span>'}
        <div><strong>${esc(m.name)} <small>${m.required ? '必需' : '可选'}</small></strong>${m.description ? `<p>${esc(m.description)}</p>` : ''}
        ${download && !readOnly ? `<a class="link-btn guide-download" href="${esc(download)}" target="_blank" rel="noopener">↓ ${esc(attachment.filename || '下载模板')}</a>` : ''}</div></div>`;
    };
    const timeline = steps.map((step, i) => {
      const done = state?.completedSteps.includes(step.order);
      const active = state && !state.completed && state.currentStep === step.order;
      return `<li class="guide-step ${done ? 'is-done' : active ? 'is-current' : ''}" ${active ? 'aria-current="step"' : ''}>
        <span class="guide-step-marker">${done ? '✓' : i + 1}</span><div><b>${esc(step.title)}</b><span>${done ? '已完成' : active ? '当前步骤' : track ? '待完成' : '流程预览'}</span>
        ${!track && step.description ? `<p>${esc(step.description)}</p>` : ''}</div></li>`;
    }).join('');
    const field = (title, value) => `<div><dt>${title}</dt><dd>${esc(value || '暂未提供，请以学校通知为准')}</dd></div>`;
    const policy = safeUrl(source?.url || s.sourceUrl);
    const hasSource = source?.title || s.sourceTitle || source?.documentId || s.sourceDocumentId || policy;
    return `<header class="guide-heading"><div><span class="guide-eyebrow">办事指南${s.category ? ' · ' + esc(s.category) : ''}</span><h3>${esc(s.name || '办理事项')}</h3><p>${esc(s.department || '办理部门暂未维护')}</p></div>
      ${track && steps.length ? `<span class="guide-count">${state.completedSteps.length} / ${steps.length} 步</span>` : ''}</header>
      ${s.isExample ? '<p class="guide-notice">测试 / 示例数据，不代表学校真实政策，请以最新学校通知为准。</p>' : ''}
      ${track ? `<p class="guide-boundary">这是你的办理准备清单，实际申请进度以部门审核结果为准。</p>` : ''}
      ${track && store.getNotice(s.code) ? `<p class="guide-notice" role="status">${esc(store.getNotice(s.code))}</p>` : ''}
      ${track && !store.isPersistent(s.code) ? '<p class="guide-notice" role="status">浏览器暂时无法保存，仍可操作；刷新后进度可能丢失。</p>' : ''}
      ${stale ? '<p class="guide-notice">该卡片的流程版本已过期，请使用最新回复中的办事流程。</p>' : ''}
      ${steps.length ? `<section class="guide-section"><h4>办理流程 <small>共 ${steps.length} 步</small></h4>
        ${track ? `<div class="guide-progress-heading"><span>${state.completed ? '引导步骤已全部完成' : '逐步确认，按流程办理'}</span><b>${percentage}%</b></div><div class="guide-progress-track" role="progressbar" aria-label="办理准备进度" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100"><div style="width:${percentage}%"></div></div>` : ''}
        ${!track || stale ? `<ol class="guide-timeline">${timeline}</ol>` : ''}
        ${track && !stale ? state.completed ? `<div class="guide-current guide-completed" role="status"><h4>✓ 办理引导已完成</h4><p>你已确认完成全部步骤，实际办理结果仍以学校审核为准。</p><button class="btn btn-sm" data-guide-action="previous">返回最后一步</button></div>`
          : current ? `<section class="guide-current" aria-label="当前步骤详情" aria-live="polite"><span class="guide-eyebrow">当前步骤 · 第 ${index + 1} 步</span><h4>${esc(current.title)}</h4><p>${esc(current.description || '暂未提供步骤说明')}</p>
            <dl class="guide-step-facts">${field('负责部门', current.responsibleDepartment)}${field('办理地点', current.location)}${field('预计时间', current.estimatedTime)}${field('本步所需材料', current.requiredMaterials?.join('、') || '本步骤暂无额外材料要求')}</dl>
            <div class="guide-step-actions"><button class="btn btn-sm" data-guide-action="previous" ${index <= 0 ? 'disabled' : ''}>上一步</button><button class="btn btn-sm btn-primary" data-guide-action="complete" data-expected-step="${current.order}">${index === steps.length - 1 ? '完成本步骤' : '完成本步骤，进入下一步'}</button></div></section>` : '' : ''}
        ${track && !stale ? `<details class="guide-flow"><summary>查看完整办理流程 · ${steps.length} 步</summary><ol class="guide-timeline">${timeline}</ol></details><button class="guide-reset link-btn" data-guide-action="reset">重新开始引导</button>` : ''}</section>` : '<p class="guide-boundary">暂无办理步骤，请查看学校最新通知。</p>'}
      <section class="guide-section"><h4>所需材料 <small>${s.materials.length} 项</small></h4>${s.materials.length ? `<div class="guide-materials">${s.materials.map(material).join('')}</div>` : '<p class="guide-boundary">暂未提供材料要求。</p>'}</section>
      <details class="guide-details"><summary>办理条件与联系方式</summary>${s.requirements?.length ? `<ul>${s.requirements.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p>暂未维护办理条件。</p>'}<dl class="guide-step-facts">${field('办理地点', s.location)}${field('办公时间', s.officeHours)}${field('联系方式', s.contact)}${field('截止时间', s.deadline)}</dl></details>
      ${hasSource ? `<div class="guide-source">依据：${esc(source?.title || s.sourceTitle || '学校文件')}${source?.publishTime || s.sourcePublishTime ? ' · ' + esc(source?.publishTime || s.sourcePublishTime) : ''}
        ${policy ? `<a class="link-btn" href="${esc(policy)}" target="_blank" rel="noopener">查看原文 ↗</a>` : ''}
        ${!readOnly && (source?.documentId || s.sourceDocumentId) && s.id && s.status === 'ACTIVE' ? `<a class="link-btn" href="${api}/api/services/${s.id}/source" target="_blank" rel="noopener">下载来源文件</a>` : ''}</div>` : ''}
      ${!readOnly ? `<footer class="guide-footer">${track && !admin && s.id && s.status === 'ACTIVE' ? `<button class="btn btn-sm btn-primary" data-guide-action="apply">立即办理</button>` : ''}<button class="btn btn-sm" data-guide-action="detail">查看事项详情</button></footer>` : ''}`;
  }
  function paint(node, context) {
    const opened = ['.guide-details', '.guide-flow'].filter(selector => node.querySelector(selector)?.open);
    node.innerHTML = content(context);
    opened.forEach(selector => { const details = node.querySelector(selector); if (details) details.open = true; });
  }
  function mount(root = document) {
    root.querySelectorAll('[data-guide]').forEach(node => {
      if (contexts.has(node)) return;
      const raw = JSON.parse(node.dataset.guide);
      const s = { ...raw.service, version: raw.service.version ?? 0, materials: raw.service.materials || [] };
      const context = { ...raw, service: s, steps: orderSteps(raw.steps || []), track: !raw.readOnly && owner != null && !!s.code };
      if (context.track) store.getProgress(s, context.steps);
      contexts.set(node, context);
      paint(node, context);
      node.addEventListener('change', event => {
        const input = event.target.closest('[data-material]');
        if (input && context.track) store.setMaterialChecked(s.code, input.dataset.material, input.checked);
      });
      node.addEventListener('click', event => {
        const button = event.target.closest('[data-guide-action]');
        if (!button) return;
        event.stopPropagation();
        const action = button.dataset.guideAction;
        if (action === 'detail') { environment.showAffair(s.id); return; }
        if (action === 'apply') { environment.openNewApplication(s.id); return; }
        if (!context.track || button.disabled) return;
        if (action === 'reset') {
          if (confirm('确定重新开始该办事流程吗？这会清除本事项的准备进度和材料勾选。')) store.resetProgress(s.code);
        } else {
          // The domain store rejects stale/double clicks; disable freshly painted buttons as well.
          const changed = action === 'complete' ? store.completeCurrentStep(s.code, Number(button.dataset.expectedStep)) : store.goPreviousStep(s.code);
          if (changed) {
            document.querySelectorAll('[data-guide]').forEach(card => {
              if (contexts.get(card)?.service.code === s.code) card.querySelectorAll('[data-guide-action="complete"], [data-guide-action="previous"]').forEach(control => control.disabled = true);
            });
            setTimeout(() => { if (node.isConnected) document.querySelectorAll('[data-guide]').forEach(card => { const ctx = contexts.get(card); if (ctx?.track && ctx.service.code === s.code) paint(card, ctx); }); }, 520);
          }
        }
      });
    });
  }
  return { html, mount, setUser };
}
