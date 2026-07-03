// ===== FIDELITY MODE (PDF 原版) =====
// pdf.js canvas+TextLayer 单页翻页渲染 + Hypothesis 三件套锚划线。
// 设计案 docs/pdf-fidelity-plan.md；reflow 一概不走这里。
//
// 坐标约定：annotation.rects 与 words bbox 同一坐标系——PDF points、原点左上、y 向下
// （pymupdf 的约定）。屏幕坐标 = pdf 坐标 × 当前 scale。rotate ≠ 0 的 PDF 不画
// overlay/不收 rects（quote 锚仍在，MCP 与批注面板不受影响）。

const FID_VENDOR = './vendor/pdfjs/pdf.min.mjs';
const FID_WORKER = './vendor/pdfjs/pdf.worker.min.mjs';
const FID_CTX_CHARS = 32;          // prefix/suffix 截断，跟设计案一致
const FID_PAGE_CACHE_MAX = 12;     // /pdf-pages/:n 响应缓存（text+words）

let _fidLib = null;                // pdf.js module（lazy import 一次）
let _fidDoc = null;                // 当前打开的 PDFDocumentProxy
let _fidLoadingTask = null;        // getDocument 的 task（v6 destroy 只在这上面）
let _fidDocBookId = null;
let _fidTextLayer = null;          // 当前页 TextLayer 实例（翻页时 cancel）
let _fidRenderTask = null;         // 当前页 canvas render task（翻页时 cancel）
let _fidRenderSeq = 0;             // 竞态票据：快速翻页只让最后一次落地
let _fidScale = 1;                 // 当前渲染 scale（screen px / pdf point）
let _fidRotate = 0;                // 当前 PDF 页 rotate（≠0 时 overlay 降级）
const _fidPageCache = new Map();   // n -> {text, words}

// 阅读区局部缩放（音音 07-04：手机上教科书字太小）。1 = fit-width。
// 重渲染是矢量放大（字锐利），不是位图拉伸。
const FID_ZOOM_MIN = 1, FID_ZOOM_MAX = 3, FID_ZOOM_STEP = 0.25;
let _fidZoom = Math.min(FID_ZOOM_MAX, Math.max(FID_ZOOM_MIN,
  parseFloat(localStorage.getItem('tasogare-fid-zoom')) || 1));

function isFid() {
  return state.currentBook?.mode === 'fidelity';
}

async function fidLib() {
  if (!_fidLib) {
    _fidLib = await import(FID_VENDOR);
    _fidLib.GlobalWorkerOptions.workerSrc = FID_WORKER;
  }
  return _fidLib;
}

async function fidGetDoc() {
  const book = state.currentBook;
  if (_fidDoc && _fidDocBookId === book.id) return _fidDoc;
  await fidCloseDoc();
  const lib = await fidLib();
  _fidLoadingTask = lib.getDocument({ url: `${API}/books/${book.id}/pdf` });
  _fidDoc = await _fidLoadingTask.promise;
  _fidDocBookId = book.id;
  return _fidDoc;
}

// WebView 下 worker 泄漏未修（pdf.js #20198），换书/回书架时主动销毁。
// v6 的 destroy 在 loadingTask 上（PDFDocumentProxy 上已移除）。
async function fidCloseDoc() {
  if (_fidTextLayer) { try { _fidTextLayer.cancel(); } catch {} _fidTextLayer = null; }
  if (_fidRenderTask) { try { _fidRenderTask.cancel(); } catch {} _fidRenderTask = null; }
  if (_fidLoadingTask) { try { await _fidLoadingTask.destroy(); } catch {} }
  _fidLoadingTask = null;
  _fidDoc = null;
  _fidDocBookId = null;
  _fidPageCache.clear();
}

