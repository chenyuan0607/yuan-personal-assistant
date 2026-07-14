# 导航与助手工具实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重组个人助理网页导航，新增可扩展的其他页、六枝特区天气、本地头像、语音输入和空表情库入口。

**Architecture:** 保持现有无框架 ES modules 结构。导航与子视图由 `js/app.js` 管理，天气逻辑放入独立 `js/weather.js`，头像、语音和表情入口拆入独立助手工具模块并由 `assistant-ui.js` 组合；所有偏好只写浏览器本地存储。

**Tech Stack:** HTML、CSS、原生 JavaScript ES modules、Web Speech API、Geolocation API、Open-Meteo HTTPS API、Node.js test runner

---

### Task 1: 页面导航与其他入口页

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `styles.css`
- Modify: `tests/assistant-ui.test.mjs`

- [ ] **Step 1: 写失败测试**

读取 `index.html`，断言顶部 `.topbar` 和 `.assistant-transfer` 不存在，底部按钮文字顺序为今天、助手、账本、其他，`review-view` 变为其他入口页，并含成长回顾与 `https://synthapi.asia/wallet` 安全外链。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/assistant-ui.test.mjs`

Expected: FAIL，显示旧顶部、旧导航顺序或旧回顾结构仍存在。

- [ ] **Step 3: 实现导航和子视图**

删除顶部栏和临时中转资料；重排导航。把原回顾内容移到 `growth-review-view`，在 `other-view` 创建天气容器与入口网格；成长回顾按钮进入子视图，返回按钮回到其他页，充值入口使用 `target="_blank" rel="noreferrer"`。

- [ ] **Step 4: 运行定向测试**

Run: `node --test tests/assistant-ui.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add index.html js/app.js styles.css tests/assistant-ui.test.mjs
git commit -m "feat: reorganize navigation and other tools"
```

### Task 2: 六枝特区天气模块

**Files:**
- Create: `js/weather.js`
- Create: `tests/weather.test.mjs`
- Modify: `js/app.js`
- Modify: `service-worker.js`

- [ ] **Step 1: 写天气失败测试**

测试天气代码映射、Open-Meteo 查询地址、默认六枝特区配置、预报格式化和接口失败结果。定位测试传入假的地理坐标，不调用真实浏览器权限。

- [ ] **Step 2: 运行测试确认模块缺失**

Run: `node --test tests/weather.test.mjs`

Expected: FAIL，提示找不到 `js/weather.js`。

- [ ] **Step 3: 实现天气模块**

实现 `weatherLabel(code)`、`buildForecastUrl(location)`、`formatWeather(payload, location)` 和 `initWeather(...)`。默认地点为六枝特区及核实后的经纬度；请求当前温度、天气代码、每日最高最低和四天预报。刷新按钮重新请求，定位按钮仅在点击后调用 `navigator.geolocation`，失败显示非阻断提示。

- [ ] **Step 4: 缓存并验证**

把 `js/weather.js` 加入 service worker 外壳并升级缓存版本。

Run: `node --test tests/weather.test.mjs`

Run: `npm test`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add js/weather.js js/app.js service-worker.js tests/weather.test.mjs tests/pomodoro-ui.test.mjs
git commit -m "feat: add weather to other view"
```

### Task 3: 本地 AI 头像

**Files:**
- Create: `js/assistant-tools.js`
- Create: `tests/assistant-tools.test.mjs`
- Modify: `index.html`
- Modify: `js/assistant-ui.js`
- Modify: `styles.css`

- [ ] **Step 1: 写头像失败测试**

测试 `createAssistantPreferences` 可以保存和读取头像数据 URL、拒绝非图片及超过上限的值，并保持存储键稳定。

- [ ] **Step 2: 运行测试确认模块缺失**

Run: `node --test tests/assistant-tools.test.mjs`

Expected: FAIL，提示找不到助手工具模块。

- [ ] **Step 3: 实现头像偏好和界面**

添加可点击头像按钮、隐藏图片输入和默认文字头像。选择图片后用浏览器读取并缩放到最大 256×256 JPEG/WebP 数据 URL，再保存在当前浏览器；刷新时恢复。无效图片显示提示且不覆盖旧头像。

