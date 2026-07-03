#!/usr/bin/env python3
"""Extract text from PDF, split into paragraphs, output JSON."""
import sys, json, os, re
from collections import Counter
import pymupdf

def extract_paragraphs(pdf_path):
    doc = pymupdf.open(pdf_path)
    page_texts = []
    page_line_sets = []

    for page in doc:
        text = page.get_text("text")
        if text:
            lines = [l.strip() for l in text.split("\n")]
            page_texts.append(lines)
            page_line_sets.append(set(lines))
    doc.close()

    # Detect headers/footers: lines that appear on >40% of pages (and are short)
    if len(page_texts) > 3:
        line_freq = Counter()
        for ls in page_line_sets:
            for l in ls:
                if l and len(l) < 80:
                    line_freq[l] += 1
        threshold = max(3, len(page_texts) * 0.4)
        hf_lines = {l for l, c in line_freq.items() if c >= threshold}
        # Also remove bare page numbers
        hf_lines |= {l for ls in page_line_sets for l in ls if re.match(r'^[\d\s\-–—ivxlcIVXLC]+$', l)}
    else:
        hf_lines = set()

    # Flatten all lines, removing headers/footers
    all_lines = []
    for page_lines in page_texts:
        for line in page_lines:
            if line in hf_lines:
                continue
            all_lines.append(line)
        all_lines.append("")  # page break = blank line

    # Build paragraphs by merging lines
    sentence_enders = set("。！？.!?」』）)\"'…—\"")
    paragraphs = []
    buf = ""

    for line in all_lines:
        if not line:
            if buf.strip():
                paragraphs.append(buf.strip())
                buf = ""
            continue

        if buf:
            # Heuristic: if buf doesn't end with sentence-ender and line doesn't
            # start with uppercase/CJK-start patterns, it's a continuation
            last_char = buf.rstrip()[-1] if buf.rstrip() else ""
            if last_char not in sentence_enders and not looks_like_new_paragraph(line, buf):
                buf = buf.rstrip() + " " + line
            else:
                if buf.strip():
                    paragraphs.append(buf.strip())
                buf = line
        else:
            buf = line

    if buf.strip():
        paragraphs.append(buf.strip())

    # Merge very short fragments into neighbors
    merged = []
    for p in paragraphs:
        if len(p) <= 3:
            continue
        merged.append(p)

    return merged

def looks_like_new_paragraph(line, prev_buf):
    """Heuristic: does this line look like the start of a new paragraph?"""
    if not line:
        return True
    # Starts with common paragraph indicators
    if re.match(r'^[\s　]{2,}', line):  # indented
        return True
    if re.match(r'^(第[一二三四五六七八九十百千\d]+[章节篇回卷集部]|Chapter\s|CHAPTER\s|Part\s|PART\s)', line):
        return True
    if re.match(r'^[一二三四五六七八九十]+[、.．]', line):
        return True
    if re.match(r'^\d+[、.．)\s]', line):
        return True
    # If previous buffer ended with a sentence-ender
    prev_end = prev_buf.rstrip()[-1] if prev_buf.rstrip() else ""
    if prev_end in "。！？.!?」』）)…—\"'\"":
        return True
    return False

# multer 落盘名是 randomUUID().ext，兜到它等于没有标题——返空让 server 用 originalname
UUID_NAME = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)

def extract_title(pdf_path):
    doc = pymupdf.open(pdf_path)
    meta = doc.metadata
    title = meta.get("title", "").strip() if meta else ""
    doc.close()

    if title and len(title) > 2 and not re.match(r'^[0-9a-f-]{8,}$', title):
        return title

    name = os.path.splitext(os.path.basename(pdf_path))[0]
    if UUID_NAME.match(name):
        return ""
    for pat in ['z-library.sk, 1lib.sk, z-lib.sk', 'z-librarysk 1libsk z-libsk',
                'Z-Library', 'z-lib.sk', '1lib.sk', '(z-library', '(Z-Library']:
        name = name.replace(pat, '')
    name = re.sub(r'\([^)]*\)\s*$', '', name).strip().strip('.')
    return name if len(name) > 1 else os.path.splitext(os.path.basename(pdf_path))[0]

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: extract_pdf.py <path>"}))
        sys.exit(1)

    path = sys.argv[1]
    try:
        title = extract_title(path)
        paragraphs = extract_paragraphs(path)
        result = {
            "title": title,
            "paragraphs": [{"id": i+1, "text": p} for i, p in enumerate(paragraphs)]
        }
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
