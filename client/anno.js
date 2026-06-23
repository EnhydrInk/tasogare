const API = '/marginalia/api';
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
  nightMode: localStorage.getItem('marginalia-night') === '1',
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

async function uploadFile(file) {
  state.loading = true; render();
  try {
    const form = new FormData();
    form.append('file', file);
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
async function addVocab(word, paraId) {
  showDialog('Add vocab', 'Note for "' + word + '":', '', async (note) => {
    const v = await api(`/books/${state.currentBook.id}/vocab`, {
      method: 'POST',
      body: JSON.stringify({ word, paragraph_id: paraId, note: note || '' }),
    });
    state.vocab.push(v);
    render();
  });
}

async function deleteVocab(vid) {
  await api(`/books/${state.currentBook.id}/vocab/${vid}`, { method: 'DELETE' });
  state.vocab = state.vocab.filter(v => v.id !== vid);
  render();
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
      const isClaude = r.author === 'Claude';
      if (charMap[i] === null) {
        charMap[i] = isClaude ? 'claude' : 'butter';
        charAnnotIds[i] = [r.id];
      } else if (charMap[i] === 'claude' && !isClaude) {
        charMap[i] = 'both';
        charAnnotIds[i].push(r.id);
      } else if (charMap[i] === 'butter' && isClaude) {
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

// ===== ANNOTATION PANEL =====
function openAnnotPanel(paraId, highlightText, annotId) {
  state.panelOpen = true;
  state.panelParaId = paraId;
  state.panelHighlightText = highlightText || null;
  state.panelAnnotId = annotId || null;
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
  const isClaude = note.author === 'Claude';
  const color = isClaude ? 'amber' : 'jade';
  const author = isClaude ? 'Claude' : 'Butter';
  const dateStr = note.created_at ? note.created_at.substring(0, 10) : '';
  const canDelete = !isClaude;
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

  const paraAnnots = state.annotations.filter(a => a.paragraph_id === paraId);
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
    const isClaude = hl.author === 'Claude';
    const colorClass = isClaude ? 'amber' : 'jade';
    const authorName = isClaude ? 'Claude' : 'Butter';
    const dateStr = hl.created_at ? hl.created_at.substring(0, 10) : '';
    const canDelete = !isClaude;
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
    const isClaude = a.author === 'Claude';
    const colorClass = isClaude ? 'amber' : 'jade';
    const authorName = isClaude ? 'Claude' : 'Butter';
    const dateStr = a.created_at ? a.created_at.substring(0, 10) : '';
    const canDelete = !isClaude;
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
      <span class="annot-panel-title">¶${paraId}</span>
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
  await addNote(state.panelParaId, text);
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
  const remaining = state.annotations.filter(a => a.paragraph_id === state.panelParaId);
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
  document.getElementById('selToolbar').addEventListener('mousedown', (e) => {
    e.preventDefault(); // Prevent selection from being cleared
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      _savedSelText = sel.toString().trim();
      _savedSelParaId = getParaIdFromSelection(sel);
    }
  });
  document.getElementById('selToolbar').addEventListener('touchstart', (e) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      _savedSelText = sel.toString().trim();
      _savedSelParaId = getParaIdFromSelection(sel);
    }
  }, { passive: true });

  document.getElementById('selHighlightBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = _savedSelText;
    const paraId = _savedSelParaId;
    if (!text || !paraId) return;

    const existingHl = state.annotations.find(
      a => a.type === 'highlight' && a.text === text && a.paragraph_id === paraId && a.author !== 'Claude'
    );

    if (existingHl) {
      await deleteAnnotation(existingHl.id);
    } else {
      await addHighlight(paraId, text);
    }

    window.getSelection()?.removeAllRanges();
    _savedSelText = ''; _savedSelParaId = null;
    hideSelToolbar();
  });

  // Handle Vocab button click (selection toolbar)
  document.getElementById('selVocabBtn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = _savedSelText;
    const paraId = _savedSelParaId;
    if (!text) return;
    window.getSelection()?.removeAllRanges();
    _savedSelText = ''; _savedSelParaId = null;
    hideSelToolbar();
    addVocab(text, paraId);
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

  // Check if selection is within a paragraph
  const paraId = getParaIdFromSelection(sel);
  if (!paraId) {
    hideSelToolbar();
    return;
  }

  // Position toolbar above selection
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const toolbar = document.getElementById('selToolbar');

  const toolbarWidth = 220;
  const toolbarHeight = 40;

  let left = rect.left + (rect.width / 2) - (toolbarWidth / 2) + window.scrollX;
  let top = rect.top - toolbarHeight - 8 + window.scrollY;

  // Clamp to viewport
  left = Math.max(8, Math.min(left, window.innerWidth - toolbarWidth - 8));
  if (top < window.scrollY + 8) {
    top = rect.bottom + 8 + window.scrollY;
  }

  toolbar.style.left = left + 'px';
  toolbar.style.top = top + 'px';
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
  localStorage.setItem('marginalia-night', state.nightMode ? '1' : '0');
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
      <div class="header-nav">
        <div></div>
        <div class="nav-actions">
          <button class="nav-btn" onclick="document.getElementById('fileInput').click()">${SVG.plus} Upload</button>
        </div>
      </div>
      <div class="page-title">Marginalia</div>
      <div class="page-subtitle"><span class="dash">—— </span>the reading room · ${state.books.length} books</div>
      <div class="header-rule"></div>
    </div>
    <div class="upload-zone" id="uploadZone">
      <input type="file" id="fileInput" accept=".pdf,.txt,.epub">
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

  const claudeAnnots = state.detailAnnotations.filter(a => a.author === 'Claude');
  const claudeMaxPara = claudeAnnots.length > 0 ? Math.max(...claudeAnnots.map(a => a.paragraph_id)) : 0;
  const paraCount = b.paragraph_count || 0;
  const claudePct = paraCount > 0 ? Math.min(100, Math.round((claudeMaxPara / paraCount) * 100)) : 0;
  const hasClaudeProgress = claudeMaxPara > 0;

  const grouped = {};
  state.detailAnnotations.forEach(a => {
    if (!grouped[a.paragraph_id]) grouped[a.paragraph_id] = [];
    grouped[a.paragraph_id].push(a);
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
          <span class="progress-label">Butter</span>
          <span class="progress-pct jade">p.${currentPage} · ${myPct}%</span>
        </div>
        <div class="bar-gauge"><div class="bar-gauge-fill jade" style="width:${myPct}%"></div></div>
      </div>
      ${hasClaudeProgress ? `
      <div class="progress-row" style="margin-top:12px">
        <div class="progress-row-header">
          <span class="progress-label">Claude</span>
          <span class="progress-pct amber">~${claudePct}%</span>
        </div>
        <div class="bar-gauge"><div class="bar-gauge-fill amber" style="width:${claudePct}%"></div></div>
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
            <span class="annot-group-pid">¶${pid}</span>
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
    if (n.highlight_id && highlightIds.has(n.highlight_id)) {
      if (!linkedNotes[n.highlight_id]) linkedNotes[n.highlight_id] = [];
      linkedNotes[n.highlight_id].push(n);
    } else if (n.reply_to && notes.some(p => p.id === n.reply_to)) {
      // replies handled inside renderNoteWithReplies
    } else {
      standalone.push(n);
    }
  }
  let html = '';
  for (const hl of highlights) {
    const isClaude = hl.author === 'Claude';
    const colorVar = isClaude ? 'accent' : 'jade';
    const authorName = isClaude ? 'Claude' : 'Butter';
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
          <span class="annot-row-author ${isClaude?'claude':'butter'}">${authorName}</span>
          ${dateStr ? '<span class="annot-row-date">' + dateStr + '</span>' : ''}
        </div>
        <div class="annot-row-highlight ${isClaude?'hl-claude':''}">${esc(hl.text||'')}</div>
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
  const isClaude = note.author === 'Claude';
  const authorClass = isClaude ? 'claude' : 'butter';
  const dateStr = note.created_at ? note.created_at.substring(0, 10) : '';
  const displayText = hlText ? cleanNoteText(note.text || '', hlText) : (note.text || '');
  const indent = depth > 0 ? 'padding-left:12px;' : '';
  const replyIcon = depth > 0 ? '<span style="font-size:8px;color:var(--ink4);margin-right:3px">&#8617;</span>' : '';
  const replies = allNotes.filter(r => r.reply_to === note.id);

  let html = `<div style="border-top:0.5px solid var(--border-soft);padding:4px 0;${indent}">
    <div class="annot-row-header" style="margin-bottom:2px">
      <span class="annot-row-author ${authorClass}">${replyIcon}${isClaude?'Claude':'Butter'}</span>
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
  const isClaude = a.author === 'Claude';
  const authorClass = isClaude ? 'claude' : 'butter';
  const dateStr = a.created_at ? a.created_at.substring(0, 10) : '';

  let bodyHtml = '';
  if (a.type === 'highlight' && a.text) {
    bodyHtml = `<div class="annot-row-highlight ${isClaude ? "hl-claude" : ""}">${esc(a.text)}</div>`;
  } else if (a.type === 'highlight') {
    bodyHtml = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--ink4);font-weight:300">highlight</div>`;
  } else if (a.text) {
    const displayText = isLinked && parentHlText ? cleanNoteText(a.text, parentHlText) : a.text;
    bodyHtml = `<div class="annot-row-note">${esc(displayText)}</div>`;
  }

  const indent = isLinked ? ' style="padding-left:16px;border-left:2px solid var(--border);margin-left:4px"' : '';

  return `
  <div class="annot-row"${indent}>
    ${!isLinked ? `<div class="annot-row-header">
      <span class="annot-row-author ${authorClass}">${esc(a.author)}</span>
      ${dateStr ? `<span class="annot-row-date">${dateStr}</span>` : ''}
    </div>` : ''}
    ${bodyHtml}
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

  return `
  <div class="reader-topbar">
    <div class="reader-topbar-left">
      <button class="nav-back" onclick="backFromReader()">${SVG.chevronLeft} Back</button>
    </div>
    <div class="reader-topbar-title">${esc(b.title)}</div>
    <div class="reader-topbar-right"><button class="nav-btn subtle" onclick="openSearch()" title="Search" style="font-size:11px">⚲</button></div>
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
      const hasButter = paraAnnots.some(a => a.author !== 'Claude');
      const hasClaude = paraAnnots.some(a => a.author === 'Claude');
      if (hasButter && hasClaude) annotClass = 'has-both';
      else if (hasClaude) annotClass = 'has-claude';
      else if (hasButter) annotClass = 'has-butter';
    }

    // Render text with inline highlights
    const textHtml = renderHighlightedText(p.text, paraHighlights);

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
  else if (state.annotFilter === 'butter') annots = annots.filter(a => a.author !== 'Claude');
  else if (state.annotFilter === 'claude') annots = annots.filter(a => a.author === 'Claude');

  // Group by paragraph
  const grouped = {};
  annots.forEach(a => {
    if (!grouped[a.paragraph_id]) grouped[a.paragraph_id] = [];
    grouped[a.paragraph_id].push(a);
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
      ${filterBtn('Butter', 'butter')}
      ${filterBtn('Claude', 'claude')}
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
          const isClaude = hl.author === 'Claude';
          const colorVar = isClaude ? 'accent' : 'jade';
          const authorName = isClaude ? 'Claude' : 'Butter';
          const children = linkedMap[hl.id] || [];
          const directChildren = children.filter(n => !children.some(p => p.id === n.reply_to));
          let notesHtml = '';
          for (const n of directChildren) {
            const nClaude = n.author === 'Claude';
            const cleaned = cleanNoteText(n.text || '', hl.text || '');
            const replies = items.filter(r => r.reply_to === n.id);
            notesHtml += '<div style="border-top:0.5px solid var(--border-soft);padding:4px 0">';
            notesHtml += '<div class="overview-annot-author" style="color:var(--' + (nClaude?'accent':'jade') + ')">' + (nClaude?'Claude':'Butter') + '</div>';
            notesHtml += '<div class="overview-annot-text">' + esc(cleaned) + '</div></div>';
            for (const r of replies) {
              const rClaude = r.author === 'Claude';
              notesHtml += '<div style="border-top:0.5px solid var(--border-soft);padding:4px 0 4px 12px">';
              notesHtml += '<div class="overview-annot-author" style="color:var(--' + (rClaude?'accent':'jade') + ')"><span style="font-size:8px;color:var(--ink4);margin-right:3px">&#8617;</span>' + (rClaude?'Claude':'Butter') + '</div>';
              notesHtml += '<div class="overview-annot-text">' + esc(r.text || '') + '</div></div>';
            }
          }
          inner += '<div class="overview-annot ' + (isClaude?'claude':'user') + '" style="display:flex;align-items:stretch;gap:8px;border-left:none;padding-left:0">';
          inner += '<div style="width:3px;border-radius:2px;background:var(--' + colorVar + ');opacity:0.6;flex-shrink:0"></div>';
          inner += '<div style="flex:1;min-width:0">';
          inner += '<div class="overview-annot-author" style="color:var(--' + colorVar + ')">' + authorName + '</div>';
          inner += '<div class="overview-annot-text"><span class="annot-row-highlight ' + (isClaude?'hl-claude':'') + '">' + esc(hl.text || '') + '</span></div>';
          inner += notesHtml + '</div></div>';
        }
        for (const n of standaloneNotes) {
          const nClaude = n.author === 'Claude';
          const nColor = nClaude ? 'accent' : 'jade';
          const nAuthor = nClaude ? 'Claude' : 'Butter';
          inner += '<div class="overview-annot ' + (nClaude?'claude':'user') + '">';
          inner += '<div class="overview-annot-author" style="color:var(--' + nColor + ')">' + nAuthor + '</div>';
          inner += '<div class="overview-annot-text">' + esc(n.text || '') + '</div></div>';
        }
        return `<div class="overview-item"><div class="overview-para">¶${pid}</div>${inner}</div>`;
      }).join('')
    }
  </div>`;
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
            ${v.paragraph_id ? `<div class="vocab-source">¶${v.paragraph_id}</div>` : ''}
          </div>
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
  const saved = localStorage.getItem('marginalia-fontsize');
  if (saved) {
    slider.value = saved;
    document.documentElement.style.setProperty('--reader-font-size', saved + 'px');
    if (valueEl) valueEl.textContent = saved + 'px';
  }

  slider.addEventListener('input', (e) => {
    const val = e.target.value;
    document.documentElement.style.setProperty('--reader-font-size', val + 'px');
    if (valueEl) valueEl.textContent = val + 'px';
    localStorage.setItem('marginalia-fontsize', val);
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

function init() {
  if (state.nightMode) {
    document.body.classList.add('night-mode');
    document.querySelector('.night-toggle').textContent = '☾';
  }
  // Load saved font size on init
  const savedFs = localStorage.getItem('marginalia-fontsize');
  if (savedFs) {
    document.documentElement.style.setProperty('--reader-font-size', savedFs + 'px');
  }
  initSelectionHandler();
  initFontsize();
  initSearch();
  loadBooks();
}

init();
