import { TOKEN_PROGRAM_ID, createMintToInstruction } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import assert from "assert";
import {
  getPoolPda,
  getRewardAVaultPda,
  getRewardBVaultPda,
  getStakingVaultPda,
} from "./utils";
import {
  startSvm,
  createFarmingProgram,
  createToken,
  getOrCreateAssociatedTokenAccount,
  getTokenBalance,
  sendTransaction,
  warpToTimestamp,
  warpTime,
  fetchPool,
  fetchUser,
} from "../utils";
import { LiteSVM } from "litesvm";

const TOKEN_DECIMAL = 6;
const TOKEN_MULTIPLIER = new BN(10 ** TOKEN_DECIMAL);
const FUND_AMOUNT = new BN(100).mul(TOKEN_MULTIPLIER);
const DEPOSIT_AMOUNT = new BN(100).mul(TOKEN_MULTIPLIER);

const REWARD_DURATION = new BN(7); // This creates precision loss in reward_rate

function setupUsers(svm: LiteSVM, keypairs: Keypair[]) {
  for (const k of keypairs) {
    svm.airdrop(k.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  }
}

function createAtas(svm: LiteSVM, payer: Keypair, mints: PublicKey[], userKeypair: Keypair): PublicKey[] {
  return mints.map(mint => getOrCreateAssociatedTokenAccount(svm, payer, mint, userKeypair.publicKey));
}

function mintToMultiple(svm: LiteSVM, payer: Keypair, mint: PublicKey, mintAuthority: Keypair, atas: PublicKey[]) {
  for (const ata of atas) {
    const ix = createMintToInstruction(mint, ata, mintAuthority.publicKey, 1_000_000_000_000);
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix);
    tx.sign(payer, mintAuthority);
    svm.sendTransaction(tx);
  }
}

describe("staking reward precision", () => {
  const svm = startSvm();
  const program = createFarmingProgram();

  const BASE_KEYPAIR = Keypair.generate();
  const ADMIN_KEYPAIR = Keypair.generate();
  const USER_KEYPAIR = Keypair.generate();

  let stakingMint: PublicKey = null;
  let rewardAMint: PublicKey = null;
  let rewardBMint: PublicKey = null;

  let userStakingATA: PublicKey = null;
  let userRewardAATA: PublicKey = null;
  let userRewardBATA: PublicKey = null;

  let adminRewardAATA: PublicKey = null;
  let adminRewardBATA: PublicKey = null;
  let pool: PublicKey = null;
  let stakingVault: PublicKey = null;
  let rewardAVault: PublicKey = null;
  let rewardBVault: PublicKey = null;
  let user: PublicKey = null;

  before(async () => {
    setupUsers(svm, [ADMIN_KEYPAIR, USER_KEYPAIR]);

    stakingMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    rewardAMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    rewardBMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);

    [pool] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey, REWARD_DURATION);

    [userStakingATA, userRewardAATA, userRewardBATA] = createAtas(svm, ADMIN_KEYPAIR, [stakingMint, rewardAMint, rewardBMint], USER_KEYPAIR);
    const adminAtas = createAtas(svm, ADMIN_KEYPAIR, [stakingMint, rewardAMint, rewardBMint], ADMIN_KEYPAIR);
    const [adminStakingATA] = adminAtas;
    adminRewardAATA = adminAtas[1];
    adminRewardBATA = adminAtas[2];

    mintToMultiple(svm, ADMIN_KEYPAIR, stakingMint, ADMIN_KEYPAIR, [userStakingATA, adminStakingATA]);
    mintToMultiple(svm, ADMIN_KEYPAIR, rewardAMint, ADMIN_KEYPAIR, [adminRewardAATA]);
    mintToMultiple(svm, ADMIN_KEYPAIR, rewardBMint, ADMIN_KEYPAIR, [adminRewardBATA]);

    [stakingVault] = getStakingVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey, REWARD_DURATION);
    [rewardAVault] = getRewardAVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey, REWARD_DURATION);
    [rewardBVault] = getRewardBVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey, REWARD_DURATION);

    [user] = PublicKey.findProgramAddressSync(
      [USER_KEYPAIR.publicKey.toBuffer(), pool.toBuffer()],
      program.programId
    );

    const initIx = await program.methods.initializePool(REWARD_DURATION)
      .accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, base: BASE_KEYPAIR.publicKey, pool, rent: SYSVAR_RENT_PUBKEY, rewardAMint, rewardBMint, rewardAVault, rewardBVault, stakingMint, stakingVault, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
    sendTransaction(svm, new Transaction().add(initIx), [ADMIN_KEYPAIR, BASE_KEYPAIR]);

    console.log("Program ID: ", program.programId.toString());
  });

  it("have remaining reward", async () => {
    // Create user
    const createUserIx = await program.methods.createUser()
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool, systemProgram: SystemProgram.programId, user })
      .instruction();
    sendTransaction(svm, new Transaction().add(createUserIx), [USER_KEYPAIR]);

    // Stake
    const depositIx = await program.methods.deposit(DEPOSIT_AMOUNT)
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool, stakeFromAccount: userStakingATA, stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user })
      .instruction();
    sendTransaction(svm, new Transaction().add(depositIx), [USER_KEYPAIR]);

    // Fund
    const fundIx = await program.methods.fund(FUND_AMOUNT, FUND_AMOUNT)
      .accountsPartial({ fromA: adminRewardAATA, fromB: adminRewardBATA, funder: ADMIN_KEYPAIR.publicKey, pool, rewardAVault, rewardBVault, stakingVault, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
    sendTransaction(svm, new Transaction().add(fundIx), [ADMIN_KEYPAIR]);

    const poolState = fetchPool(svm, program, pool);
    warpToTimestamp(svm, poolState.rewardDurationEnd.toNumber());

    // Claim
    const claimIx = await program.methods.claim()
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool, rewardAAccount: userRewardAATA, rewardBAccount: userRewardBATA, rewardAVault, rewardBVault, stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user })
      .instruction();
    sendTransaction(svm, new Transaction().add(claimIx), [USER_KEYPAIR]);

    const userRewardABalance = getTokenBalance(svm, userRewardAATA);
    const userRewardBBalance = getTokenBalance(svm, userRewardBATA);

    assert.strictEqual(userRewardABalance.toNumber(), FUND_AMOUNT.toNumber() - 1);
    assert.strictEqual(userRewardBBalance.toNumber(), FUND_AMOUNT.toNumber() - 1);
  });
});

