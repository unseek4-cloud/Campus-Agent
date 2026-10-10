/* ============================================================
   CampusAgent · 应用主逻辑
   路由 / 视图渲染 / 交互 / 工具函数
   对接后端真实 API（Spring Boot + Cookie/CSRF 鉴权）
   ============================================================ */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const M = window.MOCK;
// Storage is optional; restrictive browser settings must not prevent login or a guide.
const tabValues = new Map();
const tabStorage = {
  getItem(key) { try { return sessionStorage.getItem(key); } catch { return tabValues.get(key) ?? null; } },
  setItem(key, value) { tabValues.set(key, value); try { sessionStorage.setItem(key, value); } catch { } },
  removeItem(key) { tabValues.delete(key); try { sessionStorage.removeItem(key); } catch { } }
};

/* ---------- API 基础配置 ----------
   后端 Cookie（CAMPUS_AUTH / XSRF-TOKEN）都是 SameSite=Lax：
   只有「同站」请求才会带上 Cookie，因此 API 必须与页面同主机同协议，
   仅端口不同（http://localhost:5173 → http://localhost:8080 才算同站）。
   若写成 127.0.0.1 而页面在 localhost，属于跨站，登录后 Cookie 不会被发送，
   表现就是"登录成功却立刻回到登录页"。所以这里按页面主机名推导。 */
const API_PORT = 8080;
const API_HOST = location.hostname || "127.0.0.1";
const API_BASE = window.CAMPUS_API_BASE || `http://${API_HOST}:${API_PORT}`;
const CSRF_HEADER_FALLBACK = "X-XSRF-TOKEN";
let chatConversationId = null;

/* ---------- CSRF / 鉴权工具 ----------
   后端 CsrfFilter 使用 CookieCsrfTokenRepository：
   - XSRF-TOKEN Cookie 是 HttpOnly，JS 读不到，必须从 /api/auth/csrf 的响应体取 token；
   - 写请求要把 token 放进响应体给出的 headerName（默认 X-XSRF-TOKEN）；
   - 登录 / 登出时后端会轮换（清空）该 Cookie，所以本地缓存必须同步失效。 */
const csrfCacheKey = "ca-csrf";
let csrfRequest = null;

function readCsrf() {
  try { return JSON.parse(tabStorage.getItem(csrfCacheKey) || "null"); } catch (e) { return null; }
}
function clearCsrf() { tabStorage.removeItem(csrfCacheKey); }

async function ensureCsrf(force = false) {
  if (!force) {
    const cached = readCsrf();
    if (cached && cached.token) return cached;
  }
  csrfRequest ??= (async () => {
    let res;
    try {
      res = await fetch(`${API_BASE}/api/auth/csrf`, { credentials: "include", headers: { Accept: "application/json" } });
    } catch (e) {
      // 跨源被 CORS 拒绝 / 后端未启动，都表现为 fetch 抛错，这里统一翻译成可操作的提示
      const err = new Error(networkErrorMessage());
      err.code = "NETWORK";
      throw err;
    }
    if (!res.ok) throw new Error("无法获取页面验证令牌（CSRF），请确认后端已启动");
    const json = await res.json();
    const token = json?.data?.token;
    if (!token) throw new Error("页面验证令牌为空，请刷新后重试");
    const value = { token, headerName: json?.data?.headerName || CSRF_HEADER_FALLBACK };
    tabStorage.setItem(csrfCacheKey, JSON.stringify(value));
    return value;
  })().finally(() => { csrfRequest = null; });
  return csrfRequest;
}

/** 把 fetch 抛出的网络错误翻译成可操作的中文提示。
    浏览器对「后端没启动」和「跨源被 CORS 拒绝」都只报同一句 Failed to fetch，
    所以这里把两种可能一起说清楚。 */
function networkErrorMessage() {
  const openedAsFile = location.origin === "null" || location.protocol === "file:";
  const origin = openedAsFile ? "file://（直接双击打开 HTML）" : location.origin;
  const base = `无法连接后端 ${API_BASE}。当前页面来源：${origin}。`;
  if (openedAsFile) {
    return base + "双击打开时来源为 null，跨源请求一定会被浏览器拒绝，请用静态服务器打开本页（例如在【前端界面】目录执行 python -m http.server 5500）。";
  }
  return base + "请检查：① Java 后端是否已启动（默认 8080）；② 该来源是否已在后端 campus.auth.allowed-origins / AUTH_ALLOWED_ORIGINS 中放行。";
}

async function apiRequest(method, path, body, isForm = false, retry = true) {
  const headers = { Accept: "application/json" };
  if (!isForm && body !== undefined) headers["Content-Type"] = "application/json";
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = await ensureCsrf();
    headers[csrf.headerName] = csrf.token;
  }
  const opts = { method, headers, credentials: "include" };
  if (body !== undefined) opts.body = isForm ? body : JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, opts);
  } catch (e) {
    const err = new Error(networkErrorMessage());
    err.code = "NETWORK";
    throw err;
  }

  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  const code = json?.code;

  // CSRF 令牌过期：清缓存 + 重新获取，原请求重试一次（见后端 CSRF_INVALID 约定）
  if (res.status === 403 && retry && code === "CSRF_INVALID" && path !== "/api/auth/login") {
    clearCsrf();
    return apiRequest(method, path, body, isForm, false);
  }

  // 401：仅对需要登录的业务接口做"会话失效"处理；
  // 登录本身与首屏 /auth/me 的 401 属于正常业务结果，不能触发跳转，否则会盖掉错误提示。
  if (res.status === 401 && !["/api/auth/login", "/api/auth/me"].includes(path)) {
    if (!sessionExpiredHandled) {
      sessionExpiredHandled = true;
      toast("登录已失效，请重新登录", "warn");
      tabStorage.removeItem("ca-user");
      currentUser = null;
      setTimeout(() => { sessionExpiredHandled = false; showLogin(); }, 600);
    }
    const expired = new Error(json?.message || "请先登录");
    expired.code = code || "AUTH_REQUIRED";
    expired.status = 401;
    throw expired;
  }

  // 强制改密：后端 MustChangePasswordFilter 会拦住所有业务接口，
  // 前端必须把用户送到改密页，而不是让他在业务页面上反复收到 403。
  if (res.status === 403 && code === "MUST_CHANGE_PASSWORD") {
    if (currentUser) {
      currentUser.mustChangePassword = true;
      tabStorage.setItem("ca-user", JSON.stringify(currentUser));
    }
    showChangePassword();
    const needChange = new Error(json?.message || "请先修改初始密码后再使用系统。");
    needChange.code = "MUST_CHANGE_PASSWORD";
    needChange.status = 403;
    throw needChange;
  }

  if (!res.ok) {
    const err = new Error(json?.message || `请求失败 (${res.status})`);
    err.code = code || "ERROR";
    err.status = res.status;
    err.payload = json;
    err.hint = errorHint(err.code);
    throw err;
  }
  return json?.data;
}
let sessionExpiredHandled = false;

/* ---------- 错误码 → 中文排查建议 ----------
   后端对 AI 链路只返回英文短语（如 "AI service is unavailable or timed out"），
   而同一句话可能来自三种完全不同的原因（Python 没起 / 模型在联网下载 / 上游大模型超时），
   因此这里补一段可操作的排查说明，避免用户对着英文无从下手。 */
const ERROR_HINTS = {
  AI_SERVICE_UNAVAILABLE:
    "AI 服务（ai-service，默认 8000 端口）未启动、不可达，或本次调用超时。排查顺序：① 确认 uvicorn 已在 8000 端口运行（GET /internal/v1/health）；② 若首次提问长时间卡住，通常是 embedding / rerank 模型在联网下载（HuggingFace 不通时设 HF_ENDPOINT=https://hf-mirror.com 下载，或设 HF_HUB_OFFLINE=1 使用本地缓存）；③ 确认后端 AI_SERVICE_BASE_URL 指向该服务。",
  AI_SERVICE_INVALID_RESPONSE: "AI 服务返回了无法解析的内容，通常是模型加载失败或依赖缺失，请查看 ai-service 控制台日志。",
  AI_SEARCH_FAILED: "AI 服务拒绝了本次检索请求，请检查向量库（Chroma）与知识库状态。",
  AI_INVALID_RESPONSE: "文档处理服务返回异常，请查看 ai-service 控制台日志。",
  LLM_NOT_CONFIGURED: "未配置大模型 Key：ai-service/.env 的 AI_QWEN_API_KEY 为空时，有检索证据的问答无法生成答案。",
  LLM_TIMEOUT: "上游大模型调用超时（ai-service 的 AI_LLM_TIMEOUT_SECONDS）。请检查网络/代理，必要时调整 AI_QWEN_TRUST_ENV。",
  LLM_REQUEST_FAILED: "上游大模型返回错误（常见 401/403：Key、地域或权限不匹配）。",
  DOCUMENT_BUSY: "该文档正在处理中，请等进度完成后再操作。",
  PROCESSING_QUEUE_FULL: "文档处理队列已满，请稍后重试。",
  UNSUPPORTED_ATTACHMENT_TYPE: "附件类型不支持，请按后端允许的格式重新上传。",
  /* 以下为 ai-service 直接返回的错误码（见 app/api/error_handlers.py） */
  VECTOR_STORE_UNAVAILABLE:
    "AI 服务的向量库（Chroma）打不开。最常见原因是同时启动了多个 ai-service 实例，或实例长时间运行后连接失效（数据本身不会丢，向量库可由原文档重建）。处理：关掉所有 AI 服务窗口，只保留一个并重启。",
  EMBEDDING_UNAVAILABLE:
    "AI 服务的 Embedding 模型不可用，通常是本地模型缓存缺失且无法联网下载。处理：设 HF_ENDPOINT=https://hf-mirror.com 下载一次，或确认 HF_HUB_OFFLINE 与缓存目录是否匹配。",
  RERANK_UNAVAILABLE:
    "AI 服务的重排模型不可用。重排是出答案的硬前提（缺它时检索到的证据会被全部过滤，表现为“暂未找到相关信息”）。处理：确认 BAAI/bge-reranker-base 已在本地缓存，或临时关闭重排并调整阈值。",
  DOCUMENT_EXTRACTION_FAILED:
    "文档解析失败。若是扫描件，需要 OCR 能力：云端走千问（AI_QWEN_OCR_ENABLED=true + Key），本地走 PaddleOCR（需安装 paddleocr/paddlepaddle）。",
  DOCUMENT_HAS_NO_TEXT: "该文档没有可提取的文本层（纯图片页），需要 OCR 支持。",
  OCR_PAGE_LIMIT_EXCEEDED: "超过 OCR 处理页数上限（AI_OCR_MAX_PAGES_PER_DOCUMENT，默认 50 页）。",
  UNSUPPORTED_DOCUMENT_TYPE: "暂不支持该文档格式（后端允许 pdf/docx/txt/md/xlsx/pptx/png/jpg/jpeg）。",
  INVALID_RETRIEVAL_REQUEST: "检索参数不合法，请检查查询内容与 topK。"
};
function errorHint(code) { return ERROR_HINTS[code] || ""; }

/** 统一的“错误 + 排查建议”展示块。 */
function errorBlock(message, hint) {
  return `<div class="msg-bubble" style="color:var(--danger)">${escapeHtml(message || "请求失败")}</div>
    ${hint ? `<div class="err-hint"><b>可能原因与排查</b><div>${escapeHtml(hint)}</div></div>` : ""}`;
}

const apiGet = (p) => apiRequest("GET", p);
const apiPost = (p, b) => apiRequest("POST", p, b);
const apiPatch = (p, b) => apiRequest("PATCH", p, b);
const apiDelete = (p) => apiRequest("DELETE", p);
const apiUpload = (p, formData) => apiRequest("POST", p, formData, true);

/* ---------- BorderGlow 边境光辉：注入子元素 + 监听鼠标位置 ----------
   原版 React Bits BorderGlow 通过 pointermove 更新两个 CSS 变量：
   --edge-proximity（0-100，光标距卡片中心的相对边缘距离）
   --cursor-angle（光标相对卡片中心的角度，0deg=上）
   只读这两个变量的 CSS 即可驱动整个光辉动画。 */
function enhanceGlowCards(scope = document) {
  const cards = $$('.glow-card', scope);
  cards.forEach(card => {
    if (!card.querySelector(':scope > .edge-light')) {
      const light = document.createElement('span');
      light.className = 'edge-light';
      light.setAttribute('aria-hidden', 'true');
      card.appendChild(light);
    }
    if (!card.querySelector(':scope > .edge-fill')) {
      const fill = document.createElement('span');
      fill.className = 'edge-fill';
      fill.setAttribute('aria-hidden', 'true');
      card.insertBefore(fill, card.firstChild);
    }
    if (card._glowBound) return;
    card._glowBound = true;
    card.addEventListener('pointermove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      let kx = Infinity, ky = Infinity;
      if (dx !== 0) kx = cx / Math.abs(dx);
      if (dy !== 0) ky = cy / Math.abs(dy);
      const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
      let degrees = 0;
      if (dx !== 0 || dy !== 0) {
        degrees = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        if (degrees < 0) degrees += 360;
      }
      card.style.setProperty('--edge-proximity', (edge * 100).toFixed(3));
      card.style.setProperty('--cursor-angle', degrees.toFixed(3) + 'deg');
    });
  });
}

/* ---------- FolderFloat 文件夹浮点：文档卡从文件夹里浮出并做零重力漂浮 ----------
   原版为 React Bits FolderFloat（React + matter-js），本项目是无构建步骤的静态前端，
   因此按同样的参数与行为移植为纯 JS + CSS，不引入 React / matter-js：
   - 位置算法同 layout()：按实测宽度分行、奇数行错位、jitter 抖动与倾斜；
   - 物理同原版 matter-js 配置：零重力、restitution 0.55、frictionAir 0.08、
     inertia = Infinity（所以卡片只平移不旋转）、静态墙围出漂浮云区域；
   - 支持指针拖拽与抛掷、悬停/点击展开、点击卡片打开文档详情；
   - prefers-reduced-motion 时只保留开合过渡，不启动物理。 */
const FF = {
  GAP: 12, ROW: 52, DRAG_MIN: 4, ZONE_PAD: 8,
  LIFT: 26, TILT: 8, DRIFT: 0.5,
  OPEN: 520, STAGGER: 45,
  REST: 0.55, DAMP: 3.4, FORCE: 34, VMAX: 460,
  MAX_ITEMS: 6
};

let docFolder = null;

const ffJitter = i => { const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return x - Math.floor(x); };
const ffClamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function ffStatus(d) {
  if (d.status === "SUCCESS") return { cls: "is-ok", text: "已索引" };
  if (d.status === "FAILED") return { cls: "is-bad", text: "解析失败" };
  return { cls: "is-run", text: "处理中" };
}

function docFolderHTML(list) {
  const n = list.length;
  return `
    <div class="folder-float" id="docFolder" data-trigger="hover" data-physics role="group"
         aria-label="文档处理状态：最近文档" style="--ff-n:${n}">
      <div class="folder-float__items" id="docFolderItems">
        ${list.map((d, i) => {
          const st = ffStatus(d);
          const name = d.displayName || d.originalFilename || d.id;
          const meta = `${st.text} · ${d.chunkCount || 0} 个分块 · ${relTime(d.createdAt || d.updatedAt)}`;
          return `
            <button type="button" class="folder-float__item" data-i="${i}" data-id="${escAttr(d.id)}"
                    style="--i:${i}" tabindex="-1" aria-hidden="true"
                    title="${escAttr(`${name} · ${meta}`)}">
              <span class="folder-float__drift"><i class="ff-dot ${st.cls}"></i>${escapeHtml(name)}</span>
            </button>`;
        }).join("")}
      </div>
      <div class="folder-float__folder">
        <span class="folder-float__back" aria-hidden="true"></span>
        <span class="folder-float__paper" aria-hidden="true"></span>
        <span class="folder-float__front" aria-hidden="true">
          <span class="folder-float__label">最近文档</span>
          <span class="folder-float__sub">${n} 份 · 悬停或点击展开</span>
        </span>
        <button type="button" class="folder-float__trigger" aria-expanded="false"
                aria-label="展开最近文档（${n} 份）"></button>
      </div>
    </div>`;
}

function destroyDocFolder() {
  const w = docFolder;
  if (!w) return;
  cancelAnimationFrame(w.raf);
  clearTimeout(w.timer);
  w.ro?.disconnect();
  w.mq?.removeEventListener?.("change", w.syncReduce);
  docFolder = null;
}

function mountDocFolder() {
  destroyDocFolder();
  const root = $("#docFolder");
  if (!root) return;
  const itemsBox = $("#docFolderItems");
  const pills = $$(".folder-float__item", root);
  const trigger = $(".folder-float__trigger", root);
  if (!itemsBox || !trigger || !pills.length) return;

  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const hoverable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const w = {
    root, itemsBox, pills, trigger, mq, hoverable,
    open: false, live: false, raf: 0, timer: 0, ro: null, width: 0,
    bodies: [], sizes: [], pos: [], zone: null, drag: null, last: 0, t0: 0, reduce: mq.matches
  };
  docFolder = w;

  // 初始为折叠态：与 docFolderHTML 的标记保持一致，不依赖模板属性
  root.removeAttribute("data-open");
  root.removeAttribute("data-live");
  trigger.setAttribute("aria-expanded", "false");
  pills.forEach(el => { el.tabIndex = -1; el.setAttribute("aria-hidden", "true"); });

  /* --- 位置：与组件 layout() 一致 --- */
  const paint = () => {
    pills.forEach((el, i) => {
      const p = w.pos[i];
      if (!p) return;
      const b = w.live ? w.bodies[i] : null;
      el.style.setProperty("--x", (b ? b.x : p.x).toFixed(1) + "px");
      el.style.setProperty("--y", (b ? b.y - w.sizes[i].h / 2 : p.y).toFixed(1) + "px");
      el.style.setProperty("--r", p.r.toFixed(2) + "deg");
    });
  };

  const layout = () => {
    const boxW = root.clientWidth || 360;
    const spread = Math.max(92, Math.min(180, Math.round(boxW / 2) - 18));
    const sizes = pills.map(el => ({ w: el.offsetWidth, h: el.offsetHeight }));
    const rows = [];
    let row = [], width = 0;
    sizes.forEach((s, i) => {
      if (row.length && width + FF.GAP + s.w > spread * 2) { rows.push({ items: row, width }); row = []; width = 0; }
      row.push({ i, pw: s.w });
      width += (row.length > 1 ? FF.GAP : 0) + s.w;
    });
    if (row.length) rows.push({ items: row, width });

    const pos = [];
    rows.forEach((r, ri) => {
      let x = -r.width / 2;
      const shift = (ri % 2 ? 1 : -1) * Math.min(16, spread * 0.1);
      r.items.forEach(({ i, pw }) => {
        const j = ffJitter(i);
        pos[i] = { x: x + pw / 2 + shift + (j - 0.5) * 6, y: -FF.LIFT - ri * FF.ROW - j * 6, r: FF.TILT * (j * 2 - 1) };
        x += pw + FF.GAP;
      });
    });

    const maxH = Math.max(...sizes.map(s => s.h));
    const minY = Math.min(...pos.map(p => p.y));
    w.sizes = sizes;
    w.pos = pos;
    w.zone = {
      left: -spread - FF.ZONE_PAD, right: spread + FF.ZONE_PAD,
      top: minY - FF.ZONE_PAD, bottom: -FF.LIFT + maxH
    };
    root.style.setProperty("--ff-spread", spread + "px");
    root.style.setProperty("--ff-head", Math.ceil(FF.LIFT + maxH + (rows.length - 1) * FF.ROW + 22) + "px");
    if (!w.live) paint();
  };

  /* --- 物理：matter-js 等价的最小积分器 --- */
  const seed = () => {
    w.bodies = w.sizes.map((s, i) => ({
      x: w.pos[i].x, y: w.pos[i].y + s.h / 2, vx: 0, vy: 0,
      w: s.w, h: s.h, phase: ffJitter(i) * Math.PI * 2
    }));
  };

  const collide = (a, b) => {
    const dx = b.x - a.x, px = (a.w + b.w) / 2 - Math.abs(dx);
    if (px <= 0) return;
    const dy = b.y - a.y, py = (a.h + b.h) / 2 - Math.abs(dy);
    if (py <= 0) return;
    if (px < py) {
      const s = (dx < 0 ? -1 : 1) * px / 2;
      a.x -= s; b.x += s;
      const rel = b.vx - a.vx;
      if (rel * (dx < 0 ? 1 : -1) < 0) { const imp = -(1 + FF.REST) * rel / 2; a.vx -= imp; b.vx += imp; }
    } else {
      const s = (dy < 0 ? -1 : 1) * py / 2;
      a.y -= s; b.y += s;
      const rel = b.vy - a.vy;
      if (rel * (dy < 0 ? 1 : -1) < 0) { const imp = -(1 + FF.REST) * rel / 2; a.vy -= imp; b.vy += imp; }
    }
  };

  const step = dt => {
    const damp = Math.exp(-FF.DAMP * dt);
    const z = w.zone;
    const bodies = w.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (w.drag && w.drag.i === i) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx = ffClamp(b.vx * damp, -FF.VMAX, FF.VMAX);
      b.vy = ffClamp(b.vy * damp, -FF.VMAX, FF.VMAX);
      const minX = z.left + b.w / 2, maxX = z.right - b.w / 2;
      const minY = z.top + b.h / 2, maxY = z.bottom - b.h / 2;
      if (b.x < minX) { b.x = minX; if (b.vx < 0) b.vx = -b.vx * FF.REST; }
      else if (b.x > maxX) { b.x = maxX; if (b.vx > 0) b.vx = -b.vx * FF.REST; }
      if (b.y < minY) { b.y = minY; if (b.vy < 0) b.vy = -b.vy * FF.REST; }
      else if (b.y > maxY) { b.y = maxY; if (b.vy > 0) b.vy = -b.vy * FF.REST; }
    }
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) collide(bodies[i], bodies[j]);
  };

  const stop = () => {
    clearTimeout(w.timer);
    cancelAnimationFrame(w.raf);
    w.raf = 0;
    if (w.live) paint();          // 先定格在当前漂浮位置，收回动画才不会跳
    w.live = false;
    w.drag = null;
    root.removeAttribute("data-live");
    pills.forEach(el => el.removeAttribute("data-drag"));
  };

  const start = () => {
    if (w.live || w.reduce || !w.open) return;
    seed();
    w.live = true;
    w.last = 0;
    w.t0 = performance.now();
    root.setAttribute("data-live", "");
    const tick = now => {
      if (!w.live) return;
      const dt = w.last ? Math.min(0.032, (now - w.last) / 1000) : 0.016;
      w.last = now;
      const t = (now - w.t0) / 1000;
      const k = FF.FORCE * FF.DRIFT * Math.min(1, t / 2);
      w.bodies.forEach((b, i) => {
        if (w.drag && w.drag.i === i) return;
        b.vx += Math.sin(t * 0.9 + b.phase) * k * dt;
        b.vy += Math.cos(t * 1.3 + b.phase * 1.7) * k * dt;
      });
      step(dt);
      paint();
      w.raf = requestAnimationFrame(tick);
    };
    w.raf = requestAnimationFrame(tick);
  };

  /* --- 开合 --- */
  const setOpen = next => {
    if (w.open === next) return;
    w.open = next;
    if (next) {
      paint();                    // 先回到排布位，升起动画才有正确的落点
      root.setAttribute("data-open", "");
      trigger.setAttribute("aria-expanded", "true");
      pills.forEach(el => { el.tabIndex = 0; el.removeAttribute("aria-hidden"); });
      clearTimeout(w.timer);
      w.timer = setTimeout(start, FF.OPEN + (pills.length - 1) * FF.STAGGER + 80);
    } else {
      root.removeAttribute("data-open");
      trigger.setAttribute("aria-expanded", "false");
      pills.forEach(el => { el.tabIndex = -1; el.setAttribute("aria-hidden", "true"); });
      stop();
    }
  };

  const pick = el => {
    el.setAttribute("data-pop", "");
    setTimeout(() => el.removeAttribute("data-pop"), 340);
    const id = el.dataset.id;
    if (id) showPolicyDetail(id);
  };

  /* --- 指针：拖拽 / 抛掷 / 点击 --- */
  const pointAt = e => {
    const r = itemsBox.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e, i) => {
    if (!w.live || e.button !== 0) return;
    const b = w.bodies[i];
    if (!b) return;
    const p = pointAt(e);
    w.drag = { i, id: e.pointerId, dx: b.x - p.x, dy: b.y - p.y, sx: e.clientX, sy: e.clientY, moved: false, t: performance.now() };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  };

  const move = (e, i) => {
    const d = w.drag;
    if (!d || d.i !== i || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) >= FF.DRAG_MIN) {
      d.moved = true;
      e.currentTarget.setAttribute("data-drag", "");
    }
    if (!d.moved) return;
    const b = w.bodies[i], z = w.zone;
    const p = pointAt(e);
    const x = ffClamp(p.x + d.dx, z.left + b.w / 2, z.right - b.w / 2);
    const y = ffClamp(p.y + d.dy, z.top + b.h / 2, z.bottom - b.h / 2);
    const now = performance.now();
    const dt = Math.max(0.008, (now - d.t) / 1000);
    b.vx = ffClamp((x - b.x) / dt, -FF.VMAX, FF.VMAX);
    b.vy = ffClamp((y - b.y) / dt, -FF.VMAX, FF.VMAX);
    b.x = x;
    b.y = y;
    d.t = now;
    paint();
  };

  const up = (e, i, el) => {
    const d = w.drag;
    if (!d || d.i !== i || d.id !== e.pointerId) return;
    w.drag = null;
    el.removeAttribute("data-drag");
    try { el.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
    if (!d.moved && e.type === "pointerup") pick(el);
  };

  root.addEventListener("pointerenter", () => { if (hoverable) setOpen(true); });
  root.addEventListener("pointerleave", () => { if (hoverable && !w.drag) setOpen(false); });
  trigger.addEventListener("click", e => { e.stopPropagation(); setOpen(!w.open); });
  root.addEventListener("keydown", e => {
    if (e.key === "Escape" && w.open) { e.stopPropagation(); setOpen(false); }
  });
  pills.forEach((el, i) => {
    el.addEventListener("pointerdown", e => down(e, i));
    el.addEventListener("pointermove", e => move(e, i));
    el.addEventListener("pointerup", e => up(e, i, el));
    el.addEventListener("pointercancel", e => up(e, i, el));
    el.addEventListener("click", e => { if (!w.live || e.detail === 0) pick(el); });
  });

  /* --- 尺寸变化 / 动效偏好 --- */
  w.syncReduce = () => {
    w.reduce = mq.matches;
    if (w.reduce) stop();
  };
  mq.addEventListener?.("change", w.syncReduce);

  if (typeof ResizeObserver === "function") {
    w.ro = new ResizeObserver(() => {
      const width = root.clientWidth;
      if (Math.abs(width - w.width) < 2) return;   // 只关心宽度，避免被自身高度变化触发
      w.width = width;
      const wasLive = w.live;
      stop();
      layout();
      if (wasLive && w.open) start();
    });
    w.ro.observe(root);
  }

  w.width = root.clientWidth;
  layout();
  document.fonts?.ready.then(() => { if (docFolder === w) layout(); });
}

/* ---------- LatticeLoader 格点装载器：等待回答时的思考指示 ----------
   原版为 React Bits LatticeLoader（React + 同名 CSS），同样移植为纯 JS + CSS：
   - 逐格 animation-delay 由内联样式写入，动画与关键帧沿用原版 CSS；
   - 秒表由 JS 每 100ms 走一次，状态切到 done / error 后冻结；
   - 无障碍实现与原版一致：role=status + 视觉隐藏的播报文本。
   文案固定为英文（Thinking / Done in / Failed after）。 */
const LL_PATTERNS = {
  arrow: { 3: { cells: [1, 2, 3, 0, 1, 2, 1, 2, 3], loop: 7.2, scale: 1 } },
  dots: { 3: { cells: [0, 1, 2, 0, 1, 2, 0, 1, 2], loop: 3, scale: 2.4 } },
  ripple: { 3: { cells: [2, 1, 2, 1, 0, 1, 2, 1, 2], loop: 4.8, scale: 1.5 } },
  spiral: { 3: { cells: [0, 1, 2, 7, 8, 3, 6, 5, 4], loop: 9, scale: 1.2, lit: 0.35 } },
  orbit: {
    3: { cells: [0, 1, 2, 7, null, 3, 6, 5, 4], loop: 8, scale: 1.2 },
    4: { cells: [0, 1, 2, 3, 11, null, null, 4, 10, null, null, 5, 9, 8, 7, 6], loop: 6, scale: 1.2, lit: 0.45 }
  },
  snake: {
    3: { cells: [0, 1, 2, 5, 4, 3, 6, 7, 8], loop: 9, scale: 1, lit: 0.35 },
    4: { cells: [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12], loop: 16, scale: 1, lit: 0.25 }
  },
  sweep: { 4: { cells: [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6], loop: 5, scale: 1, lit: 0.45 } },
  spin: { 4: { cells: [0, 0, 1, 1, 0, 0, 1, 1, 3, 3, 2, 2, 3, 3, 2, 2], loop: 4, scale: 1.6, lit: 0.35 } },
  rain: { 4: { cells: [0, 2, 1, 3, 1, 3, 2, 4, 2, 4, 3, 5, 3, 5, 4, 6], loop: 4, scale: 1.2, lit: 0.35 } },
  pulse: { 4: { cells: [2, 1, 1, 2, 1, 0, 0, 1, 1, 0, 0, 1, 2, 1, 1, 2], loop: 2.4, scale: 2.5, lit: 0.45 } }
};
const LL_DEFAULT_PATTERN = { 3: "orbit", 4: "sweep" };
const LL_MARKS = {
  3: { done: [2, 3, 5, 7], error: [0, 2, 4, 6, 8] },
  4: { done: [7, 8, 10, 13], error: [0, 3, 5, 6, 9, 10, 12, 15] }
};

/** 命名图案或自定义 { cells, loop, scale, lit }，越界/缺省与原版一致。 */
function llResolvePattern(pattern, grid) {
  if (typeof pattern === "string") {
    const named = LL_PATTERNS[pattern];
    return (named && named[grid]) || LL_PATTERNS[LL_DEFAULT_PATTERN[grid]][grid];
  }
  const cells = Array.from({ length: grid * grid }, (_, i) => pattern?.cells?.[i] ?? null);
  const max = Math.max(0, ...cells.filter(v => v != null));
  return { cells, loop: pattern?.loop ?? max + 4.2, scale: pattern?.scale ?? 1, lit: pattern?.lit ?? 0.62 };
}

const llFmt = ds => (ds < 600 ? `${(ds / 10).toFixed(1)}s` : `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`);
const llSpoken = ds => (ds < 600
  ? `${(ds / 10).toFixed(1)} seconds`
  : `${Math.floor(ds / 600)} minutes ${((ds % 600) / 10).toFixed(1)} seconds`);

