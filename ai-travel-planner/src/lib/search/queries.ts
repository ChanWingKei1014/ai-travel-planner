import { BUDGET_LABEL, COMPANION_LABEL, PACE_LABEL, type TripParams } from "@/lib/types";

export interface SearchQuery {
  category: "sight" | "stay" | "food";
  purpose: "discovery" | "tradeoffs";
  query: string;
}

/** 每类先广泛发现，再查体验优缺点；避免把所有出行条件拼成过窄的搜索式。 */
export function buildSearchQueries(cityName: string, params: TripParams): SearchQuery[] {
  const city = [...cityName.replace(/\s+/g, " ").trim()].slice(0, 40).join("");
  const companion = COMPANION_LABEL[params.companion] ?? "朋友";
  const budget = BUDGET_LABEL[params.budgetTier] ?? "标准";
  const pace = PACE_LABEL[params.pace] ?? "标准";
  const days = Number.isFinite(params.days) ? Math.min(30, Math.max(1, Math.round(params.days))) : 5;
  const travelers = Number.isFinite(params.travelers) ? Math.min(20, Math.max(1, Math.round(params.travelers!))) : 2;
  const queries: SearchQuery[] = [
    { category: "sight", purpose: "discovery", query: `${city} 自由行 景点 自然景观 文化街区 ${days}天 ${pace} 推荐 -跟团 -旅行社` },
    { category: "sight", purpose: "tradeoffs", query: `${city} 景点 游客体验 优点 缺点 拥挤 排队 ${companion}` },
    { category: "stay", purpose: "discovery", query: `${city} 住宿 酒店 民宿 ${budget} ${travelers}人 ${companion} 推荐` },
    { category: "stay", purpose: "tradeoffs", query: `${city} 酒店 民宿 住客评价 优点 缺点 隔音 卫生 交通` },
    { category: "food", purpose: "discovery", query: `${city} 本地特色 餐厅 老字号 ${budget} 推荐 店名` },
    { category: "food", purpose: "tradeoffs", query: `${city} 餐厅 食客评价 口味 服务 优点 缺点 排队` },
  ];
  return queries.map((item) => ({ ...item, query: [...item.query].slice(0, 128).join("") }));
}
