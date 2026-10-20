/**
 * 城市目录(种子数据的唯一来源)
 *
 * v2.0 变更(需求文档 v2.0 第 5 章 / 附录 A,决策 D-44 / D-46):
 *   - 城市从 9 个扩充到 28 个(国外 16 / 国内 12)
 *   - 国家新增 `continent`(洲),用于国外城市的选择器第一层分类
 *   - 城市新增 `province`(省/直辖市),用于国内城市的第一层分类
 *   - `poiCity` 标记是否批量生成 POI 种子数据;**有内容的仍只有 3 个城市**
 *
 * bbox 用于校验 AI 生成的经纬度是否落在该城市合理范围内 —— AI 生成坐标极易漂移,必须机检。
 */

export interface CitySeed {
  id: string;
  countryId: string;
  nameCn: string;
  nameEn: string;
  lat: number;
  lng: number;
  icon: string;
  tagline: string;
  popularityScore: number;
  isHot: boolean;
  popularitySource: string;
  /** 是否批量生成 POI 种子数据 */
  poiCity: boolean;
  /** 国内城市的省 / 直辖市(选择器分类用) */
  province?: string;
  /** 经纬度合理范围 [minLat, maxLat, minLng, maxLng] */
  bbox: [number, number, number, number];
}

export interface CountrySeed {
  id: string;
  nameCn: string;
  nameEn: string;
  scope: "domestic" | "overseas";
  /** 洲 —— 仅国外国家有值 */
  continent?: "亚洲" | "欧洲" | "非洲" | "北美洲" | "南美洲" | "大洋洲";
  sort: number;
}

/** 选择器弹窗的洲顺序(需求文档 v2.0 第 6.2 节) */
export const CONTINENT_ORDER = [
  "亚洲",
  "欧洲",
  "非洲",
  "北美洲",
  "南美洲",
  "大洋洲",
] as const;

export const COUNTRY_SEEDS: CountrySeed[] = [
  { id: "cn", nameCn: "中国", nameEn: "China", scope: "domestic", sort: 1 },

  { id: "jp", nameCn: "日本", nameEn: "Japan", scope: "overseas", continent: "亚洲", sort: 10 },
  { id: "kr", nameCn: "韩国", nameEn: "South Korea", scope: "overseas", continent: "亚洲", sort: 11 },
  { id: "th", nameCn: "泰国", nameEn: "Thailand", scope: "overseas", continent: "亚洲", sort: 12 },
  { id: "sg", nameCn: "新加坡", nameEn: "Singapore", scope: "overseas", continent: "亚洲", sort: 13 },
  { id: "id", nameCn: "印度尼西亚", nameEn: "Indonesia", scope: "overseas", continent: "亚洲", sort: 14 },
  { id: "ae", nameCn: "阿联酋", nameEn: "UAE", scope: "overseas", continent: "亚洲", sort: 15 },

  { id: "fr", nameCn: "法国", nameEn: "France", scope: "overseas", continent: "欧洲", sort: 20 },
  { id: "gb", nameCn: "英国", nameEn: "United Kingdom", scope: "overseas", continent: "欧洲", sort: 21 },
  { id: "it", nameCn: "意大利", nameEn: "Italy", scope: "overseas", continent: "欧洲", sort: 22 },

  { id: "us", nameCn: "美国", nameEn: "United States", scope: "overseas", continent: "北美洲", sort: 30 },
  { id: "ca", nameCn: "加拿大", nameEn: "Canada", scope: "overseas", continent: "北美洲", sort: 31 },

  { id: "au", nameCn: "澳大利亚", nameEn: "Australia", scope: "overseas", continent: "大洋洲", sort: 40 },
  { id: "nz", nameCn: "新西兰", nameEn: "New Zealand", scope: "overseas", continent: "大洋洲", sort: 41 },
];

const SOURCE_OVERSEAS = "TripAdvisor 目的地榜 + Google Trends(2025 季度快照,人工录入)";
const SOURCE_DOMESTIC = "OTA 目的地热度榜 + 社媒话题量(2025 季度快照,人工录入)";