- [ ] **Step 4: 运行测试**

Run: `node --test tests/assistant-tools.test.mjs`

Expected: PASS。

### Task 4: 按住说话

**Files:**
- Modify: `js/assistant-tools.js`
- Modify: `tests/assistant-tools.test.mjs`
- Modify: `index.html`
- Modify: `js/assistant-ui.js`
- Modify: `styles.css`

- [ ] **Step 1: 写语音控制失败测试**

用假的 SpeechRecognition 构造器测试：按下调用 `start()`，松开调用 `stop()`，识别到中文后追加进输入框；构造器缺失时返回不支持状态。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/assistant-tools.test.mjs`

Expected: FAIL，提示语音控制函数不存在。

- [ ] **Step 3: 实现语音控制**

添加麦克风图标按钮和提示。优先使用 `SpeechRecognition` 或 `webkitSpeechRecognition`，语言设为 `zh-CN`，只在用户按下时开始，松开时结束，不自动提交表单；不支持时禁用网页语音并提示使用输入法麦克风。

- [ ] **Step 4: 运行测试**

Run: `node --test tests/assistant-tools.test.mjs`

Expected: PASS。

### Task 5: 空表情素材库入口

**Files:**
- Modify: `js/assistant-tools.js`
- Modify: `tests/assistant-tools.test.mjs`
- Modify: `index.html`
- Modify: `js/assistant-ui.js`
- Modify: `styles.css`
- Create: `assets/stickers/manifest.json`

- [ ] **Step 1: 写表情库失败测试**

测试空 manifest 格式为 `{ "version": 1, "stickers": [] }`，表情入口可切换打开状态，空库返回“还没有表情包素材”。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/assistant-tools.test.mjs`

Expected: FAIL，提示 manifest 或表情库行为不存在。

- [ ] **Step 3: 实现空素材库**

在输入区增加表情图标按钮和可关闭面板，从 `assets/stickers/manifest.json` 加载素材；空数组显示空状态。为未来用户发送和 AI 受控标识预留稳定的 `id`、`label`、`category`、`src` 数据结构，但本次不发送不存在的图片。

- [ ] **Step 4: 更新构建与缓存**

测试站构建器复制 `assets`，service worker 缓存 manifest。运行 `npm run build:cloudbase-site` 并确认产物包含空 manifest。

- [ ] **Step 5: 全量测试并提交**

Run: `npm test`

Expected: 0 failures。

```bash
git add assets/stickers/manifest.json js/assistant-tools.js tests/assistant-tools.test.mjs index.html js/assistant-ui.js styles.css scripts/build-cloudbase-site.mjs service-worker.js tests/cloudbase-site-build.test.mjs tests/pomodoro-ui.test.mjs
git commit -m "feat: add local assistant input tools"
```

### Task 6: 正式网站部署与浏览器验收

**Files:**
- Generated: `cloudbase-site-dist/**`
- Deploy target: 现有正式 EdgeOne 网站

- [ ] **Step 1: 构建并扫描**

Run: `npm run build:cloudbase-site`

扫描产物，确认不含 `.assistant-secrets`、`MODEL_API_KEY`、`SESSION_SECRET`、`OWNER_ACCESS_CODE_HASH`、访问码或令牌。

- [ ] **Step 2: 部署正式网站**

使用现有 EdgeOne Pages 项目的部署方式发布完整静态网页，保持页面的助手 API 指向当前 CloudBase 后台。发布前确认正式来源仍在 CloudBase `ALLOWED_ORIGINS` 中，不修改 EdgeOne KV 或切换数据中转站。

- [ ] **Step 3: 桌面浏览器验收**

确认默认今天、导航顺序、其他页天气、成长回顾进出、充值链接、头像选择入口、语音按钮降级和空表情面板；确认无控制台错误。

- [ ] **Step 4: 手机浏览器验收**

使用 390×844 视口确认天气、入口网格、助手头像和输入工具无横向溢出或遮挡。

- [ ] **Step 5: 最终验证**

Run: `npm test`

Expected: 0 failures，Git 工作树干净，正式网址返回 200，AI 对话仍能连接 CloudBase。
