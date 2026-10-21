/**
 * 全局领域类型与常量
 * 对应需求文档 v0.4:5.2.2 行程参数、5.2.3 可玩点卡片、5.2.4 来源标记、5.3.1 排程约束
 */

/* ============================================================
 * 一、来源标记体系(需求文档 5.2.4 / 决策 D-12、D-16、D-24)
 * ============================================================ */

/** 优缺点条目的来源类型 —— 必须四选一,不允许出现无标记的条目 */
export type SourceType =
  | "official" // 官方:来自景点官网/官方发布
  | "review" // 评论:来自真实用户评论的归纳,含被交叉验证的 UGC
  | "xhs" // 小红书笔记或评论整理，保留原文引用
  | "ugc" // 用户反馈:本站用户提交的原文,尚未达到交叉验证条件
  | "ai_inferred"; // AI 综合:模型基于公开知识归纳,未经核实

export const SOURCE_LABEL: Record<SourceType, string> = {
  official: "官方",
  review: "评论",
  xhs: "小红书",
  ugc: "用户反馈",
  ai_inferred: "AI 综合",
};

/** 来源标记的视觉色(对应文档中"不同颜色小标签") */
export const SOURCE_STYLE: Record<SourceType, string> = {
  official: "bg-blue-50 text-blue-700 ring-blue-200",
  review: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  xhs: "bg-red-50 text-red-700 ring-red-200",
  ugc: "bg-amber-50 text-amber-700 ring-amber-200",
  ai_inferred: "bg-slate-100 text-slate-600 ring-slate-200",
};

export interface ProsConsItem {
  text: string;
  sourceType: SourceType;
  /** 来源详情,如"近 90 天 230 条评论归纳""5 位用户确认" */
  sourceDetail?: string;
  /** 小红书笔记或评论的证据 ID；站内旧内容无此字段。 */
  sourceIds?: string[];
}

export interface XhsSourceRef {
  id: string;
  kind: "note" | "comment";
  noteId: string;
  title: string;
  url?: string;
  excerpt: string;
}

/* ============================================================
 * 二、行程参数(需求文档 5.2.2 / 决策 D-07)
 * ============================================================ */

export type PhysicalLoad = "easy" | "medium" | "hard";
export const PHYSICAL_LOAD_LABEL: Record<PhysicalLoad, string> = {
  easy: "轻松",
  medium: "中等",
  hard: "高强度",
};

/** 节奏 —— 直接决定每天排几个点(5.3.1 硬约束) */
export type Pace = "relaxed" | "standard" | "intense";
export const PACE_LABEL: Record<Pace, string> = {
  relaxed: "松弛",
  standard: "标准",
  intense: "特种兵",
};

/* 每天点位数量区间(需求文档 5.3.1 硬约束表) */
export const PACE_POI_RANGE: Record<Pace, [number, number]> = {
  relaxed: [2, 3],
  standard: [3, 4],
  intense: [5, 6],
};

export type Companion = "solo" | "couple" | "friends" | "family_kids" | "family_elders";
export const COMPANION_LABEL: Record<Companion, string> = {
  solo: "单人",
  couple: "情侣",
  friends: "朋友",
  family_kids: "亲子",
  family_elders: "带父母",
};

export type BudgetTier = "shoestring" | "standard" | "comfort" | "luxury";
export const BUDGET_LABEL: Record<BudgetTier, string> = {
  shoestring: "穷游",
  standard: "标准",
  comfort: "舒适",
  luxury: "奢华",
};

/** 行程参数表单的完整输入(除天数外全部可选,跳过即用默认值 —— 文档 5.2.2) */
export interface TripParams {
  /** 城市 ID 列表,支持多城市联游(决策 D-09) */
  cityIds: string[];
  days: number;
  /** 出行总人数；旧行程缺失时按默认 2 人处理。 */
  travelers?: number;
  origin?: string;
  budgetTier: BudgetTier;
  companion: Companion;
  pace: Pace;
  /** 用户已选的 POI ID 列表(含景点 / 餐饮) */
  poiIds: string[];
  /**
   * 用户已选的住宿 ID 列表(可多选,最多 5 家)
   * v2.0 变更 4 / 决策 D-53:住宿按天绑定,支持同一城市中途换酒店
   */
  lodgingIds: string[];
}

export const DEFAULT_TRIP_PARAMS: Omit<TripParams, "cityIds" | "poiIds" | "lodgingIds"> = {
  days: 5,
  travelers: 2,
  origin: "",
  budgetTier: "standard",
  companion: "friends",
  pace: "standard",
};

/* ============================================================
 * 三、可玩点卡片(需求文档 5.2.3)
 * ============================================================ */

export type PoiCategory = "sight" | "food" | "stay" | "experience" | "nature" | "shopping";