function latticeLoaderHTML(opts = {}) {
  const {
    label = "Thinking", doneLabel = "Done in", errorLabel = "Failed after",
    status = "working", pattern = "orbit", grid = 3, shape = "round",
    cellSize = 7, gap = 2, fontSize = 13, step = 90, idleOpacity = 0.15,
    glow = false, color = "var(--text-2)", glowColor = "var(--primary)",
    showTimer = true, className = ""
  } = opts;

  const n = grid === 4 ? 4 : 3;
  const pat = llResolvePattern(pattern, n);
  const d = step * pat.scale;
  const cycle = Math.round(pat.loop * d);
  const mark = status === "working" ? "done" : status;
  const style = [
    `--ll-n:${n}`,
    `--ll-cell:${cellSize}px`,
    `--ll-gap:${gap}px`,
    `--ll-font:${fontSize}px`,
    `--ll-color:${color}`,
    `--ll-mark:${status === "error" ? "var(--danger)" : "var(--success)"}`,
    `--ll-idle:${idleOpacity}`,
    `--ll-glow:${glowColor}`,
    `--ll-mark-glow:${status === "error" ? "var(--danger)" : "var(--success)"}`,
    `--ll-cycle:${cycle}ms`
  ].join(";");

  const litAttr = pat.lit && pat.lit !== 0.62 ? ` data-lit="${Math.round(pat.lit * 100)}"` : "";
  return `
    <span class="lattice-loader${className ? " " + className : ""}" role="status"
          data-status="${status}" data-shape="${shape}" data-grid="${n}"${glow ? " data-glow" : ""}
          style="${style}">
      <span class="lattice-loader__grid" aria-hidden="true">
        <span class="lattice-loader__layer lattice-loader__run">
          ${pat.cells.map(unit => unit == null
            ? `<span class="lattice-loader__cell" data-hole=""${litAttr}></span>`
            : `<span class="lattice-loader__cell" style="animation-delay:${Math.round(unit * d)}ms"${litAttr}></span>`).join("")}
        </span>
        <span class="lattice-loader__layer lattice-loader__mark">
          ${pat.cells.map((_, i) => `<span class="lattice-loader__cell"${LL_MARKS[n][mark].includes(i) ? ' data-on=""' : ""}></span>`).join("")}
        </span>
      </span>
      <span class="lattice-loader__label" aria-hidden="true">
        <span class="lattice-loader__text"${status === "working" ? " data-active" : ""}>${escapeHtml(label)}</span>
        <span class="lattice-loader__text"${status === "done" ? " data-active" : ""}>${escapeHtml(doneLabel)}</span>
        <span class="lattice-loader__text"${status === "error" ? " data-active" : ""}>${escapeHtml(errorLabel)}</span>
      </span>
      ${showTimer ? `<span class="lattice-loader__timer" aria-hidden="true">0.0s</span>` : ""}
      <span class="lattice-loader__sr">${escapeHtml(`${label}, in progress`)}</span>
    </span>`;
}

const latticeLoaders = new Set();

/** 挂到已有节点上，返回 { setStatus, destroy, elapsed }；秒表随状态冻结。 */
function mountLatticeLoader(root, opts = {}) {
  const el = typeof root === "string" ? $(root) : root;
  if (!el) return null;
  const {
    label = "Thinking", doneLabel = "Done in", errorLabel = "Failed after", showTimer = true
  } = opts;

  const timerEl = $(".lattice-loader__timer", el);
  const srEl = $(".lattice-loader__sr", el);
  const texts = $$(".lattice-loader__text", el);
  const grid = Number(el.dataset.grid) || 3;
  const st = { status: el.dataset.status || "working", ds: 0, id: 0, startedAt: 0, destroyed: false };

  const paint = ds => {
    st.ds = ds;
    if (timerEl) timerEl.textContent = llFmt(ds);
  };

  const announce = () => {
    if (!srEl) return;
    srEl.textContent = st.status === "working"
      ? `${label}, in progress`
      : `${st.status === "done" ? doneLabel : errorLabel}${showTimer ? " " + llSpoken(st.ds) : ""}`;
  };

  const startClock = () => {
    if (st.id) clearInterval(st.id);
    st.startedAt = performance.now();
    paint(0);
    announce();
    st.id = setInterval(() => paint(Math.floor((performance.now() - st.startedAt) / 100)), 100);
  };

  const handle = {
    el,
    get status() { return st.status; },
    get elapsed() { return st.ds / 10; },
    setStatus(next) {
      if (st.destroyed || st.status === next) return;
      st.status = next;
      el.dataset.status = next;
      if (next !== "working" && st.id) { clearInterval(st.id); st.id = 0; }   // 秒表冻结
      const wanted = LL_MARKS[grid][next === "error" ? "error" : "done"];
      $$(".lattice-loader__mark .lattice-loader__cell", el).forEach((cell, i) => {
        if (wanted.includes(i)) cell.setAttribute("data-on", "");
        else cell.removeAttribute("data-on");
      });
      texts.forEach((t, i) => {
        const owner = i === 0 ? "working" : i === 1 ? "done" : "error";
        if (owner === next) t.setAttribute("data-active", "");
        else t.removeAttribute("data-active");
      });
      announce();
    },
    destroy() {
      if (st.destroyed) return;
      st.destroyed = true;
      if (st.id) clearInterval(st.id);
      st.id = 0;
      latticeLoaders.delete(handle);
    }
  };

  startClock();
  latticeLoaders.add(handle);
  return handle;
}

function destroyLatticeLoaders() {
  [...latticeLoaders].forEach(h => h.destroy());
}

/** 收尾：定格在 done / error 让用户看到耗时，再交回调用方替换成答案。 */
const LL_HOLD = { done: 450, error: 400 };
async function settleLatticeLoader(handle, status) {
  if (!handle) return;
  handle.setStatus(status);
  await new Promise(r => setTimeout(r, LL_HOLD[status] || 0));
  handle.destroy();
}

/* ============================================================
   BlurText · 逐字模糊入场（登录页标题）
   移植自 React Bits BlurText（原版为 React + framer-motion）。
   本项目零依赖、无构建，所以原版由 motion 在 JS 里做的补间改由 CSS @keyframes
   承担，原版参数逐项保留：
     - animateBy：'words' 按空格切词、'letters' 逐字切；原版对空格也发一个
       <span>（渲染成 \u00A0）并占用一个动画序号 —— 中文标题没空格，走 letters；
     - direction：'top' 从上方落下、'bottom' 从下方浮起；
     - delay / stepDuration：第 n 段延迟 = n × delay，单段时长 = stepDuration ×
       (stepCount - 1)（stepCount = 关键帧数 + 1，见原版 totalDuration 的算法）；
     - threshold / rootMargin：IntersectionObserver 触发，进场后 unobserve；
     - easing：原版默认 easing = t => t（线性），这里默认 cubic-bezier 缓出，
       线性在中文逐字入场时显得发涩（差异见下面 EASING 注释）。
   与 React 版的差异（都是无构建 + 中文标题带来的）：
     - 原版一个实例一行文本，这里两行共用一个 .blur-text 容器（各占一个
       .blur-text__line），逐字延迟跨行连续累加，读起来是一句话而不是两段；
     - 逐字 span 在 .blur-text__line 的 flex 容器里换行，避免中文长句溢出侧栏；
     - 逐字时字距按每个字单独算，与原来 DepthText 的 -0.065em 紧凑字距对齐；
     - prefers-reduced-motion：不加动画，直接落在终态。
   ============================================================ */
const BLUR_TEXT = {
  animateBy: "letters",           // 'words' | 'letters'（原版默认 words，中文自动走 letters）
  direction: "top",               // 'top' | 'bottom'
  delay: 90,                      // 每字入场间隔(ms)
  stepDuration: 0.35,             // 单段补间时长(s)，原版默认值
  threshold: 0.1,                 // 原版默认值
  rootMargin: "0px",              // 原版默认值
  blurFrom: 10,                   // 起始模糊半径(px)，原版默认值
  shift: 14,                      // 起始垂直位移(px)。原版 50px 是拉丁字母的尺度，
                                  // 中文行盒窄，14px 才不会和上一行打架
  className: ""
};
/* 原版 easing = t => t 是恒等（线性）。线性起步太硬，这里换成缓出曲线：
   CSS 的 cubic-bezier 与 CSS 变量一起写在 .blur-text 段（styles.css）。 */

/* prefers-reduced-motion：BlurText 与其他动效组件共用（原来在 DepthText 段里定义）。 */
const motionReduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

/** 按 animateBy 切分：保持与原版一致的空格语义（空格也占一个动画序号）。 */
function blurTextSegments(line, animateBy) {
  if (animateBy === "words" && /\s/.test(line)) {
    return line.split(/\s+/).filter(Boolean).map(word => ({ text: word, space: true }));
  }
  // 中文没有词边界，逐字切；Array.from 保证 emoji/代理对不被拆坏
  return Array.from(line).map(char => ({ text: char, space: false }));
}

/* 组件结构：两行文本 → 一个 .blur-text（每行一个 .blur-text__line，逐字一个 span）。
   动效本身（关键帧、时长、缓动）全在 styles.css，这里只写 --bt-delay 序号延迟。 */
function blurTextHTML(lines, opts = {}) {
  const o = { ...BLUR_TEXT, ...opts };
  const direction = o.direction === "bottom" ? "bottom" : "top";
  const stepCount = 3;            // 原版：from + 两段关键帧 → times = [0, 0.5, 1]
  const durationMs = Math.round(Math.max(0, Number(o.stepDuration) || 0) * (stepCount - 1) * 1000);
  const staggerMs = Math.max(0, Number(o.delay) || 0);
  const chars = [];               // 平铺所有字，跨行连续编号
  const lineHTML = lines.map(line => {
    const body = blurTextSegments(line, o.animateBy).map(seg => {
      const index = chars.length;
      chars.push(seg);
      const gap = seg.space ? " " : "";
      return `<span class="blur-text__char" style="--bt-delay:${index * staggerMs}ms" aria-hidden="true">${escapeHtml(seg.text)}${gap}</span>`;
    }).join("");
    // 每行是 block，行距交给 CSS（--dt-line-gap），所以这里不写行内 margin
    return `<span class="blur-text__line">${body}</span>`;
  }).join("");
  const cls = ["blur-text", direction === "bottom" ? "blur-text--bottom" : "", o.className].filter(Boolean).join(" ");
  const style = `--bt-duration:${durationMs}ms;--bt-blur-from:${Math.max(0, Number(o.blurFrom) || 0)}px;--bt-shift:${Math.max(0, Number(o.shift) || 0)}px`;
  // 逐字 span 都是 aria-hidden，可读文本由 <h1> 的 aria-label 提供（见 mountAuthTitle）
  return `<span class="${cls}" style="${style}" data-blur-text>${lineHTML}</span>`;
}

/* 挂载：IntersectionObserver 进场后加 .is-in 触发 CSS 动画。
   返回 { root, chars, kill }；reduced=true 时直接标成已进场（不加动画）。 */
function mountBlurText(root, opts = {}) {
  const o = { ...BLUR_TEXT, ...opts };
  const el = $(".blur-text", root);
  if (!el) return null;
  const chars = $$(".blur-text__char", el);
  let observer = null;
  let fallbackTimer = 0;

  const reveal = () => {
    if (observer) { observer.disconnect(); observer = null; }
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = 0; }
    el.classList.add("is-in");
    if (typeof o.onAnimationComplete === "function") {
      // 等最后一个字的延迟 + 单段时长走完（原版是等最后一个 motion.span 的 onAnimationComplete）
      const duration = parseFloat(el.style.getPropertyValue("--bt-duration")) || 700;
      const last = Math.max(0, chars.length - 1) * (Number(o.delay) || 0);
      setTimeout(o.onAnimationComplete, duration + last + 30);
    }
  };

  const kill = () => {
    if (observer) { observer.disconnect(); observer = null; }
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = 0; }
    el.classList.remove("is-in");
  };

  if (motionReduced()) {
    el.classList.add("is-in");    // CSS 的 reduced-motion 分支会把动画降级成终态
  } else if (typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) reveal();
    }, { threshold: o.threshold, rootMargin: o.rootMargin });
    observer.observe(el);
    // 兜底：登录页是首屏，若 IO 因容器/尺寸异常没回调，1.2s 后也要出字
    fallbackTimer = setTimeout(reveal, 1200);
  } else {
    reveal();
  }

  return { root: el, chars, reveal, kill };
}

/* ---------- 登录页标题：把 <h1> 里两行文本换成逐字模糊入场 ---------- */
let authTitleHandle = null;

/* 标题的两行文本：首次从 index.html 的兜底 <span> 读；
   重挂时兜底文本已经被替换，改从 data-title-lines 取回原文。 */
function authTitleLines(title) {
  const saved = title.dataset.titleLines;
  if (saved) {
    try {
      const lines = JSON.parse(saved);
      if (Array.isArray(lines) && lines.length) return lines;
    } catch (e) { /* 数据坏了就退回读 DOM */ }
  }
  return $$(".auth-title-line", title).map(el => el.textContent.trim()).filter(Boolean);
}

function mountAuthTitle() {
  const title = $("#authTitle");
  if (!title) return null;
  const lines = authTitleLines(title);
  if (!lines.length) return null;
  // 入场节奏也走 CSS 变量：改逐字间隔/模糊半径/位移都不用动 JS
  const cs = getComputedStyle(title);
  const num = name => parseFloat(cs.getPropertyValue(name)) || 0;
  const opts = {
    delay: num("--bt-stagger") || BLUR_TEXT.delay,
    blurFrom: num("--bt-blur-from") || BLUR_TEXT.blurFrom,
    shift: num("--bt-shift") || BLUR_TEXT.shift
  };
  authTitleHandle?.kill();
  title.dataset.titleLines = JSON.stringify(lines);
  title.setAttribute("aria-label", lines.join(""));
  title.innerHTML = blurTextHTML(lines, opts);
  authTitleHandle = mountBlurText(title, opts);
  return authTitleHandle;
}

/* 首屏挂载：登录页是首屏，不等 /api/auth/me 的结果。 */
function initAuthTitle() {
  mountAuthTitle();
}

/* ---------- 路由配置 ----------
   学生端路由只调用 /api/student/** 与公共接口；管理端路由只调用 /api/admin/**。
   角色不符的菜单项在 initNav 中隐藏，后端 Spring Security 是最终边界。 */
const ROUTES = {
  dashboard: { title: "概览仪表盘", render: renderDashboard },
  qa: { title: "智能问答", render: renderQA },
  search: { title: "政策检索", render: renderSearch },
  affairs: { title: "办事引导", render: renderAffairs },
  "my-applications": { title: "我的申请", render: renderMyApplications, role: "student" },
  "policy-mgr": { title: "政策管理", render: renderPolicyMgr, role: "admin" },
  "services-mgr": { title: "事项管理", render: renderServiceManager, role: "admin" },
  review: { title: "申请审核", render: renderApplicationReview, role: "admin" },
  audit: { title: "审计追溯", render: renderAudit, role: "admin" },
  "ai-quality": { title: "AI 问答质量分析", render: renderAIQuality, role: "admin" },
  settings: { title: "系统设置", render: renderSettings, role: "admin" }
};

let currentRoute = "dashboard";
let currentUser = null;
let dashboardStats = { total: 0, success: 0, failed: 0, processing: 0, chunks: 0 };

/* ---------- 启动 ----------
   首屏一律以后端会话为准：调用 GET /api/auth/me，
   200 → 进入应用（若后端标记必须改密，则先进改密页）；401 → 停留在登录页。
   sessionStorage 里的 ca-user 只用于避免界面闪烁，不作为登录凭证。 */
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initAuthTitle();          // BlurText：登录页标题逐字模糊入场（首屏立即挂，不等鉴权结果）
  bindAuthForms();
  // 公开分享页优先：不需要登录，也不调用 /api/auth/me
  if (isShareHash()) { renderPublicShare(shareTokenFromHash()); return; }
  try {
    const me = await apiGet("/api/auth/me");
    currentUser = mapUser(me);
    tabStorage.setItem("ca-user", JSON.stringify(currentUser));
    if (currentUser.mustChangePassword) showChangePassword();
    else enterApp();
  } catch (e) {
    tabStorage.removeItem("ca-user");
    currentUser = null;
    showLogin(e.code === "NETWORK" ? e.message : "");
  }
});

/* ---------- 用户映射：后端 → 前端 ----------
   后端 UserView：id / username / displayName / role / studentNo / mustChangePassword，
   角色只有 ADMIN / STUDENT 两种，这里不做任何超出后端的角色推断。 */
function mapUser(u) {
  if (!u) return null;
  const role = u.role === "ADMIN" ? "admin" : "student";
  return {
    id: u.id,
    username: u.username,
    name: u.displayName || u.username,
    role,
    avatar: role === "admin" ? "管" : "学",
    dept: role === "admin" ? "信息化建设与管理处" : "学生",
    studentNo: u.studentNo,
    mustChangePassword: !!u.mustChangePassword
  };
}

/* ---------- 认证 ---------- */
const ROLE_LABEL = { ADMIN: "系统管理员", STUDENT: "学生" };

function showLogin(notice = "") {
  document.body.dataset.auth = "out";
  const err = $("#loginErr");
  if (err) {
    if (notice) {
      err.textContent = notice;
      err.classList.add("is-info");
      err.hidden = false;
    } else if (err.classList.contains("is-info")) {
      err.hidden = true;
      err.textContent = "";
      err.classList.remove("is-info");
    }
  }
  setLoginBusy(false);
  setTimeout(() => { const u = $("#loginUser"); if (u) u.focus(); }, 80);
}

function setLoginBusy(busy) {
  const btn = $("#loginBtn");
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle("is-busy", busy);
}

function showLoginError(message) {
  const err = $("#loginErr");
  if (!err) return;
  err.hidden = false;
  err.classList.remove("is-info");
  err.textContent = message;
}

/** 表单事件只绑定一次（登录页/改密页现在是 index.html 中的静态结构）。 */
let authBound = false;
function bindAuthForms() {
  if (authBound) return;
  authBound = true;

  // 密码可见性切换：所有带 data-toggle-for 的按钮共用一套逻辑
  document.querySelectorAll(".ai-toggle[data-toggle-for]").forEach((btn) => {
    const input = document.getElementById(btn.dataset.toggleFor);
    if (!input) return;
    btn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "隐藏" : "显示";
      btn.setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
      input.focus();
    });
  });

  // 大写锁定提示（大小写敏感会导致"密码明明对却登录失败"）
  const watchCaps = (input, tip) => {
    if (!input || !tip) return;
    const update = (e) => { if (typeof e.getModifierState === "function") tip.hidden = !e.getModifierState("CapsLock"); };
    input.addEventListener("keyup", update);
    input.addEventListener("keydown", update);
    input.addEventListener("blur", () => { tip.hidden = true; });
  };
  watchCaps($("#loginPass"), $("#loginCaps"));
  watchCaps($("#pwdOld"), $("#pwdCaps"));
  watchCaps($("#pwdNew"), $("#pwdCaps"));
  watchCaps($("#pwdConfirm"), $("#pwdCaps"));

  $("#loginForm").addEventListener("submit", (e) => { e.preventDefault(); doLogin(); });
  $("#changePwdForm").addEventListener("submit", (e) => { e.preventDefault(); submitChangePassword(); });
  const logoutLink = $("#pwdLogoutBtn");
  logoutLink.addEventListener("click", logout);
  logoutLink.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); logout(); } });

  // 用户重新输入时清掉上一次的错误提示
  const clearOnInput = (input, errSel) => {
    const el = $(input), err = $(errSel);
    if (!el || !err) return;
    el.addEventListener("input", () => {
      if (!err.classList.contains("is-info")) { err.hidden = true; err.textContent = ""; }
    });
  };
  clearOnInput("#loginUser", "#loginErr");
  clearOnInput("#loginPass", "#loginErr");
  ["#pwdOld", "#pwdNew", "#pwdConfirm"].forEach((sel) => clearOnInput(sel, "#pwdErr"));
}

/** 后端 AuthService 的入参约束：账号非空且 ≤80 字符，密码非空且 UTF-8 ≤72 字节。 */
function validateCredentials(username, password) {
  if (!username || !password) return "请输入账号和密码";
  if (username.length > 80) return "账号长度不能超过 80 个字符";
  if (new TextEncoder().encode(password).length > 72) return "密码过长（最多 72 字节）";
  return "";
}

async function doLogin() {
  const username = $("#loginUser").value.trim();
  const password = $("#loginPass").value;
  const invalid = validateCredentials(username, password);
  if (invalid) { showLoginError(invalid); return; }

  const err = $("#loginErr");
  err.hidden = true;
  err.textContent = "";
  setLoginBusy(true);
  try {
    const result = await apiPost("/api/auth/login", { username, password });
    // 后端登录响应：{ success, user: UserView, needChangePassword }
    // 会话凭证只存在于 HttpOnly Cookie，响应体里没有 token。
    if (!result?.success || !result.user) throw new Error("后端返回的登录结果不完整");
    currentUser = mapUser(result.user);
    if (result.needChangePassword !== undefined) currentUser.mustChangePassword = !!result.needChangePassword;
    tabStorage.setItem("ca-user", JSON.stringify(currentUser));
    // 后端在登录成功时会清空 XSRF-TOKEN Cookie，本地缓存必须同步失效
    clearCsrf();
    $("#loginPass").value = "";
    if (currentUser.mustChangePassword) {
      // 后端要求先改初始密码，此时任何业务接口都会返回 403 MUST_CHANGE_PASSWORD
      showChangePassword();
    } else {
      toast(`欢迎回来，${currentUser.name}`, "success");
      enterApp();
    }
  } catch (e) {
    setLoginBusy(false);
    if (e.code === "BAD_CREDENTIALS") {
      // 后端对"账号不存在 / 密码错误 / SQL 注入串"统一返回同一句话，前端不做区分提示
      showLoginError(e.message || "账号或密码错误");
      $("#loginPass").value = "";
      $("#loginPass").focus();
    } else {
      showLoginError(e.message || "登录失败，请稍后重试");
    }
  }
}

/* ---------- 强制改密 ----------
   契约来自后端 AuthService.changePassword 与 AuthController#changePassword：
     POST /api/auth/change-password { oldPassword, newPassword } → { success: true }
     失败码：INVALID_PASSWORD / OLD_PASSWORD_WRONG / PASSWORD_SAME / PASSWORD_WEAK（均为 400）
     成功后后端会撤销当前会话，因此必须回到登录页用新密码重新登录。 */
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*?&._-]{8,20}$/;

function setChangePwdBusy(busy) {
  const btn = $("#pwdSubmitBtn");
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle("is-busy", busy);
}

function showChangePassword() {
  document.body.dataset.auth = "must-change";
  const who = $("#pwdWho");
  if (who) who.textContent = currentUser?.name || currentUser?.username || "同学";
  const err = $("#pwdErr");
  if (err) { err.hidden = true; err.textContent = ""; }
  setChangePwdBusy(false);
  setTimeout(() => { const el = $("#pwdOld"); if (el) el.focus(); }, 80);
}

function showChangePwdError(message) {
  const err = $("#pwdErr");
  if (!err) return;
  err.hidden = false;
  err.textContent = message;
}

async function submitChangePassword() {
  const oldPassword = $("#pwdOld").value;
  const newPassword = $("#pwdNew").value;
  const confirmPassword = $("#pwdConfirm").value;

  // 前端先做一次与后端同规则的预校验，避免无谓请求；最终以后端返回为准
  if (!oldPassword || !newPassword || !confirmPassword) return showChangePwdError("请填写所有字段");
  if (newPassword !== confirmPassword) return showChangePwdError("两次输入的新密码不一致");
  if (newPassword === oldPassword) return showChangePwdError("新密码不能与原密码相同");
  if (new TextEncoder().encode(newPassword).length > 72) return showChangePwdError("密码过长");
  if (!PASSWORD_RULE.test(newPassword)) return showChangePwdError("新密码需 8~20 位，且同时包含字母和数字");

  const err = $("#pwdErr");
  err.hidden = true;
  err.textContent = "";
  setChangePwdBusy(true);
  try {
    await apiPost("/api/auth/change-password", { oldPassword, newPassword });
    // 后端已撤销当前会话（credential_stamp 失效），本地状态一并清掉
    clearCsrf();
    tabStorage.removeItem("ca-user");
    const username = currentUser?.username || "";
    currentUser = null;
    ["#pwdOld", "#pwdNew", "#pwdConfirm"].forEach((sel) => { $(sel).value = ""; });
    if (username) $("#loginUser").value = username;
    showLogin("密码修改成功，请使用新密码重新登录。");
    toast("密码修改成功，请重新登录", "success");
  } catch (e) {
    setChangePwdBusy(false);
    if (e.code === "AUTH_REQUIRED") {
      tabStorage.removeItem("ca-user");
      currentUser = null;
      showLogin("会话已失效，请重新登录。");
      return;
    }
    // 直接展示后端原文，避免前后端两套提示
    showChangePwdError(e.message || "修改失败，请稍后重试");
  }
}

function enterApp() {
  document.body.dataset.auth = "in";
  const err = $("#loginErr");
  if (err) { err.hidden = true; err.textContent = ""; err.classList.remove("is-info"); }
  $("#loginPass") && ($("#loginPass").value = "");
  if (currentUser) {
    const av = $(".avatar");
    const un = $(".user-name");
    const ur = $(".user-role");
    if (av) av.textContent = currentUser.avatar;
    if (un) un.textContent = currentUser.name;
    if (ur) ur.textContent = `${roleLabel(currentUser.role)} · ${currentUser.dept}`;
  }
  initNav();
  initTopbar();
  initLogout();
  initDrawer();             // StaggeredMenu 式移动端抽屉（桌面端不受影响）
  window.CampusGuide.setUser(currentUser.id, isAdmin());
  resetWorkbenchOwner(currentUser.id);
  if (isAdmin()) loadWorkbench();
  const { route, params } = parseHashRoute();
  navigate(ROUTES[route] ? route : homeRoute(), { preserveHash: true });
  if (currentRoute === "qa") {
    const id = Number(params.get("conversation")) || rememberedConversation();
    if (id) openConversation(id);
  }          // #/qa?conversation=<id> 直接回到该会话
}

async function logout() {
  try {
    await apiPost("/api/auth/logout", {});
  } catch (e) { /* 登出失败也要清掉本地状态（后端会话可能已失效） */ }
  clearCsrf();
  tabStorage.removeItem("ca-user");
  currentUser = null;
  chatConversationId = null;
  chatRequestGeneration++;
  chatBusy = false;
  chatGeneration++;
  clearTimeout(chatPollTimer);
  window.CampusGuide.setUser(null);
  resetWorkbenchOwner(null);
  history.replaceState(null, "", location.pathname);
  $("#convList").innerHTML = "";
  showLogin();
}
window.logout = logout;


function initLogout() {
  const foot = $(".sidebar-foot");
  if (foot && !$("#logoutBtn")) {
    const btn = document.createElement("button");
    btn.id = "logoutBtn";
    btn.className = "btn btn-ghost";
    btn.style.cssText = "width:100%;margin-top:10px;justify-content:center;font-size:12.5px;padding:8px";
    btn.innerHTML = "⏻ 退出登录";
    btn.className += " drawer-foot-item";   // 抽屉抽出时随用户卡一起上推淡入
    btn.addEventListener("click", logout);
    foot.appendChild(btn);
  }
}

/* ---------- 权限 ---------- */
function can(perm) {
  if (!currentUser) return false;
  const p = M.permissions[currentUser.role];
  return p ? !!p[perm] : false;
}
function roleLabel(r) {
  return { admin: "系统管理员", student: "学生", knowledge: "知识管理员", auditor: "审计人员" }[r] || r;
}

/* ---------- 导航初始化 ---------- */
function initNav() {
  // 菜单按后端角色过滤：后端只有 ADMIN / STUDENT 两种角色
  const role = currentUser?.role === "admin" ? "admin" : "student";
  $$(".nav-group[data-nav-role]").forEach(group => {
    group.style.display = group.dataset.navRole === role ? "" : "none";
  });
  // 工作台/问答等公共入口之前的角色分组标签也一并隐藏（避免空分组）
  $$(".nav-group:not(.chat-history-group)").forEach(group => {
    const items = $$(".nav-item", group).filter(el => el.closest(".nav-group").style.display !== "none");
    if (!items.length) group.style.display = "none";
  });
  $$(".nav-item").forEach(el => {
    el.onclick = e => {
      e.preventDefault();
      navigate(el.dataset.route);
      if (window.innerWidth <= 768) closeDrawer();
    };
  });
}

let topbarBound = false;
function initTopbar() {
  if (topbarBound) return;
  topbarBound = true;
  $("#sidebarToggle").addEventListener("click", () => {
    if (window.innerWidth <= 768) toggleDrawer();
    else {
      const collapsed = $("#sidebar").classList.toggle("collapsed");
      $("#sidebarToggle").setAttribute("aria-expanded", collapsed ? "false" : "true");
      $("#sidebarToggle").setAttribute("title", collapsed ? "展开侧边栏" : "折叠侧边栏");
      $("#sidebarToggle").setAttribute("aria-label", collapsed ? "展开侧边栏" : "折叠侧边栏");
    }
  });
  $("#themeToggle").addEventListener("click", toggleTheme);
  $("#globalSearch").addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.value.trim()) {
      navigate("search");
      setTimeout(() => { $("#searchInput").value = e.target.value; doSearch(); }, 50);
    }
  });
  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      (currentRoute === "qa" ? $("#qaInput") : $("#globalSearch"))?.focus();
    }
  });
}

/* ---------- 路由核心 ---------- */
function homeRoute() { return isAdmin() ? "dashboard" : "qa"; }
function navigate(route, { preserveHash = false } = {}) {
  // 路由守卫：处于强制改密状态的用户只能停留在改密页，
  // 否则每个业务接口都会返回 403 MUST_CHANGE_PASSWORD，页面只会一片报错。
  if (currentUser && currentUser.mustChangePassword) {
    showChangePassword();
    return;
  }
  if (!ROUTES[route]) route = homeRoute();
  // 前端路由守卫：与后端 Spring Security 的角色边界保持一致（只是体验优化，不是安全措施）
  const needRole = ROUTES[route].role;
  if (needRole && currentUser?.role !== needRole) {
    toast(needRole === "admin" ? "该功能仅管理员可用" : "该功能仅学生账号可用", "warn");
    route = homeRoute();
  }
  chatGeneration++;
  clearTimeout(chatPollTimer);
  chatLoading = false;
  currentRoute = route;
  if (!preserveHash || !location.hash) {
    const method = document.body.dataset.route && document.body.dataset.route !== route ? 'pushState' : 'replaceState';
    history[method](null, "", "#/" + route);
  }
  document.body.dataset.route = route;
  $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.route === route));
  const crumb = $("#crumb");
  crumb.innerHTML = route === "qa" ? '<span>智能问答</span>' :
    `<span class="crumb-home" onclick="navigate(homeRoute())">首页</span><span class="crumb-sep">/</span><span>${ROUTES[route].title}</span>`;
  const vp = $("#viewport");
  destroyDocFolder();     // 离开仪表盘前停掉漂浮物理
  destroyLatticeLoaders(); // 离开问答页前停掉秒表
  vp.classList.toggle("qa-viewport", route === "qa");
  vp.innerHTML = "";
  vp.classList.remove("fade-in");
  void vp.offsetWidth;
  vp.classList.add("fade-in");
  ROUTES[route].render(vp);
  vp.scrollTop = 0;
}
window.navigate = navigate;

