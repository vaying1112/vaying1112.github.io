# Repository instructions

## 写作与发布文档同步

- 日常写作和发布流程以 `docs/authoring.md` 为入口，README 保留入口链接和组件、配置参考。
- 修改 Node.js 版本、npm 命令、文章字段或路径、草稿规则、路由、组件接口、发布分支或部署工作流时，必须在同一次提交中更新受影响的 `docs/authoring.md`、README 和 `templates/post.mdx`。
- 仅修改文章内容时，不必改动未受影响的流程说明。
- 文档中的命令、路径和示例必须与实际实现一致；使用仓库相对路径，不写入个人电脑的绝对路径或认证信息。
- 文档变更检查相对链接、锚点和命令即可；实现变更运行相应检查，并在发布前通过 `npm run check` 和 `npm run build`。
