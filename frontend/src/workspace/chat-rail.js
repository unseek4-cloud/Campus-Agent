/* ============================================================
   ChatRail · 问答页右侧「行边栏」
   ------------------------------------------------------------
   把当前对话的每一轮（用户提问 + 对应回答）映射成问答页最右边的一条
   刻度，并与聊天区双向联动。邻近感应沿用 React Bits LineSidebar 的做法
   （距离 → falloff 曲线 → 0..1 强度），但这里刻度数量少、又是横线，
   所以视觉过渡直接交给 CSS 的 transition，不再额外跑 rAF 循环。

   摘要卡片内容 = 用户提问（主行）+ AI 回答开头 15 个字 + "……"（次行）；
   这一轮还没有回答时（例如只落了提问）只显示提问那一行。

   用法（app.js 里已经接好）：
     window.ChatRail.sync();     // 消息列表变化后调用，内部按元素身份去重
     window.ChatRail.detach();   // 离开问答页时调用
   ============================================================ */
export function createChatRail() {

  'use strict';

  const DEFAULTS = {
    proximityRadius: 88,    /* px：指针纵向多近开始影响一条刻度 */
    activationWidth: 150,   /* px：指针进入右侧这么宽的感应区才生效 */
    falloff: 'smooth',      /* 距离到强度的曲线 */
    minGap: 6,              /* px：刻度间距下限 */
    maxGap: 24,             /* px：刻度间距上限 */
    hotThreshold: 0.42,     /* 强度超过它才算"指向"这一轮 */
    tickHeight: 8,          /* px：与 CSS 的 .qa-rail__tick 高度一致 */
  };

  const FALLOFF_CURVES = {
    linear: p => p,
    smooth: p => p * p * (3 - 2 * p),
    sharp: p => p * p * p,
  };

  const clamp = (min, value, max) => Math.min(Math.max(value, min), max);
  const prefersReducedMotion = () =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 摘要卡片里回答只露开头这么多字，后面补"……"。
     设为 0 表示不截断，完全交给 CSS 的 3 行截断（卡片会更高）。 */
  const ANSWER_PREVIEW_CHARS = 15;

  const opts = Object.assign({}, DEFAULTS);
  let st = null;

  /* ---------- 轮次与文案 ---------- */

  /* 一轮 = 一条用户消息 + 紧随其后的若干条回答；没有用户消息的轮次
     （例如只有回答的异常数据）单独成轮，保证刻度数量与内容一致。 */
  function collectTurns(body) {
    const turns = [];
    body.querySelectorAll('.msg').forEach(msg => {
      if (msg.classList.contains('user') || !turns.length) turns.push({ nodes: [] });
      turns[turns.length - 1].nodes.push(msg);
    });
    return turns;
  }

  /* 气泡里是渲染后的 HTML，可能带 ** 加粗、# 标题、代码块等标记；
     引用标签、服务引导和调试信息都在气泡之外，不会被读进来。 */
  function tidyText(raw) {
    return (raw || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*`_#>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function bubbleText(node) {
    if (!node) return '';
    const bubble = node.querySelector('.msg-bubble');
    /* 还在生成中的占位气泡和失败提示都不算"回答" */
    if (!bubble || bubble.classList.contains('qa-thinking')) return '';
    return tidyText(bubble.textContent);
  }

  function turnParts(turn) {
    const userNode = turn.nodes.find(node => node.classList.contains('user'));
    const answerNode = turn.nodes.find(node =>
      node.classList.contains('bot') && !node.classList.contains('chat-error'));

    const question = bubbleText(userNode) || bubbleText(turn.nodes[0]);
    let answer = bubbleText(answerNode);
    if (answer && ANSWER_PREVIEW_CHARS > 0) {
      const chars = Array.from(answer);
      if (chars.length > ANSWER_PREVIEW_CHARS) {
        answer = chars.slice(0, ANSWER_PREVIEW_CHARS).join('') + '……';
      }
    }
    return { question: question || '（这一轮没有可显示的文本）', answer };
  }

  /* ---------- 高亮与摘要 ---------- */

  function setHot(index) {
    const item = st.ticks[index];
    if (!item) return;
    if (st.hot !== index) {
      st.ticks.forEach((tick, i) =>
        tick.turn.nodes.forEach(node => node.classList.toggle('rail-focus', i === index)));
      st.hot = index;
    }
    const { question, answer } = turnParts(item.turn);
    st.label.querySelector('.qa-rail__q').textContent = question;
    const answerEl = st.label.querySelector('.qa-rail__a');
    answerEl.textContent = answer;
    answerEl.hidden = !answer;
    st.label.style.top = (item.el.offsetTop + item.el.offsetHeight / 2) + 'px';
    st.label.classList.add('is-on');
  }

  function clearHot() {
    if (st.hot >= 0) {
      st.ticks.forEach(tick => tick.turn.nodes.forEach(node => node.classList.remove('rail-focus')));
      st.hot = -1;
    }
    st.label.classList.remove('is-on');
  }

  function resetEffects() {
    st.ticks.forEach(tick => tick.el.style.setProperty('--effect', '0'));
  }

  /* ---------- 滚动与定位 ---------- */

  function jump(index) {
    const item = st.ticks[index];
    if (!item) return;
    const first = item.turn.nodes[0];
    const delta = first.getBoundingClientRect().top - st.body.getBoundingClientRect().top;
    st.body.scrollTo({
      top: Math.max(0, st.body.scrollTop + delta - 28),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    setHot(index);
  }

  function markInView() {
    if (!st) return;
    const bodyRect = st.body.getBoundingClientRect();
    const top = bodyRect.top + 4;
    const bottom = bodyRect.bottom - 4;
    st.ticks.forEach(item => {
      const nodes = item.turn.nodes;
      const first = nodes[0].getBoundingClientRect();
      const last = nodes[nodes.length - 1].getBoundingClientRect();
      item.el.classList.toggle('is-inview', last.bottom > top && first.top < bottom);
    });
  }

  function layout() {
    if (!st || !st.rail.isConnected) return;
    const count = st.ticks.length;
    const available = Math.max(140, st.chat.clientHeight - 190);   /* 让开头部与输入区 */
    const gap = count > 1
      ? clamp(opts.minGap, (available - count * opts.tickHeight) / (count - 1), opts.maxGap)
      : opts.maxGap;
    st.rail.style.setProperty('--rail-gap', gap.toFixed(1) + 'px');
  }

  /* ---------- 事件 ---------- */

  function onPointerMove(event) {
    if (!st) return;
    const chatRect = st.chat.getBoundingClientRect();
    /* 只有靠近最右边才响应，其余位置保持"行边栏不明显" */
    if (chatRect.right - event.clientX > opts.activationWidth) {
      if (st.focused != null) return;
      resetEffects();
      clearHot();
      return;
    }

    const ease = FALLOFF_CURVES[opts.falloff] || FALLOFF_CURVES.smooth;
    const pointerY = event.clientY - st.rail.getBoundingClientRect().top;
    let best = -1;
    let bestEffect = 0;

    st.ticks.forEach((item, index) => {
      const center = item.el.offsetTop + item.el.offsetHeight / 2;
      const effect = ease(Math.max(0, 1 - Math.abs(pointerY - center) / opts.proximityRadius));
      item.el.style.setProperty('--effect', effect.toFixed(3));
      if (effect > bestEffect) { bestEffect = effect; best = index; }
    });

    if (best >= 0 && bestEffect >= opts.hotThreshold) setHot(best);
    else { clearHot(); }
  }

  function onPointerLeave() {
    if (!st) return;
    if (st.focused != null) { resetEffects(); setHot(st.focused); return; }
    resetEffects();
    clearHot();
  }

  function onScroll() {
    if (!st || st.scrollRaf) return;
    st.scrollRaf = requestAnimationFrame(() => {
      if (!st) return;
      st.scrollRaf = 0;
      markInView();
    });
  }

  function build(turns) {
    st.ticks.forEach(item => item.el.remove());
    st.label.remove();
    st.ticks = turns.map((turn, index) => {
      const tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'qa-rail__tick';
      tick.setAttribute('aria-label', `第 ${index + 1} 轮：${turnParts(turn).question.slice(0, 40)}`);
      tick.addEventListener('click', () => jump(index));
      tick.addEventListener('pointerenter', () => setHot(index));
      tick.addEventListener('focus', () => {
        st.focused = index;
        resetEffects();
        tick.style.setProperty('--effect', '1');
        setHot(index);
      });
      tick.addEventListener('blur', () => {
        st.focused = null;
        tick.style.setProperty('--effect', '0');
        clearHot();
      });
      st.rail.appendChild(tick);
      return { el: tick, turn };
    });
    st.rail.appendChild(st.label);      /* 摘要永远排在刻度之后，方便定位 */
    st.rail.classList.toggle('is-empty', st.ticks.length === 0);
    st.hot = -1;
    st.focused = null;
    layout();
    markInView();
    /* 空态/选择态会在同一帧里继续改布局，落一帧再量一次更稳 */
    requestAnimationFrame(() => { if (st) { layout(); markInView(); } });
  }

  function attach(chat, body) {
    detach();
    const rail = document.createElement('div');
    rail.className = 'qa-rail';
    rail.setAttribute('role', 'navigation');
    rail.setAttribute('aria-label', '对话轮次');
    const label = document.createElement('div');
    label.className = 'qa-rail__label';
    label.setAttribute('aria-hidden', 'true');
    label.innerHTML = '<span class="qa-rail__q"></span><span class="qa-rail__a"></span>';
    rail.appendChild(label);
    chat.appendChild(rail);

    st = { chat, body, rail, label, ticks: [], hot: -1, focused: null, nodes: null, scrollRaf: 0 };
    chat.addEventListener('pointermove', onPointerMove);
    chat.addEventListener('pointerleave', onPointerLeave);
    body.addEventListener('scroll', onScroll, { passive: true });
    if (typeof ResizeObserver === 'function') {
      st.observer = new ResizeObserver(() => layout());
      st.observer.observe(chat);
    }
  }

  function detach() {
    if (!st) return;
    if (st.scrollRaf) cancelAnimationFrame(st.scrollRaf);
    st.chat.removeEventListener('pointermove', onPointerMove);
    st.chat.removeEventListener('pointerleave', onPointerLeave);
    st.body.removeEventListener('scroll', onScroll);
    st.observer?.disconnect();
    st.rail.remove();
    st = null;
  }

  /* ---------- 对外入口 ---------- */

  /* 消息列表变化后调用；用元素身份而不是数量比较，切换会话也能准确重建 */
  function sync() {
    const chat = document.querySelector('.qa-chat');
    const body = document.getElementById('chatBody');
    if (!chat || !body || !chat.isConnected) { detach(); return; }
    if (!st || st.chat !== chat) attach(chat, body);

    const nodes = Array.from(body.querySelectorAll('.msg'));
    const same = st.nodes && st.nodes.length === nodes.length && st.nodes.every((node, i) => node === nodes[i]);
    if (same) return;
    st.nodes = nodes;
    build(collectTurns(body));
  }

  return { sync, detach };
}
