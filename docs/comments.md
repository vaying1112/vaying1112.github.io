# 评论与本机 AI 答疑

文章支持选段评论、文末评论、公开讨论历史和线程回复。访客无需登录，昵称在当前浏览器自动记住。AI 回复单独标明身份，并支持 Markdown 段落、列表、代码和 KaTeX 公式。

## 1. 数据与调用流程

```text
GitHub Pages 博客 → Cloudflare Worker → D1 保存评论与待答任务
                                           ↑ ↓
                                本机主动领取任务、回写回答
                                           ↓
                               本机 Codex CLI → 云端模型
```

- 评论、原文引用、回复关系、AI 回复和任务状态存入你的 Cloudflare D1，**不写入 GitHub 仓库**。
- 文章正文来自站点构建生成的 `/comments-context.json`，只包含已发布文章，即使开发环境也不包含草稿。
- 每次回答携带文章正文（最多 50,000 字符）、引用选段、当前问题和当前讨论串最近最多 12 条消息。每个任务重新组装上下文，不继承作者在桌面应用中的聊天记录。
- 模型计算仍在云端；本机仅运行领取、调用与回写程序，消耗本机所登录账户的额度。电脑关闭时评论仍可用，AI 任务留在云端等待本机恢复。
- 本地开发使用 Wrangler 的 D1 模拟数据库，位于 `services/comments/.wrangler/state/v3/d1/`。这些数据不会自动同步到正式数据库。

本地配置为 `services/comments/wrangler.local.jsonc`，正式配置为 `services/comments/wrangler.jsonc`。本地命令固定使用本地配置，正式数据库 ID 的修改不会切换本地测试数据。

## 2. 首次在本地运行

需要 Node.js 24、项目依赖和已登录的 Codex CLI。确认登录：

```sh
codex --version
codex login status
```

在项目根目录执行：

```sh
npm ci
npm run comments:setup
npm run comments:migrate:local
```

设置脚本生成本地专用随机凭证，并建立以下被 Git 忽略的文件，不覆盖已有配置、不输出凭证：

| 文件 | 用途 |
| --- | --- |
| `.env.local` | 前端的 `PUBLIC_COMMENTS_API`，本地为 `http://127.0.0.1:8787`。 |
| `services/comments/.dev.vars` | 本地评论服务的 `WORKER_TOKEN` 和文章索引地址。 |
| `.comments-local/responder.env` | 本机的 `COMMENTS_API`、`COMMENTS_WORKER_TOKEN`。后者须与服务的 `WORKER_TOKEN` 一致。 |
| `.comments-local/responder.local.env` | 专用于本地测试的处理程序配置，与正式连接分开。 |

分别在两个终端启动博客和评论服务：

```sh
npm run dev
```

```sh
npm run comments:dev
```

打开终端显示的博客地址，进入已发布文章。在页面发表一条勾选「请 AI 解答」的评论，然后在第三个终端执行一次任务：

```sh
npm run comments:respond:local -- --once
```

需要持续领取任务时运行：

```sh
npm run comments:respond:local
```

按 Ctrl+C 停止本机答疑程序；没有任务时每 30 秒检查一次。停止服务不会删除评论。正式运行时让本机程序保持运行；Mac 进入系统睡眠、断网或退出进程都会暂停答疑，恢复后可重新启动。

## 3. 部署云端评论服务