/* ---------- 主题 ---------- */
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute("data-theme") === "light" ? "dark" : "light";
  html.setAttribute("data-theme", next);
  try { localStorage.setItem("ca-theme", next); } catch { }
  toast(next === "light" ? "已切换为浅色模式" : "已切换为深色模式", "info");
}
function initTheme() {
  let t;
  try { t = localStorage.getItem("ca-theme"); } catch { }
  if (t) document.documentElement.setAttribute("data-theme", t);
}

/* ---------- Toast ---------- */
function toast(msg, type = "info") {
  const host = $("#toastHost");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icons = { success: "✓", info: "i", warn: "!", error: "✕" };
  el.innerHTML = `<span>${icons[type] || "i"}</span><span>${msg}</span>`;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateX(20px)"; setTimeout(() => el.remove(), 300); }, 2600);
}

/* ---------- 工具：状态标签 ----------
   文档状态来自 /api/admin/documents（SUCCESS/PROCESSING/FAILED），
   申请状态来自 ApplicationStatus 枚举（SUBMITTED/REVIEWING/NEED_MORE/APPROVED/REJECTED/COMPLETED）。 */
function statusTag(s) {
  const map = {
    active: ['tag-active', '现行'],
    draft: ['tag-draft', '草稿'],
    expired: ['tag-expired', '已失效'],
    SUCCESS: ['tag-active', '已索引'],
    PROCESSING: ['tag-draft', '处理中'],
    FAILED: ['tag-expired', '失败'],
    SUBMITTED: ['tag-info', '已提交'],
    REVIEWING: ['tag-draft', '审核中'],
    NEED_MORE: ['tag-draft', '待补材料'],
    APPROVED: ['tag-active', '已通过'],
    REJECTED: ['tag-expired', '已驳回'],
    COMPLETED: ['tag-violet', '已完成'],
    ACTIVE: ['tag-active', '启用'],
    DISABLED: ['tag-expired', '停用']
  };
  const [cls, txt] = map[s] || ['tag-info', s || '-'];
  return `<span class="tag ${cls}"><span class="tag-dot"></span>${txt}</span>`;
}

/* ---------- 工具：时间 ---------- */
function fmtTime(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function relTime(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return fmtTime(v).slice(0, 10);
}

/* ---------- 工具：面板状态占位 ---------- */
function panelState(ico, text, hint = "", isError = false) {
  return `<div class="panel-state ${isError ? "is-error" : ""}">
    <div class="ps-ico">${ico}</div>
    <div>${escapeHtml(text)}</div>
    ${hint ? `<div class="ps-hint">${hint}</div>` : ""}
  </div>`;
}

/* ============================================================
   工作台数据：全部取自后端真实接口，按角色分别请求
     GET /api/v1/health                      服务状态（公开）
     GET /api/services                       可办事项（STUDENT/ADMIN）
     GET /api/chat/conversations             我的问答记录（按登录用户隔离）
     GET /api/admin/overview|config          管理员：知识库统计与上传上限
     GET /api/admin/applications             管理员：全部申请
     GET /api/student/applications           学生：本人申请
   ============================================================ */
const workbench = {
  ownerId: null,
  loading: false,
  loadedAt: 0,
  health: null, healthError: "",
  services: null, servicesError: "",
  conversations: null, conversationsError: "",
  applications: null, applicationsError: "",
  overview: null, overviewError: "",
  reviewQueue: null, reviewQueueError: ""
};

const isAdmin = () => currentUser?.role === "admin";
function resetWorkbenchOwner(id) {
  if (workbench.ownerId === id) return;
  Object.keys(workbench).forEach(key => {
    workbench[key] = key.endsWith('Error') ? '' : key === 'loading' ? false : key === 'loadedAt' ? 0 : null;
  });
  workbench.ownerId = id;
}

async function loadWorkbench(force = false) {
  const owner = currentUser?.id;
  if (!owner) return false;
  resetWorkbenchOwner(owner);
  if (workbench.loading) return false;
  if (!force && workbench.loadedAt && Date.now() - workbench.loadedAt < 15_000) return false;
  workbench.loading = true;

  const tasks = [
    ["health", "/api/v1/health"],
    ["services", "/api/services"],
    ["conversations", "/api/chat/conversations"]
  ];
  if (isAdmin()) {
    tasks.push(["overview", "/api/admin/overview"]);
    tasks.push(["reviewQueue", "/api/admin/applications?page=1&pageSize=5"]);
    tasks.push(["config", "/api/admin/config"]);
  } else {
    tasks.push(["applications", "/api/student/applications?page=1&pageSize=5"]);
  }

  const settled = await Promise.allSettled(tasks.map(([, path]) => apiGet(path)));
  if (owner !== currentUser?.id || workbench.ownerId !== owner) return false;
  settled.forEach((r, i) => {
    const key = tasks[i][0];
    if (r.status === "fulfilled") {
      workbench[key] = r.value;
      workbench[key + "Error"] = "";
    } else {
      workbench[key + "Error"] = r.reason?.message || "加载失败";
    }
  });

  // 其它视图（政策管理上传提示）复用该配置；不再使用写死的 20MB
  if (workbench.config?.maxUploadSizeMb) dashboardStats.maxUploadMb = workbench.config.maxUploadSizeMb;
  if (workbench.overview) {
    const o = workbench.overview;
    dashboardStats = {
      ...dashboardStats,
      total: o.total || 0, success: o.success || 0, failed: o.failed || 0,
      processing: o.processing || 0, chunks: o.chunks || 0
    };
  }

  workbench.loading = false;
  workbench.loadedAt = Date.now();
  if (currentRoute === "dashboard") renderDashboard($("#viewport"));
  return true;
}

async function refreshWorkbench() {
  const btn = $("#wbRefresh");
  if (btn) { btn.classList.add("is-busy"); btn.textContent = "⟳ 刷新中…"; }
  const done = await loadWorkbench(true);
  if (btn) { btn.classList.remove("is-busy"); btn.textContent = "⟳ 刷新"; }
  if (done) toast("工作台已刷新", "success");
}
window.refreshWorkbench = refreshWorkbench;

/* ============================================================
   视图：工作台
   ============================================================ */
function renderDashboard(vp) {
  destroyDocFolder();     // 视图整体重绘：先停掉上一轮漂浮物理
  // 先渲染已有数据，后台静默刷新（超过 15s 或从未加载过）
  if (!workbench.loading && (!workbench.loadedAt || Date.now() - workbench.loadedAt > 15_000)) loadWorkbench();

  const admin = isAdmin();
  const firstLoad = workbench.loading && !workbench.loadedAt;
  const svc = workbench.services || [];
  const convs = workbench.conversations || [];
  const ov = workbench.overview || { total: 0, success: 0, failed: 0, processing: 0, chunks: 0, recent: [] };
  const apps = workbench.applications;
  const queue = workbench.reviewQueue;
  const requiredMaterials = svc.reduce((n, s) => n + (s.materials || []).filter(m => m.required).length, 0);
  const categories = new Set(svc.map(s => s.category).filter(Boolean));

  /* ---- 顶部状态条 ---- */
  const healthChip = workbench.healthError
    ? `<span class="wb-chip is-down"><span class="dot"></span>后端不可用 · ${escapeHtml(workbench.healthError)}</span>`
    : workbench.health
      ? `<span class="wb-chip"><span class="dot"></span>后端服务 <b>${escapeHtml(workbench.health.status || "-")}</b> · ${escapeHtml(workbench.health.service || "-")} ${escapeHtml(workbench.health.version || "")}</span>`
      : `<span class="wb-chip"><span class="dot"></span>正在检查后端服务…</span>`;

  const scopeChips = admin
    ? `<span class="wb-chip">知识库 <b>${ov.success}/${ov.total}</b> 份已索引</span>
       <span class="wb-chip">知识分块 <b>${ov.chunks}</b></span>
       ${ov.processing ? `<span class="wb-chip">处理中 <b>${ov.processing}</b></span>` : ""}
       ${ov.failed ? `<span class="wb-chip is-down"><span class="dot"></span>处理失败 <b>${ov.failed}</b></span>` : ""}
       <span class="wb-chip">待审申请 <b>${queue?.total ?? 0}</b> 条</span>`
    : `<span class="wb-chip">可办事项 <b>${svc.length}</b> 项</span>
       <span class="wb-chip">我的申请 <b>${apps?.total ?? 0}</b> 条</span>
       <span class="wb-chip">我的问答记录 <b>${convs.length}</b> 条</span>`;

  /* ---- 指标卡（全部真实值） ---- */
  const stats = admin
    ? [
        statCard("已索引文档", ov.success, "active", "#5fd4a8", "▦", `共 ${ov.total} 份上传`),
        statCard("处理中", ov.processing, "info", "#6fc3ff", "◷", ov.processing ? "解析进行中，勿重复提交" : "当前无处理任务"),
        statCard("处理失败", ov.failed, "down", "#f07680", "✕", ov.failed ? "可在政策管理重新解析" : "无失败任务"),
        statCard("知识分块", ov.chunks, "success", "#9b7cff", "✦", "向量索引分块数")
      ]
    : [
        statCard("可办事项", svc.length, "info", "#6fc3ff", "▤", svc.length ? `覆盖 ${categories.size} 个类别` : "事项库暂未配置"),
        statCard("我的申请", apps?.total ?? 0, "active", "#5fd4a8", "⎘", apps?.total ? "点击查看办理进度" : "还没有提交过申请"),
        statCard("我的问答记录", convs.length, "success", "#9b7cff", "✦", convs.length ? "可点击继续该对话" : "去智能问答提第一个问题"),
        statCard("必交材料项", requiredMaterials, "info", "#e8c98a", "▤", "全部事项必交材料合计")
      ];

  /* ---- 面板 A：管理员=文档处理状态 / 学生=我的申请 ---- */
  let panelA;
  if (admin) {
    const recent = ov.recent || [];
    panelA = {
      title: "文档处理状态",
      hint: "导入后自动解析与建索引",
      body: workbench.overviewError
        ? panelState("✕", workbench.overviewError, "请点击右上角刷新重试", true)
        : firstLoad
          ? panelState("◷", "正在加载文档状态…")
          : !recent.length
            ? panelState("▦", "尚未导入政策文档", `去 <span class="link-btn" onclick="navigate('policy-mgr')">政策管理</span> 上传 PDF/DOCX，系统会自动解析、切块并建立索引。`)
            : docFolderHTML(recent.slice(0, FF.MAX_ITEMS))
    };
  } else {
    const items = apps?.items || [];
    panelA = {
      title: "我的申请",
      hint: "办理进度以审核结果为准",
      body: workbench.applicationsError
        ? panelState("✕", workbench.applicationsError, "请点击右上角刷新重试", true)
        : firstLoad
          ? panelState("◷", "正在加载申请记录…")
          : !items.length
            ? panelState("⎘", "还没有申请记录", `可点 <span class="link-btn" onclick="openNewApplication()">提交新申请</span>，或到 <span class="link-btn" onclick="navigate('affairs')">办事引导</span> 查看事项条件、步骤与材料清单。`)
            : items.map(a => `
                <div class="list-item wb-row" onclick="showApplicationDetail(${a.id})">
                  <div class="li-ico">⎘</div>
                  <div class="li-body">
                    <div class="li-title">${escapeHtml(a.serviceName || "事项")}</div>
                    <div class="li-meta">${escapeHtml(a.applicationNo || "")} · ${relTime(a.submittedAt || a.updatedAt)}</div>
                  </div>
                  <div class="wb-meta-right">${statusTag(a.status)}</div>
                </div>`).join("")
    };
  }

  /* ---- 问答记录面板（两种角色都会用自己的会话列表，各出现一次） ---- */
  const convPanel = {
    title: "我的问答记录",
    hint: convs.length ? "点击可继续该对话" : "",
    body: workbench.conversationsError
      ? panelState("✕", workbench.conversationsError, "请点击右上角刷新重试", true)
      : firstLoad
        ? panelState("◷", "正在加载问答记录…")
        : !convs.length
          ? panelState("✦", "还没有问答记录", `去 <span class="link-btn" onclick="navigate('qa')">智能问答</span> 提问后，这里会保留历史会话，可随时接着问。`)
          : convs.slice(0, 5).map(c => `
              <div class="list-item wb-row wb-conv" onclick="openConversation(${c.id})">
                <div class="li-ico">✦</div>
                <div class="li-body">
                  <div class="li-title">${escapeHtml(c.title || "未命名对话")}</div>
                  <div class="li-meta">更新于 ${relTime(c.updatedAt || c.createdAt)}</div>
                </div>
                <div class="wb-meta-right">继续 ›</div>
              </div>`).join("")
  };

  /* ---- 面板 B：管理员=申请处理 / 学生=我的问答记录 ---- */
  let panelB;
  if (admin) {
    const rows = queue?.items || [];
    panelB = {
      title: "申请处理",
      hint: `共 ${queue?.total ?? 0} 条`,
      body: workbench.reviewQueueError
        ? panelState("✕", workbench.reviewQueueError, "请点击右上角刷新重试", true)
        : firstLoad
          ? panelState("◷", "正在加载申请…")
          : !rows.length
            ? panelState("⎘", "暂无申请记录", "学生提交办理申请后会出现在这里。")
            : rows.map(a => `
                <div class="list-item wb-row" onclick="showApplicationDetail(${a.id}, true)">
                  <div class="li-ico">⎘</div>
                  <div class="li-body">
                    <div class="li-title">${escapeHtml(a.serviceName || "事项")}</div>
                    <div class="li-meta">${escapeHtml(a.applicationNo || "")} · ${escapeHtml(a.applicantName || a.username || "")}</div>
                  </div>
                  <div class="wb-meta-right">${statusTag(a.status)}</div>
                </div>`).join("")
    };
  } else {
    panelB = convPanel;
  }

  /* ---- 第三行右侧：管理员补上自己的问答记录，学生放快捷入口 ---- */
  const panelC = convPanel; // 两种角色各用一次：学生用在第二行，管理员用在第三行

  /* ---- 可办事项（真实 /api/services） ---- */
  const svcPanel = workbench.servicesError
    ? panelState("✕", workbench.servicesError, "请点击右上角刷新重试", true)
    : firstLoad
      ? panelState("◷", "正在加载事项…")
      : !svc.length
        ? panelState("▤", "事项库暂无启用中的事项", `${admin ? `可在 <span class="link-btn" onclick="navigate('policy-mgr')">政策管理</span> 导入办事指南文档，或由管理员在事项管理中配置。` : "管理员配置事项后即可在这里查看办理条件与材料清单。"}`)
        : svc.slice(0, 5).map(s => {
            const mats = (s.materials || []).length;
            return `
              <div class="list-item wb-row" onclick="showAffair(${s.id})">
                <div class="li-ico">▤</div>
                <div class="li-body">
                  <div class="li-title">${escapeHtml(s.name || "事项")}</div>
                  <div class="li-meta">${escapeHtml(s.department || "责任部门未配置")} · ${mats} 项材料${s.deadline ? " · 截止 " + escapeHtml(s.deadline) : ""}</div>
                </div>
                <div class="wb-meta-right">详情 ›</div>
              </div>`;
          }).join("");

  /* ---- 快捷入口（按角色） ---- */
  const quick = admin
    ? [
        quickCard("政策管理", "导入文档 · 版本状态", "▦", "linear-gradient(135deg,#9b7cff,#6d8bff)", "policy-mgr"),
        quickCard("事项管理", "条件 · 步骤 · 材料", "▤", "linear-gradient(135deg,#e8c98a,#f0b35e)", "affairs"),
        quickCard("智能问答", "带引用的政策问答", "✦", "linear-gradient(135deg,#6fc3ff,#5fd4a8)", "qa"),
        quickCard("系统设置", "上传与索引配置", "◍", "linear-gradient(135deg,#6d8bff,#9b7cff)", "settings")
      ]
    : [
        quickCard("智能问答", "政策依据问答", "✦", "linear-gradient(135deg,#9b7cff,#6d8bff)", "qa"),
        quickCard("政策检索", "全文与语义检索", "⌕", "linear-gradient(135deg,#6fc3ff,#5fd4a8)", "search"),
        quickCard("办事引导", "步骤与材料清单", "▤", "linear-gradient(135deg,#e8c98a,#f0b35e)", "affairs"),
        quickCard("我的申请", "办理进度与结果", "⎘", "linear-gradient(135deg,#f07680,#9b7cff)", "", "openMyApplications()")
      ];

  vp.innerHTML = `
    <div class="hero">
      <h2>欢迎回来，${escapeHtml(currentUser.name)}</h2>
      <p>${admin
        ? "你正在维护政策知识库与办事事项：文档导入后由 AI 服务解析、切块并建立索引，问答与检索只使用已索引的现行内容。"
        : "你可以直接询问校园政策，或按结构化事项准备材料；每个回答都带政策原文引用，证据不足时系统会明确说明。"}</p>
      <div class="hero-actions">
        <button class="btn btn-primary" onclick="navigate('${admin ? "policy-mgr" : "qa"}')">${admin ? "▦ 政策文档管理" : "✦ 开始智能问答"}</button>
        <button class="btn" onclick="navigate('affairs')">▤ 办事引导</button>
        <button class="btn btn-ghost" id="wbRefresh" onclick="refreshWorkbench()">⟳ 刷新</button>
      </div>
    </div>

    <div class="wb-status">
      ${healthChip}
      ${scopeChips}
    </div>

    <div class="grid grid-4" style="margin-bottom:24px">${stats.join("")}</div>

    <div class="grid grid-2">
      <div class="card">
        <div class="panel-head">
          <h3>${panelA.title}</h3>
          <span class="panel-hint">${panelA.hint}</span>
        </div>
        ${panelA.body}
      </div>
      <div class="card">
        <div class="panel-head">
          <h3>${panelB.title}</h3>
          <span class="panel-hint">${panelB.hint}</span>
        </div>
        ${panelB.body}
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:24px">
      <div class="card">
        <div class="panel-head">
          <h3>可办事项</h3>
          <span class="panel-hint">${svc.length ? `共 ${svc.length} 项` : ""}</span>
        </div>
        ${svcPanel}
        ${svc.length > 5 ? `<div style="text-align:center;margin-top:12px"><span class="link-btn" onclick="navigate('affairs')">查看全部 ${svc.length} 项 ›</span></div>` : ""}
      </div>
      <div class="card">
        <div class="panel-head">
          <h3>${admin ? panelC.title : "快捷入口"}</h3>
          <span class="panel-hint">${admin ? panelC.hint : `当前身份：${roleLabel(currentUser.role)}`}</span>
        </div>
        ${admin ? panelC.body : `<div class="quick-grid" style="margin-top:0">${quick.join("")}</div>`}
      </div>
    </div>

    <details class="card wb-fold" style="margin-top:24px">
      <summary>评测指标基线（方案书 14.2 表 12）<span class="summary-note">尚未接入评测集</span></summary>
      <div class="metric-grid" style="margin-top:14px">
        ${[
          ["可追溯覆盖率", "≥ 100%"],
          ["检索 Recall@K", "≥ 85%"],
          ["引用一致率", "≥ 90%"],
          ["事项清单准确率", "≥ 95%"],
          ["无依据拒答率", "≥ 90%"],
          ["关键接口成功率", "≥ 99%"],
          ["高风险权限缺陷", "0 个"]
        ].map(([name, target]) => `
          <div class="metric-item">
            <div class="mi-name">${name}</div>
            <div class="mi-value">${target}</div>
            <div class="mi-state">待评测</div>
          </div>`).join("")}
      </div>
      <div class="ps-hint" style="margin-top:12px">
        以上为项目方案书设定的验收指标。系统当前没有评测数据接口，因此这里只展示目标值；
        评测脚本产出结果后再由后端提供接口回填，前端不显示未经测量的数字。
      </div>
    </details>
  `;
  // BorderGlow 边境光辉：应用到 hero / stat-card / quick-card / card
  $$('.hero, .stat-card, .quick-card, .card', vp).forEach(el => el.classList.add('glow-card'));
  enhanceGlowCards(vp);
  mountDocFolder();       // FolderFloat：文档卡在面板里漂浮
}

function statCard(label, value, trend, color, ico, trendText) {
  return `
    <div class="stat-card">
      <div class="stat-ico" style="background:${color}22;color:${color}">${ico}</div>
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-trend ${trend === 'down' ? 'down' : ''}">${trendText}</div>
    </div>
  `;
}

/** action 可选：给了就直接作为 onclick 表达式执行（用于打开弹窗等非路由动作）。 */
function quickCard(title, desc, ico, color, route, action) {
  const onclick = action || `navigate('${route}')`;
  return `
    <a class="quick-card" onclick="${onclick}">
      <div class="qc-ico" style="background:${color}22;color:${color}">${ico}</div>
      <h4>${title}</h4>
      <p>${desc}</p>
    </a>
  `;
}

/* ============================================================
   视图：智能问答（对接 /api/rag/chat）
   ============================================================ */
let chatMessages = [];
let chatBusy = false, chatPending = false, chatLoading = false, chatGeneration = 0, chatPollTimer;
let historyGeneration = 0, chatRequestGeneration = 0;
function conversationKey() { return `campusagent:last-conversation:${currentUser?.id}`; }
function rememberConversation(id) {
  try { id ? localStorage.setItem(conversationKey(), String(id)) : localStorage.removeItem(conversationKey()); } catch { }
}
function rememberedConversation() { try { return Number(localStorage.getItem(conversationKey())) || null; } catch { return null; } }
function chatUrl(id) { history.replaceState(null, "", id ? `#/qa?conversation=${id}` : '#/qa'); }
function chatAvailable() { return !chatBusy && !chatPending && !chatLoading; }
function syncChatState() {
  const layout = $('.qa-layout');
  const count = $('#chatBody')?.querySelectorAll('.msg').length || 0;
  const content = count > 0 || !!$('#chatBody .chat-loading');
  layout?.classList.toggle('is-empty', !content);
  const empty = $('#qaEmpty'); if (empty) empty.hidden = content;
  const actions = $('#qaActions'); if (actions) actions.hidden = !count;
  const input = $('#qaInput'), send = $('#qaSend');
  if (send) send.disabled = !chatAvailable() || !input?.value.trim();
  if (input) input.disabled = chatLoading || chatPending;
  $$('.qa-suggestion').forEach(button => button.disabled = !chatAvailable());
  $('#chatStatus') && ($('#chatStatus').textContent = chatLoading ? '正在载入对话…' : chatBusy || chatPending ? '正在生成回答…' : '');
}
function scrollChatToReply(body, reply) {
  if (reply?.querySelector('.service-guide')) {
    body.scrollTop += reply.getBoundingClientRect().top - body.getBoundingClientRect().top - 24;
  } else body.scrollTop = body.scrollHeight;
}
function renderQA(vp) {
  vp.innerHTML = `
    <div class="qa-layout is-empty"><div class="qa-chat">
      <div class="qa-chat-head" id="qaActions" hidden><span class="session-state" id="sessionState">智能问答</span>
        <div class="qa-head-actions"><button class="btn btn-sm btn-ghost" onclick="openShareDialog()">⎘ 分享对话</button><button class="btn btn-sm btn-ghost" onclick="newConversation()">＋ 新对话</button></div>
      </div>
      <div class="qa-empty" id="qaEmpty"><span class="qa-brand-symbol" aria-hidden="true">✦</span><h1>校园事务，从这里开始</h1><p>问政策、找材料、理清办理步骤。</p></div>
      <div class="qa-chat-body" id="chatBody" aria-label="问答消息" aria-live="polite"></div>
      <div class="qa-input-area"><div class="qa-input-wrap">
        <textarea class="qa-input" id="qaInput" rows="1" aria-label="输入你的问题" maxlength="2000" placeholder="有什么校园事务想了解？"></textarea>
        <button class="qa-send" id="qaSend" type="button" title="发送问题" aria-label="发送问题" disabled>↑</button>
      </div><div class="qa-input-foot"><span>回答附来源 · 办理以学校最新通知为准</span><span id="chatStatus" role="status"></span></div></div>
      <div class="qa-starters"><button class="qa-suggestion" data-question="国家奖学金的申请条件是什么？"><span>✦</span> 奖学金申请条件</button><button class="qa-suggestion" data-question="学生证丢了怎么补办？"><span>▤</span> 学生证补办流程</button><button class="qa-suggestion" data-question="宿舍怎么报修？"><span>⌂</span> 宿舍报修</button></div>
    </div></div>`;
  const input = $('#qaInput');
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; syncChatState(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); $('#qaSend').click(); }
  });
  $('#qaSend').addEventListener('click', () => askQuestion(input.value));
  $$('.qa-suggestion').forEach(button => button.addEventListener('click', () => askQuestion(button.dataset.question)));
  chatConversationId = null;
  chatPending = false;
  exitShareSelect();
  syncChatState();
  loadConversationList();
  queueMicrotask(() => {
    const id = Number(parseHashRoute().params.get('conversation')) || rememberedConversation();
    if (currentRoute === 'qa' && id && !chatLoading && !chatConversationId && !chatBusy) openConversation(id);
  });
}

async function askQuestion(question) {
  const q = String(question || '').trim();
  if (!q || !chatAvailable()) return;
  if (currentRoute !== 'qa') navigate('qa');
  const body = $('#chatBody');
  if (!body || q.length > 2000) return;
  const generation = chatGeneration, userId = currentUser?.id, requestGeneration = ++chatRequestGeneration;
  chatBusy = true;
  const input = $('#qaInput');
  if (input) { input.value = ''; input.style.height = 'auto'; }
  const userMsg = document.createElement('div');
  userMsg.className = 'msg user'; userMsg.dataset.time = new Date().toISOString();
  userMsg.innerHTML = `<div class="msg-bubble">${escapeHtml(q).replace(/\n/g, '<br/>')}</div>`;
  body.appendChild(userMsg);
  const loading = document.createElement('div'); loading.className = 'msg bot';
  loading.innerHTML = `<div class="msg-bubble qa-thinking">${latticeLoaderHTML()}</div>`;
  body.appendChild(loading); syncChatState(); body.scrollTop = body.scrollHeight;
  const thinking = mountLatticeLoader($('.lattice-loader', loading));
  const live = () => userId === currentUser?.id && generation === chatGeneration && body.isConnected;
  try {
    // Create on the first real question: failures still have a recoverable conversation ID.
    if (!chatConversationId) {
      const conversation = await apiPost('/api/chat/conversations');
      if (!live()) return;
      chatConversationId = conversation.id;
      rememberConversation(conversation.id); chatUrl(conversation.id);
    }
    const id = chatConversationId;
    const requestId = crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c) / 4).toString(16));
    const turn = await apiPost('/api/rag/chat', { query: q, knowledgeBaseId: 'campus-default', conversationId: id, requestId });
    if (!live()) return;
    if (turn?.userMessageId) userMsg.dataset.msgId = String(turn.userMessageId);
    updateSessionState(); loadConversationList();
    await settleLatticeLoader(thinking, 'done');
    if (!live()) return;
    loading.remove();
    const bot = document.createElement('div'); bot.className = 'msg bot'; bot.dataset.time = new Date().toISOString();
    if (turn?.assistantMessageId) bot.dataset.msgId = String(turn.assistantMessageId);
    bot.innerHTML = renderChatTurn(turn); bot.dataset.sources = JSON.stringify(turn?.sources || []);
    body.appendChild(bot); bindChatContent(bot); enhanceMessageActions(); scrollChatToReply(body, bot);
  } catch (e) {
    if (!live()) return;
    await settleLatticeLoader(thinking, 'error');
    if (!live()) return;
    loading.remove();
    const bot = document.createElement('div'); bot.className = 'msg bot chat-error';
    bot.innerHTML = errorBlock(e.message, e.hint); body.appendChild(bot);
    if (input) input.value = q;
    loadConversationList(); body.scrollTop = body.scrollHeight;
  } finally {
    thinking?.destroy?.();
    if (requestGeneration !== chatRequestGeneration) return;
    chatBusy = false;
    if (live()) syncChatState();
    else if (currentRoute === 'qa' && currentUser?.id === userId) {
      const id = chatConversationId || rememberedConversation();
      id ? openConversation(id) : syncChatState();
    }
  }
}
window.askQuestion = askQuestion;
function bindChatContent(root) {
  root.querySelectorAll('.cite-chip').forEach(chip => chip.addEventListener('click', () => showSourceCite(Number(chip.dataset.citeIndex), chip.closest('.msg'))));
  window.CampusGuide.mount(root);
}

/* ============================================================
   回答渲染：对应后端 ChatResponse
     type=QA            → 答案 + 引用；relatedService 命中时给出事项入口
     type=SERVICE_GUIDE → 答案 + 事项（条件/材料）+ 步骤 + 来源文件
   后端字段：type, answer, sources[], retrievalCount, rerankCount, usedContextCount,
             rewrittenQuery, service, steps[], source{title,documentId,publishTime,url},
             currentStep, aiEnhanced, queryIntent, relatedService{code,name}
   ============================================================ */
function citeChipsHtml(sources) {
  if (!sources || !sources.length) return "";
  return `<div class="msg-cite">${sources.map((s, i) =>
    `<span class="cite-chip" data-cite-index="${i}">[${i + 1}] ${escapeHtml(s.fileName || s.documentId || '来源')}${s.pageNumber != null ? " · p." + s.pageNumber : ""}</span>`
  ).join("")}</div>`;
}

function renderChatTurn(turn, { readOnly = false } = {}) {
  if (!turn) return `<div class="msg-bubble">（后端未返回内容）</div>`;
  const answer = escapeHtml(turn.answer || "（未返回答案）").replace(/\n/g, "<br/>");
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
    return `<div class="msg-bubble">${answer}</div>${window.CampusGuide.html(turn, { readOnly })}${citeChipsHtml(sources)}${meta}`;
  }

  const related = !readOnly && turn.relatedService
    ? `<div class="msg-related">识别到相关事项：<b>${escapeHtml(turn.relatedService.name || turn.relatedService.code)}</b>
         <span class="link-btn" onclick="recognizeToAffair()">去办事引导查看 ›</span></div>`
    : "";
  return `<div class="msg-bubble">${answer}</div>${citeChipsHtml(sources)}${related}
    ${sources.length ? "" : `<div style="font-size:11.5px;color:var(--text-3);margin-top:8px">未检索到可用证据，系统按“无依据不生成确定结论”的策略回应。</div>`}
    ${meta}`;
}
function recognizeToAffair() { navigate("affairs"); setTimeout(() => { const el = $("#recognizeInput"); if (el) el.focus(); }, 200); }
window.recognizeToAffair = recognizeToAffair;

/* ---------- 会话列表 / 新建 / 删除 ----------
   后端：GET    /api/chat/conversations
         POST   /api/chat/conversations        （显式创建空会话）
         DELETE /api/chat/conversations/{id}
   本页采用“首次提问时由 /api/rag/chat 懒创建”的方式，避免堆积空会话。 */
