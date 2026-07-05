/**
 * Client module for the `sol_yield_vault` Solana program.
 *
 * The program is being built in parallel (Anchor). This module encodes the
 * agreed interface:
 *
 *   PDAs
 *     - vault state:    seeds = ["vault"]
 *     - SOL pool:       seeds = ["sol_pool"]   (system account holding lamports)
 *     - user position:  seeds = ["position", user_pubkey]
 *
 *   Instructions (Anchor-style, discriminator = sha256("global:<name>")[0..8])
 *     - deposit(amount_lamports: u64)
 *     - withdraw(shares: u64)
 *
 *   Vault state account layout (after the 8-byte Anchor discriminator):
 *     total_shares:         u64  (LE)
 *     reported_apr_bps:     u16  (LE)
 *     performance_fee_bps:  u16  (LE)
 *     current_venue:        u8   (0 Idle / 1 Marinade / 2 Solend / 3 Kamino)
 *
 *   User position account layout (assumed; after 8-byte discriminator):
 *     owner:                Pubkey (32 bytes)
 *     shares:               u64  (LE)
 *     deposited_lamports:   u64  (LE, running cost basis — optional, parsed
 *                                 only when the account is long enough)
 *
 * The program id comes from NEXT_PUBLIC_SOL_PROGRAM_ID. When it is missing or
 * a placeholder, `getSolProgramId()` returns null and the UI renders a
 * "not deployed" state — nothing here ever throws for a bad/missing id.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha256';
import { Buffer } from 'buffer';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'http://127.0.0.1:8899';

const RAW_PROGRAM_ID = process.env.NEXT_PUBLIC_SOL_PROGRAM_ID ?? '';

/** Human label for the configured RPC endpoint (header indicator). */
export function solanaClusterLabel(): string {
  if (SOLANA_RPC.includes('127.0.0.1') || SOLANA_RPC.includes('localhost')) {
    return 'Localnet';
  }
  if (SOLANA_RPC.includes('devnet')) return 'Devnet';
  if (SOLANA_RPC.includes('testnet')) return 'Testnet';
  if (SOLANA_RPC.includes('mainnet')) return 'Mainnet';
  return 'Custom RPC';
}

/**
 * Parsed program id, or null when unset / invalid / an obvious placeholder
 * (the all-zero system program key). Callers must handle null by showing a
 * "program not deployed" state.
 */
export function getSolProgramId(): PublicKey | null {
  if (!RAW_PROGRAM_ID) return null;
  try {
    const pk = new PublicKey(RAW_PROGRAM_ID);
    if (pk.equals(SystemProgram.programId)) return null;
    return pk;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------

export function getVaultPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault')],
    programId
  )[0];
}

export function getPoolPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('sol_pool')],
    programId
  )[0];
}

export function getPositionPda(
  programId: PublicKey,
  user: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), user.toBytes()],
    programId
  )[0];
}

// ---------------------------------------------------------------------------
// State decoding
// ---------------------------------------------------------------------------

export const SOL_VENUES = ['Idle', 'Marinade', 'Solend', 'Kamino'] as const;

export function venueName(venue: number | undefined): string {
  if (venue === undefined) return '—';
  return SOL_VENUES[venue] ?? `Unknown (${venue})`;
}

export interface SolVaultState {
  totalShares: bigint;
  reportedAprBps: number;
  performanceFeeBps: number;
  currentVenue: number;
  paused: boolean;
  depositCapLamports: bigint;
}

const DISCRIMINATOR_LEN = 8;

/**
 * Decode the vault state account. Field order mirrors `Vault` in
 * contracts/solana/programs/sol-yield-vault/src/state.rs (Borsh, no padding):
 * admin(32) treasury(32) performance_fee_bps(u16) total_shares(u64)
 * total_lamports_deposited(u64) current_venue(u8) reported_apr_bps(u16)
 * last_harvest_assets(u64) paused(bool) deposit_cap_lamports(u64)
 * bump(u8) pool_bump(u8). Returns null on any layout mismatch.
 */
