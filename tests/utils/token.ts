import {
  AccountLayout,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";

export function createToken(
  svm: LiteSVM,
  payer: Keypair,
  mintAuthority: PublicKey,
  decimal: number
): PublicKey {
  const mintKeypair = Keypair.generate();
  const rent = svm.getRent();
  const lamports = rent.minimumBalance(BigInt(MINT_SIZE));

  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mintKeypair.publicKey,
    space: MINT_SIZE,
    lamports: Number(lamports),
    programId: TOKEN_PROGRAM_ID,
  });

  const initializeMintIx = createInitializeMint2Instruction(
    mintKeypair.publicKey,
    decimal,
    mintAuthority,
    null
  );

  const tx = new Transaction();
  tx.recentBlockhash = svm.latestBlockhash();
  tx.add(createAccountIx, initializeMintIx);
  tx.sign(payer, mintKeypair);

  const res = svm.sendTransaction(tx);
  if (res instanceof FailedTransactionMetadata) {
    throw new Error(`createToken failed: ${res.meta().logs()}`);
  }

  return mintKeypair.publicKey;
}

export function getOrCreateAssociatedTokenAccount(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): PublicKey {
  const ataKey = getAssociatedTokenAddressSync(mint, owner, true);

  const account = svm.getAccount(ataKey);
  if (account === null) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ataKey,
      owner,
      mint
    );
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(createAtaIx);
    tx.sign(payer);

    const res = svm.sendTransaction(tx);
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`getOrCreateATA failed: ${res.meta().logs()}`);
    }
  }

  return ataKey;
}

export function mintSplTokenTo(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  mintAuthority: Keypair,
  toWallet: PublicKey,
  rawAmount: bigint | number
) {
  const destination = getOrCreateAssociatedTokenAccount(
    svm,
    payer,
    mint,
    toWallet
  );

  const mintIx = createMintToInstruction(
    mint,
    destination,
    mintAuthority.publicKey,
    rawAmount
  );

  const tx = new Transaction();
  tx.recentBlockhash = svm.latestBlockhash();
  tx.add(mintIx);
  tx.sign(payer, mintAuthority);

  const res = svm.sendTransaction(tx);
  if (res instanceof FailedTransactionMetadata) {
    throw new Error(`mintSplTokenTo failed: ${res.meta().logs()}`);
  }
}

export function transferToken(
  svm: LiteSVM,
  payer: Keypair,
  source: PublicKey,
  destination: PublicKey,
  owner: Keypair,
  amount: bigint | number
) {
  const transferIx = createTransferInstruction(
    source,
    destination,
    owner.publicKey,
    amount
  );

  const tx = new Transaction();
  tx.recentBlockhash = svm.latestBlockhash();
  tx.add(transferIx);
  tx.sign(payer, owner);

  const res = svm.sendTransaction(tx);
  if (res instanceof FailedTransactionMetadata) {
    throw new Error(`transferToken failed: ${res.meta().logs()}`);
  }
}

export function getTokenAccount(svm: LiteSVM, key: PublicKey) {
  const account = svm.getAccount(key);
  if (!account) throw new Error(`Token account not found: ${key.toBase58()}`);
  return AccountLayout.decode(account.data);
}

export function getTokenBalance(svm: LiteSVM, key: PublicKey): BN {
  const tokenAccount = getTokenAccount(svm, key);
  return new BN(tokenAccount.amount.toString());
}
