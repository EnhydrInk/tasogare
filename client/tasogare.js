const API = '/api';
const PAGES_SIZE = 30;

const SVG = {
  chevronLeft: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M10 3L5 8l5 5"/></svg>',
  chevronRight: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M6 3l5 5-5 5"/></svg>',
  chevronDown: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3 6l5 5 5-5"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M8 3v10M3 8h10"/></svg>',
  arrowRight: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  note: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="2" width="10" height="12" rx="1"/><path d="M5 5h6M5 7.5h6M5 10h3"/></svg>',
  bookmark: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1"><path d="M4 2h8v12l-4-3-4 3z"/></svg>',
  bookmarkFill: '<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="0.5"><path d="M4 2h8v12l-4-3-4 3z"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  annotations: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3" y="2" width="14" height="16" rx="1.5"/><path d="M6 6h8M6 9h8M6 12h5"/></svg>',
  vocabList: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3" y="2" width="14" height="16" rx="1.5"/><path d="M6 6h3M6 9h5M6 12h4"/><circle cx="13" cy="13" r="3"/><path d="M13 11.5v3M11.5 13h3"/></svg>',
  fontsize: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 15L8 5h1l4 10"/><path d="M5.5 12h6"/><path d="M14 15l2-5h.5l2 5"/><path d="M14.8 13h3.5"/></svg>',
  pencil: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z"/></svg>',
};

let state = {
  view: 'shelf',
  books: [],
  currentBook: null,
  currentPage: 1,
  totalPages: 0,
  paragraphs: [],
  annotations: [],
  bookmark: null,
  nightMode: localStorage.getItem('tasogare-night') === '1',
  loading: false,
  vocab: [],
  toc: [],
  annotFilter: null,
  // book detail
  detailBook: null,
  detailAnnotations: [],
  detailExpandedParas: new Set(),
  // context menu
  ctxMenu: null,
  // annotation panel
  panelOpen: false,
  panelParaId: null,
  panelHighlightText: null,
  panelAnnotId: null,
  // fidelity 书的 panel 锚（panelParaId 的 PDF 页版；两套字段不复用）
  panelPdfPage: null,
  panelQuote: null,
};

// ===== UTILITY =====
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ===== API =====
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

// ===== DATA LOADING =====
async function loadBooks() {
  state.loading = true; render();
  const books = await api('/books');
  books.sort((a, b) => {
    const at = a.progress?.updated_at || a.created_at || '';
    const bt = b.progress?.updated_at || b.created_at || '';
    return bt.localeCompare(at);
  });
  state.books = books;
  state.loading = false; render();
}

async function uploadFile(file, mode) {
  // PDF 先问一嘴：重排（纯文本分页）还是原版（pdf.js 渲染，公式书用）
  if (!mode && /\.pdf$/i.test(file.name)) {
    showUploadModePicker(file);
    return;
  }
  state.loading = true; render();
  try {
    const form = new FormData();
    form.append('file', file);
    if (mode) form.append('mode', mode);
    const res = await fetch(API + '/upload-book', { method: 'POST', body: form });
    const result = await res.json();
    if (result.ok) {
      await loadBooks();
    } else {
      alert(result.error || 'Upload failed');
      state.loading = false; render();
    }
  } catch (e) {
    alert('Upload failed: ' + e.message);
    state.loading = false; render();
  }
}

function showUploadModePicker(file) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box">
      <div class="dialog-text">How should this PDF be read?</div>
      <div class="mode-pick" id="modePickReflow">
        <div class="mode-pick-name">Reflow · 重排</div>
        <div class="mode-pick-desc">纯文本分页，可调字号。小说、散文。</div>
      </div>
      <div class="mode-pick" id="modePickFidelity">
        <div class="mode-pick-name">Fidelity · 原版</div>
        <div class="mode-pick-desc">保留原版排版。公式、图表、教科书。</div>
      </div>
      <div class="dialog-actions">
        <button class="dialog-btn" onclick="this.closest('.dialog-overlay').remove()">Cancel</button>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  overlay.querySelector('#modePickReflow').addEventListener('click', () => { overlay.remove(); uploadFile(file, 'reflow'); });
  overlay.querySelector('#modePickFidelity').addEventListener('click', () => { overlay.remove(); uploadFile(file, 'fidelity'); });
}

async function openDetail(id) {
  state.loading = true; render();
  const books = await api('/books');
  const book = books.find(b => b.id === id);
  if (!book) { state.loading = false; render(); return; }
  const annots = await api('/books/' + id + '/annotations');
  state.detailBook = book;
  state.detailAnnotations = annots || [];
  state.detailExpandedParas = new Set();
  state.view = 'detail';
  state.loading = false; render();
}

