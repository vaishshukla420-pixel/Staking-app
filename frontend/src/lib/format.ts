import { formatUnits, parseUnits } from 'viem';

/** Format a raw bigint token amount for display. */
export function formatAmount(
  value: bigint | undefined,
  decimals: number,
  maxFraction = 4
): string {
  if (value === undefined) return '—';
  const s = formatUnits(value, decimals);
  const [whole, frac = ''] = s.split('.');
  const wholeFmt = BigInt(whole).toLocaleString('en-US');
  if (maxFraction === 0) return wholeFmt;
  const fracTrimmed = frac.slice(0, maxFraction).replace(/0+$/, '');
  return fracTrimmed ? `${wholeFmt}.${fracTrimmed}` : wholeFmt;
}

/** Basis points -> "x.xx%". */
export function formatBps(bps: bigint | number | undefined): string {
  if (bps === undefined) return '—';
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

/** Net APR after the performance fee (fee applies to yield only). */
export function netAprBps(
  grossBps: bigint | undefined,
  feeBps: bigint | undefined
): bigint | undefined {
  if (grossBps === undefined || feeBps === undefined) return undefined;
  const fee = feeBps > 10_000n ? 10_000n : feeBps;
  return (grossBps * (10_000n - fee)) / 10_000n;
}

/** Keep only digits and a single decimal point. */
export function sanitizeAmountInput(raw: string): string {
  let v = raw.replace(/[^0-9.]/g, '');
  const firstDot = v.indexOf('.');
  if (firstDot !== -1) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
  }
  return v;
}

/** Parse a user-entered amount; returns undefined when invalid/empty. */
export function tryParseAmount(
  raw: string,
  decimals: number
): bigint | undefined {
  const v = raw.trim();
  if (!v || v === '.') return undefined;
  try {
    const parsed = parseUnits(v, decimals);
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function shortAddress(addr: string | undefined, chars = 4): string {
  if (!addr) return '—';
  return `${addr.slice(0, chars + 2)}…${addr.slice(-chars)}`;
}
