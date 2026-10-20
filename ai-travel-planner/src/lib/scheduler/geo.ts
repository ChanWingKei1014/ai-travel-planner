/**
 * 地理工具
 * 支撑需求文档 5.3.1 的硬约束:单日通勤上限、地理聚类、区域连贯性
 */

import {
  WALK_THRESHOLD_KM,
  TRANSIT_THRESHOLD_KM,
} from "@/lib/types";

export interface LatLng {
  lat: number;
  lng: number;
}

/** 球面距离(公里) */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Transfer {
  km: number;
  minutes: number;
  mode: string;
}

/**
 * 估算两点之间的通勤时间与方式。
 * 阈值:≤1.2km 步行;≤15km 公共交通;更远打车/包车。
 * 估算含等待与换乘冗余,避免"纸上很快、实际很慢"。
 */
export function estimateTransfer(a: LatLng, b: LatLng): Transfer {
  const km = haversineKm(a, b);
  // 实际道路距离通常大于直线距离,乘 1.3 的绕行系数
  const roadKm = km * 1.3;

  let minutes: number;
  let mode: string;

  if (roadKm <= WALK_THRESHOLD_KM) {
    minutes = roadKm * 12; // 约 5km/h
    mode = "步行";
  } else if (roadKm <= TRANSIT_THRESHOLD_KM) {
    minutes = 8 + roadKm * 2.0; // 8 分钟等车 + 车速
    mode = "公共交通";
  } else {
    minutes = 3 + roadKm * 1.5;
    mode = "打车";
  }

  return {
    km: Math.round(roadKm * 10) / 10,
    minutes: Math.max(5, Math.round(minutes)),
    mode,
  };
}

/** 点到点距离矩阵 */
export function distanceMatrix<T extends LatLng>(points: T[]): number[][] {
  return points.map((a) => points.map((b) => haversineKm(a, b)));
}

/**
 * 最近邻排序:从一个起点出发,每次选最近的未访问点。
 * 用于同日点位的初始访问顺序。
 */
export function nearestNeighborOrder<T extends LatLng>(points: T[], startIndex = 0): number[] {
  const n = points.length;
  if (n <= 1) return points.map((_, i) => i);

  const visited = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  let current = Math.max(0, Math.min(n - 1, startIndex));

  for (let step = 0; step < n; step++) {
    visited[current] = true;
    order.push(current);
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const d = haversineKm(points[current], points[i]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best === -1) break;
    current = best;
  }
  return order;
}

/** 路线总长(按给定顺序) */
export function routeLength<T extends LatLng>(points: T[], order: number[]): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) {
    total += haversineKm(points[order[i - 1]], points[order[i]]);
  }
  return total;
}

/**
 * 2-opt 优化:反复翻转子路径直到无法缩短。
 * 用于在最近邻结果上做局部改进,减少来回穿城(5.3.1 硬约束)。
 */
export function twoOpt<T extends LatLng>(points: T[], initial: number[], maxPasses = 20): number[] {
  const order = [...initial];
  const n = order.length;
  if (n < 4) return order;

  let improved = true;
  let passes = 0;

  while (improved && passes < maxPasses) {
    improved = false;
    passes++;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const a = points[order[i - 1]];
        const b = points[order[i]];
        const c = points[order[k]];
        const d = order[k + 1] !== undefined ? points[order[k + 1]] : undefined;

        const before = haversineKm(a, b) + (d ? haversineKm(c, d) : 0);
        const after = haversineKm(a, c) + (d ? haversineKm(b, d) : 0);
        if (after + 1e-9 < before) {
          const segment = order.slice(i, k + 1).reverse();
          order.splice(i, segment.length, ...segment);
          improved = true;
        }
      }
    }
  }
  return order;
}

/** 优化后的访问顺序:最近邻 + 2-opt */
export function optimizeOrder<T extends LatLng>(points: T[], startIndex = 0): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const nn = nearestNeighborOrder(points, startIndex);
  return twoOpt(points, nn);
}

/**
 * 按区域分组(地理聚类的第一优先级依据 —— 需求的 area 字段来自人工/AI 标注)。
 * 返回 area → 索引数组。
 */
export function groupByArea<T extends { area: string }>(points: T[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = p.area?.trim() || "其他";
    const list = map.get(key) ?? [];
    list.push(i);
    map.set(key, list);
  });
  return map;
}

/**
 * 区域质心距离:用于决定"哪两个区域适合放同一天"。
 * 返回 area → 质心坐标。
 */
export function areaCentroids<T extends LatLng & { area: string }>(
  points: T[],
): Map<string, LatLng> {
  const groups = groupByArea(points);
  const centroids = new Map<string, LatLng>();
  for (const [area, idxs] of groups) {
    const lat = idxs.reduce((s, i) => s + points[i].lat, 0) / idxs.length;
    const lng = idxs.reduce((s, i) => s + points[i].lng, 0) / idxs.length;
    centroids.set(area, { lat, lng });
  }
  return centroids;
}
