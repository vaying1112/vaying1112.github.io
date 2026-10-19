# 写作与发布指南

本文说明如何为「一帆书签」新增文章、修改内容并发布到 GitHub Pages。流程是：编辑源文件 → 本地预览 → 检查 → 提交并推送 → 等待自动部署。

- 在线博客：<https://vaying1112.github.io/>
- 源码仓库：[vaying1112/vaying1112.github.io](https://github.com/vaying1112/vaying1112.github.io)
- 发布状态：[GitHub Actions](https://github.com/vaying1112/vaying1112.github.io/actions)
- 组件与配置说明：[README](../README.md)

阅读源码和在本地运行不需要仓库写权限。向原仓库推送需要写权限；其他人复用为自己的博客时，按 [README 中的部署说明](../README.md#发布到-github-pages)配置自己的仓库。

## 1. 获取项目与准备环境

需要 Git 和 Node.js，建议使用 Node.js 24，与 `.nvmrc` 和发布工作流一致。以下命令在 macOS/Linux 终端运行；每次操作都从项目根目录开始。

第一次获取项目：

```sh
git clone https://github.com/vaying1112/vaying1112.github.io.git
cd vaying1112.github.io
npm ci
```

已经有本地项目时，进入自己的项目目录，在开始新一轮编辑前同步更新：

```sh
git status
git pull --ff-only origin main
```

先保存并提交尚未完成的本地修改。如果拉取提示存在冲突或分支分叉，先处理提示，不要用强制覆盖的方式同步。在新电脑上或拉取后 `package-lock.json` 有变化时，重新运行 `npm ci` 安装依赖。

## 2. 新增文章

复制现有模板，以 `attention.mdx` 为例：

```sh
cp templates/post.mdx src/content/posts/attention.mdx
```

打开新文件，修改顶部信息：

```yaml
---
title: 从直觉理解注意力机制
description: 结合公式、PyTorch 代码和动态演示理解注意力。
date: 2026-10-19T12:00:00+08:00
tags: [Transformer, 注意力机制]
draft: true
---
```

日期填写实际写作日期。文件名决定文章地址：`attention.mdx` 对应 `/posts/attention/`。修改已发布文章时保留原文件名，可以保留原来的链接。

模板包含 RoPE 的组件导入、公式和实验示例。写其他主题时，替换这些内容；不使用的组件导入和 `visualizations` 字段也应删除。纯文本、公式和代码可以使用 `.md`，嵌入可视化或 Q&A 组件时使用 `.mdx`。

正文约定：

- 按不同视角解释问题，将公式、代码和可视化放在对应的论述位置；参考资料之后放归纳后的 Q&A。
- `##` 和 `###` 自动生成目录和章节编号，不需要手动写序号。
- 行内公式使用 `$e^{i\theta}$`；独立公式使用成对的 `$$`。
- 代码使用 Markdown 代码围栏，并标明 `python` 等语言，以启用高亮和复制。
- 前置数学知识统一放在 `/math/`，文章按需引用，不必重复整段基础说明。

首页、标签、搜索和 RSS 会自动读取文章，不需要手动添加导航。

### 复用可视化与 Q&A

模板已经包含组件导入，也可以参考以下最小示例：

```mdx
import Visualization from '../../components/Visualization.astro';
import Question from '../../components/Question.astro';
import { href } from '../../site';

参见<a href={href('math/#complex')}>复数基础</a>。

<Visualization id="rope-rotation" options={{ m: 2, n: 5, omega: 0.4 }} />

## 关键问答

<Question id="qa-example" number={1} question="在这里写归纳后的问题？">
在这里写答案。
</Question>
```

问题的 `id` 在文章内保持唯一，`number` 按顺序填写。问题应整理为独立、可理解的问答，不直接照搬完整聊天记录。

引用实验时，在文章顶部信息中登记 ID，以便实验室生成引用文章列表：

```yaml
visualizations: [rope-rotation]
```

已有实验的参数见 [README](../README.md#在文章里嵌入可视化)。新主题的可视化需要创建组件并登记到注册表，不能只填写一个尚未实现的实验 ID；扩展步骤见 [README](../README.md#扩展文章与实验)。

## 3. 在本地预览

在项目根目录运行：

```sh
npm run dev
```

打开终端打印的地址，通常是 <http://127.0.0.1:4321/>。保存文件后页面会自动更新；可以直接访问 `/posts/attention/` 检查新文章。

本地开发会显示 `draft: true` 的草稿。正式构建会从文章页面、首页、搜索和 RSS 中排除草稿。这个开关只控制网站生成：本仓库公开，提交到仓库的草稿源码仍然公开。

预览时检查公式、代码、目录、Q&A 和交互图，并拖动图中控件确认数值与解释一致。需要停止开发服务时运行：

```sh
npm exec astro -- dev stop
```

本地预览只在自己的电脑上运行。正式网站由 GitHub Pages 托管，发布后不需要电脑保持开机。

## 4. 修改已有内容

直接编辑相应源文件，再按下一节检查和发布。

| 修改内容 | 源文件 |
| --- | --- |
| 已有文章、公式和问答 | [`src/content/posts/`](../src/content/posts/) |
| 公共数学基础模块 | [`src/content/foundations/math-basics.mdx`](../src/content/foundations/math-basics.mdx) |
| 博客名称和简介 | [`src/site.ts`](../src/site.ts) |
| 关于页面 | [`src/pages/about.astro`](../src/pages/about.astro) |
| 配色、字体和通用样式 | [`src/styles/global.css`](../src/styles/global.css) |
| 阅读页布局与目录 | [`src/layouts/Reading.astro`](../src/layouts/Reading.astro) |
| 站点图标 | [`public/favicon.svg`](../public/favicon.svg) |
| 可视化实现 | [`src/components/visualizations/`](../src/components/visualizations/) |
| 实验元数据与参数类型 | [`src/visualizations/registry.ts`](../src/visualizations/registry.ts) |
| RoPE 的 PyTorch / NumPy 教学代码 | [`src/examples/`](../src/examples/) |

RoPE 的 PyTorch 示例以 `src/examples/rope_torch.py` 为来源，`src/examples/rope.ts` 提取代码片段，文章展示与下载复用同一份代码。修改这类示例时更新源脚本，并运行相应脚本核对结果。普通代码围栏直接在文章中修改即可。

修改公共实验会更新所有引用它的文章；修改数学基础时保留已有英文锚点，避免已有文章的引用失效。

## 5. 检查与发布

新文章准备发布时，将顶部信息改为：

```yaml
draft: false
```

依次运行：

```sh
npm run check
npm run build
```

两项检查都通过后，检查变更并提交：

```sh
git status
git diff
git add src/content/posts/attention.mdx
git commit -m "新增注意力机制文章"
git push origin main
```

上面的暂存路径只是示例：修改已有文章或多个文件时，将 `git add` 后面的路径替换为本次实际修改的文件，包括对应组件和文档。推送需要已经配置 GitHub 写入认证；不要将访问令牌写进项目文件。

推送到 `main` 后，工作流会自动安装依赖、检查、构建并部署。在 [Actions](https://github.com/vaying1112/vaying1112.github.io/actions) 中打开本次提交对应的 `Deploy blog to GitHub Pages`，确认 `build` 和 `deploy` 都成功，再打开正式网站查看。

保存文件只更新本地；推送到 `main` 并完成部署后才更新正式网站。失败时打开失败步骤查看日志，修正后重新提交推送。

本地检查构建可以不设置域名，发布工作流会自动注入正确的域名与仓库子路径。不要手动上传 `dist/`：GitHub Actions 会负责构建与发布。

## 6. 只改文字：通过 GitHub 网页编辑

1. 打开[文章目录](https://github.com/vaying1112/vaying1112.github.io/tree/main/src/content/posts)，选择要修改的文件。
2. 点击铅笔按钮编辑，完成修改后点击 **Commit changes**。
3. 有写权限且直接更新本站时，选择提交到 `main`；使用分支协作时，合并到 `main` 后才触发发布。
4. 到 Actions 页面确认部署成功。

新增文章也可以使用 **Add file → Create new file**，填写 `.mdx` 文件名，并复制模板内容。网页中的 Markdown 预览不会运行完整的 Astro 页面；涉及公式布局、组件和动态交互时，使用本地预览。

网页修改后，下次本地编辑前先运行 `git pull --ff-only origin main`，将网页提交同步到本地。

## 7. 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 保存后正式网站没有变化 | 确认已提交并推送到 `main`，再查看该提交的部署结果。 |
| 本地能看到文章，线上看不到 | 确认 `draft: false`，并确认最新部署成功。 |
| 新增可视化后检查失败 | 核对组件文件名、注册表 ID、参数类型及文章顶部的 `visualizations`。 |
| 本地拉取失败或出现分支分叉 | 查看 `git status`，处理未提交修改或分支冲突后再同步。 |
| 推送被拒绝 | 核对目标仓库和 GitHub 写权限；若远端已有新提交，先同步并解决冲突。 |
| 部署失败 | 查看 Actions 中失败的步骤；修正后重新提交推送。 |

## 文档维护

本指南是日常写作与发布流程的入口。以后流程发生变化时，在**同一次提交**中同步更新说明，避免代码已经变化而文档仍要求旧操作：

| 变更 | 同步更新 |
| --- | --- |
| Node.js 版本、依赖安装或 npm 命令 | 本指南、README 中的环境与命令说明；核对 `.nvmrc`、`package.json` 和部署工作流。 |
| 文章字段、文件位置、草稿或路由规则 | 本指南、`templates/post.mdx` 和 README 的写作说明。 |
| 可视化、Q&A 或代码组件的使用接口 | 本指南中的受影响示例、README 的组件说明和文章模板。 |
| 发布分支、托管平台或工作流 | 本指南与 README 的发布说明。 |

仅修改文章正文时，不必改写没有变化的流程。修改流程时，以实际实现为准，检查涉及的命令、文件路径和示例；文档中使用仓库相对路径，方便其他人克隆和复用。

仓库根目录的 [AGENTS.md](../AGENTS.md) 同时记录这些维护要求，供后续代码助手遵循。
