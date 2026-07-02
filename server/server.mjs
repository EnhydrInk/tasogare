import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import multer from "multer";
import { randomUUID, createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, renameSync } from "fs";
import { execFileSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import iconv from "iconv-lite";

process.on("uncaughtException", (err) => { console.error("UNCAUGHT:", err.stack || err.message); });
process.on("unhandledRejection", (err) => { console.error("UNHANDLED:", err.stack || err.message); });

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "18008", 10);
const HOST = process.env.HOST || "127.0.0.1";
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";
const DATA_DIR = process.env.DATA_DIR || "/opt/tasogare/data";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "/opt/tasogare/uploads";
const EXTRACT_SCRIPT = join(__dirname, "extract_pdf.py");
const EXTRACT_EPUB = join(__dirname, "extract_epub.py");
// InKieran 事件推送（不设 = 关闭；fire-and-forget，永不阻塞主流程）
const INKIERAN_PUSH_URL = process.env.INKIERAN_PUSH_URL || "";
const INKIERAN_PUSH_TOKEN = process.env.INKIERAN_PUSH_TOKEN || "";
const TARGET_CHARS = 800;

[DATA_DIR, UPLOAD_DIR].forEach(d => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });

// --- File locking ---
const fileLocks = new Map();
async function withFileLock(file, fn) {
  const prev = fileLocks.get(file) || Promise.resolve();
  const current = prev.then(fn, fn);
  fileLocks.set(file, current);
  try { return await current; } finally {
    if (fileLocks.get(file) === current) fileLocks.delete(file);
  }
}