export function parseVaultState(data: Uint8Array): SolVaultState | null {
  const MIN_LEN = DISCRIMINATOR_LEN + 32 + 32 + 2 + 8 + 8 + 1 + 2 + 8 + 1 + 8 + 1 + 1;
  if (data.length < MIN_LEN) return null;
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = DISCRIMINATOR_LEN;
    o += 32; // admin
    o += 32; // treasury
    const performanceFeeBps = view.getUint16(o, true);
    o += 2;
    const totalShares = view.getBigUint64(o, true);
    o += 8;
    o += 8; // total_lamports_deposited (lifetime counter, not needed here)
    const currentVenue = view.getUint8(o);
    o += 1;
    const reportedAprBps = view.getUint16(o, true);
    o += 2;
    o += 8; // last_harvest_assets
    const paused = view.getUint8(o) !== 0;
    o += 1;
    const depositCapLamports = view.getBigUint64(o, true);
    return { totalShares, reportedAprBps, performanceFeeBps, currentVenue, paused, depositCapLamports };
  } catch {
    return null;
  }
}

export interface SolUserPosition {
  owner: PublicKey;
  shares: bigint;
  /** Running deposit basis, when the program stores it (else null). */
  depositedLamports: bigint | null;
}

/** Decode a user position account. Returns null on any layout mismatch. */
export function parsePosition(data: Uint8Array): SolUserPosition | null {
  if (data.length < DISCRIMINATOR_LEN + 32 + 8) return null;
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = DISCRIMINATOR_LEN;
    const owner = new PublicKey(data.slice(o, o + 32));
    o += 32;
    const shares = view.getBigUint64(o, true);
    o += 8;
    const depositedLamports =
      data.length >= o + 8 ? view.getBigUint64(o, true) : null;
    return { owner, shares, depositedLamports };
  } catch {
    return null;
  }
}

/** shares -> lamports at the pool's current share price. */
export function sharesToLamports(
  shares: bigint,
  totalShares: bigint,
  poolLamports: bigint
): bigint {
  if (totalShares === 0n) return 0n;
  return (shares * poolLamports) / totalShares;
}

/** lamports -> shares at the pool's current share price. */
export function lamportsToShares(
  lamports: bigint,
  totalShares: bigint,
  poolLamports: bigint
): bigint {
  if (totalShares === 0n || poolLamports === 0n) return lamports; // 1:1 bootstrap
  return (lamports * totalShares) / poolLamports;
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

function anchorDiscriminator(ixName: string): Buffer {
  return Buffer.from(sha256(`global:${ixName}`)).subarray(0, 8);
}

function encodeU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

// Order must match the #[derive(Accounts)] structs in
// contracts/solana/programs/sol-yield-vault/src/instructions/{deposit,withdraw}.rs:
// user, vault, sol_pool, position, system_program
function commonKeys(programId: PublicKey, user: PublicKey) {
  return [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: getVaultPda(programId), isSigner: false, isWritable: true },
    { pubkey: getPoolPda(programId), isSigner: false, isWritable: true },
    {
      pubkey: getPositionPda(programId, user),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
  ];
}

/** deposit(amount_lamports: u64) */
export function buildDepositInstruction(
  programId: PublicKey,
  user: PublicKey,
  amountLamports: bigint
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: commonKeys(programId, user),
    data: Buffer.concat([
      anchorDiscriminator('deposit'),
      encodeU64(amountLamports),
    ]),
  });
}

/** withdraw(shares: u64) */
export function buildWithdrawInstruction(
  programId: PublicKey,
  user: PublicKey,
  shares: bigint
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: commonKeys(programId, user),
    data: Buffer.concat([anchorDiscriminator('withdraw'), encodeU64(shares)]),
  });
}
