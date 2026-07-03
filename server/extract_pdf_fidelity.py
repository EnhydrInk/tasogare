#!/usr/bin/env python3
"""Extract per-page PDF text and word bounding boxes for fidelity mode."""
import json
import os
import re
import sys

import pymupdf


# multer 落盘名是 randomUUID().ext，兜到它等于没有标题——返空让 server 用 originalname
UUID_NAME = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def extract_title(pdf_path):
    doc = pymupdf.open(pdf_path)
    meta = doc.metadata
    title = meta.get("title", "").strip() if meta else ""
    doc.close()

    if title and len(title) > 2 and not re.match(r"^[0-9a-f-]{8,}$", title):
        return title

    name = os.path.splitext(os.path.basename(pdf_path))[0]
    if UUID_NAME.match(name):
        return ""
    for pat in [
        "z-library.sk, 1lib.sk, z-lib.sk",
        "z-librarysk 1libsk z-libsk",
        "Z-Library",
        "z-lib.sk",
        "1lib.sk",
        "(z-library",
        "(Z-Library",
    ]:
        name = name.replace(pat, "")
    name = re.sub(r"\([^)]*\)\s*$", "", name).strip().strip(".")
    return name if len(name) > 1 else os.path.splitext(os.path.basename(pdf_path))[0]


def extract_pages(pdf_path):
    doc = pymupdf.open(pdf_path)
    pages = []
    for page_index, page in enumerate(doc, start=1):
        raw_words = page.get_text("words")
        raw_words.sort(key=lambda w: (w[5], w[6], w[7], w[1], w[0]))
        words = [
            [round(w[0], 3), round(w[1], 3), round(w[2], 3), round(w[3], 3), str(w[4])]
            for w in raw_words
            if len(w) >= 5 and str(w[4]).strip()
        ]
        text = " ".join(w[4] for w in words)
        pages.append({"n": page_index, "text": text, "words": words})
    doc.close()
    return pages


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: extract_pdf_fidelity.py <path>"}))
        sys.exit(1)

    path = sys.argv[1]
    try:
        pages = extract_pages(path)
        print(json.dumps({
            "title": extract_title(path),
            "page_count": len(pages),
            "pages": pages,
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