async function openBook(id) {
  state.loading = true; render();
  const book = await api('/books/' + id);
  state.currentBook = book;
  if (book.mode === 'fidelity') {
    // fidelity：bookmark 是段落语义，不适用；进度就是 PDF 页
    state.currentPage = Math.max(1, book.progress?.page || 1);
    state.bookmark = null;
    state.paragraphs = [];
    state.toc = [];
    state.annotations = (await api('/books/' + id + '/annotations')) || [];
    state.vocab = (await api('/books/' + id + '/vocab')) || [];
    await loadPage();
    state.view = 'reading';
    state.loading = false; render();
    return;
  }
  const bmData = await api('/books/' + id + '/bookmarks');
  const bmPara = bmData?.bookmark || null;
  if (bmPara) {
    const pageData = await api('/books/' + id + '/page-for/' + bmPara);
    state.currentPage = pageData?.page || (book.progress?.page || 1);
  } else {
    state.currentPage = (book.progress?.page || 1) || 1;
  }
  if (state.currentPage < 1) state.currentPage = 1;
  const annots = await api('/books/' + id + '/annotations');
  state.annotations = annots || [];
  state.bookmark = bmPara;
  const vc = await api('/books/' + id + '/vocab');
  state.vocab = vc || [];
  await loadPage();
  state.view = 'reading';
  await loadToc();
  state.loading = false; render();
  if (state.bookmark) {
    const bmEl = document.querySelector(`.paragraph[data-pid="${state.bookmark}"]`);
    if (bmEl) setTimeout(() => bmEl.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }
}

async function loadPage() {
  if (isFid()) {
    // 正文由 pdf.js 画（render 后 fidelityMount），这里只走进度上报
    state.paragraphs = [];
    state.totalPages = state.currentBook.page_count || 0;
    api(`/books/${state.currentBook.id}/progress`, {
      method: 'PUT',
      body: JSON.stringify({ page: state.currentPage }),
    });
    return;
  }
  const data = await api(`/books/${state.currentBook.id}/pages/${state.currentPage}`);
  state.paragraphs = data.paragraphs;
  state.totalPages = data.total_pages;
  api(`/books/${state.currentBook.id}/progress`, {
    method: 'PUT',
    body: JSON.stringify({ page: state.currentPage }),
  });
}

async function goPage(p) {
  if (p < 1 || p > state.totalPages || state.loading) return;
  state.currentPage = p;
  state.loading = true; render();
  await loadPage();
  state.loading = false; render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== ANNOTATIONS =====
async function addHighlight(paraId, text) {
  const annot = await api(`/books/${state.currentBook.id}/annotations`, {
    method: 'POST',
    body: JSON.stringify({ paragraph_id: paraId, type: 'highlight', text: text }),
  });
  state.annotations.push(annot);
  render();
  return annot;
}

async function addNote(paraId, text) {
  const annot = await api(`/books/${state.currentBook.id}/annotations`, {
    method: 'POST',
    body: JSON.stringify({ paragraph_id: paraId, type: 'note', text: text }),
  });
  state.annotations.push(annot);
  renderAnnotPanel();
}

async function deleteAnnotation(annotId) {
  await api(`/books/${state.currentBook.id}/annotations/${annotId}`, { method: 'DELETE' });
  state.annotations = state.annotations.filter(a => a.id !== annotId);
  render();
}

async function toggleBookmark(paraId) {
  const result = await api(`/books/${state.currentBook.id}/bookmarks`, {
    method: 'POST',
    body: JSON.stringify({ paragraph_id: paraId }),
  });
  state.bookmark = result.action === 'set' ? paraId : null;
  render();
}

async function deleteBook(id) {
  await api('/books/' + id, { method: 'DELETE' });
  state.view = 'shelf';
  state.detailBook = null;
  await loadBooks();
}

async function renameBook(id) {
  showDialog('Rename', 'New title:', '', async (name) => {
    if (!name) return;
    await api(`/books/${id}/title`, { method: 'PUT', body: JSON.stringify({ title: name }) });
    if (state.currentBook?.id === id) state.currentBook.title = name;
    if (state.detailBook?.id === id) state.detailBook.title = name;
    await loadBooks();
  });
}

// ===== VOCAB =====
async function addVocab(word, paraId, fidPage) {
  showDialog('Add vocab', 'Note for "' + word + '":', '', async (note) => {
    const v = await api(`/books/${state.currentBook.id}/vocab`, {
      method: 'POST',
      body: JSON.stringify({
        word,
        paragraph_id: paraId || null,
        pdf_page: fidPage || null,
        note: note || '',
      }),
    });
    state.vocab.push(v);
    render();
  });
}

async function deleteVocab(vid) {
  if (!confirm('Delete this vocab entry?')) return;
  await api(`/books/${state.currentBook.id}/vocab/${vid}`, { method: 'DELETE' });
  state.vocab = state.vocab.filter(v => v.id !== vid);
  render();
}

function editVocab(vid) {
  const entry = state.vocab.find(v => v.id === vid);
  if (!entry) return;
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box">
      <div class="dialog-text">Edit vocab</div>
      <input class="dialog-input" id="editVocabWord" value="${esc(entry.word || '')}" placeholder="word" style="margin-bottom:8px">
      <input class="dialog-input" id="editVocabNote" value="${esc(entry.note || '')}" placeholder="note">
      <div class="dialog-actions">
        <button class="dialog-btn" onclick="this.closest('.dialog-overlay').remove()">Cancel</button>
        <button class="dialog-btn primary" id="editVocabSave">Save</button>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('editVocabWord')?.focus(), 50);
  document.getElementById('editVocabSave').addEventListener('click', async () => {
    const word = document.getElementById('editVocabWord').value.trim();
    const note = document.getElementById('editVocabNote').value;
    if (!word) return;
    const updated = await api(`/books/${state.currentBook.id}/vocab/${vid}`, {
      method: 'PUT',
      body: JSON.stringify({ word, note }),
    });
    const idx = state.vocab.findIndex(v => v.id === vid);
    if (idx >= 0) { state.vocab[idx].word = updated.word; state.vocab[idx].note = updated.note; }
    overlay.remove();
    render();
  });
}

async function jumpToVocab(paraId) {
  if (!paraId || !state.currentBook) return;
  const data = await api(`/books/${state.currentBook.id}/page-for/${paraId}`);
  if (data && data.page) {
    state.currentPage = data.page;
    state.view = 'reading';
    state.loading = true; render();
    await loadPage();
    state.loading = false; render();
    setTimeout(() => {
      const el = document.querySelector(`[data-pid="${paraId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }
}

// ===== DIALOG =====
let dialogCallback = null;

function showDialog(title, message, defaultValue, cb) {
  dialogCallback = cb;
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box">
      <div class="dialog-text">${esc(message)}</div>
      <input class="dialog-input" id="dialogInput" value="${esc(defaultValue || '')}">
      <div class="dialog-actions">
        <button class="dialog-btn" onclick="closeDialog(false)">Cancel</button>
        <button class="dialog-btn primary" onclick="closeDialog(true)">OK</button>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialog(false); });
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('dialogInput')?.focus(), 50);
}

function closeDialog(ok) {
  const overlay = document.querySelector('.dialog-overlay');
  if (!overlay) return;
  const val = document.getElementById('dialogInput')?.value;
  overlay.remove();
  if (ok && dialogCallback) dialogCallback(val);
  dialogCallback = null;
}

function showConfirmDialog(message, cb) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box">
      <div class="dialog-text">${message}</div>
      <div class="dialog-actions">
        <button class="dialog-btn" onclick="this.closest('.dialog-overlay').remove()">Cancel</button>
        <button class="dialog-btn danger" id="confirmBtn">Delete</button>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  document.getElementById('confirmBtn').addEventListener('click', () => {
    overlay.remove();
    cb();
  });
}

// ===== CONTEXT MENU =====
function showCtxMenu(bookId, e) {
  e.stopPropagation();
  e.preventDefault();
  hideCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.top = e.clientY + 'px';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  menu.style.position = 'fixed';
  menu.innerHTML = `
    <button class="ctx-item" onclick="hideCtxMenu();renameBook('${bookId}')">Rename</button>
    <button class="ctx-item danger" onclick="hideCtxMenu();showConfirmDialog('Delete this book?', ()=>deleteBook('${bookId}'))">Delete</button>`;
  document.body.appendChild(menu);
  state.ctxMenu = menu;
  setTimeout(() => document.addEventListener('click', hideCtxMenu, { once: true }), 10);
}

function hideCtxMenu() {
  if (state.ctxMenu) { state.ctxMenu.remove(); state.ctxMenu = null; }
}

// ===== HIGHLIGHT TEXT MATCHING =====
// Given a paragraph's plain text and a list of highlights for it,
// produce HTML with <mark> tags wrapping the highlighted substrings.
function renderHighlightedText(plainText, highlights) {
  if (!highlights || highlights.length === 0) return esc(plainText);

  // Build a list of ranges
  const ranges = [];
  for (const hl of highlights) {
    if (!hl.text) continue;
    const hlText = hl.text;
    // Find all occurrences of this highlight text in the paragraph
    let searchFrom = 0;
    while (true) {
      const idx = plainText.indexOf(hlText, searchFrom);
      if (idx === -1) break;
      ranges.push({
        start: idx,
        end: idx + hlText.length,
        id: hl.id,
        author: hl.author,
      });
      searchFrom = idx + 1; // Only first match usually, but handle edge cases
      break; // Just use first match per highlight
    }
  }

  if (ranges.length === 0) return esc(plainText);

  // Sort ranges by start position
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);

  // Build character-level author map for overlapping highlights
  const charMap = new Array(plainText.length).fill(null);
  const charAnnotIds = new Array(plainText.length).fill(null);

  for (const r of ranges) {
    for (let i = r.start; i < r.end; i++) {
      const isKieran = r.author === '克先生';
      if (charMap[i] === null) {
        charMap[i] = isKieran ? 'kieran' : 'yinyin';
        charAnnotIds[i] = [r.id];
      } else if (charMap[i] === 'kieran' && !isKieran) {
        charMap[i] = 'both';
        charAnnotIds[i].push(r.id);
      } else if (charMap[i] === 'yinyin' && isKieran) {
        charMap[i] = 'both';
        charAnnotIds[i].push(r.id);
      } else {
        if (charAnnotIds[i] && !charAnnotIds[i].includes(r.id)) {
          charAnnotIds[i].push(r.id);
        }
      }
    }
  }

  // Build HTML by grouping consecutive chars with same class
  let html = '';
  let i = 0;
  while (i < plainText.length) {
    if (charMap[i] === null) {
      // Unhighlighted text — collect run
      let j = i;
      while (j < plainText.length && charMap[j] === null) j++;
      html += esc(plainText.substring(i, j));
      i = j;
    } else {
      // Highlighted text — collect same-class run
      const cls = charMap[i];
      const ids = charAnnotIds[i];
      let j = i;
      while (j < plainText.length && charMap[j] === cls) j++;
      const annIdStr = ids ? ids.join(',') : '';
      html += `<mark class="hl hl-${cls}" data-annot-ids="${annIdStr}">${esc(plainText.substring(i, j))}</mark>`;
      i = j;
    }
  }

  return html;
}

// Apply dotted underlines to vocab words in already-rendered HTML
// Works by splitting on HTML tags and only replacing in text segments
function applyVocabUnderlines(html, words) {
  if (!words || words.length === 0) return html;
  // Sort longer words first to avoid partial matches
  const sorted = [...words].sort((a, b) => b.length - a.length);
  // Build regex matching any vocab word (case-insensitive, word boundary)
  const pattern = new RegExp(
    '(' + sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
    'gi'
  );
  // Split HTML into tags and text segments
  const parts = html.split(/(<[^>]+>)/);
  for (let i = 0; i < parts.length; i++) {
    // Only process text nodes (odd indices are tags)
    if (i % 2 === 0 && parts[i]) {
      parts[i] = parts[i].replace(pattern, '<span class="vocab-underline">$1</span>');
    }
  }
  return parts.join('');
}

// ===== ANNOTATION PANEL =====
function openAnnotPanel(paraId, highlightText, annotId) {
  state.panelOpen = true;
  state.panelParaId = paraId;
  state.panelPdfPage = null;
  state.panelQuote = null;
  state.panelHighlightText = highlightText || null;
  state.panelAnnotId = annotId || null;
  renderAnnotPanel();
  requestAnimationFrame(() => {
    document.getElementById('annotPanelBackdrop').classList.add('open');
    document.getElementById('annotPanel').classList.add('open');
  });
}

// fidelity 版：从 overlay 命中的 annotation 打开（锚 = pdf_page + quote）
function openFidAnnotPanel(annot) {
  state.panelOpen = true;
  state.panelParaId = null;
  state.panelPdfPage = annot.pdf_page;
  state.panelQuote = annot.quote || null;
  state.panelHighlightText = annot.quote || null;
  state.panelAnnotId = annot.type === 'highlight' ? annot.id : (annot.highlight_id || null);
  renderAnnotPanel();
  requestAnimationFrame(() => {
    document.getElementById('annotPanelBackdrop').classList.add('open');
    document.getElementById('annotPanel').classList.add('open');
  });
}

function closeAnnotPanel() {
  state.panelOpen = false;
  document.getElementById('annotPanelBackdrop').classList.remove('open');
  document.getElementById('annotPanel').classList.remove('open');
}

function renderNoteWithReplies(note, allNotes, hlText, depth) {
  depth = depth || 0;
  const isKieran = note.author === '克先生';
  const color = isKieran ? 'amber' : 'jade';
  const author = isKieran ? '克先生' : '音音';
  const dateStr = note.created_at ? note.created_at.substring(0, 10) : '';
  const canDelete = !isKieran;
  const delBtn = canDelete
    ? '<button class="annot-panel-item-del" data-id="' + esc(note.id) + '" data-type="note" title="delete" style="position:static;margin-left:auto;flex-shrink:0">&times;</button>'
    : '';
  const displayText = hlText ? cleanNoteText(note.text || '', hlText) : (note.text || '');
  const replyIcon = depth > 0 ? '<span style="font-size:8px;color:var(--ink4);margin-right:3px">&#8617;</span>' : '';
  const indent = depth > 0 ? 'padding-left:12px;' : '';
  const replies = allNotes.filter(r => r.reply_to === note.id);

  let html = `
    <div style="display:flex;align-items:flex-start;gap:6px;padding:6px 0;border-top:0.5px solid var(--border-soft);${indent}">
      <div style="flex:1;min-width:0">
        <div class="annot-panel-item-author ${color}">${replyIcon}${author}</div>
        <div class="annot-panel-item-text">${esc(displayText)}</div>
        ${dateStr ? '<div class="annot-panel-item-date">' + dateStr + '</div>' : ''}
      </div>
      ${delBtn}
    </div>`;

  for (const reply of replies) {
    html += renderNoteWithReplies(reply, allNotes, null, (depth || 0) + 1);
  }
  return html;
}

function renderAnnotPanel() {
  const panel = document.getElementById('annotPanelContent');
  const paraId = state.panelParaId;
  const hlText = state.panelHighlightText;
  const fidPage = state.panelPdfPage;

  // 两种锚各走各的过滤；fidelity 按 quote 聚焦到点开的那条划线
  const paraAnnots = fidPage != null
    ? state.annotations.filter(a => a.anchor_mode === 'fidelity' && a.pdf_page === fidPage &&
        (!state.panelQuote || a.quote === state.panelQuote))
    : state.annotations.filter(a => a.paragraph_id === paraId);
  const highlights = paraAnnots.filter(a => a.type === 'highlight');
  const notes = paraAnnots.filter(a => a.type === 'note');

  // Group notes by highlight_id
  const highlightIds = new Set(highlights.map(h => h.id));
  const linkedNotes = {};  // highlight_id -> [notes]
  const standaloneNotes = [];
  for (const n of notes) {
    if (n.highlight_id && highlightIds.has(n.highlight_id)) {
      if (!linkedNotes[n.highlight_id]) linkedNotes[n.highlight_id] = [];
      linkedNotes[n.highlight_id].push(n);
    } else {
      standaloneNotes.push(n);
    }
  }

  let itemsHtml = '';

  // Render each highlight as a card with linked notes
  for (const hl of highlights) {
    const isKieran = hl.author === '克先生';
    const colorClass = isKieran ? 'amber' : 'jade';
    const authorName = isKieran ? '克先生' : '音音';
    const dateStr = hl.created_at ? hl.created_at.substring(0, 10) : '';
    const canDelete = !isKieran;
    const delBtn = canDelete
      ? '<button class="annot-panel-item-del" data-id="' + esc(hl.id) + '" data-type="highlight" title="delete highlight + notes">×</button>'
      : '';

    const childNotes = linkedNotes[hl.id] || [];
    const directChildren = childNotes.filter(n => !childNotes.some(p => p.id === n.reply_to));

    let linkedHtml = '';
    for (const n of directChildren) {
      linkedHtml += renderNoteWithReplies(n, paraAnnots, hl.text, 0);
    }

    itemsHtml += `
    <div class="annot-panel-item hl-${colorClass}" style="display:flex;align-items:stretch;gap:0;position:relative">
      <div class="annot-panel-bar ${colorClass}" style="flex-shrink:0;width:3px;border-radius:2px;margin-right:10px"></div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;">
          <div style="flex:1;min-width:0">
            <div class="annot-panel-item-author ${colorClass}">${authorName}</div>
            <div class="annot-panel-item-hl">${esc(hl.text)}</div>
            ${dateStr ? '<div class="annot-panel-item-date">' + dateStr + '</div>' : ''}
          </div>
          ${!childNotes.length ? delBtn : ''}
        </div>
        ${linkedHtml}
      </div>
    </div>`;
  }

  // Render standalone notes
  for (const a of standaloneNotes) {
    const isKieran = a.author === '克先生';
    const colorClass = isKieran ? 'amber' : 'jade';
    const authorName = isKieran ? '克先生' : '音音';
    const dateStr = a.created_at ? a.created_at.substring(0, 10) : '';
    const canDelete = !isKieran;
    const delBtn = canDelete
      ? '<button class="annot-panel-item-del" data-id="' + esc(a.id) + '" data-type="note" title="delete">×</button>'
      : '';
    itemsHtml += `
    <div class="annot-panel-item">
      <div class="annot-panel-bar ${colorClass}"></div>
      <div class="annot-panel-item-body">
        <div class="annot-panel-item-author ${colorClass}">${authorName}</div>
        <div class="annot-panel-item-text">${esc(a.text)}</div>
        ${dateStr ? '<div class="annot-panel-item-date">' + dateStr + '</div>' : ''}
      </div>
      ${delBtn}
    </div>`;
  }

  if (paraAnnots.length === 0) {
    itemsHtml = '<div class="annot-panel-empty">no annotations yet</div>';
  }

  panel.innerHTML = `
    <div class="annot-panel-header">
      <span class="annot-panel-title">${fidPage != null ? 'p.' + fidPage : '¶' + paraId}</span>
      <button class="annot-panel-close" onclick="closeAnnotPanel()">${SVG.x}</button>
    </div>
    ${hlText ? '<div class="annot-panel-quote">' + esc(hlText) + '</div>' : ''}
    <div class="annot-panel-list">${itemsHtml}</div>
    <div class="annot-panel-input-row">
      <input class="annot-panel-input" id="panelNoteInput" placeholder="add a note..." onkeydown="if(event.key==='Enter')submitPanelNote()">
      <button class="annot-panel-send" onclick="submitPanelNote()">Send</button>
    </div>`;
}

async function submitPanelNote() {
  const input = document.getElementById('panelNoteInput');
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  input.value = '';
  if (state.panelPdfPage != null) {
    await addFidNote(state.panelPdfPage, state.panelQuote || '', text, state.panelAnnotId);
  } else {
    await addNote(state.panelParaId, text);
  }
}

async function confirmDeleteAnnot(id, type) {
  const annot = state.annotations.find(a => a.id === id);
  const isBundle = (type === 'highlight') || (type === 'note' && annot && annot.highlight_id);
  const label = isBundle ? 'Remove this annotation?' : 'Delete this note?';
  if (!confirm(label)) return;
  if (type === 'highlight') {
    state.annotations = state.annotations.filter(a => a.highlight_id !== id);
  } else if (type === 'note' && annot && annot.highlight_id) {
    const hlId = annot.highlight_id;
    state.annotations = state.annotations.filter(a => a.id !== hlId && !(a.highlight_id === hlId && a.id !== id));
  }
  await deleteAnnotation(id);
  const remaining = state.panelPdfPage != null
    ? state.annotations.filter(a => a.anchor_mode === 'fidelity' && a.pdf_page === state.panelPdfPage &&
        (!state.panelQuote || a.quote === state.panelQuote))
    : state.annotations.filter(a => a.paragraph_id === state.panelParaId);
  if (remaining.length === 0) {
    closeAnnotPanel();
  } else {
    renderAnnotPanel();
  }
}

async function toggleBookmarkFromPanel(paraId) {
  await toggleBookmark(paraId);
  renderAnnotPanel();
}

// ===== SELECTION HANDLING =====
let selectionTimeout = null;

function initSelectionHandler() {
  document.addEventListener('selectionchange', () => {
    if (selectionTimeout) clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(handleSelectionChange, 150);
  });

  // Handle highlight button click
  // Save selection before click events clear it
  let _savedSelText = '';
  let _savedSelParaId = null;
  let _savedFidAnchor = null;   // fidelity 三件套锚（异步收集，button click 时取）
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      _savedSelText = sel.toString().trim();
      if (isFid()) {
        _savedSelParaId = null;
        _savedFidAnchor = null;
        fidCollectSelection(sel).then(a => { _savedFidAnchor = a; });
      } else {
        _savedSelParaId = getParaIdFromSelection(sel);
        _savedFidAnchor = null;
      }
    }
  };
  document.getElementById('selToolbar').addEventListener('mousedown', (e) => {
    e.preventDefault(); // Prevent selection from being cleared
    saveSelection();
  });
  document.getElementById('selToolbar').addEventListener('touchstart', () => {
    saveSelection();
  }, { passive: true });

  document.getElementById('selHighlightBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = _savedSelText;
    const paraId = _savedSelParaId;
    if (!text) return;

    if (isFid()) {
      const anchor = _savedFidAnchor;
      if (!anchor) return;   // 收集失败/还没就绪——宁可不写也不写坏锚
      const existingHl = state.annotations.find(
        a => a.type === 'highlight' && a.anchor_mode === 'fidelity' &&
             a.pdf_page === anchor.pdf_page && a.quote === anchor.quote && a.author !== '克先生'
      );
      if (existingHl) await deleteAnnotation(existingHl.id);
      else await addFidHighlight(anchor);
    } else {
      if (!paraId) return;
      const existingHl = state.annotations.find(
        a => a.type === 'highlight' && a.text === text && a.paragraph_id === paraId && a.author !== '克先生'
      );
      if (existingHl) await deleteAnnotation(existingHl.id);
      else await addHighlight(paraId, text);
    }

    window.getSelection()?.removeAllRanges();
    _savedSelText = ''; _savedSelParaId = null; _savedFidAnchor = null;
    hideSelToolbar();
  });

  // Handle Vocab button click (selection toolbar)
  document.getElementById('selVocabBtn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = _savedSelText;
    const paraId = _savedSelParaId;
    const fidPage = isFid() ? (_savedFidAnchor?.pdf_page || state.currentPage) : null;
    if (!text) return;
    window.getSelection()?.removeAllRanges();
    _savedSelText = ''; _savedSelParaId = null; _savedFidAnchor = null;
    hideSelToolbar();
    addVocab(text, paraId, fidPage);
  });

  // Handle Copy button click (selection toolbar)
  document.getElementById('selCopyBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = _savedSelText;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    window.getSelection()?.removeAllRanges();
    _savedSelText = ''; _savedSelParaId = null;
    hideSelToolbar();
  });

  // Click on highlighted mark -> open panel
  document.addEventListener('click', (e) => {
    const mark = e.target.closest('mark.hl');
    if (mark && state.view === 'reading') {
      e.preventDefault();
      const para = mark.closest('.paragraph');
      if (!para) return;
      const paraId = parseInt(para.dataset.pid);
      const hlText = mark.textContent;
      const annotIds = mark.dataset.annotIds;
      openAnnotPanel(paraId, hlText, annotIds);
      return;
    }
    // fidelity：overlay 压在 TextLayer 下面不吃事件，点击走坐标 hit-test
    if (isFid() && state.view === 'reading' && e.target.closest('#fidStage')) {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;   // 正在选字，别抢
      const hit = fidHitTest(e.clientX, e.clientY);
      if (hit) openFidAnnotPanel(hit);
    }
  });

  // Backdrop click closes panel
  document.getElementById('annotPanelBackdrop').addEventListener('click', closeAnnotPanel);
}

function handleSelectionChange() {
  if (state.view !== 'reading') return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) {
    hideSelToolbar();
    return;
  }

  if (isFid()) {
    // fidelity：选区要落在 TextLayer 里
    const textDiv = document.getElementById('fidText');
    if (!textDiv || !textDiv.contains(sel.anchorNode)) {
      hideSelToolbar();
      return;
    }
    document.getElementById('selToolbar').classList.add('visible');
    return;
  }

  // Check if selection is within a paragraph
  const paraId = getParaIdFromSelection(sel);
  if (!paraId) {
    hideSelToolbar();
    return;
  }

  // 底部固定条：不算坐标，纯开关。iOS 原生 edit 菜单跟着选区跳，我们在地面层，永不相撞（音音 07-03 v2）。
  const toolbar = document.getElementById('selToolbar');
  toolbar.classList.add('visible');
}

function hideSelToolbar() {
  document.getElementById('selToolbar').classList.remove('visible');
}

function getParaIdFromSelection(sel) {
  if (!sel.anchorNode) return null;
  let node = sel.anchorNode;
  if (node.nodeType === 3) node = node.parentElement;
  const para = node.closest('.paragraph[data-pid]');
  if (!para) return null;
  return parseInt(para.dataset.pid);
}

// ===== NIGHT MODE =====
function toggleNight() {
  state.nightMode = !state.nightMode;
  localStorage.setItem('tasogare-night', state.nightMode ? '1' : '0');
  render();
}

// ===== NAVIGATION =====
function goShelf() {
  state.view = 'shelf';
  state.detailBook = null;
  loadBooks();
}

function backFromReader() {
  closeAnnotPanel();
  hideSelToolbar();
  hideFontsizePanel();
  if (isFid()) fidCloseDoc();   // WebView worker 泄漏，离场即销毁
  if (state.currentBook) {
    openDetail(state.currentBook.id);
  } else {
    goShelf();
  }
}

function showAnnotations() {
  state.annotFilter = null;
  state.view = 'annotations';
  render();
}

function showVocab() {
  state.view = 'vocab';
  render();
}

function backToReader() {
  state.view = 'reading';
  render();
}

// ===== RENDER =====
function render() {
  const app = document.getElementById('app');
  if (state.nightMode) {
    document.body.classList.add('night-mode');
    document.querySelector('.night-toggle').textContent = '☾';
  } else {
    document.body.classList.remove('night-mode');
    document.querySelector('.night-toggle').textContent = '☼';
  }

  const wb = document.querySelector('.folio');
  const scrollTop = wb ? window.scrollY : 0;

  if (state.view === 'shelf') app.innerHTML = renderShelf();
  else if (state.view === 'detail') app.innerHTML = renderDetail();
  else if (state.view === 'reading') app.innerHTML = renderReading();
  else if (state.view === 'annotations') app.innerHTML = renderAnnotationsOverview();
  else if (state.view === 'vocab') app.innerHTML = renderVocabPage();

  if (state.view === 'reading') window.scrollTo(0, scrollTop);

  // Update bookmark ribbon visibility
  const ribbon = document.getElementById('bookmarkRibbon');
  if (ribbon) {
    if (state.view === 'reading' && isCurrentPageBookmarked()) {
      ribbon.classList.add('visible');
    } else {
      ribbon.classList.remove('visible');
    }
  }

  // Hide night toggle when in reader (it's in the font panel now)
  const nightBtn = document.querySelector('.night-toggle');
  if (nightBtn) {
    if (state.view === 'reading') {
      nightBtn.classList.add('hidden-in-reader');
    } else {
      nightBtn.classList.remove('hidden-in-reader');
    }
  }

  // Hide font panel on view change
  if (state.view !== 'reading') {
    hideFontsizePanel();
  }

  bindEvents();

  // fidelity：骨架落地后异步画 PDF 页（内部有竞态票据，翻页快也不串页）
  if (state.view === 'reading' && isFid()) fidelityMount();
}

// ===== SHELF =====
function renderShelf() {
  const booksHtml = state.books.length === 0
    ? `<div class="empty-state">
        <div class="empty-glyph">§</div>
        <div class="empty-text">the shelf is empty</div>
      </div>`
    : renderBookCards();

  return `
  <div class="folio fade-in">
    <div class="page-header">
      <div class="page-title">Tasogare</div>
      <div class="page-subtitle"><span class="dash">—— </span>the reading room · ${state.books.length} books</div>
      <div class="header-rule"></div>
    </div>
    <input type="file" id="fileInput" accept=".pdf,.txt,.epub" class="file-input-hidden">
    <label class="nav-btn btn-upload" for="fileInput">${SVG.plus} add a book</label>
    <div class="upload-zone" id="uploadZone">
      <div class="upload-glyph">§</div>
      <div class="upload-label">drop a pdf / epub / txt here</div>
    </div>
    ${state.loading ? '<div class="loading">loading...</div>' : booksHtml}
  </div>`;
}

function renderBookCards() {
  return `<div class="shelf-cards">${state.books.map(b => {
    const pct = b.total_pages > 0 ? Math.round(((b.progress?.page || 1) / b.total_pages) * 100) : 0;
    const pageMeta = b.total_pages > 0 ? `p.${b.progress?.page || 1} / ${b.total_pages}` : '';
    const annotMeta = b.annotation_count > 0 ? `${b.annotation_count} notes` : '';
    const meta = [pageMeta, annotMeta].filter(Boolean).join(' · ');
    return `
    <div class="book-card" onclick="openDetail('${b.id}')" oncontextmenu="showCtxMenu('${b.id}', event)">
      <div class="book-card-top">
        <div class="book-card-title">${esc(b.title)}</div>
        <div class="book-card-chevron">${SVG.chevronRight}</div>
      </div>
      ${meta ? `<div class="book-card-meta">${meta}</div>` : ''}
      ${b.total_pages > 0 ? `<div class="book-card-bar"><div class="book-card-bar-fill" style="width:${pct}%"></div></div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

// ===== BOOK DETAIL =====
function renderDetail() {
  const b = state.detailBook;
  if (!b) return '';

  const currentPage = b.progress?.page || 1;
  const totalPages = b.total_pages || 0;
  const myPct = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;

  const isFidBook = b.mode === 'fidelity';
  const kieranAnnots = state.detailAnnotations.filter(a => a.author === '克先生');
  // 克先生读到哪：reflow 按段落号/段落总数，fidelity 按 PDF 页/总页数
  const anchorOf = a => (a.anchor_mode === 'fidelity' ? a.pdf_page : a.paragraph_id) || 0;
  const kieranMaxPara = kieranAnnots.length > 0 ? Math.max(...kieranAnnots.map(anchorOf)) : 0;
  const paraCount = isFidBook ? (totalPages || 0) : (b.paragraph_count || 0);
  const kieranPct = paraCount > 0 ? Math.min(100, Math.round((kieranMaxPara / paraCount) * 100)) : 0;
  const hasKieranProgress = kieranMaxPara > 0;

  const grouped = {};
  state.detailAnnotations.forEach(a => {
    const key = anchorOf(a);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(a);
  });
  const sortedGroups = Object.keys(grouped).map(Number).sort((a, b) => a - b);

  const metaParts = [];
  if (totalPages > 0) metaParts.push(`${totalPages} pages`);
  if (paraCount > 0) metaParts.push(`${paraCount} ¶`);
  if (state.detailAnnotations.length > 0) metaParts.push(`${state.detailAnnotations.length} notes`);

  return `
  <div class="folio fade-in">
    <div class="page-header">
      <div class="header-nav">
        <button class="nav-back" onclick="goShelf()">${SVG.chevronLeft} SHELF</button>
        <div class="nav-actions">
          <button class="nav-btn subtle" onclick="renameBook('${b.id}')">Rename</button>
        </div>
      </div>
    </div>

    <div class="detail-hero">
      <div class="detail-title">${esc(b.title)}</div>
      ${metaParts.length ? `<div class="detail-meta">${metaParts.join(' · ')}</div>` : ''}
    </div>

    <button class="continue-btn" onclick="openBook('${b.id}')">
      <span>${currentPage > 1 ? 'CONTINUE · P.' + currentPage : 'START READING'}</span>
      ${SVG.arrowRight}
    </button>

    <div class="progress-card">
      <div class="progress-header">
        <span class="progress-title">Progress</span>
        ${totalPages > 0 ? `<span class="progress-pages">${totalPages} PAGES</span>` : ''}
      </div>
      <div class="progress-row">
        <div class="progress-row-header">
          <span class="progress-label">音音</span>
          <span class="progress-pct jade">p.${currentPage} · ${myPct}%</span>
        </div>
        <div class="bar-gauge"><div class="bar-gauge-fill jade" style="width:${myPct}%"></div></div>
      </div>
      ${hasKieranProgress ? `
      <div class="progress-row" style="margin-top:12px">
        <div class="progress-row-header">
          <span class="progress-label">克先生</span>
          <span class="progress-pct amber">~${kieranPct}%</span>
        </div>
        <div class="bar-gauge"><div class="bar-gauge-fill amber" style="width:${kieranPct}%"></div></div>
      </div>` : ''}
    </div>

    <div class="annot-card">
      <div class="annot-card-header">
        <span class="annot-card-title">Annotations</span>
        <span class="annot-card-count">${state.detailAnnotations.length}</span>
      </div>
      ${sortedGroups.length === 0 ? `
        <div style="padding:0 16px 16px;">
          <span style="font-family:var(--font-mono);font-size:9px;font-weight:300;color:var(--ink3)">no annotations yet</span>
        </div>
      ` : sortedGroups.map(pid => {
        const items = grouped[pid];
        const isOpen = state.detailExpandedParas.has(pid);
        return `
        <div class="annot-group">
          <button class="annot-group-toggle" onclick="toggleDetailPara(${pid})">
            <span class="annot-group-pid">${isFidBook ? 'p.' + pid : '¶' + pid}</span>
            <span class="annot-group-right">
              <span class="annot-group-n">${items.length}</span>
              <span class="annot-group-chevron ${isOpen ? 'open' : ''}">${SVG.chevronDown}</span>
            </span>
          </button>
          ${isOpen ? `<div class="annot-group-body">${renderDetailGrouped(items)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>

    <button class="delete-book-btn" onclick="showConfirmDialog('Delete this book permanently?', ()=>deleteBook('${b.id}'))">DELETE BOOK</button>
  </div>`;
}

function cleanNoteText(noteText, hlText) {
  if (!noteText) return '';
  let t = noteText;
  const m = t.match(/^「[^」]*」\s*/);
  if (m) t = t.substring(m[0].length);
  if (hlText && t.startsWith(hlText)) t = t.substring(hlText.length).trimStart();
  return t;
}

function renderDetailGrouped(items) {
  const highlights = items.filter(a => a.type === 'highlight');
  const highlightIds = new Set(highlights.map(a => a.id));
  const notes = items.filter(a => a.type === 'note');
  const linkedNotes = {};
  const standalone = [];
  for (const n of notes) {
    if (n.reply_to && notes.some(p => p.id === n.reply_to)) {
      // replies handled inside renderDetailReply - check before highlight_id
    } else if (n.highlight_id && highlightIds.has(n.highlight_id)) {
      if (!linkedNotes[n.highlight_id]) linkedNotes[n.highlight_id] = [];
      linkedNotes[n.highlight_id].push(n);
    } else {
      standalone.push(n);
    }
  }
  let html = '';
  for (const hl of highlights) {
    const isKieran = hl.author === '克先生';
    const colorVar = isKieran ? 'accent' : 'jade';
    const authorName = isKieran ? '克先生' : '音音';
    const dateStr = hl.created_at ? hl.created_at.substring(0, 10) : '';
    const children = linkedNotes[hl.id] || [];
    const directChildren = children.filter(n => !children.some(p => p.id === n.reply_to));
    let notesHtml = '';
    for (const n of directChildren) {
      notesHtml += renderDetailReply(n, notes, hl.text, 0);
    }
    html += `<div class="annot-row" style="display:flex;align-items:stretch;gap:8px">
      <div style="width:3px;border-radius:2px;background:var(--${colorVar});opacity:0.6;flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div class="annot-row-header">
          <span class="annot-row-author ${isKieran?'kieran':'yinyin'}">${authorName}</span>
          ${dateStr ? '<span class="annot-row-date">' + dateStr + '</span>' : ''}
        </div>
        <div class="annot-row-highlight ${isKieran?'hl-kieran':''}">${esc(hl.text||'')}</div>
        ${notesHtml}
      </div>
    </div>`;
  }
  for (const note of standalone) {
    html += renderDetailAnnot(note);
  }
  return html;
}

function renderDetailReply(note, allNotes, hlText, depth) {
  const isKieran = note.author === '克先生';
  const authorClass = isKieran ? 'kieran' : 'yinyin';
  const dateStr = note.created_at ? note.created_at.substring(0, 10) : '';
  const displayText = hlText ? cleanNoteText(note.text || '', hlText) : (note.text || '');
  const indent = depth > 0 ? 'padding-left:12px;' : '';
  const replyIcon = depth > 0 ? '<span style="font-size:8px;color:var(--ink4);margin-right:3px">&#8617;</span>' : '';
  const replies = allNotes.filter(r => r.reply_to === note.id);

  let html = `<div style="border-top:0.5px solid var(--border-soft);padding:4px 0;${indent}">
    <div class="annot-row-header" style="margin-bottom:2px">
      <span class="annot-row-author ${authorClass}">${replyIcon}${isKieran?'克先生':'音音'}</span>
      ${dateStr ? '<span class="annot-row-date">' + dateStr + '</span>' : ''}
    </div>
    <div class="annot-row-note">${esc(displayText)}</div>
  </div>`;
  for (const r of replies) {
    html += renderDetailReply(r, allNotes, null, depth + 1);
  }
  return html;
}

function renderDetailAnnot(a, isLinked, parentHlText) {
  const isKieran = a.author === '克先生';
  const colorVar = isKieran ? 'accent' : 'jade';
  const authorName = isKieran ? '克先生' : '音音';
  const dateStr = a.created_at ? a.created_at.substring(0, 10) : '';

  let bodyHtml = '';
  if (a.type === 'highlight' && a.text) {
    bodyHtml = `<div class="annot-row-highlight ${isKieran ? "hl-kieran" : ""}">${esc(a.text)}</div>`;
  } else if (a.type === 'highlight') {
    bodyHtml = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--ink4);font-weight:300">highlight</div>`;
  } else if (a.text) {
    const displayText = isLinked && parentHlText ? cleanNoteText(a.text, parentHlText) : a.text;
    bodyHtml = `<div class="annot-row-note">${esc(displayText)}</div>`;
  }

  return `
  <div class="annot-row" style="display:flex;align-items:stretch;gap:8px">
    <div style="width:3px;border-radius:2px;background:var(--${colorVar});opacity:0.6;flex-shrink:0"></div>
    <div style="flex:1;min-width:0">
      <div class="annot-row-header">
        <span class="annot-row-author ${isKieran?'kieran':'yinyin'}">${authorName}</span>
        ${dateStr ? `<span class="annot-row-date">${dateStr}</span>` : ''}
      </div>
      ${bodyHtml}
    </div>
  </div>`;
}

function toggleDetailPara(pid) {
  if (state.detailExpandedParas.has(pid)) state.detailExpandedParas.delete(pid);
  else state.detailExpandedParas.add(pid);
  render();
}

// ===== READING =====
function renderReading() {
  const b = state.currentBook;
  const pct = state.totalPages > 0 ? Math.round((state.currentPage / state.totalPages) * 100) : 0;
  const isBookmarked = isCurrentPageBookmarked();

  if (isFid()) return renderReadingFidelity(b, pct);

  return `
  <div class="reader-topbar">
    <div class="reader-topbar-left">
      <button class="nav-back" onclick="backFromReader()">${SVG.chevronLeft} Back</button>
    </div>
    <div class="reader-topbar-title">${esc(b.title)}</div>
    <div class="reader-topbar-right"><button class="nav-btn subtle" onclick="openSearch()" title="Search" style="font-size:14px">⚲</button></div>
  </div>
  <div class="reader-progress"><div class="reader-progress-fill" style="width:${pct}%"></div></div>
  <div class="folio reader-folio fade-in">
    ${state.loading ? '<div class="loading">turning page...</div>' : renderParagraphs()}
    <div class="page-nav">
      <button class="page-nav-btn" onclick="goPage(${state.currentPage - 1})" ${state.currentPage <= 1 ? 'disabled' : ''}>
        ${SVG.chevronLeft} Prev
      </button>
      <span class="page-nav-center">${state.currentPage} / ${state.totalPages}</span>
      <button class="page-nav-btn" onclick="goPage(${state.currentPage + 1})" ${state.currentPage >= state.totalPages ? 'disabled' : ''}>
        Next ${SVG.chevronRight}
      </button>
    </div>
  </div>
  <div class="reader-bottombar" id="readerBottombar">
    <div class="reader-bottombar-page">
      <span class="page-slider-label">p.${state.currentPage} / ${state.totalPages}</span>
      <input type="range" class="page-slider" min="1" max="${state.totalPages}" value="${state.currentPage}" oninput="this.previousElementSibling.textContent='p.'+this.value+' / ${state.totalPages}'" onchange="goPage(parseInt(this.value))">
    </div>
    <div class="reader-bottombar-icons">
      <button class="bottombar-btn" onclick="toggleTocPanel()" title="Contents">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 3h10M3 6.5h7M3 10h9M3 13.5h6"/></svg>
        <span class="bottombar-btn-label">TOC</span>
      </button>
      <button class="bottombar-btn" onclick="showAnnotations()" title="Annotations">
        ${SVG.annotations}
        <span class="bottombar-btn-label">Notes</span>
      </button>
      <button class="bottombar-btn" onclick="showVocab()" title="Vocab">
        ${SVG.vocabList}
        <span class="bottombar-btn-label">Vocab</span>
      </button>
      <button class="bottombar-btn" onclick="toggleFontsizePanel()" title="Font size" id="fontsizeBtn">
        ${SVG.fontsize}
        <span class="bottombar-btn-label">Aa</span>
      </button>
      <button class="bottombar-btn ${isBookmarked ? 'active' : ''}" onclick="toggleCurrentPageBookmark()" title="Bookmark">
        ${isBookmarked ? SVG.bookmarkFill : SVG.bookmark}
        <span class="bottombar-btn-label">Mark</span>
      </button>
    </div>
  </div>`;
}

// fidelity 版阅读视图：pdf.js 三层（canvas / 高亮 overlay / TextLayer）。
// TOC / 字号 / 书签是重排语义，fidelity 不出；Notes / Vocab / slider 照旧。
function renderReadingFidelity(b, pct) {
  return `
  <div class="reader-topbar">
    <div class="reader-topbar-left">
      <button class="nav-back" onclick="backFromReader()">${SVG.chevronLeft} Back</button>
    </div>
    <div class="reader-topbar-title">${esc(b.title)}</div>
    <div class="reader-topbar-right"><button class="nav-btn subtle" onclick="openSearch()" title="Search" style="font-size:14px">⚲</button></div>
  </div>
  <div class="reader-progress"><div class="reader-progress-fill" style="width:${pct}%"></div></div>
  <div class="folio reader-folio fid-folio fade-in">
    <div class="pdf-stage" id="fidStage">
      <div class="pdf-page-wrap" id="fidWrap">
        <canvas id="fidCanvas"></canvas>
        <div class="fid-overlay" id="fidOverlay"></div>
        <div class="textLayer" id="fidText"></div>
      </div>
      <div class="fid-loading visible" id="fidLoading">rendering page...</div>
    </div>
    <div class="page-nav">
      <button class="page-nav-btn" onclick="goPage(${state.currentPage - 1})" ${state.currentPage <= 1 ? 'disabled' : ''}>
        ${SVG.chevronLeft} Prev
      </button>
      <span class="page-nav-center">${state.currentPage} / ${state.totalPages}</span>
      <button class="page-nav-btn" onclick="goPage(${state.currentPage + 1})" ${state.currentPage >= state.totalPages ? 'disabled' : ''}>
        Next ${SVG.chevronRight}
      </button>
    </div>
  </div>
  <div class="reader-bottombar" id="readerBottombar">
    <div class="reader-bottombar-page">
      <span class="page-slider-label">p.${state.currentPage} / ${state.totalPages}</span>
      <input type="range" class="page-slider" min="1" max="${state.totalPages}" value="${state.currentPage}" oninput="this.previousElementSibling.textContent='p.'+this.value+' / ${state.totalPages}'" onchange="goPage(parseInt(this.value))">
    </div>
    <div class="reader-bottombar-icons">
      <button class="bottombar-btn" onclick="showAnnotations()" title="Annotations">
        ${SVG.annotations}
        <span class="bottombar-btn-label">Notes</span>
      </button>
      <button class="bottombar-btn" onclick="showVocab()" title="Vocab">
        ${SVG.vocabList}
        <span class="bottombar-btn-label">Vocab</span>
      </button>
      <button class="bottombar-btn" onclick="toggleNight()" title="Night mode">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5z"/></svg>
        <span class="bottombar-btn-label">Night</span>
      </button>
    </div>
  </div>`;
}

function isCurrentPageBookmarked() {
  if (!state.bookmark || !state.paragraphs || state.paragraphs.length === 0) return false;
  return state.paragraphs.some(p => p.id === state.bookmark);
}

async function toggleCurrentPageBookmark() {
  if (!state.paragraphs || state.paragraphs.length === 0) return;
  // Find the last visible paragraph (furthest reading position)
  const lastPid = state.paragraphs[state.paragraphs.length - 1].id;
  if (state.bookmark === lastPid) {
    await toggleBookmark(lastPid);
  } else {
    // If bookmarked elsewhere, move the bookmark
    if (state.bookmark) await toggleBookmark(state.bookmark);
    await toggleBookmark(lastPid);
  }
}

function toggleFontsizePanel() {
  const panel = document.getElementById('fontsizePanel');
  if (!panel) return;
  panel.classList.toggle('visible');
}

function hideFontsizePanel() {
  const panel = document.getElementById('fontsizePanel');
  if (panel) panel.classList.remove('visible');
}

function renderParagraphs() {
  if (!state.paragraphs || state.paragraphs.length === 0) {
    return `<div class="empty-state">
      <div class="empty-glyph">§</div>
      <div class="empty-text">no paragraphs on this page</div>
    </div>`;
  }

  return state.paragraphs.map(p => {
    const pid = p.id;
    const isBookmarked = state.bookmark === pid;

    // Get highlights for this paragraph
    const paraHighlights = state.annotations.filter(
      a => a.paragraph_id === pid && a.type === 'highlight'
    );

    // Determine annotation color bar class
    const paraAnnots = state.annotations.filter(a => a.paragraph_id === pid);
    let annotClass = '';
    if (paraAnnots.length > 0) {
      const hasYinyin = paraAnnots.some(a => a.author !== '克先生');
      const hasKieran = paraAnnots.some(a => a.author === '克先生');
      if (hasYinyin && hasKieran) annotClass = 'has-both';
      else if (hasKieran) annotClass = 'has-kieran';
      else if (hasYinyin) annotClass = 'has-yinyin';
    }

    // Render text with inline highlights
    let textHtml = renderHighlightedText(p.text, paraHighlights);

    // Apply vocab word dotted underlines
    const vocabWords = (state.vocab || []).filter(v => v.paragraph_id === pid).map(v => v.word);
    if (vocabWords.length > 0) {
      textHtml = applyVocabUnderlines(textHtml, vocabWords);
    }

    const classes = ['paragraph'];
    if (isBookmarked) classes.push('bookmarked');
    if (annotClass) classes.push(annotClass);

    return `
    <div class="${classes.join(' ')}" data-pid="${pid}">
      <span class="para-id">¶${pid}</span>
      <div class="para-text">${textHtml}</div>
    </div>`;
  }).join('');
}

// ===== ANNOTATIONS OVERVIEW =====
function renderAnnotationsOverview() {
  const b = state.currentBook;
  let annots = [...state.annotations];

  // Filter
  if (state.annotFilter === 'highlight') annots = annots.filter(a => a.type === 'highlight');
  else if (state.annotFilter === 'note') annots = annots.filter(a => a.type === 'note');
  else if (state.annotFilter === 'yinyin') annots = annots.filter(a => a.author !== '克先生');
  else if (state.annotFilter === 'kieran') annots = annots.filter(a => a.author === '克先生');

  // Group by anchor：reflow 按段落、fidelity 按 PDF 页（key 加前缀区分，排序都按数字）
  const fid = isFid();
  const grouped = {};
  annots.forEach(a => {
    const key = a.anchor_mode === 'fidelity' ? a.pdf_page : a.paragraph_id;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(a);
  });
  const sortedPids = Object.keys(grouped).map(Number).sort((a, b) => a - b);

  const filterBtn = (label, val) => {
    const active = state.annotFilter === val ? 'active' : '';
    return `<button class="filter-chip ${active}" onclick="state.annotFilter=${val === state.annotFilter ? 'null' : `'${val}'`};render()">${label}</button>`;
  };

  return `
  <div class="reader-topbar">
    <div class="reader-topbar-left">
      <button class="nav-back" onclick="backToReader()">${SVG.chevronLeft} Reader</button>
    </div>
    <div class="reader-topbar-title">Annotations</div>
    <div class="reader-topbar-right"></div>
  </div>
  <div class="folio fade-in">
    <div class="overview-filter">
      ${filterBtn('All', null)}
      ${filterBtn('Highlights', 'highlight')}
      ${filterBtn('Notes', 'note')}
      ${filterBtn('音音', 'yinyin')}
      ${filterBtn('克先生', 'kieran')}
    </div>
    ${sortedPids.length === 0
      ? `<div class="empty-state"><div class="empty-glyph">§</div><div class="empty-text">no annotations</div></div>`
      : sortedPids.map(pid => {
        const items = grouped[pid];
        const highlights = items.filter(a => a.type === 'highlight');
        const highlightIds = new Set(highlights.map(a => a.id));
        const notes = items.filter(a => a.type === 'note');
        const linkedMap = {};
        const standaloneNotes = [];
        for (const n of notes) {
          if (n.highlight_id && highlightIds.has(n.highlight_id)) {
            if (!linkedMap[n.highlight_id]) linkedMap[n.highlight_id] = [];
            linkedMap[n.highlight_id].push(n);
          } else {
            standaloneNotes.push(n);
          }
        }
        let inner = '';
        for (const hl of highlights) {
          const isKieran = hl.author === '克先生';
          const colorVar = isKieran ? 'accent' : 'jade';
          const authorName = isKieran ? '克先生' : '音音';
          const children = linkedMap[hl.id] || [];
          const directChildren = children.filter(n => !children.some(p => p.id === n.reply_to));
          let notesHtml = '';
          for (const n of directChildren) {
            const nKieran = n.author === '克先生';
            const cleaned = cleanNoteText(n.text || '', hl.text || '');
            const replies = items.filter(r => r.reply_to === n.id);
            notesHtml += '<div style="border-top:0.5px solid var(--border-soft);padding:4px 0">';
            notesHtml += '<div class="overview-annot-author" style="color:var(--' + (nKieran?'accent':'jade') + ')">' + (nKieran?'克先生':'音音') + '</div>';
            notesHtml += '<div class="overview-annot-text">' + esc(cleaned) + '</div></div>';
            for (const r of replies) {
              const rKieran = r.author === '克先生';
              notesHtml += '<div style="border-top:0.5px solid var(--border-soft);padding:4px 0 4px 12px">';
              notesHtml += '<div class="overview-annot-author" style="color:var(--' + (rKieran?'accent':'jade') + ')"><span style="font-size:8px;color:var(--ink4);margin-right:3px">&#8617;</span>' + (rKieran?'克先生':'音音') + '</div>';
              notesHtml += '<div class="overview-annot-text">' + esc(r.text || '') + '</div></div>';
            }
          }
          inner += '<div class="overview-annot ' + (isKieran?'kieran':'user') + '" style="display:flex;align-items:stretch;gap:8px;border-left:none;padding-left:0">';
          inner += '<div style="width:3px;border-radius:2px;background:var(--' + colorVar + ');opacity:0.6;flex-shrink:0"></div>';
          inner += '<div style="flex:1;min-width:0">';
          inner += '<div class="overview-annot-author" style="color:var(--' + colorVar + ')">' + authorName + '</div>';
          inner += '<div class="overview-annot-text"><span class="annot-row-highlight ' + (isKieran?'hl-kieran':'') + '">' + esc(hl.text || '') + '</span></div>';
          inner += notesHtml + '</div></div>';
        }
        for (const n of standaloneNotes) {
          const nKieran = n.author === '克先生';
          const nColor = nKieran ? 'accent' : 'jade';
          const nAuthor = nKieran ? '克先生' : '音音';
          inner += '<div class="overview-annot ' + (nKieran?'kieran':'user') + '">';
          inner += '<div class="overview-annot-author" style="color:var(--' + nColor + ')">' + nAuthor + '</div>';
          inner += '<div class="overview-annot-text">' + esc(n.text || '') + '</div></div>';
        }
        const label = fid ? `p.${pid}` : `¶${pid}`;
        const jump = fid ? ` onclick="jumpToFidPage(${pid})" style="cursor:pointer"` : '';
        return `<div class="overview-item"><div class="overview-para"${jump}>${label}</div>${inner}</div>`;
      }).join('')
    }
  </div>`;
}

// overview / vocab / search 里点 p.N 回到阅读视图并跳页（fidelity）
async function jumpToFidPage(page) {
  state.view = 'reading';
  if (page === state.currentPage) { render(); return; }   // goPage 同页会 early-return，得自己重绘
  await goPage(page);
}

// ===== VOCAB PAGE =====
function renderVocabPage() {
  return `
  <div class="reader-topbar">
    <div class="reader-topbar-left">
      <button class="nav-back" onclick="backToReader()">${SVG.chevronLeft} Reader</button>
    </div>
    <div class="reader-topbar-title">Vocab</div>
    <div class="reader-topbar-right"></div>
  </div>
  <div class="folio fade-in">
    ${state.vocab.length === 0
      ? `<div class="empty-state"><div class="empty-glyph">§</div><div class="empty-text">no vocab entries</div></div>`
      : state.vocab.map(v => `
        <div class="vocab-entry">
          <div class="vocab-entry-body">
            <div class="vocab-word">${esc(v.word)}</div>
            ${v.note ? `<div class="vocab-note">${esc(v.note)}</div>` : ''}
            ${v.pdf_page ? `<div class="vocab-source" onclick="jumpToFidPage(${v.pdf_page})">p.${v.pdf_page}</div>`
              : v.paragraph_id ? `<div class="vocab-source" onclick="jumpToVocab(${v.paragraph_id})">¶${v.paragraph_id}</div>` : ''}
          </div>
          <button class="vocab-edit" onclick="editVocab('${v.id}')">${SVG.pencil}</button>
          <button class="vocab-delete" onclick="deleteVocab('${v.id}')">${SVG.x}</button>
        </div>`).join('')
    }
  </div>`;
}

// ===== EVENT BINDING =====
function bindEvents() {
  // Upload zone
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  if (uploadZone && fileInput) {
    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) uploadFile(e.target.files[0]);
    });
  }
}

// ===== TOUCH SUPPORT FOR SELECTION =====
// On mobile, selectionchange fires differently. We also need to handle
// the toolbar being dismissed when touching outside.
document.addEventListener('touchstart', (e) => {
  const toolbar = document.getElementById('selToolbar');
  if (toolbar.classList.contains('visible') && !toolbar.contains(e.target)) {
    // Don't immediately hide — let the selection logic handle it
  }
}, { passive: true });

// Hide toolbar when clicking outside paragraphs (but not on marks or bottom bar)
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.sel-toolbar')) return;
  if (e.target.closest('mark.hl')) return;
  if (e.target.closest('.reader-bottombar')) return;
  if (e.target.closest('.fontsize-panel')) return;
  // Small delay to let selection happen
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hideSelToolbar();
  }, 50);
});



// ===== FULL BOOK SEARCH =====
let _searchTimer = null;

function openSearch() {
  const panel = document.getElementById('searchPanel');
  panel.classList.add('visible');
  const input = document.getElementById('searchInput');
  input.value = '';
  input.focus();
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('searchInfo').textContent = '';
}

function closeSearch() {
  document.getElementById('searchPanel').classList.remove('visible');
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '';
}

function initSearch() {
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(_searchTimer);
    const q = e.target.value.trim();
    if (!q || q.length < 2) {
      document.getElementById('searchResults').innerHTML = '';
      document.getElementById('searchInfo').textContent = '';
      return;
    }
    _searchTimer = setTimeout(() => runSearch(q), 200);
  });
  document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
  });
}

