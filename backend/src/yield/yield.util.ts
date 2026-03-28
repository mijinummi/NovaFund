export type InvestorBalance = bigint | number | string;
export type InvestorBalances = Record<string, InvestorBalance> | Array<{ investor: string; balance: InvestorBalance }>;
export type YieldDistribution = Record<string, bigint>;

const MAX_FIXED_DECIMALS = 18n;

interface FixedValue {
  amount: bigint;
  scale: bigint;
}

function trimTrailingZeros(value: string): string {
  return value.replace(/0+$/, '');
}

function parseAmount(value: InvestorBalance): FixedValue {
  if (typeof value === 'bigint') {
    return { amount: value, scale: 1n };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Invalid numeric amount');
    }

    if (Number.isInteger(value)) {
      return { amount: BigInt(value), scale: 1n };
    }

    return parseDecimalString(value.toString());
  }

  if (typeof value === 'string') {
    return parseDecimalString(value.trim());
  }

  throw new Error('Unsupported amount type');
}

function parseDecimalString(value: string): FixedValue {
  if (value.length === 0) {
    throw new Error('Amount string cannot be empty');
  }

  const normalized = value.trim();
  if (normalized === '-') {
    throw new Error('Invalid amount string');
  }

  const match = normalized.match(/^(-?\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Unsupported amount string: ${value}`);
  }

  const [, integerPart, rawFractionPart = ''] = match;
  const truncatedFraction = rawFractionPart.slice(0, Number(MAX_FIXED_DECIMALS));
  const fraction = truncatedFraction === '' ? '' : trimTrailingZeros(truncatedFraction);
  const scale = fraction.length === 0 ? 1n : 10n ** BigInt(fraction.length);
  const amount = BigInt(integerPart + fraction);

  return { amount, scale };
}

function alignFixedValue(value: FixedValue, targetScale: bigint): bigint {
  if (value.scale === targetScale) {
    return value.amount;
  }

  if (value.scale < targetScale) {
    return value.amount * 10n ** (targetScale - value.scale);
  }

  return value.amount / 10n ** (value.scale - targetScale);
}

function normalizeInvestorBalances(investorBalances: InvestorBalances): Array<[string, FixedValue]> {
  if (Array.isArray(investorBalances)) {
    return investorBalances.map(({ investor, balance }) => [investor, parseAmount(balance)]);
  }

  return Object.entries(investorBalances).map(([investor, balance]) => [investor, parseAmount(balance)]);
}

const calculate_pro_rata_yield = (
  totalYield: InvestorBalance,
  investorBalances: InvestorBalances,
): YieldDistribution => {
  const parsedYield = parseAmount(totalYield);
  const normalizedBalances = normalizeInvestorBalances(investorBalances);

  if (normalizedBalances.length === 0) {
    return {};
  }

  const highestBalanceScale = normalizedBalances.reduce(
    (maxScale, [, value]) => (value.scale > maxScale ? value.scale : maxScale),
    1n,
  );
  const commonScale = parsedYield.scale > highestBalanceScale ? parsedYield.scale : highestBalanceScale;

  const scaledBalances = normalizedBalances.map(([investor, balance]) => [investor, alignFixedValue(balance, commonScale)] as const);
  const totalBalance = scaledBalances.reduce((sum, [, amount]) => sum + amount, 0n);

  if (totalBalance === 0n) {
    return Object.fromEntries(scaledBalances.map(([investor]) => [investor, 0n]));
  }

  const scaledYield = alignFixedValue(parsedYield, commonScale);
  const distributed: Array<[string, bigint]> = [];
  let distributedSum = 0n;

  for (const [investor, balance] of scaledBalances) {
    const share = (balance * scaledYield) / totalBalance;
    distributed.push([investor, share]);
    distributedSum += share;
  }

  let remainder = scaledYield - distributedSum;
  if (remainder > 0n) {
    const lastIndex = distributed.length - 1;
    const [lastInvestor, lastShare] = distributed[lastIndex];
    distributed[lastIndex] = [lastInvestor, lastShare + remainder];
    remainder = 0n;
  }

  const outputScaleDiff = commonScale - parsedYield.scale;
  const result: YieldDistribution = {};

  for (const [investor, amount] of distributed) {
    result[investor] = outputScaleDiff === 0n ? amount : amount / 10n ** outputScaleDiff;
  }

  return result;
};

export { calculate_pro_rata_yield };
