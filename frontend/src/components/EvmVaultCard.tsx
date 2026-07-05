'use client';

import { useMemo, useState } from 'react';
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useBalance,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { maxUint256, parseEther, type Address } from 'viem';
import type { ContractFunctionParameters } from 'viem';

import { erc20Abi, ethGatewayAbi, strategyAbi, yieldVaultAbi } from '@/config/abis';
import {
  DEFAULT_CHAIN_ID,
  getContracts,
  isDeployed,
  isSupportedChainId,
  type EvmAssetMeta,
} from '@/config/contracts';
import {
  addToCostBasis,
  computeEarned,
  getCostBasis,
  reduceCostBasis,
} from '@/lib/costBasis';
import {
  formatAmount,
  formatBps,
  netAprBps,
  sanitizeAmountInput,
  tryParseAmount,
} from '@/lib/format';
import { IDLE_TX, TxStatus, txErrorMessage, type TxState } from './TxStatus';

const POLL_MS = 10_000;
/** Gas headroom kept back when maxing a native-ETH deposit. */
const ETH_GAS_BUFFER = parseEther('0.01');

const ASSET_BADGE: Record<string, string> = {
  USDC: 'bg-sky-500/15 text-sky-300',
  ETH: 'bg-indigo-500/15 text-indigo-300',
  wSOL: 'bg-purple-500/15 text-purple-300',
};

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

