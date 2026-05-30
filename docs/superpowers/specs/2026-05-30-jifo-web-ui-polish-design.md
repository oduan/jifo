# Jifo Web 外部界面优化设计文档

**日期：** 2026-05-30  
**范围：** Web 端笔记主界面的视觉、布局与交互优化。  
**技术栈：** React、TypeScript、CSS、Vitest、Testing Library。  

---

## 1. 目标

本次优化目标是让 Jifo Web 主界面更贴合当前温暖纸张感主题，减少黑色强对比元素，提升界面密度、输入体验与顶部信息组织。

用户已确认推荐视觉方向：

- 设置入口从左上角文字按钮改为头像右侧下拉 icon。
- 热力图单元格保持正方形。
- 选中态按钮不再使用近黑色背景，改为与主题匹配的柔和绿色/纸张色。
- 工作区顶部去掉英文 `JIFO` kicker，只保留更小、更精致的「全部笔记」标题。
- 新笔记输入框与发送按钮合并到同一个框架内，发送按钮改为右侧纸飞机 icon，并随输入内容启用/禁用。
- 搜索框移动到顶部「全部笔记」右侧，保持短输入框样式，用户输入后当前仍即时筛选，回车行为不额外改变页面状态。
- 笔记列表减少上下留白，去掉所有笔记下方共同的深色区域感，统一小字号与紧凑节奏。

---

## 2. 当前问题

### 2.1 设置入口过重

`SettingsPopover` 现在以 `summary` 文字「设置」展示在用户区域右侧。它像一个独立按钮，占据左上角注意力，与用户期望的头像菜单模型不一致。

### 2.2 热力图比例不稳定

`Heatmap` 使用 `gridTemplateColumns: repeat(columnCount, minmax(0, 1fr))`，CSS 中单元格 `width: 100%`、`height: 9px`。当侧栏宽度变化时，格子会横向拉伸，导致热力图变扁。

### 2.3 按钮选中态与主题冲突

`.tag-button[aria-pressed="true"]` 和 `.nav-pill[aria-pressed="true"]` 使用 `--jifo-green-dark` 深色背景，看起来接近黑色。主主题是暖米色、柔和绿色和纸张卡片，因此这个选中态过重。

### 2.4 工作区标题信息重复

顶部同时显示英文 `JIFO` 和中文「全部笔记」。当前界面已经有品牌和侧栏信息，工作区标题应更聚焦当前筛选上下文。

### 2.5 输入与提交割裂

`NoteEditor` 的 textarea 和提交按钮处于上下两个视觉区域。用户希望输入与发送是一体化的输入框体验：内容为空时发送 icon 灰色，不可提交；有内容时高亮可提交。

### 2.6 搜索位置不符合优先级

搜索框当前在新笔记输入框下方，占据单独一行。搜索是对笔记列表的辅助操作，应移动到顶部标题右侧，减少主输入区干扰。

### 2.7 笔记列表密度偏松

`.note-card`、`.note-card__content` 的 gap、padding、line-height 偏大，时间与内容之间距离过大。整体字体也需要与侧栏按钮、笔记内容、菜单操作保持统一的小字号节奏。

---

## 3. 设计方案

### 3.1 头像下拉设置

保留 `SettingsPopover` 组件，但将它从文字 `summary` 改为 icon trigger：

- 在头像和用户名右侧展示一个小号下拉 chevron。
- `summary` 增加 `aria-label="打开设置菜单"`，隐藏默认 disclosure marker。
- 悬停或点击时展开设置面板；使用原生 `details` 保留键盘可访问性。
- 面板内容继续承载当前用户名和退出登录按钮。

视觉上，设置不再像主操作按钮，而是用户资料区的一部分。

### 3.2 方形热力图

热力图改为固定单元格宽高：

- CSS 定义 `--heatmap-cell-size: 9px`。
- `.heatmap-grid` 使用 `grid-template-rows: repeat(7, var(--heatmap-cell-size))`。
- `grid-auto-columns: var(--heatmap-cell-size)`，每列宽度固定。
- `.heatmap-cell` 同时设置 `width` 和 `height` 为该变量。
- `Heatmap.tsx` 不再向 grid 注入 `gridTemplateColumns`，避免 `1fr` 拉伸。

这样每个格子在任何侧栏宽度下都是 1:1。

### 3.3 柔和主题选中态

新增更贴合主题的设计 token：

- `--jifo-green-tint`：浅绿色纸张背景。
- `--jifo-green-line`：绿色半透明边框。
- `--jifo-button-hover`：暖白 hover 背景。

按钮选中态调整为浅绿色底、深绿色文字和轻边框：

