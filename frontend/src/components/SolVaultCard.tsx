'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';

import {
  buildDepositInstruction,
  buildWithdrawInstruction,
  getPoolPda,
  getPositionPda,
  getSolProgramId,
  getVaultPda,
  lamportsToShares,
  parsePosition,
  parseVaultState,
  sharesToLamports,
  venueName,
} from '@/lib/solana';
import {
  formatAmount,
  formatBps,
  netAprBps,
  sanitizeAmountInput,
  tryParseAmount,
} from '@/lib/format';
import { IDLE_TX, TxStatus, txErrorMessage, type TxState } from './TxStatus';

const SOL_DECIMALS = 9;
const POLL_MS = 10_000;
/** Rent + fee headroom kept back when maxing a SOL deposit. */
const SOL_FEE_BUFFER = 10_000_000n; // 0.01 SOL

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div
        className={`mt-0.5 font-mono text-sm font-semibold ${
          accent ? 'text-positive' : 'text-slate-100'
        }`}
      >
        {value}
      </div>
      {sub ? <div className="text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}

export function SolVaultCard() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const programId = useMemo(() => getSolProgramId(), []);
  const deployed = programId !== null;

  // -------------------------------------------------------------------------
  // Reads (react-query polling; all failures degrade to placeholder UI)
  // -------------------------------------------------------------------------

  const vaultQuery = useQuery({
    queryKey: ['sol-vault', programId?.toBase58()],
    enabled: deployed,
    refetchInterval: POLL_MS,
    queryFn: async () => {
      const vaultPda = getVaultPda(programId!);
      const poolPda = getPoolPda(programId!);
      const [vaultInfo, poolBalance, rentReserve] = await Promise.all([
        connection.getAccountInfo(vaultPda),
        connection.getBalance(poolPda),
        // the program excludes the pool PDA's rent-exempt reserve from
        // total_assets, so share pricing here must too
        connection.getMinimumBalanceForRentExemption(0),
      ]);
      const investable = BigInt(poolBalance) - BigInt(rentReserve);
      return {
        state: vaultInfo ? parseVaultState(vaultInfo.data) : null,
        poolLamports: investable > 0n ? investable : 0n,
      };
    },
  });

  const userQuery = useQuery({
    queryKey: [
      'sol-user',
      programId?.toBase58(),
      publicKey?.toBase58(),
    ],
    enabled: deployed && !!publicKey,
    refetchInterval: POLL_MS,
    queryFn: async () => {
      const positionPda = getPositionPda(programId!, publicKey!);
      const [positionInfo, walletLamports] = await Promise.all([
        connection.getAccountInfo(positionPda),
        connection.getBalance(publicKey!),
      ]);
      return {
        position: positionInfo ? parsePosition(positionInfo.data) : null,
        walletLamports: BigInt(walletLamports),
      };
    },
  });

  const state = vaultQuery.data?.state ?? null;
  const poolLamports = vaultQuery.data?.poolLamports;
  const position = userQuery.data?.position ?? null;
  const walletLamports = userQuery.data?.walletLamports;
  const rpcUnreachable = deployed && vaultQuery.isError;

  const positionLamports =
    position && state && poolLamports !== undefined
      ? sharesToLamports(position.shares, state.totalShares, poolLamports)
      : undefined;

  const earned =
    position && position.depositedLamports !== null && positionLamports !== undefined
      ? positionLamports > position.depositedLamports
        ? positionLamports - position.depositedLamports
        : 0n
      : null;

  const grossAprBps = state ? BigInt(state.reportedAprBps) : undefined;
  const feeBps = state ? BigInt(state.performanceFeeBps) : undefined;
  const netApr = netAprBps(grossAprBps, feeBps);

  // -------------------------------------------------------------------------
  // Local state & actions
  // -------------------------------------------------------------------------

  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amountInput, setAmountInput] = useState('');
  const [tx, setTx] = useState<TxState>(IDLE_TX);
  const [busy, setBusy] = useState(false);

  const amount = tryParseAmount(amountInput, SOL_DECIMALS);

  let inputError: string | null = null;
  if (amountInput && amount === undefined) {
    inputError = 'Invalid amount';
  } else if (amount !== undefined && amount === 0n) {
    inputError = 'Amount must be greater than zero';
  } else if (mode === 'deposit' && amount !== undefined) {
    if (walletLamports !== undefined && amount > walletLamports) {
      inputError = 'Insufficient SOL balance';
    }
  } else if (mode === 'withdraw' && amount !== undefined) {
    if (positionLamports !== undefined && amount > positionLamports) {
      inputError = 'Exceeds your position';
    }
  }

  const actionDisabled =
    busy ||
    !deployed ||
    !publicKey ||
    amount === undefined ||
    amount === 0n ||
    inputError !== null;

  async function sendAndConfirm(txn: Transaction): Promise<string> {
    const latest = await connection.getLatestBlockhash('confirmed');
    const signature = await sendTransaction(txn, connection);
    setTx({ phase: 'confirming', message: 'Waiting for confirmation…', hash: signature });
    const result = await connection.confirmTransaction(
      { signature, ...latest },
      'confirmed'
    );
    if (result.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
    }
    return signature;
  }

  async function handleDeposit() {
    if (!publicKey || !programId || amount === undefined || amount === 0n)
      return;
    setBusy(true);
    try {
      setTx({ phase: 'signing', message: 'Confirm SOL deposit in wallet' });
      const txn = new Transaction().add(
        buildDepositInstruction(programId, publicKey, amount)
      );
      await sendAndConfirm(txn);
      setTx({
        phase: 'success',
        message: `Deposited ${formatAmount(amount, SOL_DECIMALS)} SOL`,
      });
      setAmountInput('');
      await Promise.allSettled([vaultQuery.refetch(), userQuery.refetch()]);
    } catch (err) {
      setTx({ phase: 'error', message: txErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (
      !publicKey ||
      !programId ||
      amount === undefined ||
      amount === 0n ||
      !state ||
      poolLamports === undefined ||
      !position
    )
      return;
    setBusy(true);
    try {
      // The withdraw instruction takes shares; convert the SOL amount at the
      // current share price. A full withdrawal uses the exact share balance
      // so no dust is left behind by rounding.
      const shares =
        positionLamports !== undefined && amount >= positionLamports
          ? position.shares
          : lamportsToShares(amount, state.totalShares, poolLamports);
      setTx({ phase: 'signing', message: 'Confirm SOL withdrawal in wallet' });
      const txn = new Transaction().add(
        buildWithdrawInstruction(programId, publicKey, shares)
      );
      await sendAndConfirm(txn);
      setTx({
        phase: 'success',
        message: `Withdrew ${formatAmount(amount, SOL_DECIMALS)} SOL`,
      });
      setAmountInput('');
      await Promise.allSettled([vaultQuery.refetch(), userQuery.refetch()]);
    } catch (err) {
      setTx({ phase: 'error', message: txErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function handleMax() {
    if (mode === 'deposit') {
      if (walletLamports === undefined) return;
      const max =
        walletLamports > SOL_FEE_BUFFER ? walletLamports - SOL_FEE_BUFFER : 0n;
      setAmountInput(lamportsToInput(max));
    } else {
      if (positionLamports === undefined) return;
      setAmountInput(lamportsToInput(positionLamports));
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-500/15 text-sm font-bold text-purple-300">
            SOL
          </div>
          <div>
            <div className="text-sm font-bold text-white">
              SOL <span className="font-normal text-muted">· Native Solana</span>
            </div>
            <div className="text-[11px] text-muted">Solana</div>
          </div>
        </div>
        <span className="pill text-muted" title="Active venue">
          <span className="h-1.5 w-1.5 rounded-full bg-[#9945ff]" />
          {deployed && state ? venueName(state.currentVenue) : '—'}
        </span>
      </div>

      {!deployed ? (
        <div className="rounded-xl border border-dashed border-surface-border bg-surface-raised px-4 py-6 text-center text-xs text-muted">
          <div className="mb-1 text-sm font-semibold text-slate-300">
            Solana program not deployed yet
          </div>
          Set <code className="font-mono text-accent">NEXT_PUBLIC_SOL_PROGRAM_ID</code>{' '}
          in <code className="font-mono text-accent">.env.local</code> once{' '}
          <code className="font-mono text-accent">sol_yield_vault</code> is
          deployed to activate this card.
        </div>
      ) : (
        <>
          {rpcUnreachable ? (
            <div className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              Solana RPC unreachable — is your validator running?
            </div>
          ) : !vaultQuery.isPending && state === null ? (
            <div className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              Program configured, but the vault state account isn&apos;t
              initialized yet.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Stat
              label="Net APY"
              value={formatBps(netApr)}
              sub={
                grossAprBps !== undefined && feeBps !== undefined
                  ? `${formatBps(grossAprBps)} gross · ${formatBps(feeBps)} perf. fee`
                  : undefined
              }
              accent
            />
            <Stat
              label="TVL"
              value={`${formatAmount(poolLamports, SOL_DECIMALS, 2)} SOL`}
              sub={
                state
                  ? `${formatAmount(state.totalShares, SOL_DECIMALS, 2)} total shares`
                  : undefined
              }
            />
            <Stat
              label="Your position"
              value={
                publicKey
                  ? `${formatAmount(positionLamports ?? (position ? 0n : undefined), SOL_DECIMALS)} SOL`
                  : '—'
              }
              sub={
                publicKey && position
                  ? `${formatAmount(position.shares, SOL_DECIMALS)} shares`
                  : 'Connect wallet'
              }
            />
            <Stat
              label="Earned"
              value={
                publicKey && position
                  ? earned !== null
                    ? `+${formatAmount(earned, SOL_DECIMALS)} SOL`
                    : '—'
                  : '—'
              }
              accent={earned !== null && earned > 0n}
            />
          </div>

          <div className="rounded-xl border border-surface-border bg-surface-raised/60 p-3">
            <div className="mb-3 flex gap-1 rounded-lg bg-surface p-1">
              {(['deposit', 'withdraw'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setAmountInput('');
                    setTx(IDLE_TX);
                  }}
                  className={`tab-btn flex-1 capitalize ${
                    mode === m
                      ? 'bg-surface-card text-white'
                      : 'text-muted hover:text-slate-300'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="relative">
              <input
                className="input-amount"
                inputMode="decimal"
                placeholder="0.0 SOL"
                value={amountInput}
                onChange={(e) =>
                  setAmountInput(sanitizeAmountInput(e.target.value))
                }
                disabled={busy}
              />
              <button
                type="button"
                className="btn-max"
                onClick={handleMax}
                disabled={busy}
              >
                MAX
              </button>
            </div>

            <div className="mt-1.5 flex justify-between text-[11px] text-muted">
              <span>
                {mode === 'deposit'
                  ? `Wallet: ${formatAmount(walletLamports, SOL_DECIMALS)} SOL`
                  : `Withdrawable: ${formatAmount(positionLamports, SOL_DECIMALS)} SOL`}
              </span>
            </div>

            {inputError ? (
              <div className="mt-1.5 text-xs text-negative">{inputError}</div>
            ) : null}

            <div className="mt-3">
              {!publicKey ? (
                <button type="button" className="btn-primary" disabled>
                  Connect a Solana wallet
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={actionDisabled}
                  onClick={mode === 'deposit' ? handleDeposit : handleWithdraw}
                >
                  {busy
                    ? 'Processing…'
                    : mode === 'deposit'
                      ? 'Deposit SOL'
                      : 'Withdraw SOL'}
                </button>
              )}
            </div>

            <div className="mt-2.5 empty:hidden">
              <TxStatus tx={tx} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** lamports -> plain decimal string for the amount input. */
function lamportsToInput(value: bigint): string {
  if (value === 0n) return '0';
  const s = value.toString().padStart(SOL_DECIMALS + 1, '0');
  const whole = s.slice(0, s.length - SOL_DECIMALS) || '0';
  const frac = s.slice(s.length - SOL_DECIMALS).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
