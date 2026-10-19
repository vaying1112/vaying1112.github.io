# 评论与本机 AI 答疑

文章支持选段评论、文末评论、公开讨论历史和线程回复。所有人可查看公开评论；发表评论需注册并登录本站账号，使用用户名和密码。顶部“我的评论”（`/account/`）汇总自己的跨文章留言及 AI 回复，并可跳回完整讨论。AI 回复单独标明身份，并支持 Markdown 段落、列表、代码和 KaTeX 公式。

## 账号与评论身份

- 新账号和会话保存在 D1 的 `users`、`sessions` 表，评论通过 `comments.user_id` 绑定账号；服务端从登录状态确定身份，忽略客户端传入的昵称与用户 ID。账号数据、密码摘要和会话均不提交仓库。
- 用户名为 3–24 位文字、数字或下划线，NFKC 规范化并转小写，不能只改变大小写注册相同账号。密码为 12–128 位，不截断、不去除首尾空格。
- 密码使用随机盐的 scrypt（N=16384、r=8、p=5、32 字节输出，约 16 MiB 内存）；这是 [OWASP 列出的 scrypt 最低配置之一](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)。使用 [Workers 原生 node:crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)，不依赖浏览器散列作为密码验证器。
- 256 位随机会话有效期为登录起 30 天，数据库只存 SHA-256 摘要。浏览器本地存储会话令牌，以 Authorization 请求头发送，不写进 URL。GitHub Pages 与 Worker 跨站，不依赖第三方 Cookie；本地存储被禁用时不能保持登录。公共响应不包含用户 ID、密码摘要、找回码或会话。
- 退出撤销当前会话；修改密码需当前密码，并撤销所有设备的会话。注册时只显示一次 128 位随机找回码，数据库仅存摘要；用它重设密码后，旧找回码失效，显示新码，并撤销原有会话。本站不收集邮箱，不发送找回邮件。用户名、密码及找回码均遗失时，管理员无法验证账号归属，不能凭昵称认领账号。
- 注册、登录、找回和修改密码有独立限频：同 IP 每 15 分钟最多 20 次，用户名每 15 分钟最多 10 次验证/注册，同 IP 每小时最多注册 5 个账号；IP 经过带服务密钥的散列后存储。评论原有限频继续生效。
- `0002_accounts.sql` 是增量迁移。已有匿名评论及回复保留，其 user_id 为空；不会仅凭相同昵称自动归入新账号。个人历史仅返回本人账号的可见留言，公开讨论仍对所有人可见。
- 默认强制登录。仅旧版本过渡或隔离的兼容性测试可设置服务变量 `REQUIRE_LOGIN=false`；正式上线后应移除此覆盖。新增数据库或已有服务更新时都先应用全部迁移，再部署 Worker。
- 登录前的文章评论草稿、选段和回复对象暂存在当前标签页的 sessionStorage，登录后返回文章继续编辑；成功发表后清除。个人历史以 20 条分页；“查看讨论”通过 `/comments/thread` 加载目标讨论，即使已不在文章最新一页也可定位。

| 接口 | 用途 |
| --- | --- |
| POST `/auth/register`、`/auth/login` | 注册或登录，返回会话；注册还返回一次性显示的找回码。 |
| POST `/auth/logout` | 撤销当前会话。 |
| POST `/auth/password` | 校验 currentPassword 后更新 password 并撤销所有会话。 |
| POST `/auth/recover` | 校验 username、recoveryCode 后更新 password 并轮换找回码。 |
| GET `/me`、`/me/comments` | 当前账号资料、本人评论历史；都需 Bearer 会话。 |
| GET `/comments/thread?post=文章&id=评论ID` | 读取一条可见评论所在的完整公开讨论。 |

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
- 每次回答都提供完整文章正文，不按章节筛选、不用摘要替代，也不再截取前 50,000 字符。完整正文按内容哈希形成稳定的参考资料前缀；引用选段、当前问题和同一讨论串最近最多 12 条消息随后提供，当前问题不重复发送。
- 每个正文版本保存一份只含完整文章与初始化确认的本机 Codex 模板会话。每次提问从模板 fork 出独立的临时任务，复用其缓存键；不会带入其他讨论串，也不继承作者在桌面应用中的聊天记录。领取到新版正文后自动创建新模板。
- 模型计算仍在云端；本机仅运行领取、调用与回写程序，消耗本机所登录账户的额度。电脑关闭时评论仍可用，AI 任务留在云端等待本机恢复。
- 本地开发使用 Wrangler 的 D1 模拟数据库，位于 `services/comments/.wrangler/state/v3/d1/`。这些数据不会自动同步到正式数据库。

本地配置为 `services/comments/wrangler.local.jsonc`，正式配置为 `services/comments/wrangler.jsonc`。本地命令固定使用本地配置，正式数据库 ID 的修改不会切换本地测试数据。

## 2. 首次在本地运行

需要 Node.js 24 和已登录的 Codex 账户。先安装依赖；项目固定使用 Codex CLI 0.163.0，以支持非交互 fork，不修改全局 CLI。确认项目内 CLI 的版本及登录：

```sh
npm ci
npm exec -- codex --version
npm exec -- codex login status
```

在项目根目录执行：

