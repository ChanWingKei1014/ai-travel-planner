/**
 * 数据库 Schema(SQLite + Drizzle)
 * 对应需求文档 v0.4 第 7 章「核心数据结构」
 *
 * 分层说明:
 *   L1 人工校准库   → cities / pois / poiProsCons
 *   L2 客观事实     → poiFacts(第三方 API 数据,绝不由 LLM 生成)
 *   L3 主观评价     → poiProsCons(语料层,text 字段)
 *   L4 热度数据     → hotRankings
 *   L6 用户内容     → trips / ugcContributions / userVoices / ugcVotes / tripForks
 *   L7 审核与审计   → ugcContributions.status / ugcPromotions / moderationLogs
 */

import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/* ============================================================
 * L0 基础内容层
 * ============================================================ */

export const countries = sqliteTable("countries", {
  id: text("id").primaryKey(),
  nameCn: text("name_cn").notNull(),
  nameEn: text("name_en"),
  /** 国内 / 国外 —— 发现页顶部 Tab(需求文档 5.1.1) */
  scope: text("scope", { enum: ["domestic", "overseas"] }).notNull(),
  /**
   * 洲(v2.0 变更 1 / 决策 D-44):目的地选择器弹窗的第一层分类
   * 仅国外国家的有值;国内用 cities.province 做第一层
   */
  continent: text("continent", {
    enum: ["亚洲", "欧洲", "非洲", "北美洲", "南美洲", "大洋洲"],
  }),
  sort: integer("sort").notNull().default(0),
});

export const cities = sqliteTable(
  "cities",
  {
    id: text("id").primaryKey(),
    countryId: text("country_id").notNull(),
    nameCn: text("name_cn").notNull(),
    nameEn: text("name_en"),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    /** 热度分,决定热门 Top5 排序(需求文档 5.1.3) */
    popularityScore: real("popularity_score").notNull().default(0),
    /** 是否进入热门 Top5 */
    isHot: integer("is_hot", { mode: "boolean" }).notNull().default(false),
    /** 标签上的小 icon */
    icon: text("icon").notNull().default("📍"),
    /** 一句话介绍,展示在标签 hover / 卡片 */
    tagline: text("tagline"),
    /**
     * 省 / 直辖市(v2.0 变更 1 / 决策 D-44)
     * 国内城市的选择器第一层分类依据
     */
    province: text("province"),
    /** 热度数据来源与更新时间,便于溯源(合规要求) */
    popularitySource: text("popularity_source"),
    popularityUpdatedAt: text("popularity_updated_at"),
  },
  (t) => [index("cities_country_idx").on(t.countryId)],
);