async function fidPageData(n) {
  if (_fidPageCache.has(n)) {
    const hit = _fidPageCache.get(n);
    _fidPageCache.delete(n); _fidPageCache.set(n, hit);   // LRU touch
    return hit;
  }
  const data = await api(`/books/${state.currentBook.id}/pdf-pages/${n}`);
  _fidPageCache.set(n, data);
  while (_fidPageCache.size > FID_PAGE_CACHE_MAX) {
    _fidPageCache.delete(_fidPageCache.keys().next().value);
  }
  return data;
}

// ===== 渲染 =====

async function fidelityMount() {
  const stage = document.getElementById('fidStage');
  if (!stage) return;
  if (!stage.dataset.pinchBound) {   // render() 重建 DOM 后是新元素，重新绑
    stage.dataset.pinchBound = '1';
    fidInitPinch(stage);
    fidZoomLabel();
  }
  const seq = ++_fidRenderSeq;
  const loadingEl = document.getElementById('fidLoading');
  try {
    const doc = await fidGetDoc();
    if (seq !== _fidRenderSeq) return;
    const page = await doc.getPage(state.currentPage);
    if (seq !== _fidRenderSeq) return;

    _fidRotate = (page.rotate || 0) % 360;
    const wrap = document.getElementById('fidWrap');
    const canvas = document.getElementById('fidCanvas');
    const textDiv = document.getElementById('fidText');
    const overlay = document.getElementById('fidOverlay');

    // fit-width × 用户缩放。stage 是滚动容器，clientWidth 不随内容变，fit 基准稳定
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = (stage.clientWidth / baseViewport.width) * _fidZoom;
    _fidScale = scale;
    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    const renderViewport = dpr !== 1 ? page.getViewport({ scale: scale * dpr }) : viewport;

    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    wrap.style.width = `${viewport.width}px`;
    wrap.style.height = `${viewport.height}px`;

    if (_fidRenderTask) { try { _fidRenderTask.cancel(); } catch {} }
    // intent:'print' 不是笔误——display intent 的绘制循环走 requestAnimationFrame，
    // offscreen/后台 WebView 里 rAF 冻结会让 render promise 永远挂起；print intent
    // 走 setTimeout 调度。我们输出纯静态位图（无表单/annotation layer），两种 intent
    // 视觉一致。
    _fidRenderTask = page.render({ canvas, viewport: renderViewport, intent: 'print' });
    await _fidRenderTask.promise;
    if (seq !== _fidRenderSeq) return;

    // TextLayer（透明可选中文字层）
    if (_fidTextLayer) { try { _fidTextLayer.cancel(); } catch {} }
    textDiv.innerHTML = '';
    textDiv.style.setProperty('--scale-factor', String(scale));
    textDiv.style.setProperty('--total-scale-factor', String(scale));
    const lib = await fidLib();
    _fidTextLayer = new lib.TextLayer({
      textContentSource: page.streamTextContent(),
      container: textDiv,
      viewport,
    });
    await _fidTextLayer.render();
    if (seq !== _fidRenderSeq) return;

    await renderFidelityOverlay(overlay, seq);
    if (loadingEl) loadingEl.classList.remove('visible');
  } catch (e) {
    if (e?.name === 'RenderingCancelledException') return;
    console.error('[fidelity] render failed:', e);
    if (seq === _fidRenderSeq && loadingEl) {
      loadingEl.textContent = 'render failed — ' + (e.message || e);
      loadingEl.classList.add('visible');
    }
  }
}

// ===== overlay：双色高亮 + 克先生批注下划线 =====