```sh
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
| `.comments-local/article-sessions.json` | 自动生成的正文模板会话 ID 索引，不保存读者问题。 |

分别在两个终端启动博客和评论服务：

```sh
npm run dev
```

```sh
npm run comments:dev
```

打开终端显示的博客地址，先在 `/account/` 注册本地测试账号（与正式站账号不共用），保存找回码，再进入已发布文章。在页面发表一条勾选「请 AI 解答」的评论，然后在第三个终端执行一次任务：

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

把返回的数据库 ID 填入 [`services/comments/wrangler.jsonc`](../services/comments/wrangler.jsonc) 的 `database_id`，替换原值；使用自己的账号部署时不能沿用其他账号的数据库 ID。核对：

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
- 本机程序使用 `--ignore-user-config` 创建文章模板，并通过 `codex exec --ephemeral fork` 回答读者，禁用终端、浏览器、插件和 MCP 等工具；不向模型进程传递评论服务凭证。只读取现有 Codex 登录，不复制或上传登录文件。临时输入输出目录在任务结束后清理。
- 在 `.comments-local/responder.env` 可选填 `COMMENTS_MODEL` 指定账户可用模型，或 `COMMENTS_CODEX_BIN` 指向 Codex 可执行文件。未设置时使用 CLI 默认模型及项目安装的 Codex。自定义 CLI 需支持 `exec fork` 和 `--ephemeral`。

### 上下文复用与用量

[`services/comments/context.mjs`](../services/comments/context.mjs) 按内容哈希复用最多 16 个完整正文版本。完整文章作为固定参考资料放在 developer 消息中，JSON 字段明确只作资料。首次处理某个版本时，先运行一次不含读者问题的初始化，保存文章模板；之后每次都从该模板 fork，追加本次引用、问题和同一讨论串历史。临时 fork 不持久化，不续接其他访客的对话。

当前问题、选中原文和讨论历史通过标准输入传给 `codex exec fork <会话ID> -`。这里的 `-` 必须保留：fork 的普通位置参数不会自动附加管道输入，漏写会导致模型只收到泛化指令，反过来要求读者提供 JSON。使用方式见 [官方 CLI 参考](https://learn.chatgpt.com/docs/cli/reference)。

模型进程使用固定的空白工作目录 `.comments-local/model-workspace/`，避免随机目录改变前缀。模板 ID 映射在 `.comments-local/article-sessions.json`，模板本身由本机 Codex 会话存储管理（默认位于 `~/.codex/sessions/`）。正文、标题、答疑规则、工具设置、指定模型或调用路径变化时使用新模板；模板被删除时自动重新初始化。磁盘映射不按时间或文章数量自动淘汰；旧的 Codex 模板会话不会自动删除。

从同一模板 fork 可保留相同缓存键及完整正文前缀。OpenAI 对 GPT-5.6 及后续模型的 API 文档规定，最近一次写入或命中后至少保留 30 分钟，可能更久；这是最低窗口，不是固定的删除时间。当前 Codex CLI 不暴露延长 TTL 的设置或精确到期时间，不能保证保留一天或一周。本机模板不按时间过期。模型缓存仍有有效期和命中条件，失效后仍会提供完整正文重新计算；正文始终占用上下文窗口。当前使用 Codex 账户，不把 API 价格折扣直接当作账户额度优惠。机制参考 [OpenAI 提示缓存说明](https://developers.openai.com/api/docs/guides/prompt-caching)。

每个新正文版本的初始化额外调用一次模型，之后复用模板；这次调用也消耗账户额度。默认每日 20 次限额约束云端领取的答疑任务及其重试，不包含这个本机模板初始化调用。

每次完成回答，日志记录 `上下文与用量`：正文版本、完整正文字数、是否新建模板、初始化调用的 `preparationInputTokens` / `preparationCachedInputTokens` / `preparationOutputTokens`，以及当前回答的 `inputTokens` / `cachedInputTokens` / `outputTokens`。Codex 0.163 的 fork 事件包含模板累计用量，程序减去保存的初始化基线得到本轮用量，并用 `cliCumulativeUsage` 保留原始数字，避免重复统计。不记录问题正文、昵称或凭证；CLI 未返回字段时记为 `null`，命中数为 `0` 时如实记录。正文过长超出 CLI 或模型限制时会报错，不通过静默删减正文完成回答。

通过 Cloudflare 的 D1 控制台或 Wrangler 管理评论。以下为隐藏单条评论的 SQL，替换为实际评论 ID；隐藏主评论会同时让该讨论串不再公开显示：

```sql
UPDATE comments SET visible = 0 WHERE id = '实际评论ID';
```

恢复时将 `visible` 设回 `1`。无需删除原始记录。数据库备份可使用：

```sh
npx wrangler d1 export yifan-comments --remote --output=.comments-local/comments-backup.sql --config services/comments/wrangler.jsonc
```

备份包含账号密码摘要、会话摘要及评论数据，应当作为私密备份保存；保留在被忽略的本机目录，不提交仓库。Cloudflare 网页关闭不会停止服务；本机回答程序停止只影响后续 AI 回答。

## 5. 验证与排查

```sh
npm run test:comments
npm run check
npm run build
```

测试使用 SQLite 核对注册、登录、找回码轮换、密码修改、会话失效、账号归属、个人历史分页、直接讨论定位，以及数据库约束、评论隔离、分页、幂等、限频、任务租约、每日额度、失败重试和本机调用边界。另启动真实的项目内 CLI 和本机模拟模型接口，检查模型请求确实包含当前问题、选段与历史，并验证不同讨论隔离；使用独立的临时会话目录与虚拟凭证，不调用真实模型、不消耗账户额度。真实模型联调必须检查回答是否实际解释了问题与引用，不能只检查缓存数值或收到非空文本。

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