export const pois = sqliteTable(
  "pois",
  {
    id: text("id").primaryKey(),
    cityId: text("city_id").notNull(),
    nameCn: text("name_cn").notNull(),
    /** 原文名,国外城市展示(需求文档 11-Q6) */
    nameEn: text("name_en"),
    category: text("category", {
      // v2.0 变更 4 / 决策 D-52:新增 stay(住宿)
      enum: ["sight", "food", "stay", "experience", "nature", "shopping"],
    })
      .notNull()
      .default("sight"),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    /** 所属区域,排程地理聚类的首选依据(需求文档 5.3.1 硬约束) */
    area: text("area").notNull(),
    /** 一句话简介 ≤ 40 字 */
    summary: text("summary").notNull().default(""),
    durationMin: integer("duration_min").notNull().default(90),
    durationMax: integer("duration_max").notNull().default(150),
    physicalLoad: text("physical_load", { enum: ["easy", "medium", "hard"] })
      .notNull()
      .default("easy"),
    /** JSON string[]:适合人群标签 */
    suitableFor: text("suitable_for").notNull().default("[]"),
    imageUrl: text("image_url"),
    /** 图片版权来源说明,合规留痕 */
    imageCredit: text("image_credit"),
    /** 数据来源层:L1 人工校准 / ai_seed AI 种子 */
    sourceLayer: text("source_layer").notNull().default("ai_seed"),
    /** 被多少个行程采用(F2-16),由排程与复刻行为累加 */
    adoptedByTrips: integer("adopted_by_trips").notNull().default(0),
    /** 体力/价格等排序辅助字段(住宿/餐饮复用为价位档) */
    ticketLevel: text("ticket_level", { enum: ["free", "low", "medium", "high"] })
      .notNull()
      .default("medium"),
    /**
     * 餐饮适用餐次(v2.0 变更 4 / 决策 D-52)
     * 仅 category=food 时有值;both 表示午晚餐都合适
     */
    mealType: text("meal_type", { enum: ["lunch", "dinner", "both"] }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("pois_city_idx").on(t.cityId), index("pois_area_idx").on(t.area)],
);

/** 优缺点条目 —— 展示层与语料层分离(决策 D-25) */
export const poiProsCons = sqliteTable(
  "poi_pros_cons",
  {
    id: text("id").primaryKey(),
    poiId: text("poi_id").notNull(),
    /** pro = 好处 / con = 坏事 / fact = 中性事实补充 */
    type: text("type", { enum: ["pro", "con", "fact"] }).notNull(),
    /** 语料层:进入 AI 上下文的客观化文本(决策 D-25) */
    text: text("text").notNull(),
    /** 展示层:对外展示的文本。升级前为用户原文,升级后与 text 一致 */
    displayText: text("display_text").notNull(),
    sourceType: text("source_type", {
      enum: ["official", "review", "ugc", "ai_inferred"],
    }).notNull(),
    /**
     * 条目来源(与 source_type 是两件事):
     *   ai_gen        —— 由 AI 每次生成卡片时写入,可被下一次生成整体替换
     *   manual        —— 人工校准,永不自动删除
     *   ugc_promoted  —— 用户内容经人工确认升级而来,只能由降级操作移除
     * 有了它,重新生成才不会堆积陈旧条目,也不会误删人工/升级内容。
     */
    origin: text("origin", { enum: ["ai_gen", "manual", "ugc_promoted"] })
      .notNull()
      .default("ai_gen"),
    sourceDetail: text("source_detail"),
    /** 溯源:由哪条 UGC 升级而来 */
    traceUgcId: text("trace_ugc_id"),
    /** 权重:合并重复条目时累加,影响排序 */
    weight: real("weight").notNull().default(1),
    verifiedAt: text("verified_at"),
    /** 过期时间,旅游信息时效性强(需求文档 6.3 硬性规则) */
    expiresAt: text("expires_at"),
    /** 被合并到哪条(重复条目合并后指向主条目) */
    mergedIntoId: text("merged_into_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("pc_poi_idx").on(t.poiId), index("pc_type_idx").on(t.type)],
);

/** L2 客观事实 —— 只来自第三方 API,查不到就不展示字段(F2-05) */
export const poiFacts = sqliteTable("poi_facts", {
  poiId: text("poi_id").primaryKey(),
  ticketText: text("ticket_text"),
  openingHours: text("opening_hours"),
  address: text("address"),
  /** 数据更新时间,前端必须展示"更新于 YYYY-MM-DD"(F2-04) */
  updatedAt: text("updated_at").notNull(),
  /** 数据来源标识 */
  provider: text("provider").notNull().default("manual"),
});

/** L4 热度数据(离线 ETL 落库,前端只读 —— 需求文档 5.1.3 架构决策) */
export const hotRankings = sqliteTable(
  "hot_rankings",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["domestic", "overseas"] }).notNull(),
    rank: integer("rank").notNull(),
    cityId: text("city_id").notNull(),
    score: real("score").notNull().default(0),
    source: text("source").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("hot_scope_idx").on(t.scope, t.rank)],
);