async function runSearch(query) {
  if (!state.currentBook) return;
  const info = document.getElementById('searchInfo');
  const container = document.getElementById('searchResults');
  info.textContent = 'searching...';

  try {
    const results = await api('/books/' + state.currentBook.id + '/search?q=' + encodeURIComponent(query));
    info.textContent = results.length + ' results';

    if (results.length === 0) {
      container.innerHTML = '';
      return;
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(' + escaped + ')', 'gi');

    container.innerHTML = results.map(r => {
      const highlighted = esc(r.snippet).replace(re, '<mark>$1</mark>');
      // fidelity 结果带 pdf_page（页锚），reflow 带 paragraph_id（段落锚）
      if (r.pdf_page) {
        return '<button class="search-result-item" onclick="closeSearch();jumpToFidPage(' + r.pdf_page + ')">'
          + '<div class="search-result-pid">p.' + r.pdf_page + '</div>'
          + '<div class="search-result-text">' + highlighted + '</div>'
          + '</button>';
      }
      return '<button class="search-result-item" onclick="jumpToSearch(' + r.paragraph_id + ')">'
        + '<div class="search-result-pid">¶' + r.paragraph_id + '</div>'
        + '<div class="search-result-text">' + highlighted + '</div>'
        + '</button>';
    }).join('');
  } catch(e) {
    info.textContent = 'search failed';
    container.innerHTML = '';
  }
}

async function jumpToSearch(paragraphId) {
  closeSearch();
  const pageData = await api('/books/' + state.currentBook.id + '/page-for/' + paragraphId);
  if (pageData && pageData.page) {
    await goPage(pageData.page);
    setTimeout(() => {
      const el = document.querySelector('.paragraph[data-pid="' + paragraphId + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  }
}

// ===== TABLE OF CONTENTS =====
async function loadToc() {
  if (!state.currentBook) return;
  try {
    const toc = await api('/books/' + state.currentBook.id + '/toc');
    state.toc = toc || [];
  } catch { state.toc = []; }
}

function toggleTocPanel() {
  const panel = document.getElementById('tocPanel');
  if (!panel) {
    // Create panel
    const div = document.createElement('div');
    div.className = 'toc-panel visible';
    div.id = 'tocPanel';
    renderTocPanel(div);
    document.body.appendChild(div);
  } else {
    if (panel.classList.contains('visible')) {
      panel.classList.remove('visible');
      setTimeout(() => panel.remove(), 300);
    } else {
      panel.classList.add('visible');
    }
  }
}

function renderTocPanel(panel) {
  const toc = state.toc || [];
  const currentParas = state.paragraphs || [];
  const firstPid = currentParas.length > 0 ? currentParas[0].id : 0;
  const lastPid = currentParas.length > 0 ? currentParas[currentParas.length - 1].id : 0;

  if (toc.length === 0) {
    panel.innerHTML = '<div class="toc-panel-header"><span class="toc-panel-title">Contents</span><button class="toc-panel-close" onclick="toggleTocPanel()">\u00d7</button></div><div class="toc-empty">No table of contents available</div>';
    return;
  }

  let html = '<div class="toc-panel-header"><span class="toc-panel-title">Contents</span><button class="toc-panel-close" onclick="toggleTocPanel()">\u00d7</button></div>';
  for (const item of toc) {
    const isActive = item.paragraph_id >= firstPid && item.paragraph_id <= lastPid;
    const levelClass = item.level > 0 ? ' level-' + Math.min(item.level, 2) : '';
    html += '<button class="toc-item' + levelClass + (isActive ? ' active' : '') + '" onclick="jumpToToc(' + item.paragraph_id + ')">' + esc(item.title) + '</button>';
  }
  panel.innerHTML = html;
}

async function jumpToToc(paragraphId) {
  toggleTocPanel();
  const pageData = await api('/books/' + state.currentBook.id + '/page-for/' + paragraphId);
  if (pageData && pageData.page) {
    await goPage(pageData.page);
    setTimeout(() => {
      const el = document.querySelector('.paragraph[data-pid="' + paragraphId + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  }
}

// ===== FONT SIZE =====
function initFontsize() {
  const slider = document.getElementById('fontsizeSlider');
  const valueEl = document.getElementById('fontsizeValue');
  if (!slider) return;

  // Load saved font size
  const saved = localStorage.getItem('tasogare-fontsize');
  if (saved) {
    slider.value = saved;
    document.documentElement.style.setProperty('--reader-font-size', saved + 'px');
    if (valueEl) valueEl.textContent = saved + 'px';
  }

  slider.addEventListener('input', (e) => {
    const val = e.target.value;
    document.documentElement.style.setProperty('--reader-font-size', val + 'px');
    if (valueEl) valueEl.textContent = val + 'px';
    localStorage.setItem('tasogare-fontsize', val);
  });

  // Close font panel when clicking outside
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('fontsizePanel');
    const btn = document.getElementById('fontsizeBtn');
    if (panel && panel.classList.contains('visible')) {
      if (!panel.contains(e.target) && (!btn || !btn.contains(e.target))) {
        panel.classList.remove('visible');
      }
    }
  });
}

// ===== INIT =====
// Event delegation for annotation delete buttons (XSS-safe)
document.addEventListener('click', (e) => {
  const del = e.target.closest('.annot-panel-item-del');
  if (del) confirmDeleteAnnot(del.dataset.id, del.dataset.type);
});

// 阅读时长打点：阅读视图打开且页面可见时，每 60s 上报一次
setInterval(() => {
  if (state.view === 'reading' && state.currentBook && document.visibilityState === 'visible') {
    api(`/books/${state.currentBook.id}/reading-ping`, {
      method: 'POST',
      body: JSON.stringify({ seconds: 60 }),
    }).catch(() => {});
  }
}, 60000);

function init() {
  if (state.nightMode) {
    document.body.classList.add('night-mode');
    document.querySelector('.night-toggle').textContent = '☾';
  }
  // Load saved font size on init
  const savedFs = localStorage.getItem('tasogare-fontsize');
  if (savedFs) {
    document.documentElement.style.setProperty('--reader-font-size', savedFs + 'px');
  }
  initSelectionHandler();
  initFontsize();
  initSearch();
  loadBooks();
}

init();