export const CITY_SEEDS: CitySeed[] = [
  /* ============================================================
   * 国外 · 亚洲(8)
   * ============================================================ */
  {
    id: "tokyo", countryId: "jp", nameCn: "东京", nameEn: "Tokyo",
    lat: 35.6762, lng: 139.6503, icon: "🗼",
    tagline: "街区密度极高,适合分区深度逛",
    popularityScore: 97, isHot: true, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [35.4, 35.9, 139.4, 139.95],
  },
  {
    id: "osaka", countryId: "jp", nameCn: "大阪", nameEn: "Osaka",
    lat: 34.6937, lng: 135.5023, icon: "🏯",
    tagline: "美食与市井氛围强,关西出行枢纽",
    popularityScore: 93, isHot: true, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [34.55, 34.85, 135.35, 135.65],
  },
  {
    id: "seoul", countryId: "kr", nameCn: "首尔", nameEn: "Seoul",
    lat: 37.5665, lng: 126.978, icon: "🏙",
    tagline: "宫殿、街区与咖啡文化混在一起",
    popularityScore: 89, isHot: false, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [37.4, 37.7, 126.8, 127.15],
  },
  {
    id: "bangkok", countryId: "th", nameCn: "曼谷", nameEn: "Bangkok",
    lat: 13.7563, lng: 100.5018, icon: "🛕",
    tagline: "寺庙、市集与夜生活",
    popularityScore: 88, isHot: false, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [13.5, 14.0, 100.3, 100.8],
  },
  {
    id: "phuket", countryId: "th", nameCn: "普吉岛", nameEn: "Phuket",
    lat: 7.8804, lng: 98.3923, icon: "🏝",
    tagline: "海岛度假与出海跳岛基地",
    popularityScore: 84, isHot: false, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [7.7, 8.2, 98.2, 98.5],
  },
  {
    id: "singapore", countryId: "sg", nameCn: "新加坡", nameEn: "Singapore",
    lat: 1.3521, lng: 103.8198, icon: "🦁",
    tagline: "城市国家,三天可以走得很扎实",
    popularityScore: 87, isHot: false, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [1.2, 1.5, 103.6, 104.0],
  },
  {
    id: "bali", countryId: "id", nameCn: "巴厘岛", nameEn: "Bali",
    lat: -8.4095, lng: 115.1889, icon: "🌴",
    tagline: "火山、梯田与海滩,分区差异极大",
    popularityScore: 86, isHot: false, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [-8.9, -8.0, 114.9, 115.7],
  },
  {
    id: "dubai", countryId: "ae", nameCn: "迪拜", nameEn: "Dubai",
    lat: 25.2048, lng: 55.2708, icon: "🕌",
    tagline: "沙漠与超级城市并置",
    popularityScore: 83, isHot: false, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [24.9, 25.4, 55.0, 55.5],
  },

  /* ============================================================
   * 国外 · 欧洲(3)
   * ============================================================ */
  {
    id: "paris", countryId: "fr", nameCn: "巴黎", nameEn: "Paris",
    lat: 48.8566, lng: 2.3522, icon: "🗼",
    tagline: "博物馆与街区散步的城市",
    popularityScore: 94, isHot: true, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [48.7, 49.0, 2.2, 2.5],
  },
  {
    id: "london", countryId: "gb", nameCn: "伦敦", nameEn: "London",
    lat: 51.5074, lng: -0.1278, icon: "🎡",
    tagline: "博物馆免费,靠地铁可以逛得很开",
    popularityScore: 91, isHot: false, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [51.35, 51.65, -0.4, 0.1],
  },
  {
    id: "rome", countryId: "it", nameCn: "罗马", nameEn: "Rome",
    lat: 41.9028, lng: 12.4964, icon: "🏛",
    tagline: "古迹密度极高,暴走量也极大",
    popularityScore: 85, isHot: false, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [41.75, 42.05, 12.35, 12.65],
  },

  /* ============================================================
   * 国外 · 北美洲(2)
   * ============================================================ */
  {
    id: "newyork", countryId: "us", nameCn: "纽约", nameEn: "New York",
    lat: 40.7128, lng: -74.006, icon: "🗽",
    tagline: "分区差异极大,跨区通勤要单独算",
    popularityScore: 95, isHot: true, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [40.55, 40.9, -74.25, -73.7],
  },
  {
    id: "vancouver", countryId: "ca", nameCn: "温哥华", nameEn: "Vancouver",
    lat: 49.2827, lng: -123.1207, icon: "🌲",
    tagline: "城市与雪山海湾紧邻,适合自驾",
    popularityScore: 82, isHot: false, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [49.15, 49.45, -123.3, -122.9],
  },

  /* ============================================================
   * 国外 · 大洋洲(3)
   * ============================================================ */
  {
    id: "sydney", countryId: "au", nameCn: "悉尼", nameEn: "Sydney",
    lat: -33.8688, lng: 151.2093, icon: "🌉",
    tagline: "海港、歌剧院与海滩,澳洲最经典的第一站",
    popularityScore: 96, isHot: true, popularitySource: SOURCE_OVERSEAS, poiCity: true,
    bbox: [-34.1, -33.6, 150.9, 151.4],
  },
  {
    id: "melbourne", countryId: "au", nameCn: "墨尔本", nameEn: "Melbourne",
    lat: -37.8136, lng: 144.9631, icon: "🎨",
    tagline: "巷弄咖啡、街头艺术与大洋路起点",
    popularityScore: 90, isHot: false, popularitySource: SOURCE_OVERSEAS, poiCity: true,
    bbox: [-38.1, -37.5, 144.5, 145.4],
  },
  {
    id: "queenstown", countryId: "nz", nameCn: "皇后镇", nameEn: "Queenstown",
    lat: -45.0312, lng: 168.6626, icon: "🏔",
    tagline: "南阿尔卑斯脚下的户外基地",
    popularityScore: 80, isHot: false, popularitySource: SOURCE_OVERSEAS, poiCity: false,
    bbox: [-45.2, -44.8, 168.4, 168.9],
  },

  /* ============================================================
   * 国内(12)—— 按省份 / 直辖市分类
   * ============================================================ */
  {
    id: "chengdu", countryId: "cn", nameCn: "成都", nameEn: "Chengdu",
    lat: 30.5728, lng: 104.0668, icon: "🐼",
    tagline: "熊猫、火锅与慢生活的川西门户",
    popularityScore: 95, isHot: true, popularitySource: SOURCE_DOMESTIC, poiCity: true,
    province: "四川省",
    bbox: [30.3, 30.95, 103.6, 104.5],
  },
  {
    id: "beijing", countryId: "cn", nameCn: "北京", nameEn: "Beijing",
    lat: 39.9042, lng: 116.4074, icon: "🏯",
    tagline: "中轴线、长城与胡同",
    popularityScore: 94, isHot: true, popularitySource: SOURCE_DOMESTIC, poiCity: false,
    province: "北京市",
    bbox: [39.7, 40.2, 116.1, 116.7],
  },
  {
    id: "shanghai", countryId: "cn", nameCn: "上海", nameEn: "Shanghai",
    lat: 31.2304, lng: 121.4737, icon: "🌃",
    tagline: "外滩、梧桐区与美术馆",
    popularityScore: 93, isHot: true, popularitySource: SOURCE_DOMESTIC, poiCity: false,
    province: "上海市",
    bbox: [31.0, 31.4, 121.3, 121.7],
  },
  {
    id: "xian", countryId: "cn", nameCn: "西安", nameEn: "Xi'an",
    lat: 34.3416, lng: 108.9398, icon: "🏯",
    tagline: "城墙、碑林与兵马俑",
    popularityScore: 92, isHot: true, popularitySource: SOURCE_DOMESTIC, poiCity: false,
    province: "陕西省",
    bbox: [34.1, 34.6, 108.7, 109.2],
  },
  {
    id: "chongqing", countryId: "cn", nameCn: "重庆", nameEn: "Chongqing",
    lat: 29.563, lng: 106.5516, icon: "🌃",
    tagline: "山城夜景与江湖菜",
    popularityScore: 91, isHot: true, popularitySource: SOURCE_DOMESTIC, poiCity: false,
    province: "重庆市",
    bbox: [29.3, 29.9, 106.2, 107.0],
  },
  {
    id: "hangzhou", countryId: "cn", nameCn: "杭州", nameEn: "Hangzhou",
    lat: 30.2741, lng: 120.1551, icon: "⛵",
    tagline: "西湖、茶园与宋韵街区",
    popularityScore: 90, isHot: false, popularitySource: SOURCE_DOMESTIC, poiCity: false,
    province: "浙江省",
    bbox: [30.1, 30.5, 119.9, 120.4],
  },
  {
    id: "xiamen", countryId: "cn", nameCn: "厦门", nameEn: "Xiamen",
    lat: 24.4798, lng: 118.0894, icon: "🌊",
    tagline: "海岛、老别墅与环岛路",
    popularityScore: 87, isHot: false, popularitySource: SOURCE_DOMESTIC, poiCity: false,
    province: "福建省",
    bbox: [24.3, 24.7, 117.9, 118.4],
  },
  {
    id: "sanya", countryId: "cn", nameCn: "三亚", nameEn: "Sanya",
    lat: 18.2528, lng: 109.5119, icon: "🏖",
    tagline: "热带海滨度假,适合放空",
    popularityScore: 86, isHot: false, popularitySource: SOURCE_DOMESTIC, poiCity: false,
    province: "海南省",
    bbox: [18.1, 18.5, 109.3, 109.8],
  },
  {
    id: "guangzhou", countryId: "cn", nameCn: "广州", nameEn: "Guangzhou",
    lat: 23.1291, lng: 113.2644, icon: "🥟",
    tagline: "早茶、骑楼与珠江夜游",
    popularityScore: 85, isHot: false, popularitySource: SOURCE_DOMESTIC, poiCity: false,
    province: "广东省",
    bbox: [22.9, 23.4, 113.1, 113.5],
  },
  {
    id: "qingdao", countryId: "cn", nameCn: "青岛", nameEn: "Qingdao",
    lat: 36.0671, lng: 120.3826, icon: "🍺",
    tagline: "德式老城、海岸线与啤酒",
    popularityScore: 83, isHot: false, popularitySource: SOURCE_DOMESTIC, poiCity: false,
    province: "山东省",
    bbox: [35.9, 36.3, 120.2, 120.6],
  },
  {
    id: "tianjin", countryId: "cn", nameCn: "天津", nameEn: "Tianjin",
    lat: 39.3434, lng: 117.3616, icon: "🎡",
    tagline: "洋楼、相声与海河夜景",
    popularityScore: 80, isHot: false, popularitySource: SOURCE_DOMESTIC, poiCity: false,
    province: "天津市",
    bbox: [39.1, 39.5, 117.1, 117.6],
  },
  {
    id: "lijiang", countryId: "cn", nameCn: "丽江", nameEn: "Lijiang",
    lat: 26.8721, lng: 100.2299, icon: "🏔",
    tagline: "古城、雪山与纳西文化",
    popularityScore: 78, isHot: false, popularitySource: SOURCE_DOMESTIC, poiCity: false,
    province: "云南省",
    bbox: [26.6, 27.2, 100.0, 100.5],
  },
];