function updateSessionState() {
  const selected = $('#convList .conv-item.on .conv-title');
  const el = $('#sessionState');
  if (el) el.textContent = selected?.textContent || '智能问答';
}
async function loadConversationList() {
  const holder = $('#convList'), owner = currentUser?.id, generation = ++historyGeneration;
  if (!holder || !owner) return;
  try {
    const convs = await apiGet('/api/chat/conversations');
    if (owner !== currentUser?.id || generation !== historyGeneration) return;
    holder.innerHTML = convs.length ? convs.map(c => `<div class="conv-item ${chatConversationId === c.id ? 'on' : ''}">
      <button class="conv-main" type="button" onclick="openConversation(${c.id})" title="${escAttr(c.title || '新对话')}"><span class="conv-title">${escapeHtml(c.title || '新对话')}</span><span class="conv-time">${relTime(c.updatedAt || c.createdAt)}</span></button>
      <button class="conv-del" type="button" aria-label="删除会话：${escAttr(c.title || '新对话')}" title="删除对话" onclick="deleteConversation(${c.id}, event)">×</button></div>`).join('') : '<p class="history-empty">从一个问题开始，你的对话会保存在这里。</p>';
    updateSessionState();
  } catch (e) { if (owner === currentUser?.id && generation === historyGeneration) holder.innerHTML = `<p class="history-empty">${escapeHtml(e.message || '暂时无法加载历史')}</p><button class="link-btn" onclick="loadConversationList()">重试</button>`; }
}
window.loadConversationList = loadConversationList;
async function deleteConversation(id, ev) {
  ev?.stopPropagation();
  if (chatBusy && id === chatConversationId) { toast('请等待当前回答完成', 'warn'); return; }
  if (!confirm('删除这段对话？消息和它的分享链接会一并失效。')) return;
  try {
    await apiDelete(`/api/chat/conversations/${id}`);
    if (chatConversationId === id) clearChat();
    else if (rememberedConversation() === id) rememberConversation(null);
    loadConversationList();
    toast('会话已删除', 'success');
  } catch (e) { toast(e.message || '删除失败', 'error'); }
}
window.deleteConversation = deleteConversation;
function newConversation() {
  if (chatBusy) { toast('请等待当前回答完成后再新建对话', 'info'); return; }
  if (currentRoute !== 'qa') navigate('qa');
  clearChat();
  if (window.innerWidth <= 768) closeDrawer();
  $('#qaInput')?.focus();
}
window.newConversation = newConversation;
function clearChat() {
  chatGeneration++; clearTimeout(chatPollTimer);
  chatLoading = false; chatPending = false; chatConversationId = null;
  rememberConversation(null); chatUrl(null);
  $('#chatBody') && ($('#chatBody').innerHTML = '');
  exitShareSelect(); syncChatState(); updateSessionState(); loadConversationList();
}
window.clearChat = clearChat;

/* ---------- 引用弹窗 ----------
   历史会话里每条回答都有自己的 sources，因此允许传入具体气泡元素；
   实时问答沿用“取最后一条 bot 消息”的行为。 */
function showSourceCite(index, bubble) {
  const botMsg = bubble || [...document.querySelectorAll("#chatBody .msg.bot")].pop();
  if (!botMsg) return;
  let sources = [];
  try { sources = JSON.parse(botMsg.dataset.sources || "[]"); } catch (e) { sources = []; }
  const s = sources[index];
  if (!s) return;
  openModal(`
    <div class="detail-head">
      <div>
        <h2>引用原文</h2>
        <div style="font-size:12px;color:var(--text-3);margin-top:4px">${escapeHtml(s.fileName || s.documentId || '来源')} · 第 ${s.pageNumber ?? '-'} 页 · chunk #${s.chunkIndex ?? '-'}</div>
      </div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body">
      <div class="cite-block">
        ${escapeHtml(s.content || '(无内容)')}
        <div class="cite-meta">documentId=${escapeHtml(s.documentId || '-')} · score=${s.score ?? '-'} · rerank=${s.rerankScore ?? '-'}</div>
      </div>
    </div>
  `, "cite-modal");
}
window.showSourceCite = showSourceCite;

/* ============================================================
   工作台交互：继续历史对话
   后端：GET /api/chat/conversations/{id}/messages → { messages[], pending }
   role 取值为 USER / ASSISTANT；ASSISTANT 消息带 response.sources 引用快照。
   载入后把 chatConversationId 设为该会话，后续提问会接着这条会话继续。
   ============================================================ */
async function openConversation(id, { poll = false } = {}) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return;
  if (chatBusy && !poll) { toast('请等待当前回答完成后再切换对话', 'info'); return; }
  if (currentRoute !== 'qa') navigate('qa');
  const body = $('#chatBody'); if (!body) return;
  const generation = ++chatGeneration, owner = currentUser?.id;
  clearTimeout(chatPollTimer); chatLoading = !poll; exitShareSelect();
  if (!poll) body.innerHTML = '<div class="chat-loading" role="status">正在载入历史对话…</div>';
  syncChatState();
  try {
    const data = await apiGet(`/api/chat/conversations/${id}/messages`);
    if (generation !== chatGeneration || owner !== currentUser?.id || !body.isConnected) return;
    chatConversationId = Number(id); rememberConversation(id); chatUrl(id);
    body.innerHTML = '';
    for (const m of data?.messages || []) {
      const user = String(m.role).toUpperCase() === 'USER';
      const el = document.createElement('div'); el.className = `msg ${user ? 'user' : 'bot'}`;
      if (m.id != null) el.dataset.msgId = String(m.id);
      if (m.createdAt) el.dataset.time = m.createdAt;
      el.innerHTML = user ? `<div class="msg-bubble">${escapeHtml(m.content || '').replace(/\n/g, '<br/>')}</div>` : renderChatTurn({ ...(m.response || {}), answer: m.content, sources: m.response?.sources || [] });
      el.dataset.sources = JSON.stringify(m.response?.sources || []);
      el.dataset.rating = m.feedback?.rating || '';
      body.appendChild(el); bindChatContent(el);
    }
    chatPending = !!data?.pending;
    if (chatPending) {
      body.insertAdjacentHTML('beforeend', '<div class="chat-loading" role="status">回答正在生成，完成后会自动同步…</div>');
      chatPollTimer = setTimeout(() => { if (generation === chatGeneration && owner === currentUser?.id) openConversation(id, { poll: true }); }, 1800);
    }
    enhanceMessageActions(); scrollChatToReply(body, body.querySelector('.msg.bot:last-of-type')); updateSessionState(); loadConversationList();
    if (window.innerWidth <= 768 && !poll) closeDrawer();
  } catch (e) {
    if (generation !== chatGeneration || owner !== currentUser?.id || !body.isConnected) return;
    chatPending = false;
    if (e.status === 404) { rememberConversation(null); chatConversationId = null; chatUrl(null); }
    body.innerHTML = `<div class="chat-loading chat-error" role="alert">${escapeHtml(e.message || '载入对话失败')}<button class="link-btn" onclick="openConversation(${Number(id)})">重新加载</button></div>`;
  } finally { if (generation === chatGeneration && owner === currentUser?.id && body.isConnected) { chatLoading = false; syncChatState(); } }
}
window.openConversation = openConversation;

/* ============================================================
   消息操作条与多选分享
   每条消息下方有一条操作条（分享 / 复制 / 时间）；点“分享”进入多选，
   选中若干条后可复制为图片、导出图片，或生成后端的公开分享链接。
   ============================================================ */
const shareSelect = { active: false, ids: new Set() };

/** 消息时间：今天/昨天显示时刻，更早显示日期（对齐截图里的“昨天 19:03”）。 */
function fmtMsgTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const today = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return `今天 ${clock}`;
  const yesterday = new Date(today.getTime() - 86400000);
  if (sameDay(date, yesterday)) return `昨天 ${clock}`;
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${clock}`;
}

/** 图片里用的短时刻 HH:MM。 */
function msgClock(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    : "";
}

/** 给问答区每条消息补上操作条、时间与选择态绑定（渲染后调用，可重复调用）。 */
function enhanceMessageActions(scope = document) {
  $$(".qa-chat-body .msg", scope).forEach(el => {
    if (el.querySelector(":scope > .msg-acts")) return;
    const acts = document.createElement("div");
    acts.className = "msg-acts";
    acts.innerHTML = el.classList.contains('bot') && !el.classList.contains('chat-error') && el.dataset.msgId ? window.CampusFeedback.toolbar(el) : `
      <button type="button" class="msg-act" data-act="share" title="选择消息并分享">⎘ 分享</button>
      <button type="button" class="msg-act" data-act="copy" title="复制这条消息">▤ 复制</button>
      <span class="msg-time">${escapeHtml(fmtMsgTime(el.dataset.time))}</span>`;
    el.appendChild(acts);
    window.CampusFeedback.bind(el, acts);
    acts.querySelector('[data-act="share"]').addEventListener("click", e => {
      e.stopPropagation();
      enterShareSelect(el);
    });
    acts.querySelector('[data-act="copy"]').addEventListener("click", async e => {
      e.stopPropagation();
      const text = messageShareText(el);
      const ok = await copyTextToClipboard(text);
      toast(ok ? "这条消息已复制" : "复制失败，请手动选择文本", ok ? "success" : "warn");
    });
    el.addEventListener("click", e => {
      if (shareSelect.active) toggleMsgSelection(el, e);
    });
  });
  syncMsgSelection();
}

async function regenerateReply(el) {
  if (!chatAvailable()) return toast('请等待当前回答完成','info');
  const id = Number(el.dataset.msgId), conversationId = chatConversationId, owner = currentUser?.id;
  if (!id || !conversationId) return toast('回复尚未保存，请刷新后重试','warn');
  chatBusy = true; syncChatState();
  const button = el.querySelector('[data-act="regenerate"]'); button.disabled = true;
  const generation = ++chatRequestGeneration;
  try {
    await apiPost(`/api/chat/messages/${id}/regenerate`, { requestId: crypto.randomUUID() });
    if (owner === currentUser?.id) toast('已生成新回复，原回答已保留','success');
  } catch (e) { if (owner === currentUser?.id) toast(e.message || '重新生成失败','error'); }
  finally {
    button.disabled = false;
    if (generation === chatRequestGeneration) {
      chatBusy = false;
      if (owner === currentUser?.id && currentRoute === 'qa' && conversationId === chatConversationId) await openConversation(conversationId);
      syncChatState();
    }
  }
}

function enterShareSelect(el) {
  const wasActive = shareSelect.active;
  shareSelect.active = true;
  if (!wasActive) shareSelect.ids.clear();
  const index = messageIndex(el);
  if (index >= 0) shareSelect.ids.has(index) ? shareSelect.ids.delete(index) : shareSelect.ids.add(index);
  document.querySelector(".qa-layout")?.classList.add("is-selecting");
  syncMsgSelection();
  if (!wasActive) toast("已进入多选：点选要分享的消息，再选择分享方式", "info");
}

function exitShareSelect() {
  shareSelect.active = false;
  shareSelect.ids.clear();
  document.querySelector(".qa-layout")?.classList.remove("is-selecting");
  syncMsgSelection();
}

function messageIndex(el) {
  const nodes = $$(".qa-chat-body .msg");
  return nodes.indexOf(el);
}

function toggleMsgSelection(el, e) {
  if (e.target.closest("a, button, .cite-chip, input, textarea")) return;   // 站内链接/按钮不参与选择
  const index = messageIndex(el);
  if (index < 0) return;
  shareSelect.ids.has(index) ? shareSelect.ids.delete(index) : shareSelect.ids.add(index);
  syncMsgSelection();
}

/** 把选中集合刷到 DOM（勾选标记、按钮文案）并刷新工具条。 */
function syncMsgSelection() {
  $$(".qa-chat-body .msg").forEach((el, i) => {
    const selected = shareSelect.active && shareSelect.ids.has(i);
    el.classList.toggle("is-pickable", shareSelect.active);
    el.classList.toggle("is-selected", selected);
    const btn = el.querySelector('.msg-act[data-act="share"]');
    if (btn?.classList.contains('reply-icon')) {
      btn.innerHTML = window.CampusFeedback.icon('share');
      btn.setAttribute('aria-pressed', String(selected));
      btn.title = btn.ariaLabel = selected ? '已选择这条消息，点击取消' : '选择消息并分享';
    } else if (btn) btn.textContent = selected ? "✓ 已选" : "⎘ 分享";
  });
  renderShareBar();
}

function renderShareBar() {
  const host = $(".qa-chat");
  const existing = $("#shareBar");
  if (!host) return;
  if (!shareSelect.active) { existing?.remove(); return; }
  let bar = existing;
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "shareBar";
    bar.className = "share-bar";
    const inputArea = $(".qa-input-area");
    host.insertBefore(bar, inputArea || null);
  }
  const total = $$(".qa-chat-body .msg").length;
  bar.innerHTML = `
    <span class="sb-count">已选 <b>${shareSelect.ids.size}</b> / ${total} 条</span>
    <button type="button" class="btn btn-sm" data-sb="all">全选</button>
    <button type="button" class="btn btn-sm" data-sb="none">清空</button>
    <span class="sb-spacer"></span>
    <button type="button" class="btn btn-sm btn-primary" data-sb="image">复制为图片</button>
    <button type="button" class="btn btn-sm" data-sb="export">导出图片</button>
    <button type="button" class="btn btn-sm" data-sb="link">生成分享链接</button>
    <button type="button" class="btn btn-sm btn-ghost" data-sb="cancel">取消</button>`;
  const on = (key, fn) => bar.querySelector(`[data-sb="${key}"]`).addEventListener("click", fn);
  on("all", () => { shareSelect.ids = new Set($$(".qa-chat-body .msg").map((_, i) => i)); syncMsgSelection(); });
  on("none", () => { shareSelect.ids.clear(); syncMsgSelection(); });
  on("image", () => copyConversationImage(selectedTranscript()));
  on("export", () => exportConversationImage(selectedTranscript()));
  on("link", () => shareLinkFromSelection());
  on("cancel", () => exitShareSelect());
}

/** 选中的消息（未进入多选时等价于整段会话）。 */
function selectedTranscript() {
  const all = collectTranscript();
  if (!shareSelect.active) return all;
  return collectTranscript(true);
}

/* ============================================================
   分享对话：复制为图片 / 导出 PNG / 复制分享链接 / 复制文本
   - 图片由 Canvas 2D 手绘（无第三方库、无 CDN 依赖）：取当前主题色、
     按 13px 正文与 22px 行高重新排版，2 倍尺寸输出。
   - 分享链接走后端 token（POST /api/chat/conversations/{id}/shares）：
     可只分享选中的消息，默认 30 天有效，可随时撤销；链接形式 #/share/<token>。
   ============================================================ */
const SHARE = {
  width: 720,          // 逻辑宽度
  scale: 2,            // 输出倍率（高清）
  pad: 40,
  maxMessages: 30,     // 图片最多包含最近 30 条消息
  maxLines: 26,        // 单条回答最多 26 行，超出以省略号收尾
  bubbleMax: 0.78      // 气泡最大宽度占内容宽度比例
};
const SHARE_FONT = '"Noto Sans SC","Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif';

const shareVar = name => (getComputedStyle(document.documentElement).getPropertyValue(name) || "").trim();

function shareTheme() {
  return {
    bg: shareVar("--bg-0") || "#10141f",
    card: shareVar("--bg-2") || "#1c2233",
    border: shareVar("--border") || "rgba(255,255,255,0.07)",
    text1: shareVar("--text-1") || "#e6e9f2",
    text2: shareVar("--text-2") || "#9da6bd",
    text3: shareVar("--text-3") || "#656d85",
    primary: shareVar("--primary") || "#7b93d6",
    primary2: shareVar("--primary-2") || "#a895d4"
  };
}

/** innerText 优先（浏览器里已含换行），退化到 textContent。 */
function shareNodeText(el) {
  if (!el) return "";
  const raw = (el.innerText ?? el.textContent ?? "");
  return String(raw).replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function guideShareText(response) {
  if (response?.type !== 'SERVICE_GUIDE' || !response.service) return '';
  const s = response.service;
  const steps = window.CampusServiceProgress.orderSteps(response.steps || []);
  return [s.name, s.isExample ? '测试 / 示例数据，不代表学校真实政策。' : '',
    ...(s.requirements?.length ? ['办理条件：' + s.requirements.join('；')] : []),
    ...(steps.length ? ['办理步骤：', ...steps.map((step, index) => `${index + 1}. ${step.title}${step.description ? '：' + step.description : ''}`)] : []),
    ...(s.materials?.length ? ['所需材料：' + s.materials.map(m => m.name + (m.required ? '（必需）' : '（可选）')).join('、')] : []),
    s.department ? '办理部门：' + s.department : '',
    response.source?.title || s.sourceTitle ? '依据：' + (response.source?.title || s.sourceTitle) : ''
  ].filter(Boolean).join('\n');
}
function messageShareText(el) {
  let text = shareNodeText(el.querySelector('.msg-bubble'));
  const guide = el.querySelector('[data-guide]');
  if (guide) {
    try { const data = JSON.parse(guide.dataset.guide); text += '\n\n' + guideShareText({ ...data, type: 'SERVICE_GUIDE' }); } catch { }
  }
  return text;
}

/** 从当前问答区读出结构化记录：角色、正文、引用、回答类型、后端消息 id。
    onlySelected=true 时只取多选中的消息。 */
function collectTranscript(onlySelected = false) {
  const out = [];
  $$(".qa-chat-body .msg").forEach(el => {
    if (el.classList.contains("chat-error") || el.querySelector(".qa-thinking")) return;
    if (onlySelected && !el.classList?.contains("is-selected")) return;
    const isUser = el.classList?.contains("user");
    const text = messageShareText(el);
    if (!text) return;
    let cites = [];
    if (!isUser) {
      try {
        cites = (JSON.parse(el.dataset?.sources || "[]") || []).map(s => {
          const name = s?.fileName || s?.documentId || "来源";
          return s?.pageNumber != null ? `${name} p.${s.pageNumber}` : String(name);
        });
      } catch { cites = []; }
    }
    const type = isUser ? "" : (el.querySelector(".msg-extra .tag")?.textContent || "").trim();
    const msgId = Number(el.dataset?.msgId);
    out.push({
      role: isUser ? "user" : "bot", text, cites, type,
      msgId: Number.isFinite(msgId) && msgId > 0 ? msgId : null,
      time: el.dataset?.time || ""
    });
  });
  return out;
}

function transcriptToText(msgs) {
  return msgs.map(m => `${m.role === "user" ? "我" : "CampusAgent"}：${m.text}` +
    (m.cites?.length ? `\n引用：${m.cites.join("；")}` : "")).join("\n\n");
}

/** 按字符宽度折行；中文逐字测量，够精确也够快（一条回答约千次 measureText）。 */
function shareWrap(ctx, text, maxWidth) {
  const lines = [];
  String(text ?? "").split("\n").forEach(para => {
    let line = "";
    for (const ch of para) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = ch; }
      else line = test;
    }
    lines.push(line);
  });
  return lines;
}

function shareRoundRect(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/** 第一遍：只测量，产出可直接绘制的指令表。 */
function computeShareLayout(ctx, msgs, meta) {
  const W = SHARE.width, pad = SHARE.pad, contentW = W - pad * 2;
  const headH = 96;
  const items = [];
  let y = headH + 24;

  const shown = msgs.slice(-SHARE.maxMessages);
  const dropped = msgs.length - shown.length;
  if (dropped > 0) {
    items.push({ kind: "note", text: `… 更早的 ${dropped} 条消息未包含在图片中`, x: pad, y });
    y += 28;
  }

  ctx.font = `400 13px ${SHARE_FONT}`;
  const maxTextW = Math.round(contentW * SHARE.bubbleMax) - 28;
  shown.forEach(m => {
    const isUser = m.role === "user";
    let lines = shareWrap(ctx, m.text, maxTextW);
    if (!lines.length) lines = [""];
    let clipped = false;
    if (lines.length > SHARE.maxLines) { lines = lines.slice(0, SHARE.maxLines); clipped = true; }
    if (clipped) lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + "…";

    const lh = 22, padY = 12, padX = 14;
    const textW = Math.max(...lines.map(l => ctx.measureText(l).width));
    const bubbleW = Math.min(contentW, Math.max(90, textW + padX * 2));
    const bubbleH = lines.length * lh + padY * 2;
    const x = isUser ? W - pad - bubbleW : pad;
    const roleY = y;

    items.push({ kind: "bubble", x, y: roleY + 20, w: bubbleW, h: bubbleH, lines, isUser, lh, padX, padY });
    const clock = msgClock(m.time);
    items.push({
      kind: "role", x: isUser ? W - pad : pad, y: roleY, right: isUser,
      text: (isUser ? "我" : `CampusAgent${m.type && m.type !== "QA" ? " · " + m.type : ""}`) + (clock ? ` · ${clock}` : "")
    });
    y = roleY + 20 + bubbleH;

    if (!isUser && m.cites?.length) {
      const keep = m.cites.slice(0, 3);
      keep.forEach((c, i) => items.push({ kind: "cite", x: pad + 2, y: y + 8 + i * 17, text: `· ${c}` }));
      y += 8 + keep.length * 17;
      if (m.cites.length > keep.length) {
        items.push({ kind: "cite", x: pad + 2, y: y + 2, text: `· 另有 ${m.cites.length - keep.length} 条引用未在图片中列出` });
        y += 19;
      }
    }
    y += 20;
  });

  const footY = y + 6;
  const height = Math.max(300, Math.ceil(footY + 62));
  return { width: W, height, headH, footY, items, dropped, meta };
}

/** 第二遍：把指令表画到最终画布上。 */
function drawShareLayout(ctx, layout, theme) {
  const { width: W, height: H, items, headH, footY } = layout;
  ctx.textBaseline = "top";
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // 顶部品牌渐变带
  ctx.save();
  ctx.globalAlpha = 0.14;
  const grad = ctx.createLinearGradient(0, 0, W, headH);
  grad.addColorStop(0, theme.primary);
  grad.addColorStop(1, theme.primary2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, headH);
  ctx.restore();

  // 品牌块
  ctx.save();
  const tile = ctx.createLinearGradient(SHARE.pad, 28, SHARE.pad + 40, 68);
  tile.addColorStop(0, theme.primary);
  tile.addColorStop(1, theme.primary2);
  ctx.fillStyle = tile;
  shareRoundRect(ctx, SHARE.pad, 28, 40, 40, 12);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `600 18px ${SHARE_FONT}`;
  ctx.fillText("✦", SHARE.pad + 13, 38);
  ctx.restore();

  ctx.fillStyle = theme.text1;
  ctx.font = `600 15px ${SHARE_FONT}`;
  ctx.fillText("CampusAgent · 智能问答", SHARE.pad + 54, 34);
  ctx.fillStyle = theme.text3;
  ctx.font = `400 12px ${SHARE_FONT}`;
  ctx.fillText(layout.meta?.subtitle || "校园政策问答记录", SHARE.pad + 54, 56);

  ctx.textAlign = "right";
  ctx.fillStyle = theme.text3;
  ctx.font = `400 11px ${SHARE_FONT}`;
  ctx.fillText(layout.meta?.date || "", W - SHARE.pad, 36);
  if (layout.meta?.link) ctx.fillText(layout.meta.link.replace(/^https?:\/\//, ""), W - SHARE.pad, 54);
  ctx.textAlign = "left";

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SHARE.pad, headH - 1);
  ctx.lineTo(W - SHARE.pad, headH - 1);
  ctx.stroke();

  // 消息
  items.forEach(it => {
    if (it.kind === "role") {
      ctx.fillStyle = theme.text3;
      ctx.font = `500 11px ${SHARE_FONT}`;
      ctx.textAlign = it.right ? "right" : "left";
      ctx.fillText(it.text, it.x, it.y + 4);
      ctx.textAlign = "left";
    } else if (it.kind === "note") {
      ctx.fillStyle = theme.text3;
      ctx.font = `400 11.5px ${SHARE_FONT}`;
      ctx.fillText(it.text, it.x, it.y);
    } else if (it.kind === "cite") {
      ctx.fillStyle = theme.text3;
      ctx.font = `400 11px ${SHARE_FONT}`;
      ctx.fillText(it.text, it.x, it.y);
    } else if (it.kind === "bubble") {
      ctx.save();
      if (it.isUser) {
        const g = ctx.createLinearGradient(it.x, it.y, it.x + it.w, it.y + it.h);
        g.addColorStop(0, theme.primary);
        g.addColorStop(1, theme.primary2);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = theme.card;
      }
      shareRoundRect(ctx, it.x, it.y, it.w, it.h, 14);
      ctx.fill();
      if (!it.isUser) { ctx.strokeStyle = theme.border; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.restore();

      ctx.fillStyle = it.isUser ? "#ffffff" : theme.text1;
      ctx.font = `400 13px ${SHARE_FONT}`;
      it.lines.forEach((line, i) => ctx.fillText(line, it.x + it.padX, it.y + it.padY + i * it.lh + 4));
    }
  });

  // 页脚
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(SHARE.pad, footY);
  ctx.lineTo(W - SHARE.pad, footY);
  ctx.stroke();
  ctx.fillStyle = theme.text3;
  ctx.font = `400 11px ${SHARE_FONT}`;
  ctx.fillText("由 CampusAgent 生成 · 回答仅依据已索引的现行政策，事实性内容附原文引用", SHARE.pad, footY + 16);
  ctx.fillText("仅表示我校已发布的政策内容，不构成办理结果或审批意见", SHARE.pad, footY + 34);
}

/** 生成对话长图；传入消息列表时只画这些消息（多选分享用）。 */
async function conversationImage(list = selectedTranscript()) {
  const full = collectTranscript();
  const msgs = (Array.isArray(list) ? list : full).filter(m => m.text)
    .map(m => m.guideText ? { ...m, text: m.text + '\n\n' + m.guideText } : m);
  if (!msgs.length) { toast("当前会话还没有内容可分享", "warn"); return null; }
  const theme = shareTheme();
  const measure = document.createElement("canvas").getContext("2d");
  const partial = msgs.length < full.length;
  const meta = {
    subtitle: `${partial ? `选中的 ${msgs.length} 条` : `${msgs.length} 条消息`}${chatConversationId ? ` · 会话 #${chatConversationId}` : ""}`,
    date: new Date().toLocaleString("zh-CN", { hour12: false }),
    link: chatConversationId ? conversationShareLink(chatConversationId) : location.href
  };
  const layout = computeShareLayout(measure, msgs, meta);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width * SHARE.scale;
  canvas.height = layout.height * SHARE.scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(SHARE.scale, SHARE.scale);
  drawShareLayout(ctx, layout, theme);
  return canvas;
}

function shareCanvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("图片编码失败"))), "image/png");
  });
}

async function copyConversationImage(list = selectedTranscript()) {
  try {
    const canvas = await conversationImage(list);
    if (!canvas) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      toast("当前浏览器不支持复制图片，请改用「导出 PNG」", "warn");
      return;
    }
    const blob = await shareCanvasBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast("对话图片已复制到剪贴板", "success");
  } catch (e) {
    toast(`复制图片失败：${e.message || "未知错误"}`, "warn");
  }
}

async function exportConversationImage(list = selectedTranscript()) {
  try {
    const canvas = await conversationImage(list);
    if (!canvas) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const a = document.createElement("a");
    a.download = `CampusAgent-问答记录-${stamp}.png`;
    // 长图优先用 Blob URL（避免多 MB 的 dataURL 字符串），不支持时退回 dataURL
    let objectUrl = "";
    try {
      const blob = await shareCanvasBlob(canvas);
      objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
    } catch {
      a.href = canvas.toDataURL("image/png");
    }
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    toast("已导出对话图片", "success");
  } catch (e) {
    toast(`导出图片失败：${e.message || "未知错误"}`, "warn");
  }
}

/** 站内深链：打开后会直接回到这段会话（需要登录同一账号）。 */
function conversationShareLink(id = chatConversationId) {
  const base = `${location.origin}${location.pathname}`;
  return id ? `${base}#/qa?conversation=${encodeURIComponent(id)}` : `${base}#/qa`;
}

/** 公开分享链接：任何人凭 token 免登录只读查看。 */
function shareUrl(token) {
  return `${location.origin}${location.pathname}#/share/${encodeURIComponent(token)}`;
}

/** 调后端创建（或复用）分享 token；messageIds 非空表示只分享选中的消息。 */
async function createShareToken(messageIds) {
  if (!chatConversationId) {
    toast("先在会话里提一个问题，保存到后端后才能生成分享链接", "warn");
    return null;
  }
  const body = { ttlDays: 30 };
  if (messageIds && messageIds.length) body.messageIds = messageIds;
  return apiPost(`/api/chat/conversations/${chatConversationId}/shares`, body);
}

/** 头部按钮：整段会话的分享链接。 */
async function copyShareLink() {
  const share = await createShareToken();
  if (!share?.token) return null;
  const ok = await copyTextToClipboard(shareUrl(share.token));
  toast(ok ? "分享链接已复制（30 天内有效，可随时撤销）" : "复制失败，请手动复制", ok ? "success" : "warn");
  return share;
}

/** 多选后生成链接：只把选中的消息放进链接。 */
async function shareLinkFromSelection() {
  const msgs = selectedTranscript();
  if (!msgs.length) { toast("请先选择要分享的消息", "warn"); return; }
  const ids = msgs.map(m => m.msgId).filter(v => v != null);
  const total = collectTranscript().length;
  if (shareSelect.active && !ids.length) { toast("所选消息尚未保存，暂时不能生成链接；可以导出图片。", "warn"); return; }
  const partial = shareSelect.active;
  let share;
  try {
    share = await createShareToken(partial ? ids : null);
  } catch (e) {
    toast(`生成分享链接失败：${e.message || "未知错误"}`, "warn");
    return;
  }
  if (!share?.token) return;
  openShareLinkDialog(share, { count: partial ? ids.length : total, partial, missing: shareSelect.active ? msgs.length - ids.length : 0 });
}

function openShareLinkDialog(share, info) {
  const link = shareUrl(share.token);
  const expires = share.expiresAt ? new Date(share.expiresAt).toLocaleString("zh-CN", { hour12: false }) : "长期";
  openModal(`
    <div class="detail-head">
      <div>
        <h2>分享链接已生成</h2>
        <div class="head-sub">${info.partial ? `只包含选中的 ${info.count} 条消息` : `包含整段会话（${info.count} 条）`} · ${escapeHtml(expires)} 失效</div>
      </div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body">
      <div class="share-link-row">
        <input class="input" id="shareLinkInput" readonly value="${escAttr(link)}" />
        <button class="btn btn-sm btn-primary" id="shareLinkCopy">复制</button>
      </div>
      ${info.missing ? `<div class="form-hint" style="margin-top:8px">有 ${info.missing} 条消息没有后端记录（例如欢迎语），未包含在链接里。</div>` : ""}
      <div class="share-note">
        <b>链接说明</b>
        <div>拿到链接的人<b>无需登录</b>即可只读查看，链接只对应这一段会话，
          不含账号信息，也不会因为对方登录的账号不同而失效；随时可以撤销。</div>
      </div>
      <div class="form-actions" style="margin-top:14px">
        <a class="btn btn-sm" href="${escAttr(link)}" target="_blank" rel="noopener">打开预览</a>
        <button class="btn btn-sm" id="shareLinkRevoke">撤销这条链接</button>
      </div>
    </div>
  `, "affair-modal");

  const input = $("#shareLinkInput");
  input?.addEventListener("click", () => input.select());
  $("#shareLinkCopy")?.addEventListener("click", async () => {
    const ok = await copyTextToClipboard(link);
    toast(ok ? "分享链接已复制" : "复制失败，请手动复制", ok ? "success" : "warn");
  });
  $("#shareLinkRevoke")?.addEventListener("click", async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "撤销中…";
    try {
      await apiDelete(`/api/chat/conversations/${chatConversationId}/shares/${encodeURIComponent(share.token)}`);
      toast("分享链接已撤销", "success");
      closeModal();
      exitShareSelect();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "撤销这条链接";
      toast(`撤销失败：${err.message || "未知错误"}`, "warn");
    }
  });
}

