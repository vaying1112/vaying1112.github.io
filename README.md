# 一帆书签

一个可免费托管到 GitHub Pages 的中文技术博客。使用 Astro、Markdown/MDX 和 KaTeX；正文使用系统字体，公式字体和脚本随站点提供，不依赖远程字体或公式 CDN。

## 写作与发布指南

新增文章或修改博客，请先阅读[写作与发布指南](docs/authoring.md)：包含首次获取项目、新增文章、本地预览、修改已有内容、发布更新、GitHub 网页编辑和故障处理。本文保留组件、配置与部署的技术说明。

流程有变化时，在同一次提交中更新指南、相关模板和本文件；具体约定见[文档维护](docs/authoring.md#文档维护)。仓库的 [AGENTS.md](AGENTS.md) 也记录了这一要求，供后续代码助手遵循。

## 评论与 AI 答疑

支持选段引用、文末评论、公开历史与线程回复，使用本站用户名和密码注册、登录；“我的评论”汇总各篇文章下自己的留言及 AI 回复。Cloudflare Worker 和 D1 保存评论及待答任务，本机 Codex CLI 领取任务、调用云端模型后回写答案；电脑离线时评论仍可用，AI 回复等待本机恢复。评论数据不写入 GitHub。

配置 `PUBLIC_COMMENTS_API` 后，已发布文章自动显示评论区；未配置时隐藏。完整设置、本地预览、免费云端部署、额度与备份见[评论与本机 AI 答疑](docs/comments.md)。

答疑始终提供完整正文，按正文版本建立文章模板，每次从模板分出独立任务，以便复用模型缓存。项目依赖中固定了支持该流程的 Codex CLI。日志记录实际上下文大小和 CLI 返回的 token 用量，详见[上下文复用与用量](docs/comments.md#上下文复用与用量)。

账号入口为 `/account/`；登录保持 30 天，支持退出、修改密码和找回码重设。旧的匿名留言继续公开展示，不根据昵称自动认领。

管理员后台为 `/admin/`，管理员登录后也可从“我的评论”进入；支持按文章查看、删除讨论或回复、清空某篇评论及回收站恢复。管理员通过本机 `npm run comments:admin:setup` 预建，再用私密链接在网页设置密码；普通注册始终是读者账号。设置与权限见[管理员与评论管理](docs/comments.md#管理员与评论管理)。

评论测试会核对真实 CLI 发出的模型请求，确认问题、引用和讨论历史完整传入，而不仅检查缓存命中。

## 本地使用

需要 Node.js 22.22.0 或更新的受支持偶数主版本，建议 Node.js 24。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址，通常是 `http://127.0.0.1:4321/`。本地预览需要电脑和开发服务保持运行，可用 `npm exec astro -- dev stop` 停止服务；发布到 GitHub Pages 后不需要保持电脑运行。

## 修改站点资料

- `src/site.ts`：博客名称和简介。
- `src/pages/about.astro`：关于页面。
- `src/styles/global.css`：配色、字体和布局。
- `public/favicon.svg`：站点图标。

站名统一从 `src/site.ts` 读取。导航和浏览器标签共用 `public/favicon.svg` 中的帆形书签标识。

## 写文章

在 `src/content/posts/` 新建 `.md` 或 `.mdx` 文件。文件名决定地址，例如 `my-note.md` 对应 `/posts/my-note/`。

```yaml
---
title: 我的第一篇笔记
description: 用一句话介绍这篇文章。
date: 2026-10-19T12:00:00+08:00
tags: [数学, Transformer]
draft: true
---
```

正文在头部信息后面，使用 `##` 和 `###` 生成目录。模块序号自动生成并与左侧目录同步；宽屏固定左栏，窄屏通过左下方“目录”按钮从左侧展开。现有链接锚点不随编号改变。行内公式写成 `$e^{i\theta}$`；独立公式使用成对的 `$$`。代码围栏填写语言名，例如 `python`，即可高亮并显示复制按钮。

本地开发显示草稿，并给出草稿提示。默认生产构建会同时从文章路径、首页、搜索索引和 RSS 中排除草稿。检查文章后将 `draft: true` 改为 `draft: false` 即可发布。

需要完整草稿构建时，在 macOS/Linux 运行：

```sh
INCLUDE_DRAFTS=true npm run build
npm run preview
```

该构建含草稿，请仅用于预览。RSS 始终只包含已发布文章。

## 在文章里嵌入可视化

使用 `.mdx`，导入统一入口，在需要解释的位置放入组件：

```mdx
import Visualization from '../../components/Visualization.astro';

<Visualization id="rope-rotation" anchor="rotation-demo" />

<Visualization
  id="rope-rotation"
  options={{ m: 10, n: 14, omega: 0.2, maxPosition: 60 }}
/>

<Visualization
  id="rope-frequencies"
  options={{ m: 8, base: 10000, dimensions: 8, mode: 'multi' }}
/>
```

同一种可视化可以在一篇文章中重复使用，也可以被多篇文章引用。每个实例有独立的状态和元素 ID；“重置”恢复这个实例传入的初始参数。`anchor` 可选，填写时必须在当前文章内唯一。组件在正文列宽较小时自动堆叠，图和初始数值在关闭脚本时也可阅读。

在文章头部加上引用的实验 ID，用于实验室自动列出“引用文章”：

```yaml
visualizations: [rope-rotation, rope-frequencies]
```

普通文章可省略该字段。草稿遵循原有过滤规则，生产环境的实验室不会链接到草稿。错误的实验 ID 会在内容校验时报错。

| ID | 可选参数 | 默认值 |
| --- | --- | --- |
| `rope-rotation` | `m`, `n`, `omega`, `maxPosition` | 2, 5, 0.4, 30 |
| `rope-frequencies` | `m`, `base`, `dimensions`, `maxPosition`, `mode` | 8, 10000, 8, 80, `'multi'` |
| `rope-training` | `beta`, `target` | 0.4, -3 |
| `rope-partial` | `delta`, `content` | 3, 0.6 |
| `rope-mrope` | `key` | `[0, 1, 0]` |
| `rope-pairing` | 无 | 相邻布局 |

`m`、`n` 是非负整数，不能超过 `maxPosition`；`maxPosition` 为 1–10000 的整数。旋转图的 `omega` 范围为 0.05–1，多通道图的 `base` 范围为 2–10⁹，`dimensions` 为 2–16 的偶数，`mode` 可用 `'multi'` 或 `'same'`。这里的维度上限只控制教学图的数量，不限制模型的旋转维度。

## 公式、代码与可视化

文章按不同视角展开，每一节用公式说明机制、用 Python 实现核对数值，再以同参数交互图验证；参考资料之后放归纳 Q&A。可从 `templates/post.mdx` 开始，替换其中的示例代码和实验。

`CodeExample.astro` 接受 `code`、`title`、`output`，提供语法高亮、复制和运行结果展示。RoPE 的代码以 `src/examples/rope_torch.py` 为唯一来源；`src/examples/rope.ts` 按 `# region` 提取片段，文章和下载接口复用同一份代码。新增主题可以采用同样方式，也可以直接在 MDX 中写代码围栏。

运行教学代码与验证：

```sh
python -m pip install torch numpy
python src/examples/rope_torch.py
python src/examples/rope_numpy.py
```

PyTorch 脚本覆盖矩阵、复数、多频率、自动求导、部分旋转、M-RoPE、通道布局和 Q/K 投影的梯度传播。末尾验证共同平移、范数保持、非旋转维度保持、两种通道布局的对应关系，以及自动求导和数值梯度。Meta Llama 3 与 Transformers 的原始函数链接位于文章的“工程视角与开源实现”。

## 扩展文章与实验

- **新增文章**：复制 `templates/post.mdx` 到 `src/content/posts/文章名.mdx`，修改头部和正文。首页、标签、目录、搜索、RSS 都会自动生成；不需要改页面和导航。
- **复用实验**：从上表选择 ID，通过 `options` 配置；文章中无需复制图形或交互脚本。
- **新增实验**：在 `src/components/visualizations/` 创建 `<实验ID>.astro`，在 `src/visualizations/registry.ts` 登记标题、简介、主题和参数类型。实验室索引、`/lab/<实验ID>/` 独立页会自动生成，文章仍使用同一个 `Visualization` 入口。

新增实验组件约定：参数在 Astro frontmatter 中检查；初始 SVG/数值在服务端生成；交互使用独立的自定义元素，只查询自身内部的节点；监听器在元素移除时清理；需要 ID 的表单或 SVG 标记应为每个实例生成唯一 ID。样式写在组件中并复用站点颜色变量。Astro 的脚本打包与自定义元素用法见[官方文档](https://docs.astro.build/en/guides/client-side-scripts/#web-components-with-custom-elements)。

正文、基础知识、交互图和页面布局分别位于 `content/posts/`、`content/foundations/`、`components/visualizations/`、`layouts/`。修改某个实验会更新所有引用它的文章；修改文章内容不需要动实验实现。

## 检查和构建

```sh
npm run check
npm run test:comments
npm run build
npm run preview
```

正式部署前提供 `SITE_URL`，RSS 和 canonical 地址会据此生成；本地未提供时 RSS 使用 localhost 地址，页面不输出 canonical。

例如，测试仓库子路径部署：

```sh
SITE_URL=https://example.github.io BASE_PATH=/notes npm run build
```

上述域名仅为配置示例。不要把示例网址当作已经上线的网站。

## 复用数学基础

独立入口是 `/math/`，内容保存在 `src/content/foundations/math-basics.mdx`。向量、矩阵、三角函数、复数、频率尺度、链式法则、softmax 和矩阵指数各有稳定锚点。

其他文章可以直接引用 `/math/#complex`、`/math/#derivatives` 等链接。在支持仓库子路径的组件或 MDX 中，使用 `href('math/#complex')` 生成地址。现有小节的英文锚点应保留，以免旧引用失效。

## 发布到 GitHub Pages

当前仓库已配置 `main` 分支自动发布。日常更新可以在本地修改后提交并推送：

```sh
git add .
git commit -m "更新文章"
git push origin main
```

也可以在 GitHub 网页或 GitHub Desktop 中修改、提交。每次推送会自动检查和重新部署；在仓库的 Actions 页面查看结果。

以下是为其他账号重新部署的步骤：

1. 登录你自己的 GitHub 账户，创建一个空的**公开仓库**。使用 `用户名.github.io` 作为仓库名会发布在根网址；也可以用 `notes` 等名称，发布到仓库子路径。
2. 把本项目的源文件放在仓库根目录并推送到 `main`。保留 `.github/`、`package-lock.json` 和其他配置文件；不要上传 `node_modules/`、`dist/` 或 `.astro/`。可通过 GitHub Desktop 完成提交与上传。
3. 仓库进入 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
4. 进入 **Actions**，运行 `Deploy blog to GitHub Pages`，或者提交一次更新触发自动发布。
5. 工作流完成后，Pages 设置页和部署任务会显示真实网址。

工作流已配置 Node.js 24、依赖安装、类型检查、构建和发布，并读取 GitHub 返回的域名与仓库子路径。没有写入个人账号、访问令牌或预设域名。项目仓库为 [vaying1112/vaying1112.github.io](https://github.com/vaying1112/vaying1112.github.io)，个人主页地址为 [一帆书签](https://vaying1112.github.io/)。

在 GitHub Free 下，GitHub Pages 的这种用法需要公开源仓库。文章若有不希望公开的草稿，不要提交到公开仓库：`draft: true` 只阻止网站生成，不能隐藏 GitHub 中的源文件。

## 费用

静态博客不需要付费主题或自购服务器。GitHub Pages 可在其免费额度及使用规则内托管；评论服务使用 Cloudflare Workers 与 D1 的免费额度，AI 答疑消耗本机所登录模型账户的额度。默认网址无需购买域名。独立域名为可选项，按注册商价格续费。

## 参考文档

- [Astro 安装说明](https://docs.astro.build/en/install-and-setup/)
- [Astro 内容集合](https://docs.astro.build/en/guides/content-collections/)
- [Astro 部署到 GitHub Pages](https://docs.astro.build/en/guides/deploy/github/)
- [GitHub Pages 说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

## 当前内容

- 首页展示通用文章目录，支持标签筛选。
- `rope-complex.mdx`：RoPE 多视角推导、PyTorch 代码与七处内嵌交互图、12 个归纳问答、公开模型参数快照。
- `/math/`：可复用的数学基础模块。
- `/lab/`：可视化索引，自动列出引用文章；每个实验都有独立地址。