async function renderFidelityOverlay(overlay, seq) {
  if (!overlay) return;
  overlay.innerHTML = '';
  if (_fidRotate !== 0) return;   // 旋转页降级：只读不画

  const n = state.currentPage;
  const annots = (state.annotations || []).filter(
    a => a.anchor_mode === 'fidelity' && a.pdf_page === n && (a.quote || a.rects?.length)
      && !(a.type === 'note' && a.highlight_id)   // 挂在划线上的评论不重复画，区域归 highlight
  );
  if (!annots.length) return;

  let pageData = null;
  const needResolve = annots.some(a => !a.rects || a.rects.length === 0);
  if (needResolve) {
    try { pageData = await fidPageData(n); } catch {}
    if (seq !== undefined && seq !== _fidRenderSeq) return;
  }

  for (const a of annots) {
    let rects = Array.isArray(a.rects) && a.rects.length ? a.rects : null;
    if (!rects && pageData) rects = fidQuoteToRects(a.quote, pageData.words);
    if (!rects || !rects.length) continue;
    const isKieran = a.author === '克先生';
    // highlight 实底；标在原文上的评论（note 无 highlight_id）画下划线
    const isUnderline = a.type === 'note' && !a.highlight_id;
    for (const r of rects) {
      const [x0, y0, x1, y1] = Array.isArray(r) ? r : [r.x0, r.y0, r.x1, r.y1];
      const div = document.createElement('div');
      div.className = `fid-hl ${isKieran ? 'kieran' : 'yinyin'}${isUnderline ? ' underline' : ''}`;
      div.style.left = `${x0 * _fidScale}px`;
      div.style.top = `${y0 * _fidScale}px`;
      div.style.width = `${(x1 - x0) * _fidScale}px`;
      div.style.height = `${(y1 - y0) * _fidScale}px`;
      div.dataset.annotId = a.id;
      overlay.appendChild(div);
    }
  }
}

// overlay 在 textLayer 之下（不挡选择），点击走 stage 级 hit-test
function fidHitTest(clientX, clientY) {
  const wrap = document.getElementById('fidWrap');
  if (!wrap || _fidScale <= 0) return null;
  const box = wrap.getBoundingClientRect();
  const px = (clientX - box.left) / _fidScale;
  const py = (clientY - box.top) / _fidScale;
  const annots = (state.annotations || []).filter(
    a => a.anchor_mode === 'fidelity' && a.pdf_page === state.currentPage
  );
  // 后画的在视觉上层，倒序命中
  for (let i = annots.length - 1; i >= 0; i--) {
    const a = annots[i];
    const rects = Array.isArray(a.rects) ? a.rects : [];
    for (const r of rects) {
      const [x0, y0, x1, y1] = Array.isArray(r) ? r : [r.x0, r.y0, r.x1, r.y1];
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) return a;
    }
  }
  // rects 缺失的（克先生 MCP 批注）：退化用 overlay DOM 命中
  const el = document.elementFromPoint(clientX, clientY);
  const hlDiv = el?.closest?.('.fid-hl');
  if (hlDiv) return (state.annotations || []).find(a => a.id === hlDiv.dataset.annotId) || null;
  return null;
}

// ===== quote → rects（渲染慢路径；rects 缺失时按 words 解析）=====
// words: [[x0,y0,x1,y1,"word"],...]；页 text = words join ' '（extract 脚本保证），
// 所以 join 后的 char offset 能 1:1 映射回词序号。
function fidQuoteToRects(quote, words) {
  if (!quote || !Array.isArray(words) || !words.length) return null;
  const tokens = words.map(w => String(w[4]));
  const joined = tokens.join(' ');
  const nq = quote.replace(/\s+/g, ' ').trim();
  let idx = joined.indexOf(nq);
  if (idx < 0) idx = joined.toLowerCase().indexOf(nq.toLowerCase());
  if (idx < 0) return null;
  const end = idx + nq.length;

  // char range → 词序号
  const hit = [];
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const wStart = pos, wEnd = pos + tokens[i].length;
    if (wEnd > idx && wStart < end) hit.push(i);
    pos = wEnd + 1;   // join 的空格
    if (wStart >= end) break;
  }
  if (!hit.length) return null;

  // 按行聚类（y 中心接近 = 同行），每行 union
  const lines = [];
  for (const i of hit) {
    const [x0, y0, x1, y1] = words[i];
    const cy = (y0 + y1) / 2, h = y1 - y0;
    const line = lines.find(L => Math.abs(L.cy - cy) < Math.max(h, L.h) * 0.6);
    if (line) {
      line.x0 = Math.min(line.x0, x0); line.y0 = Math.min(line.y0, y0);
      line.x1 = Math.max(line.x1, x1); line.y1 = Math.max(line.y1, y1);
      line.cy = (line.y0 + line.y1) / 2; line.h = line.y1 - line.y0;
    } else {
      lines.push({ x0, y0, x1, y1, cy, h });
    }
  }
  return lines.map(L => [L.x0, L.y0, L.x1, L.y1]);
}

