import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import assert from "assert";
import {
  getPoolPda,
  getRewardAVaultPda,
  getRewardBVaultPda,
  getStakingVaultPda,
  getUserPda,
  REWARD_DURATION,
} from "./utils";
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
  getUnixTimestamp,
  fetchPool,
  fetchUser,
} from "../utils";

const svm = startSvm();
const program = createFarmingProgram();

const BASE_KEYPAIR = Keypair.generate();
const ADMIN_KEYPAIR = Keypair.generate();
const USER_KEYPAIR = Keypair.generate();
const FUNDER_KEYPAIR = Keypair.generate();

const TOKEN_DECIMAL = 3;
const TOKEN_MULTIPLIER = new BN(10 ** TOKEN_DECIMAL);
const MINT_AMOUNT = new BN(100_000).mul(TOKEN_MULTIPLIER);
const FUND_AMOUNT = new BN(10_000).mul(TOKEN_MULTIPLIER);
const DEPOSIT_AMOUNT = new BN(500).mul(TOKEN_MULTIPLIER);

let totalFundAmount = new BN(0);
let nonOwnerRewardAPhaseOne = new BN(0);
let nonOwnerRewardBPhaseOne = new BN(0);
let nonOwnerRewardAPhaseTwo = new BN(0);
let nonOwnerRewardBPhaseTwo = new BN(0);