export const CATEGORY_LABEL: Record<PoiCategory, string> = {
  sight: "景点",
  food: "吃饭",
  stay: "住宿",
  experience: "体验",
  nature: "自然",
  shopping: "购物",
};

/** 挑可玩点页的类别 Tab 顺序(需求 v2.0 第 8.2 节) */
export const CATEGORY_TAB_ORDER: PoiCategory[] = [
  "sight",
  "stay",
  "food",
  "experience",
  "nature",
  "shopping",
];

/** 类别图标 */
export const CATEGORY_ICON: Record<PoiCategory, string> = {
  sight: "🏛",
  food: "🍽",
  stay: "🏨",
  experience: "🎭",
  nature: "🌿",
  shopping: "🛍",
};

/** 餐次(需求 v2.0 第 15.3 节:每天固定午餐 + 晚餐) */
export type MealType = "lunch" | "dinner";
export const MEAL_LABEL: Record<MealType, string> = {
  lunch: "午餐",
  dinner: "晚餐",
};

/** 餐次时间窗口(分钟,自 00:00 起算) */
export const MEAL_WINDOW: Record<MealType, { start: number; end: number }> = {
  lunch: { start: 12 * 60, end: 13 * 60 + 30 },
  dinner: { start: 18 * 60 + 30, end: 20 * 60 },
};

/** 住宿到当天任一游玩点的单程通勤上限(分钟)—— 硬约束 */
export const MAX_LODGING_TRANSFER_MINUTES = 30;
/** 餐饮点到所在时段前后点位的单程通勤上限(分钟)—— 硬约束 */
export const MAX_MEAL_TRANSFER_MINUTES = 20;
/** 换酒店占用的时间(分钟) */
export const CHANGEOVER_MINUTES = 90;
/** 换酒店日的游览预算系数 */
export const CHANGEOVER_BUDGET_RATIO = 0.75;
/** 住宿最多可选家数 */
export const MAX_LODGING_SELECTION = 5;

/** 用户原文短评(决策 D-24:展示原文,不做改写) */
export interface UserVoice {
  id: string;
  text: string;
  /** AI 判定的意向:点赞 / 点踩 / 事实补充 */
  sentiment: "positive" | "negative" | "neutral";
  nickname: string;
  createdAt: string;
  confirmCount: number;
  disputeCount: number;
}

export interface PoiCard {
  id: string;
  cityId: string;
  cityName: string;
  name: string;
  nameLocal?: string;
  category: PoiCategory;
  /** 所属区域,用于同日聚集(5.3.1 地理聚类) */
  area: string;
  lat: number;
  lng: number;
  /** 一句话简介 ≤ 40 字 */
  summary: string;
  summarySourceIds?: string[];
  pros: ProsConsItem[];
  cons: ProsConsItem[];
  /** 建议停留时长(分钟) */
  durationMinutes: { min: number; max: number };
  physicalLoad: PhysicalLoad;
  suitableFor: string[];
  /** 客观信息:来自第三方 API,查不到则为 undefined,绝不由 LLM 猜(5.2.4 / F2-05) */
  ticket?: { value: string; updatedAt: string };
  openingHours?: string;
  imageUrl?: string;
  /**
   * 客观信息的提供方:api(第三方接口)/ ai_seed(AI 种子,未经核对)/ manual(人工)
   * 用途:前端据此提示"待核实",且生成 prompt 据此判定条目该不该标 official
   */
  factsProvider?: string | null;
  /** 被多少个行程采用(F2-16) */
  adoptedByTrips: number;
  /** 用户原文短评 */
  userVoices: UserVoice[];
  /** 餐饮适用餐次(仅 category=food 时有值;both = 午晚餐都合适) */
  mealType?: MealType | "both" | null;
  /** 住宿价位档(仅 category=stay 时有值,复用 ticket_level) */
  lodgingLevel?: string | null;
  /**
   * 邻近关系:到最近 3 个游玩点的通勤方式与耗时
   * 需求 v2.0 第 8.5.1 节 / 决策 D-54:住宿与餐饮**必须**展示
   * 服务端动态计算,不落库
   */
  nearby?: NearbyRef[];
  /** 采集点位必须有可核实坐标才能参与排程。 */
  geoVerified?: boolean;
  geoProvider?: string;
  dataSource?: "xhs";
  xhsSources?: XhsSourceRef[];
  xhsAliases?: string[];
}

/** 邻近关系条目 */
export interface NearbyRef {
  poiId: string;
  name: string;
  area: string;
  transferMinutes: number;
  transferMode: string;
  km: number;
}

/* ============================================================
 * 四、排程输出结构(需求文档 5.3.2 / 决策 D-10:时段块)
 * ============================================================ */

