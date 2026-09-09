// 合成「人气」分。
//
// ⚠️ ADR-004 未决。HotPepper 不返回 rating / userRatingCount。
// 打分公式里「人气」占 0.20，需要一个 0..1 的信号。这里用 HotPepper 自带字段合成：
//   - 有多张照片（pc.l / pc.m / pc.s 齐全）：店家投入线上运营
//   - 有套餐（course）
//   - 有优惠券（coupon）
//   - 有包间且写了详情：信息完整度
// 都是「店家营销投入」的代理量，不是真实口碑。ADR-004 拍板后（接 Google Places /
// 用自建「喜欢」比例）这里整体替换。
//
// 不显示为「评分」。前端把它标成「人气分」。

import type { RawShop } from "./hotpepper.ts";

export function synthPopularity(shop: RawShop): number {
  let s = 0.35; // 基线
  const photo = shop.photo?.pc;
  if (photo?.l) s += 0.12;
  if (photo?.l && photo?.m && photo?.s) s += 0.06;
  if (shop.course === "あり") s += 0.14;
  if ((shop.coupon_urls?.pc ?? "").length > 0) s += 0.1;
  if ((shop.catch ?? "").length > 8) s += 0.08;
  const room = (shop.private_room ?? "");
  if (room.startsWith("あり") && room.length > 6) s += 0.09;
  if ((shop.budget?.average ?? "").length > 0) s += 0.04;
  return Math.max(0, Math.min(1, s));
}