async function copyConversationText() {
  const msgs = selectedTranscript();
  if (!msgs.length) { toast("当前会话还没有内容可复制", "warn"); return; }
  const ok = await copyTextToClipboard(transcriptToText(msgs));
  toast(ok ? "对话文本已复制" : "复制失败，请手动复制", ok ? "success" : "warn");
}

/** Clipboard API 优先，失败退回临时 textarea + execCommand（http 场景可用）。 */
async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 继续走回退方案 */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return !!ok;
  } catch { return false; }
}

async function openShareDialog() {
  const msgs = collectTranscript();
  const saved = !!chatConversationId;
  openModal(`
    <div class="detail-head">
      <div>
        <h2>分享对话</h2>
        <div class="head-sub">${msgs.length} 条消息${saved ? ` · 会话 #${chatConversationId}` : " · 尚未保存到后端"}</div>
      </div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body">
      <div class="share-grid">
        <button class="share-card" onclick="copyConversationImage()">
          <b>复制为图片</b><span>生成 PNG 长图并写入剪贴板，可直接粘进聊天窗口</span>
        </button>
        <button class="share-card" onclick="exportConversationImage()">
          <b>导出 PNG</b><span>下载一张长图，适合存档、打印或邮件发送</span>
        </button>
        <button class="share-card" onclick="copyShareLink()"${saved ? "" : " disabled"}>
          <b>生成分享链接</b><span>${saved ? "免登录只读查看，30 天内有效、可随时撤销" : "会话保存到后端后才能生成链接"}</span>
        </button>
        <button class="share-card" onclick="closeModal();openMessagePicker()">
          <b>选择消息分享</b><span>逐条挑选要分享的消息，再决定图片或链接</span>
        </button>
      </div>
      <div class="share-preview" id="sharePreview"><div class="form-hint">正在生成预览…</div></div>
      <div class="share-note">
        <b>关于分享链接</b>
        <div>链接由后端公开分享接口生成（<code>POST /api/chat/conversations/{id}/shares</code>），形如
          <code>#/share/&lt;token&gt;</code>：<b>无需登录</b>即可只读查看，随机 token 只对应这一段会话，
          默认 30 天有效、可随时撤销；也可以只分享其中几条消息。</div>
      </div>
    </div>
  `, "affair-modal");

  try {
    const canvas = await conversationImage();
    const box = $("#sharePreview");
    if (!box || !canvas) return;
    const img = document.createElement("img");
    img.alt = "对话图片预览";
    img.src = canvas.toDataURL("image/png");
    box.innerHTML = "";
    box.appendChild(img);
  } catch (e) {
    const box = $("#sharePreview");
    if (box) box.innerHTML = `<div class="form-hint is-error">预览生成失败：${escapeHtml(e.message || "未知错误")}</div>`;
  }
}

/** 从头部“选择消息分享”进入多选：默认不选中，给出提示。 */
function openMessagePicker() {
  const nodes = $$(".qa-chat-body .msg");
  if (!nodes.length) { toast("当前会话还没有消息", "warn"); return; }
  shareSelect.active = true;
  shareSelect.ids.clear();
  document.querySelector(".qa-layout")?.classList.add("is-selecting");
  syncMsgSelection();
  toast("点选要分享的消息，再选择分享方式", "info");
}

window.openShareDialog = openShareDialog;
window.openMessagePicker = openMessagePicker;
window.copyConversationImage = copyConversationImage;
window.exportConversationImage = exportConversationImage;
window.copyShareLink = copyShareLink;
window.copyConversationText = copyConversationText;
window.exitShareSelect = exitShareSelect;

/** 解析 #/route?k=v，供深链与路由复用。 */
function parseHashRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [route, qs] = raw.split("?");
  return { route: route || "", params: new URLSearchParams(qs || "") };
}

/** 深链入口：#/qa?conversation=<id> → 打开问答页并载入该会话。 */
function applyDeepLink() {
  const { route, params } = parseHashRoute();
  const id = Number(params.get("conversation"));
  if (!id || !ROUTES[route]) return false;
  if (route !== "qa") return false;
  openConversation(id);
  return true;
}

/* ============================================================
   公开分享页：#/share/<token>
   后端 token 即凭证，访客无需登录；只读展示被分享的消息，
   同样支持复制/导出图片（数据来自分享响应，不依赖登录态）。
   ============================================================ */
function isShareHash() { return /^#\/share\//.test(location.hash); }

function shareTokenFromHash() {
  const m = location.hash.match(/^#\/share\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : "";
}

/** 把后端分享响应转成图片渲染器用的消息列表。 */
function sharedTranscript(payload) {
  return (payload?.messages || []).map(m => {
    const isUser = String(m.role).toUpperCase() === "USER";
    const sources = m.response?.sources || [];
    return {
      role: isUser ? "user" : "bot",
      text: m.content || "",
      guideText: !isUser ? guideShareText(m.response) : '',
      cites: isUser ? [] : sources.map(s => (s?.pageNumber != null
        ? `${s.fileName || s.documentId || "来源"} p.${s.pageNumber}`
        : String(s?.fileName || s?.documentId || "来源"))),
      type: isUser ? "" : (m.response?.type || ""),
      time: m.createdAt || ""
    };
  }).filter(m => m.text);
}

function hidePublicShare() {
  const screen = $("#shareScreen");
  if (screen) screen.hidden = true;
  if (document.body.dataset.auth === "share") document.body.dataset.auth = currentUser ? "in" : "pending";
}

async function exitPublicShare() {
  hidePublicShare();
  history.replaceState(null, '', location.pathname);
  try {
    currentUser = mapUser(await apiGet('/api/auth/me'));
    currentUser.mustChangePassword ? showChangePassword() : enterApp();
  } catch { currentUser = null; showLogin(); }
}

function publicShareHTML(payload, msgs) {
  const created = fmtMsgTime(payload.createdAt);
  const expires = payload.expiresAt ? new Date(payload.expiresAt).toLocaleDateString("zh-CN") : "长期有效";
  const count = msgs.length;
  const subset = (payload.messageIds || []).length > 0;
  return `
    <div class="share-page">
      <header class="share-page-head">
        <div class="share-brand">
          <span class="share-brand-mark">✦</span>
          <div><b>CampusAgent</b><span>公开分享的问答记录</span></div>
        </div>
        <div class="share-page-actions">
          <button class="btn btn-sm" id="sharePageCopyImg">复制为图片</button>
          <button class="btn btn-sm btn-primary" id="sharePageExportImg">导出图片</button>
          <button class="btn btn-sm btn-ghost" onclick="exitPublicShare()">返回应用</button>
        </div>
      </header>
      <div class="share-page-meta">
        <h1>${escapeHtml(payload.title || "校园政策问答")}</h1>
        <div class="share-page-sub">
          ${subset ? `分享其中 ${count} 条消息` : `共 ${count} 条消息`} · 分享于 ${escapeHtml(created || "-")}
          · 浏览 ${payload.viewCount ?? 1} 次 · ${escapeHtml(expires)}
        </div>
      </div>
      <div class="share-page-body" id="sharePageBody">
        ${msgs.map((m, i) => {
          const raw = payload.messages[i] || {};
          if (m.role === "user") {
            return `<div class="msg user"><div class="msg-bubble">${escapeHtml(m.text).replace(/\n/g, "<br/>")}</div></div>`;
          }
          const response = raw.response || {};
          return `<div class="msg bot" data-sources="${escAttr(JSON.stringify(response.sources || []))}">
            ${renderChatTurn({ ...response, answer: m.text, sources: response.sources || [] }, { readOnly: true })}
          </div>`;
        }).join("")}
      </div>
      <footer class="share-page-foot">
        <span>此页为只读分享，内容来自问答记录；回答仅依据已索引的现行政策，事实性内容附原文引用。</span>
        <a class="link-btn" href="${escAttr(`${location.origin}${location.pathname}`)}">打开 CampusAgent</a>
      </footer>
    </div>`;
}

async function renderPublicShare(token) {
  const screen = $("#shareScreen");
  const shell = $("#shareShell");
  if (!screen || !shell) return false;
  screen.hidden = false;
  document.body.dataset.auth = "share";   // 遮住登录页与应用外壳，无需登录
  shell.innerHTML = `
    <div class="share-page">
      <header class="share-page-head">
        <div class="share-brand"><span class="share-brand-mark">✦</span><div><b>CampusAgent</b><span>公开分享的问答记录</span></div></div>
        <button class="btn btn-sm btn-ghost" onclick="exitPublicShare()">返回应用</button>
      </header>
      <div class="panel-state"><div class="ps-ico">◷</div><div>正在加载分享内容…</div></div>
    </div>`;
  try {
    const payload = await apiGet(`/api/share/chat/${encodeURIComponent(token)}`);
    const msgs = sharedTranscript(payload);
    shell.innerHTML = publicShareHTML(payload, msgs);
    window.CampusGuide.mount(shell);
    $("#sharePageCopyImg")?.addEventListener("click", () => copyConversationImage(msgs));
    $("#sharePageExportImg")?.addEventListener("click", () => exportConversationImage(msgs));
    $$(".share-page-body .cite-chip").forEach(chip => {
      chip.addEventListener("click", () => showSourceCite(Number(chip.dataset.citeIndex), chip.closest(".msg")));
    });
    return true;
  } catch (e) {
    shell.innerHTML = `
      <div class="share-page">
        <header class="share-page-head">
          <div class="share-brand"><span class="share-brand-mark">✦</span><div><b>CampusAgent</b><span>公开分享的问答记录</span></div></div>
          <button class="btn btn-sm btn-ghost" onclick="exitPublicShare()">返回应用</button>
        </header>
        <div class="panel-state is-error">
          <div class="ps-ico">✕</div>
          <div>${escapeHtml(e.message || "分享内容加载失败")}</div>
          <div class="ps-hint">链接可能已被撤销或超过有效期；如果你是自己分享的，可以在问答页重新生成一条。</div>
        </div>
      </div>`;
    return true;
  }
}
window.exitPublicShare = exitPublicShare;

/* ============================================================
   工作台交互：查看申请详情（学生看自己的，管理员看全部）
   后端：GET /api/student/applications/{id}  或  GET /api/admin/applications/{id}
         → ApplicationDetail{ application, attachments[], events[] }
   ============================================================ */
async function showApplicationDetail(id, adminView = false) {
  openModal(`
    <div class="detail-head">
      <div><h2>加载中…</h2>
        <div style="font-size:12.5px;color:var(--text-3);margin-top:6px">正在获取申请详情</div></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body"><div style="text-align:center;padding:30px;color:var(--text-3)">请稍候…</div></div>
  `, "affair-modal");
  try {
    const path = adminView ? `/api/admin/applications/${id}` : `/api/student/applications/${id}`;
    const data = await apiGet(path);
    const a = data?.application || {};
    const attachments = data?.attachments || [];
    const events = data?.events || [];
    const fileBase = adminView ? "/api/admin/files" : "/api/files";
    openModal(`
      <div class="detail-head">
        <div>
          <h2>${escapeHtml(a.serviceName || "办理申请")}</h2>
          <div style="font-size:12.5px;color:var(--text-3);margin-top:6px">
            ${escapeHtml(a.applicationNo || "")} · 提交于 ${fmtTime(a.submittedAt)}
          </div>
        </div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="detail-body">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          ${statusTag(a.status)}
          <span class="tag tag-info"><span class="tag-dot"></span>版本 v${a.version ?? 1}</span>
          ${a.completedAt ? `<span class="tag tag-violet"><span class="tag-dot"></span>完成于 ${fmtTime(a.completedAt)}</span>` : ""}
        </div>

        <div class="detail-section">
          <h4>申请人</h4>
          <div style="font-size:13px;color:var(--text-2);line-height:1.9">
            ${escapeHtml(a.applicantName || a.username || "-")}
            ${a.studentNo ? ` · 学号 ${escapeHtml(a.studentNo)}` : ""}
          </div>
        </div>

        <div class="detail-section">
          <h4>申请说明</h4>
          <div style="font-size:13px;color:var(--text-2);line-height:1.8">${escapeHtml(a.studentRemark || "（未填写）")}</div>
        </div>

        ${a.adminRemark ? `
        <div class="detail-section">
          <h4>审核意见</h4>
          <div style="font-size:13px;color:var(--text-2);line-height:1.8">${escapeHtml(a.adminRemark)}</div>
        </div>` : ""}

        <div class="detail-section">
          <h4>附件（${attachments.length}）</h4>
          ${attachments.length
            ? attachments.map(f => `
                <div class="list-item" style="padding:10px 0">
                  <div class="li-ico">▤</div>
                  <div class="li-body">
                    <div class="li-title">${escapeHtml(f.filename || "-")}</div>
                    <div class="li-meta">${Math.max(1, Math.round((f.fileSize || 0) / 1024))} KB · ${fmtTime(f.uploadedAt)}</div>
                  </div>
                  <a class="btn btn-sm" href="${API_BASE}${fileBase}/${f.id}/download" target="_blank" rel="noopener">下载</a>
                </div>`).join("")
            : `<div style="font-size:12.5px;color:var(--text-3)">本次申请没有上传附件</div>`}
        </div>

        <div class="detail-section">
          <h4>办理轨迹（${events.length}）</h4>
          ${events.length
            ? events.map(ev => `
                <div class="step-line-item">
                  <div class="step-num">•</div>
                  <div>
                    <div style="font-size:13px">
                      ${ev.fromStatus ? `${escapeHtml(ev.fromStatus)} → ` : ""}<b>${escapeHtml(ev.toStatus || "-")}</b>
                    </div>
                    <div style="font-size:11.5px;color:var(--text-3);margin-top:3px">
                      ${escapeHtml(ev.actorName || "-")}${ev.actorRole ? `（${escapeHtml(ev.actorRole)}）` : ""} · ${fmtTime(ev.createdAt)}
                    </div>
                    ${ev.remark ? `<div style="font-size:12.5px;color:var(--text-2);margin-top:6px">${escapeHtml(ev.remark)}</div>` : ""}
                  </div>
                </div>`).join("")
            : `<div style="font-size:12.5px;color:var(--text-3)">暂无流转记录</div>`}
        </div>
      </div>
    `, "affair-modal");
  } catch (e) {
    openModal(`
      <div class="detail-head">
        <div><h2>无法打开申请详情</h2></div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="detail-body">
        <div class="panel-state is-error"><div class="ps-ico">✕</div><div>${escapeHtml(e.message || "加载失败")}</div></div>
      </div>
    `, "affair-modal");
  }
}
window.showApplicationDetail = showApplicationDetail;

/* ============================================================
   工作台交互：我的申请（全部记录）
   后端：GET /api/student/applications?page=&pageSize=&status=
         → ApplicationDetail.Page{ items[], total, page, pageSize }
   ============================================================ */
async function openMyApplications() {
  openModal(`
    <div class="detail-head">
      <div><h2>我的申请</h2>
        <div style="font-size:12.5px;color:var(--text-3);margin-top:6px">正在获取申请记录</div></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body"><div style="text-align:center;padding:30px;color:var(--text-3)">请稍候…</div></div>
  `, "affair-modal");
  try {
    const data = await apiGet("/api/student/applications?page=1&pageSize=20");
    const items = data?.items || [];
    const total = data?.total ?? items.length;
    openModal(`
      <div class="detail-head">
        <div><h2>我的申请</h2>
          <div style="font-size:12.5px;color:var(--text-3);margin-top:6px">共 ${total} 条记录</div></div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="detail-body">
        ${!items.length
          ? panelState("⎘", "还没有申请记录", `可在 <span class="link-btn" onclick="closeModal();navigate('affairs')">办事引导</span> 查看事项的办理条件、步骤与材料清单。`)
          : items.map(a => `
              <div class="list-item wb-row" onclick="showApplicationDetail(${a.id})">
                <div class="li-ico">⎘</div>
                <div class="li-body">
                  <div class="li-title">${escapeHtml(a.serviceName || "事项")}</div>
                  <div class="li-meta">${escapeHtml(a.applicationNo || "")} · 提交于 ${fmtTime(a.submittedAt)}${a.updatedAt ? ` · 更新 ${relTime(a.updatedAt)}` : ""}</div>
                </div>
                <div class="wb-meta-right">${statusTag(a.status)}</div>
              </div>`).join("")}
      </div>
    `, "affair-modal");
  } catch (e) {
    openModal(`
      <div class="detail-head">
        <div><h2>无法获取申请记录</h2></div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="detail-body">
        <div class="panel-state is-error"><div class="ps-ico">✕</div><div>${escapeHtml(e.message || "加载失败")}</div></div>
      </div>
    `, "affair-modal");
  }
}
window.openMyApplications = openMyApplications;

/* ============================================================
   视图：政策检索（对接 /api/knowledge/search）
   ============================================================ */
function renderSearch(vp) {
  vp.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">政策检索</div>
        <div class="page-desc">基于向量与关键词混合检索，返回知识库中的相关片段</div>
      </div>
    </div>

    <div class="search-bar">
      <input class="input" id="searchInput" placeholder="输入关键词，例如：奖学金、学生证、转专业…" />
      <button class="btn btn-primary" onclick="doSearch()">⌕ 检索</button>
    </div>

    <div id="searchResults">
      <div class="empty-state"><div class="es-ico">⌕</div><div>输入关键词开始检索</div></div>
    </div>
  `;

  const input = $("#searchInput");
  input.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
}

async function doSearch() {
  const q = ($("#searchInput")?.value || "").trim();
  const box = $("#searchResults");
  if (!box) return;
  if (!q) {
    box.innerHTML = `<div class="empty-state"><div class="es-ico">⌕</div><div>输入关键词开始检索</div></div>`;
    return;
  }
  box.innerHTML = `<div class="empty-state"><div class="es-ico" style="animation:spin 2s linear infinite">⌕</div><div>正在检索知识库…</div></div>`;
  try {
    const data = await apiPost("/api/knowledge/search", { query: q, topK: 10 });
    const results = data?.results || [];
    if (!results.length) {
      box.innerHTML = `<div class="empty-state"><div class="es-ico">⌕</div><div>未找到匹配的政策片段</div></div>`;
      return;
    }
    box.innerHTML = results.map(r => `
      <div class="result-item">
        <div class="result-head">
          <div class="result-title">${highlight(escapeHtml(r.fileName || r.documentId || '未知文档'), escapeHtml(q))}</div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <span class="tag tag-info">rank #${r.rank}</span>
            <span class="tag tag-violet">score ${r.score?.toFixed?.(3) ?? r.score}</span>
          </div>
        </div>
        <div class="result-meta">
          <span>${escapeHtml(r.documentId || '-')}</span>
          <span>第 ${r.pageNumber ?? '-'} 页</span>
          <span>▦ chunk #${r.chunkIndex}</span>
          ${r.fileType ? `<span>${escapeHtml(r.fileType)}</span>` : ''}
        </div>
        <div class="result-snippet">${highlight(escapeHtml(r.content || ''), escapeHtml(q))}</div>
      </div>
    `).join("");
  } catch (e) {
    box.innerHTML = `<div class="empty-state"><div class="es-ico" style="color:var(--danger)">✕</div><div>${escapeHtml(e.message || '检索失败')}</div></div>
      ${e.hint ? `<div class="err-hint" style="max-width:760px;margin:0 auto"><b>可能原因与排查</b><div>${escapeHtml(e.hint)}</div></div>` : ""}`;
  }
}
window.doSearch = doSearch;

function highlight(text, q) {
  if (!q) return text;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return text.replace(re, "<mark>$1</mark>");
}

/* ============================================================
   视图：办事引导（对接 /api/services）
   ============================================================ */
async function renderAffairs(vp) {
  vp.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">办事引导</div>
        <div class="page-desc">结构化事项数据：办理条件、步骤、材料清单与责任部门（对应 /api/services）</div>
      </div>
      <button class="btn btn-sm" onclick="renderAffairs(document.getElementById('viewport'))">⟳ 刷新</button>
    </div>

    <div class="recognize-bar">
      <input class="input" id="recognizeInput" placeholder="用一句话描述你要办的事，例如「学生证丢了怎么补办」" />
      <button class="btn btn-primary" onclick="recognizeService()">✦ 识别事项</button>
    </div>
    <div id="recognizeResult"></div>

    <div class="grid grid-3" id="affairGrid" style="margin-top:18px">
      <div class="empty-state"><div class="es-ico" style="animation:spin 2s linear infinite">▤</div><div>正在加载事项列表…</div></div>
    </div>
  `;
  const input = $("#recognizeInput");
  input?.addEventListener("keydown", e => { if (e.key === "Enter") recognizeService(); });
  try {
    const items = await apiGet("/api/services");
    const grid = $("#affairGrid");
    if (!items || !items.length) {
      grid.innerHTML = `<div class="empty-state"><div class="es-ico">▤</div><div>暂无启用中的办事事项</div>
        <div class="form-hint">事项需要管理员在「事项管理」中创建并置为 ACTIVE，才会计入 /api/services 的返回。</div></div>`;
      return;
    }
    const palette = [
      "linear-gradient(135deg,#e8c98a,#f0b35e)",
      "linear-gradient(135deg,#6fc3ff,#6d8bff)",
      "linear-gradient(135deg,#5fd4a8,#6fc3ff)",
      "linear-gradient(135deg,#9b7cff,#6d8bff)",
      "linear-gradient(135deg,#f0b35e,#f07680)",
      "linear-gradient(135deg,#6d8bff,#5fd4a8)"
    ];
    const icons = ["◈", "▤", "⌂", "◐", "◍", "⌖"];
    grid.innerHTML = items.map((a, i) => {
      const reqCount = (a.requirements || []).length;
      const materials = a.materials || [];
      const requiredCount = materials.filter(m => m.required).length;
      return `
        <div class="affair-card" onclick="showAffair(${a.id})">
          <div class="ac-ico" style="background:${palette[i % palette.length]}22">${icons[i % icons.length]}</div>
          <h3>${escapeHtml(a.name)}</h3>
          <div class="ac-desc">${escapeHtml(a.description || '')}</div>
          <div class="ac-tags">
            ${a.category ? `<span class="tag tag-info" style="font-size:10px">${escapeHtml(a.category)}</span>` : ""}
            <span class="tag tag-violet" style="font-size:10px">${reqCount} 项条件</span>
            <span class="tag tag-active" style="font-size:10px">${materials.length} 项材料</span>
            ${a.isExample ? `<span class="tag tag-draft" style="font-size:10px">示例数据</span>` : ""}
          </div>
          <div class="ac-foot">${escapeHtml(a.department || '责任部门未配置')}${a.deadline ? ` · 截止 ${escapeHtml(a.deadline)}` : ""}${requiredCount ? ` · 必交 ${requiredCount} 项` : ""}</div>
        </div>
      `;
    }).join("");
  } catch (e) {
    $("#affairGrid").innerHTML = `<div class="empty-state"><div class="es-ico" style="color:var(--danger)">✕</div><div>${escapeHtml(e.message || '加载失败')}</div></div>`;
  }
}

/* ---------- 事项智能识别（POST /api/services/recognize） ---------- */
async function recognizeService() {
  const q = ($("#recognizeInput")?.value || "").trim();
  const box = $("#recognizeResult");
  if (!box) return;
  if (!q) { box.innerHTML = `<div class="form-hint">请先输入一句描述。</div>`; return; }
  box.innerHTML = `<div class="form-hint">正在识别事项…</div>`;
  try {
    const r = await apiPost("/api/services/recognize", { query: q });
    if (!r?.matched) {
      box.innerHTML = `<div class="inline-warn">未匹配到具体事项（queryIntent=${escapeHtml(r?.queryIntent || "GENERAL_QA")}）。
        可到 <span class="link-btn" onclick="navigate('qa')">智能问答</span> 用自然语言提问，或直接在下方的启用事项中选择。</div>`;
      return;
    }
    const pct = r.confidence != null ? ` · 置信度 ${(r.confidence * 100).toFixed(0)}%` : "";
    box.innerHTML = `
      <div class="recognize-hit">
        <div>
          <b>${escapeHtml(r.serviceName || r.serviceCode || "匹配事项")}</b>
          <span class="brief-meta">意图 ${escapeHtml(r.queryIntent || "-")}${pct}</span>
        </div>
        <button class="btn btn-sm btn-primary" onclick="openServiceByCode('${escAttr(r.serviceCode || "")}')">查看办理要求</button>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div class="inline-warn">识别失败：${escapeHtml(e.message || "")}</div>`;
  }
}
window.recognizeService = recognizeService;
window.renderAffairs = renderAffairs;

/** recognize 只返回 code/name，这里按 code 在已启用事项里定位后打开详情。 */
async function openServiceByCode(code) {
  if (!code) return;
  try {
    const items = await apiGet("/api/services");
    const hit = (items || []).find(s => s.code === code);
    if (hit) showAffair(hit.id);
    else toast("该事项当前未启用，无法查看详情", "warn");
  } catch (e) {
    toast(e.message || "加载失败", "error");
  }
}
window.openServiceByCode = openServiceByCode;

async function showAffair(id) {
  openModal(`
    <div class="detail-head">
      <div>
        <h2>加载中…</h2>
        <div style="font-size:12.5px;color:var(--text-3);margin-top:6px">正在获取事项详情</div>
      </div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body"><div style="text-align:center;padding:30px;color:var(--text-3)">请稍候…</div></div>
  `, "affair-modal");
  try {
    const data = await apiGet(`/api/services/${id}`);
    const s = data?.service || {};
    const steps = data?.steps || [];
    const materials = s.materials || [];
    openModal(`
      <div class="detail-head">
        <div>
          <h2>${escapeHtml(s.name || '事项详情')}</h2>
          <div style="font-size:12.5px;color:var(--text-3);margin-top:6px">${escapeHtml(s.department || '-')} · ${escapeHtml(s.deadline || '具体见通知')}</div>
        </div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="detail-body">
        <div class="detail-section">
          <h4>事项说明</h4>
          <div style="font-size:13px;color:var(--text-2);line-height:1.8">${escapeHtml(s.description || '')}</div>
          ${s.location ? `<div style="font-size:12px;color:var(--text-3);margin-top:8px">${escapeHtml(s.location)} · ${escapeHtml(s.officeHours || '')}</div>` : ''}
        </div>
        ${steps.length ? `
        <div class="detail-section">
          <h4>办理步骤（${steps.length} 步）</h4>
          ${steps.map((st, i) => `
            <div class="step-line-item">
              <div class="step-num">${st.order || i + 1}</div>
              <div class="step-content">
                <h5>${escapeHtml(st.title || '')}</h5>
                <p>${escapeHtml(st.description || '')}</p>
                ${st.responsibleDepartment ? `<div style="font-size:11.5px;color:var(--text-3);margin-top:4px">责任部门：${escapeHtml(st.responsibleDepartment)}</div>` : ''}
                ${st.estimatedTime ? `<div style="font-size:11.5px;color:var(--text-3)">预计耗时：${escapeHtml(st.estimatedTime)}</div>` : ''}
              </div>
            </div>
          `).join("")}
        </div>` : ''}
        ${materials.length ? `
        <div class="detail-section">
          <h4>材料清单（${materials.length}）</h4>
          <div class="material-list">
            ${materials.map(m => `
              <div class="material-item" onclick="this.classList.toggle('checked')">
                <div class="m-check">✓</div>
                <div class="m-name">${escapeHtml(m.name || '')}${m.required ? ' <span class="req">必交</span>' : ' <span class="opt">选交</span>'}</div>
                <div class="m-note">${escapeHtml(m.description || '')}</div>
                ${m.attachment ? `<a class="link-btn" href="${API_BASE}/api/files/${m.attachment.id}/download" target="_blank" rel="noopener" onclick="event.stopPropagation()">下载模板</a>` : ''}
              </div>
            `).join("")}
          </div>
        </div>` : ''}
        <div class="msvc-actions">
          ${!isAdmin() ? `<button class="btn btn-primary" onclick="closeModal();openNewApplication(${s.id})">⎘ 提交办理申请</button>` : ""}
          <button class="btn" onclick="closeModal();navigate('qa')">✦ 就此事咨询</button>
          ${s.sourceDocumentId ? `<a class="btn" href="${API_BASE}/api/services/${id}/source" target="_blank" rel="noopener">下载来源文件</a>` : ''}
          ${s.sourceUrl ? `<a class="btn" href="${escAttr(s.sourceUrl)}" target="_blank" rel="noopener">政策链接</a>` : ''}
        </div>
      </div>
    `, "affair-modal");
  } catch (e) {
    openModal(`
      <div class="detail-head">
        <div><h2>加载失败</h2></div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="detail-body"><div style="color:var(--danger)">${escapeHtml(e.message || '获取事项详情失败')}</div></div>
    `, "affair-modal");
  }
}
window.showAffair = showAffair;

/* ============================================================
   视图：政策管理（对接 /api/admin/documents）
   ============================================================ */
async function renderPolicyMgr(vp) {
  const canUpload = can("policyUpload");
  const canRebuild = can("policyRebuild");
  const canDelete = can("policyDelete");
  vp.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">政策管理</div>
        <div class="page-desc">文档导入、元数据维护、版本生命周期与索引更新</div>
      </div>
      ${canUpload
        ? `<button class="btn btn-primary" onclick="document.getElementById('policyUploadInput').click()">＋ 上传新政策</button>`
        : `<span class="disabled-note">无上传权限</span>`}
    </div>

    ${canUpload
      ? `<input type="file" id="policyUploadInput" accept=".pdf,.docx,.txt,.md,.xlsx,.pptx,.png,.jpg,.jpeg" style="display:none" />
         <div class="upload-zone" onclick="document.getElementById('policyUploadInput').click()">
          <div class="up-ico">⇪</div>
          <h4>拖拽政策文件到此处，或点击选择文件</h4>
          <p>支持 PDF/DOCX/TXT/MD/XLSX/PPTX/PNG/JPG，单文件不超过 ${dashboardStats.maxUploadMb || 20}MB</p>
        </div>`
      : `<div class="card" style="text-align:center;color:var(--text-3);padding:36px">
          <div style="font-size:32px;margin-bottom:10px">▥</div>
          <div style="font-size:13px">仅 <b style="color:var(--text-2)">管理员</b> 可上传政策文档</div>
        </div>`
    }

    <div class="mgr-toolbar" style="margin-top:24px">
      <div style="font-size:14px;font-weight:600">文档版本列表</div>
      <div style="display:flex;gap:8px" id="policyStatusTags">
        <span class="tag tag-active"><span class="tag-dot"></span>加载中…</span>
      </div>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <table class="table">
        <thead>
          <tr>
            <th>文档ID</th><th>文件名</th><th>类型</th><th>状态</th><th>分块数</th><th>创建时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody id="policyTableBody">
          <tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-3)">加载中…</td></tr>
        </tbody>
      </table>
    </div>
  `;

  if (canUpload) {
    const fileInput = $("#policyUploadInput");
    if (fileInput) fileInput.addEventListener("change", handlePolicyUpload);
    // 拖拽支持
    const zone = $(".upload-zone");
    if (zone) {
      zone.addEventListener("dragover", e => { e.preventDefault(); zone.style.borderColor = "var(--primary)"; });
      zone.addEventListener("dragleave", () => { zone.style.borderColor = ""; });
      zone.addEventListener("drop", e => {
        e.preventDefault(); zone.style.borderColor = "";
        if (e.dataTransfer.files.length) {
          fileInput.files = e.dataTransfer.files;
          handlePolicyUpload();
        }
      });
    }
  }

  // 加载文档列表
  if (canUpload || can("policyRebuild")) {
    loadPolicyList();
  } else {
    $("#policyTableBody").innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-3)">当前角色无查看权限</td></tr>`;
    $("#policyStatusTags").innerHTML = `<span class="disabled-note">无权限</span>`;
  }
}

