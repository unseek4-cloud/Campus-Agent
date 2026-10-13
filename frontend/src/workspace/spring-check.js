/* ============================================================
   SpringCheck · 原生 JS 移植版（React Bits <SpringCheck /> 的等价实现）
   ------------------------------------------------------------
   原组件：React + motion/react + @hugeicons/core-free-icons。
   此交互模块保留原有 JS + CSS 行为，由 Vue 页面负责挂载，
   不引入 React 或额外动画依赖：

     · 勾选时由盒子中心「鼓」出填充（弹簧，会冲过 100% 再回落）
     · 对勾用 stroke-dashoffset 描边画出
     · 文字上一条划线按 strikeLag 滞后擦除，完成后墨色降到 doneOpacity
     · 按下缩放、悬停描边加深、focus-visible 焦点圈、prefers-reduced-motion
     · role="checkbox" + aria-checked，键盘 Space/Enter 原生可用

   弹簧参数与原组件一致：
     ζ(bounce) = -ln(b) / sqrt(π² + ln(b)²)   —— 与原实现的 zetaOf 相同
     ω0        = 2π / VISUAL_DURATION(0.2s)
   读数映射也与原实现一致（SWELL 0.35 / RULE_END 0.84 / 对勾 1-t）。

   用法一（推荐，配合字符串模板）：
     <span data-spring-check data-label="学生证补办申请表" data-checked="false"></span>
     SpringCheck.mount(rootElement);

   用法二（直接建元素）：
     const el = SpringCheck.create({ label: 'Ship the build', defaultChecked: false,
       onChange: v => console.log(v) });
   ============================================================ */
