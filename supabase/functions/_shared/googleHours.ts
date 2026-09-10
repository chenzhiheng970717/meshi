// Google Places `regularOpeningHours` 求值。
// periods[] 是结构化的 { open:{day,hour,minute}, close:{day,hour,minute} }，
// day 0=周日；跨夜时 close.day 是次日。没有 close = 那天 24 小时营业。
// 不用像 HotPepper 那样解析自由文本。

export interface GooglePeriodPoint {
  day: number;
  hour: number;
  minute: number;
}
export interface GooglePeriod {
  open: GooglePeriodPoint;
  close?: GooglePeriodPoint;
}
export interface GoogleOpeningHours {
  periods?: GooglePeriod[];
  weekdayDescriptions?: string[];
}

export interface HoursEval {
  /** true=营业中；false=当天有排班但该时刻不营业；"unknown"=没有营业时间数据 */
  openAtTarget: boolean | "unknown";
  /** 建议最晚到店（打烊前留的余量），分钟；无法判断为 null */
  lastArrivalMin: number | null;
  /** 当天关门时刻（分钟，可 > 1440 表示跨夜） */
  closeMin: number | null;
  /** "17:00–翌01:00" 形式 */
  todayLabel: string | null;
}

const fmt = (min: number): string => {
  const w = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(w / 60)).padStart(2, "0")}:${
    String(w % 60).padStart(2, "0")
  }`;
};

/**
 * @param hours    Google regularOpeningHours（传 currentOpeningHours 更好，含节假日）
 * @param date     就餐日期
 * @param timeMin  就餐时刻（当天 0:00 起的分钟）
 * @param margin   打烊前余量（分钟），默认 45 —— Google 没有单独的 L.O.
 */
export function evaluateGoogleHours(
  hours: GoogleOpeningHours | null | undefined,
  date: Date,
  timeMin: number,
  margin = 45,
): HoursEval {
  const periods = hours?.periods;
  if (!periods || periods.length === 0) {
    return {
      openAtTarget: "unknown",
      lastArrivalMin: null,
      closeMin: null,
      todayLabel: null,
    };
  }

  const dow = date.getDay(); // 0=周日，和 Google 一致
  const prevDow = (dow + 6) % 7;

  // 24 小时营业：某个 period open 无 close
  const allDay = periods.find((p) => !p.close);
  if (allDay && allDay.open.day === dow) {
    return {
      openAtTarget: true,
      lastArrivalMin: 1440,
      closeMin: 1440,
      todayLabel: "24 小时",
    };
  }

  let best: HoursEval | null = null;
  for (const p of periods) {
    if (!p.close) continue;
    const openAbs = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let closeAbs = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    if (closeAbs <= openAbs) closeAbs += 7 * 1440; // 跨周环绕

    // 把 period 归一化到「以 open 当天为基准的分钟」
    const openMin = p.open.hour * 60 + p.open.minute;
    const closeMin = openMin + (closeAbs - openAbs);

    // 目标时刻可能属于「今天开的档」或「昨天开、跨到今天的档」
    const cands: number[] = [];
    if (p.open.day === dow) cands.push(timeMin);
    if (p.open.day === prevDow && closeMin > 1440) cands.push(timeMin + 1440);
    if (cands.length === 0) continue;

    for (const t of cands) {
      const openAt = t >= openMin && t <= closeMin;
      const seg: HoursEval = {
        openAtTarget: openAt,
        lastArrivalMin: closeMin - margin,
        closeMin,
        todayLabel: `${fmt(openMin)}–${closeMin >= 1440 ? "翌" : ""}${
          fmt(closeMin)
        }`,
      };
      if (!best || (seg.lastArrivalMin ?? -1) > (best.lastArrivalMin ?? -1)) {
        best = seg;
      }
      if (openAt) best!.openAtTarget = true;
    }
  }

  if (!best) {
    // 有 periods 但目标那天没有 → 当天休息
    return {
      openAtTarget: false,
      lastArrivalMin: null,
      closeMin: null,
      todayLabel: "当天休息",
    };
  }
  return best;
}