export function cityById(id: string): CitySeed | undefined {
  return CITY_SEEDS.find((c) => c.id === id);
}

export function countryById(id: string): CountrySeed | undefined {
  return COUNTRY_SEEDS.find((c) => c.id === id);
}

/** 各 scope 下按洲 / 省份分组(选择器弹窗数据源) */
export function groupCitiesByDivision(scope: "domestic" | "overseas") {
  const countries = new Map(COUNTRY_SEEDS.map((c) => [c.id, c]));
  const groups = new Map<string, CitySeed[]>();

  for (const city of CITY_SEEDS) {
    const country = countries.get(city.countryId);
    if (!country || country.scope !== scope) continue;
    const key = scope === "overseas" ? (country.continent ?? "其他") : (city.province ?? "其他");
    const list = groups.get(key) ?? [];
    list.push(city);
    groups.set(key, list);
  }

  for (const [, list] of groups) list.sort((a, b) => b.popularityScore - a.popularityScore);

  const keys =
    scope === "overseas"
      ? CONTINENT_ORDER.filter((c) => groups.has(c))
      : [...groups.keys()].sort((a, b) => {
          const maxA = Math.max(...(groups.get(a) ?? []).map((c) => c.popularityScore));
          const maxB = Math.max(...(groups.get(b) ?? []).map((c) => c.popularityScore));
          return maxB - maxA;
        });

  return keys.map((key) => ({ key, cities: groups.get(key) ?? [] }));
}