// ===== 选区 → 三件套锚 =====
// 返回 {pdf_page, quote, prefix, suffix, position, rects}；选区不在文字层返回 null。
// position/prefix/suffix 按空白折叠后的页 text 计（backend 校验同口径）。
async function fidCollectSelection(sel) {
  if (!sel || sel.isCollapsed) return null;
  const textDiv = document.getElementById('fidText');
  if (!textDiv || !textDiv.contains(sel.anchorNode)) return null;
  const rawQuote = sel.toString();
  const quote = rawQuote.replace(/\s+/g, ' ').trim();
  if (!quote) return null;

  const n = state.currentPage;
  let prefix = '', suffix = '', position = null, resolverRects = null;
  try {
    const pageData = await fidPageData(n);
    const norm = String(pageData.text || '').replace(/\s+/g, ' ').trim();
    const idx = norm.indexOf(quote);
    if (idx >= 0) {
      position = idx;
      prefix = norm.slice(Math.max(0, idx - FID_CTX_CHARS), idx);
      suffix = norm.slice(idx + quote.length, idx + quote.length + FID_CTX_CHARS);
    }
    // words bbox 比选区 rect 准（TextLayer 的 scaleX 有微差）——resolver 命中就用它的
    resolverRects = fidQuoteToRects(quote, pageData.words);
  } catch {}

  if (resolverRects && resolverRects.length) {
    return { pdf_page: n, quote, prefix, suffix, position, rects: resolverRects };
  }

  // resolver 没命中（页内 quote 不唯一/文本差异）——退化收选区 client rects（rotate≠0 不收，quote 锚兜底）
  let rects = [];
  if (_fidRotate === 0 && _fidScale > 0) {
    const wrap = document.getElementById('fidWrap');
    const box = wrap.getBoundingClientRect();
    const seen = new Set();
    for (const r of sel.getRangeAt(0).getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      const rect = [
        Math.round(((r.left - box.left) / _fidScale) * 100) / 100,
        Math.round(((r.top - box.top) / _fidScale) * 100) / 100,
        Math.round(((r.right - box.left) / _fidScale) * 100) / 100,
        Math.round(((r.bottom - box.top) / _fidScale) * 100) / 100,
      ];
      const key = rect.join(',');
      if (!seen.has(key)) { seen.add(key); rects.push(rect); }
    }
    rects = fidMergeLineRects(rects);
  }
  return { pdf_page: n, quote, prefix, suffix, position, rects };
}

// TextLayer 一行常拆多个 span，选区 rects 碎——同行相邻的并起来
function fidMergeLineRects(rects) {
  if (rects.length < 2) return rects;
  const sorted = [...rects].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last) {
      const lastCy = (last[1] + last[3]) / 2, cy = (r[1] + r[3]) / 2;
      const h = Math.max(last[3] - last[1], r[3] - r[1]);
      if (Math.abs(cy - lastCy) < h * 0.6 && r[0] <= last[2] + h) {
        last[0] = Math.min(last[0], r[0]); last[1] = Math.min(last[1], r[1]);
        last[2] = Math.max(last[2], r[2]); last[3] = Math.max(last[3], r[3]);
        continue;
      }
    }
    out.push([...r]);
  }
  return out;
}

// ===== 写入 =====

async function addFidHighlight(anchor) {
  const annot = await api(`/books/${state.currentBook.id}/annotations`, {
    method: 'POST',
    body: JSON.stringify({ ...anchor, type: 'highlight', text: anchor.quote }),
  });
  state.annotations.push(annot);
  render();
  return annot;
}

