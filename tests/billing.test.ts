import { describe, expect, it } from 'vitest';

import { creditToDays, divNearest, unusedCredit, upgradePayable } from '../src/modules/payments/billing';

describe('subscription credit math', () => {
  it('rounds half up and keeps 57.34 on 57', () => {
    expect(divNearest(5785, 100)).toBe(58);
    expect(divNearest(5734, 100)).toBe(57);
    expect(divNearest(5750, 100)).toBe(58);
  });

  it('converts ₹249 to ₹99 after 8 days of a 31-day period into 58 days', () => {
    const credit = unusedCredit(24900, 31, 8);
    expect(credit.consumedPaise).toBe(6426);
    expect(credit.unusedPaise).toBe(18474);
    const days = creditToDays(credit.unusedPaise, 9900, 31);
    expect(days.extraDays).toBe(58);
    expect(days.roundingAdjustmentPaise).not.toBe(0);
    expect(days.grantedPaise - credit.unusedPaise).toBe(days.roundingAdjustmentPaise);
  });

  it('charges only the difference when upgrading ₹99 to ₹249 after 8 days', () => {
    const credit = unusedCredit(9900, 31, 8);
    expect(credit.consumedPaise).toBe(2555);
    expect(credit.unusedPaise).toBe(7345);
    const priced = upgradePayable(credit.unusedPaise, 24900, 0);
    expect(priced.creditPaise).toBe(7345);
    expect(priced.payablePaise).toBe(17555);
    expect(priced.gatewayTopupPaise).toBe(0);
  });

  it('does not charge when credit covers the target price', () => {
    const priced = upgradePayable(24900, 9900, 0);
    expect(priced.payablePaise).toBe(0);
    expect(priced.creditPaise).toBe(9900);
    expect(priced.leftoverPaise).toBe(15000);
  });

  it('rejects a zero-price target by granting no days', () => {
    expect(creditToDays(18474, 0, 31).extraDays).toBe(0);
  });
});
