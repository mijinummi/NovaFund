import { calculate_pro_rata_yield } from './yield.util';

describe('calculate_pro_rata_yield', () => {
  it('distributes integer yield pro-rata', () => {
    const distribution = calculate_pro_rata_yield(100n, {
      alice: 1n,
      bob: 2n,
      carol: 3n,
    });

    expect(distribution.alice).toBe(16n);
    expect(distribution.bob).toBe(33n);
    expect(distribution.carol).toBe(51n);
    expect(distribution.alice + distribution.bob + distribution.carol).toBeLessThanOrEqual(100n);
  });

  it('returns zero yield when total investment is zero', () => {
    const distribution = calculate_pro_rata_yield(50n, {
      alice: 0n,
      bob: 0n,
    });

    expect(distribution).toEqual({ alice: 0n, bob: 0n });
  });

  it('assigns remainder to the last investor', () => {
    const distribution = calculate_pro_rata_yield(10n, {
      alice: 1n,
      bob: 2n,
      carol: 3n,
    });

    expect(distribution.alice + distribution.bob + distribution.carol).toBe(10n);
    expect(distribution.carol).toBeGreaterThan(5n);
  });

  it('supports decimal balances and fixed-point precision', () => {
    const distribution = calculate_pro_rata_yield('100.0', {
      alice: '1.5',
      bob: '0.5',
    });

    expect(distribution.alice).toBe(75n);
    expect(distribution.bob).toBe(25n);
  });

  it('handles a large number of investors efficiently', () => {
    const investors: Record<string, bigint> = {};
    for (let i = 1; i <= 1000; i += 1) {
      investors[`investor${i}`] = BigInt(i);
    }

    const totalYield = 1_000_000n;
    const distribution = calculate_pro_rata_yield(totalYield, investors);

    const sum = Object.values(distribution).reduce((acc, amount) => acc + amount, 0n);
    expect(sum).toBeLessThanOrEqual(totalYield);
    expect(Object.keys(distribution)).toHaveLength(1000);
  });
});
