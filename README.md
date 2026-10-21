# 旅游攻略 · AI Travel Planner

AI 旅行攻略生成器项目（发现 → 选点 → 排程 三步闭环）。

## 目录结构

```
.
├── ai-travel-planner/        # Next.js 15 + React 19 应用源码（主工程）
├── 旅游攻略-需求文档-v1.0.md      # 需求文档（初期）
├── 旅游攻略-需求文档-v2.0.md      # 需求文档（v2.0）
├── 旅游攻略-需求文档-v2.1-小红书数据源.md # 本次数据源整合需求
├── 小红书数据源-验收记录-2026-10-20.md # 验收结果与待验项
├── 需求变更记录.md              # 需求变更历史
├── 项目决策记录.md              # 技术与产品决策记录
└── push.sh                    # 一键提交并推送到 GitHub
```

> `MediaCrawler/`（第三方上游仓库）与 `项目迭代历史/`（本地旧快照）不入库，见 `.gitignore`。

小红书整合所需的 MediaCrawler 补丁已保存在应用的 `scripts/patches/` 中；固定版本、补丁安装和登录说明见 [应用 README](ai-travel-planner/README.md#安装-mediacrawler)。密钥、浏览器登录态、本地数据库和原始采集文件不会上传。

## 本地启动

```bash
cd ai-travel-planner
pnpm install
cp .env.example .env.local   # 按需填写 API key
pnpm db:push && pnpm db:seed # 初始化 SQLite 数据库
pnpm dev                     # http://localhost:3210
```

## 同步到 GitHub

```bash
./push.sh              # 自动生成提交信息并推送
./push.sh "改了什么"    # 使用自定义提交信息
```
