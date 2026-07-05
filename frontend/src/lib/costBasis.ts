/**
 * Local cost-basis tracking so the UI can show "earned so far".
 *
 * The vaults don't expose per-user deposit history on-chain, so we track a
 * simple cost basis in localStorage: deposits add to the basis, withdrawals
 * reduce it pro-rata against the position value at withdrawal time.
 * Earned = current position value - basis. Best-effort only (cleared if the
 * user clears storage or uses another browser), so callers should treat a
 * missing basis as "unknown" rather than zero.
 */

function storageKey(scope: string, account: string): string {
  return `yieldvault:basis:${scope}:${account.toLowerCase()}`;
}

export function getCostBasis(scope: string, account: string): bigint | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(scope, account));
    return raw === null ? null : BigInt(raw);
  } catch {
    return null;
  }
}

function setCostBasis(scope: string, account: string, value: bigint): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      storageKey(scope, account),
      (value < 0n ? 0n : value).toString()
    );
  } catch {
    // storage unavailable — earned display simply degrades to "unknown"
  }
}

export function addToCostBasis(
  scope: string,
  account: string,
  depositedAssets: bigint
): void {
  const current = getCostBasis(scope, account) ?? 0n;
  setCostBasis(scope, account, current + depositedAssets);
}

/**
 * Reduce the basis pro-rata: withdrawing X out of a position worth Y removes
 * basis * X / Y. Withdrawing everything clears the basis.
 */
export function reduceCostBasis(
  scope: string,
  account: string,
  withdrawnAssets: bigint,
  positionAssetsBefore: bigint
): void {
  const current = getCostBasis(scope, account);
  if (current === null) return;
  if (positionAssetsBefore <= 0n || withdrawnAssets >= positionAssetsBefore) {
    setCostBasis(scope, account, 0n);
    return;
  }
  const reduction = (current * withdrawnAssets) / positionAssetsBefore;
  setCostBasis(scope, account, current - reduction);
}

/** Earned = position value - basis (null when basis unknown). */
export function computeEarned(
  scope: string,
  account: string,
  positionAssets: bigint
): bigint | null {
  const basis = getCostBasis(scope, account);
  if (basis === null) return null;
  const earned = positionAssets - basis;
  return earned < 0n ? 0n : earned;
}