async function loadPolicyList() {
  try {
    const data = await apiGet("/api/admin/documents?page=1&pageSize=50");
    const items = data?.items || [];
    const total = data?.total || 0;
    const tbody = $("#policyTableBody");
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-3)">暂无文档，请上传政策文件</td></tr>`;
      $("#policyStatusTags").innerHTML = `<span class="tag tag-info">共 0 份</span>`;
      return;
    }
    const success = items.filter(d => d.status === "SUCCESS").length;
    const processing = items.filter(d => d.status === "PROCESSING").length;
    const failed = items.filter(d => d.status === "FAILED").length;
    $("#policyStatusTags").innerHTML = `
      <span class="tag tag-active"><span class="tag-dot"></span>已索引 ${success}</span>
      <span class="tag tag-draft"><span class="tag-dot"></span>处理中 ${processing}</span>
      <span class="tag tag-expired"><span class="tag-dot"></span>失败 ${failed}</span>
      <span class="tag tag-info">共 ${total}</span>
    `;
    tbody.innerHTML = items.map(d => `
      <tr>
        <td style="color:var(--text-3);font-family:monospace;font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(d.id)}">${escapeHtml(d.id?.slice(0, 8))}…</td>
        <td style="font-weight:500">${escapeHtml(d.displayName || d.originalFilename || '')}</td>
        <td><span class="tag tag-info">${escapeHtml(d.fileType || '-')}</span></td>
        <td>${statusTag(d.status)}</td>
        <td style="color:var(--text-2)">${d.chunkCount || 0}</td>
        <td style="color:var(--text-3);font-size:12px">${d.createdAt ? new Date(d.createdAt).toLocaleString('zh-CN') : '-'}</td>
        <td>
          <button class="btn btn-sm" onclick="showPolicyDetail('${d.id}')">查看</button>
          ${can("policyRebuild") ? `<button class="btn btn-sm" onclick="renamePolicy('${d.id}')" style="margin-left:6px">重命名</button>` : ''}
          ${can("policyRebuild") ? `<button class="btn btn-sm" onclick="reprocessPolicy('${d.id}')" style="margin-left:6px" ${d.status === "PROCESSING" ? "disabled title='处理中，后端会返回 DOCUMENT_BUSY'" : ""}>重建索引</button>` : ''}
          ${can("policyDelete") ? `<button class="btn btn-sm" onclick="deletePolicy('${d.id}')" style="margin-left:6px;color:var(--danger)">删除</button>` : ''}
        </td>
      </tr>
    `).join("");
  } catch (e) {
    $("#policyTableBody").innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--danger)">${escapeHtml(e.message || '加载失败')}</td></tr>`;
  }
}

async function handlePolicyUpload() {
  const input = $("#policyUploadInput");
  if (!input || !input.files.length) return;
  const file = input.files[0];
  const formData = new FormData();
  formData.append("file", file);
  toast(`正在上传 ${file.name}…`, "info");
  try {
    const result = await apiUpload("/api/admin/documents", formData);
    if (result?.duplicate) {
      toast("文件已存在，跳过上传", "warn");
    } else {
      toast("上传成功，正在解析", "success");
    }
    input.value = "";
    loadPolicyList();
  } catch (e) {
    input.value = "";
    // 文档处理失败时给出可操作的排查建议（AI 服务未启动 / 缺 OCR 依赖 / 模型下载中等）
    openModal(`
      <div class="detail-head">
        <div><h2>文档上传或解析失败</h2><div class="head-sub">${escapeHtml(file.name)}</div></div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="detail-body">
        ${errorBlock(e.message, e.hint)}
      </div>
    `, "policy-modal");
  }
}

async function showPolicyDetail(id) {
  openModal(`
    <div class="detail-head">
      <div><h2>加载中…</h2></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body"><div style="text-align:center;padding:30px;color:var(--text-3)">请稍候…</div></div>
  `, "policy-modal");
  try {
    const d = await apiGet(`/api/admin/documents/${id}`);
    openModal(`
      <div class="detail-head">
        <div>
          <h2>${escapeHtml(d.displayName || d.originalFilename || '文档详情')}</h2>
          <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
            ${statusTag(d.status)}<span class="tag tag-info">${escapeHtml(d.fileType || '-')}</span>
          </div>
        </div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="detail-body">
        <div class="detail-section">
          <h4>元数据</h4>
          <div class="grid grid-2" style="gap:10px">
            <div style="font-size:13px"><span style="color:var(--text-3)">文档ID：</span><code>${escapeHtml(d.id)}</code></div>
            <div style="font-size:13px"><span style="color:var(--text-3)">原始文件名：</span>${escapeHtml(d.originalFilename || '-')}</div>
            <div style="font-size:13px"><span style="color:var(--text-3)">文件大小：</span>${(d.fileSize / 1024).toFixed(1)} KB</div>
            <div style="font-size:13px"><span style="color:var(--text-3)">分块数：</span>${d.chunkCount || 0}</div>
            <div style="font-size:13px"><span style="color:var(--text-3)">总页数：</span>${d.totalPages || 0}</div>
            <div style="font-size:13px"><span style="color:var(--text-3)">OCR 提供方：</span>${escapeHtml(d.ocrProvider || '-')}</div>
            <div style="font-size:13px"><span style="color:var(--text-3)">创建时间：</span>${d.createdAt ? new Date(d.createdAt).toLocaleString('zh-CN') : '-'}</div>
            <div style="font-size:13px"><span style="color:var(--text-3)">更新时间：</span>${d.updatedAt ? new Date(d.updatedAt).toLocaleString('zh-CN') : '-'}</div>
          </div>
        </div>
        ${d.errorMessage ? `<div class="detail-section"><h4>错误信息</h4><div style="font-size:13px;color:var(--danger)">${escapeHtml(d.errorMessage)}</div></div>` : ''}
        ${d.status === "PROCESSING" ? `<div class="detail-section"><h4>处理进度 <span class="label-note">轮询 /api/admin/documents/${escapeHtml(d.id)}/progress</span></h4>
          <div class="progress-track"><div class="progress-fill" id="docProgressFill" style="width:${d.progress || 0}%"></div></div>
          <div style="font-size:13px;color:var(--text-2);margin-top:8px" id="docProgressText">进度 ${d.progress || 0}% · 已处理 ${d.processedPages || 0}/${d.totalPages || 0} 页 · ${escapeHtml(d.parseStatus || "-")}</div>
          <div class="form-hint">页面每 3 秒轮询一次处理进度，完成后自动停止。</div>
        </div>` : ''}
        <div class="detail-section">
          <h4>操作</h4>
          <div class="msvc-actions">
            <button class="btn btn-sm" onclick="renamePolicy('${escapeHtml(d.id)}')">重命名</button>
            <button class="btn btn-sm" onclick="reprocessPolicy('${escapeHtml(d.id)}')">重建索引</button>
          </div>
          <div class="form-hint">重建索引会重新走「解析 → 清洗 → 切块 → Embedding → 入库」链路；处理中调用会被后端拒绝（DOCUMENT_BUSY）。</div>
        </div>
      </div>
    `, "policy-modal");
    if (d.status === "PROCESSING") pollDocumentProgress(d.id);
  } catch (e) {
    openModal(`
      <div class="detail-head"><div><h2>加载失败</h2></div><button class="icon-btn" onclick="closeModal()">✕</button></div>
      <div class="detail-body"><div style="color:var(--danger)">${escapeHtml(e.message || '获取详情失败')}</div></div>
    `, "policy-modal");
  }
}
window.showPolicyDetail = showPolicyDetail;

async function reprocessPolicy(id) {
  if (!confirm("确认重新解析该文档？")) return;
  toast("已提交重新解析任务", "info");
  try {
    await apiPost(`/api/admin/documents/${id}/reprocess`);
    toast("重新解析已开始", "success");
    loadPolicyList();
  } catch (e) {
    toast(e.message || "操作失败", "error");
  }
}
window.reprocessPolicy = reprocessPolicy;

async function deletePolicy(id) {
  if (!confirm("确认删除该文档？此操作不可恢复，向量索引也将一并清除。")) return;
  try {
    await apiDelete(`/api/admin/documents/${id}`);
    toast("文档已删除", "success");
    loadPolicyList();
  } catch (e) {
    toast(e.message || "删除失败", "error");
  }
}
window.deletePolicy = deletePolicy;

/* ---------- 重命名（PATCH /api/admin/documents/{id}/name） ---------- */
async function renamePolicy(id) {
  let current = "";
  try { current = (await apiGet(`/api/admin/documents/${id}`)).displayName || ""; } catch (e) { /* 用空初值 */ }
  openModal(`
    <div class="detail-head">
      <div><h2>重命名文档</h2><div class="head-sub">PATCH /api/admin/documents/${escapeHtml(id)}/name</div></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body">
      <div class="form-row">
        <label for="docNewName">显示名称 *</label>
        <input id="docNewName" class="input" value="${escAttr(current)}" maxlength="255" />
        <div class="form-hint">名称长度上限由后端校验（255）；处理中的文档不允许改名（DOCUMENT_BUSY）。</div>
      </div>
      <div class="auth-alert" id="renameErr" hidden></div>
      <div class="form-actions">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" id="renameOk">保存名称</button>
      </div>
    </div>
  `, "policy-modal");
  $("#renameOk").addEventListener("click", async () => {
    const err = $("#renameErr"), btn = $("#renameOk");
    const name = ($("#docNewName")?.value || "").trim();
    if (!name) { err.hidden = false; err.textContent = "名称不能为空"; return; }
    btn.disabled = true;
    btn.textContent = "保存中…";
    try {
      await apiPatch(`/api/admin/documents/${id}/name`, { name });
      closeModal();
      toast("文档名称已更新", "success");
      loadPolicyList();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "保存名称";
      err.hidden = false;
      err.textContent = e.message || "重命名失败";
    }
  });
}
window.renamePolicy = renamePolicy;

/* ---------- 处理进度轮询（GET /api/admin/documents/{id}/progress） ---------- */
let docPollTimer = null;
function pollDocumentProgress(id) {
  clearInterval(docPollTimer);
  docPollTimer = setInterval(async () => {
    const fill = $("#docProgressFill");
    if (!fill) { clearInterval(docPollTimer); docPollTimer = null; return; }
    try {
      const d = await apiGet(`/api/admin/documents/${id}/progress`);
      fill.style.width = `${d.progress || 0}%`;
      const text = $("#docProgressText");
      if (text) text.textContent = `进度 ${d.progress || 0}% · 已处理 ${d.processedPages || 0}/${d.totalPages || 0} 页 · ${d.parseStatus || "-"}`;
      if (d.status !== "PROCESSING") {
        clearInterval(docPollTimer);
        docPollTimer = null;
        toast(d.status === "SUCCESS" ? "文档解析完成，已建立索引" : `文档处理结束：${d.status}`, d.status === "SUCCESS" ? "success" : "warn");
        loadPolicyList();
      }
    } catch (e) {
      clearInterval(docPollTimer);
      docPollTimer = null;
    }
  }, 3000);
}
window.pollDocumentProgress = pollDocumentProgress;

/* ============================================================
   视图：审计追溯（使用 /api/admin/overview 统计 + MOCK 时间线）
   ============================================================ */
async function renderAudit(vp) {
  vp.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">审计追溯</div>
        <div class="page-desc">文档处理记录、申请办理留痕与问答证据快照，用于复核争议回答</div>
      </div>
      <button class="btn btn-sm" onclick="renderAudit(document.getElementById('viewport'))">⟳ 刷新</button>
    </div>

    <div class="inline-warn" style="margin-bottom:18px">
      后端目前<b>没有独立的审计查询接口</b>（campus-audit 模块只有领域模型，没有 Controller）。
      本页不展示任何虚构记录，全部数据来自以下真实接口：
      <code>/api/admin/overview</code>、<code>/api/admin/documents</code>、
      <code>/api/admin/applications</code>、<code>/api/chat/conversations</code>。
    </div>

    <div class="grid grid-4" style="margin-bottom:24px" id="auditStats">
      <div class="card" style="text-align:center"><div class="stat-label">总文档</div><div class="stat-value" id="auditTotal">-</div></div>
      <div class="card" style="text-align:center"><div class="stat-label">已索引</div><div class="stat-value" style="color:var(--success)" id="auditSuccess">-</div></div>
      <div class="card" style="text-align:center"><div class="stat-label">处理中</div><div class="stat-value" style="color:var(--warn)" id="auditProcessing">-</div></div>
      <div class="card" style="text-align:center"><div class="stat-label">处理失败</div><div class="stat-value" style="color:var(--danger)" id="auditFailed">-</div></div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="panel-head">
        <h3>文档处理记录</h3>
        <span class="panel-hint">来源 /api/admin/documents · 失败原因与分块数可复核</span>
      </div>
      <div style="overflow-x:auto">
        <table class="table">
          <thead><tr><th>文档</th><th>状态</th><th>分块</th><th>页数</th><th>OCR</th><th>创建时间</th><th>错误</th></tr></thead>
          <tbody id="auditDocs"><tr><td colspan="7" class="table-empty">加载中…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="panel-head">
        <h3>申请办理留痕</h3>
        <span class="panel-hint">来源 /api/admin/applications · 点击查看流转事件</span>
      </div>
      <div style="overflow-x:auto">
        <table class="table">
          <thead><tr><th>申请编号</th><th>事项</th><th>申请人</th><th>状态</th><th>版本</th><th>提交时间</th><th>操作</th></tr></thead>
          <tbody id="auditApps"><tr><td colspan="7" class="table-empty">加载中…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="panel-head">
        <h3>问答证据快照</h3>
        <span class="panel-hint">来源 /api/chat/conversations（后端按登录用户隔离，仅显示本人会话）</span>
      </div>
      <div id="auditConvs"><div class="table-empty">加载中…</div></div>
    </div>
  `;

  // 统计
  try {
    const o = await apiGet("/api/admin/overview");
    $("#auditTotal").textContent = o?.total ?? 0;
    $("#auditSuccess").textContent = o?.success ?? 0;
    $("#auditProcessing").textContent = o?.processing ?? 0;
    $("#auditFailed").textContent = o?.failed ?? 0;
  } catch (e) {
    ["#auditTotal", "#auditSuccess", "#auditProcessing", "#auditFailed"].forEach(s => { const el = $(s); if (el) el.textContent = "✕"; });
  }

  // 文档处理记录
  try {
    const data = await apiGet("/api/admin/documents?page=1&pageSize=20");
    const items = data?.items || [];
    $("#auditDocs").innerHTML = items.length ? items.map(d => `
      <tr>
        <td><span class="link-btn" onclick="showPolicyDetail('${escAttr(d.id)}')">${escapeHtml(d.displayName || d.originalFilename || d.id)}</span></td>
        <td>${statusTag(d.status)}</td>
        <td class="mono">${d.chunkCount || 0}</td>
        <td class="mono">${d.processedPages || 0}/${d.totalPages || 0}</td>
        <td class="mono">${escapeHtml(d.ocrProvider || "-")}</td>
        <td class="mono">${fmtTime(d.createdAt)}</td>
        <td>${d.errorMessage ? `<span style="color:var(--danger);font-size:12px">${escapeHtml(d.errorMessage)}</span>` : "-"}</td>
      </tr>`).join("") : `<tr><td colspan="7" class="table-empty">还没有导入任何政策文档</td></tr>`;
  } catch (e) {
    $("#auditDocs").innerHTML = `<tr><td colspan="7" class="table-empty is-error">✕ ${escapeHtml(e.message || "加载失败")}</td></tr>`;
  }

  // 申请办理留痕
  try {
    const data = await apiGet("/api/admin/applications?page=1&pageSize=20");
    const items = data?.items || [];
    $("#auditApps").innerHTML = items.length ? items.map(a => `
      <tr>
        <td class="mono">${escapeHtml(a.applicationNo || "-")}</td>
        <td>${escapeHtml(a.serviceName || "-")}</td>
        <td>${escapeHtml(a.applicantName || a.username || "-")}</td>
        <td>${statusTag(a.status)}</td>
        <td class="mono">v${a.version ?? 1}</td>
        <td class="mono">${fmtTime(a.submittedAt)}</td>
        <td><button class="btn btn-sm" onclick="showApplicationDetail(${a.id}, true)">流转记录</button></td>
      </tr>`).join("") : `<tr><td colspan="7" class="table-empty">还没有申请记录</td></tr>`;
  } catch (e) {
    $("#auditApps").innerHTML = `<tr><td colspan="7" class="table-empty is-error">✕ ${escapeHtml(e.message || "加载失败")}</td></tr>`;
  }

  // 问答证据快照
  try {
    const convs = await apiGet("/api/chat/conversations");
    $("#auditConvs").innerHTML = convs.length ? convs.map(c => `
      <div class="list-item wb-row" onclick="showConversationEvidence(${c.id})">
        <div class="li-ico">✦</div>
        <div class="li-body">
          <div class="li-title">${escapeHtml(c.title || "未命名对话")}</div>
          <div class="li-meta">创建 ${fmtTime(c.createdAt)} · 更新 ${relTime(c.updatedAt)}</div>
        </div>
        <div class="wb-meta-right">查看证据 ›</div>
      </div>`).join("") : `<div class="table-empty">本人还没有问答会话</div>`;
  } catch (e) {
    $("#auditConvs").innerHTML = `<div class="table-empty is-error">✕ ${escapeHtml(e.message || "加载失败")}</div>`;
  }
}
window.renderAudit = renderAudit;

/* ---------- 问答证据快照：requestId + 引用元数据 ---------- */
async function showConversationEvidence(id) {
  openModal(`
    <div class="detail-head">
      <div><h2>问答证据</h2><div class="head-sub">GET /api/chat/conversations/${id}/messages</div></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body"><div style="text-align:center;padding:30px;color:var(--text-3)">请稍候…</div></div>
  `, "affair-modal wide-modal");
  try {
    const data = await apiGet(`/api/chat/conversations/${id}/messages`);
    const msgs = data?.messages || [];
    openModal(`
      <div class="detail-head">
        <div>
          <h2>问答证据快照</h2>
          <div class="head-sub">${msgs.length} 条消息${data?.pending ? " · 有一条回答正在生成" : ""} · 引用内容由后端截断至 400 字并去除打分</div>
        </div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="detail-body">
        ${!msgs.length ? `<div class="table-empty">该会话没有消息</div>` : msgs.map(m => {
          const isUser = String(m.role).toUpperCase() === "USER";
          const resp = m.response || {};
          const sources = resp.sources || [];
          return `
            <div class="evidence-item ${isUser ? "is-user" : ""}">
              <div class="ev-head">
                <span class="tag ${isUser ? "tag-info" : "tag-active"}" style="font-size:10px">${escapeHtml(m.role)}</span>
                <span class="mono">requestId=${escapeHtml(m.requestId || "-")}</span>
                <span class="mono">${fmtTime(m.createdAt)}</span>
                ${resp.type ? `<span class="tag tag-violet" style="font-size:10px">${escapeHtml(resp.type)}</span>` : ""}
                ${resp.queryIntent ? `<span class="tag tag-violet" style="font-size:10px">${escapeHtml(resp.queryIntent)}</span>` : ""}
              </div>
              <div class="pre-wrap">${escapeHtml(m.content || "")}</div>
              ${sources.length ? `<div class="ev-cites">${sources.map((s, i) =>
                `<span class="cite-chip">[${i + 1}] ${escapeHtml(s.fileName || s.documentId || "来源")} · p.${s.pageNumber ?? "-"} · chunk #${s.chunkIndex ?? "-"}</span>`).join("")}</div>` : ""}
              ${resp.service ? `<div class="ev-service">结构化返回：事项「${escapeHtml(resp.service.name || resp.service.code)}」· 步骤 ${(resp.steps || []).length} 条 · 材料 ${(resp.service.materials || []).length} 项</div>` : ""}
              ${resp.source?.documentId ? `<div class="ev-service">来源文档 ${escapeHtml(resp.source.documentId)}${resp.source.url ? ` · ${escAttr(resp.source.url)}` : ""}</div>` : ""}
            </div>`;
        }).join("")}
      </div>
    `, "affair-modal wide-modal");
  } catch (e) {
    openModal(modalError("无法获取问答证据", e.message), "affair-modal");
  }
}
window.showConversationEvidence = showConversationEvidence;

/* ============================================================
   视图：系统设置
   后端只提供两个只读配置接口：
     GET /api/admin/config                    → { maxUploadSizeMb }
     GET /api/admin/material-attachments/config → { maxUploadSizeMb, extensions[] }
   另有 GET /api/v1/health。其余“模型 / 向量库 / 策略开关”后端未提供读写接口，
   因此这里只做事实说明，不放可点击的假开关。
   ============================================================ */
async function renderSettings(vp) {
  vp.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">系统设置</div>
        <div class="page-desc">后端已暴露的只读配置与运行状态；未提供接口的项目一律标注说明</div>
      </div>
      <button class="btn btn-sm" onclick="renderSettings(document.getElementById('viewport'))">⟳ 重新读取</button>
    </div>

    <div class="setting-group">
      <h3>后端配置（只读）</h3>
      <div class="sg-desc">以下数值实时取自后端接口，前端不写死</div>
      <div id="cfgRows"><div class="table-empty">读取中…</div></div>
    </div>

    <div class="setting-group">
      <h3>运行状态</h3>
      <div class="sg-desc">GET /api/v1/health（仅代表 Java 进程可响应，依赖就绪状态由后端后续提供）</div>
      <div id="healthRows"><div class="table-empty">读取中…</div></div>
    </div>

    <div class="setting-group">
      <h3>安全边界（由后端代码决定，界面不可修改）</h3>
      <div class="sg-desc">这些行为在 campus-identity 中实现，属于服务端强制约束</div>
      <div class="policy-facts">
        <div>• 会话凭证为 <b>HttpOnly Cookie（CAMPUS_AUTH，Path=/api，SameSite=Lax）</b>，前端读不到</div>
        <div>• 所有写请求必须携带 CSRF 令牌（<code>GET /api/auth/csrf</code> → <code>X-XSRF-TOKEN</code>）</div>
        <div>• 首次登录强制改密：未改密前除 <code>/api/auth/{change-password,logout,csrf,me}</code> 外一律 403 <code>MUST_CHANGE_PASSWORD</code></div>
        <div>• 角色仅 <b>ADMIN / STUDENT</b>：<code>/api/admin/**</code> 需 ADMIN，<code>/api/student/**</code> 需 STUDENT，其余 <code>/api/**</code> 需已登录</div>
        <div>• 越权访问返回 403 <code>ACCESS_DENIED</code>，未登录返回 401 <code>AUTH_REQUIRED</code></div>
        <div>• 跨源仅放行后端 <code>AUTH_ALLOWED_ORIGINS</code> 中列出的来源</div>
      </div>
    </div>

    <div class="setting-group">
      <h3>未提供接口的能力（不在界面伪造）</h3>
      <div class="sg-desc">方案书中提到、但当前后端没有对应接口的项目</div>
      <div class="policy-facts">
        <div>• <b>模型 / 向量库 / Embedding / Rerank 参数</b>：配置在 ai-service 与后端 <code>application.yml</code>，未通过 API 暴露</div>
        <div>• <b>问答策略开关</b>（仅检索现行版本、拒答阈值、引用校验等）：逻辑固定在后端与 AI 服务代码中，前端无法开关</div>
        <div>• <b>知识库 ID</b>：问答请求固定提交 <code>campus-default</code>（前端常量），后端未提供查询接口</div>
        <div>• <b>审计查询与导出</b>：campus-audit 模块暂无 Controller，见「审计追溯」页的真实替代视图</div>
      </div>
    </div>
  `;

  const cfgRows = $("#cfgRows");
  try {
    const [cfg, mat] = await Promise.all([
      apiGet("/api/admin/config"),
      apiGet("/api/admin/material-attachments/config")
    ]);
    cfgRows.innerHTML = `
      ${settingFact("文档最大上传大小", `${cfg?.maxUploadSizeMb ?? "-"} MB`, "GET /api/admin/config")}
      ${settingFact("材料模板最大上传", `${mat?.maxUploadSizeMb ?? "-"} MB`, "GET /api/admin/material-attachments/config")}
      ${settingFact("材料模板支持格式", (mat?.extensions || []).join(" / ") || "-", "同上")}
    `;
  } catch (e) {
    cfgRows.innerHTML = `<div class="table-empty is-error">✕ ${escapeHtml(e.message || "读取配置失败")}</div>`;
  }

  const healthRows = $("#healthRows");
  try {
    const h = await apiGet("/api/v1/health");
    healthRows.innerHTML = `
      ${settingFact("服务状态", h?.status || "-", "GET /api/v1/health")}
      ${settingFact("服务名", h?.service || "-", "同上")}
      ${settingFact("版本", h?.version || "-", "同上")}
    `;
  } catch (e) {
    healthRows.innerHTML = `<div class="table-empty is-error">✕ ${escapeHtml(e.message || "后端不可用")}</div>`;
  }
}
window.renderSettings = renderSettings;

function settingFact(label, value, source) {
  return `
    <div class="setting-row">
      <div>
        <div class="sr-label">${escapeHtml(label)}</div>
        <div class="sr-desc">${escapeHtml(source)}</div>
      </div>
      <span class="tag tag-violet">${escapeHtml(String(value))}</span>
    </div>`;
}

/* ============================================================
   通用：模态框
   ============================================================ */
/* ============================================================
   后端接口清单与前端窗口对应关系（便于核对）
     /api/v1/health                       概览状态条
     /api/auth/{csrf,login,me,logout,change-password}  登录页 / 强制改密
     /api/services                        工作台·办事引导·提交申请选事项
     /api/services/{id}                   事项详情
     /api/services/{id}/steps             事项步骤
     /api/services/{id}/source            事项来源文件下载
     /api/services/recognize              办事引导·自然语言事项识别
     /api/knowledge/search                政策检索
     /api/rag/chat                        智能问答（含事项引导分支）
     /api/chat/conversations[/{id}/messages]  问答会话列表 / 历史 / 新建 / 删除
     /api/student/applications[/{id}]     我的申请（列表/详情/提交/补交/在办）
     /api/student/applications/upload-config  上传约束
     /api/admin/overview|config           工作台·系统设置
     /api/admin/documents[/{id}][/progress|/reprocess|/name]  政策管理
     /api/admin/services[/{id}]           事项管理（增删改查 + version 乐观锁）
     /api/admin/services/{sid}/materials/{mid}/attachment  材料模板附件
     /api/admin/applications[/{id}][/status]  申请审核（状态机 + version）
     /api/files/{id}/download | /api/admin/files/{id}/download  附件下载
   ============================================================ */

/* ---------- 通用：上传约束（后端下发，前端不写死） ---------- */
let uploadConfig = null;
async function loadUploadConfig(force = false) {
  if (uploadConfig && !force) return uploadConfig;
  try { uploadConfig = await apiGet("/api/student/applications/upload-config"); }
  catch (e) { uploadConfig = null; }
  return uploadConfig;
}

/** 按后端 config 校验待上传文件，返回错误文案或空串。 */
function validateFiles(fileList, cfg) {
  const files = [...fileList];
  if (!files.length || !cfg) return "";
  if (files.length > cfg.maxFiles) return `每次最多上传 ${cfg.maxFiles} 个文件`;
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > cfg.maxTotalSizeMb * 1024 * 1024) return `本次上传总大小不能超过 ${cfg.maxTotalSizeMb} MB`;
  for (const f of files) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!cfg.extensions.includes(ext)) return `不支持的文件类型：${f.name}（仅支持 ${cfg.extensions.join(" / ")}）`;
    if (f.size > cfg.maxUploadSizeMb * 1024 * 1024) return `单个文件不能超过 ${cfg.maxUploadSizeMb} MB：${f.name}`;
  }
  return "";
}

/* ---------- 申请状态筛选（后端 ?status= 接受 ACTIVE 或具体状态名） ---------- */
const APP_STATUS_FILTERS = [
  { key: "", label: "全部" },
  { key: "ACTIVE", label: "在办" },
  { key: "SUBMITTED", label: "已提交" },
  { key: "REVIEWING", label: "审核中" },
  { key: "NEED_MORE", label: "待补材料" },
  { key: "APPROVED", label: "已通过" },
  { key: "REJECTED", label: "已驳回" },
  { key: "COMPLETED", label: "已完成" }
];