博客继续使用 GitHub Pages，Cloudflare 只承载评论服务、数据库和待答队列；这里不调用 Workers AI，不需购买模型接口。先注册或登录自己的 Cloudflare 账号，选择 Workers Free。免费额度以 [D1](https://developers.cloudflare.com/d1/platform/pricing/) 和 [Workers](https://developers.cloudflare.com/workers/platform/pricing/) 官方说明为准；代码不会替你升级付费套餐。

### 3.1 登录并创建数据库

```sh
npx wrangler login --device --use-keyring --scopes account:read user:read workers_scripts:write d1:write
npx wrangler d1 create yifan-comments
```

把返回的数据库 ID 填入 [`services/comments/wrangler.jsonc`](../services/comments/wrangler.jsonc) 的 `database_id`，替换全零占位值。核对：

- `ALLOWED_ORIGINS` 包含自己的博客来源（协议和域名，不含路径）。
- `ARTICLE_INDEX` 是自己博客的 `/comments-context.json` 完整地址；仓库子路径部署需包含子路径。
- `AI_DAILY_LIMIT` 默认每天最多领取 20 次模型任务，失败重试也计数；设为 `0` 可暂停 AI 任务，评论继续接收。

执行远程迁移：

```sh
npx wrangler d1 migrations apply yifan-comments --remote --config services/comments/wrangler.jsonc
```

### 3.2 设置服务凭证并部署

为正式环境生成一个新的至少 32 字符的随机凭证。使用 Wrangler 的交互输入设置，勿写入文章、仓库或前端：

```sh
npx wrangler secret put WORKER_TOKEN --config services/comments/wrangler.jsonc
npm run comments:deploy
```

保存实际返回的 HTTPS 服务地址。`wrangler.jsonc` 中不保存凭证；Cloudflare 登录由官方 CLI 管理。注册、验证邮箱及浏览器授权由账户持有人完成。

### 3.3 连接博客和本机

1. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 新建仓库变量 `PUBLIC_COMMENTS_API`，值为实际部署的 Worker HTTPS 地址，无尾部斜杠。这个地址公开，不能填写凭证。
2. 推送代码或重新运行 `Deploy blog to GitHub Pages`。工作流将该变量注入构建。未配置地址时，正式页面不显示评论区。
3. 将本机 `.comments-local/responder.env` 中的 `COMMENTS_API` 改为实际服务地址，`COMMENTS_WORKER_TOKEN` 改为步骤 3.2 设置的正式凭证。
4. 运行 `npm run comments:respond`，在正式文章发布问题，确认回复出现。

macOS 上确认正式连接后，可以安装登录后自动启动的后台程序：

```sh
npm run comments:service:install
```

后台日志在 `.comments-local/responder.log`，启动配置保存在本机用户的 `~/Library/LaunchAgents/`，不包含凭证。无需保持终端窗口打开；电脑睡眠或离线仍会暂停回答。移动项目目录、升级后删除旧 Node 路径时，重新运行安装命令。取消自动启动使用 `npm run comments:service:remove`。后台程序与手动运行共用进程锁，不要同时启动两个实例。

`.env.local` 可继续连接本地测试服务。正式服务的 `ARTICLE_INDEX` 必须等博客的 `/comments-context.json` 已上线后才能核对文章和组装回答；先发布博客代码，再进行正式评论验收。

## 4. 日常使用与维护

- 新文章在 `draft: false` 并发布后自动具备评论区，不需要在 MDX 中导入评论组件。
- 评论按文章文件名产生的 ID 隔离；已发布文章尽量保留原文件名。引用保存当时的文字快照及章节锚点，正文改写后引用文字仍保留，定位可回到原章节。
- `askAI` 可由访客取消。每条请求最多尝试 3 次，任务租约为 10 分钟，避免两台处理程序重复回答；成功结果按任务 ID 去重。
- 同一来源 IP 在 10 分钟内最多提交 8 条评论。服务只保存短期哈希计数，不将 IP、登录凭证放入公开评论接口。
- 本机将待回写的答案临时存入 `.comments-local/outbox.json`；网络恢复后先重试保存，避免重新调用模型。租约过期时旧结果不写入，任务由服务重新领取。
- 本机程序在临时目录调用 `codex exec --ignore-user-config --ephemeral`，禁用终端、浏览器、插件和 MCP 等工具；不向模型进程传递评论服务凭证。只读取现有 Codex 登录，不复制或上传登录文件。临时输入输出目录在任务结束后清理。
- 在 `.comments-local/responder.env` 可选填 `COMMENTS_MODEL` 指定账户可用模型，或 `COMMENTS_CODEX_BIN` 指向 Codex 可执行文件。未设置时使用 CLI 默认模型及 PATH 中的 Codex。

通过 Cloudflare 的 D1 控制台或 Wrangler 管理评论。以下为隐藏单条评论的 SQL，替换为实际评论 ID；隐藏主评论会同时让该讨论串不再公开显示：

```sql
UPDATE comments SET visible = 0 WHERE id = '实际评论ID';
```

恢复时将 `visible` 设回 `1`。无需删除原始记录。数据库备份可使用：

```sh
npx wrangler d1 export yifan-comments --remote --output=.comments-local/comments-backup.sql --config services/comments/wrangler.jsonc
```

备份包含评论数据，保留在被忽略的本机目录，不提交仓库。Cloudflare 网页关闭不会停止服务；本机回答程序停止只影响后续 AI 回答。

## 5. 验证与排查

```sh
npm run test:comments
npm run check
npm run build
```

测试使用 SQLite 核对数据库约束、评论隔离、分页、幂等、限频、任务租约、每日额度、失败重试和本机调用边界，不调用真实模型。真实模型联调使用本地页面提交的单个问题，才会消耗账户额度。

| 现象 | 检查 |
| --- | --- |
| 正式页面没有评论区 | 仓库变量 `PUBLIC_COMMENTS_API` 是否已设置，并已重新构建。 |
| 评论加载失败 | 服务地址、Worker 状态、D1 迁移和 `ALLOWED_ORIGINS`。 |
| 提示文章尚未开放评论 | 文章是否已发布，`ARTICLE_INDEX` 是否正确且已上线。 |
| 一直等待 AI 回复 | 本机程序、网络、Codex 登录及账户额度、`AI_DAILY_LIMIT`。 |
| 显示 AI 暂未完成回复 | 同一任务已失败三次；修正本机调用后可在 D1 中重置任务为 queued、attempts 为 0，并重置对应 comments.ai_status。 |
| 原文引用无法精确定位 | 对应章节或文字可能已改写，按引用快照查找。 |

官方支持 `codex exec` 复用本机登录执行自动任务，见[非交互模式说明](https://learn.chatgpt.com/docs/non-interactive-mode)。这不等于无限量调用或已确认所有公开代答场景均受订阅支持；长期运行前应核对账户资格及服务适用范围，模型接入可独立替换。

变更接口、任务规则、配置或命令时，同时更新本文、[写作与发布指南](authoring.md)和 README。
