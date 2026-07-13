# 助手同步操作说明

## 数据流程

1. `npm run sync:assistant` 只下载并校验资料，写入 `D:\缘的成长知识库\00-inbox\edgeone待整理`，不会确认删除。
2. Codex 读取批次清单和相关本地档案，生成 `05-projects\daily-conversations\YYYY-MM-DD.md`，并更新 `05-projects\mobile-assistant\手机助手记忆包.md`。
3. `npm run sync:assistant:publish -- <批次文件>` 上传记忆包和正式 Markdown 到 IMA；全部成功后才确认 EdgeOne 原始资料已处理。
4. 已处理原始资料保留 7 天后清理；未处理资料不会进入 7 天删除倒计时。

第一版只向 IMA 上传最终 Markdown。图片、PDF、Word 和其他附件保留在本地知识库，不自动上传二进制文件。

## 每日任务与账本摘要反馈

每天 00:10 运行 `npm run sync:feedback`。该命令默认收取北京时间前一日的任务清单、番茄钟结果和隐私化账本摘要，并覆盖写入：

`D:\缘的成长知识库\00-inbox\每日反馈\YYYY-MM-DD-任务与账本反馈.md`

该命令只需要 `EDGEONE_API_URL`、`EDGEONE_CODEX_TOKEN` 和 `YUAN_KB_ROOT`，不需要 IMA 密钥。只有正式 Markdown 完成本地写入后，脚本才确认云端记录已收取。断网、磁盘写入失败或 KV 不可用时不会确认，下一次运行会继续重试。

账本上传内容仅限每日总收入、总支出、分类合计和预算状态。单笔账目、备注、创建时间、常用模板和账本备份不会进入中转站。

## WorkBuddy 并行验证

连续 7 天让 WorkBuddy 只写入 `D:\缘的成长知识库\00-inbox\workbuddy-verification`。对比每日数量和哈希，连续 7 天无缺失、重复或乱码后再停用 WorkBuddy。

## 密钥

密钥只放在电脑本地秘密配置或 EdgeOne 服务端设置中。不要粘贴到聊天、提交到 Git，也不要写进知识库。
