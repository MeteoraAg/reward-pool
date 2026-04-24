import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import path from "path";

const PROGRAM_ID = new PublicKey(
  "FarmuwXPWXvefWUeqFAa5w6rifLkq5X6E8bimYvrhCB1"
);

export function startSvm(): LiteSVM {
  const svm = new LiteSVM();

  const programSoPath = path.resolve(
    __dirname,
    "../../target/deploy/farming.so"
  );
  svm.addProgramFromFile(PROGRAM_ID, programSoPath);

  // Set a reasonable initial clock timestamp
  const clock = svm.getClock();
  clock.unixTimestamp = BigInt(Math.floor(Date.now() / 1000));
  svm.setClock(clock);

  return svm;
}

export function generateAndFund(svm: LiteSVM): Keypair {
  const kp = Keypair.generate();
  svm.airdrop(kp.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
  return kp;
}
