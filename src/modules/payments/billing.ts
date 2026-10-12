/** One calendar day in milliseconds. Billing uses whole days, not fractional days. */
export const DAY_MS = 86_400_000;

/**
 * Integer division rounded to the nearest whole number.
 * A remainder of exactly one half rounds away from zero (57.5 → 58, 57.50 stays the higher day).
 * 57.85 → 58. 57.34 → 57.
 */
export function divNearest(numerator: number, denominator: number) {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error('divNearest expects a positive integer denominator and an integer numerator');
  }
  const negative = numerator < 0;
  const value = Math.abs(numerator);
  const quotient = Math.floor(value / denominator);
  const remainder = value % denominator;
  const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient;
  return negative ? -rounded : rounded;
}

export function spanDays(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

/**
 * Whole days already elapsed, never more than the billing period.
 * The purchase day itself is one used day, so a same-day upgrade or downgrade
 * still consumes one day's price.
 */
export function consumedWholeDays(start: Date, now: Date, periodDays: number) {
  if (now.getTime() < start.getTime() || periodDays <= 0) return 0;
  const elapsed = Math.floor((now.getTime() - start.getTime()) / DAY_MS);
  const used = elapsed < 1 ? 1 : elapsed;
  return Math.min(periodDays, used);
}

/**
 * Unused value of a paid period, in paise.
 * Consumed value is `price × consumedDays / periodDays`, rounded to the nearest paise (half up).
 * ₹249 over 31 days with 8 days used → 6426 paise consumed, 18474 paise left.
 */
export function unusedCredit(pricePaise: number, periodDays: number, consumedDays: number) {
  if (pricePaise <= 0 || periodDays <= 0) {
    return { consumedPaise: 0, unusedPaise: 0 };
  }
  const usedDays = Math.min(periodDays, Math.max(0, consumedDays));
  const consumedPaise = divNearest(pricePaise * usedDays, periodDays);
  return { consumedPaise, unusedPaise: pricePaise - consumedPaise };
}

/**
 * Turns unused paise into whole days on the target plan (nearest day).
 * Rounding can grant slightly more or less value than the credit. That difference is returned
 * as `roundingAdjustmentPaise` (positive means the user receives a few extra paise of plan time).
 * ₹184.74 of credit on a ₹99 / 31-day plan → 58 days, and the extra value is recorded.
 */
export function creditToDays(unusedPaise: number, targetPricePaise: number, targetPeriodDays: number) {
  if (unusedPaise <= 0 || targetPricePaise <= 0 || targetPeriodDays <= 0) {
    return { extraDays: 0, grantedPaise: 0, roundingAdjustmentPaise: 0 };
  }
  const extraDays = divNearest(unusedPaise * targetPeriodDays, targetPricePaise);
  const grantedPaise = extraDays === 0 ? 0 : divNearest(extraDays * targetPricePaise, targetPeriodDays);
  return {
    extraDays,
    grantedPaise,
    roundingAdjustmentPaise: grantedPaise - unusedPaise,
  };
}

/** Payable paise for a higher-priced plan after unused credit is applied once. Razorpay's minimum is ₹1. */
export function upgradePayable(unusedPaise: number, targetPricePaise: number, couponOffPaise: number) {
  const net = Math.max(0, targetPricePaise - couponOffPaise);
  const creditPaise = Math.min(Math.max(0, unusedPaise), net);
  const rawPayable = net - creditPaise;
  const payablePaise = rawPayable > 0 && rawPayable < 100 ? 100 : rawPayable;
  return {
    creditPaise,
    payablePaise,
    leftoverPaise: Math.max(0, unusedPaise - creditPaise),
    gatewayTopupPaise: payablePaise - rawPayable,
  };
}
