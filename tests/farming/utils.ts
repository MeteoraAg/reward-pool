import { Program } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { Farming } from "../../target/types/farming";

export const REWARD_DURATION = new BN(10);

export function getPoolPda(
  program: Program<Farming>,
  stakingMint: PublicKey,
  rewardAMint: PublicKey,
  rewardBMint: PublicKey,
  base: PublicKey,
  rewardDuration?: BN
) {
  return PublicKey.findProgramAddressSync(
    [
      rewardDuration
        ? rewardDuration.toBuffer(null, 8)
        : REWARD_DURATION.toBuffer(null, 8),
      stakingMint.toBuffer(),
      rewardAMint.toBuffer(),
      rewardBMint.toBuffer(),
      base.toBuffer(),
    ],
    program.programId
  );
}

export function getStakingVaultPda(
  program: Program<Farming>,
  stakingMint: PublicKey,
  rewardAMint: PublicKey,
  rewardBMint: PublicKey,
  base: PublicKey,
  rewardDuration?: BN
) {
  const [poolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, base, rewardDuration);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("staking"), poolAddress.toBuffer()],
    program.programId
  );
}

export function getRewardAVaultPda(
  program: Program<Farming>,
  stakingMint: PublicKey,
  rewardAMint: PublicKey,
  rewardBMint: PublicKey,
  base: PublicKey,
  rewardDuration?: BN
) {
  const [poolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, base, rewardDuration);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_a"), poolAddress.toBuffer()],
    program.programId
  );
}

export function getRewardBVaultPda(
  program: Program<Farming>,
  stakingMint: PublicKey,
  rewardAMint: PublicKey,
  rewardBMint: PublicKey,
  base: PublicKey,
  rewardDuration?: BN
) {
  const [poolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, base, rewardDuration);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_b"), poolAddress.toBuffer()],
    program.programId
  );
}

export function getUserPda(
  program: Program<Farming>,
  poolAddress: PublicKey,
  userAddress: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [userAddress.toBuffer(), poolAddress.toBuffer()],
    program.programId
  );
}