/* ============================================================
 * 用户与行程
 * ============================================================ */

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    nickname: text("nickname").notNull(),
    /** 决策 D-21 补充:非 admin 访问 /admin 返回 404 */
    role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
    status: text("status", { enum: ["active", "banned"] }).notNull().default("active"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const trips = sqliteTable(
  "trips",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    /** JSON string[] 城市 ID */
    cityIds: text("city_ids").notNull(),
    days: integer("days").notNull(),
    /** JSON TripParams —— 一键复刻"按我的偏好重新生成"要用(决策 D-15 / F6-03) */
    paramsJson: text("params_json").notNull(),
    /** JSON Schedule —— 排程引擎产出的结构化日程 */
    scheduleJson: text("schedule_json").notNull(),
    /** private | public(需求文档 5.6.2) */
    visibility: text("visibility", { enum: ["private", "public"] }).notNull().default("private"),
    /** 复刻来源 */
    forkedFromTripId: text("forked_from_trip_id"),
    /** 复刻模式:copy 原样复制 / regenerate 按我的偏好重新生成 */
    forkMode: text("fork_mode", { enum: ["copy", "regenerate"] }),
    /** 分享 slug,用于 /s/[slug] 只读页 */
    shareSlug: text("share_slug").notNull(),
    likeCount: integer("like_count").notNull().default(0),
    forkCount: integer("fork_count").notNull().default(0),
    /** 排程告警,如"点位排不下" */
    warningsJson: text("warnings_json").notNull().default("[]"),
    /** 版本号(v2.0 变更 7 / 决策 D-58):每次应用变更 +1 */
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("trips_slug_idx").on(t.shareSlug),
    index("trips_user_idx").on(t.userId),
    index("trips_visibility_idx").on(t.visibility),
  ],
);

/* ============================================================
 * L6 用户内容(UGC)
 * ============================================================ */

export const ugcContributions = sqliteTable(
  "ugc_contributions",
  {
    id: text("id").primaryKey(),
    poiId: text("poi_id").notNull(),
    userId: text("user_id").notNull(),
    /** 用户原文 —— 决策 D-24:展示层直接用原文,不做改写 */
    rawText: text("raw_text").notNull(),
    imageUrls: text("image_urls").notNull().default("[]"),
    /** AI 意向判定:点赞 / 点踩 / 中性事实 */
    aiSentiment: text("ai_sentiment", { enum: ["positive", "negative", "neutral"] }),
    aiConfidence: real("ai_confidence"),
    /** AI 预审标签(决策 D-23) */
    aiFlagsJson: text("ai_flags_json").notNull().default("{}"),
    aiSuggestion: text("ai_suggestion", { enum: ["approve", "reject", "review"] }),
    status: text("status", { enum: ["pending", "approved", "rejected", "merged"] })
      .notNull()
      .default("pending"),
    /** 审核后由谁处理、何时 */
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at"),
    rejectReason: text("reject_reason"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("ugc_poi_idx").on(t.poiId),
    index("ugc_status_idx").on(t.status),
    index("ugc_user_idx").on(t.userId),
  ],
);

/** 投票:「我也遇到了」/「这条不准确」(F2-09、6.3 升级门禁输入) */
export const ugcVotes = sqliteTable(
  "ugc_votes",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type", { enum: ["contribution", "pros_cons"] }).notNull(),
    targetId: text("target_id").notNull(),
    userId: text("user_id").notNull(),
    /** 同一 IP/设备视为一个用户(6.3 防投毒硬性规则) */
    voterFingerprint: text("voter_fingerprint").notNull(),
    vote: text("vote", { enum: ["confirm", "dispute"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    // 同一个账号对同一条内容只能投一票(主要规则 —— 需求文档 6.3"至少 3 位不同账号确认")
    uniqueIndex("votes_user_unique_idx").on(t.targetType, t.targetId, t.userId),
    // 指纹去重是辅助:防止同一设备换账号刷票
    index("votes_fingerprint_idx").on(t.targetType, t.targetId, t.voterFingerprint),
  ],
);

/** 语料升级记录(决策 D-26:必须人工确认才可升级) */
export const ugcPromotions = sqliteTable(
  "ugc_promotions",
  {
    id: text("id").primaryKey(),
    contributionId: text("contribution_id").notNull(),
    poiId: text("poi_id").notNull(),
    /** AI 生成的客观化改写草稿(决策 D-25 语料层) */
    promotedText: text("promoted_text").notNull(),
    targetType: text("target_type", { enum: ["pro", "con", "fact"] }).notNull(),
    promotedBy: text("promoted_by"),
    promotedAt: text("promoted_at"),
    /** 降级原因,升级后可反悔(5.7.7 审计) */
    demotedReason: text("demoted_reason"),
    status: text("status", { enum: ["candidate", "promoted", "demoted"] })
      .notNull()
      .default("candidate"),
    confirmCount: integer("confirm_count").notNull().default(0),
    disputeCount: integer("dispute_count").notNull().default(0),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("promo_status_idx").on(t.status), index("promo_poi_idx").on(t.poiId)],
);

export const tripLikes = sqliteTable(
  "trip_likes",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("likes_unique_idx").on(t.tripId, t.userId)],
);

export const tripForks = sqliteTable(
  "trip_forks",
  {
    id: text("id").primaryKey(),
    sourceTripId: text("source_trip_id").notNull(),
    newTripId: text("new_trip_id").notNull(),
    userId: text("user_id").notNull(),
    mode: text("mode", { enum: ["copy", "regenerate"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("forks_source_idx").on(t.sourceTripId)],
);

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type", {
      enum: ["trip", "contribution", "image", "pros_cons"],
    }).notNull(),
    targetId: text("target_id").notNull(),
    userId: text("user_id"),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["open", "resolved", "dismissed"] })
      .notNull()
      .default("open"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("reports_status_idx").on(t.status)],
);