export function EvmVaultCard({ meta }: { meta: EvmAssetMeta }) {
  const { address: account, chain, isConnected } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();

  const wrongNetwork = isConnected && !isSupportedChainId(chain?.id);
  const activeChainId = isSupportedChainId(chain?.id)
    ? chain.id
    : DEFAULT_CHAIN_ID;

  const contracts = getContracts(activeChainId);
  const vaultAddress = contracts?.vaults[meta.key].vault;
  const assetAddress = contracts?.vaults[meta.key].asset;
  const gatewayAddress = contracts?.ethGateway;

  const vaultDeployed = isDeployed(vaultAddress);
  const deployed =
    vaultDeployed && (!meta.isNativeEth || isDeployed(gatewayAddress));

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  const vaultStats = useReadContracts({
    allowFailure: true,
    contracts: vaultDeployed
      ? ([
          { address: vaultAddress, abi: yieldVaultAbi, functionName: 'totalAssets', chainId: activeChainId },
          { address: vaultAddress, abi: yieldVaultAbi, functionName: 'currentAPRBps', chainId: activeChainId },
          { address: vaultAddress, abi: yieldVaultAbi, functionName: 'performanceFeeBps', chainId: activeChainId },
          { address: vaultAddress, abi: yieldVaultAbi, functionName: 'activeStrategy', chainId: activeChainId },
          { address: vaultAddress, abi: yieldVaultAbi, functionName: 'depositCap', chainId: activeChainId },
        ] as const)
      : [],
    query: { enabled: vaultDeployed, refetchInterval: POLL_MS },
  });

  const totalAssets = vaultStats.data?.[0]?.result as bigint | undefined;
  const grossAprBps = vaultStats.data?.[1]?.result as bigint | undefined;
  const feeBps = vaultStats.data?.[2]?.result as bigint | undefined;
  const strategyAddress = vaultStats.data?.[3]?.result as Address | undefined;
  const depositCap = vaultStats.data?.[4]?.result as bigint | undefined;
  const rpcUnreachable = vaultDeployed && vaultStats.isError;

  const { data: strategyName } = useReadContract({
    address: strategyAddress,
    abi: strategyAbi,
    functionName: 'name',
    chainId: activeChainId,
    query: {
      enabled: vaultDeployed && isDeployed(strategyAddress),
      refetchInterval: POLL_MS * 3,
    },
  });

  const userContracts = useMemo<readonly ContractFunctionParameters[]>(() => {
    if (!deployed || !account || !vaultAddress) return [];
    const base = [
      {
        address: vaultAddress,
        abi: yieldVaultAbi,
        functionName: 'balanceOf',
        args: [account],
        chainId: activeChainId,
      },
      {
        address: vaultAddress,
        abi: yieldVaultAbi,
        functionName: 'maxWithdraw',
        args: [account],
        chainId: activeChainId,
      },
    ] as const;
    if (meta.isNativeEth) {
      // share-token allowance for the gateway (needed by withdrawETH)
      return [
        ...base,
        {
          address: vaultAddress,
          abi: yieldVaultAbi,
          functionName: 'allowance',
          args: [account, gatewayAddress!],
          chainId: activeChainId,
        },
      ];
    }
    return [
      ...base,
      {
        address: assetAddress!,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
        chainId: activeChainId,
      },
      {
        address: assetAddress!,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account, vaultAddress],
        chainId: activeChainId,
      },
    ];
  }, [
    deployed,
    account,
    vaultAddress,
    assetAddress,
    gatewayAddress,
    activeChainId,
    meta.isNativeEth,
  ]);

  const userReads = useReadContracts({
    allowFailure: true,
    contracts: userContracts,
    query: {
      enabled: userContracts.length > 0,
      refetchInterval: POLL_MS,
    },
  });

  const shares = userReads.data?.[0]?.result as bigint | undefined;
  const maxWithdrawAssets = userReads.data?.[1]?.result as bigint | undefined;
  const shareAllowanceToGateway = meta.isNativeEth
    ? (userReads.data?.[2]?.result as bigint | undefined)
    : undefined;
  const erc20WalletBalance = meta.isNativeEth
    ? undefined
    : (userReads.data?.[2]?.result as bigint | undefined);
  const erc20Allowance = meta.isNativeEth
    ? undefined
    : (userReads.data?.[3]?.result as bigint | undefined);

  const nativeBalance = useBalance({
    address: account,
    chainId: activeChainId,
    query: {
      enabled: meta.isNativeEth && !!account,
      refetchInterval: POLL_MS,
    },
  });

  const walletBalance = meta.isNativeEth
    ? nativeBalance.data?.value
    : erc20WalletBalance;

  const positionAssetsRead = useReadContract({
    address: vaultAddress,
    abi: yieldVaultAbi,
    functionName: 'convertToAssets',
    args: [shares ?? 0n],
    chainId: activeChainId,
    query: {
      enabled: deployed && shares !== undefined,
      refetchInterval: POLL_MS,
    },
  });
  const positionAssets = positionAssetsRead.data as bigint | undefined;

  // -------------------------------------------------------------------------
  // Local state
  // -------------------------------------------------------------------------

  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amountInput, setAmountInput] = useState('');
  const [tx, setTx] = useState<TxState>(IDLE_TX);
  const [busy, setBusy] = useState(false);
  const [, setBasisTick] = useState(0); // re-render after cost-basis writes

  const amount = tryParseAmount(amountInput, meta.decimals);

  const publicClient = usePublicClient({ chainId: activeChainId });
  const { writeContractAsync } = useWriteContract();

  const basisScope = `${activeChainId}:${vaultAddress ?? 'unknown'}`;
  const earned =
    account && positionAssets !== undefined && shares !== undefined && shares > 0n
      ? computeEarned(basisScope, account, positionAssets)
      : null;
  const hasBasis = account ? getCostBasis(basisScope, account) !== null : false;

  const netApr = netAprBps(grossAprBps, feeBps);

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  const needsApproval =
    !meta.isNativeEth &&
    amount !== undefined &&
    amount > 0n &&
    (erc20Allowance ?? 0n) < amount;

  let inputError: string | null = null;
  if (amountInput && amount === undefined) {
    inputError = 'Invalid amount';
  } else if (amount !== undefined && amount === 0n) {
    inputError = 'Amount must be greater than zero';
  } else if (mode === 'deposit' && amount !== undefined) {
    if (walletBalance !== undefined && amount > walletBalance) {
      inputError = 'Insufficient wallet balance';
    } else if (
      depositCap !== undefined &&
      depositCap > 0n &&
      totalAssets !== undefined &&
      totalAssets + amount > depositCap
    ) {
      inputError = 'Exceeds vault deposit cap';
    }
  } else if (mode === 'withdraw' && amount !== undefined) {
    if (maxWithdrawAssets !== undefined && amount > maxWithdrawAssets) {
      inputError = 'Exceeds withdrawable balance';
    }
  }

  const actionDisabled =
    busy ||
    !deployed ||
    !account ||
    wrongNetwork ||
    amount === undefined ||
    amount === 0n ||
    inputError !== null;

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function refreshAll() {
    await Promise.allSettled([
      vaultStats.refetch(),
      userReads.refetch(),
      positionAssetsRead.refetch(),
      meta.isNativeEth ? nativeBalance.refetch() : Promise.resolve(),
    ]);
  }

  async function waitFor(hash: `0x${string}`) {
    if (!publicClient) throw new Error('No RPC client for this network');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error('Transaction reverted on-chain');
    }
  }

  async function handleDeposit() {
    if (
      !account ||
      !vaultAddress ||
      amount === undefined ||
      amount === 0n ||
      !contracts
    )
      return;
    setBusy(true);
    try {
      if (meta.isNativeEth) {
        setTx({ phase: 'signing', message: 'Confirm ETH deposit in wallet' });
        const hash = await writeContractAsync({
          address: gatewayAddress!,
          abi: ethGatewayAbi,
          functionName: 'depositETH',
          args: [account],
          value: amount,
          chainId: activeChainId,
        });
        setTx({ phase: 'confirming', message: 'Depositing ETH…', hash });
        await waitFor(hash);
      } else {
        if ((erc20Allowance ?? 0n) < amount) {
          setTx({
            phase: 'approving',
            message: `Approve ${meta.displaySymbol} in wallet`,
          });
          const approveHash = await writeContractAsync({
            address: assetAddress!,
            abi: erc20Abi,
            functionName: 'approve',
            args: [vaultAddress, amount],
            chainId: activeChainId,
          });
          setTx({
            phase: 'confirming',
            message: 'Waiting for approval…',
            hash: approveHash,
          });
          await waitFor(approveHash);
        }
        setTx({ phase: 'signing', message: 'Confirm deposit in wallet' });
        const hash = await writeContractAsync({
          address: vaultAddress,
          abi: yieldVaultAbi,
          functionName: 'deposit',
          args: [amount, account],
          chainId: activeChainId,
        });
        setTx({ phase: 'confirming', message: 'Depositing…', hash });
        await waitFor(hash);
      }
      addToCostBasis(basisScope, account, amount);
      setBasisTick((t) => t + 1);
      setTx({
        phase: 'success',
        message: `Deposited ${formatAmount(amount, meta.decimals)} ${meta.displaySymbol}`,
      });
      setAmountInput('');
      await refreshAll();
    } catch (err) {
      setTx({ phase: 'error', message: txErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (
      !account ||
      !vaultAddress ||
      amount === undefined ||
      amount === 0n ||
      !publicClient
    )
      return;
    setBusy(true);
    const positionBefore = positionAssets ?? 0n;
    try {
      let hash: `0x${string}`;
      if (meta.isNativeEth) {
        // The gateway pulls vault shares from the user, so the vault share
        // token must be approved for the gateway first.
        const requiredShares = (await publicClient.readContract({
          address: vaultAddress,
          abi: yieldVaultAbi,
          functionName: 'convertToShares',
          args: [amount],
        })) as bigint;
        if ((shareAllowanceToGateway ?? 0n) < requiredShares) {
          setTx({
            phase: 'approving',
            message: 'Approve vault shares for the ETH gateway',
          });
          const approveHash = await writeContractAsync({
            address: vaultAddress,
            abi: yieldVaultAbi,
            functionName: 'approve',
            args: [gatewayAddress!, maxUint256],
            chainId: activeChainId,
          });
          setTx({
            phase: 'confirming',
            message: 'Waiting for approval…',
            hash: approveHash,
          });
          await waitFor(approveHash);
        }
        setTx({ phase: 'signing', message: 'Confirm ETH withdrawal in wallet' });
        hash = await writeContractAsync({
          address: gatewayAddress!,
          abi: ethGatewayAbi,
          functionName: 'withdrawETH',
          args: [amount, account],
          chainId: activeChainId,
        });
      } else {
        setTx({ phase: 'signing', message: 'Confirm withdrawal in wallet' });
        hash = await writeContractAsync({
          address: vaultAddress,
          abi: yieldVaultAbi,
          functionName: 'withdraw',
          args: [amount, account, account],
          chainId: activeChainId,
        });
      }
      setTx({ phase: 'confirming', message: 'Withdrawing…', hash });
      await waitFor(hash);
      reduceCostBasis(basisScope, account, amount, positionBefore);
      setBasisTick((t) => t + 1);
      setTx({
        phase: 'success',
        message: `Withdrew ${formatAmount(amount, meta.decimals)} ${meta.displaySymbol}`,
      });
      setAmountInput('');
      await refreshAll();
    } catch (err) {
      setTx({ phase: 'error', message: txErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function handleMax() {
    if (mode === 'deposit') {
      if (walletBalance === undefined) return;
      let max = walletBalance;
      if (meta.isNativeEth) {
        max = max > ETH_GAS_BUFFER ? max - ETH_GAS_BUFFER : 0n;
      }
      setAmountInput(formatMaxInput(max, meta.decimals));
    } else {
      if (maxWithdrawAssets === undefined) return;
      setAmountInput(formatMaxInput(maxWithdrawAssets, meta.decimals));
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const badge = ASSET_BADGE[meta.displaySymbol] ?? 'bg-accent-soft text-accent';

  return (
    <div className="card flex flex-col gap-4 p-5">
      {/* header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${badge}`}
          >
            {meta.displaySymbol.slice(0, 4)}
          </div>
          <div>
            <div className="text-sm font-bold text-white">
              {meta.displaySymbol}{' '}
              <span className="font-normal text-muted">· {meta.name}</span>
            </div>
            <div className="text-[11px] text-muted">{meta.chainLabel}</div>
          </div>
        </div>
        <span className="pill text-muted" title="Active strategy">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          {deployed ? ((strategyName as string | undefined) ?? '…') : '—'}
        </span>
      </div>

      {!deployed ? (
        <div className="rounded-xl border border-dashed border-surface-border bg-surface-raised px-4 py-6 text-center text-xs text-muted">
          <div className="mb-1 text-sm font-semibold text-slate-300">
            Vault not deployed on this network yet
          </div>
          Paste the deployed addresses into{' '}
          <code className="font-mono text-accent">src/config/contracts.ts</code>{' '}
          (or set the matching env vars) to activate this card.
        </div>
      ) : (
        <>
          {rpcUnreachable ? (
            <div className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              RPC unreachable — showing stale data. Is your node running?
            </div>
          ) : null}

          {/* stats */}
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
              value={`${formatAmount(totalAssets, meta.decimals, 2)} ${meta.displaySymbol}`}
              sub={
                depositCap !== undefined && depositCap > 0n
                  ? `Cap ${formatAmount(depositCap, meta.decimals, 0)}`
                  : 'No deposit cap'
              }
            />
            <Stat
              label="Your position"
              value={
                account
                  ? `${formatAmount(positionAssets, meta.decimals)} ${meta.displaySymbol}`
                  : '—'
              }
              sub={
                account && shares !== undefined
                  ? `${formatAmount(shares, meta.decimals)} shares`
                  : 'Connect wallet'
              }
            />
            <Stat
              label="Earned"
              value={
                account && shares !== undefined && shares > 0n
                  ? earned !== null
                    ? `+${formatAmount(earned, meta.decimals)} ${meta.displaySymbol}`
                    : hasBasis
                      ? '—'
                      : 'n/a'
                  : '—'
              }
              sub={
                account && shares !== undefined && shares > 0n && earned === null
                  ? 'Tracked locally per browser'
                  : undefined
              }
              accent={earned !== null && earned > 0n}
            />
          </div>

          {/* deposit / withdraw */}
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
                placeholder={`0.0 ${meta.displaySymbol}`}
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
                  ? `Wallet: ${formatAmount(walletBalance, meta.decimals)} ${meta.displaySymbol}`
                  : `Withdrawable: ${formatAmount(maxWithdrawAssets, meta.decimals)} ${meta.displaySymbol}`}
              </span>
              {meta.isNativeEth && mode === 'deposit' ? (
                <span>via EthGateway — no approval needed</span>
              ) : null}
            </div>

            {inputError ? (
              <div className="mt-1.5 text-xs text-negative">{inputError}</div>
            ) : null}

            <div className="mt-3">
              {!account ? (
                <button type="button" className="btn-primary" disabled>
                  Connect an EVM wallet
                </button>
              ) : wrongNetwork ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={switching}
                  onClick={() => switchChain({ chainId: DEFAULT_CHAIN_ID })}
                >
                  {switching ? 'Switching…' : 'Switch to a supported network'}
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
                      ? needsApproval
                        ? `Approve & deposit ${meta.displaySymbol}`
                        : `Deposit ${meta.displaySymbol}`
                      : `Withdraw ${meta.displaySymbol}`}
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

/** Format a bigint for prefilling the amount input (full precision, no commas). */
function formatMaxInput(value: bigint, decimals: number): string {
  if (value === 0n) return '0';
  const s = value.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals) || '0';
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
