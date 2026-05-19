import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import assert from "assert";
import {
  startSvm,
  createFarmingProgram,
  createToken,
  getOrCreateAssociatedTokenAccount,
  mintSplTokenTo,
  getTokenBalance,
  sendTransaction,
  warpTime,
  warpToTimestamp,
  fetchPool,
  fetchPoolNullable,
  fetchUser,
  fetchUserNullable,
} from "../utils";
import {
  getPoolPda,
  getRewardAVaultPda,
  getRewardBVaultPda,
  getStakingVaultPda,
  getUserPda,
  REWARD_DURATION,
} from "./utils";

const svm = startSvm();
const program = createFarmingProgram();

const BASE_KEYPAIR = Keypair.generate();
const ADMIN_KEYPAIR = Keypair.generate();
const USER_KEYPAIR = Keypair.generate();
const TOKEN_DECIMAL = 6;
const TOKEN_MULTIPLIER = 10 ** TOKEN_DECIMAL;

describe("dual-farming with single reward", () => {
  let stakingMint: PublicKey = null;
  let rewardMint: PublicKey = null;

  let userStakingATA: PublicKey = null;
  let userRewardATA: PublicKey = null;
  let adminStakingATA: PublicKey = null;
  let adminRewardATA: PublicKey = null;

  before(() => {
    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    svm.airdrop(USER_KEYPAIR.publicKey, BigInt(100 * LAMPORTS_PER_SOL));

    stakingMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    userStakingATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, stakingMint, USER_KEYPAIR.publicKey);
    adminStakingATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, stakingMint, ADMIN_KEYPAIR.publicKey);

    rewardMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    userRewardATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardMint, USER_KEYPAIR.publicKey);
    adminRewardATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardMint, ADMIN_KEYPAIR.publicKey);

    console.log("Program ID: ", program.programId.toString());
  });

  // Use same reward mint for `rewardAMint` and `rewardBMint` in accounts param

  it("should initialize dual-farming with single reward pool", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardMint, rewardMint, BASE_KEYPAIR.publicKey);
    const [stakingVaultAddress] = getStakingVaultPda(program, stakingMint, rewardMint, rewardMint, BASE_KEYPAIR.publicKey);
    const [rewardAVaultAddress] = getRewardAVaultPda(program, stakingMint, rewardMint, rewardMint, BASE_KEYPAIR.publicKey);
    const [rewardBVaultAddress] = getRewardBVaultPda(program, stakingMint, rewardMint, rewardMint, BASE_KEYPAIR.publicKey);

    const ix = await program.methods
      .initializePool(REWARD_DURATION)
      .accountsPartial({
        authority: ADMIN_KEYPAIR.publicKey,
        base: BASE_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rent: SYSVAR_RENT_PUBKEY,
        rewardAMint: rewardMint,
        rewardBMint: rewardMint,
        rewardAVault: rewardAVaultAddress,
        rewardBVault: rewardBVaultAddress,
        stakingMint,
        stakingVault: stakingVaultAddress,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [ADMIN_KEYPAIR, BASE_KEYPAIR]);
  });

  it("should create new user", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardMint, rewardMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);

    const ix = await program.methods
      .createUser()
      .accountsPartial({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        systemProgram: SystemProgram.programId,
        user: userStakingAddress,
      })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);
  });

  it("should stake to the pool", async () => {
    const DEPOSIT_AMOUNT = new BN(500 * TOKEN_MULTIPLIER);
    mintSplTokenTo(svm, ADMIN_KEYPAIR, stakingMint, ADMIN_KEYPAIR, USER_KEYPAIR.publicKey, 1000 * TOKEN_MULTIPLIER);

    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardMint, rewardMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const poolAccount = fetchPool(svm, program, farmingPoolAddress);

    const ix = await program.methods
      .deposit(DEPOSIT_AMOUNT)
      .accountsPartial({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        stakeFromAccount: userStakingATA,
        stakingVault: poolAccount.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userStakingAddress,
      })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);
  });

  it("should fund the pool reward A only", async () => {
    const FUND_AMOUNT = new BN(20_000 * TOKEN_MULTIPLIER);
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardMint, rewardMint, BASE_KEYPAIR.publicKey);
    const poolAccount = fetchPool(svm, program, farmingPoolAddress);

    mintSplTokenTo(svm, ADMIN_KEYPAIR, rewardMint, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, 100_000 * TOKEN_MULTIPLIER);

    const ix = await program.methods
      .fund(FUND_AMOUNT, new BN(0))
      .accountsPartial({
        fromA: adminRewardATA,
        fromB: adminRewardATA,
        funder: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rewardAVault: poolAccount.rewardAVault,
        rewardBVault: poolAccount.rewardBVault,
        stakingVault: poolAccount.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [ADMIN_KEYPAIR]);

    const poolRewardABalance = getTokenBalance(svm, poolAccount.rewardAVault);
    assert.strictEqual(poolRewardABalance.toString(), FUND_AMOUNT.toString());
  });

  it("should claim reward from the pool", async () => {
    warpTime(svm, 2);

    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardMint, rewardMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const beforeBalance = getTokenBalance(svm, userRewardATA);
    const poolAccount = fetchPool(svm, program, farmingPoolAddress);

    const ix = await program.methods
      .claim()
      .accountsPartial({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rewardAAccount: userRewardATA,
        rewardBAccount: userRewardATA,
        rewardAVault: poolAccount.rewardAVault,
        rewardBVault: poolAccount.rewardBVault,
        stakingVault: poolAccount.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userStakingAddress,
      })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    const afterBalance = getTokenBalance(svm, userRewardATA);
    assert.deepStrictEqual(afterBalance.gt(beforeBalance), true);
  });

  it("should pause the pool when farming finished", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardMint, rewardMint, BASE_KEYPAIR.publicKey);
    const poolAccount = fetchPool(svm, program, farmingPoolAddress);
    warpToTimestamp(svm, poolAccount.rewardDurationEnd.toNumber());

    const ix = await program.methods
      .pause()
      .accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [ADMIN_KEYPAIR]);
    assert.deepStrictEqual(fetchPool(svm, program, farmingPoolAddress).paused, true);
  });

  it("should withdraw stake and close user account", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardMint, rewardMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const poolAccount = fetchPool(svm, program, farmingPoolAddress);
    const userAccount = fetchUser(svm, program, userStakingAddress);

    const claimIx = await program.methods
      .claim()
      .accountsPartial({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rewardAAccount: userRewardATA,
        rewardBAccount: userRewardATA,
        rewardAVault: poolAccount.rewardAVault,
        rewardBVault: poolAccount.rewardBVault,
        stakingVault: poolAccount.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userStakingAddress,
      })
      .instruction();
    const withdrawIx = await program.methods
      .withdraw(userAccount.balanceStaked)
      .accountsPartial({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        stakeFromAccount: userStakingATA,
        stakingVault: poolAccount.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userStakingAddress,
      })
      .instruction();
    const closeUserIx = await program.methods
      .closeUser()
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, user: userStakingAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(claimIx, withdrawIx, closeUserIx), [USER_KEYPAIR]);

    assert.deepStrictEqual(fetchUserNullable(svm, program, userStakingAddress), null);
    assert.deepStrictEqual(fetchPool(svm, program, farmingPoolAddress).userStakeCount.toString(), "0");
  });

  it("should close pool", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardMint, rewardMint, BASE_KEYPAIR.publicKey);
    const poolAccount = fetchPool(svm, program, farmingPoolAddress);
    const beforeAdminRewardBalance = getTokenBalance(svm, adminRewardATA);
    const rewardAVaultBalance = getTokenBalance(svm, poolAccount.rewardAVault);

    const ix = await program.methods
      .closePool()
      .accountsPartial({
        authority: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        refundee: ADMIN_KEYPAIR.publicKey,
        rewardARefundee: adminRewardATA,
        rewardBRefundee: adminRewardATA,
        rewardAVault: poolAccount.rewardAVault,
        rewardBVault: poolAccount.rewardBVault,
        stakingRefundee: adminStakingATA,
        stakingVault: poolAccount.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [ADMIN_KEYPAIR]);

    assert.deepStrictEqual(fetchPoolNullable(svm, program, farmingPoolAddress), null);
    const afterAdminRewardBalance = getTokenBalance(svm, adminRewardATA);
    assert.deepStrictEqual(afterAdminRewardBalance.sub(beforeAdminRewardBalance).toString(), rewardAVaultBalance.toString());
  });
});
