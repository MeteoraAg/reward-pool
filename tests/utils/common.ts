import { AnchorProvider, IdlAccounts, Program, Wallet } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  Signer,
  Transaction,
} from "@solana/web3.js";
import { LiteSVM, FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import { Farming } from "../../target/types/farming";
import farmingIdl from "../../target/idl/farming.json";

export type Pool = IdlAccounts<Farming>["pool"];
export type User = IdlAccounts<Farming>["user"];

/**
 * Creates a Farming Program instance with a dummy provider.
 * The provider is never used for RPC — only for the Anchor coder.
 */
export function createFarmingProgram(): Program<Farming> {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection("http://localhost"),
    wallet,
    {}
  );
  return new Program<Farming>(farmingIdl as any, provider);
}

/**
 * Signs and sends a transaction via LiteSVM. Throws on failure.
 */
export function sendTransaction(
  svm: LiteSVM,
  transaction: Transaction,
  signers: Signer[]
): TransactionMetadata {
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(...(signers as Keypair[]));

  const result = svm.sendTransaction(transaction);
  svm.expireBlockhash();
  if (result instanceof FailedTransactionMetadata) {
    const logs = result.meta().logs();
    throw new Error(logs.join("\n") || `Transaction failed: ${result.toString()}`);
  }
  return result;
}

/**
 * Warp the SVM clock forward by the given number of seconds.
 */
export function warpTime(svm: LiteSVM, seconds: number) {
  const clock = svm.getClock();
  clock.unixTimestamp = clock.unixTimestamp + BigInt(seconds);
  clock.slot = clock.slot + BigInt(seconds * 2);
  svm.setClock(clock);
}

/**
 * Get the current unix timestamp from the SVM clock.
 */
export function getUnixTimestamp(svm: LiteSVM): number {
  return Number(svm.getClock().unixTimestamp);
}

/**
 * Warp the SVM clock past the given unix timestamp.
 */
export function warpToTimestamp(svm: LiteSVM, targetTimestamp: number) {
  const current = getUnixTimestamp(svm);
  if (targetTimestamp >= current) {
    warpTime(svm, targetTimestamp - current + 1);
  }
}

/**
 * Fetch and decode a Pool account from SVM.
 */
export function fetchPool(
  svm: LiteSVM,
  program: Program<Farming>,
  address: PublicKey
): Pool {
  const account = svm.getAccount(address);
  if (!account) throw new Error(`Pool account not found: ${address.toBase58()}`);
  return program.coder.accounts.decode("pool", Buffer.from(account.data));
}

/**
 * Fetch and decode a Pool account, returning null if not found.
 */
export function fetchPoolNullable(
  svm: LiteSVM,
  program: Program<Farming>,
  address: PublicKey
): Pool | null {
  const account = svm.getAccount(address);
  if (!account || account.lamports === 0 || account.data.length === 0) return null;
  return program.coder.accounts.decode("pool", Buffer.from(account.data));
}

/**
 * Fetch and decode a User account from SVM.
 */
export function fetchUser(
  svm: LiteSVM,
  program: Program<Farming>,
  address: PublicKey
): User {
  const account = svm.getAccount(address);
  if (!account) throw new Error(`User account not found: ${address.toBase58()}`);
  return program.coder.accounts.decode("user", Buffer.from(account.data));
}

/**
 * Fetch and decode a User account, returning null if not found.
 */
export function fetchUserNullable(
  svm: LiteSVM,
  program: Program<Farming>,
  address: PublicKey
): User | null {
  const account = svm.getAccount(address);
  if (!account || account.lamports === 0 || account.data.length === 0) return null;
  return program.coder.accounts.decode("user", Buffer.from(account.data));
}
