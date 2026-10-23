# AI 旅行攻略生成器

把「想去哪」直接变成**可以照着走的行程**。

不做文章。你选城市、挑点位,算法按区域聚类与通勤上限把日程算出来,AI 只负责把结果写成人话。
每个可玩点都告诉你**好处**与**不好的一面**,并标注信息来源。

---

## 快速开始

```bash
# 1. 安装依赖(注:better-sqlite3 需要编译,已配置好 pnpm 构建许可)
pnpm install

# 2. 配置环境变量
cp .env.example .env.local
#   LLM_MODE=mock  → 不调用真实模型；推荐搜索会提示切换 live
#   LLM_MODE=live  → 真实调用 DeepSeek
#   DEEPSEEK_API_KEY 可留空,本机开发会自动从 ~/.dsh/.credentials.yaml 读取

# 3. 建表
pnpm db:push

# 4. 导入种子数据(仓库已带 data/seed/*.json,可直接跳过第 5 步)
pnpm db:seed

# 5. (可选)重新用 AI 生成种子数据 —— 仅在 LLM_MODE=live 时可用
pnpm gen:seed            # 全部城市
pnpm gen:seed sydney     # 指定城市

# 6. 启动
pnpm dev                # http://localhost:3210
```

### DeepSeek 搜索推荐数据源

用户选择目的地并填写天数、人数、出发地、预算、同行人及节奏后，`/api/cards` 默认使用 DeepSeek Search 获取公开网页材料，再由现有 `deepseek-v4-flash` 整理为景点、住宿（含酒店 / 民宿）、餐饮三类卡片。需要 `LLM_MODE=live` 和可用 DeepSeek 凭证；不需要 MediaCrawler 或小红书登录。搜索失败不会静默回退到小红书或种子数据。