// --- InKieran 事件推送 ---
function pushEvent(event) {
  if (!INKIERAN_PUSH_URL) return;
  const headers = { "Content-Type": "application/json" };
  if (INKIERAN_PUSH_TOKEN) headers.Authorization = `Bearer ${INKIERAN_PUSH_TOKEN}`;
  fetch(INKIERAN_PUSH_URL, {
    method: "POST", headers,
    body: JSON.stringify({ source: "tasogare", at: new Date().toISOString(), ...event }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

function todayJST() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
function jstDay(iso) {
  return iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : null;
}

// --- Data helpers ---
function bookPath(id) { return `${DATA_DIR}/${id}.json`; }

function loadBook(id) {
  const p = bookPath(id);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

function saveBook(book) {
  const p = bookPath(book.id);
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(book, null, 2), "utf-8");
  renameSync(tmp, p);
}

function computePages(paragraphs) {
  if (!paragraphs || paragraphs.length === 0) return [];
  const pages = [];
  let currentIds = [];
  let currentChars = 0;

  for (const para of paragraphs) {
    const len = para.text.length;
    if (currentChars > 0 && currentChars + len > TARGET_CHARS) {
      pages.push(currentIds);
      currentIds = [para.id];
      currentChars = len;
    } else {
      currentIds.push(para.id);
      currentChars += len;
    }
  }
  if (currentIds.length > 0) {
    pages.push(currentIds);
  }
  return pages;
}

function ensurePages(book) {
  if (!book.pages || book.pages.length === 0) {
    book.pages = computePages(book.paragraphs);
    saveBook(book);
  }
  return book;
}

function getPageForParagraph(book, paraId) {
  ensurePages(book);
  for (let i = 0; i < book.pages.length; i++) {
    if (book.pages[i].includes(paraId)) return i + 1;
  }
  return 1;
}

function listBooks() {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      try {
        const b = JSON.parse(readFileSync(`${DATA_DIR}/${f}`, "utf-8"));
        if (!b.id || !b.title) return null;
        if (!b.pages || b.pages.length === 0) {
          b.pages = computePages(b.paragraphs || []);
          saveBook(b);
        }
        return {
          id: b.id,
          title: b.title,
          filename: b.filename,
          paragraph_count: b.paragraphs?.length || 0,
          page_count: b.pages.length,
          annotation_count: b.annotations?.length || 0,
          has_bookmark: !!b.bookmark,
          progress: b.progress || null,
          created_at: b.created_at,
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function getPage(book, pageNum) {
  ensurePages(book);
  if (pageNum < 1 || pageNum > book.pages.length) return null;
  const paraIds = new Set(book.pages[pageNum - 1]);
  const paras = book.paragraphs.filter(p => paraIds.has(p.id));
  return { page: pageNum, total_pages: book.pages.length, paragraphs: paras };
}

function readingStatus() {
  const day = todayJST();
  const books = [];
  let total = 0;
  for (const meta of listBooks()) {
    const book = loadBook(meta.id);
    if (!book) continue;
    const seconds = book.reading_log?.[day] || 0;
    const annotations_today = (book.annotations || []).filter(a => jstDay(a.created_at) === day).length;
    const vocab_today = (book.vocab || []).filter(v => jstDay(v.created_at) === day).length;
    if (!seconds && !annotations_today && !vocab_today) continue;
    ensurePages(book);
    total += seconds;
    books.push({
      id: book.id, title: book.title, seconds,
      page: book.progress?.page || 0, total_pages: book.pages.length,
      annotations_today, vocab_today,
      last_active_at: book.last_active_at || book.progress?.updated_at || null,
    });
  }
  return { date: day, total_seconds: total, books };
}

// --- MCP Server ---
function createMcp() {
  const server = new McpServer({ name: "tasogare", version: "1.0.0" });

  server.tool("list_books", "书架列表", {}, async () => {
    const books = listBooks();
    if (books.length === 0) return { content: [{ type: "text", text: "书架空空如也。" }] };
    const text = books.map(b =>
      `📖 ${b.title} (${b.paragraph_count}段, ${b.page_count}页)\n   ID: ${b.id}\n   批注: ${b.annotation_count} | 书签: ${b.has_bookmark ? "§"+b.bookmark : "无"}\n   进度: ${b.progress ? `第${b.progress.page}页` : "未开始"}`
    ).join("\n\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("read_pages", "分页读取书籍内容", {
    book_id: z.string().describe("书籍ID"),
    page: z.number().optional().describe("页码,默认1"),
  }, async ({ book_id, page }) => {
    const book = loadBook(book_id);
    if (!book) return { content: [{ type: "text", text: "找不到这本书。" }] };
    ensurePages(book);
    const p = page || 1;
    if (p < 1 || p > book.pages.length) return { content: [{ type: "text", text: `页码无效。共${book.pages.length}页。` }] };
    const result = getPage(book, p);
    const text = `《${book.title}》第${p}/${result.total_pages}页\n\n` +
      result.paragraphs.map(para => `[§${para.id}] ${para.text}`).join("\n\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("read_annotations", "读取批注", {
    book_id: z.string().describe("书籍ID"),
    author: z.string().optional().describe("筛选作者: 音音 或 克先生"),
    context_size: z.number().optional().describe("上下文段落数，默认3"),
  }, async ({ book_id, author, context_size }) => {
    const book = loadBook(book_id);
    if (!book) return { content: [{ type: "text", text: "找不到这本书。" }] };
    let annots = book.annotations || [];
    if (author) annots = annots.filter(a => a.author === author);
    if (annots.length === 0) return { content: [{ type: "text", text: "暂无批注。" }] };

    const ctx = context_size || 3;
    const text = annots.map(a => {
      const para = book.paragraphs.find(p => p.id === a.paragraph_id);
      const paraIdx = book.paragraphs.findIndex(p => p.id === a.paragraph_id);
      const before = book.paragraphs.slice(Math.max(0, paraIdx - ctx), paraIdx).map(p => `  [§${p.id}] ${p.text}`).join("\n");
      const after = book.paragraphs.slice(paraIdx + 1, paraIdx + 1 + ctx).map(p => `  [§${p.id}] ${p.text}`).join("\n");
      const replyInfo = a.reply_to ? `\n  ↩ 回复批注 ${a.reply_to}` : "";
      return `--- 批注 ${a.id} (${a.author}) ---\n` +
        `段落 [§${a.paragraph_id}]: ${para?.text || "(段落已删除)"}\n` +
        `${a.type === "highlight" ? "📌 仅划线" : `💬 ${a.text}`}${replyInfo}\n` +
        `上文:\n${before}\n下文:\n${after}`;
    }).join("\n\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("write_comment", "克先生写评论", {
    book_id: z.string().describe("书籍ID"),
    paragraph_id: z.number().describe("段落编号"),
    content: z.string().describe("评论内容"),
    reply_to: z.string().optional().describe("回复的批注ID"),
    highlight_id: z.string().optional().describe("关联的高亮批注ID"),
  }, async ({ book_id, paragraph_id, content, reply_to, highlight_id }) => {
    return withFileLock(bookPath(book_id), async () => {
      const book = loadBook(book_id);
      if (!book) return { content: [{ type: "text", text: "找不到这本书。" }] };
      const para = book.paragraphs.find(p => p.id === paragraph_id);
      if (!para) return { content: [{ type: "text", text: `段落 §${paragraph_id} 不存在。` }] };
      if (!book.annotations) book.annotations = [];
      const annot = {
        id: randomUUID().slice(0, 8),
        paragraph_id,
        type: "note",
        text: content,
        author: "克先生",
        reply_to: reply_to || null,
        highlight_id: highlight_id || null,
        created_at: new Date().toISOString(),
      };
      book.annotations.push(annot);
      saveBook(book);
      pushEvent({ type: "note", author: "克先生", book_id, book_title: book.title, paragraph_id, text: content.slice(0, 200) });
      return { content: [{ type: "text", text: `已在 §${paragraph_id} 留下评论：${content.slice(0, 50)}...` }] };
    });
  });

  server.tool("highlight_text", "克先生画荧光笔高亮", {
    book_id: z.string().describe("书籍ID"),
    paragraph_id: z.number().describe("段落编号"),
    text: z.string().describe("要高亮的原文片段（必须是段落中的原文）"),
  }, async ({ book_id, paragraph_id, text }) => {
    return withFileLock(bookPath(book_id), async () => {
      const book = loadBook(book_id);
      if (!book) return { content: [{ type: "text", text: "找不到这本书。" }] };
      const para = book.paragraphs.find(p => p.id === paragraph_id);
      if (!para) return { content: [{ type: "text", text: `段落 §${paragraph_id} 不存在。` }] };
      if (!para.text.includes(text)) return { content: [{ type: "text", text: "原文中找不到这段文字，请确认引用准确。" }] };
      if (!book.annotations) book.annotations = [];
      const annot = {
        id: randomUUID().slice(0, 8),
        paragraph_id,
        type: "highlight",
        text,
        author: "克先生",
        reply_to: null,
        created_at: new Date().toISOString(),
      };
      book.annotations.push(annot);
      saveBook(book);
      pushEvent({ type: "highlight", author: "克先生", book_id, book_title: book.title, paragraph_id, text: text.slice(0, 200) });
      return { content: [{ type: "text", text: `已高亮 §${paragraph_id}：「${text.slice(0, 40)}…」` }] };
    });
  });




  server.tool("get_progress", "读取阅读进度", {
    book_id: z.string().describe("书籍ID"),
  }, async ({ book_id }) => {
    const book = loadBook(book_id);
    if (!book) return { content: [{ type: "text", text: "找不到这本书。" }] };
    ensurePages(book);
    const totalPages = book.pages.length;
    const p = book.progress || { page: 0 };
    const pct = totalPages > 0 ? Math.round((p.page / totalPages) * 100) : 0;
    return { content: [{ type: "text", text: `《${book.title}》阅读进度：第${p.page}/${totalPages}页 (${pct}%)` }] };
  });


  server.tool("read_vocab", "读生词本", {
    book_id: z.string().describe("书籍ID"),
  }, async ({ book_id }) => {
    const book = loadBook(book_id);
    if (!book) return { content: [{ type: "text", text: "找不到这本书。" }] };
    const vocab = book.vocab || [];
    if (vocab.length === 0) return { content: [{ type: "text", text: "生词本是空的。" }] };
    const text = `《${book.title}》生词本（${vocab.length}词）\n\n` + vocab.map(v => {
      const para = book.paragraphs.find(p => p.id === v.paragraph_id);
      const ctx = para ? `\n  出处 [§${para.id}]: ${para.text.slice(0, 120)}` : "";
      return `• ${v.word} (ID: ${v.id})${v.note ? `\n  注: ${v.note}` : "\n  （还没有注解）"}${ctx}`;
    }).join("\n\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("annotate_vocab", "克先生给生词写注解（词义/例句/词源）", {
    book_id: z.string().describe("书籍ID"),
    vocab_id: z.string().describe("生词ID"),
    note: z.string().describe("注解内容"),
  }, async ({ book_id, vocab_id, note }) => {
    return withFileLock(bookPath(book_id), async () => {
      const book = loadBook(book_id);
      if (!book) return { content: [{ type: "text", text: "找不到这本书。" }] };
      const entry = (book.vocab || []).find(v => v.id === vocab_id);
      if (!entry) return { content: [{ type: "text", text: "找不到这个生词。" }] };
      entry.note = note;
      entry.note_author = "克先生";
      saveBook(book);
      return { content: [{ type: "text", text: `已给「${entry.word}」写注解。` }] };
    });
  });

  server.tool("recent_activity", "最近的划线/批注/生词动态（共读追进度用）", {
    hours: z.number().optional().describe("时间窗口小时数,默认24"),
    author: z.string().optional().describe("筛选作者: 音音 或 克先生"),
  }, async ({ hours, author }) => {
    const cutoff = Date.now() - (hours || 24) * 3600 * 1000;
    const sections = [];
    for (const meta of listBooks()) {
      const book = loadBook(meta.id);
      if (!book) continue;
      let annots = (book.annotations || []).filter(a => new Date(a.created_at).getTime() >= cutoff);
      if (author) annots = annots.filter(a => a.author === author);
      const vocab = author && author !== "音音" ? [] : (book.vocab || []).filter(v => new Date(v.created_at).getTime() >= cutoff);
      if (!annots.length && !vocab.length) continue;
      const lines = [`《${book.title}》(ID: ${book.id})`];
      for (const a of annots) {
        const para = book.paragraphs.find(p => p.id === a.paragraph_id);
        if (a.type === "highlight") {
          lines.push(`  📌 ${a.author} 划线 [§${a.paragraph_id}]:「${a.text}」`);
        } else {
          lines.push(`  💬 ${a.author} 批注 [§${a.paragraph_id}]: ${a.text}${para ? `\n     原文: ${para.text.slice(0, 100)}` : ""}`);
        }
      }
      for (const v of vocab) lines.push(`  📖 生词「${v.word}」${v.note ? ` — ${v.note}` : ""}`);
      sections.push(lines.join("\n"));
    }
    if (!sections.length) return { content: [{ type: "text", text: "这段时间没有新动态。" }] };
    return { content: [{ type: "text", text: sections.join("\n\n") }] };
  });

  server.tool("reading_status", "今天的阅读时长与进度", {}, async () => {
    const st = readingStatus();
    if (!st.books.length) return { content: [{ type: "text", text: `今天（${st.date}）还没翻书。` }] };
    const mins = Math.round(st.total_seconds / 60);
    const lines = st.books.map(b =>
      `《${b.title}》 ${Math.round(b.seconds / 60)}分钟 · 第${b.page}/${b.total_pages}页` +
      (b.annotations_today ? ` · 批注/划线+${b.annotations_today}` : "") +
      (b.vocab_today ? ` · 生词+${b.vocab_today}` : ""));
    return { content: [{ type: "text", text: `今天（${st.date}）共读书 ${mins} 分钟\n` + lines.join("\n") }] };
  });

  return server;
}

// --- Express ---
const app = express();
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 150 * 1024 * 1024 } });
app.use((req, res, next) => { console.log(`[DEBUG] ${req.method} ${req.path}`); next(); });

function makeBook(id, title, filename, paragraphs) {
  const pages = computePages(paragraphs);
  return {
    id, title, filename, created_at: new Date().toISOString(),
    paragraphs, pages, annotations: [], bookmarks: [],
    progress: { page: 1, updated_at: new Date().toISOString() },
  };
}

// --- REST API for frontend ---

app.post("/api/upload-book", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const { originalname, path: tmpPath } = req.file;
    const id = randomUUID().slice(0, 8);
    const ext = originalname.split(".").pop().toLowerCase();

    // Rename uploaded file to a safe UUID-based name to prevent path injection
    const safeName = randomUUID() + '.' + ext;
    const safePath = join(UPLOAD_DIR, safeName);
    renameSync(tmpPath, safePath);

    if (ext === "txt") {
      const rawBuf = readFileSync(safePath);
      let text = rawBuf.toString("utf-8");
      if (text.includes("�")) { text = iconv.decode(rawBuf, "gbk"); }
      let parts = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 5);
      if (parts.length < 10) {
        parts = text.split(/\n/).map(p => p.trim()).filter(p => p.length > 5);
      }
      const paragraphs = parts.map((p, i) => ({ id: i + 1, text: p }));
      const title = originalname.replace(/\.txt$/i, "");
      const book = makeBook(id, title, originalname, paragraphs);
      saveBook(book);
      try { unlinkSync(safePath); } catch {}
      return res.json({ ok: true, id, title, paragraph_count: paragraphs.length, page_count: book.pages.length });
    }

    if (ext === "pdf") {
      try {
        const result = execFileSync('python3', [EXTRACT_SCRIPT, safePath], {
          encoding: "utf-8", timeout: 120000, maxBuffer: 100 * 1024 * 1024,
        });
        const parsed = JSON.parse(result);
        if (parsed.error) { try { unlinkSync(safePath); } catch {} return res.status(500).json({ error: parsed.error }); }
        const title = parsed.title || originalname.replace(/\.pdf$/i, "");
        const book = makeBook(id, title, originalname, parsed.paragraphs);
        if (parsed.toc && parsed.toc.length > 0) book.toc = parsed.toc;
        saveBook(book);
        try { unlinkSync(safePath); } catch {}
        return res.json({ ok: true, id, title, paragraph_count: book.paragraphs.length, page_count: book.pages.length, toc_count: (book.toc || []).length });
      } catch (e) {
        try { unlinkSync(safePath); } catch {}
        return res.status(500).json({ error: `PDF extraction failed: ${e.message}` });
      }
    }

    if (ext === "epub") {
      try {
        const result = execFileSync('python3', [EXTRACT_EPUB, safePath], {
          encoding: "utf-8", timeout: 120000, maxBuffer: 100 * 1024 * 1024,
        });
        const parsed = JSON.parse(result);
        if (parsed.error) { try { unlinkSync(safePath); } catch {} return res.status(500).json({ error: parsed.error }); }
        const title = parsed.title || originalname.replace(/\.epub$/i, "");
        const book = makeBook(id, title, originalname, parsed.paragraphs);
        if (parsed.toc && parsed.toc.length > 0) book.toc = parsed.toc;
        saveBook(book);
        try { unlinkSync(safePath); } catch {}
        return res.json({ ok: true, id, title, paragraph_count: book.paragraphs.length, page_count: book.pages.length, toc_count: (book.toc || []).length });
      } catch (e) {
        try { unlinkSync(safePath); } catch {}
        return res.status(500).json({ error: `EPUB extraction failed: ${e.message}` });
      }
    }

    try { unlinkSync(safePath); } catch {}
    return res.status(400).json({ error: "Unsupported file type. Use .pdf, .epub or .txt" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.json({ limit: "10mb" }));

app.get("/api/books", (req, res) => {
  res.json(listBooks());
});

app.get("/api/books/:id", (req, res) => {
  const book = loadBook(req.params.id);
  if (!book) return res.status(404).json({ error: "Not found" });
  ensurePages(book);
  res.json({
    id: book.id, title: book.title, filename: book.filename,
    paragraph_count: book.paragraphs.length,
    page_count: book.pages.length,
    annotation_count: (book.annotations || []).length,
    has_bookmark: !!book.bookmark,
    progress: book.progress,
    created_at: book.created_at,
  });
});

app.get("/api/books/:id/pages/:page", (req, res) => {
  const book = loadBook(req.params.id);
  if (!book) return res.status(404).json({ error: "Not found" });
  ensurePages(book);
  const page = parseInt(req.params.page);
  if (page < 1 || page > book.pages.length) return res.status(400).json({ error: `Invalid page. Total: ${book.pages.length}` });
  res.json(getPage(book, page));
});

app.get("/api/books/:id/page-for/:paraId", (req, res) => {
  const book = loadBook(req.params.id);
  if (!book) return res.status(404).json({ error: "Not found" });
  const paraId = parseInt(req.params.paraId);
  const page = getPageForParagraph(book, paraId);
  res.json({ page });
});



app.get('/api/books/:id/search', (req, res) => {
  const book = loadBook(req.params.id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q || q.length < 2) return res.json([]);
  const results = [];
  for (const p of book.paragraphs) {
    const idx = p.text.toLowerCase().indexOf(q);
    if (idx !== -1) {
      const start = Math.max(0, idx - 30);
      const end = Math.min(p.text.length, idx + q.length + 50);
      const snippet = (start > 0 ? '...' : '') + p.text.slice(start, end) + (end < p.text.length ? '...' : '');
      results.push({ paragraph_id: p.id, snippet });
      if (results.length >= 50) break;
    }
  }
  res.json(results);
});

app.get('/api/books/:id/toc', (req, res) => {
  const book = loadBook(req.params.id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book.toc || []);
});

app.get("/api/books/:id/annotations", (req, res) => {
  const book = loadBook(req.params.id);
  if (!book) return res.status(404).json({ error: "Not found" });
  let annots = book.annotations || [];
  if (req.query.author) annots = annots.filter(a => a.author === req.query.author);
  if (req.query.has_dialog === "true") {
    const paraIds = new Set();
    annots.forEach(a => { if (a.reply_to) paraIds.add(a.paragraph_id); });
    annots = annots.filter(a => paraIds.has(a.paragraph_id));
  }
  res.json(annots);
});

app.post("/api/books/:id/annotations", async (req, res) => {
  try {
    const result = await withFileLock(bookPath(req.params.id), async () => {
      const book = loadBook(req.params.id);
      if (!book) return { status: 404, body: { error: "Not found" } };
      const { paragraph_id, type, text, highlight_id } = req.body;
      if (!paragraph_id) return { status: 400, body: { error: "Missing paragraph_id" } };
      if (!book.annotations) book.annotations = [];
      const annot = {
        id: randomUUID().slice(0, 8),
        paragraph_id,
        type: type || "highlight",
        text: text || "",
        author: req.body.author || "音音",
        reply_to: null,
        highlight_id: highlight_id || null,
        created_at: new Date().toISOString(),
      };
      book.annotations.push(annot);
      saveBook(book);
      const para = book.paragraphs.find(p => p.id === paragraph_id);
      pushEvent({
        type: annot.type, author: annot.author, book_id: book.id, book_title: book.title,
        paragraph_id, text: (annot.text || "").slice(0, 200),
        paragraph_text: (para?.text || "").slice(0, 200),
      });
      return { status: 200, body: annot };
    });
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/books/:id/reading-ping", async (req, res) => {
  try {
    const result = await withFileLock(bookPath(req.params.id), async () => {
      const book = loadBook(req.params.id);
      if (!book) return { status: 404, body: { error: "Not found" } };
      const secs = Math.min(300, Math.max(0, parseInt(req.body.seconds) || 60));
      if (!book.reading_log) book.reading_log = {};
      const day = todayJST();
      book.reading_log[day] = (book.reading_log[day] || 0) + secs;
      book.last_active_at = new Date().toISOString();
      saveBook(book);
      return { status: 200, body: { ok: true, today_seconds: book.reading_log[day] } };
    });
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/reading-status", (req, res) => {
  res.json(readingStatus());
});

app.put("/api/books/:id/progress", async (req, res) => {
  try {
    const result = await withFileLock(bookPath(req.params.id), async () => {
      const book = loadBook(req.params.id);
      if (!book) return { status: 404, body: { error: "Not found" } };
      book.progress = { page: req.body.page || 0, updated_at: new Date().toISOString() };
      saveBook(book);
      return { status: 200, body: book.progress };
    });
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/books/:id/bookmarks", async (req, res) => {
  try {
    const result = await withFileLock(bookPath(req.params.id), async () => {
      const book = loadBook(req.params.id);
      if (!book) return { status: 404, body: { error: "Not found" } };
      const { paragraph_id } = req.body;
      if (book.bookmark === paragraph_id) {
        book.bookmark = null;
        saveBook(book);
        return { status: 200, body: { action: "removed", paragraph_id } };
      }
      book.bookmark = paragraph_id;
      saveBook(book);
      return { status: 200, body: { action: "set", paragraph_id } };
    });
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/books/:id/bookmarks", (req, res) => {
  const book = loadBook(req.params.id);
  if (!book) return res.status(404).json({ error: "Not found" });
  if (book.bookmark) {
    const page = getPageForParagraph(book, book.bookmark);
    return res.json({ bookmark: book.bookmark, page });
  }
  res.json({ bookmark: null, page: null });
});

app.delete("/api/books/:id/annotations/:annotId", async (req, res) => {
  try {
    const result = await withFileLock(bookPath(req.params.id), async () => {
      const book = loadBook(req.params.id);
      if (!book) return { status: 404, body: { error: "Not found" } };
      const idx = (book.annotations || []).findIndex(a => a.id === req.params.annotId);
      if (idx < 0) return { status: 404, body: { error: "Annotation not found" } };
      const annot = book.annotations[idx];
      const deleted = [annot.id];
      if (annot.type === "highlight") {
        book.annotations = book.annotations.filter(a => {
          if (a.highlight_id === annot.id) { deleted.push(a.id); return false; }
          return true;
        });
      } else if (annot.type === "note" && annot.highlight_id) {
        const hlId = annot.highlight_id;
        book.annotations = book.annotations.filter(a => {
          if (a.id === hlId) { deleted.push(a.id); return false; }
          if (a.id !== annot.id && a.highlight_id === hlId) { deleted.push(a.id); return false; }
          return true;
        });
      }
      const newIdx = book.annotations.findIndex(a => a.id === req.params.annotId);
      if (newIdx >= 0) book.annotations.splice(newIdx, 1);
      saveBook(book);
      return { status: 200, body: { ok: true, deleted } };
    });
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Vocab ---
app.get("/api/books/:id/vocab", (req, res) => {
  const book = loadBook(req.params.id);
  if (!book) return res.status(404).json({ error: "Not found" });
  res.json(book.vocab || []);
});

app.post("/api/books/:id/vocab", async (req, res) => {
  try {
    const result = await withFileLock(bookPath(req.params.id), async () => {
      const book = loadBook(req.params.id);
      if (!book) return { status: 404, body: { error: "Not found" } };
      const { word, paragraph_id, note } = req.body;
      if (!word) return { status: 400, body: { error: "Missing word" } };
      if (!book.vocab) book.vocab = [];
      const exists = book.vocab.find(v => v.word.toLowerCase() === word.toLowerCase() && v.paragraph_id === paragraph_id);
      if (exists) return { status: 200, body: exists };
      const entry = {
        id: randomUUID().slice(0, 8),
        word: word.trim(),
        paragraph_id: paragraph_id || null,
        note: note || "",
        created_at: new Date().toISOString(),
      };
      book.vocab.push(entry);
      saveBook(book);
      pushEvent({ type: "vocab", author: "音音", book_id: book.id, book_title: book.title, word: entry.word });
      return { status: 200, body: entry };
    });
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/books/:id/vocab/:vocabId", async (req, res) => {
  try {
    const result = await withFileLock(bookPath(req.params.id), async () => {
      const book = loadBook(req.params.id);
      if (!book) return { status: 404, body: { error: "Not found" } };
      const entry = (book.vocab || []).find(v => v.id === req.params.vocabId);
      if (!entry) return { status: 404, body: { error: "Vocab entry not found" } };
      if (req.body.note !== undefined) entry.note = req.body.note;
      if (req.body.word !== undefined) entry.word = req.body.word.trim();
      saveBook(book);
      return { status: 200, body: entry };
    });
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/books/:id/vocab/:vocabId", async (req, res) => {
  try {
    const result = await withFileLock(bookPath(req.params.id), async () => {
      const book = loadBook(req.params.id);
      if (!book) return { status: 404, body: { error: "Not found" } };
      const idx = (book.vocab || []).findIndex(v => v.id === req.params.vocabId);
      if (idx < 0) return { status: 404, body: { error: "Vocab entry not found" } };
      book.vocab.splice(idx, 1);
      saveBook(book);
      return { status: 200, body: { ok: true } };
    });
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/books/:id/title", async (req, res) => {
  try {
    const result = await withFileLock(bookPath(req.params.id), async () => {
      const book = loadBook(req.params.id);
      if (!book) return { status: 404, body: { error: "Not found" } };
      book.title = req.body.title || book.title;
      saveBook(book);
      return { status: 200, body: { ok: true, title: book.title } };
    });
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/books/:id", async (req, res) => {
  try {
    const result = await withFileLock(bookPath(req.params.id), async () => {
      const p = bookPath(req.params.id);
      if (!existsSync(p)) return { status: 404, body: { error: "Not found" } };
      unlinkSync(p);
      return { status: 200, body: { ok: true } };
    });
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Re-index endpoint (one-time migration) ---
app.post("/api/reindex", (req, res) => {
  const files = readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  let count = 0;
  for (const f of files) {
    try {
      const book = JSON.parse(readFileSync(`${DATA_DIR}/${f}`, "utf-8"));
      if (!book.id || !book.paragraphs) continue;
      book.pages = computePages(book.paragraphs);
      saveBook(book);
      count++;
    } catch {}
  }
  res.json({ ok: true, reindexed: count });
});

// --- OAuth Resource Metadata & Bearer Token Auth ---
function externalBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function mcpResourceMetadata(req) {
  const baseUrl = externalBaseUrl(req);
  return {
    resource: `${baseUrl}/mcp`,
    resource_name: "Tasogare",
    bearer_methods_supported: ["header"],
    scopes_supported: [],
    authorization_servers: [externalBaseUrl(req)],
  };
}

function mcpAuthorized(req) {
  if (!MCP_AUTH_TOKEN) return true;
  const auth = req.headers.authorization;
  return auth === `Bearer ${MCP_AUTH_TOKEN}`;
}

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json(mcpResourceMetadata(req));
});
app.get("/.well-known/oauth-protected-resource/mcp", (req, res) => {
  res.json(mcpResourceMetadata(req));
});


// --- OAuth 2.1 Minimal Flow ---
const pendingCodes = new Map();

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const baseUrl = externalBaseUrl(req);
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
});

app.post("/register", (req, res) => {
  const clientId = randomUUID();
  res.status(201).json({
    client_id: clientId,
    client_name: req.body.client_name || "MCP Client",
    redirect_uris: req.body.redirect_uris || [],
  });
});

app.get("/authorize", (req, res) => {
  const { response_type, client_id, redirect_uri, code_challenge, code_challenge_method, state } = req.query;
  if (response_type !== "code" || !redirect_uri) return res.status(400).send("Invalid request");
  const code = randomUUID();
  pendingCodes.set(code, { client_id, redirect_uri, code_challenge, code_challenge_method, created: Date.now() });
  setTimeout(() => pendingCodes.delete(code), 300000);
  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(302, url.toString());
});

app.post("/token", express.urlencoded({ extended: false }), (req, res) => {
  const { grant_type, code, code_verifier } = req.body;
  if (grant_type !== "authorization_code") return res.status(400).json({ error: "unsupported_grant_type" });
  const pending = pendingCodes.get(code);
  if (!pending) return res.status(400).json({ error: "invalid_grant" });
  pendingCodes.delete(code);
  if (pending.code_challenge && code_verifier) {
    const expected = createHash("sha256").update(code_verifier).digest("base64url");
    if (expected !== pending.code_challenge) return res.status(400).json({ error: "invalid_grant", error_description: "PKCE mismatch" });
  }
  res.json({ access_token: MCP_AUTH_TOKEN, token_type: "Bearer", expires_in: 86400 });
});

// --- MCP dual transport ---
const transports = {};

app.use("/mcp", (req, res, next) => {
  if (!mcpAuthorized(req)) {
    const metadataUrl = `${externalBaseUrl(req)}/.well-known/oauth-protected-resource/mcp`;
    res.status(401).set("www-authenticate", `Bearer resource_metadata="${metadataUrl}"`).json({ error: "Unauthorized" });
    return;
  }
  console.log(`[mcp] ${req.method} ${req.url} | session: ${req.headers["mcp-session-id"] || "none"}`);
  if (req.method === "POST" && req.body) console.log(`  body.method: ${req.body?.method || "N/A"}`);
  next();
});

app.post("/mcp/sse", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && transports[sessionId]) {
    const t = transports[sessionId].transport;
    if (typeof t.handleRequest === "function") {
      await t.handleRequest(req, res, req.body);
    } else if (typeof t.handlePostMessage === "function") {
      await t.handlePostMessage(req, res, req.body);
    }
    return;
  }
  if (!isInitializeRequest(req.body)) {
    const sseEntry = Object.entries(transports).find(([_, s]) => s.transport instanceof SSEServerTransport);
    if (sseEntry) {
      await sseEntry[1].transport.handlePostMessage(req, res, req.body);
      return;
    }
    res.status(400).json({ error: "First request must be initialize" });
    return;
  }
  const mcpServer = createMcp();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => { transports[sid] = { transport, mcpServer }; }
  });
  transport.onclose = () => {
    const sid = Object.keys(transports).find(k => transports[k].transport === transport);
    if (sid) delete transports[sid];
  };
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp/sse", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && transports[sessionId] && transports[sessionId].transport instanceof StreamableHTTPServerTransport) {
    await transports[sessionId].transport.handleRequest(req, res, req.body);
    return;
  }
  const mcpServer = createMcp();
  const transport = new SSEServerTransport("/mcp/messages", res);
  transports[transport.sessionId] = { transport, mcpServer };
  res.on("close", () => { mcpServer.close(); delete transports[transport.sessionId]; });
  await mcpServer.connect(transport);
});

app.post("/mcp/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const session = transports[sessionId];
  if (!session) return res.status(400).json({ error: "No active session" });
  await session.transport.handlePostMessage(req, res, req.body);
});

app.get("/health", (req, res) => res.json({ status: "ok", service: "tasogare" }));

app.use(express.static(join(__dirname, "..", "client")));

app.listen(PORT, HOST, () => console.log(`Tasogare on ${HOST}:${PORT}`));