async function addFidNote(pdfPage, quote, text, highlightId) {
  const annot = await api(`/books/${state.currentBook.id}/annotations`, {
    method: 'POST',
    body: JSON.stringify({
      pdf_page: pdfPage, quote, type: 'note', text,
      highlight_id: highlightId || null,
    }),
  });
  state.annotations.push(annot);
  renderAnnotPanel();
}

// ===== 缩放 =====

function fidZoomLabel() {
  const el = document.getElementById('fidZoomLabel');
  if (el) el.textContent = Math.round(_fidZoom * 100) + '%';
}

// anchorX：缩放前后尽量停在原屏幕位置的横向锚点（视口坐标）。
// 横向在 stage 内滚、补偿到锚点；纵向是 body 在滚，内容变高不跳位，她自己顺手一划。
function fidSetZoom(z, anchorX) {
  z = Math.min(FID_ZOOM_MAX, Math.max(FID_ZOOM_MIN, Math.round(z * 20) / 20));
  if (z === _fidZoom) return;
  const stage = document.getElementById('fidStage');
  const ratio = z / _fidZoom;
  let scrollLeft = null;
  if (stage) {
    const box = stage.getBoundingClientRect();
    const ax = anchorX !== undefined ? anchorX - box.left : box.width / 2;
    scrollLeft = (stage.scrollLeft + ax) * ratio - ax;
  }
  _fidZoom = z;
  localStorage.setItem('tasogare-fid-zoom', String(z));
  fidZoomLabel();
  fidelityMount().then(() => {
    const st = document.getElementById('fidStage');
    if (st && scrollLeft !== null) st.scrollLeft = Math.max(0, scrollLeft);
  });
}

function fidZoomBy(delta) {
  fidSetZoom(_fidZoom + delta);
}

function fidZoomReset() {
  fidSetZoom(1);
}

// 捏合缩放：两指进（选字是单指长按，互不干扰）。捏合中用 CSS transform 即时预览
// （廉价），松手后按最终倍数矢量重渲染。腱鞘炎备忘：浮钮和手势两条路并存。
let _pinch = null;
function fidInitPinch(stage) {
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    const [a, b] = e.touches;
    _pinch = {
      d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      zoom0: _fidZoom,
      midX: (a.clientX + b.clientX) / 2,
      midY: (a.clientY + b.clientY) / 2,
      f: 1,
    };
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (!_pinch || e.touches.length !== 2) return;
    e.preventDefault();   // 拦掉系统手势/滚动，缩放归我们
    const [a, b] = e.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    let f = d / _pinch.d0;
    // 预览也夹在允许范围内，别让画面弹回
    f = Math.min(FID_ZOOM_MAX / _pinch.zoom0, Math.max(FID_ZOOM_MIN / _pinch.zoom0, f));
    _pinch.f = f;
    const wrap = document.getElementById('fidWrap');
    if (wrap) {
      const wb = wrap.getBoundingClientRect();
      wrap.style.transformOrigin = `${_pinch.midX - wb.left}px ${_pinch.midY - wb.top}px`;
      wrap.style.transform = `scale(${f})`;
    }
  }, { passive: false });
  const end = () => {
    if (!_pinch) return;
    const { zoom0, f, midX } = _pinch;
    _pinch = null;
    const wrap = document.getElementById('fidWrap');
    if (wrap) { wrap.style.transform = ''; wrap.style.transformOrigin = ''; }
    if (Math.abs(f - 1) > 0.02) fidSetZoom(zoom0 * f, midX);
  };
  stage.addEventListener('touchend', end, { passive: true });
  stage.addEventListener('touchcancel', end, { passive: true });
}

// resize（转屏/分屏）→ 重排当前页；debounce
let _fidResizeTimer = null;
window.addEventListener('resize', () => {
  if (!isFid() || state.view !== 'reading') return;
  clearTimeout(_fidResizeTimer);
  _fidResizeTimer = setTimeout(fidelityMount, 200);
});
