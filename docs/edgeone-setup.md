# EdgeOne Makers 配置

1. 在 EdgeOne Makers 中导入本仓库，确认自动识别 `edge-functions/api`。
2. 开通 KV，创建命名空间并绑定到项目，变量名必须设为 `YUAN_ASSISTANT_KV`。
3. Blob 无需手工创建命名空间；首次调用 `getStore("yuan-assistant-files")` 后自动创建。
4. 配置服务端密钥：`OWNER_ACCESS_CODE_HASH`、`SESSION_SECRET`、`MODEL_ENDPOINT`、`MODEL_API_KEY`、`MODEL_NAME`、`SEARCH_ENDPOINT`、`SEARCH_API_KEY`。
5. 本地临时设置同一个 `SESSION_SECRET`，运行 `npm run token:codex`，把输出保存到电脑本地秘密配置，然后清除终端中的 `SESSION_SECRET`。
6. 部署后检查 `/api/auth` 返回 JSON，而不是 404。
7. 访问码、会话密钥、模型密钥和 IMA 密钥不得进入 GitHub、网页源码、截图或知识库。
8. 手机丢失时，更换 EdgeOne 中的 `SESSION_SECRET` 并重新生成 Codex Token，所有旧设备令牌会立即失效。

KV 是 EdgeOne 运行时绑定，不安装 npm 包。Blob 使用官方 `@edgeone/pages-blob` SDK。
