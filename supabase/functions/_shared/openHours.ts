// 营业时间解析器（骨架）。
//
// HotPepper 的 `open` 字段是自由文本，形如：
//   月～木、日、祝日: 11:30～翌0:00 （料理L.O. 23:30 ドリンクL.O. 23:30）金、土: 11:30～翌3:00 （...）
// 段与段之间没有分隔符，靠下一个「曜日 token + 冒号」断句。
//
// 设计说明与降级策略见 docs/api-response.md「open 字段解析规范」。
// 本文件只依赖标准 JS，可在 Deno / Node 下直接跑。

const WEEKDAY_INDEX: Record<string, number> = {
  "月": 0, "火": 1, "水": 2, "木": 3, "金": 4, "土": 5, "日": 6,
};
const WEEKDAY_NAMES = ["月", "火", "水", "木", "金", "土", "日"];

export interface OpenSegment {
  /** 内部索引 0=月 … 6=日 */
  weekdays: number[];
  /** 该段只适用祝日 / 祝前日 —— MVP 下不参与匹配 */
  holidayOnly: boolean;
  /** 从当日 0:00 起的分钟数 */
  openMin: number;
  /** 可 > 1440（跨夜）：翌0:00 = 1440，翌3:00 = 1620 */
  closeMin: number;
  loFoodMin: number | null;
  loDrinkMin: number | null;
  closedAllDay: boolean;
  /** 原始片段文本，排错用 */
  raw: string;
}

export interface ParsedOpen {
  raw: string;
  status: "ok" | "partial" | "failed";
  segments: OpenSegment[];
  /** 解析过程中丢弃 / 存疑的片段，用于监控格式漂移 */
  notes: string[];
}

// ---------- Step 1 规范化 ----------

function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

export function normalize(raw: string): string {
  let s = toHalfWidthDigits(raw);
  s = s.replace(/：/g, ":");
  // L.O. 的各种写法先归一，再动波浪号（避免误伤 ラストオーダー 里的长音「ー」）
  s = s.replace(/ラストオーダー|ラスト\s*オーダー/g, "L.O.");
  s = s.replace(/Ｌ\s*\.?\s*Ｏ\s*\.?/gi, "L.O.");
  s = s.replace(/\bLO\b/g, "L.O.");
  s = s.replace(/(?:フード|食事)\s*L\.O\.?/g, "料理L.O.");
  // 波浪号变体统一为 ～（不含片假名长音「ー」）
  s = s.replace(/[〜~－–—]/g, "～");
  s = s.replace(/[（(]/g, "（").replace(/[）)]/g, "）");
  s = s.replace(/[ \t　]+/g, " ").trim();
  return s;
}

// ---------- Step 4 时间 ----------

const TIME_RE = /(翌)?\s*(\d{1,2}):(\d{2})/;

function timeToMin(raw: string): number | null {
  const m = TIME_RE.exec(raw);
  if (!m) return null;
  const next = m[1] ? 1440 : 0;
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (h > 47 || min > 59) return null;
  return next + h * 60 + min;
}

