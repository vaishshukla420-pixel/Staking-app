import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'YieldVault — Dual-chain yield protocol',
  description:
    'Deposit USDC, ETH, wSOL or SOL and earn auto-optimized yield across Aave v3, Compound v3 and Morpho.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