describe("dual-farming-edge-case", () => {
  let stakingMint: PublicKey = null;
  let rewardAMint: PublicKey = null;
  let rewardBMint: PublicKey = null;

  let userStakingATA: PublicKey = null;
  let userRewardAATA: PublicKey = null;
  let userRewardBATA: PublicKey = null;

  let adminRewardAATA: PublicKey = null;
  let adminRewardBATA: PublicKey = null;

  before(() => {
    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    svm.airdrop(USER_KEYPAIR.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    svm.airdrop(FUNDER_KEYPAIR.publicKey, BigInt(100 * LAMPORTS_PER_SOL));

    stakingMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    userStakingATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, stakingMint, USER_KEYPAIR.publicKey);
    getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, stakingMint, ADMIN_KEYPAIR.publicKey);

    rewardAMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    userRewardAATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardAMint, USER_KEYPAIR.publicKey);
    adminRewardAATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardAMint, ADMIN_KEYPAIR.publicKey);

    rewardBMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    userRewardBATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardBMint, USER_KEYPAIR.publicKey);
    adminRewardBATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardBMint, ADMIN_KEYPAIR.publicKey);

    mintSplTokenTo(svm, ADMIN_KEYPAIR, stakingMint, ADMIN_KEYPAIR, USER_KEYPAIR.publicKey, MINT_AMOUNT.toNumber());
    mintSplTokenTo(svm, ADMIN_KEYPAIR, rewardAMint, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, MINT_AMOUNT.toNumber());
    mintSplTokenTo(svm, ADMIN_KEYPAIR, rewardBMint, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, MINT_AMOUNT.toNumber());
  });

  it("initialize dual-farming pool", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [stakingVaultAddress] = getStakingVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [rewardAVaultAddress] = getRewardAVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [rewardBVaultAddress] = getRewardBVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);

    const ix = await program.methods.initializePool(REWARD_DURATION)
      .accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, base: BASE_KEYPAIR.publicKey, pool: farmingPoolAddress, rent: SYSVAR_RENT_PUBKEY, rewardAMint, rewardBMint, rewardAVault: rewardAVaultAddress, rewardBVault: rewardBVaultAddress, stakingMint, stakingVault: stakingVaultAddress, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [ADMIN_KEYPAIR, BASE_KEYPAIR]);

    const poolState = fetchPool(svm, program, farmingPoolAddress);
    assert.deepStrictEqual(poolState.authority.toBase58(), ADMIN_KEYPAIR.publicKey.toBase58());
    assert.deepStrictEqual(poolState.baseKey.toBase58(), BASE_KEYPAIR.publicKey.toBase58());
    for (const funder of poolState.funders) {
      assert.deepStrictEqual(funder.toBase58(), PublicKey.default.toBase58());
    }
    assert.deepStrictEqual(poolState.lastUpdateTime.toString(), "0");
    assert.deepStrictEqual(poolState.rewardDurationEnd.toString(), "0");
    assert.deepStrictEqual(poolState.rewardARate.toString(), "0");
    assert.deepStrictEqual(poolState.rewardBRate.toString(), "0");
    assert.deepStrictEqual(poolState.rewardAPerTokenStored.toString(), "0");
    assert.deepStrictEqual(poolState.rewardBPerTokenStored.toString(), "0");
    assert.deepStrictEqual(poolState.rewardDuration.toString(), REWARD_DURATION.toString());
    assert.deepStrictEqual(poolState.paused, false);
    assert.deepStrictEqual(poolState.rewardAMint.toBase58(), rewardAMint.toBase58());
    assert.deepStrictEqual(poolState.rewardBMint.toBase58(), rewardBMint.toBase58());
    assert.deepStrictEqual(poolState.stakingMint.toBase58(), stakingMint.toBase58());
    assert.deepStrictEqual(poolState.stakingVault.toBase58(), stakingVaultAddress.toBase58());
    assert.deepStrictEqual(poolState.rewardAVault.toBase58(), rewardAVaultAddress.toBase58());
    assert.deepStrictEqual(poolState.rewardBVault.toBase58(), rewardBVaultAddress.toBase58());
  });

  it("create new user", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress, userStakingAddressBump] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);

    const ix = await program.methods.createUser()
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, systemProgram: SystemProgram.programId, user: userStakingAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    const userState = fetchUser(svm, program, userStakingAddress);
    const poolState = fetchPool(svm, program, farmingPoolAddress);
    assert.deepStrictEqual(poolState.userStakeCount.toString(), "1");
    assert.deepStrictEqual(userState.pool.toBase58(), farmingPoolAddress.toBase58());
    assert.deepStrictEqual(userState.owner.toBase58(), USER_KEYPAIR.publicKey.toBase58());
    assert.deepStrictEqual(userState.rewardAPerTokenComplete.toString(), "0");
    assert.deepStrictEqual(userState.rewardBPerTokenComplete.toString(), "0");
    assert.deepStrictEqual(userState.rewardAPerTokenPending.toString(), "0");
    assert.deepStrictEqual(userState.rewardBPerTokenPending.toString(), "0");
    assert.deepStrictEqual(userState.balanceStaked.toString(), "0");
    assert.deepStrictEqual(userState.nonce.toString(), userStakingAddressBump.toString());
  });

  it("fund the pool, and farming start", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    let poolState = fetchPool(svm, program, farmingPoolAddress);
    const beforeRewardAVaultBalance = getTokenBalance(svm, poolState.rewardAVault);
    const beforeRewardBVaultBalance = getTokenBalance(svm, poolState.rewardBVault);

    const ix = await program.methods.fund(FUND_AMOUNT, FUND_AMOUNT)
      .accountsPartial({ fromA: adminRewardAATA, fromB: adminRewardBATA, funder: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress, rewardAVault: poolState.rewardAVault, rewardBVault: poolState.rewardBVault, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [ADMIN_KEYPAIR]);

    totalFundAmount = totalFundAmount.add(FUND_AMOUNT);
    poolState = fetchPool(svm, program, farmingPoolAddress);
    const expectedRewardDurationEnd = poolState.lastUpdateTime.add(REWARD_DURATION);
    assert.deepStrictEqual(poolState.rewardDurationEnd.toString(), expectedRewardDurationEnd.toString());
    const afterRewardAVaultBalance = getTokenBalance(svm, poolState.rewardAVault);
    const afterRewardBVaultBalance = getTokenBalance(svm, poolState.rewardBVault);
    const rewardAVaultBalanceIncreased = afterRewardAVaultBalance.gt(beforeRewardAVaultBalance);
    const rewardBVaultBalanceIncreased = afterRewardBVaultBalance.gt(beforeRewardBVaultBalance);
    assert.deepStrictEqual(rewardAVaultBalanceIncreased, true);
    assert.deepStrictEqual(rewardBVaultBalanceIncreased, true);
  });

  it("stake to a started farm, with 0 total stake amount", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    let poolState = fetchPool(svm, program, farmingPoolAddress);

    assert.deepStrictEqual(poolState.lastUpdateTime.toString() != "0", true);
    assert.deepStrictEqual(poolState.rewardDurationEnd.toString() != "0", true);
    assert.deepStrictEqual(poolState.totalStaked.toString(), "0");

    // Warp 5 seconds before depositing
    warpTime(svm, 5);

    const ix = await program.methods.deposit(DEPOSIT_AMOUNT)
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, stakeFromAccount: userStakingATA, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user: userStakingAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    const userState = fetchUser(svm, program, userStakingAddress);
    assert.deepStrictEqual(userState.balanceStaked.toString(), DEPOSIT_AMOUNT.toString());
    assert.deepStrictEqual(getTokenBalance(svm, poolState.stakingVault).toString(), DEPOSIT_AMOUNT.toString());
  });

  it("user claim reward when pool reward end", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const poolState = fetchPool(svm, program, farmingPoolAddress);
    const beforeUserRewardA = getTokenBalance(svm, userRewardAATA);
    const beforeUserRewardB = getTokenBalance(svm, userRewardBATA);

    warpToTimestamp(svm, poolState.rewardDurationEnd.toNumber());

    const ix = await program.methods.claim()
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, rewardAAccount: userRewardAATA, rewardBAccount: userRewardBATA, rewardAVault: poolState.rewardAVault, rewardBVault: poolState.rewardBVault, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user: userStakingAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    const afterUserRewardA = getTokenBalance(svm, userRewardAATA);
    const afterUserRewardB = getTokenBalance(svm, userRewardBATA);
    const isUserReceivedRewardA = afterUserRewardA.gt(beforeUserRewardA);
    const isUserReceivedRewardB = afterUserRewardB.gt(beforeUserRewardB);
    assert.deepStrictEqual(isUserReceivedRewardA, true);
    assert.deepStrictEqual(isUserReceivedRewardB, true);

    const userReceivedRewardA = afterUserRewardA.sub(beforeUserRewardA);
    const userReceivedRewardB = afterUserRewardB.sub(beforeUserRewardB);
    nonOwnerRewardAPhaseOne = FUND_AMOUNT.sub(userReceivedRewardA);
    nonOwnerRewardBPhaseOne = FUND_AMOUNT.sub(userReceivedRewardB);

    const rewardAVaultBal = getTokenBalance(svm, poolState.rewardAVault);
    const rewardBVaultBal = getTokenBalance(svm, poolState.rewardBVault);
    assert.deepStrictEqual(rewardAVaultBal.gt(new BN(0)), true);
    assert.deepStrictEqual(rewardBVaultBal.gt(new BN(0)), true);
    assert.deepStrictEqual(rewardAVaultBal.eq(nonOwnerRewardAPhaseOne), true);
    assert.deepStrictEqual(rewardBVaultBal.eq(nonOwnerRewardBPhaseOne), true);
  });

  it("extend pool reward duration", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const beforePoolState = fetchPool(svm, program, farmingPoolAddress);

    const ix = await program.methods.fund(FUND_AMOUNT, FUND_AMOUNT)
      .accountsPartial({ fromA: adminRewardAATA, fromB: adminRewardBATA, funder: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress, rewardAVault: beforePoolState.rewardAVault, rewardBVault: beforePoolState.rewardBVault, stakingVault: beforePoolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [ADMIN_KEYPAIR]);

    totalFundAmount = totalFundAmount.add(FUND_AMOUNT);
    const afterPoolState = fetchPool(svm, program, farmingPoolAddress);
    assert.deepStrictEqual(afterPoolState.rewardDurationEnd.gt(beforePoolState.rewardDurationEnd), true);
  });

  it("user unstake 5 seconds before pool ended, pool total stake = 0", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    let poolState = fetchPool(svm, program, farmingPoolAddress);

    // Warp to 5 seconds before reward end
    const targetTime = poolState.rewardDurationEnd.toNumber() - 5;
    const currentTime = getUnixTimestamp(svm);
    if (targetTime > currentTime) warpTime(svm, targetTime - currentTime);

    const ix = await program.methods.withdraw(DEPOSIT_AMOUNT)
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, stakeFromAccount: userStakingATA, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user: userStakingAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    poolState = fetchPool(svm, program, farmingPoolAddress);
    const userState = fetchUser(svm, program, userStakingAddress);
    assert.deepStrictEqual(userState.balanceStaked.toString(), "0");
    assert.deepStrictEqual(getTokenBalance(svm, poolState.stakingVault).toString(), "0");
    assert.deepStrictEqual(poolState.totalStaked.toString(), "0");
  });

  it("user claim reward when pool total stake = 0, and reward ended", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const poolState = fetchPool(svm, program, farmingPoolAddress);
    const beforeUserRewardA = getTokenBalance(svm, userRewardAATA);
    const beforeUserRewardB = getTokenBalance(svm, userRewardBATA);

    assert.deepStrictEqual(poolState.totalStaked.toString(), "0");
    warpToTimestamp(svm, poolState.rewardDurationEnd.toNumber());

    const ix = await program.methods.claim()
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, rewardAAccount: userRewardAATA, rewardBAccount: userRewardBATA, rewardAVault: poolState.rewardAVault, rewardBVault: poolState.rewardBVault, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user: userStakingAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    const afterUserRewardA = getTokenBalance(svm, userRewardAATA);
    const afterUserRewardB = getTokenBalance(svm, userRewardBATA);
    const isUserReceivedRewardA = afterUserRewardA.gt(beforeUserRewardA);
    const isUserReceivedRewardB = afterUserRewardB.gt(beforeUserRewardB);
    assert.deepStrictEqual(isUserReceivedRewardA, true);
    assert.deepStrictEqual(isUserReceivedRewardB, true);

    const userReceivedRewardA = afterUserRewardA.sub(beforeUserRewardA);
    const userReceivedRewardB = afterUserRewardB.sub(beforeUserRewardB);
    nonOwnerRewardAPhaseTwo = FUND_AMOUNT.sub(userReceivedRewardA);
    nonOwnerRewardBPhaseTwo = FUND_AMOUNT.sub(userReceivedRewardB);

    const rewardAVaultBal = getTokenBalance(svm, poolState.rewardAVault);
    const rewardBVaultBal = getTokenBalance(svm, poolState.rewardBVault);
    assert.deepStrictEqual(rewardAVaultBal.gt(new BN(0)), true);
    assert.deepStrictEqual(rewardBVaultBal.gt(new BN(0)), true);
    assert.deepStrictEqual(rewardAVaultBal.eq(nonOwnerRewardAPhaseOne.add(nonOwnerRewardAPhaseTwo)), true);
    assert.deepStrictEqual(rewardBVaultBal.eq(nonOwnerRewardBPhaseOne.add(nonOwnerRewardBPhaseTwo)), true);
  });
});