function renderStatusFilters(sel, state, onChange) {
  const el = $(sel);
  if (!el) return;
  el.innerHTML = `<div class="filter-bar">${APP_STATUS_FILTERS.map(f =>
    `<button type="button" class="chip ${state.status === f.key ? "on" : ""}" data-status="${f.key}" aria-pressed="${state.status === f.key}">${f.label}</button>`).join("")}</div>`;
  $$(".chip", el).forEach(btn => btn.addEventListener("click", () => {
    if (state.status === btn.dataset.status) return;
    state.status = btn.dataset.status;
    // 必须就地刷新选中态：本函数只在页面首次渲染时调用一次，
    // 若只改 state 不更新 class，按钮高亮会一直停在初始筛选项上。
    $$(".chip", el).forEach(b => {
      const on = b.dataset.status === state.status;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    onChange();
  }));
}

function renderPager(sel, state, onGo) {
  const el = $(sel);
  if (!el) return;
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  el.innerHTML = `
    <div class="pager">
      <span class="pager-info">第 ${state.page} / ${pages} 页 · 共 ${state.total} 条</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" ${state.page <= 1 ? "disabled" : ""} data-go="${state.page - 1}">上一页</button>
        <button class="btn btn-sm" ${state.page >= pages ? "disabled" : ""} data-go="${state.page + 1}">下一页</button>
      </div>
    </div>`;
  $$("[data-go]", el).forEach(b => b.addEventListener("click", () => {
    const next = Number(b.dataset.go);
    if (next >= 1 && next <= pages) { state.page = next; onGo(); }
  }));
}

/* ============================================================
   视图：我的申请（学生端）
   后端：GET  /api/student/applications?status&page&pageSize
         GET  /api/student/applications/{id}
         POST /api/student/applications                (multipart)
         POST /api/student/applications/{id}/resubmit  (multipart，仅 NEED_MORE)
         GET  /api/student/applications/active?serviceItemId=
   ============================================================ */
const myApps = { page: 1, pageSize: 10, status: "", total: 0, items: [], loading: false };

function renderMyApplications(vp) {
  vp.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">我的申请</div>
        <div class="page-desc">提交办理申请、按审核意见补充材料并跟踪进度（对应 /api/student/applications）</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" onclick="loadMyApplications()">⟳ 刷新</button>
        <button class="btn btn-primary" onclick="openNewApplication()">＋ 提交新申请</button>
      </div>
    </div>
    <div id="myAppFilters"></div>
    <div class="card" style="padding:0;overflow:hidden;margin-top:14px">
      <table class="table">
        <thead>
          <tr><th>申请编号</th><th>事项</th><th>状态</th><th>版本</th><th>提交时间</th><th>最近更新</th><th>操作</th></tr>
        </thead>
        <tbody id="myAppBody"></tbody>
      </table>
    </div>
    <div id="myAppPager"></div>
  `;
  renderStatusFilters("#myAppFilters", myApps, () => { myApps.page = 1; loadMyApplications(); });
  loadMyApplications();
}

async function loadMyApplications() {
  const body = $("#myAppBody");
  if (!body) return;
  myApps.loading = true;
  body.innerHTML = `<tr><td colspan="7" class="table-empty">加载中…</td></tr>`;
  renderPager("#myAppPager", myApps, loadMyApplications);
  try {
    const q = new URLSearchParams({ page: String(myApps.page), pageSize: String(myApps.pageSize) });
    if (myApps.status) q.set("status", myApps.status);
    const data = await apiGet(`/api/student/applications?${q.toString()}`);
    myApps.items = data?.items || [];
    myApps.total = data?.total || 0;
    if (!myApps.items.length) {
      body.innerHTML = `<tr><td colspan="7" class="table-empty">${
        myApps.status ? "当前筛选条件下没有申请记录" : `还没有申请记录 · 可在 <span class="link-btn" onclick="navigate('affairs')">办事引导</span> 选择事项并提交申请`
      }</td></tr>`;
    } else {
      body.innerHTML = myApps.items.map(a => `
        <tr>
          <td class="mono">${escapeHtml(a.applicationNo || "-")}</td>
          <td>${escapeHtml(a.serviceName || "-")}</td>
          <td>${statusTag(a.status)}</td>
          <td class="mono">v${a.version ?? 1}</td>
          <td>${fmtTime(a.submittedAt)}</td>
          <td>${relTime(a.updatedAt || a.submittedAt)}</td>
          <td>
            <button class="btn btn-sm" onclick="showApplicationDetail(${a.id})">详情</button>
            ${a.status === "NEED_MORE" ? `<button class="btn btn-sm btn-primary" onclick="openResubmit(${a.id}, ${a.version ?? 1})">补充材料</button>` : ""}
          </td>
        </tr>`).join("");
    }
  } catch (e) {
    body.innerHTML = `<tr><td colspan="7" class="table-empty is-error">✕ ${escapeHtml(e.message || "加载失败")} · <span class="link-btn" onclick="loadMyApplications()">重试</span></td></tr>`;
  } finally {
    myApps.loading = false;
    renderPager("#myAppPager", myApps, loadMyApplications);
  }
}
window.loadMyApplications = loadMyApplications;
window.renderMyApplications = renderMyApplications;

/* ---------- 提交新申请 ---------- */
let appServiceCache = [];

async function openNewApplication(serviceId) {
  openModal(`
    <div class="detail-head">
      <div><h2>提交办理申请</h2><div class="head-sub">正在加载事项与上传配置…</div></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body"><div style="text-align:center;padding:30px;color:var(--text-3)">请稍候…</div></div>
  `, "affair-modal");
  try {
    const [services, cfg] = await Promise.all([apiGet("/api/services"), loadUploadConfig()]);
    appServiceCache = (services || []).filter(s => s.status === "ACTIVE");
    const accept = cfg ? cfg.extensions.map(e => "." + e).join(",") : "";
    const limit = cfg ? `≤${cfg.maxFiles} 个文件 · 单个 ≤${cfg.maxUploadSizeMb}MB · 合计 ≤${cfg.maxTotalSizeMb}MB · ${cfg.extensions.join(" / ")}` : "";
    openModal(`
      <div class="detail-head">
        <div><h2>提交办理申请</h2><div class="head-sub">选择事项 → 核对材料 → 填写说明并上传</div></div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="detail-body">
        ${!appServiceCache.length
          ? panelState("▤", "暂无可申请的事项", "事项需要由管理员在「事项管理」中配置并置为 ACTIVE 才能申请。")
          : `
          <div class="form-row">
            <label for="appService">办理事项 *</label>
            <select id="appService" class="input">
              ${appServiceCache.map(s => `<option value="${s.id}" ${serviceId === s.id ? "selected" : ""}>${escapeHtml(s.name)}${s.department ? " · " + escapeHtml(s.department) : ""}</option>`).join("")}
            </select>
          </div>
          <div id="appServiceInfo"></div>
          <div class="form-row">
            <label for="appRemark">申请说明 *</label>
            <textarea id="appRemark" class="input" rows="4" maxlength="4000" placeholder="请说明申请原因与具体情况（最多 4000 字，后端必填）"></textarea>
          </div>
          <div class="form-row">
            <label for="appFiles">申请材料 ${limit ? `<span class="label-note">${limit}</span>` : ""}</label>
            <input type="file" id="appFiles" class="input" multiple ${accept ? `accept="${accept}"` : ""} />
            <div class="form-hint" id="appReqHint"></div>
          </div>
          <div class="auth-alert" id="appErr" hidden></div>
          <div class="form-actions">
            <button class="btn" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" id="appSubmit">提交申请</button>
          </div>`}
      </div>
    `, "affair-modal");
    if (appServiceCache.length) {
      $("#appService").addEventListener("change", refreshServiceBrief);
      $("#appSubmit").addEventListener("click", submitNewApplication);
      refreshServiceBrief();
    }
  } catch (e) {
    openModal(modalError("无法打开申请表单", e.message), "affair-modal");
  }
}
window.openNewApplication = openNewApplication;

async function refreshServiceBrief() {
  const sel = $("#appService"), box = $("#appServiceInfo"), hint = $("#appReqHint");
  if (!sel || !box) return;
  const id = Number(sel.value);
  const s = appServiceCache.find(x => x.id === id);
  const materials = s?.materials || [];
  const required = materials.filter(m => m.required);
  box.innerHTML = !s ? "" : `
    <div class="service-brief">
      <div class="brief-title">${escapeHtml(s.name)}
        <span class="brief-meta">${escapeHtml(s.department || "责任部门未配置")}${s.deadline ? " · 截止 " + escapeHtml(s.deadline) : ""}</span>
      </div>
      ${(s.requirements || []).length ? `<div class="brief-block"><b>办理条件</b><ul>${s.requirements.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul></div>` : ""}
      <div class="brief-block"><b>材料清单（${materials.length}）</b>
        <ul>${materials.length ? materials.map(m => `<li>${m.required ? '<span class="req">必交</span>' : '<span class="opt">选交</span>'} ${escapeHtml(m.name)}${m.description ? ` · ${escapeHtml(m.description)}` : ""}</li>`).join("") : "<li>该事项未配置材料</li>"}</ul>
      </div>
      <div id="appActiveHint"></div>
    </div>`;
  hint.innerHTML = required.length
    ? `该事项有 <b>${required.length}</b> 项必交材料，后端要求至少上传一个文件：${required.map(m => escapeHtml(m.name)).join("、")}`
    : "该事项没有必交材料，可只填写说明直接提交（后端允许 files 为空）。";
  try {
    const active = await apiGet(`/api/student/applications/active?serviceItemId=${id}`);
    const holder = $("#appActiveHint");
    if (holder && active) {
      holder.innerHTML = `<div class="inline-warn">该事项已有在办申请 <b>${escapeHtml(active.applicationNo || "")}</b>（${statusTag(active.status)}），重复提交会被后端拒绝（APPLICATION_ALREADY_ACTIVE）。</div>`;
    }
  } catch (e) { /* active 接口失败不影响填表 */ }
}

async function submitNewApplication() {
  const sel = $("#appService"), err = $("#appErr"), btn = $("#appSubmit");
  const remark = ($("#appRemark")?.value || "").trim();
  const files = $("#appFiles")?.files;
  const fail = (m) => { err.hidden = false; err.textContent = m; };
  if (!sel) return;
  if (!remark) return fail("请填写申请说明（后端必填）");
  if (remark.length > 4000) return fail("申请说明不能超过 4000 字");
  const cfg = await loadUploadConfig();
  const fileError = validateFiles(files || [], cfg);
  if (fileError) return fail(fileError);

  err.hidden = true;
  btn.disabled = true;
  btn.textContent = "提交中…";
  const fd = new FormData();
  fd.append("serviceItemId", sel.value);
  fd.append("studentRemark", remark);
  if (files) [...files].forEach(f => fd.append("files", f));
  try {
    const created = await apiUpload("/api/student/applications", fd);
    const no = created?.application?.applicationNo;
    closeModal();
    toast(no ? `申请已提交：${no}` : "申请已提交", "success");
    loadMyApplications();
    loadWorkbench(true);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "提交申请";
    fail(e.message || "提交失败");
  }
}
window.submitNewApplication = submitNewApplication;

/* ---------- 补充材料（仅 NEED_MORE 可提交） ---------- */
async function openResubmit(id, version) {
  const cfg = await loadUploadConfig();
  const accept = cfg ? cfg.extensions.map(e => "." + e).join(",") : "";
  openModal(`
    <div class="detail-head">
      <div><h2>补充申请材料</h2><div class="head-sub">对应 POST /api/student/applications/${id}/resubmit</div></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body">
      <div class="form-row">
        <label for="resubRemark">补充说明 *</label>
        <textarea id="resubRemark" class="input" rows="3" maxlength="4000" placeholder="说明本次补充的内容（后端必填）"></textarea>
      </div>
      <div class="form-row">
        <label for="resubFiles">补充材料 * <span class="label-note">${cfg ? `≤${cfg.maxFiles} 个 · 单个 ≤${cfg.maxUploadSizeMb}MB · ${cfg.extensions.join(" / ")}` : ""}</span></label>
        <input type="file" id="resubFiles" class="input" multiple ${accept ? `accept="${accept}"` : ""} />
        <div class="form-hint">后端要求补交时至少上传一份文件，否则返回“请至少选择一份补充材料”。</div>
      </div>
      <div class="auth-alert" id="resubErr" hidden></div>
      <div class="form-actions">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" id="resubSubmit">提交补充材料</button>
      </div>
    </div>
  `, "affair-modal");
  $("#resubSubmit").addEventListener("click", async () => {
    const err = $("#resubErr"), btn = $("#resubSubmit");
    const remark = ($("#resubRemark")?.value || "").trim();
    const files = $("#resubFiles")?.files;
    const fail = (m) => { err.hidden = false; err.textContent = m; };
    if (!remark) return fail("请填写补充说明");
    if (!files || !files.length) return fail("请至少选择一份补充材料");
    const fileError = validateFiles(files, cfg);
    if (fileError) return fail(fileError);
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = "提交中…";
    const fd = new FormData();
    fd.append("version", String(version));
    fd.append("studentRemark", remark);
    [...files].forEach(f => fd.append("files", f));
    try {
      await apiUpload(`/api/student/applications/${id}/resubmit`, fd);
      closeModal();
      toast("补充材料已提交，状态回到已提交", "success");
      loadMyApplications();
      loadWorkbench(true);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "提交补充材料";
      fail(e.message || "提交失败");
    }
  });
}
window.openResubmit = openResubmit;

/* ============================================================
   视图：申请审核（管理员）
   后端：GET   /api/admin/applications?status&page&pageSize
         GET   /api/admin/applications/{id}
         PATCH /api/admin/applications/{id}/status  {status,remark,version}
   状态机（后端 ApplicationStatus.canReviewTo）：
         SUBMITTED → REVIEWING
         REVIEWING → NEED_MORE | APPROVED | REJECTED
         APPROVED  → COMPLETED
   ============================================================ */
const reviewList = { page: 1, pageSize: 10, status: "ACTIVE", total: 0, items: [] };

const REVIEW_ACTIONS = {
  SUBMITTED: [{ to: "REVIEWING", label: "开始审核", needRemark: false }],
  REVIEWING: [
    { to: "NEED_MORE", label: "要求补材料", needRemark: true },
    { to: "APPROVED", label: "审核通过", needRemark: false },
    { to: "REJECTED", label: "驳回", needRemark: true }
  ],
  APPROVED: [{ to: "COMPLETED", label: "标记完成", needRemark: false }]
};

const REVIEW_LABEL = {
  REVIEWING: "开始审核", NEED_MORE: "要求补材料", APPROVED: "审核通过",
  REJECTED: "驳回", COMPLETED: "标记完成"
};

function renderApplicationReview(vp) {
  vp.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">申请审核</div>
        <div class="page-desc">按状态机处理学生申请，每次操作携带 version 做乐观锁校验</div>
      </div>
      <button class="btn btn-sm" onclick="loadReviewList()">⟳ 刷新</button>
    </div>
    <div id="reviewFilters"></div>
    <div class="card" style="padding:0;overflow:hidden;margin-top:14px">
      <table class="table">
        <thead>
          <tr><th>申请编号</th><th>事项</th><th>申请人</th><th>学号</th><th>状态</th><th>提交时间</th><th>操作</th></tr>
        </thead>
        <tbody id="reviewBody"></tbody>
      </table>
    </div>
    <div id="reviewPager"></div>
  `;
  renderStatusFilters("#reviewFilters", reviewList, () => { reviewList.page = 1; loadReviewList(); });
  loadReviewList();
}

async function loadReviewList() {
  const body = $("#reviewBody");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="7" class="table-empty">加载中…</td></tr>`;
  renderPager("#reviewPager", reviewList, loadReviewList);
  try {
    const q = new URLSearchParams({ page: String(reviewList.page), pageSize: String(reviewList.pageSize) });
    if (reviewList.status) q.set("status", reviewList.status);
    const data = await apiGet(`/api/admin/applications?${q.toString()}`);
    reviewList.items = data?.items || [];
    reviewList.total = data?.total || 0;
    body.innerHTML = reviewList.items.length
      ? reviewList.items.map(a => `
          <tr>
            <td class="mono">${escapeHtml(a.applicationNo || "-")}</td>
            <td>${escapeHtml(a.serviceName || "-")}</td>
            <td>${escapeHtml(a.applicantName || a.username || "-")}</td>
            <td class="mono">${escapeHtml(a.studentNo || "-")}</td>
            <td>${statusTag(a.status)}</td>
            <td>${fmtTime(a.submittedAt)}</td>
            <td><button class="btn btn-sm btn-primary" onclick="openReviewDialog(${a.id})">审核</button></td>
          </tr>`).join("")
      : `<tr><td colspan="7" class="table-empty">${reviewList.status === "ACTIVE" ? "当前没有在办申请" : "当前筛选条件下没有申请"}</td></tr>`;
  } catch (e) {
    body.innerHTML = `<tr><td colspan="7" class="table-empty is-error">✕ ${escapeHtml(e.message || "加载失败")} · <span class="link-btn" onclick="loadReviewList()">重试</span></td></tr>`;
  } finally {
    renderPager("#reviewPager", reviewList, loadReviewList);
  }
}
window.loadReviewList = loadReviewList;
window.renderApplicationReview = renderApplicationReview;

async function openReviewDialog(id) {
  openModal(`
    <div class="detail-head">
      <div><h2>申请详情与审核</h2><div class="head-sub">加载中…</div></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body"><div style="text-align:center;padding:30px;color:var(--text-3)">请稍候…</div></div>
  `, "affair-modal");
  try {
    const data = await apiGet(`/api/admin/applications/${id}`);
    const a = data?.application || {};
    const attachments = data?.attachments || [];
    const events = data?.events || [];
    const actions = REVIEW_ACTIONS[a.status] || [];
    openModal(`
      <div class="detail-head">
        <div>
          <h2>${escapeHtml(a.serviceName || "办理申请")}</h2>
          <div class="head-sub">${escapeHtml(a.applicationNo || "")} · 提交于 ${fmtTime(a.submittedAt)} · v${a.version ?? 1}</div>
        </div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="detail-body">
        <div class="tag-row">${statusTag(a.status)}
          <span class="tag tag-info"><span class="tag-dot"></span>${escapeHtml(a.applicantName || a.username || "-")}</span>
          ${a.studentNo ? `<span class="tag tag-violet"><span class="tag-dot"></span>学号 ${escapeHtml(a.studentNo)}</span>` : ""}
        </div>
        <div class="detail-section">
          <h4>学生申请说明</h4>
          <div class="pre-wrap">${escapeHtml(a.studentRemark || "（未填写）")}</div>
        </div>
        ${a.adminRemark ? `<div class="detail-section"><h4>上一次审核意见</h4><div class="pre-wrap">${escapeHtml(a.adminRemark)}</div></div>` : ""}
        <div class="detail-section">
          <h4>附件（${attachments.length}）</h4>
          ${attachments.length ? attachments.map(f => `
            <div class="list-item" style="padding:10px 0">
              <div class="li-ico">▤</div>
              <div class="li-body">
                <div class="li-title">${escapeHtml(f.filename || "-")}</div>
                <div class="li-meta">${Math.max(1, Math.round((f.fileSize || 0) / 1024))} KB · ${fmtTime(f.uploadedAt)}</div>
              </div>
              <a class="btn btn-sm" href="${API_BASE}/api/admin/files/${f.id}/download" target="_blank" rel="noopener">下载</a>
            </div>`).join("") : `<div class="form-hint">本次申请没有附件</div>`}
        </div>
        <div class="detail-section">
          <h4>办理轨迹（${events.length}）</h4>
          ${events.length ? events.map(ev => `
            <div class="step-line-item">
              <div class="step-num">•</div>
              <div>
                <div style="font-size:13px">${ev.fromStatus ? `${escapeHtml(ev.fromStatus)} → ` : ""}<b>${escapeHtml(ev.toStatus || "-")}</b></div>
                <div class="li-meta">${escapeHtml(ev.actorName || "-")}${ev.actorRole ? `（${escapeHtml(ev.actorRole)}）` : ""} · ${fmtTime(ev.createdAt)}</div>
                ${ev.remark ? `<div class="pre-wrap" style="margin-top:6px">${escapeHtml(ev.remark)}</div>` : ""}
              </div>
            </div>`).join("") : `<div class="form-hint">暂无流转记录</div>`}
        </div>

        <div class="detail-section">
          <h4>审核操作</h4>
          ${!actions.length
            ? `<div class="form-hint">当前状态「${escapeHtml(a.status)}」已无可执行操作（后端状态机：SUBMITTED→REVIEWING→NEED_MORE/APPROVED/REJECTED，APPROVED→COMPLETED）。</div>`
            : `
            <div class="form-row">
              <label for="reviewRemark">审核意见 <span class="label-note">要求补材料 / 驳回时后端必填</span></label>
              <textarea id="reviewRemark" class="input" rows="3" maxlength="4000" placeholder="填写审核意见（≤4000 字）"></textarea>
            </div>
            <div class="auth-alert" id="reviewErr" hidden></div>
            <div class="form-actions">
              ${actions.map(ac => `<button class="btn ${ac.to === "REJECTED" || ac.to === "NEED_MORE" ? "" : "btn-primary"}" data-review="${ac.to}">${ac.label}</button>`).join("")}
            </div>`}
        </div>
      </div>
    `, "affair-modal");
    $$("[data-review]").forEach(btn => btn.addEventListener("click", () =>
      submitReview(id, a.version ?? 1, btn.dataset.review, btn)));
  } catch (e) {
    openModal(modalError("无法加载申请详情", e.message), "affair-modal");
  }
}
window.openReviewDialog = openReviewDialog;

async function submitReview(id, version, nextStatus, btn) {
  const err = $("#reviewErr");
  const remark = ($("#reviewRemark")?.value || "").trim();
  const needRemark = nextStatus === "NEED_MORE" || nextStatus === "REJECTED";
  const fail = (m) => { err.hidden = false; err.textContent = m; };
  if (needRemark && !remark) return fail(`「${REVIEW_LABEL[nextStatus] || nextStatus}」必须填写审核意见`);
  if (remark.length > 4000) return fail("审核意见不能超过 4000 字");
  err.hidden = true;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "提交中…";
  try {
    await apiPatch(`/api/admin/applications/${id}/status`, { status: nextStatus, remark, version });
    closeModal();
    toast(`已${REVIEW_LABEL[nextStatus] || nextStatus}`, "success");
    loadReviewList();
    loadWorkbench(true);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = original;
    fail(e.message || "审核失败");
  }
}
window.submitReview = submitReview;

/* ============================================================
   视图：事项管理（管理员）
   后端：GET    /api/admin/services            （含 DRAFT/DISABLED）
         GET    /api/admin/services/{id}       （含步骤）
         POST   /api/admin/services            body=ServiceDetail
         PUT    /api/admin/services/{id}       body=ServiceDetail（version 必须回传）
         DELETE /api/admin/services/{id}?version=N
         POST   /api/admin/services/{sid}/materials/{mid}/attachment  (multipart file)
         DELETE /api/admin/services/{sid}/materials/{mid}/attachment
   ============================================================ */
let svcCache = [];

function renderServiceManager(vp) {
  vp.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">事项管理</div>
        <div class="page-desc">维护办理条件、步骤、材料清单与识别词；启用中的事项需要主题词和动作词</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" onclick="loadServiceTable()">⟳ 刷新</button>
        <button class="btn btn-primary" onclick="openServiceEditor(null)">＋ 新建事项</button>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table class="table">
        <thead>
          <tr><th>ID</th><th>编码</th><th>名称</th><th>分类</th><th>责任部门</th><th>材料</th><th>状态</th><th>版本</th><th>操作</th></tr>
        </thead>
        <tbody id="svcBody"></tbody>
      </table>
    </div>
  `;
  loadServiceTable();
}
window.renderServiceManager = renderServiceManager;

async function loadServiceTable() {
  const body = $("#svcBody");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="9" class="table-empty">加载中…</td></tr>`;
  try {
    const items = await apiGet("/api/admin/services");
    svcCache = items || [];
    body.innerHTML = svcCache.length
      ? svcCache.map(s => `
          <tr>
            <td class="mono">${s.id}</td>
            <td class="mono">${escapeHtml(s.code || "-")}</td>
            <td>${escapeHtml(s.name || "-")}${s.isExample ? ` <span class="tag tag-draft" style="font-size:10px">示例</span>` : ""}</td>
            <td>${escapeHtml(s.category || "-")}</td>
            <td>${escapeHtml(s.department || "-")}</td>
            <td>${(s.materials || []).length}</td>
            <td>${statusTag(s.status)}</td>
            <td class="mono">v${s.version ?? 1}</td>
            <td>
              <button class="btn btn-sm" onclick="openServiceEditor(${s.id})">编辑</button>
              <button class="btn btn-sm" onclick="deleteServiceItem(${s.id}, ${s.version ?? 1})">删除</button>
            </td>
          </tr>`).join("")
      : `<tr><td colspan="9" class="table-empty">还没有事项 · 点右上角「新建事项」创建，或先导入办事指南文档再手工录入结构化字段</td></tr>`;
  } catch (e) {
    body.innerHTML = `<tr><td colspan="9" class="table-empty is-error">✕ ${escapeHtml(e.message || "加载失败")} · <span class="link-btn" onclick="loadServiceTable()">重试</span></td></tr>`;
  }
}
window.loadServiceTable = loadServiceTable;

/* ---------- 事项编辑器 ---------- */
let svcDraft = null;

async function openServiceEditor(id) {
  openModal(`
    <div class="detail-head">
      <div><h2>${id ? "编辑事项" : "新建事项"}</h2><div class="head-sub">加载中…</div></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body"><div style="text-align:center;padding:30px;color:var(--text-3)">请稍候…</div></div>
  `, "affair-modal");
  try {
    if (id) {
      const data = await apiGet(`/api/admin/services/${id}`);
      svcDraft = { service: data.service, steps: data.steps || [] };
    } else {
      svcDraft = {
        service: {
          id: null, code: "", name: "", category: "", description: "", department: "", location: "",
          officeHours: "", contact: "", requirements: [], materials: [], recognitionRules: { subjects: [], actions: [], exclusions: [] },
          deadline: "", sourceDocumentId: "", sourceTitle: "", sourceUrl: "", sourcePublishTime: null,
          status: "DRAFT", isExample: false, version: 0
        },
        steps: []
      };
      svcDraft.steps.push({ order: 1, title: "", description: "", responsibleDepartment: "", location: "", estimatedTime: "", requiredMaterials: [] });
    }
    renderServiceEditor();
  } catch (e) {
    openModal(modalError("无法加载事项", e.message), "affair-modal");
  }
}
window.openServiceEditor = openServiceEditor;

function linesToArray(text) {
  return String(text || "").split("\n").map(s => s.trim()).filter(Boolean);
}
function tokensToList(text) {
  return String(text || "").split(/[\n,，、;；]/).map(s => s.trim()).filter(Boolean);
}

function renderServiceEditor() {
  const s = svcDraft.service;
  const isEdit = Boolean(s.id);
  openModal(`
    <div class="detail-head">
      <div>
        <h2>${isEdit ? `编辑事项 #${s.id}` : "新建事项"}</h2>
        <div class="head-sub">编码规则 [A-Z][A-Z0-9_]{1,79}；启用状态必须填写主题词与动作词${isEdit ? ` · 当前 v${s.version}` : ""}</div>
      </div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body">
      <div class="form-grid">
        <div class="form-row"><label for="svcCode">业务编码 *</label>
          <input id="svcCode" class="input" value="${escAttr(s.code)}" placeholder="例如 SCHOLARSHIP_APPLY" ${isEdit ? "readonly" : ""} /></div>
        <div class="form-row"><label for="svcStatus">状态 *</label>
          <select id="svcStatus" class="input">
            ${["DRAFT", "ACTIVE", "DISABLED"].map(v => `<option value="${v}" ${s.status === v ? "selected" : ""}>${{ DRAFT: "草稿", ACTIVE: "启用", DISABLED: "停用" }[v]}</option>`).join("")}
          </select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label for="svcName">事项名称 *</label><input id="svcName" class="input" value="${escAttr(s.name)}" /></div>
        <div class="form-row"><label for="svcCategory">分类 *</label><input id="svcCategory" class="input" value="${escAttr(s.category)}" placeholder="例如 奖助学金" /></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label for="svcDept">责任部门</label><input id="svcDept" class="input" value="${escAttr(s.department)}" /></div>
        <div class="form-row"><label for="svcDeadline">截止时间</label><input id="svcDeadline" class="input" value="${escAttr(s.deadline)}" placeholder="例如 每学年 9 月 30 日前" /></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label for="svcLocation">办理地点</label><input id="svcLocation" class="input" value="${escAttr(s.location)}" /></div>
        <div class="form-row"><label for="svcOfficeHours">办公时间</label><input id="svcOfficeHours" class="input" value="${escAttr(s.officeHours)}" /></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label for="svcContact">联系方式</label><input id="svcContact" class="input" value="${escAttr(s.contact)}" /></div>
        <div class="form-row"><label for="svcSourceDoc">来源文档 ID <span class="label-note">36 位以内字母数字与 -</span></label>
          <input id="svcSourceDoc" class="input" value="${escAttr(s.sourceDocumentId)}" placeholder="可填政策管理中的文档 ID" /></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label for="svcSourceTitle">来源标题</label><input id="svcSourceTitle" class="input" value="${escAttr(s.sourceTitle)}" /></div>
        <div class="form-row"><label for="svcSourceUrl">来源链接 <span class="label-note">必须 http(s)</span></label>
          <input id="svcSourceUrl" class="input" value="${escAttr(s.sourceUrl)}" /></div>
      </div>
      <div class="form-row"><label for="svcDesc">事项说明</label>
        <textarea id="svcDesc" class="input" rows="3" maxlength="10000">${escapeHtml(s.description)}</textarea></div>
      <div class="form-row"><label for="svcReqs">办理条件 <span class="label-note">每行一条，对应 requirements</span></label>
        <textarea id="svcReqs" class="input" rows="3">${escapeHtml((s.requirements || []).join("\n"))}</textarea></div>

      <div class="form-row">
        <label>识别词 <span class="label-note">启用事项必填；用换行 / 逗号分隔，供 /api/services/recognize 匹配</span></label>
        <div class="form-grid">
          <div><div class="sub-label">主题词 *</div><input id="svcSubjects" class="input" value="${escAttr((s.recognitionRules?.subjects || []).join("，"))}" placeholder="例如 奖学金，助学金" /></div>
          <div><div class="sub-label">动作词 *</div><input id="svcActions" class="input" value="${escAttr((s.recognitionRules?.actions || []).join("，"))}" placeholder="例如 申请，办理" /></div>
        </div>
        <div style="margin-top:8px"><div class="sub-label">排除词</div><input id="svcExclusions" class="input" value="${escAttr((s.recognitionRules?.exclusions || []).join("，"))}" placeholder="命中即不匹配，例如 教职工" /></div>
      </div>

      <div class="form-row">
        <label>材料清单 <span class="label-note">最多 50 项；材料 ID 用于挂模板附件，保存后自动生成</span></label>
        <div id="svcMaterials"></div>
        <button type="button" class="btn btn-sm" onclick="addMaterialRow()">＋ 添加材料</button>
      </div>

      <div class="form-row">
        <label>办理步骤 <span class="label-note">最多 50 项，顺序按行排列</span></label>
        <div id="svcSteps"></div>
        <button type="button" class="btn btn-sm" onclick="addStepRow()">＋ 添加步骤</button>
      </div>

      <div class="auth-alert" id="svcErr" hidden></div>
      <div class="form-actions">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" id="svcSave">${isEdit ? "保存修改" : "创建事项"}</button>
      </div>
    </div>
  `, "affair-modal wide-modal");
  renderMaterialRows();
  renderStepRows();
  $("#svcSave").addEventListener("click", () => saveService(Boolean(isEdit)));
}
window.renderServiceEditor = renderServiceEditor;

function renderMaterialRows() {
  const holder = $("#svcMaterials");
  if (!holder) return;
  const materials = svcDraft.service.materials || [];
  holder.innerHTML = materials.length ? materials.map((m, i) => `
    <div class="sub-row" data-mrow="${i}">
      <input class="input" data-mfield="name" value="${escAttr(m.name)}" placeholder="材料名称 *" />
      <input class="input" data-mfield="description" value="${escAttr(m.description)}" placeholder="材料说明" />
      <label class="sub-check"><input type="checkbox" data-mfield="required" ${m.required ? "checked" : ""} /> 必交</label>
      ${m.id && svcDraft.service.id
        ? `<span class="sub-attach">
             ${m.attachment
               ? `<a class="link-btn" href="${API_BASE}/api/admin/files/${m.attachment.id}/download" target="_blank" rel="noopener">${escapeHtml(m.attachment.filename || "模板")}</a>
                  <button type="button" class="btn btn-sm" onclick="removeMaterialAttachment(${svcDraft.service.id}, '${escAttr(m.id)}')">移除模板</button>`
               : `<input type="file" class="input-file" data-mattach="${escAttr(m.id)}" />
                  <button type="button" class="btn btn-sm" onclick="uploadMaterialAttachment('${escAttr(m.id)}')">上传模板</button>`}
           </span>`
        : `<span class="sub-attach label-note">${m.id ? "保存后可上传模板附件" : "新材料的模板附件需保存后再上传"}</span>`}
      <button type="button" class="btn btn-sm" onclick="removeMaterialRow(${i})">删除</button>
    </div>`).join("") : `<div class="form-hint">还没有材料，点下方「添加材料」</div>`;
}

function addMaterialRow() {
  syncServiceForm();
  svcDraft.service.materials.push({ id: null, name: "", description: "", required: true, attachment: null });
  renderMaterialRows();
}
function removeMaterialRow(i) {
  syncServiceForm();
  svcDraft.service.materials.splice(i, 1);
  renderMaterialRows();
}
window.addMaterialRow = addMaterialRow;
window.removeMaterialRow = removeMaterialRow;

function renderStepRows() {
  const holder = $("#svcSteps");
  if (!holder) return;
  holder.innerHTML = svcDraft.steps.map((st, i) => `
    <div class="sub-row" data-srow="${i}">
      <input class="input" data-sfield="title" value="${escAttr(st.title)}" placeholder="步骤标题 *" />
      <input class="input" data-sfield="responsibleDepartment" value="${escAttr(st.responsibleDepartment)}" placeholder="负责部门" />
      <input class="input" data-sfield="estimatedTime" value="${escAttr(st.estimatedTime)}" placeholder="预计耗时" />
      <input class="input" data-sfield="location" value="${escAttr(st.location)}" placeholder="地点" />
      <textarea class="input" data-sfield="description" rows="2" placeholder="步骤说明">${escapeHtml(st.description)}</textarea>
      <input class="input" data-sfield="requiredMaterials" value="${escAttr((st.requiredMaterials || []).join("，"))}" placeholder="本步骤所需材料（逗号分隔）" />
      <button type="button" class="btn btn-sm" onclick="removeStepRow(${i})">删除</button>
    </div>`).join("");
}

function addStepRow() {
  syncServiceForm();
  svcDraft.steps.push({ order: svcDraft.steps.length + 1, title: "", description: "", responsibleDepartment: "", location: "", estimatedTime: "", requiredMaterials: [] });
  renderStepRows();
}
function removeStepRow(i) {
  syncServiceForm();
  svcDraft.steps.splice(i, 1);
  renderStepRows();
}
window.addStepRow = addStepRow;
window.removeStepRow = removeStepRow;

/** 把表单里的标量字段与动态行回写到 svcDraft（保存前调用）。 */
function syncServiceForm() {
  if (!svcDraft) return;
  const s = svcDraft.service;
  const val = (sel) => ($(sel)?.value ?? "").trim();
  if ($("#svcCode")) {
    s.code = val("#svcCode");
    s.name = val("#svcName");
    s.category = val("#svcCategory");
    s.department = val("#svcDept");
    s.deadline = val("#svcDeadline");
    s.location = val("#svcLocation");
    s.officeHours = val("#svcOfficeHours");
    s.contact = val("#svcContact");
    s.sourceDocumentId = val("#svcSourceDoc");
    s.sourceTitle = val("#svcSourceTitle");
    s.sourceUrl = val("#svcSourceUrl");
    s.description = val("#svcDesc");
    s.status = val("#svcStatus") || "DRAFT";
    s.requirements = linesToArray($("#svcReqs")?.value);
    s.recognitionRules = {
      subjects: tokensToList($("#svcSubjects")?.value),
      actions: tokensToList($("#svcActions")?.value),
      exclusions: tokensToList($("#svcExclusions")?.value)
    };
  }
  $$("[data-mrow]").forEach(row => {
    const i = Number(row.dataset.mrow);
    const m = s.materials[i];
    if (!m) return;
    m.name = row.querySelector('[data-mfield="name"]').value.trim();
    m.description = row.querySelector('[data-mfield="description"]').value.trim();
    m.required = row.querySelector('[data-mfield="required"]').checked;
  });
  $$("[data-srow]").forEach(row => {
    const i = Number(row.dataset.srow);
    const st = svcDraft.steps[i];
    if (!st) return;
    ["title", "description", "responsibleDepartment", "location", "estimatedTime"].forEach(f => {
      st[f] = (row.querySelector(`[data-sfield="${f}"]`)?.value || "").trim();
    });
    st.requiredMaterials = tokensToList(row.querySelector('[data-sfield="requiredMaterials"]')?.value);
    st.order = i + 1;
  });
}

async function saveService(isEdit) {
  syncServiceForm();
  const err = $("#svcErr"), btn = $("#svcSave");
  const s = svcDraft.service;
  const fail = (m) => { err.hidden = false; err.textContent = m; };
  // 与后端 ServiceGuideService.validate 对齐的前端预校验
  if (!s.code) return fail("请填写业务编码");
  if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(s.code)) return fail("业务编码只能使用大写字母、数字和下划线，且以字母开头");
  if (!s.name) return fail("请填写事项名称");
  if (!s.category) return fail("请填写分类");
  if (s.status === "ACTIVE" && (!s.recognitionRules.subjects.length || !s.recognitionRules.actions.length))
    return fail("启用状态的事项必须填写主题词和动作词（后端校验）");
  if (s.sourceUrl && !/^https?:\/\//i.test(s.sourceUrl)) return fail("来源链接必须是 http(s) 地址");
  if (s.materials.some(m => !m.name)) return fail("材料名称不能为空");
  if (svcDraft.steps.some(st => !st.title)) return fail("步骤标题不能为空");

  err.hidden = true;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "保存中…";
  // 后端对可选字段的校验是「非 null 才校验格式」，因此空字符串必须转成 null，
  // 否则会出现「来源文档 ID 无效」这类误报（例如 sourceDocumentId="" 不匹配 [a-zA-Z0-9-]{1,36}）。
  const nullIfBlank = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());
  const payload = {
    service: {
      ...s,
      id: isEdit ? s.id : null,
      description: nullIfBlank(s.description),
      department: nullIfBlank(s.department),
      location: nullIfBlank(s.location),
      officeHours: nullIfBlank(s.officeHours),
      contact: nullIfBlank(s.contact),
      deadline: nullIfBlank(s.deadline),
      sourceDocumentId: nullIfBlank(s.sourceDocumentId),
      sourceTitle: nullIfBlank(s.sourceTitle),
      sourceUrl: nullIfBlank(s.sourceUrl),
      sourcePublishTime: s.sourcePublishTime || null,
      materials: s.materials.map(m => ({ id: m.id || null, name: m.name, description: nullIfBlank(m.description), required: !!m.required })),
      isExample: !!s.isExample
    },
    steps: svcDraft.steps.map((st, i) => ({
      ...st,
      order: i + 1,
      description: nullIfBlank(st.description),
      responsibleDepartment: nullIfBlank(st.responsibleDepartment),
      location: nullIfBlank(st.location),
      estimatedTime: nullIfBlank(st.estimatedTime)
    }))
  };
  try {
    const saved = isEdit
      ? await apiRequest("PUT", `/api/admin/services/${s.id}`, payload)
      : await apiPost("/api/admin/services", payload);
    closeModal();
    toast(`事项已保存：#${saved?.service?.id ?? ""} ${saved?.service?.name || ""}`, "success");
    loadServiceTable();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = original;
    fail(e.message || "保存失败");
  }
}
window.saveService = saveService;

async function deleteServiceItem(id, version) {
  const s = svcCache.find(x => x.id === id);
  openModal(`
    <div class="detail-head">
      <div><h2>删除事项</h2><div class="head-sub">DELETE /api/admin/services/${id}?version=${version}</div></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body">
      <div class="inline-warn">即将删除「${escapeHtml(s?.name || id)}」（v${version}）。若该事项已有申请记录，后端会拒绝删除并提示改为停用。</div>
      <div class="auth-alert" id="delErr" hidden></div>
      <div class="form-actions">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" id="delOk">确认删除</button>
      </div>
    </div>
  `, "affair-modal");
  $("#delOk").addEventListener("click", async () => {
    const err = $("#delErr");
    const btn = $("#delOk");
    btn.disabled = true;
    btn.textContent = "删除中…";
    try {
      await apiDelete(`/api/admin/services/${id}?version=${version}`);
      closeModal();
      toast("事项已删除", "success");
      loadServiceTable();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "确认删除";
      err.hidden = false;
      err.textContent = e.message || "删除失败";
    }
  });
}
window.deleteServiceItem = deleteServiceItem;

async function uploadMaterialAttachment(materialId) {
  const input = $(`[data-mattach="${materialId}"]`);
  const file = input?.files?.[0];
  const err = $("#svcErr");
  if (!file) { err.hidden = false; err.textContent = "请先选择要上传的模板文件"; return; }
  let cfg = null;
  try { cfg = await apiGet("/api/admin/material-attachments/config"); } catch (e) { /* 用后端错误兜底 */ }
  if (cfg) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!cfg.extensions.includes(ext)) { err.hidden = false; err.textContent = `模板附件仅支持 ${cfg.extensions.join(" / ")}`; return; }
    if (file.size > cfg.maxUploadSizeMb * 1024 * 1024) { err.hidden = false; err.textContent = `单个模板不能超过 ${cfg.maxUploadSizeMb} MB`; return; }
  }
  const fd = new FormData();
  fd.append("file", file);
  try {
    await apiUpload(`/api/admin/services/${svcDraft.service.id}/materials/${materialId}/attachment`, fd);
    toast("模板附件已上传", "success");
    const data = await apiGet(`/api/admin/services/${svcDraft.service.id}`);
    svcDraft = { service: data.service, steps: data.steps || [] };
    renderMaterialRows();
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message || "上传失败";
  }
}
window.uploadMaterialAttachment = uploadMaterialAttachment;