describe("staking reward when no staker", () => {
  const svm = startSvm();
  const program = createFarmingProgram();

  const BASE_KEYPAIR = Keypair.generate();
  const ADMIN_KEYPAIR = Keypair.generate();
  const USER_KEYPAIR = Keypair.generate();

  let stakingMint: PublicKey = null;
  let rewardAMint: PublicKey = null;
  let rewardBMint: PublicKey = null;

  let userStakingATA: PublicKey = null;
  let userRewardAATA: PublicKey = null;
  let userRewardBATA: PublicKey = null;

  let adminRewardAATA: PublicKey = null;
  let adminRewardBATA: PublicKey = null;
  let pool: PublicKey = null;
  let stakingVault: PublicKey = null;
  let rewardAVault: PublicKey = null;
  let rewardBVault: PublicKey = null;
  let user: PublicKey = null;
  let claimedRewardA = new BN(0);
  let claimedRewardB = new BN(0);

  before(async () => {
    setupUsers(svm, [ADMIN_KEYPAIR, USER_KEYPAIR]);

    stakingMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    rewardAMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);
    rewardBMint = createToken(svm, ADMIN_KEYPAIR, ADMIN_KEYPAIR.publicKey, TOKEN_DECIMAL);

    [pool] = getPoolPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey, REWARD_DURATION);

    [userStakingATA, userRewardAATA, userRewardBATA] = createAtas(svm, ADMIN_KEYPAIR, [stakingMint, rewardAMint, rewardBMint], USER_KEYPAIR);
    const adminAtas = createAtas(svm, ADMIN_KEYPAIR, [stakingMint, rewardAMint, rewardBMint], ADMIN_KEYPAIR);
    adminRewardAATA = adminAtas[1];
    adminRewardBATA = adminAtas[2];

    mintToMultiple(svm, ADMIN_KEYPAIR, stakingMint, ADMIN_KEYPAIR, [userStakingATA, adminAtas[0]]);
    mintToMultiple(svm, ADMIN_KEYPAIR, rewardAMint, ADMIN_KEYPAIR, [adminRewardAATA]);
    mintToMultiple(svm, ADMIN_KEYPAIR, rewardBMint, ADMIN_KEYPAIR, [adminRewardBATA]);

    [stakingVault] = getStakingVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey, REWARD_DURATION);
    [rewardAVault] = getRewardAVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey, REWARD_DURATION);
    [rewardBVault] = getRewardBVaultPda(program, stakingMint, rewardAMint, rewardBMint, BASE_KEYPAIR.publicKey, REWARD_DURATION);

    [user] = PublicKey.findProgramAddressSync(
      [USER_KEYPAIR.publicKey.toBuffer(), pool.toBuffer()],
      program.programId
    );

    const initIx = await program.methods.initializePool(REWARD_DURATION)
      .accountsPartial({ authority: ADMIN_KEYPAIR.publicKey, base: BASE_KEYPAIR.publicKey, pool, rent: SYSVAR_RENT_PUBKEY, rewardAMint, rewardBMint, rewardAVault, rewardBVault, stakingMint, stakingVault, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
    sendTransaction(svm, new Transaction().add(initIx), [ADMIN_KEYPAIR, BASE_KEYPAIR]);

    console.log("Program ID: ", program.programId.toString());
  });

  it("start farm without stakers", async () => {
    const fundIx = await program.methods.fund(FUND_AMOUNT, FUND_AMOUNT)
      .accountsPartial({ fromA: adminRewardAATA, fromB: adminRewardBATA, funder: ADMIN_KEYPAIR.publicKey, pool, rewardAVault, rewardBVault, stakingVault, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
    sendTransaction(svm, new Transaction().add(fundIx), [ADMIN_KEYPAIR]);

    const poolState = fetchPool(svm, program, pool);
    assert.strictEqual(poolState.totalStaked.toNumber(), 0);
    assert.strictEqual(poolState.rewardDurationEnd.toNumber() > 0, true);
  });

  it("stake after the farms started for 1 seconds", async () => {
    warpTime(svm, 1);

    const createUserIx = await program.methods.createUser()
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool, systemProgram: SystemProgram.programId, user })
      .instruction();
    sendTransaction(svm, new Transaction().add(createUserIx), [USER_KEYPAIR]);

    const depositIx = await program.methods.deposit(DEPOSIT_AMOUNT)
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool, stakeFromAccount: userStakingATA, stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user })
      .instruction();
    sendTransaction(svm, new Transaction().add(depositIx), [USER_KEYPAIR]);

    const userState = fetchUser(svm, program, user);
    const poolState = fetchPool(svm, program, pool);
    assert.strictEqual(userState.balanceStaked.eq(DEPOSIT_AMOUNT), true);
    assert.strictEqual(poolState.totalStaked.eq(DEPOSIT_AMOUNT), true);
  });

  it("claim rewards when no stakers", async () => {
    warpTime(svm, 1);

    // Withdraw all
    const userState = fetchUser(svm, program, user);
    const withdrawIx = await program.methods.withdraw(userState.balanceStaked)
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool, stakingVault, stakeFromAccount: userStakingATA, tokenProgram: TOKEN_PROGRAM_ID, user })
      .instruction();
    sendTransaction(svm, new Transaction().add(withdrawIx), [USER_KEYPAIR]);

    assert.strictEqual(getTokenBalance(svm, stakingVault).toNumber(), 0);
    assert.strictEqual(fetchUser(svm, program, user).balanceStaked.toNumber(), 0);
    assert.strictEqual(fetchPool(svm, program, pool).totalStaked.toNumber(), 0);

    const bUserTokenA = getTokenBalance(svm, userRewardAATA);
    const bUserTokenB = getTokenBalance(svm, userRewardBATA);

    const claimIx = await program.methods.claim()
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool, rewardAVault, rewardBVault, stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user, rewardAAccount: userRewardAATA, rewardBAccount: userRewardBATA })
      .instruction();
    sendTransaction(svm, new Transaction().add(claimIx), [USER_KEYPAIR]);

    const aUserTokenA = getTokenBalance(svm, userRewardAATA);
    const aUserTokenB = getTokenBalance(svm, userRewardBATA);
    assert.strictEqual(aUserTokenA.gt(bUserTokenA), true);
    assert.strictEqual(aUserTokenB.gt(bUserTokenB), true);

    claimedRewardA = claimedRewardA.add(aUserTokenA.sub(bUserTokenA));
    claimedRewardB = claimedRewardB.add(aUserTokenB.sub(bUserTokenB));
  });

  it("no rewards when no stakers", async () => {
    warpTime(svm, 1);
    const bUserState = fetchUser(svm, program, user);
    const bPoolState = fetchPool(svm, program, pool);
    const bUserTokenA = getTokenBalance(svm, userRewardAATA);
    const bUserTokenB = getTokenBalance(svm, userRewardBATA);

    // Trigger update of reward
    const claimIx = await program.methods.claim()
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool, rewardAVault, rewardBVault, stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user, rewardAAccount: userRewardAATA, rewardBAccount: userRewardBATA })
      .instruction();
    sendTransaction(svm, new Transaction().add(claimIx), [USER_KEYPAIR]);

    const aUserState = fetchUser(svm, program, user);
    const aPoolState = fetchPool(svm, program, pool);
    assert.strictEqual(aUserState.rewardAPerTokenPending.eq(bUserState.rewardAPerTokenPending), true);
    assert.strictEqual(aUserState.rewardBPerTokenPending.eq(bUserState.rewardBPerTokenPending), true);
    assert.strictEqual(aPoolState.rewardAPerTokenStored.eq(bPoolState.rewardAPerTokenStored), true);
    assert.strictEqual(aPoolState.rewardBPerTokenStored.eq(bPoolState.rewardBPerTokenStored), true);

    const aUserTokenA = getTokenBalance(svm, userRewardAATA);
    const aUserTokenB = getTokenBalance(svm, userRewardBATA);
    assert.strictEqual(aUserTokenA.eq(bUserTokenA), true);
    assert.strictEqual(aUserTokenB.eq(bUserTokenB), true);
  });

  it("fund reward A/B when no stakers", async () => {
    const bPoolState = fetchPool(svm, program, pool);

    const fundIx = await program.methods.fund(FUND_AMOUNT, FUND_AMOUNT)
      .accountsPartial({ fromA: adminRewardAATA, fromB: adminRewardBATA, funder: ADMIN_KEYPAIR.publicKey, pool, rewardAVault, rewardBVault, stakingVault, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
    sendTransaction(svm, new Transaction().add(fundIx), [ADMIN_KEYPAIR]);

    const aPoolState = fetchPool(svm, program, pool);
    assert.strictEqual(aPoolState.rewardDurationEnd.gt(bPoolState.rewardDurationEnd), true);
    assert.strictEqual(aPoolState.rewardARateU128.gt(bPoolState.rewardARateU128), true);
    assert.strictEqual(aPoolState.rewardBRateU128.gt(bPoolState.rewardBRateU128), true);
  });

  it("stake when no stakers", async () => {
    const depositIx = await program.methods.deposit(DEPOSIT_AMOUNT)
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool, stakeFromAccount: userStakingATA, stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user })
      .instruction();
    sendTransaction(svm, new Transaction().add(depositIx), [USER_KEYPAIR]);

    const userState = fetchUser(svm, program, user);
    const poolState = fetchPool(svm, program, pool);
    assert.strictEqual(userState.balanceStaked.eq(DEPOSIT_AMOUNT), true);
    assert.strictEqual(poolState.totalStaked.eq(DEPOSIT_AMOUNT), true);
  });

  it("rewards during the period of no stakers will remain in the vault", async () => {
    let poolState = fetchPool(svm, program, pool);
    warpToTimestamp(svm, poolState.rewardDurationEnd.toNumber());

    const bUserTokenA = getTokenBalance(svm, userRewardAATA);
    const bUserTokenB = getTokenBalance(svm, userRewardBATA);

    const claimIx = await program.methods.claim()
      .accountsPartial({ owner: USER_KEYPAIR.publicKey, pool, rewardAVault, rewardBVault, stakingVault, tokenProgram: TOKEN_PROGRAM_ID, user, rewardAAccount: userRewardAATA, rewardBAccount: userRewardBATA })
      .instruction();
    sendTransaction(svm, new Transaction().add(claimIx), [USER_KEYPAIR]);

    const aUserTokenA = getTokenBalance(svm, userRewardAATA);
    const aUserTokenB = getTokenBalance(svm, userRewardBATA);

    const totalClaimedTokenA = aUserTokenA.sub(bUserTokenA);
    const totalClaimedTokenB = aUserTokenB.sub(bUserTokenB);

    const totalRewardA = FUND_AMOUNT.mul(new BN(2)).sub(claimedRewardA);
    const totalRewardB = FUND_AMOUNT.mul(new BN(2)).sub(claimedRewardB);

    const rewardARemaining = totalRewardA.sub(totalClaimedTokenA);
    const rewardBRemaining = totalRewardB.sub(totalClaimedTokenB);

    const rewardARemainingPercentage = (rewardARemaining.toNumber() / totalRewardA.toNumber()) * 100;
    const rewardBRemainingPercentage = (rewardBRemaining.toNumber() / totalRewardB.toNumber()) * 100;

    console.log("Percentage of reward A remains", rewardARemainingPercentage);
    console.log("Percentage of reward B remains", rewardBRemainingPercentage);
  });
});
