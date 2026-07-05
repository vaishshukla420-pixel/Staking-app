'use client';

export type TxPhase =
  | 'idle'
  | 'approving'
  | 'signing'
  | 'confirming'
  | 'success'
  | 'error';

export interface TxState {
  phase: TxPhase;
  message?: string;
  /** Tx hash / signature, when available. */
  hash?: string;
}

export const IDLE_TX: TxState = { phase: 'idle' };

const PHASE_STYLE: Record<
  Exclude<TxPhase, 'idle'>,
  { box: string; dot: string; label: string }
> = {
  approving: {
    box: 'border-accent/40 bg-accent-soft text-accent',
    dot: 'bg-accent animate-pulse',
    label: 'Approval',
  },
  signing: {
    box: 'border-accent/40 bg-accent-soft text-accent',
    dot: 'bg-accent animate-pulse',
    label: 'Awaiting signature',
  },
  confirming: {
    box: 'border-warn/40 bg-warn/10 text-warn',
    dot: 'bg-warn animate-pulse',
    label: 'Pending',
  },
  success: {
    box: 'border-positive/40 bg-positive/10 text-positive',
    dot: 'bg-positive',
    label: 'Confirmed',
  },
  error: {
    box: 'border-negative/40 bg-negative/10 text-negative',
    dot: 'bg-negative',
    label: 'Failed',
  },
};

function shortHash(hash: string): string {
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

export function TxStatus({ tx }: { tx: TxState }) {
  if (tx.phase === 'idle') return null;
  const style = PHASE_STYLE[tx.phase];
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${style.box}`}
      role="status"
    >
      <span
        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`}
      />
      <div className="min-w-0">
        <span className="font-semibold">{style.label}</span>
        {tx.message ? <span> — {tx.message}</span> : null}
        {tx.hash ? (
          <div className="mt-0.5 truncate font-mono text-[11px] opacity-75">
            {shortHash(tx.hash)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Extract a compact, human-readable message from wallet/RPC errors. */
export function txErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as Error & { shortMessage?: string };
    const msg = anyErr.shortMessage ?? anyErr.message;
    const firstLine = msg.split('\n')[0];
    return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
  }
  return 'Unknown error';
}
