'use client';

import { EVM_ASSETS } from '@/config/contracts';
import { EvmVaultCard } from './EvmVaultCard';
import { SolVaultCard } from './SolVaultCard';

export function VaultGrid() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {EVM_ASSETS.map((meta) => (
        <EvmVaultCard key={meta.key} meta={meta} />
      ))}
      <SolVaultCard />
    </div>
  );
}