async function removeMaterialAttachment(serviceId, materialId) {
  try {
    await apiDelete(`/api/admin/services/${serviceId}/materials/${materialId}/attachment`);
    toast("模板附件已移除", "success");
    const data = await apiGet(`/api/admin/services/${serviceId}`);
    svcDraft = { service: data.service, steps: data.steps || [] };
    renderMaterialRows();
  } catch (e) {
    const err = $("#svcErr");
    err.hidden = false;
    err.textContent = e.message || "移除失败";
  }
}
window.removeMaterialAttachment = removeMaterialAttachment;

/* ---------- 通用：弹窗错误内容 ---------- */
function modalError(title, message) {
  return `
    <div class="detail-head">
      <div><h2>${escapeHtml(title)}</h2></div>
      <button class="icon-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="detail-body">
      <div class="panel-state is-error"><div class="ps-ico">✕</div><div>${escapeHtml(message || "加载失败")}</div></div>
    </div>`;
}
window.modalError = modalError;

function openModal(html, extraClass = "") {
  let modal = $("#detailModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "detailModal";
    modal.className = "detail-modal";
    modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
    document.body.appendChild(modal);
  }
  modal.className = "detail-modal show " + extraClass;
  modal.innerHTML = `<div class="detail-panel">${html}</div>`;
}
window.openModal = openModal;

function closeModal() {
  const modal = $("#detailModal");
  if (modal) modal.classList.remove("show");
}
window.closeModal = closeModal;

/* ---------- 转义 ---------- */
function escapeHtml(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}
/** 用于 value="..." / data-xxx="..." 等属性位置，需额外转义引号。 */
function escAttr(s) {
  if (s == null) return "";
  return escapeHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ---------- 响应 hash 变化 ---------- */
window.addEventListener("hashchange", () => {
  // 公开分享页：不参与登录态路由
  if (isShareHash()) { renderPublicShare(shareTokenFromHash()); return; }
  if (!$("#shareScreen")?.hidden) hidePublicShare();
  const { route } = parseHashRoute();
  if (!currentUser || document.body.dataset.auth !== "in") return;
  const target = ROUTES[route] ? route : homeRoute();
  if (target !== currentRoute) navigate(target, { preserveHash: true });
  const { params } = parseHashRoute();
  const id = Number(params.get("conversation"));
  if (target === "qa" && id && id !== chatConversationId && !chatLoading) openConversation(id);     // 同一路由但带上 conversation 参数（站内会话链接）
});

/* ============================================================
   StaggeredMenu · 移动端抽屉
   移植自 React Bits StaggeredMenu（React + gsap）。本项目零依赖、无构建，
   所以时间轴用 requestAnimationFrame 手写，但原版的时间参数逐项保留：
     - 三个下衬层错峰 0.07s、时长 0.5s、power4.out，面板在最后一层之后 0.08s 插入；
     - 面板时长 0.65s；菜单项在面板起点 +15% 处开始，时长 1s、每条错峰 0.1s；
     - 序号错峰 0.08s、时长 0.6s；图标旋转 225°（0.8s，关回 0.35s）；
     - 文字在 Menu/Close 之间来回滚 3 个循环后停在目标词上。
   与 React 版的差异（都是本项目约束导致的）：
     - 面板就是既有的 .sidebar，而不是新建的 .staggered-menu-panel，
       因此桌面端常驻导航 / 折叠成图标栏的行为一行都没改；
     - 原版面板从侧边推入，这里把「面板 + 下衬层」都改成从右侧推入，
       于是作为装饰的下衬层会从面板底下掠过并在右缘露出一道彩边；
     - 没有 gsap.context / 依赖收集，改为显式保存 tween 句柄并在关闭时 kill。
   ============================================================ */
const DRAWER_BREAKPOINT = 768;
/** 缓动函数表：在下面 cubicBezier 定义之后填充（gsap 的 power1~4.out 对应这些贝塞尔）。 */
const DRAWER_EASE = {};
const DRAWER_PRELAYER_COLORS = ["rgba(123, 147, 214, 0.5)", "rgba(168, 149, 212, 0.5)", "rgba(132, 181, 219, 0.42)"];

const drawer = {
  ready: false,
  open: false,
  busy: false,
  raf: 0,
  last: 0,
  paused: false,      // 补间循环暂停（测试用）
  init: false,        // 初始化阶段只记录状态、不写 DOM，避免首屏闪一下
  endAt: 0,           // 时间轴最后一个补间的结束时刻，用于判断「还在等空档」
  queue: [],          // 已排程但未到点的补间
  tweens: [],         // 进行中的补间
  onIdle: null
};

const drawerReduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const drawerIsMobile = () => window.innerWidth <= DRAWER_BREAKPOINT;
const drawerEls = () => ({
  sidebar: $("#sidebar"),
  nav: $("#nav"),
  prelayers: $$(".sm-prelayer"),
  toggle: $("#sidebarToggle"),
  burger: $("#smBurger"),
  scrim: $("#smScrim"),
  foot: [$(".user-card"), $(".version-tag"), $("#logoutBtn")].filter(Boolean)
});
/** 逐条推入的菜单项：分组标签 + 菜单项标签，按 DOM 顺序，与 gsap 的 from:'start' 一致。 */
const drawerItems = nav => $$(".nav-label, .nav-item > span:not(.nav-ico):not(.nav-badge)", nav);

/* ---------- 补间 ---------- */
const cubicBezier = (x1, y1, x2, y2) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = t => ((ax * t + bx) * t + cx) * t;
  const dfx = t => (3 * ax * t + 2 * bx) * t + cx;
  return p => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 6; i++) {
      const d = fx(t) - p;
      if (Math.abs(d) < 1e-5) break;
      const slope = dfx(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= d / slope;
    }
    return cy * t + by * t * t + ay * t * t * t;
  };
};
DRAWER_EASE.power2 = cubicBezier(0.5, 1, 0.89, 1);
DRAWER_EASE.power3 = cubicBezier(0.215, 0.61, 0.355, 1);
DRAWER_EASE.power4 = cubicBezier(0.165, 0.84, 0.44, 1);

const px = el => {
  const r = el?.getBoundingClientRect?.();
  return { x: r?.width || 0, y: r?.height || 0 };
};
/** 目标值的唯一换算规则：
    唯一需要换算的是 draw 阶段写 CSS —— 百分比作为 `translate(X%, Y%)` 直接交给浏览器，
    所以 xPercent / yPercent 的数值「原样」保留（-100 就是 -100%），
    x / y 是像素，rotate / scale 是数值。toPx 因此只做数值化，不做单位换乘。 */
const toPx = (key, v) => {
  void key;
  return parseFloat(v) || 0;
};

/** 位移状态：像素量存 x / y，百分比量存 pctX / pctY（同 gsap：
    xPercent 与 x 并非同一个量，xPercent: -100 是「向左平移自身宽度」，
    与 x: 0 叠加后各占一项，不会互相覆盖）。 */
const transforms = new WeakMap();
const pctOf = key =>
  key === "xPercent" ? "pctX"
    : key === "yPercent" ? "pctY"
      : key.charAt(0) === "x" ? "x"
        : key.charAt(0) === "y" ? "y"
          : key;
const transformOf = (el, p) => {
  const st = transforms.get(el) || { x: 0, y: 0, pctX: 0, pctY: 0, rotate: 0, scale: 1 };
  transforms.set(el, st);
  const box = px(el);
  ["xPercent", "yPercent", "x", "y", "rotate", "scale"].forEach(k => {
    if (p[k] == null) return;
    st[pctOf(k)] = k === "rotate" || k === "scale" ? (parseFloat(p[k]) || 0) : toPx(k, p[k], box);
  });
  const pctX = st.pctX || 0, pctY = st.pctY || 0;
  const txt = (pctX || pctY ? `translate(${pctX.toFixed(2)}%, ${pctY.toFixed(2)}%) ` : "") +
    `translate3d(${st.x.toFixed(2)}px, ${st.y.toFixed(2)}px, 0)` +
    (st.rotate ? ` rotate(${st.rotate.toFixed(2)}deg)` : "") +
    (st.scale !== 1 ? ` scale(${st.scale})` : "");
  if (!drawer.paused && !drawer.init && el.style) el.style.transform = txt;
  return st;
};
/** 单条补间：每个键各自补间（xPercent 与 x 是独立量，互不覆盖），
    百分比键的终点按元素自身尺寸换算，起点沿用当前状态。 */
function drawerTween(el, props, duration, ease) {
  const cur = transforms.get(el) || { x: 0, y: 0, pctX: 0, pctY: 0, rotate: 0, scale: 1 };
  const box = px(el);
  const from = {}, targets = {}, fields = {};
  Object.keys(props).forEach(k => {
    const field = pctOf(k);
    fields[k] = field;
    from[k] = cur[field] ?? (k === "scale" ? 1 : 0);
    targets[k] = k === "rotate" || k === "scale" ? (parseFloat(props[k]) || 0) : toPx(k, props[k], box);
  });
  const tw = { el, from, targets, fields, t: 0, duration: Math.max(0.001, duration), ease };
  drawer.tweens.push(tw);
  return tw;
}

/** 时间轴：按 offset 绝对排程（替代 gsap.timeline 的 position 参数）。 */
function drawerTimeline() {
  const items = [];
  const tl = {
    onDone: null,
    at(offset, el, props, duration, ease) {
      items.push({ at: offset || 0, el, props, duration, ease });
      return tl;
    },
    play(start) {
      // 基准时刻必须与 offset / duration 同为「秒」：performance.now() 给的是毫秒，要换算
      const t0 = start == null ? performance.now() / 1000 : start;
      let end = t0;
      items.forEach(it => {
        // 负数 offset 会使 startAt 早于首帧时间，导致该补间永远不被触发，这里夹到 0
        it.startAt = t0 + Math.max(0, it.at);
        end = Math.max(end, it.startAt + it.duration);
      });
      drawer.queue.push(...items);
      drawer.endAt = Math.max(drawer.endAt, end);
      drawerKick();
      return end;
    }
  };
  return tl;
}

function drawerKick() {
  if (drawer.paused || drawer.raf) return;
  drawer.raf = requestAnimationFrame(drawerTick);
}

/** rAF 给的是毫秒时间戳，而时间轴的 offset / duration 都是秒（与 gsap 一致），
    所以统一在进入 tick 时换算成秒，避免「50 被当成 50 秒」这类单位错配。 */
function drawerTick(ts) {
  drawer.raf = 0;
  const now = ts / 1000;
  const first = drawer.last == null;
  // 首帧不推进时间（只消化到期排程），避免从 0 到 now 之间那段长间隔被当成一帧时长
  const dt = first ? 0 : Math.min(0.05, Math.max(0.001, now - drawer.last));
  drawer.last = now;
  // 到点的排程转成补间。这里必须 paused 为假，否则 drawerTween 量尺寸时不会写 DOM。
  drawer.queue = drawer.queue.filter(q => {
    if (q.startAt > now) return true;
    drawerTween(q.el, q.props, q.duration, q.ease);
    return false;
  });
  drawer.tweens = drawer.tweens.filter(tw => {
    tw.t += dt;
    const p = Math.min(1, tw.t / tw.duration);
    const eased = tw.ease ? tw.ease(p) : p;
    const props = {};
    Object.keys(tw.targets).forEach(k => {
      props[k] = tw.from[k] + (tw.targets[k] - tw.from[k]) * eased;
    });
    transformOf(tw.el, props);
    return p < 1;
  });
  // 队列里还有未到点/未完成的排程，或时间轴还有空档，都要继续排帧
  if (drawer.tweens.length || drawer.queue.length || now < (drawer.endAt || 0)) drawerKick();
  else {
    drawer.endAt = 0;
    drawer.busy = false;
    drawer.onIdle?.();
  }
}

/* ---------- 开关 ---------- */
function setDrawerHidden(hidden) {
  const { sidebar, toggle } = drawerEls();
  if (!sidebar) return;
  sidebar.setAttribute("aria-hidden", hidden ? "true" : "false");
  if (toggle) {
    toggle.setAttribute("aria-expanded", hidden ? "false" : "true");
    toggle.setAttribute("aria-label", hidden ? "打开菜单" : "关闭菜单");
    toggle.setAttribute("title", hidden ? "打开菜单" : "折叠侧边栏");
  }
}

function buildDrawerTimeline() {
  const { sidebar, nav, prelayers } = drawerEls();
  if (!sidebar) return null;
  const items = drawerItems(nav);
  const offscreen = 100;                       // 全部从右侧推入（见文件头说明）
  const reduce = drawerReduce();
  const dur = v => (reduce ? 0.001 : v);
  const tl = drawerTimeline();

  // 先归位到「场外」起始态（等价原版的 gsap.set(...)）
  items.forEach(el => transformOf(el, { yPercent: 140, rotate: 10 }));
  prelayers.forEach(el => transformOf(el, { xPercent: offscreen, x: 0 }));
  transformOf(sidebar, { xPercent: -offscreen, x: 0 });

  // 1) 下衬层错峰 0.07s，各 0.5s
  prelayers.forEach((el, i) => {
    const nudge = parseFloat(el.dataset.nudge || "0") || 0;
    tl.at(reduce ? 0 : i * 0.07, el, { xPercent: 0, x: nudge }, dur(0.5), DRAWER_EASE.power4);
  });
  // 2) 面板在最后一层之后 0.08s 插入，0.65s
  const lastTime = reduce ? 0 : (prelayers.length - 1) * 0.07;
  const panelInsert = lastTime + (prelayers.length ? 0.08 : 0);
  tl.at(panelInsert, sidebar, { xPercent: 0, x: 0 }, dur(0.65), DRAWER_EASE.power4);
  // 3) 菜单项在面板起点 +15% 处开始，每条错峰 0.1s，1s
  const itemsStart = panelInsert + dur(0.65) * 0.15;
  const step = reduce ? 0 : 0.1;
  items.forEach((el, i) => {
    tl.at(itemsStart + i * step, el, { yPercent: 0, rotate: 0 }, dur(1), DRAWER_EASE.power4);
  });
  return tl;
}

/** 开关开始时收尾初始化：把「只记录不写 DOM」的遮挡态真正落到元素上。 */
function activateDrawer() {
  if (!drawer.init) return;
  drawer.init = false;
  const { sidebar } = drawerEls();
  if (sidebar) transformOf(sidebar, { xPercent: -100, x: 0 });
  drawerEls().prelayers.forEach(el => transformOf(el, { xPercent: 100, x: 0 }));
  const { nav } = drawerEls();
  if (nav) drawerItems(nav).forEach(el => transformOf(el, { yPercent: 140, rotate: 10 }));
  primeDrawerFoot();
}

function openDrawer() {
  const els = drawerEls();
  const sidebar = els.sidebar;
  if (!sidebar || !drawerIsMobile() || drawer.open || drawer.busy) return;
  activateDrawer();
  drawer.open = true;
  drawer.busy = true;
  drawer.queue = [];
  drawer.tweens = [];
  drawer.endAt = 0;
  setDrawerHidden(false);
  sidebar.classList.add("open");
  document.body.dataset.drawer = "open";
  if (els.nav) els.nav.setAttribute("data-numbering", "");
  const tl = buildDrawerTimeline();
  animateBurger(true);
  animateDrawerFoot(true);
  drawer.onIdle = () => { drawer.busy = false; };
  if (tl) tl.play();
}

function closeDrawer(immediate = false) {
  const els = drawerEls();
  const sidebar = els.sidebar;
  if (!sidebar || !drawer.open) return;
  activateDrawer();
  drawer.open = false;
  drawer.queue = [];
  drawer.tweens = [];
  drawer.endAt = 0;
  document.body.dataset.drawer = "";
  if (els.nav) els.nav.removeAttribute("data-numbering");

  if (immediate || drawerReduce()) {
    drawer.busy = false;
    drawer.onIdle = null;
    transformOf(sidebar, { xPercent: -100, x: 0 });
    els.prelayers.forEach(el => transformOf(el, { xPercent: 100, x: 0 }));
    drawerItems(els.nav).forEach(el => transformOf(el, { yPercent: 140, rotate: 10 }));
    finishClose();
    return;
  }
  drawer.busy = true;
  const tl = drawerTimeline();
  tl.at(0, sidebar, { xPercent: -100, x: 0 }, 0.32, DRAWER_EASE.power3);
  els.prelayers.forEach(el => tl.at(0, el, { xPercent: 100, x: 0 }, 0.32, DRAWER_EASE.power3));
  animateBurger(false);
  animateDrawerFoot(false);
  drawer.onIdle = finishClose;
  tl.play();
}

function finishClose() {
  const els = drawerEls();
  const sidebar = els.sidebar;
  if (!sidebar || drawer.open) return;
  drawer.busy = false;
  sidebar.classList.remove("open");
  sidebar.style.visibility = "";
  transformOf(sidebar, { xPercent: -100, x: 0 });
  els.prelayers.forEach(el => transformOf(el, { xPercent: 100, x: 0 }));
  drawerItems(els.nav).forEach(el => transformOf(el, { yPercent: 140, rotate: 10 }));
  animateDrawerFoot(false);
  setDrawerHidden(true);
}

function toggleDrawer() {
  if (drawer.open) closeDrawer();
  else openDrawer();
}

/** 汉堡图标：抽出时整体旋转 225°（原版 animateIcon）。 */
function animateBurger(opening) {
  const { burger } = drawerEls();
  if (!burger) return;
  drawer.tweens = drawer.tweens.filter(tw => tw.el !== burger);
  drawerTween(burger, { rotate: opening ? 225 : 0 },
    drawerReduce() ? 0.001 : (opening ? 0.8 : 0.35),
    opening ? DRAWER_EASE.power4 : DRAWER_EASE.power2);
  drawerKick();
}

/** 底部用户卡 / 版本号 / 退出按钮：最后一批上推淡入（对应原版 socials 的 stagger）。 */
function animateDrawerFoot(opening) {
  const { foot } = drawerEls();
  const d = drawerReduce() ? 0.001 : (opening ? 0.55 : 0.2);
  foot.forEach(el => {
    drawer.tweens = drawer.tweens.filter(tw => tw.el !== el);
    if (!opening) { el.style.opacity = "0"; return; }
    el.style.opacity = "1";
    drawerTween(el, { yPercent: 0, y: 0 }, d, DRAWER_EASE.power3);
  });
  drawerKick();
}

/** 底部信息预置为隐藏态（y:25 + opacity:0），等价原版 gsap.set(socialLinks, ...)。 */
function primeDrawerFoot() {
  drawerEls().foot.forEach(el => {
    transformOf(el, { yPercent: 0, y: 25 });
    el.style.opacity = "0";
  });
}

/** 清掉底部信息身上的抽屉态（内联 opacity / transform）。
    抽屉那套「预置为透明再淡入」只在移动端成立；桌面端侧边栏常驻，
    内联 opacity:0 会让用户卡与退出按钮永久消失，所以切回桌面时必须清干净。 */
function clearDrawerFoot() {
  drawerEls().foot.forEach(el => {
    drawer.tweens = drawer.tweens.filter(tw => tw.el !== el);
    if (el.style.removeProperty) {
      el.style.removeProperty("opacity");
      el.style.removeProperty("transform");
    } else {
      el.style.opacity = "";
      el.style.transform = "";
    }
    transforms.delete(el);
  });
}

function initDrawer() {
  const { sidebar, toggle, scrim } = drawerEls();
  if (!sidebar || !toggle) return;
  if (!drawer.ready) {
    drawer.ready = true;
    scrim?.addEventListener("click", () => closeDrawer());
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && drawer.open) closeDrawer();
    });
    window.addEventListener("resize", () => {
      if (!drawerIsMobile() && drawer.open) closeDrawer(true);
      syncDrawerMode();
    });
  }
  // 下衬层配色（原版由 colors prop 传入，这里取品牌色）
  $$(".sm-prelayer").forEach((el, i) => {
    el.style.background = DRAWER_PRELAYER_COLORS[i % DRAWER_PRELAYER_COLORS.length];
  });
  // 起始态一次性写好，之后由补间接管；初始化期间不写 DOM，避免首屏闪动
  drawer.init = true;
  // 只有移动端才需要「底部信息先透明再淡入」；桌面端常驻侧边栏必须保持可见
  if (drawerIsMobile()) primeDrawerFoot();
  else clearDrawerFoot();
  transformOf(sidebar, { xPercent: -100, x: 0 });
  drawerEls().prelayers.forEach(el => transformOf(el, { xPercent: 100, x: 0 }));
  drawerEls().nav && drawerItems(drawerEls().nav).forEach(el => transformOf(el, { yPercent: 140, rotate: 10 }));
  drawer.init = false;
  syncDrawerMode();
}

/** 宽度跨过断点时同步可访问性状态与序号。 */
function syncDrawerMode() {
  const { sidebar, nav } = drawerEls();
  if (!sidebar) return;
  if (drawerIsMobile()) {
    setDrawerHidden(!drawer.open);
  } else {
    sidebar.removeAttribute("aria-hidden");
    // 桌面端侧边栏常驻：清掉移动端那套隐藏/位移，否则用户卡与退出按钮看不见
    clearDrawerFoot();
    const toggle = $("#sidebarToggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", sidebar.classList.contains("collapsed") ? "false" : "true");
      toggle.setAttribute("title", "折叠侧边栏");
      toggle.setAttribute("aria-label", "折叠侧边栏");
    }
    if (nav) nav.removeAttribute("data-numbering");
  }
}

