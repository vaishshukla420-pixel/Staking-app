const STEPS = [
  {
    title: 'Deposit',
    body: 'Deposit USDC, ETH or wSOL into an ERC-4626 vault on Ethereum, or native SOL into the Solana vault. You receive vault shares.',
    icon: (
      <path
        d="M12 4v10m0 0-3.5-3.5M12 14l3.5-3.5M5 18h14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: 'Auto-invested',
    body: 'Funds are immediately put to work in whichever venue pays the highest yield — Aave v3, Compound v3 or Morpho (Marinade, Solend or Kamino on Solana).',
    icon: (
      <path
        d="M4 17l4.5-5 3.5 3 4-6L20 6M4 21h16"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: 'Keeper rebalances',
    body: 'When rates move, a keeper shifts the whole vault to the best-paying venue. Your share count never changes — the share price simply keeps rising.',
    icon: (
      <path
        d="M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: 'Fee on yield only',
    body: 'The protocol takes a performance fee on the yield it generates — never on your principal. APYs shown are net of this fee.',
    icon: (
      <path
        d="M6 18 18 6M8.5 7.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm10 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    ),
  },
];

export function HowItWorks() {
  return (
    <section className="mt-12">
      <h2 className="text-lg font-bold text-white">How it works</h2>
      <p className="mt-1 text-sm text-muted">
        One deposit, always the best rate — across both chains.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <div key={step.title} className="card p-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  {step.icon}
                </svg>
              </div>
              <div className="text-sm font-semibold text-slate-100">
                <span className="mr-1.5 font-mono text-xs text-muted">
                  {i + 1}.
                </span>
                {step.title}
              </div>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-muted">
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
