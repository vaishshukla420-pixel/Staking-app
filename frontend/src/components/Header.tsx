'use client';

import dynamic from 'next/dynamic';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { isSupportedChainId } from '@/config/contracts';
import { solanaClusterLabel } from '@/lib/solana';

// The wallet-adapter button reads wallet state that only exists client-side;
// render it without SSR to avoid hydration mismatches.
const WalletMultiButton = dynamic(
  async () =>
    (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false }
);

function NetworkIndicator() {
  const { chain, isConnected } = useAccount();

  let evmLabel = 'EVM: not connected';
  let evmDot = 'bg-slate-500';
  if (isConnected) {
    if (chain && isSupportedChainId(chain.id)) {
      evmLabel = chain.name;
      evmDot = 'bg-positive';
    } else {
      evmLabel = 'Unsupported network';
      evmDot = 'bg-negative';
    }
  }

  return (
    <div className="hidden items-center gap-2 md:flex">
      <span className="pill text-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${evmDot}`} />
        {evmLabel}
      </span>
      <span className="pill text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-[#9945ff]" />
        Solana · {solanaClusterLabel()}
      </span>
    </div>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-surface-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 13c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2"
                stroke="#4f7cff"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <path
                d="M4 17c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2"
                stroke="#4f7cff"
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.5"
              />
              <path
                d="M12 3v5m0 0-2.2-2.2M12 8l2.2-2.2"
                stroke="#34d399"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-white">
              YieldVault
            </div>
            <div className="hidden text-[11px] text-muted sm:block">
              Dual-chain auto-optimized yield
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <NetworkIndicator />
          <ConnectButton
            showBalance={false}
            chainStatus="icon"
            accountStatus={{
              smallScreen: 'avatar',
              largeScreen: 'address',
            }}
          />
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