/* ============================================================
 * L7 审核与审计
 * ============================================================ */

export const moderationQueue = sqliteTable(
  "moderation_queue",
  {
    id: text("id").primaryKey(),
    /** contribution | promotion | report | image */
    queueType: text("queue_type", {
      enum: ["contribution", "promotion", "report", "image"],
    }).notNull(),
    targetId: text("target_id").notNull(),
    /** 优先级分:广告嫌疑置顶(5.7.3 AI 预审的价值在排序) */
    priorityScore: real("priority_score").notNull().default(0),
    aiFlagsJson: text("ai_flags_json").notNull().default("{}"),
    aiSuggestion: text("ai_suggestion", { enum: ["approve", "reject", "review"] }),
    status: text("status", { enum: ["open", "done", "skipped"] }).notNull().default("open"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("queue_status_idx").on(t.status, t.queueType)],
);

export const moderationLogs = sqliteTable(
  "moderation_logs",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    /** approve | reject | reclassify | merge | promote | demote | ban */
    action: text("action").notNull(),
    operatorId: text("operator_id"),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("logs_target_idx").on(t.targetType, t.targetId)],
);

/**
 * 行程修订记录(v2.0 变更 7 / 决策 D-58)
 * 每次应用自然语言变更都写一条,保留变更前后的完整快照以支持回滚。
 */
export const tripRevisions = sqliteTable(
  "trip_revisions",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id").notNull(),
    /** 应用后的版本号 */
    version: integer("version").notNull(),
    /** 用户的原始自然语言输入 */
    userMessage: text("user_message").notNull(),
    /** AI 输出的变更提案 JSON */
    proposalJson: text("proposal_json").notNull(),
    /** 变更前快照(用于回滚) */
    scheduleBefore: text("schedule_before").notNull(),
    paramsBefore: text("params_before").notNull(),
    titleBefore: text("title_before").notNull(),
    /** 变更后快照 */
    scheduleAfter: text("schedule_after").notNull(),
    paramsAfter: text("params_after").notNull(),
    titleAfter: text("title_after").notNull(),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("revisions_trip_idx").on(t.tripId, t.version)],
);

/* ============================================================
 * AI 对话记录(v2.0 变更 7)
 * ============================================================ */

export const tripMessages = sqliteTable(
  "trip_messages",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id").notNull(),
    /** user | assistant */
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    /** assistant 消息若为提案,存提案 JSON */
    proposalJson: text("proposal_json"),
    /** 提案是否已被应用 */
    applied: integer("applied", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("trip_messages_trip_idx").on(t.tripId, t.createdAt)],
);

/* ============================================================
 * 生成缓存(需求文档 6.2 关键工程约束 3 / 6.5.4 成本优化手段 2)
 * ============================================================ */

export const generationCache = sqliteTable(
  "generation_cache",
  {
    id: text("id").primaryKey(),
    cacheKey: text("cache_key").notNull(),
    /** poi_cards | trip_prose */
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    model: text("model").notNull(),
    mode: text("mode", { enum: ["mock", "live"] }).notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("cache_key_idx").on(t.cacheKey, t.kind)],
);

/** 调用用量日志,用于核对 6.5.3 的成本估算(Q13 需要真实账单) */
export const llmUsageLogs = sqliteTable("llm_usage_logs", {
  id: text("id").primaryKey(),
  task: text("task").notNull(),
  model: text("model").notNull(),
  mode: text("mode", { enum: ["mock", "live"] }).notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  ok: integer("ok", { mode: "boolean" }).notNull().default(true),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
});