export type Period = "am" | "pm" | "eve";
export const PERIOD_LABEL: Record<Period, string> = {
  am: "上午",
  pm: "下午",
  eve: "晚上",
};
export const PERIOD_ICON: Record<Period, string> = {
  am: "🌅",
  pm: "☀️",
  eve: "🌙",
};

/** 时段块内的单个安排项(一个时段可以排多个点,对应文档 13.2 的展示示意) */
export interface SlotItem {
  /** 该安排的 POI(可能为空,如到达日上午为"抵达/休整") */
  poiId: string | null;
  /** 展示标题:POI 名称,或"抵达 / 酒店休整"这类安排 */
  title: string;
  stayMinutes: number;
  /** 从上一个点过来的通勤时间(分钟) */
  transferFromPrevMinutes: number;
  transferMode: string;
  /** 补一句提醒 */
  note?: string;
}

export interface TripSlot {
  period: Period;
  items: SlotItem[];
}

export interface TripDay {
  dayIndex: number;
  cityId: string;
  cityName: string;
  /** 当日所在区域(地理聚类结果) */
  area: string;
  /** 当日强度:轻松 / 标准 / 较满 */
  loadLevel: string;
  slots: TripSlot[];
  /** 由 LLM 生成的"人话"小结(排程算法不参与措辞) */
  summary?: string;
  /** 由 LLM 生成的一条可执行提醒 */
  tip?: string;
  /** 当日住宿(按天绑定,见决策 D-53) */
  lodging?: LodgingInfo | null;
  /** 当日餐次(午餐 + 晚餐,固定安排) */
  meals?: MealInfo[];
}

/** 当日住宿安排 */
export interface LodgingInfo {
  poiId: string | null;
  name: string;
  /** 是否为换酒店日(当天需要搬运) */
  isChangeover: boolean;
  /** 连住晚数,仅在入住日有值(用于"连住第 1–2 晚"展示) */
  nightsStayed: number;
  /** 是否为系统建议(用户未选住宿时为 true) */
  isSuggested: boolean;
  /** 到当天游玩点的最远通勤时间(分钟),用于展示与校验 */
  maxTransferMinutes: number;
}

/** 当日餐次安排 */
export interface MealInfo {
  type: MealType;
  poiId: string | null;
  name: string;
  /** 是否为系统建议(用户未选餐饮时为 true) */
  isSuggested: boolean;
  /** 从上一个行程点过来的通勤时间 */
  transferFromPrevMinutes: number;
}

export interface Schedule {
  days: TripDay[];
  /** 排程过程中的提示与告警(如"排不下""通勤超时") */
  warnings: string[];
  /** 整体概述,由 LLM 生成 */
  overview?: string;
  /** 通用提醒,由 LLM 生成 */
  tips?: string[];
  /** 统计信息 */
  stats: {
    totalPois: number;
    placedPois: number;
    unplacedPois: number;
    totalDays: number;
  };
}

/* ============================================================
 * 五、排程硬约束常量(需求文档 5.3.1)
 * ============================================================ */

/** 单日城市内通勤上限(分钟) */
export const MAX_DAILY_TRANSFER_MINUTES = 90;

/** 到达日 / 离开日按 0.5 天折算(5.3.1 硬约束) */
export const ARRIVAL_DAY_RATIO = 0.5;

/** 用餐时段保留:午 90 分钟、晚 60 分钟不排景点 */
export const LUNCH_MINUTES = 90;
export const DINNER_MINUTES = 60;

/** 一个完整可用日的基础游览分钟数(上午 + 下午) */
export const FULL_DAY_SIGHT_MINUTES = 420;

/** 步行 / 公共交通 / 打车的切换阈值(公里) */
export const WALK_THRESHOLD_KM = 1.2;
export const TRANSIT_THRESHOLD_KM = 15;

/* ============================================================
 * 六、UGC(需求文档 5.6)
 * ============================================================ */

export type UgcStatus = "pending" | "approved" | "rejected" | "merged";
export type Sentiment = "positive" | "negative" | "neutral";

/** UGC 提交文本框长度限制(决策 D-24 补充:抑制长文叙事与隐私泄露) */
export const UGC_MIN_LENGTH = 10;
export const UGC_MAX_LENGTH = 80;

/** 语料升级门禁(需求文档 6.3 / 决策 D-26) */
export const PROMOTE_MIN_CONFIRMS = 3;
export const PROMOTE_MIN_CONFIRM_RATE = 0.7;
export const PROMOTE_MAX_DISPUTES = 2;
export const PROMOTE_MAX_AGE_DAYS = 365;

/* ============================================================
 * 七、应用级常量
 * ============================================================ */

export const APP_NAME = "AI 旅行攻略生成器";

/** 单次生成缓存的 key 前缀(需求文档 6.2 关键工程约束 3) */
export const GENERATION_CACHE_TTL_MINUTES = 60 * 24 * 7;
