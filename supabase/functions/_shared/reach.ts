// 交通方式 → 可达半径 / 到达用时。
// fixed 是固定开销（候车、找车位），做成可调参数 —— 改这里不用改前端。
// 见 CLAUDE.md「交通方式 → 可达半径」。

import type { Transport } from "./contract.ts";

export interface ReachRule {
  /** m/min */
  speed: number;
  /** 固定扣减的分钟数 */
  fixed: number;
  label: string;
}

export const REACH_CONFIG: Record<Transport, ReachRule> = {
  walk: { speed: 80, fixed: 0, label: "步行 80 m/min" },
  bike: { speed: 250, fixed: 0, label: "自行车 250 m/min" },
  train: { speed: 400, fixed: 12, label: "电车 (T−12) × 400 m/min" },
  car: { speed: 300, fixed: 10, label: "驾车 (T−10) × 300 m/min" },
};

/** 可达半径（米）。maxMinutes 小于等于 fixed 时为 0。 */
export function reachRadiusM(transport: Transport, maxMinutes: number): number {
  const r = REACH_CONFIG[transport];
  return Math.max(0, maxMinutes - r.fixed) * r.speed;
}

/** 给定直线距离，估算到达用时（分钟）。 */
export function etaMinutes(transport: Transport, distanceM: number): number {
  const r = REACH_CONFIG[transport];
  return distanceM / r.speed + r.fixed;
}

/** Haversine 直线距离（米），四舍五入到整数。 */
export function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const p = Math.PI / 180;
  const dLat = (bLat - aLat) * p;
  const dLng = (bLng - aLng) * p;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * 目标半径 > 3km 时的八方位多中心点采样点。
 * 以出发点为圆心、在目标半径上按 8 个方位角取点，每点发一次 range=5（5km）。
 * 见 ADR-003。
 */
export function samplingCenters(
  lat: number,
  lng: number,
  radiusM: number,
): Array<{ lat: number; lng: number }> {
  if (radiusM <= 3000) return [{ lat, lng }];
  const centers: Array<{ lat: number; lng: number }> = [{ lat, lng }];
  const earthR = 6371000;
  for (let i = 0; i < 8; i++) {
    const brng = (i * Math.PI) / 4;
    const dr = radiusM / earthR;
    const lat1 = (lat * Math.PI) / 180;
    const lng1 = (lng * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(dr) +
        Math.cos(lat1) * Math.sin(dr) * Math.cos(brng),
    );
    const lng2 = lng1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(dr) * Math.cos(lat1),
        Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2),
      );
    centers.push({
      lat: (lat2 * 180) / Math.PI,
      lng: (lng2 * 180) / Math.PI,
    });
  }
  return centers;
}

/** HotPepper range 码：300/500/1000/2000/3000m 五档，取覆盖目标的最小档。 */
export function rangeCode(radiusM: number): 1 | 2 | 3 | 4 | 5 {
  if (radiusM <= 300) return 1;
  if (radiusM <= 500) return 2;
  if (radiusM <= 1000) return 3;
  if (radiusM <= 2000) return 4;
  return 5;
}
