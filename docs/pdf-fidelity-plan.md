# PDF 原版模式（fidelity mode）设计案

2026-07-03 调研定稿。起因：数学教材（Strang《Introduction to Linear Algebra》1602 页）纯文本重排毁公式，音音提议参考开源阅读器方案。四路并行调研（PDF.js/Hypothesis 锚定、开源阅读器拆解、移动端性能、pymupdf 桥接）的综合结论。

## 路线决定

**PDF.js 客户端渲染 + Hypothesis 三件套语义锚定 + 自存标注**，与现有重排模式并存（书级 `mode: reflow | fidelity`）。

### 为什么不是别的

- **pdf.js 自带 annotation layer** ❌ —— 为"批注后导出新 PDF"设计：高亮存盘后不可再编辑（[#18407](https://github.com/mozilla/pdf.js/issues/18407)），无容错锚定。
- **服务端渲染（pymupdf 出图+坐标 JSON）** ❌ —— 本质是把 PDF.js 重造在服务端，无现成轮子，每页两次请求，失去离线。
- **SVG 渲染后端** ❌ —— pdf.js 2.15+ 已废弃 SVGGraphics，canvas 是唯一正道。
- **Readest 的 CFI 统一模型**（PDF 页伪装 EPUB section）—— 架构优雅但要引入整套 foliate-js，主仓库 AGPL；杀鸡牛刀。
- **react-pdf-highlighter 的纯 rect 坐标锚**（MIT，可抄细节）—— 轻，但 rect 无文本语义：MCP 侧（克先生读批注）拿坐标没法用。我们是共读工具，**锚必须带原文**。

### 锚定数据结构（Hypothesis 三件套 + rects 渲染缓存）

fidelity 书的 annotation 锚：

```json
{
  "mode": "fidelity",
  "pdf_page": 123,
  "quote": "选中的原文",
  "prefix": "前 32 字符上下文",
  "suffix": "后 32 字符上下文",
  "position": 45678,
  "rects": [{ "x0":0,"y0":0,"x1":0,"y1":0 }]
}
```

- `quote/prefix/suffix/position`：Hypothesis 式语义锚（[hypothesis/client anchoring](https://github.com/hypothesis/client/tree/main/src/annotator/anchoring)）。定位顺序：position 直达 + quote 校验 → 失败退化 quote 模糊搜索（`approx-string-match`，编辑距离 + 加权打分：quote 50% / prefix 20% / suffix 20% / 位置 2%）。
- `rects`：PDF 空间坐标（scale 无关，抄 react-pdf-highlighter 的 `ScaledPosition` 思路），渲染快路径直画；缺失/校验失败走 quote 重锚慢路径。
- reflow 书的锚 `(paragraph_id, text)` 原样不动，两种锚共存于同一 annotations 数组，靠 `mode` 字段分流。

### 渲染层（前端）

- pdf.js `PDFViewer` 三层：canvas 位图 + 官方 `TextLayer`（可选中）+ 自绘高亮 overlay（绝对定位 div，双色 yinyin/kieran 沿用现有 CSS token）。
- **翻页模式而非无限滚动**：iOS WKWebView canvas 总内存硬上限 224–384MB（[#11297](https://github.com/mozilla/pdf.js/issues/11297) / [WebKit 195325](https://bugs.webkit.org/show_bug.cgi?id=195325)），快速连续滚动是撞线主因。单页/双页翻页 + 小 PageViewBuffer 让内存曲线平坦。
- 按需渲染 pdf.js 内置（`PDFRenderingQueue`），不自造。
- **worker 生命周期自管**：WebView 场景 `destroy()` 泄漏未修复（[#20198](https://github.com/mozilla/pdf.js/issues/20198)），反复开关书要主动重建。

### 服务端 / MCP 侧

- pymupdf 改为**逐页** `get_text("words")` 抽取，每词自带 `(pdf_page_no, bbox)`——fidelity 书的 MCP `read_pages` 按 PDF 页返回文本（公式乱但文字可读，克先生跟读够用）；克先生的 highlight/comment 用 quote 锚写入。
- 未来可给 reflow 书建"重排页 → PDF 页"映射（抽取时段落记录来源页范围），现有坐标系零破坏。

### 分阶段

| 阶段 | 内容 | 交付 |
| --- | --- | --- |
| P1 | fidelity 只读：上传时选模式 / canvas+TextLayer 翻页阅读 | Strang 的公式能看了 |
| P2 | 划线：选区 → 三件套锚 → 双色 overlay + 底部操作条复用 | 公式书上能共读 |
| P3 | MCP 适配：read_pages / highlight / comment 支持 fidelity 锚 | 克先生进得来 |
| P4 | 生词本接通 + 1602 页真机压测 + worker 回收调优 | 收尾 |

工作量档位：整体一周级；P1 单独约一个工作日。

### 两大风险

1. iOS canvas 内存上限——靠翻页模式 + 小 buffer 规避，P4 用 Strang 真机压测验证（单页 vs 连续滚动业界无实测数据，只能自己测）。
2. PDF TextLayer 的文本抽取顺序/空白不稳定（数学排版尤甚）——Hypothesis 的模糊锚定就是为此设计的，quote 锚容错；但选区体验在公式密集区可能不完美，接受。

### 反面教材（Koodo Reader，引以为戒）

Koodo 的 PDF/EPUB 共用一个 Note schema，但**字段语义分裂**：`cfi` 字段在 EPUB 存真 CFI、在 PDF 塞 JSON 页码；`range` 字段只有 PDF 用（塞 rect 数组）——同一字段两种含义，靠 `format === "PDF"` 分支解释。我们用显式 `mode` 字段分流两种锚型，绝不复用字段装不同语义。

### 情报来源（调研 agent 存档）

- Hypothesis anchoring：`types.ts` / `match-quote.ts` / `pdf.ts` / `placeholder.ts`（MIT 系可抄）
- react-pdf-highlighter：`ScaledPosition` 坐标转换 + div overlay（MIT，可抄）
- Readest / foliate-js：iframe per page + CFI + SVG Overlayer（主仓库 AGPL 只看思路；foliate-js 子模块 MIT）
- pdf.js FAQ / issues：内存模型与反模式