- 服务器复用 `DEEPSEEK_API_KEY`，调用 `/v1/tools/search`；必要时调用 `/v1/tools/fetch` 获取正文。模型地址 `DEEPSEEK_BASE_URL` 与工具地址 `DEEPSEEK_SEARCH_BASE_URL` 独立配置，后者默认 `https://api.deepseek.com`。
- 三类分别执行发现、体验利弊检索，共 6 条基础查询；每类少于 3 个候选或全部没有有据可查的不足时，最多补搜 3 次；请求耗时达到 165 秒时跳过补搜并提示。每次默认返回 8 个搜索结果，初始检索与补搜各最多整理 24 个新来源，请求总计最多 48 个；每 6 个来源一个模型批次、最多 8 批，每阶段最多 2 批并发。整个请求默认最多 Fetch 3 个页面，补搜不重置预算。配置范围见 `.env.example`。
- 来源明确区分“网页正文”和“搜索摘要”，展示标题、链接、获取时间与必要摘录；逐条校验引文，缺少证据的优缺点或数字不补造。结果页显示三类覆盖数量及不足提示，不能保证覆盖所有地点、点评或实时房价。
- 搜索请求成功但无合格候选时展示空结果说明、缺类提示和重试入口；搜索全部失败、鉴权 / 余额错误或模型整理全部批次失败时明确报错，部分批次失败保留可用结果并提示。
- 新地点先展示，坐标人工核实后才能加入行程。`pnpm search:verify <web_id> <纬度> <经度> <区域> <核实来源>` 用于核实；重新生成保留核实结果。详情里的来源链接用于核对材料，不代表官方核实。
- `pnpm test:search` 运行离线搜索、证据、保存及核实回归；`pnpm search:smoke` 实际调用 Search 与模型，默认在临时数据库完成联调，将摘要写入 `data/search-acceptance-*.json`。真实调用可能产生费用，完整验收结果另见本次验收记录。
- 截至 2026-10-22，[官方标价](https://api-docs.deepseek.com/guides/search/)为 Search / Fetch 各 $0.75 / 千次有结果的成功请求，模型 token 另计。默认查询与正文请求上限在无重试时约 $0.009 / 轮工具费用；这不是含模型的总成本，不预设任何特定工具通道免费优惠适用。

### 小红书数据源（保留能力）

原有小红书检索、采集与整理实现保留供后续功能调用；默认 `/api/cards` 已按 v2.2 改为上面的网页搜索链路，不会自动触发小红书采集。单独使用此能力时，需要 `LLM_MODE=live`、可用的 DeepSeek 凭证、MediaCrawler 的 Python 环境，以及 **MediaCrawler 专用 Chrome 配置目录** `../MediaCrawler/browser_data/cdp_xhs_user_data_dir` 中的小红书登录态；日常 Chrome 登录不会自动共享到该目录。采集在服务端运行，建议本机开发使用；无浏览器的部署环境需要另行提供采集服务。

- 默认读取 `../MediaCrawler` 和 `../MediaCrawler/.venv/bin/python`；路径不同可在 `.env.local` 配置 `MEDIA_CRAWLER_DIR`、`MEDIA_CRAWLER_PYTHON`。
- 每次请求使用独立临时目录；当前单进程一次只运行一个采集任务。适配层优先连接已打开的专用 Chrome，搜索时每类关键词最多整理 2 篇笔记、每篇最多 2 条评论；采集超时、登录失效、平台临时限流、无结果和整理失败都会在页面显示原因并允许重试。连续测试时应留出间隔，避免频繁触发平台限制。
- 卡片只保留必要的笔记标题、材料摘录、来源链接和引用关系。小红书用户内容标记为「小红书」，并非官方信息；缺少证据的优缺点不补写。
- 新地点默认显示「坐标待核实」，暂不能加入行程。人工查证坐标后运行 `pnpm xhs:verify <xhs_id> <纬度> <经度> <区域> <核实来源>`，即可把该地点写入排程点位表；重新采集不会清除核实结果。
- `pnpm test:xhs` 测试 JSONL 读取、来源校验、保存与核实流程；`node --import tsx scripts/check-xhs-login.ts` 检查专用 Chrome 登录态；`node --import tsx scripts/smoke-xhs-live.ts` 测试真实模型和已有 JSONL 格式；`node --import tsx scripts/smoke-xhs-crawl.ts` 仅采集一篇笔记用于本机登录验收；`node --import tsx scripts/smoke-xhs-pipeline.ts` 会实际采集并写入应用数据库，避免反复执行。

MediaCrawler 自带非商业学习许可。实际使用前请确认其许可及小红书内容使用规则，并控制采集频率。

#### 安装 MediaCrawler

从本仓库根目录执行以下命令（需要 Git、uv 和 Chrome）。MediaCrawler 保持独立上游仓库，固定到本次验收使用的版本；补丁只调整小红书搜索数量限制和末页处理，沿用上游许可。

```bash
git clone https://github.com/NanmiCoder/MediaCrawler.git MediaCrawler
cd MediaCrawler
git checkout 8f583999006d5b692272c608440e193ca282e73b
git apply ../ai-travel-planner/scripts/patches/mediacrawler-xhs-note-limit.patch
uv sync
uv run playwright install chromium
cd ../ai-travel-planner
```

已经安装并应用过补丁时，无需重复执行。不要把已有登录目录替换成新克隆。保持 `config/base_config.py` 中 `ENABLE_CDP_MODE = True`、`CDP_HEADLESS = False`，建议将 `CRAWLER_MAX_SLEEP_SEC` 设为 `5`；适配层会自动选择启动或连接专用 Chrome，无需修改上游的 `CDP_CONNECT_EXISTING`。

单独触发小红书采集时，MediaCrawler 会打开专用 Chrome；按提示登录小红书。登录检查脚本已随本项目提交，不依赖上游目录中的额外 `check_login.py`。换电脑后需要重新配置 `.env.local`、初始化数据库并登录，旧电脑的登录态和采集数据不会随 GitHub 同步。

### 内置账号

登录只需邮箱,不需要密码(P0 简化实现)。本地已预置两个账号:

| 邮箱 | 角色 | 用途 |
|---|---|---|
| `demo@local.dev` | 普通用户 | 生成行程、提交短评 |
| `admin@local.dev` | 管理员 | 可访问 `/admin` 审核后台 |

普通用户访问 `/admin` 会得到 **404**(而不是 403)—— 不暴露后台存在。

---

## 验证命令

```bash
pnpm test:search      # DeepSeek 搜索链路离线回归（不产生 API 费用）
pnpm test:xhs         # 小红书保留能力离线回归
pnpm test:scheduler   # 排程引擎自检(纯算法,不调用 AI)
pnpm exec tsc --noEmit   # 类型检查
```

`pnpm test:scheduler` 会验证 6 组场景的 6 项硬约束:

1. 统计自洽 `placed + unplaced === total`
2. 每日点位数不超过当前节奏上限
3. 单日通勤不超过 90 分钟
4. 不存在空白时段
5. 同一天点位落在同一区域(地理聚类)
6. 到达日 / 离开日按半天折算

---

## 产品闭环

```
发现页标签墙(国内/国外 + 热门 Top5)
   ↓ 点城市
行程参数(天数/人数/出发地/预算/同行人/节奏)
   ↓ DeepSeek Search 三类发现与利弊检索 → 证据整理 → 覆盖补搜
可玩点卡片(图片 + 简介 + 好处 + 不好的一面 + 来源标记 + 多选)
   ↓ 生成攻略
排程引擎(区域聚类 + 硬约束求解)→ 结构化日程 JSON
   ↓ LLM 只配文案
攻略页(按天 · 上午/下午/晚上 时段块)
   ↓
发布到广场 / 一键复刻 / 导出长图
   ↓
用户短评 → 机审 + AI 意向判定 → 人工审核 → 交叉验证 → 升级为「评论」入 AI 语料
```

---

## 架构要点

### 先算后写(最重要的一条)

排程**完全由算法决定**,LLM 只在之后给既定行程配文案,不参与任何排程决策。

> 让模型直接"写"行程,第一天排到第 5 个点就会开始崩:时长不守恒、地理乱跳、开门时间冲突。

- 排程引擎:`src/lib/scheduler/engine.ts`(`planTrip`)
- 地理工具:`src/lib/scheduler/geo.ts`(haversine / 最近邻 / 2-opt / 区域聚类)

### 展示层与语料层分离

| 层 | 内容 | 谁看 |
|---|---|---|
| 展示层 | 用户**原文**短评(不做改写) | 所有用户 |
| 语料层 | AI 生成的**客观化改写** | 仅 AI 生成链路 |

例:「晚上十一点去的还在排队,站着吃完的,味道还行但没地方坐」
→ 语料层:**「晚间23点仍需排队且无座位」**

这样既保住用户原话的真实感,又不会让 AI 学到用户的口吻与绝对化表达。

### 来源标记与网页证据

每条优缺点必须携带来源标记，不允许出现无标记条目。默认搜索推荐使用“网页正文”或“搜索摘要”，通过 URL、标题、摘录和获取时间溯源；小红书保留能力使用“小红书”。既有种子、人工维护及站内 UGC 继续使用以下体系：

| 标记 | 含义 |
|---|---|
| `官方` | 来自官方信息字段 |
| `评论` | 真实评论归纳,含被交叉验证的 UGC |
| `用户反馈` | 本站用户原文,尚未交叉验证 |
| `AI 综合` | 模型常识推断,未经核实 |

**信任链规则**:AI 种子数据(`provider = 'ai_seed'`)不得被标为 `官方` —— 未经核对的二手数据不能对外呈现为官方信息。这条规则会在 prompt 里显式传达给模型。

### UGC 语料升级门禁

```
用户提交原文 → 机审(联系方式/外链/地址,命中即拒)
   ↓
AI 预审打标(意向判定 / 广告嫌疑 / 重复检测 / 处理建议)
   ↓
人工审核 → 标为「用户反馈」对外展示
   ↓ ≥3 位不同账号确认 且 确认率 ≥70% 且 反向票 <2 且 12 个月内
AI 生成客观化草稿 → 管理员确认 → 升级为「评论」入 AI 语料
```

去重以**账号**为主键(指纹为辅),防止同设备换账号刷票。

---

## 目录结构

```
src/
├── app/
│   ├── page.tsx                    发现页(标签墙 + 热度榜)
│   ├── city/[cityId]/page.tsx      行程参数 + 可玩点卡片
│   ├── trip/[tripId]/page.tsx      攻略页(本人或已公开)
│   ├── s/[slug]/page.tsx           公开只读分享页(未登录可访问)
│   ├── plaza/page.tsx              内容广场
│   ├── my/page.tsx                 我的攻略
│   ├── login/page.tsx              登录
│   ├── admin/page.tsx              审核后台(非 admin → 404)
│   └── api/
│       ├── cards/route.ts          生成可玩点卡片
│       ├── plan/route.ts           排程 + 文案 + 落库
│       ├── trips/[id]/route.ts     发布 / 点赞 / 复刻 / 重命名 / 删除
│       ├── ugc/route.ts            短评提交 / 投票 / 举报
│       ├── admin/route.ts          审核动作
│       └── auth/                   登录 / 登出
├── components/                     卡片、标签墙、行程视图、后台面板
├── db/
│   ├── schema.ts                   18 张表(Drizzle)
│   ├── seed.ts                     种子数据导入
│   └── city-catalog.ts             城市目录(含经纬度 bbox 校验范围)
└── lib/
    ├── scheduler/engine.ts         ★ 排程引擎
    ├── llm/prompts.ts              ★ Prompt 工程
    ├── llm/service.ts              mock/live 分发 + 缓存 + 重试
    ├── llm/mock.ts                 离线可用的一套完整假数据
    ├── ids.ts                      仅服务端(含 node:crypto)
    ├── utils.ts                    仅纯函数(会被客户端引用)
    └── types.ts                    领域类型与常量
```

---

## 依赖模型的三个硬约束

1. **思考 token 计入 `max_tokens`**。实测思考占输出 **79%**。预算给不够会返回空 `content` 而非报错。
2. **单批生成 ≤ 10 个点位**。整批发 16 个会被思考吃光预算,导致整批降级。
3. **单轮对话**。本项目每个任务都是 `system + user → assistant`,不发送 assistant 历史消息,因此天然规避了该模型 `requiresReasoningContentOnAssistantMessages` 的坑。若将来要做多轮,回传时必须带上 `reasoning_content`。

成本参考(基于真实单价,含思考 token):一次完整生成约 **¥0.02–0.05**。

---

## 当前状态

- ✅ P0 闭环完整可用,排程引擎自检 6/6 通过
- ✅ 首版城市:悉尼(19 点位)/ 墨尔本(20)/ 成都(20)
- ✅ UGC 全链路(机审 → AI 预审 → 人工审核 → 升级语料)已跑通
- ⬜ 地图可视化路线(P1)
- ⬜ 多城市联游(P1,引擎已支持,UI 未放开)
- ⬜ 第三方 POI / 图库 API 接入(P1,当前图片为占位)

当前默认推荐需求见上级目录 `旅游攻略-需求文档-v2.2-DeepSeek搜索数据源.md`，与 v2.0 组成当前基线；本次实现与验收结果见 [验收记录](../DeepSeek搜索数据源-验收记录-2026-10-22.md)。决策与变更见 `项目决策记录.md`、`需求变更记录.md`。v2.1 及 `小红书数据源-验收记录-2026-10-20.md` 保留为小红书能力历史记录，不能代表新搜索链路已通过验收。
