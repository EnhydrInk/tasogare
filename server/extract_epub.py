#!/usr/bin/env python3
"""Extract text from EPUB, split into paragraphs, extract TOC, output JSON."""
import sys, json, os, re
import ebooklib
from ebooklib import epub
from html.parser import HTMLParser

class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paragraphs = []
        self.current = ""
        self.in_p = False
        self.skip_tags = {"script", "style", "nav"}
        self.skip = False
        self.heading_text = []

    def handle_starttag(self, tag, attrs):
        if tag in self.skip_tags:
            self.skip = True
        if tag in ("p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote"):
            self.in_p = True
            self.current = ""
            if tag in ("h1", "h2", "h3"):
                self._current_tag = tag
            else:
                self._current_tag = None

    def handle_endtag(self, tag):
        if tag in self.skip_tags:
            self.skip = False
        if tag in ("p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote"):
            text = self.current.strip()
            if text and len(text) > 3:
                entry = {"text": text}
                if hasattr(self, '_current_tag') and self._current_tag in ("h1", "h2", "h3"):
                    entry["heading"] = self._current_tag
                self.paragraphs.append(entry)
            self.in_p = False
            self.current = ""
            self._current_tag = None

    def handle_data(self, data):
        if self.skip:
            return
        if self.in_p:
            self.current += data
        else:
            text = data.strip()
            if text and len(text) > 20:
                self.paragraphs.append({"text": text})

def extract_toc(book):
    """Extract table of contents from EPUB."""
    toc_items = []

    def process_toc(items, level=0):
        for item in items:
            if isinstance(item, tuple):
                section, children = item
                toc_items.append({"title": section.title, "level": level})
                process_toc(children, level + 1)
            elif isinstance(item, epub.Link):
                toc_items.append({"title": item.title, "level": level})

    try:
        process_toc(book.toc)
    except:
        pass

    return toc_items

def extract_epub(epub_path):
    book = epub.read_epub(epub_path, options={"ignore_ncx": True})

    # Get title
    title = ""
    try:
        title = book.get_metadata("DC", "title")[0][0]
    except:
        pass
    if not title or len(title) < 2:
        name = os.path.splitext(os.path.basename(epub_path))[0]
        # multer 落盘名是 randomUUID().ext，兜到它等于没有标题——返空让 server 用 originalname
        title = "" if re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", name, re.I) else name

    # Extract TOC
    toc = extract_toc(book)

    # Extract text from all document items
    all_paragraphs = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        content = item.get_content().decode("utf-8", errors="ignore")
        extractor = TextExtractor()
        extractor.feed(content)
        all_paragraphs.extend(extractor.paragraphs)

    # Clean up and assign IDs
    cleaned = []
    seen = []
    for entry in all_paragraphs:
        text = re.sub(r'\s+', ' ', entry["text"]).strip()
        if text and len(text) > 5 and text not in seen[-3:]:
            para = {"id": len(cleaned) + 1, "text": text}
            if "heading" in entry:
                para["heading"] = entry["heading"]
            cleaned.append(para)
            seen.append(text)

    # Match TOC entries to paragraph IDs by finding heading text
    for toc_entry in toc:
        toc_title = toc_entry["title"].strip()
        for para in cleaned:
            if para["text"].strip() == toc_title or (len(toc_title) > 5 and para["text"].strip().startswith(toc_title)):
                toc_entry["paragraph_id"] = para["id"]
                break

    # Filter out TOC entries that couldn't be matched
    toc = [t for t in toc if "paragraph_id" in t]

    return title, cleaned, toc

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: extract_epub.py <path>"}))
        sys.exit(1)

    path = sys.argv[1]
    try:
        title, paragraphs, toc = extract_epub(path)
        result = {
            "title": title,
            "paragraphs": paragraphs,
            "toc": toc
        }
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
