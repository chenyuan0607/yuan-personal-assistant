# CloudBase 独立测试网页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 部署一个连接 CloudBase AI 后台的完整个人助理测试网页，并保持正式 EdgeOne 网页不变。

**Architecture:** 新增一个纯构建脚本，把现有静态网页复制到独立目录，并只在测试产物的 `<html>` 上注入 CloudBase API 地址。该目录部署到 CloudBase 静态托管；取得测试域名后，将该精确来源合并进云函数跨域白名单，最后用真实浏览器完成登录、对话、刷新和响应式验收。

**Tech Stack:** Node.js 20、原生 ES modules、Node test runner、CloudBase CLI 3.6.1、CloudBase 静态托管、浏览器自动化

---

### Task 1: 测试站构建器

**Files:**
- Create: `scripts/build-cloudbase-site.mjs`
- Create: `tests/cloudbase-site-build.test.mjs`
- Modify: `package.json`
- Generated: `cloudbase-site-dist/`

- [ ] **Step 1: 写入失败测试**

测试在临时目录准备最小网页外壳，调用 `buildCloudBaseSite` 后断言：入口包含唯一的 `data-assistant-api`，静态脚本被复制，秘密目录和开发文件不进入产物。

- [ ] **Step 2: 运行测试并确认因模块缺失而失败**

Run: `node --test tests/cloudbase-site-build.test.mjs`

Expected: FAIL，提示找不到 `scripts/build-cloudbase-site.mjs`。

- [ ] **Step 3: 实现最小构建器**

导出 `buildCloudBaseSite({ sourceDir, outputDir, apiUrl })`，复制白名单中的网页文件和目录，并把：

```html
<html lang="zh-CN">
```

替换为：

```html
<html lang="zh-CN" data-assistant-api="https://yuan-assistant-test-d2bd198841e7.service.tcloudbase.com">
```

构建器拒绝非 HTTPS API 地址，输出目录固定为 `cloudbase-site-dist` 时先清理旧产物。`package.json` 新增 `build:cloudbase-site` 命令。

- [ ] **Step 4: 运行定向测试和全量测试**

Run: `node --test tests/cloudbase-site-build.test.mjs`

Expected: PASS。

Run: `npm test`

Expected: 现有 60 项与新增测试全部通过。

- [ ] **Step 5: 提交构建器**

```bash
git add scripts/build-cloudbase-site.mjs tests/cloudbase-site-build.test.mjs package.json
git commit -m "feat: build isolated CloudBase test site"
```

### Task 2: 构建并检查测试产物

**Files:**
- Generated: `cloudbase-site-dist/**`
- Modify: `.gitignore`

- [ ] **Step 1: 忽略生成目录**

在 `.gitignore` 增加 `cloudbase-site-dist/`，防止部署产物进入 Git。

- [ ] **Step 2: 生成测试站**

Run: `npm run build:cloudbase-site`

Expected: 输出 `cloudbase-site-dist/index.html` 和完整静态资源。

- [ ] **Step 3: 扫描敏感内容**

检查产物不包含 `.assistant-secrets`、`MODEL_API_KEY`、`SESSION_SECRET`、`OWNER_ACCESS_CODE_HASH`、访问码和令牌；仅允许出现公开 CloudBase API 地址。

- [ ] **Step 4: 提交忽略规则**

```bash
git add .gitignore
git commit -m "chore: ignore CloudBase site build output"
```

### Task 3: 部署独立静态测试站

**Files:**
- Read: `cloudbase-site-dist/**`
- Cloud resource: `yuan-assistant-test-d2bd198841e7` 静态托管

- [ ] **Step 1: 确认静态托管状态和部署命令**

使用 CloudBase CLI 3.6.1 读取目标环境的静态托管状态，不创建付费资源，也不修改 EdgeOne 项目。

- [ ] **Step 2: 部署测试产物**

将 `cloudbase-site-dist` 部署到 CloudBase 静态托管根目录；若免费环境要求首次开通，只在确认页面显示免费且无自动按量计费时开通。

- [ ] **Step 3: 获取独立 HTTPS 测试网址**

记录 CloudBase 分配的默认域名，并用 HTTP 请求确认 `index.html` 返回 200，且入口包含 CloudBase API 地址。

### Task 4: 限定测试站跨域来源

**Files:**
- Modify: `cloudbaserc.json`
- Temporary ignored file: `.assistant-secrets/cloudbase-update/cloudbaserc.json`

- [ ] **Step 1: 先写配置断言并验证失败**

在 `tests/cloudbase-site-build.test.mjs` 增加断言：`cloudbaserc.json` 的 `ALLOWED_ORIGINS` 包含实际测试站来源；运行后应因尚未加入域名而 FAIL。

- [ ] **Step 2: 将精确测试来源加入公开配置**

只把测试站的 `https://` 来源追加到 `ALLOWED_ORIGINS`，不使用 `*`。

- [ ] **Step 3: 合并更新云函数环境变量**

拉取云端函数配置到 `.assistant-secrets`，合并公开来源并保留 `MODEL_API_KEY`、`SESSION_SECRET`、`OWNER_ACCESS_CODE_HASH`，选择“合并更新”。更新完成后删除临时配置文件。

- [ ] **Step 4: 验证跨域预检**

从测试站来源向 `/api/auth` 发起 OPTIONS 请求，确认状态成功且 `access-control-allow-origin` 精确等于测试站来源。

- [ ] **Step 5: 运行测试并提交公开配置**

Run: `npm test`

Expected: 全部通过。

```bash
git add cloudbaserc.json tests/cloudbase-site-build.test.mjs
git commit -m "config: allow CloudBase test site origin"
```

### Task 5: 浏览器端到端验收

**Files:**
- Read-only browser validation of the deployed test site

- [ ] **Step 1: 桌面尺寸打开测试站**

确认页面标题、底部导航、任务、专注、账本、复盘和助手入口均可见且无重叠。

- [ ] **Step 2: 登录并发送真实消息**

从本地私密配置读取访问码，通过页面登录；输入“请只回复：网页AI对话测试成功”，确认页面显示该 AI 回复。访问码和令牌不输出到日志或聊天。

- [ ] **Step 3: 刷新并验证历史记录**

刷新测试网址，重新进入助手页，确认刚才的用户消息和 AI 回复仍然存在。

- [ ] **Step 4: 手机尺寸验收**

以手机视口检查助手消息区、输入框、发送按钮、登录弹窗和底部导航，无横向溢出或内容遮挡。

- [ ] **Step 5: 最终验证**

Run: `npm test`

Expected: 0 failures。

Run: `git status --short`

Expected: 工作树干净；生成目录和秘密文件未被跟踪。