export function createSpringCheck() {

  'use strict';

  const VISUAL_DURATION = 0.2;
  const RULE_END = 0.84;
  const SWELL = 0.35;
  /* 24×24 viewBox 上的对勾单路径，配合 pathLength=1 可整段描边 */
  const TICK_PATH = 'M5 12.6 9.4 17 19 6.8';
  const ORIGIN = { left: 'left center', center: 'center', right: 'right center', none: 'left center' };

  const clamp01 = (value) => Math.min(1, Math.max(0, value));
  const zetaOf = (bounce) => (bounce <= 0 ? 1 : -Math.log(bounce) / Math.sqrt(Math.PI ** 2 + Math.log(bounce) ** 2));
  const reduceMotion = () =>
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 弹簧读数 → 五条派生属性，数值含义与原组件 readings() 完全一致 */
  const readings = (t, doneOpacity, strikeLag) => {
    const held = clamp01(t);
    return {
      fill: `scale(${Math.max(t, 0)})`,
      box: `scale(${1 + SWELL * Math.max(0, t - 1)})`,
      tick: 1 - held,
      word: 1 - (1 - doneOpacity) * held,
      rule: `scaleX(${clamp01((held - strikeLag) / (RULE_END - strikeLag))})`,
    };
  };

  const DEFAULTS = {
    label: 'Ship the build',
    checked: undefined,
    defaultChecked: false,
    onChange: null,
    disabled: false,
    color: '#ffffff',
    fillColor: '#ffffff',
    checkColor: '#0b0b0f',
    boxSize: 28,
    boxRadius: 9,
    fontSize: 18,
    bounce: 0.2,
    strikeLag: 0.12,
    doneOpacity: 0.42,
    strike: 'left',
    ariaLabel: undefined,
    className: '',
    /* 移植扩展：原组件把行高固定为 max(44, boxSize+16)。紧凑列表里可以
       用它压回原来的行高，默认值与原组件保持一致。 */
    minRow: null,
  };

  class SpringCheck {
    constructor(options = {}) {
      const o = Object.assign({}, DEFAULTS, options);
      this.o = o;
      this.controlled = o.checked !== undefined;
      this.on = this.controlled ? !!o.checked : !!o.defaultChecked;
      this.viaPointer = false;
      this.instant = false;
      this.v = 0;
      this.t = this.on ? 1 : 0;
      this.raf = 0;
      this.last = 0;

      this.zeta = zetaOf(o.bounce);
      this.omega = (2 * Math.PI) / VISUAL_DURATION;
      /* rAF 回调以 this=window 调用，未绑定的类方法会立刻抛错，必须先绑定 */
      this.step = this.step.bind(this);

      const ring = o.boxSize >= 24 ? 2 : 1.5;
      const gap = Math.min(16, Math.max(8, Math.round(o.boxSize * 0.43)));
      const ruleHeight = Math.max(1.5, Math.round(o.fontSize / 6) / 2);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'checkbox');
      btn.setAttribute('aria-checked', this.on ? 'true' : 'false');
      if (o.ariaLabel) btn.setAttribute('aria-label', o.ariaLabel);
      btn.disabled = !!o.disabled;
      btn.className = 'spring-check' + (o.className ? ' ' + o.className : '');
      btn.style.setProperty('--sc-ink', o.color);
      btn.style.setProperty('--sc-fill', o.fillColor);
      btn.style.setProperty('--sc-check', o.checkColor);
      btn.style.setProperty('--sc-box', o.boxSize + 'px');
      btn.style.setProperty('--sc-radius', o.boxRadius + 'px');
      btn.style.setProperty('--sc-font', o.fontSize + 'px');
      btn.style.setProperty('--sc-ring', ring + 'px');
      btn.style.setProperty('--sc-gap', gap + 'px');
      btn.style.setProperty('--sc-row', (o.minRow != null ? o.minRow : Math.max(44, o.boxSize + 16)) + 'px');
      btn.style.setProperty('--sc-rule', ruleHeight + 'px');
      btn.style.setProperty('--sc-origin', ORIGIN[o.strike] || ORIGIN.left);

      const press = document.createElement('span');
      press.className = 'spring-check__press';
      const box = document.createElement('span');
      box.className = 'spring-check__box';
      const ringEl = document.createElement('span');
      ringEl.className = 'spring-check__ring';
      ringEl.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.className = 'spring-check__fill';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'spring-check__tick');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', TICK_PATH);
      path.setAttribute('pathLength', '1');
      path.setAttribute('stroke-dasharray', '1');
      svg.appendChild(path);
      box.append(ringEl, fill, svg);
      press.appendChild(box);

      const labelEl = document.createElement('span');
      labelEl.className = 'spring-check__label';
      const word = document.createElement('span');
      word.className = 'spring-check__word';
      word.textContent = o.label;
      labelEl.appendChild(word);
      let rule = null;
      if (o.strike !== 'none') {
        rule = document.createElement('span');
        rule.className = 'spring-check__rule';
        rule.setAttribute('aria-hidden', 'true');
        labelEl.appendChild(rule);
      }
      btn.append(press, labelEl);

      this.el = btn;
      this.box = box;
      this.fill = fill;
      this.tick = path;
      this.word = word;
      this.rule = rule;

      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || o.disabled) return;
        this.viaPointer = true;
        if (!reduceMotion()) btn.dataset.pressed = '';
      });
      const release = () => { delete btn.dataset.pressed; };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', () => { this.viaPointer = false; release(); });
      btn.addEventListener('pointerleave', () => { this.viaPointer = false; release(); });
      btn.addEventListener('click', () => this.toggle(this.viaPointer));

      this.write(this.t);
    }

    write(t) {
      const r = readings(t, this.o.doneOpacity, this.o.strikeLag);
      this.fill.style.transform = r.fill;
      this.box.style.transform = r.box;
      this.tick.style.strokeDashoffset = r.tick;
      this.word.style.opacity = r.word;
      if (this.rule) this.rule.style.transform = r.rule;
    }

    get checked() { return this.on; }

    /** 跳到终值，不跑弹簧（reduced-motion 或键盘激活时使用） */
    jump(target) {
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
      this.t = target;
      this.v = 0;
      this.write(this.t);
    }

    step(now) {
      this.raf = 0;
      const target = this.on ? 1 : 0;
      const dt = Math.min(0.032, this.last ? (now - this.last) / 1000 : 1 / 60) || 1 / 60;
      this.last = now;
      const k = this.omega * this.omega;
      const c = 2 * this.zeta * this.omega;
      const a = -k * (this.t - target) - c * this.v;
      this.v += a * dt;
      this.t += this.v * dt;
      this.write(this.t);
      if (Math.abs(this.t - target) < 0.0015 && Math.abs(this.v) < 0.02) {
        this.t = target;
        this.v = 0;
        this.write(this.t);
        this.last = 0;
        return;
      }
      this.raf = requestAnimationFrame(this.step);
    }

    animateTo(target) {
      if (reduceMotion()) { this.jump(target); return; }
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
      this.last = 0;
      this.raf = requestAnimationFrame(this.step);
    }

    set(next, { instant = false } = {}) {
      next = !!next;
      if (this.on === next && !this.raf && this.t === (next ? 1 : 0)) return;
      this.on = next;
      this.el.setAttribute('aria-checked', next ? 'true' : 'false');
      /* 指针点选走弹簧；键盘 / 程序化切换直接落位（与原组件一致） */
      if (instant) this.jump(next ? 1 : 0);
      else this.animateTo(next ? 1 : 0);
    }

    toggle(viaPointer = false) {
      if (this.o.disabled) return;
      this.instant = !viaPointer;
      this.viaPointer = false;
      const next = !this.on;
      this.set(next, { instant: this.instant });
      if (typeof this.o.onChange === 'function') this.o.onChange(next);
    }

    destroy() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.el.remove();
    }
  }

  /** 建元素并返回（不挂到 DOM 上） */
  const create = (options) => new SpringCheck(options).el;

  const numOr = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const boolOf = (value) => value === '' || value === 'true' || value === '1';

  /**
   * 把 root 内所有 [data-spring-check] 占位元素替换成组件实例。
   * 占位元素可用的 data-* 参数：
   *   data-label data-checked data-disabled data-color data-fill data-check
   *   data-box data-radius data-font data-bounce data-strike-lag
   *   data-done-opacity data-strike data-row data-aria-label data-class-name
   * 联动：所在行（最近的 [data-spring-row] 或 .material-item）会同步 .checked，
   * 并在行上派发冒泡事件 spring-check:change（detail: { checked, label }）。
   */
  function mount(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-spring-check]').forEach((host) => {
      const d = host.dataset;
      const options = {
        label: d.label || '',
        defaultChecked: boolOf(d.checked),
        disabled: boolOf(d.disabled),
        color: d.color || 'var(--text-1)',
        fillColor: d.fill || 'var(--primary)',
        checkColor: d.check || '#fff',
        boxSize: numOr(d.box, 28),
        boxRadius: numOr(d.radius, 9),
        fontSize: numOr(d.font, 18),
        bounce: numOr(d.bounce, 0.2),
        strikeLag: numOr(d.strikeLag, 0.12),
        doneOpacity: numOr(d.doneOpacity, 0.42),
        strike: d.strike || 'left',
        ariaLabel: d.ariaLabel || undefined,
        className: d.className || '',
        minRow: d.row === undefined ? null : numOr(d.row, 44),
      };
      const row = host.closest('[data-spring-row]') || host.closest('.material-item');
      const view = new SpringCheck(Object.assign({}, options, {
        onChange: (checked) => {
          if (row) row.classList.toggle('checked', checked);
          (row || view.el).dispatchEvent(new CustomEvent('spring-check:change', {
            bubbles: true,
            detail: { checked, label: options.label },
          }));
        },
      }));
      host.replaceWith(view.el);
      /* 保持「整行可点」的原手感；组件自身、链接、按钮不重复触发 */
      if (row && row.dataset.springRow !== 'off') {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.spring-check')) return;
          if (e.target.closest('a, button, input, textarea, select, label')) return;
          view.toggle(true);
        });
      }
    });
  }

  return { create, mount, Class: SpringCheck };
}
