// HotPepper グルメサーチAPI 客户端。
//
// 两种模式：
//   - 有 HOTPEPPER_API_KEY  → 真实模式，打 webservice.recruit.co.jp
//   - 无 key                → mock 模式，读 ./mock/gourmet-shops.json
//
// mock 模式让整条管道（解析 / 过滤 / 打分 / 分页）在没有 key 的情况下端到端跑起来，
// key 到位后只需设环境变量，不改代码。见 docs/contract.md。
//
// 硬约束：key 只存在于 Edge Function 环境变量，绝不进前端 / 仓库。见 ADR-005。

import { haversineM, rangeCode, samplingCenters } from "./reach.ts";

// HotPepper gourmet 响应里我们用到的字段。形状对齐 docs/api-response.md 实测。
export interface RawShop {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  genre: { code: string; name: string };
  sub_genre?: { code: string; name: string };
  budget: { code: string; name: string; average: string };
  access: string;
  mobile_access: string;
  station_name: string;
  open: string;
  close: string;
  party_capacity: number | string;
  capacity: number | string;
  private_room: string;
  non_smoking: string;
  card: string;
  course: string;
  coupon_urls?: { pc: string; sp: string };
  photo?: { pc?: { l?: string; m?: string; s?: string } };
  catch?: string;
  urls: { pc: string };
}

export interface GourmetQuery {
  lat: number;
  lng: number;
  radiusM: number;
  genres: string[];
  budgetCodes: string[];
  party: number;
}

export interface GourmetClient {
  source: "mock" | "hotpepper";
  gather(q: GourmetQuery): Promise<RawShop[]>;
}

const ENDPOINT = "https://webservice.recruit.co.jp/hotpepper/gourmet/v1/";
/** 拉够候选就停，避免无谓请求。见 docs/api-response.md 坑 #1。 */
const MAX_CANDIDATES = 400;

export function createClient(env: {
  HOTPEPPER_API_KEY?: string;
  mockShops?: RawShop[];
}): GourmetClient {
  const key = env.HOTPEPPER_API_KEY?.trim();
  if (key) return new RealClient(key);
  return new MockClient(env.mockShops ?? []);
}

class RealClient implements GourmetClient {
  source = "hotpepper" as const;
  private key: string;
  constructor(key: string) {
    this.key = key;
  }

  async gather(q: GourmetQuery): Promise<RawShop[]> {
    const centers = samplingCenters(q.lat, q.lng, q.radiusM);
    const code = rangeCode(Math.min(q.radiusM, 3000));
    const byId = new Map<string, RawShop>();

    for (const c of centers) {
      let start = 1;
      while (byId.size < MAX_CANDIDATES) {
        const url = new URL(ENDPOINT);
        url.searchParams.set("key", this.key);
        url.searchParams.set("format", "json");
        url.searchParams.set("lat", String(c.lat));
        url.searchParams.set("lng", String(c.lng));
        url.searchParams.set("range", String(code));
        url.searchParams.set("count", "100");
        url.searchParams.set("start", String(start));
        if (q.genres.length) url.searchParams.set("genre", q.genres.join(","));
        if (q.budgetCodes.length) {
          url.searchParams.set("budget", q.budgetCodes.slice(0, 2).join(","));
        }
        if (q.party > 0) url.searchParams.set("party_capacity", String(q.party));

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HotPepper ${res.status}`);
        const json = await res.json();
        const results = json?.results;
        const shops: RawShop[] = (results?.shop ?? []).map(normalizeRawShop);
        for (const s of shops) byId.set(s.id, s);

        const available = Number(results?.results_available ?? 0);
        start += 100;
        if (start > available || shops.length === 0) break;
      }
    }
    return [...byId.values()];
  }
}

class MockClient implements GourmetClient {
  source = "mock" as const;
  private shops: RawShop[];
  constructor(shops: RawShop[]) {
    this.shops = shops;
  }

  gather(q: GourmetQuery): Promise<RawShop[]> {
    // 粗略模拟 API 侧过滤：半径 + genre。
    // 预算 / 人数 / 营业时间的精细过滤都在管道里做（人数虽然真实 API 也支持，
    // 但留给管道跑，方便观察被过滤原因）。
    const out = this.shops
      .map(normalizeRawShop)
      .filter((s) => haversineM(q.lat, q.lng, s.lat, s.lng) <= q.radiusM + 200)
      .filter((s) => !q.genres.length || q.genres.includes(s.genre.code));
    return Promise.resolve(out);
  }
}

function toNum(v: number | string): number {
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 把 HotPepper 的字符串经纬度等收敛成稳定类型。 */
function normalizeRawShop(s: any): RawShop {
  return {
    ...s,
    lat: Number(s.lat),
    lng: Number(s.lng),
    party_capacity: toNum(s.party_capacity ?? 0),
    capacity: toNum(s.capacity ?? 0),
  };
}