function fmtMin(min: number): string {
  const wrapped = min % 1440;
  const h = Math.floor(wrapped / 60);
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${String(h).padStart(2, "0")}:${mm}`;
}

/** "17:00–23:30" 形式；跨夜终点用 24h+ 折回并标 "翌" */
export function rangeLabel(openMin: number, closeMin: number): string {
  const end = closeMin >= 1440 ? `翌${fmtMin(closeMin)}` : fmtMin(closeMin);
  return `${fmtMin(openMin)}–${end}`;
}

// ---------- Step 3 曜日展开 ----------

interface DayGroup {
  weekdays: number[];
  holidayOnly: boolean;
  notes: string[];
}

function expandDayGroup(group: string): DayGroup {
  const notes: string[] = [];
  const weekdays = new Set<number>();
  let sawWeekday = false;
  let sawHoliday = false;

  for (const part of group.split("、")) {
    const token = part.trim();
    if (!token) continue;
    if (token.includes("祝")) {
      sawHoliday = true;
      // 祝日 / 祝前日：MVP 阶段不展开
      continue;
    }
    if (token.includes("～")) {
      const [a, b] = token.split("～").map((x) => x.trim());
      const ia = WEEKDAY_INDEX[a];
      const ib = WEEKDAY_INDEX[b];
      if (ia == null || ib == null) {
        notes.push(`无法识别的曜日范围: ${token}`);
        continue;
      }
      sawWeekday = true;
      let i = ia;
      // 环形展开，容忍 土～月 这种跨周
      for (let n = 0; n < 7; n++) {
        weekdays.add(i);
        if (i === ib) break;
        i = (i + 1) % 7;
      }
    } else {
      const idx = WEEKDAY_INDEX[token];
      if (idx == null) {
        notes.push(`无法识别的曜日: ${token}`);
        continue;
      }
      sawWeekday = true;
      weekdays.add(idx);
    }
  }

  return {
    weekdays: [...weekdays].sort((a, b) => a - b),
    holidayOnly: sawHoliday && !sawWeekday,
    notes,
  };
}

// ---------- Step 5 L.O. ----------

/** 取所有括号里最晚的一个 L.O.（段内多时段时，晚市的 L.O. 才是「今晚能不能赶上」的依据）。 */
function latest(re: RegExp, text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(re)) {
    const v = timeToMin(m[1]);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

function extractLastOrders(
  content: string,
): { food: number | null; drink: number | null } {
  // 全部括号内容拼一起（段内可能有多组括号）
  const inside = [...content.matchAll(/（([^）]*)）/g)].map((m) => m[1]).join(" ");
  if (!inside) return { food: null, drink: null };
  const food = latest(/料理\s*L\.O\.?\s*((?:翌)?\s*\d{1,2}:\d{2})/g, inside);
  const drink = latest(/ドリンク\s*L\.O\.?\s*((?:翌)?\s*\d{1,2}:\d{2})/g, inside);
  const bare = latest(/L\.O\.?\s*((?:翌)?\s*\d{1,2}:\d{2})/g, inside);
  return {
    food: food ?? (drink == null ? bare : null),
    drink,
  };
}

// ---------- Step 2 分段 + 组装 ----------

const ANCHOR_RE =
  /([月火水木金土日祝前]+(?:[～、]\s*[月火水木金土日祝前]+)*)\s*:/g;

const RANGE_RE =
  /((?:翌)?\s*\d{1,2}:\d{2})\s*～\s*((?:翌)?\s*\d{1,2}:\d{2})/g;

const CLOSED_RE = /定休|休業|クローズ|お休み|営業なし/;
const ALLDAY_RE = /24\s*時間|終日/;

export function parseOpen(raw: string | null | undefined): ParsedOpen {
  const rawStr = (raw ?? "").toString();
  const result: ParsedOpen = {
    raw: rawStr,
    status: "failed",
    segments: [],
    notes: [],
  };
  if (!rawStr.trim()) {
    result.notes.push("open 字段为空");
    return result;
  }

  const text = normalize(rawStr);
  ANCHOR_RE.lastIndex = 0;

  // 全周 24 时间营业（无曜日分段时）
  if (ALLDAY_RE.test(text) && !/[月火水木金土日祝前]+\s*:/.test(text)) {
    result.segments.push({
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      holidayOnly: false,
      openMin: 0,
      closeMin: 1440,
      loFoodMin: null,
      loDrinkMin: null,
      closedAllDay: false,
      raw: text,
    });
    result.status = "ok";
    return result;
  }

  // 找到所有「曜日组:」锚点
  ANCHOR_RE.lastIndex = 0;
  const anchors: Array<{ group: string; contentStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = ANCHOR_RE.exec(text)) !== null) {
    anchors.push({ group: m[1], contentStart: m.index + m[0].length });
  }

  // problems = 影响可信度的问题（未识别曜日 / 无法解析的片段）；
  // notes = 纯信息（多时段已合并等），不降级 status
  const problems: string[] = [];

  if (anchors.length === 0) {
    // 没有曜日锚点：试试整串就是一个时段（例 "11:00～23:00（L.O.22:30）"）
    const seg = buildSegment("月～日", text, result.notes, problems);
    if (seg) result.segments.push(seg);
    else problems.push("无曜日锚点且无法解析为单一时段");
  } else {
    for (let i = 0; i < anchors.length; i++) {
      const content = sliceContent(text, anchors[i].contentStart);
      const seg = buildSegment(
        anchors[i].group,
        content,
        result.notes,
        problems,
      );
      if (seg) result.segments.push(seg);
    }
  }

  result.notes.push(...problems);
  if (result.segments.length === 0) result.status = "failed";
  else if (problems.length > 0) result.status = "partial";
  else result.status = "ok";
  return result;
}

/** 从 start 切到下一个「曜日组:」锚点为止（没有下一个则切到结尾）。 */
function sliceContent(text: string, start: number): string {
  ANCHOR_RE.lastIndex = start;
  const m = ANCHOR_RE.exec(text);
  ANCHOR_RE.lastIndex = 0;
  if (m && m.index >= start) return text.slice(start, m.index);
  return text.slice(start);
}

function buildSegment(
  group: string,
  content: string,
  notes: string[],
  problems: string[],
): OpenSegment | null {
  const dg = expandDayGroup(group);
  problems.push(...dg.notes);

  // 定休 / 休业 且没有时间 → 该组当天闭店
  RANGE_RE.lastIndex = 0;
  const ranges: Array<[number, number]> = [];
  let rm: RegExpExecArray | null;
  while ((rm = RANGE_RE.exec(content)) !== null) {
    const openMin = timeToMin(rm[1]);
    let closeMin = timeToMin(rm[2]);
    if (openMin == null || closeMin == null) continue;
    // 无「翌」前缀但终点 <= 起点 → 跨夜，+24h
    if (closeMin <= openMin && !/翌/.test(rm[2])) closeMin += 1440;
    ranges.push([openMin, closeMin]);
  }
  RANGE_RE.lastIndex = 0;

  if (ranges.length === 0) {
    if (CLOSED_RE.test(content)) {
      return {
        weekdays: dg.weekdays,
        holidayOnly: dg.holidayOnly,
        openMin: 0,
        closeMin: 0,
        loFoodMin: null,
        loDrinkMin: null,
        closedAllDay: true,
        raw: content.trim(),
      };
    }
    problems.push(`片段无可解析时段: ${content.trim().slice(0, 40)}`);
    return null;
  }

  const lo = extractLastOrders(content);
  // 段内多区间：取最早开门、最晚闭店的包络（午市+晚市合并成当天营业窗口）。
  // 打分只关心「能不能在 L.O. 前赶到」，包络足够；精确到分区间是 v1.1 的事。
  if (ranges.length > 1) {
    notes.push(`段内多时段已合并为包络: ${content.trim().slice(0, 40)}`);
  }
  const openMin = Math.min(...ranges.map((r) => r[0]));
  const closeMin = Math.max(...ranges.map((r) => r[1]));

  return {
    weekdays: dg.weekdays,
    holidayOnly: dg.holidayOnly,
    openMin,
    closeMin,
    loFoodMin: lo.food ?? (lo.drink == null ? null : lo.drink),
    loDrinkMin: lo.drink,
    closedAllDay: false,
    raw: content.trim(),
  };
}

// ---------- close（定休日）----------

export interface ParsedClose {
  raw: string;
  /** 明确的每周定休（内部索引 0=月）。只在「无条件、每周」时填。 */
  closedWeekdays: number[];
  /** 不定休 / 隔週 / 第N週：无法据此硬过滤，UI 提示即可 */
  irregular: boolean;
}

const IRREGULAR_RE = /不定休|隔週|隔周|第[0-9０-９一二三四五]/;

/**
 * "月曜日"          → { closedWeekdays:[0] }
 * "日曜・祝日"       → { closedWeekdays:[6] }
 * "水曜不定休"       → { closedWeekdays:[], irregular:true }
 * "なし" / "年末年始" → { closedWeekdays:[] }
 */
export function parseClose(raw: string | null | undefined): ParsedClose {
  const rawStr = (raw ?? "").toString();
  const full = normalize(rawStr);
  // 括号里通常是例外说明（「祝日の場合は営業」等），不参与硬过滤
  const head = full.split(/[（(]/)[0];
  const irregular = IRREGULAR_RE.test(full);
  // 说明性词汇出现时保守处理：只提示，不硬过滤
  const explanatory = /営業|除く|のぞく|以外|場合|により|不定/.test(head);
  if (irregular || explanatory) {
    return { raw: rawStr, closedWeekdays: [], irregular: true };
  }
  const days = new Set<number>();
  for (const m of head.matchAll(/([月火水木金土日])\s*曜/g)) {
    days.add(WEEKDAY_INDEX[m[1]]);
  }
  return {
    raw: rawStr,
    closedWeekdays: [...days].sort((a, b) => a - b),
    irregular: false,
  };
}

// ---------- 查询 ----------

export interface OpenEvaluation {
  /** true=营业中；false=当天有排班但该时刻不营业；"unknown"=无排班可判断（降级） */
  openAtTarget: boolean | "unknown";
  /** 建议最晚到店时刻（料理 L.O. − 余量），分钟；无法判断为 null */
  lastArrivalMin: number | null;
  lastOrderMin: number | null;
  closeMin: number | null;
  todayLabel: string | null;
}

/** JS Date.getDay() 是 0=周日，转成内部 0=月 */
function internalWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * @param parsed    parseOpen 的结果
 * @param date      就餐日期
 * @param timeMin   就餐时刻（分钟，从 0:00 起）
 * @param loMargin  L.O. 提前余量（分钟），服务端可调，默认 60
 */
export function evaluateOpen(
  parsed: ParsedOpen,
  date: Date,
  timeMin: number,
  loMargin = 60,
): OpenEvaluation {
  const wd = internalWeekday(date);
  const todays = parsed.segments.filter(
    (s) => !s.holidayOnly && s.weekdays.includes(wd),
  );

  if (todays.length === 0) {
    return {
      openAtTarget: "unknown",
      lastArrivalMin: null,
      lastOrderMin: null,
      closeMin: null,
      todayLabel: null,
    };
  }

  if (todays.every((s) => s.closedAllDay)) {
    return {
      openAtTarget: false,
      lastArrivalMin: null,
      lastOrderMin: null,
      closeMin: null,
      todayLabel: "定休日",
    };
  }

  let best: OpenEvaluation | null = null;
  for (const s of todays) {
    if (s.closedAllDay) continue;
    // 凌晨到店归入前一天的跨夜段
    const candidates = [timeMin];
    if (s.closeMin > 1440) candidates.push(timeMin + 1440);

    const lo = s.loFoodMin ?? s.closeMin;
    const lastArrival = lo - loMargin;
    let openAt: boolean | "unknown" = false;
    for (const t of candidates) {
      if (t >= s.openMin && t <= s.closeMin) openAt = true;
    }
    const evalSeg: OpenEvaluation = {
      openAtTarget: openAt,
      lastArrivalMin: lastArrival,
      lastOrderMin: lo,
      closeMin: s.closeMin,
      todayLabel: rangeLabel(s.openMin, s.closeMin),
    };
    if (
      !best ||
      (evalSeg.lastArrivalMin ?? -Infinity) > (best.lastArrivalMin ?? -Infinity)
    ) {
      best = evalSeg;
    }
    // 只要有一个段能赶上，就算 openAtTarget: true
    if (openAt) best.openAtTarget = true;
  }

  return best as OpenEvaluation;
}

export { WEEKDAY_NAMES };
