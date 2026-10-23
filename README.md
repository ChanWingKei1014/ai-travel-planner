# 旅游攻略 · AI Travel Planner

AI 旅行攻略生成器项目（发现 → 选点 → 排程 三步闭环）。

## 目录结构

```
.
├── ai-travel-planner/        # Next.js 15 + React 19 应用源码（主工程）
├── 旅游攻略-需求文档-v1.0.md      # 需求文档（初期）
├── 旅游攻略-需求文档-v2.0.md      # 需求文档（v2.0）
├── 旅游攻略-需求文档-v2.2-DeepSeek搜索数据源.md # 当前推荐数据源专项
├── 旅游攻略-需求文档-v2.1-小红书数据源.md # 小红书保留能力与历史需求
├── 小红书数据源-验收记录-2026-10-20.md # 验收结果与待验项
├── 需求变更记录.md              # 需求变更历史
├── 项目决策记录.md              # 技术与产品决策记录
└── push.sh                    # 一键提交并推送到 GitHub
```

> `MediaCrawler/`（第三方上游仓库）与 `项目迭代历史/`（本地旧快照）不入库，见 `.gitignore`。

小红书整合所需的 MediaCrawler 补丁已保存在应用的 `scripts/patches/` 中；固定版本、补丁安装和登录说明见 [应用 README](ai-travel-planner/README.md#安装-mediacrawler)。密钥、浏览器登录态、本地数据库和原始采集文件不会上传。

当前需求基线为 [v2.0](旅游攻略-需求文档-v2.0.md) + [v2.2 DeepSeek 搜索数据源](旅游攻略-需求文档-v2.2-DeepSeek搜索数据源.md)。目的地推荐默认使用 DeepSeek Search 获取景点、住宿（酒店 / 民宿）与餐饮材料，再整理有出处的利弊；按类别检索、有限补缺并提示实际覆盖，不保证地点穷举。小红书采集能力保留供后续使用，默认推荐不需要其登录态，也不作静默失败回退。

## 本地启动

```bash
cd ai-travel-planner
pnpm install
cp .env.example .env.local   # 按需填写 API key
pnpm db:push && pnpm db:seed # 初始化 SQLite 数据库
pnpm dev                     # http://localhost:3210
```

实际搜索推荐需要 `.env.local` 中的 `LLM_MODE=live` 和可用 `DEEPSEEK_API_KEY`；更多配置、费用和 `test:search` / `search:smoke` / `search:verify` 命令见 [应用 README](ai-travel-planner/README.md#deepseek-搜索推荐数据源)。本次实现与验收已完成，结果和边界见[验收记录](DeepSeek搜索数据源-验收记录-2026-10-22.md)。

## 同步到 GitHub

```bash
./push.sh              # 自动生成提交信息并推送
./push.sh "改了什么"    # 使用自定义提交信息
```