- `nav-pill` 与 `tag-button` 选中态使用浅绿色背景。
- 普通 hover 使用暖白或轻绿色，不使用黑色。
- primary 按钮仍可保留深绿色，但仅用于真正的主动作；新笔记发送按钮会使用绿色 icon 样式。

### 3.4 顶部标题与搜索

`NotesPage` 的工作区顶部改成两栏：

- 左侧：只显示标题，不再渲染 `JIFO` kicker。
- 标题字号从当前 clamp 大标题降到约 20px，适配笔记工具的轻量感。
- 右侧：短搜索框，最大宽度约 260px，placeholder 为「搜索文字或标签…」。
- 小屏幕时搜索框换行占满可用宽度。

搜索逻辑保持现有 `query` 状态和 `noteContains`，只移动 DOM 位置。

### 3.5 一体化输入框与纸飞机发送

`NoteEditor` 改成一个输入框容器内包含：

- textarea。
- 右上角扩大/收起按钮。
- 右下角发送按钮。

发送按钮行为：

- 使用原生 `button type="submit"`。
- 当 `toParagraphBlocks(text).length === 0` 时 `disabled`。
- 空内容时显示灰色、低对比，不可点击。
- 有内容时显示绿色高亮。
- `aria-label="发送笔记"`，视觉内容为纸飞机 icon。

提交后保持现有行为：清空内容并恢复默认高度。

### 3.6 笔记列表密度与字体统一

调整 CSS 密度：

- `.note-card` padding 从 10px 调低到约 8px 10px，gap 从 7px 调低到 4px。
- `.note-card time` 调整为 11px。
- `.note-card__content` 调整为 13px、line-height 约 1.5。
- `.tag-button`、`.nav-pill` 字体调整为 12px，min-height 约 26px。
- 菜单按钮、设置面板、搜索框字体统一到 12px-13px。
- `notes-stream` 保持透明背景，只让单条 note card 自己承担卡片背景，避免出现「所有笔记下面共同有深色区域」的视觉误解。

---

## 4. 文件影响

### 4.1 修改文件

- `web/src/features/settings/SettingsPopover.tsx`
  - 将文字设置入口改为头像区下拉 icon trigger。
  - 保持原有 userName 和 logout 功能。

- `web/src/features/heatmap/Heatmap.tsx`
  - 移除按列数动态注入 `1fr` 样式。
  - 保留日期单元渲染和无障碍 label。

- `web/src/features/notes/NotesPage.tsx`
  - 移除顶部 `JIFO` kicker。
  - 将搜索框移动到标题右侧。
  - 保留现有筛选、搜索和创建笔记逻辑。

- `web/src/features/notes/NoteEditor.tsx`
  - 将提交按钮移入输入框容器。
  - 改为纸飞机 icon 和 disabled 状态。
  - 增加 `hasContent` 派生状态，避免空提交。

- `web/src/app/styles.css`
  - 更新主题 token、按钮状态、热力图、顶部搜索、输入框、笔记列表、设置下拉和整体字号密度。

### 4.2 修改测试

- `web/src/features/notes/NoteEditor.test.tsx`
  - 提交按钮查询从「提交」改为「发送笔记」。
  - 增加空内容时 disabled、有内容时 enabled 的断言。

- `web/src/features/notes/NotesPage.test.tsx`
  - 提交按钮查询同步改为「发送笔记」。
  - 保留搜索框存在和搜索逻辑测试。

- `web/src/features/heatmap/Heatmap.test.tsx`
  - 增加断言：热力图 grid 不再包含 `gridTemplateColumns` 的 `1fr` inline style。

---

## 5. 非目标

本次不做以下内容：

- 不改后端 API。
- 不改认证和同步逻辑。
- 不引入新 UI 组件库或 icon 依赖；纸飞机和 chevron 使用内联字符或轻量 SVG。
- 不重构整体布局架构。
- 不改变搜索触发逻辑为必须回车，因为当前即时搜索更轻量；搜索框移动后，用户按回车不会产生副作用。

---

## 6. 验收标准

- 左上角不再出现文字「设置」按钮；头像右侧有下拉 icon，并能打开原设置内容。
- 热力图格子在侧栏中保持正方形，不再横向拉扁。
- 全部笔记和标签选中态不再是黑色/近黑色，而是柔和绿色主题背景。
- 工作区顶部不再显示英文 `JIFO`。
- 「全部笔记」标题更小，视觉更轻。
- 搜索框位于标题右侧，宽度不占满整行。
- 新笔记输入框内部右下角显示纸飞机发送按钮；无内容时禁用变灰，有内容时高亮。
- 笔记卡片中时间与内容的上下距离减少，内容字体更小，列表整体更紧凑。
- `npm test -- --run` 通过。
- `npm run build` 通过。
