/* Reply toolbar; reuses app.js clipboard, sharing, citations and authenticated HTTP. */
(() => {
  const paths = {
    copy: ['M9 8h10v13H9z','M15 8V3H4v13h5'],
    feedback: ['M3 10h3v10H3z','M6 10l4-7h2v6h6l-1 11H6','M18 13h3v8h-3'],
    positive: ['M3 10h3v10H3z','M6 10l4-7h2v6h8l-2 11H6z'],
    negative: ['M3 4h3v10H3z','M6 14l4 7h2v-6h8L18 4H6z'],
    share: ['M12 16V3','m7 8 5-5 5 5','M4 13v8h16v-8'],
    regenerate: ['M20 10a8 8 0 0 0-14-4','M4 14a8 8 0 0 0 14 4','M20 3v7h-7','M4 21v-7h7'],
    more: ['M5 12h.01','M12 12h.01','M19 12h.01']
  };
  function icon(name) { return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name].map(d => `<path d="${d}"/>`).join('')}</svg>`; }
  function rating(el) { return el.dataset.rating || ''; }
  function button(act, label, selected = false, glyph = act) { return `<button type="button" class="msg-act reply-icon ${selected ? 'is-rated' : ''}" data-act="${act}" title="${label}" aria-label="${label}" ${act === 'feedback' || act === 'more' ? 'aria-haspopup="menu" aria-expanded="false"' : ''}>${icon(glyph)}</button>`; }
  function toolbar(el) {
    const value = rating(el);
    return button('copy','复制回复') + button('feedback', value === 'POSITIVE' ? '回复评价：回复优秀' : value === 'NEGATIVE' ? '回复评价：回复不佳' : '回复评价', !!value, value === 'POSITIVE' ? 'positive' : value === 'NEGATIVE' ? 'negative' : 'feedback')
      + button('share','选择消息并分享') + button('regenerate','重新生成（保留原回答）') + button('more','更多操作')
      + `<span class="msg-time">${escapeHtml(fmtMsgTime(el.dataset.time))}</span>`;
  }
  let closeCurrent;
  function menu(trigger, items) {
    if (trigger.getAttribute('aria-expanded') === 'true') { closeCurrent?.(); return; }
    closeCurrent?.();
    const panel = document.createElement('div'); panel.className = 'reply-menu'; panel.setAttribute('role','menu');
    items.forEach(item => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role','menuitem'); b.setAttribute('aria-label',item.label);
      b.innerHTML = `${item.icon ? icon(item.icon) : ''}<span>${escapeHtml(item.label)}</span>${item.selected ? '<span class="reply-check">✓</span>' : ''}`;
      if (item.selected) b.className = 'is-selected';
      b.addEventListener('click', async () => { close(false); await item.run(); }); panel.appendChild(b);
    });
    document.body.appendChild(panel); trigger.setAttribute('aria-expanded','true');
    const rect = trigger.getBoundingClientRect();
    panel.style.left = Math.max(8,Math.min(rect.left,innerWidth-panel.offsetWidth-8))+'px';
    panel.style.top = Math.max(8,rect.top >= panel.offsetHeight+12 ? rect.top-panel.offsetHeight-8 : Math.min(rect.bottom+8, innerHeight-panel.offsetHeight-8))+'px';
    function close(focus = true) {
      panel.remove(); trigger.setAttribute('aria-expanded','false'); document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize',scroll);
      closeCurrent = undefined; if (focus && trigger.isConnected) trigger.focus();
    }
    function outside(e) { if (!panel.contains(e.target) && !trigger.contains(e.target)) close(false); }
    function scroll(e) { if (!panel.contains(e.target)) close(false); }
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
        e.preventDefault(); const buttons = [...panel.querySelectorAll('button')], i = buttons.indexOf(document.activeElement);
        buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length-1 : (i+(e.key === 'ArrowDown' ? 1 : -1)+buttons.length)%buttons.length].focus();
      }
      if (e.key === 'Tab') close(false);
    }
    document.addEventListener('pointerdown',outside,true); document.addEventListener('keydown',key);
    window.addEventListener('scroll',scroll,true); window.addEventListener('resize',scroll); closeCurrent = close;
    panel.querySelector('button')?.focus();
  }
  async function rate(el, value) {
    if (el.dataset.feedbackBusy === 'true') return;
    const id = Number(el.dataset.msgId), owner = currentUser?.id, old = rating(el);
    if (!id) return toast('回复尚未保存，请刷新后再评价','warn');
    el.dataset.feedbackBusy = 'true'; const trigger = el.querySelector('[data-act="feedback"]'); trigger.disabled = true;
    try {
      const next = old === value ? '' : value;
      const result = next ? await apiRequest('PUT', `/api/chat/messages/${id}/feedback`, { rating: next }) : await apiDelete(`/api/chat/messages/${id}/feedback`);
      if (!el.isConnected || currentUser?.id !== owner) return;
      el.dataset.rating = result?.rating || '';
      const r = rating(el); trigger.innerHTML = icon(r === 'POSITIVE' ? 'positive' : r === 'NEGATIVE' ? 'negative' : 'feedback');
      trigger.classList.toggle('is-rated', !!r);
      trigger.title = trigger.ariaLabel = r ? `回复评价：${r === 'POSITIVE' ? '回复优秀' : '回复不佳'}` : '回复评价';
      toast(next ? '评价已保存，感谢你的反馈' : '已取消评价','success');
    } catch (e) { toast(e.message || '评价保存失败，请重试','error'); }
    finally { el.dataset.feedbackBusy = 'false'; trigger.disabled = false; }
  }
  function bind(el, acts) {
    acts.querySelector('[data-act="feedback"]')?.addEventListener('click', e => {
      e.stopPropagation(); const r = rating(el);
      menu(e.currentTarget,[{label:'回复优秀',icon:'positive',selected:r === 'POSITIVE',run:()=>rate(el,'POSITIVE')}, {label:'回复不佳',icon:'negative',selected:r === 'NEGATIVE',run:()=>rate(el,'NEGATIVE')}]);
    });
    acts.querySelector('[data-act="regenerate"]')?.addEventListener('click', e => { e.stopPropagation(); regenerateReply(el); });
    acts.querySelector('[data-act="more"]')?.addEventListener('click', e => {
      e.stopPropagation();
      menu(e.currentTarget,[{label:'查看知识来源',run:()=>{
        const sources = JSON.parse(el.dataset.sources || '[]');
        if (sources.length) showSourceCite(0,el); else toast('这条回复没有知识库引用','info');
      }},{label:'编辑原问题',run:()=>{
        let previous = el.previousElementSibling; while (previous && !previous.classList.contains('user')) previous = previous.previousElementSibling;
        const input = $('#qaInput'); if (input && chatAvailable() && previous) { input.value = previous.querySelector('.msg-bubble')?.innerText || ''; input.dispatchEvent(new Event('input')); input.focus(); }
        else toast('请等待当前回答完成','info');
      }},...(rating(el) ? [{label:'取消评价',run:()=>rate(el,rating(el))}] : [])]);
    });
  }
  window.CampusFeedback = { toolbar, bind, icon };
})();
