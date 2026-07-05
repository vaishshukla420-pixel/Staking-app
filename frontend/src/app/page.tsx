import { Header } from '@/components/Header';
import { HowItWorks } from '@/components/HowItWorks';
import { VaultGrid } from '@/components/VaultGrid';

export default function Home() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Earn the best rate. Automatically.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Deposit USDC, ETH or wSOL on Ethereum — or native SOL on Solana —
            and YieldVault continuously routes your funds to the
            highest-yielding venue among Aave v3, Compound v3 and Morpho.
            Yield accrues through a rising share price.
          </p>
        </div>

        <VaultGrid />
        <HowItWorks />

        <footer className="mt-14 border-t border-surface-border pt-6 text-center text-xs text-muted">
          YieldVault — dual-chain yield protocol. Unaudited testnet software;
          do not use with mainnet funds.
        </footer>
      </main>
    </>
  );
}
