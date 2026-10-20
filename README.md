# 旅游攻略 · AI Travel Planner

AI 旅行攻略生成器项目（发现 → 选点 → 排程 三步闭环）。

## 目录结构

```
.
├── ai-travel-planner/        # Next.js 15 + React 19 应用源码（主工程）
├── 旅游攻略-初期需求文档-v0.4.md   # 需求文档（初期）
├── 旅游攻略-需求文档-v2.0.md      # 需求文档（v2.0）
├── 需求变更记录.md              # 需求变更历史
├── 项目决策记录.md              # 技术与产品决策记录
└── push.sh                    # 一键提交并推送到 GitHub
```

> `MediaCrawler/`（第三方上游仓库）与 `项目迭代历史/`（本地旧快照）不入库，见 `.gitignore`。

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
