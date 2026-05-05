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
  transferToken,
  getTokenBalance,
  sendTransaction,
  warpTime,
  warpToTimestamp,
  fetchPool,
  fetchUser,
  fetchPoolNullable,
  fetchUserNullable,
} from "../utils";
import { FailedTransactionMetadata } from "litesvm";

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
const UNSTAKE_AMOUNT = new BN(500).mul(TOKEN_MULTIPLIER);

let totalFundAmount = new BN(0);

describe("dual-farming", () => {
  let stakingMint: PublicKey = null;
  let rewardAMint: PublicKey = null;
  let rewardBMint: PublicKey = null;

  let userStakingATA: PublicKey = null;
  let userRewardAATA: PublicKey = null;
  let userRewardBATA: PublicKey = null;

  let adminStakingATA: PublicKey = null;
  let adminRewardAATA: PublicKey = null;
  let adminRewardBATA: PublicKey = null;

  let funderRewardAATA: PublicKey = null;
  let funderRewardBATA: PublicKey = null;

  before(() => {
    svm.airdrop(ADMIN_KEYPAIR.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    svm.airdrop(USER_KEYPAIR.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    svm.airdrop(FUNDER_KEYPAIR.publicKey, BigInt(100 * LAMPORTS_PER_SOL));

    stakingMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    userStakingATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, stakingMint, USER_KEYPAIR.publicKey);
    adminStakingATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, stakingMint, ADMIN_KEYPAIR.publicKey);

    rewardAMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    userRewardAATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardAMint, USER_KEYPAIR.publicKey);
    adminRewardAATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardAMint, ADMIN_KEYPAIR.publicKey);
    funderRewardAATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardAMint, FUNDER_KEYPAIR.publicKey);

    rewardBMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    userRewardBATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardBMint, USER_KEYPAIR.publicKey);
    adminRewardBATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardBMint, ADMIN_KEYPAIR.publicKey);
    funderRewardBATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardBMint, FUNDER_KEYPAIR.publicKey);

    mintSplTokenTo(svm, ADMIN_KEYPAIR, stakingMint, ADMIN_KEYPAIR, USER_KEYPAIR.publicKey, MINT_AMOUNT.toNumber());
    mintSplTokenTo(svm, ADMIN_KEYPAIR, rewardAMint, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, MINT_AMOUNT.toNumber());
    mintSplTokenTo(svm, ADMIN_KEYPAIR, rewardBMint, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, MINT_AMOUNT.toNumber());
    mintSplTokenTo(svm, ADMIN_KEYPAIR, rewardAMint, ADMIN_KEYPAIR, FUNDER_KEYPAIR.publicKey, MINT_AMOUNT.toNumber());
    mintSplTokenTo(svm, ADMIN_KEYPAIR, rewardBMint, ADMIN_KEYPAIR, FUNDER_KEYPAIR.publicKey, MINT_AMOUNT.toNumber());

    console.log("Program ID: ", program.programId.toString());
  });

  it("initialize dual-farming pool", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [stakingVaultAddress] = getStakingVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [rewardAVaultAddress] = getRewardAVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [rewardBVaultAddress] = getRewardBVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);

    const ix = await program.methods
      .initializePool(REWARD_DURATION)
      .accountsPartial({
        authority: ADMIN_KEYPAIR.publicKey, base: BASE_KEYPAIR.publicKey,
        pool: farmingPoolAddress, rent: SYSVAR_RENT_PUBKEY,
        rewardAMint, rewardBMint,
        rewardAVault: rewardAVaultAddress, rewardBVault: rewardBVaultAddress,
        stakingMint, stakingVault: stakingVaultAddress,
        systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      })
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

  it("fail to initialize pool with same token mint", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [stakingVaultAddress] = getStakingVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [rewardAVaultAddress] = getRewardAVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [rewardBVaultAddress] = getRewardBVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);

    const ix = await program.methods.initializePool(REWARD_DURATION)
      .accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, base: BASE_KEYPAIR.publicKey, pool: farmingPoolAddress, rent: SYSVAR_RENT_PUBKEY, rewardAMint, rewardBMint, rewardAVault: rewardAVaultAddress, rewardBVault: rewardBVaultAddress, stakingMint, stakingVault: stakingVaultAddress, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(ADMIN_KEYPAIR, BASE_KEYPAIR);
    assert.ok(svm.sendTransaction(tx) instanceof FailedTransactionMetadata);
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

  it("fail to pause a not started farm", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const ix = await program.methods.pause()
      .accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress })
      .instruction();
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(ADMIN_KEYPAIR);
    assert.ok(svm.sendTransaction(tx) instanceof FailedTransactionMetadata);
  });

  it("stake to the pool before the farming start", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    let poolState = fetchPool(svm, program, farmingPoolAddress);
    assert.deepStrictEqual(poolState.lastUpdateTime.toString(), "0");
    assert.deepStrictEqual(poolState.rewardDurationEnd.toString(), "0");

    const ix = await program.methods.deposit(DEPOSIT_AMOUNT)
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, stakeFromAccount: userStakingATA, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user: userStakingAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    poolState = fetchPool(svm, program, farmingPoolAddress);
    const userState = fetchUser(svm, program, userStakingAddress);
    assert.deepStrictEqual(userState.balanceStaked.toString(), DEPOSIT_AMOUNT.toString());
    assert.deepStrictEqual(getTokenBalance(svm, poolState.stakingVault).toString(), DEPOSIT_AMOUNT.toString());
  });

  it("unstake from a not started farm", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    let poolState = fetchPool(svm, program, farmingPoolAddress);

    const withdrawIx = await program.methods.withdraw(DEPOSIT_AMOUNT)
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, stakeFromAccount: userStakingATA, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user: userStakingAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(withdrawIx), [USER_KEYPAIR]);

    poolState = fetchPool(svm, program, farmingPoolAddress);
    assert.deepStrictEqual(fetchUser(svm, program, userStakingAddress).balanceStaked.toString(), "0");
    assert.deepStrictEqual(getTokenBalance(svm, poolState.stakingVault).toString(), "0");
    assert.deepStrictEqual(poolState.totalStaked.toString(), "0");

    // Deposit back
    const depositIx = await program.methods.deposit(DEPOSIT_AMOUNT)
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, stakeFromAccount: userStakingATA, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user: userStakingAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(depositIx), [USER_KEYPAIR]);
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
    assert.deepStrictEqual(afterRewardAVaultBalance.gt(beforeRewardAVaultBalance), true);
    assert.deepStrictEqual(afterRewardBVaultBalance.gt(beforeRewardBVaultBalance), true);
  });

  it("unable to pause a started farm", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const ix = await program.methods.pause().accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress }).instruction();
    const tx = new Transaction().add(ix); tx.recentBlockhash = svm.latestBlockhash(); tx.sign(ADMIN_KEYPAIR);
    assert.ok(svm.sendTransaction(tx) instanceof FailedTransactionMetadata);
  });

  it("user able to claim when the farming is in progress", async () => {
    warpTime(svm, 2);
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const poolState = fetchPool(svm, program, farmingPoolAddress);
    const beforeUserRewardABalance = getTokenBalance(svm, userRewardAATA);
    const beforeUserRewardBBalance = getTokenBalance(svm, userRewardBATA);

    const ix = await program.methods.claim()
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, rewardAAccount: userRewardAATA, rewardBAccount: userRewardBATA, rewardAVault: poolState.rewardAVault, rewardBVault: poolState.rewardBVault, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user: userStakingAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    const afterUserRewardABalance = getTokenBalance(svm, userRewardAATA);
    const afterUserRewardBBalance = getTokenBalance(svm, userRewardBATA);
    const isUserReceivedRewardA = afterUserRewardABalance.gt(beforeUserRewardABalance);
    const isUserReceivedRewardB = afterUserRewardBBalance.gt(beforeUserRewardBBalance);
    assert.deepStrictEqual(isUserReceivedRewardA, true);
    assert.deepStrictEqual(isUserReceivedRewardB, true);
  });

  it("user able to unstake at anytime when the farming is in progress", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const poolState = fetchPool(svm, program, farmingPoolAddress);
    const beforeUnstakeBalance = getTokenBalance(svm, userStakingATA);
    const beforeUserAccount = fetchUser(svm, program, userStakingAddress);
    const withdrawHalfAmount = UNSTAKE_AMOUNT.div(new BN(2));

    const ix = await program.methods.withdraw(withdrawHalfAmount)
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, stakeFromAccount: userStakingATA, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user: userStakingAddress })
      .instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    const afterUnstakeBalance = getTokenBalance(svm, userStakingATA);
    const afterUserAccount = fetchUser(svm, program, userStakingAddress);
    const isAccountBalanceIncreased = afterUnstakeBalance.gt(beforeUnstakeBalance);
    assert.deepStrictEqual(isAccountBalanceIncreased, true);
    assert.deepStrictEqual(afterUserAccount.balanceStaked.lt(beforeUserAccount.balanceStaked), true);
  });

  it("authorize funder", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const ix = await program.methods.authorizeFunder(FUNDER_KEYPAIR.publicKey).accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress }).instruction();
    sendTransaction(svm, new Transaction().add(ix), [ADMIN_KEYPAIR]);
    assert.notStrictEqual(fetchPool(svm, program, farmingPoolAddress).funders.find((f) => f.equals(FUNDER_KEYPAIR.publicKey)), undefined);
  });

  it("stake at reward ended pool do not get reward", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    let poolState = fetchPool(svm, program, farmingPoolAddress);
    warpToTimestamp(svm, poolState.rewardDurationEnd.toNumber());

    const maliciousUser = Keypair.generate();
    svm.airdrop(maliciousUser.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    const maliciousUserRewardAATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardAMint, maliciousUser.publicKey);
    const maliciousUserRewardBATA = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, rewardBMint, maliciousUser.publicKey);
    mintSplTokenTo(svm, ADMIN_KEYPAIR, stakingMint, ADMIN_KEYPAIR, maliciousUser.publicKey, DEPOSIT_AMOUNT.toNumber());
    const maliciousUserStakingToken = getOrCreateAssociatedTokenAccount(svm, ADMIN_KEYPAIR, stakingMint, maliciousUser.publicKey);

    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, maliciousUser.publicKey);
    const createIx = await program.methods.createUser().accountsPartial({ owner: maliciousUser.publicKey, pool: farmingPoolAddress, systemProgram: SystemProgram.programId, user: userStakingAddress }).instruction();
    sendTransaction(svm, new Transaction().add(createIx), [maliciousUser]);

    const depositIx = await program.methods.deposit(DEPOSIT_AMOUNT).accountsPartial({ owner: maliciousUser.publicKey, user: userStakingAddress, pool: farmingPoolAddress, stakeFromAccount: maliciousUserStakingToken, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID }).instruction();
    sendTransaction(svm, new Transaction().add(depositIx), [maliciousUser]);

    warpTime(svm, 2);
    const claimIx = await program.methods.claim().accountsPartial({ owner: maliciousUser.publicKey, user: userStakingAddress, pool: farmingPoolAddress, rewardAAccount: maliciousUserRewardAATA, rewardBAccount: maliciousUserRewardBATA, rewardAVault: poolState.rewardAVault, rewardBVault: poolState.rewardBVault, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID }).instruction();
    sendTransaction(svm, new Transaction().add(claimIx), [maliciousUser]);

    assert.deepStrictEqual(getTokenBalance(svm, maliciousUserRewardAATA).eq(new BN(0)), true);
    assert.deepStrictEqual(getTokenBalance(svm, maliciousUserRewardBATA).eq(new BN(0)), true);

    const withdrawIx = await program.methods.withdraw(DEPOSIT_AMOUNT).accountsPartial({ owner: maliciousUser.publicKey, user: userStakingAddress, pool: farmingPoolAddress, stakeFromAccount: maliciousUserStakingToken, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID }).instruction();
    const closeIx = await program.methods.closeUser().accountsPartial({ owner: maliciousUser.publicKey, pool: farmingPoolAddress, user: userStakingAddress }).instruction();
    sendTransaction(svm, new Transaction().add(withdrawIx, closeIx), [maliciousUser]);
  });

  it("extend pool reward duration", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const beforePoolState = fetchPool(svm, program, farmingPoolAddress);
    const ix = await program.methods.fund(FUND_AMOUNT, FUND_AMOUNT).accountsPartial({ fromA: funderRewardAATA, fromB: funderRewardBATA, funder: FUNDER_KEYPAIR.publicKey, pool: farmingPoolAddress, rewardAVault: beforePoolState.rewardAVault, rewardBVault: beforePoolState.rewardBVault, stakingVault: beforePoolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID }).instruction();
    sendTransaction(svm, new Transaction().add(ix), [FUNDER_KEYPAIR]);
    totalFundAmount = totalFundAmount.add(FUND_AMOUNT);
    let afterPoolState = fetchPool(svm, program, farmingPoolAddress);
    const isRewardDurationExtended = afterPoolState.rewardDurationEnd.gt(beforePoolState.rewardDurationEnd);
    assert.deepStrictEqual(isRewardDurationExtended, true);
  });

  it("deauthorize funder", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const ix = await program.methods.deauthorizeFunder(FUNDER_KEYPAIR.publicKey).accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress }).instruction();
    sendTransaction(svm, new Transaction().add(ix), [ADMIN_KEYPAIR]);
    const poolState = fetchPool(svm, program, farmingPoolAddress);
    assert.deepStrictEqual(poolState.funders.find((f) => f.equals(FUNDER_KEYPAIR.publicKey)), undefined);

    const fundIx = await program.methods.fund(FUND_AMOUNT, FUND_AMOUNT).accountsPartial({ fromA: funderRewardAATA, fromB: funderRewardBATA, funder: FUNDER_KEYPAIR.publicKey, pool: farmingPoolAddress, rewardAVault: poolState.rewardAVault, rewardBVault: poolState.rewardBVault, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID }).instruction();
    const tx = new Transaction().add(fundIx); tx.recentBlockhash = svm.latestBlockhash(); tx.sign(FUNDER_KEYPAIR);
    assert.ok(svm.sendTransaction(tx) instanceof FailedTransactionMetadata);
  });

  it("cannot withdraw mistakenly deposited token if pool reward not ended", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const poolState = fetchPool(svm, program, farmingPoolAddress);
    mintSplTokenTo(svm, ADMIN_KEYPAIR, stakingMint, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, 100_000_000_000);
    transferToken(svm, ADMIN_KEYPAIR, adminStakingATA, poolState.stakingVault, ADMIN_KEYPAIR, 1_000_000_000);

    const ix = await program.methods.withdrawExtraToken().accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, withdrawToAccount: adminStakingATA }).instruction();
    const tx = new Transaction().add(ix); tx.recentBlockhash = svm.latestBlockhash(); tx.sign(ADMIN_KEYPAIR);
    assert.ok(svm.sendTransaction(tx) instanceof FailedTransactionMetadata);
  });

  it("pause the pool when farming finished", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    warpToTimestamp(svm, fetchPool(svm, program, farmingPoolAddress).rewardDurationEnd.toNumber());
    const ix = await program.methods.pause().accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress }).instruction();
    sendTransaction(svm, new Transaction().add(ix), [ADMIN_KEYPAIR]);
    assert.deepStrictEqual(fetchPool(svm, program, farmingPoolAddress).paused, true);
  });

  it("fail to close user with claimable reward", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const ix = await program.methods.closeUser().accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, user: userStakingAddress }).instruction();
    const tx = new Transaction().add(ix); tx.recentBlockhash = svm.latestBlockhash(); tx.sign(USER_KEYPAIR);
    assert.ok(svm.sendTransaction(tx) instanceof FailedTransactionMetadata);
  });

  it("user claim reward from paused, and reward ended pool", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const poolState = fetchPool(svm, program, farmingPoolAddress);
    const beforeUserRewardABalance = getTokenBalance(svm, userRewardAATA);
    const beforeUserRewardBBalance = getTokenBalance(svm, userRewardBATA);

    const ix = await program.methods.claim().accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, rewardAAccount: userRewardAATA, rewardBAccount: userRewardBATA, rewardAVault: poolState.rewardAVault, rewardBVault: poolState.rewardBVault, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user: userStakingAddress }).instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    const afterUserRewardABalance = getTokenBalance(svm, userRewardAATA);
    const afterUserRewardBBalance = getTokenBalance(svm, userRewardBATA);
    const isUserReceivedRewardA = afterUserRewardABalance.gt(beforeUserRewardABalance);
    const isUserReceivedRewardB = afterUserRewardBBalance.gt(beforeUserRewardBBalance);
    assert.deepStrictEqual(isUserReceivedRewardA, true);
    assert.deepStrictEqual(isUserReceivedRewardB, true);
    assert.deepStrictEqual(afterUserRewardABalance.toString(), totalFundAmount.toString());
    assert.deepStrictEqual(afterUserRewardBBalance.toString(), totalFundAmount.toString());
  });

  it("fail to close user with balance staked", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const ix = await program.methods.closeUser().accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, user: userStakingAddress }).instruction();
    const tx = new Transaction().add(ix); tx.recentBlockhash = svm.latestBlockhash(); tx.sign(USER_KEYPAIR);
    assert.ok(svm.sendTransaction(tx) instanceof FailedTransactionMetadata);
  });

  it("user unstake from paused, and reward ended pool", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const beforePoolState = fetchPool(svm, program, farmingPoolAddress);
    const beforeUserState = fetchUser(svm, program, userStakingAddress);
    const beforeUserStakingBalance = getTokenBalance(svm, userStakingATA);

    const ix = await program.methods.withdraw(beforeUserState.balanceStaked).accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, stakeFromAccount: userStakingATA, stakingVault: beforePoolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user: userStakingAddress }).instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    const afterUserState = fetchUser(svm, program, userStakingAddress);
    const afterUserStakingBalance = getTokenBalance(svm, userStakingATA);
    const afterPoolState = fetchPool(svm, program, farmingPoolAddress);
    assert.deepStrictEqual(afterUserState.balanceStaked.eq(new BN(0)), true);
    assert.deepStrictEqual(afterUserStakingBalance.gt(beforeUserStakingBalance), true);
    assert.deepStrictEqual(afterPoolState.totalStaked.toString(), "0");
  });

  it("fail to extend reward duration on paused pool", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const poolState = fetchPool(svm, program, farmingPoolAddress);
    const ix = await program.methods.fund(FUND_AMOUNT, FUND_AMOUNT).accountsPartial({ fromA: adminRewardAATA, fromB: adminRewardBATA, funder: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress, rewardAVault: poolState.rewardAVault, rewardBVault: poolState.rewardBVault, stakingVault: poolState.stakingVault, tokenProgram: TOKEN_PROGRAM_ID }).instruction();
    const tx = new Transaction().add(ix); tx.recentBlockhash = svm.latestBlockhash(); tx.sign(ADMIN_KEYPAIR);
    assert.ok(svm.sendTransaction(tx) instanceof FailedTransactionMetadata);
  });

  it("un-pause reward ended pool", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const ix = await program.methods.unpause().accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress }).instruction();
    sendTransaction(svm, new Transaction().add(ix), [ADMIN_KEYPAIR]);
    assert.deepStrictEqual(fetchPool(svm, program, farmingPoolAddress).paused, false);
  });

  it("close user account", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const [userStakingAddress] = getUserPda(program, farmingPoolAddress, USER_KEYPAIR.publicKey);
    const ix = await program.methods.closeUser().accountsPartial({ owner: USER_KEYPAIR.publicKey, pool: farmingPoolAddress, user: userStakingAddress }).instruction();
    sendTransaction(svm, new Transaction().add(ix), [USER_KEYPAIR]);

    const poolState = fetchPool(svm, program, farmingPoolAddress);
    const closedUserAccount = fetchUserNullable(svm, program, userStakingAddress);
    assert.deepStrictEqual(poolState.userStakeCount.toString(), "0");
    assert.deepStrictEqual(closedUserAccount, null);
  });

  it("cannot close pool if there's remaining tokens in stakingVault", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const pauseIx = await program.methods.pause().accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress }).instruction();
    sendTransaction(svm, new Transaction().add(pauseIx), [ADMIN_KEYPAIR]);
    const poolAccount = fetchPool(svm, program, farmingPoolAddress);
    const ix = await program.methods.closePool().accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress, refundee: ADMIN_KEYPAIR.publicKey, rewardARefundee: adminRewardAATA, rewardBRefundee: adminRewardBATA, rewardAVault: poolAccount.rewardAVault, rewardBVault: poolAccount.rewardBVault, stakingRefundee: adminStakingATA, stakingVault: poolAccount.stakingVault, tokenProgram: TOKEN_PROGRAM_ID }).instruction();
    const tx = new Transaction().add(ix); tx.recentBlockhash = svm.latestBlockhash(); tx.sign(ADMIN_KEYPAIR);
    assert.ok(svm.sendTransaction(tx) instanceof FailedTransactionMetadata);
  });

  it("close pool", async () => {
    const [farmingPoolAddress] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey);
    const poolAccount = fetchPool(svm, program, farmingPoolAddress);
    const withdrawExtraIx = await program.methods.withdrawExtraToken().accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress, stakingVault: poolAccount.stakingVault, tokenProgram: TOKEN_PROGRAM_ID, withdrawToAccount: adminStakingATA }).instruction();
    const closePoolIx = await program.methods.closePool().accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, pool: farmingPoolAddress, refundee: ADMIN_KEYPAIR.publicKey, rewardARefundee: adminRewardAATA, rewardBRefundee: adminRewardBATA, rewardAVault: poolAccount.rewardAVault, rewardBVault: poolAccount.rewardBVault, stakingRefundee: adminStakingATA, stakingVault: poolAccount.stakingVault, tokenProgram: TOKEN_PROGRAM_ID }).instruction();
    sendTransaction(svm, new Transaction().add(withdrawExtraIx, closePoolIx), [ADMIN_KEYPAIR]);

    const closedPoolAccount = fetchPoolNullable(svm, program, farmingPoolAddress);
    assert.deepStrictEqual(closedPoolAccount, null);
  });
});
