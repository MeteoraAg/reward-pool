import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  LAMPORTS_PER_SOL,
  SYSVAR_CLOCK_PUBKEY,
  ParsedAccountData,
} from "@solana/web3.js";
import { DualFarming } from "../../target/types/dual_farming";
import {
  getPoolPda,
  getRewardAVaultPda,
  getRewardBVaultPda,
  getStakingVaultPda,
  getUserPda,
} from "./utils";
import assert from "assert";
import { ParsedClockState } from "../clock_state";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.DualFarming as Program<DualFarming>;

const BASE_KEYPAIR = anchor.web3.Keypair.generate();
const ADMIN_KEYPAIR = anchor.web3.Keypair.generate();
const USER_KEYPAIR = anchor.web3.Keypair.generate();
const FUNDER_KEYPAIR = anchor.web3.Keypair.generate();
const REWARD_DURATION = new anchor.BN(10);
const TOKEN_DECIMAL = 3;
const TOKEN_MULTIPLIER = new anchor.BN(10 ** TOKEN_DECIMAL);
const MINT_AMOUNT = new anchor.BN(100_000).mul(TOKEN_MULTIPLIER);
const FUND_AMOUNT = new anchor.BN(10_000).mul(TOKEN_MULTIPLIER);
const DEPOSIT_AMOUNT = new anchor.BN(500).mul(TOKEN_MULTIPLIER);
const UNSTAKE_AMOUNT = new anchor.BN(500).mul(TOKEN_MULTIPLIER);

function sleep(ms: number) {
  return new Promise((res) => {
    setTimeout(res, ms);
  });
}

describe("dual-farming", () => {
  let stakingMint: anchor.web3.PublicKey = null;
  let rewardAMint: anchor.web3.PublicKey = null;
  let rewardBMint: anchor.web3.PublicKey = null;

  let stakingToken: Token = null;
  let rewardAToken: Token = null;
  let rewardBToken: Token = null;

  let userStakingATA: anchor.web3.PublicKey = null;
  let userRewardAATA: anchor.web3.PublicKey = null;
  let userRewardBATA: anchor.web3.PublicKey = null;

  let adminStakingATA: anchor.web3.PublicKey = null;
  let adminRewardAATA: anchor.web3.PublicKey = null;
  let adminRewardBATA: anchor.web3.PublicKey = null;

  let funderRewardAATA: anchor.web3.PublicKey = null;
  let funderRewardBATA: anchor.web3.PublicKey = null;

  before(async () => {
    let sig = await program.provider.connection.requestAirdrop(
      ADMIN_KEYPAIR.publicKey,
      100 * LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(sig);

    sig = await program.provider.connection.requestAirdrop(
      USER_KEYPAIR.publicKey,
      100 * LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(sig);

    sig = await program.provider.connection.requestAirdrop(
      FUNDER_KEYPAIR.publicKey,
      100 * LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(sig);

    stakingToken = await Token.createMint(
      program.provider.connection,
      ADMIN_KEYPAIR,
      ADMIN_KEYPAIR.publicKey,
      null,
      TOKEN_DECIMAL,
      TOKEN_PROGRAM_ID
    );
    stakingMint = stakingToken.publicKey;
    userStakingATA = await stakingToken.createAssociatedTokenAccount(
      USER_KEYPAIR.publicKey
    );
    adminStakingATA = await stakingToken.createAssociatedTokenAccount(
      ADMIN_KEYPAIR.publicKey
    );

    rewardAToken = await Token.createMint(
      program.provider.connection,
      ADMIN_KEYPAIR,
      ADMIN_KEYPAIR.publicKey,
      null,
      TOKEN_DECIMAL,
      TOKEN_PROGRAM_ID
    );
    rewardAMint = rewardAToken.publicKey;
    userRewardAATA = await rewardAToken.createAssociatedTokenAccount(
      USER_KEYPAIR.publicKey
    );
    adminRewardAATA = await rewardAToken.createAssociatedTokenAccount(
      ADMIN_KEYPAIR.publicKey
    );
    funderRewardAATA = await rewardAToken.createAssociatedTokenAccount(
      FUNDER_KEYPAIR.publicKey
    );

    rewardBToken = await Token.createMint(
      program.provider.connection,
      ADMIN_KEYPAIR,
      ADMIN_KEYPAIR.publicKey,
      null,
      TOKEN_DECIMAL,
      TOKEN_PROGRAM_ID
    );
    rewardBMint = rewardBToken.publicKey;
    userRewardBATA = await rewardBToken.createAssociatedTokenAccount(
      USER_KEYPAIR.publicKey
    );
    adminRewardBATA = await rewardBToken.createAssociatedTokenAccount(
      ADMIN_KEYPAIR.publicKey
    );
    funderRewardBATA = await rewardBToken.createAssociatedTokenAccount(
      FUNDER_KEYPAIR.publicKey
    );

    await stakingToken.mintTo(
      userStakingATA,
      ADMIN_KEYPAIR,
      [],
      MINT_AMOUNT.toNumber()
    );
    await rewardAToken.mintTo(
      adminRewardAATA,
      ADMIN_KEYPAIR,
      [],
      MINT_AMOUNT.toNumber()
    );
    await rewardBToken.mintTo(
      adminRewardBATA,
      ADMIN_KEYPAIR,
      [],
      MINT_AMOUNT.toNumber()
    );
    await rewardAToken.mintTo(
      funderRewardAATA,
      ADMIN_KEYPAIR,
      [],
      MINT_AMOUNT.toNumber()
    );
    await rewardBToken.mintTo(
      funderRewardBATA,
      ADMIN_KEYPAIR,
      [],
      MINT_AMOUNT.toNumber()
    );

    console.log("Program ID: ", program.programId.toString());
    console.log("Wallet: ", provider.wallet.publicKey.toString());
  });

  it("initialize dual-farming pool", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );
    const [stakingVaultAddress, _stakingVaultBump] = await getStakingVaultPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );
    const [rewardAVaultAddress, _rewardAVaultBump] = await getRewardAVaultPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );
    const [rewardBVaultAddress, _rewardBVaultBump] = await getRewardBVaultPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );
    await program.methods
      .initializePool(REWARD_DURATION)
      .accounts({
        authority: ADMIN_KEYPAIR.publicKey,
        base: BASE_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        rewardAMint,
        rewardBMint,
        rewardAVault: rewardAVaultAddress,
        rewardBVault: rewardBVaultAddress,
        stakingMint,
        stakingVault: stakingVaultAddress,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([BASE_KEYPAIR, ADMIN_KEYPAIR])
      .rpc();

    const poolState = await program.account.pool.fetch(farmingPoolAddress);
    assert.deepStrictEqual(
      poolState.authority.toBase58(),
      ADMIN_KEYPAIR.publicKey.toBase58()
    );
    assert.deepStrictEqual(
      poolState.baseKey.toBase58(),
      BASE_KEYPAIR.publicKey.toBase58()
    );
    for (const funder of poolState.funders) {
      assert.deepStrictEqual(
        funder.toBase58(),
        anchor.web3.PublicKey.default.toBase58()
      );
    }
    assert.deepStrictEqual(poolState.lastUpdateTime.toString(), "0");
    assert.deepStrictEqual(poolState.rewardDurationEnd.toString(), "0");
    assert.deepStrictEqual(poolState.rewardARate.toString(), "0");
    assert.deepStrictEqual(poolState.rewardBRate.toString(), "0");
    assert.deepStrictEqual(poolState.rewardAPerTokenStored.toString(), "0");
    assert.deepStrictEqual(poolState.rewardBPerTokenStored.toString(), "0");
    assert.deepStrictEqual(
      poolState.rewardDuration.toString(),
      REWARD_DURATION.toString()
    );
    assert.deepStrictEqual(poolState.paused, false);
    assert.deepStrictEqual(
      poolState.rewardAMint.toBase58(),
      rewardAMint.toBase58()
    );
    assert.deepStrictEqual(
      poolState.rewardBMint.toBase58(),
      rewardBMint.toBase58()
    );
    assert.deepStrictEqual(
      poolState.stakingMint.toBase58(),
      stakingMint.toBase58()
    );
    assert.deepStrictEqual(
      poolState.stakingVault.toBase58(),
      stakingVaultAddress.toBase58()
    );
    assert.deepStrictEqual(
      poolState.rewardAVault.toBase58(),
      rewardAVaultAddress.toBase58()
    );
    assert.deepStrictEqual(
      poolState.rewardBVault.toBase58(),
      rewardBVaultAddress.toBase58()
    );
  });

  it("fail to initialize pool with same token mint", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );
    const [stakingVaultAddress, _stakingVaultBump] = await getStakingVaultPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );
    const [rewardAVaultAddress, _rewardAVaultBump] = await getRewardAVaultPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );
    const [rewardBVaultAddress, _rewardBVaultBump] = await getRewardBVaultPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );
    let result = program.methods
      .initializePool(REWARD_DURATION)
      .accounts({
        authority: ADMIN_KEYPAIR.publicKey,
        base: BASE_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        rewardAMint,
        rewardBMint,
        rewardAVault: rewardAVaultAddress,
        rewardBVault: rewardBVaultAddress,
        stakingMint,
        stakingVault: stakingVaultAddress,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([BASE_KEYPAIR, ADMIN_KEYPAIR])
      .rpc();
    await assert.rejects(result);
  });

  it("create new user", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );
    const [userStakingAddress, userStakingAddressBump] = await getUserPda(
      program,
      farmingPoolAddress,
      USER_KEYPAIR.publicKey
    );

    await program.methods
      .createUser()
      .accounts({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        systemProgram: anchor.web3.SystemProgram.programId,
        user: userStakingAddress,
      })
      .signers([USER_KEYPAIR])
      .rpc();

    const [userState, poolState] = await Promise.all([
      program.account.user.fetch(userStakingAddress),
      program.account.pool.fetch(farmingPoolAddress),
    ]);

    assert.deepStrictEqual(poolState.userStakeCount.toString(), "1");
    assert.deepStrictEqual(
      userState.pool.toBase58(),
      farmingPoolAddress.toBase58()
    );
    assert.deepStrictEqual(
      userState.owner.toBase58(),
      USER_KEYPAIR.publicKey.toBase58()
    );
    assert.deepStrictEqual(userState.rewardAPerTokenComplete.toString(), "0");
    assert.deepStrictEqual(userState.rewardBPerTokenComplete.toString(), "0");
    assert.deepStrictEqual(userState.rewardAPerTokenPending.toString(), "0");
    assert.deepStrictEqual(userState.rewardBPerTokenPending.toString(), "0");
    assert.deepStrictEqual(userState.balanceStaked.toString(), "0");
    assert.deepStrictEqual(
      userState.nonce.toString(),
      userStakingAddressBump.toString()
    );
  });

  it("fail to pause a not started farm", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    let result = program.methods
      .pause()
      .accounts({
        authority: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
      })
      .signers([ADMIN_KEYPAIR])
      .rpc();

    await assert.rejects(result);
  });

  it("stake to the pool before the farming start", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    const [userStakingAddress, _userStakingAddressBump] = await getUserPda(
      program,
      farmingPoolAddress,
      USER_KEYPAIR.publicKey
    );

    let poolState = await program.account.pool.fetch(farmingPoolAddress);

    assert.deepStrictEqual(poolState.lastUpdateTime.toString(), "0");
    assert.deepStrictEqual(poolState.rewardDurationEnd.toString(), "0");

    await program.methods
      .deposit(DEPOSIT_AMOUNT)
      .accounts({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        stakeFromAccount: userStakingATA,
        stakingVault: poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userStakingAddress,
      })
      .signers([USER_KEYPAIR])
      .rpc();

    poolState = await program.account.pool.fetch(farmingPoolAddress);

    const [userState, stakingVaultBalance] = await Promise.all([
      program.account.user.fetch(userStakingAddress),
      program.provider.connection.getTokenAccountBalance(
        poolState.stakingVault
      ),
    ]);

    assert.deepStrictEqual(
      userState.balanceStaked.toString(),
      DEPOSIT_AMOUNT.toString()
    );
    assert.deepStrictEqual(
      stakingVaultBalance.value.amount,
      DEPOSIT_AMOUNT.toString()
    );
  });

  it("unstake from a not started farm", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    const [userStakingAddress, _userStakingAddressBump] = await getUserPda(
      program,
      farmingPoolAddress,
      USER_KEYPAIR.publicKey
    );

    let poolState = await program.account.pool.fetch(farmingPoolAddress);

    await program.methods
      .withdraw(DEPOSIT_AMOUNT)
      .accounts({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        stakeFromAccount: userStakingATA,
        stakingVault: poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userStakingAddress,
      })
      .signers([USER_KEYPAIR])
      .rpc();

    poolState = await program.account.pool.fetch(farmingPoolAddress);

    const [userState, stakingVaultBalance] = await Promise.all([
      program.account.user.fetch(userStakingAddress),
      program.provider.connection.getTokenAccountBalance(
        poolState.stakingVault
      ),
    ]);

    assert.deepStrictEqual(userState.balanceStaked.toString(), "0");
    assert.deepStrictEqual(stakingVaultBalance.value.amount, "0");

    // Deposit back the withdrawn amount for further testing
    await program.methods
      .deposit(DEPOSIT_AMOUNT)
      .accounts({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        stakeFromAccount: userStakingATA,
        stakingVault: poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userStakingAddress,
      })
      .signers([USER_KEYPAIR])
      .rpc();
  });

  it("fund the pool, and farming start", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    let poolState = await program.account.pool.fetch(farmingPoolAddress);
    const [beforeRewardAVaultBalance, beforeRewardBVaultBalance] =
      await Promise.all([
        program.provider.connection.getTokenAccountBalance(
          poolState.rewardAVault
        ),
        program.provider.connection.getTokenAccountBalance(
          poolState.rewardBVault
        ),
      ]);

    await program.methods
      .fund(FUND_AMOUNT, FUND_AMOUNT)
      .accounts({
        fromA: adminRewardAATA,
        fromB: adminRewardBATA,
        funder: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rewardAVault: poolState.rewardAVault,
        rewardBVault: poolState.rewardBVault,
        stakingVault: poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ADMIN_KEYPAIR])
      .rpc();

    poolState = await program.account.pool.fetch(farmingPoolAddress);

    const expectedRewardDurationEnd =
      poolState.lastUpdateTime.add(REWARD_DURATION);
    assert.deepStrictEqual(
      poolState.rewardDurationEnd.toString(),
      expectedRewardDurationEnd.toString()
    );

    const [afterRewardAVaultBalance, afterRewardBVaultBalance] =
      await Promise.all([
        program.provider.connection.getTokenAccountBalance(
          poolState.rewardAVault
        ),
        program.provider.connection.getTokenAccountBalance(
          poolState.rewardBVault
        ),
      ]);

    const rewardAVaultBalanceIncreased = new anchor.BN(
      afterRewardAVaultBalance.value.amount
    ).gt(new anchor.BN(beforeRewardAVaultBalance.value.amount));
    const rewardBVaultBalanceIncreased = new anchor.BN(
      afterRewardBVaultBalance.value.amount
    ).gt(new anchor.BN(beforeRewardBVaultBalance.value.amount));

    assert.deepStrictEqual(rewardAVaultBalanceIncreased, true);
    assert.deepStrictEqual(rewardBVaultBalanceIncreased, true);
  });

  it("unable to pause a started farm", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    let result = program.methods
      .pause()
      .accounts({
        authority: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
      })
      .signers([ADMIN_KEYPAIR])
      .rpc();

    await assert.rejects(result);
  });

  it("user able to claim when the farming is in progress", async () => {
    await sleep(1000); // Make sure to have reward to claim
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );
    const [userStakingAddress, _userStakingAddressBump] = await getUserPda(
      program,
      farmingPoolAddress,
      USER_KEYPAIR.publicKey
    );

    const [poolState, beforeUserRewardABalance, beforeUserRewardBBalance] =
      await Promise.all([
        program.account.pool.fetch(farmingPoolAddress),
        program.provider.connection.getTokenAccountBalance(userRewardAATA),
        program.provider.connection.getTokenAccountBalance(userRewardBATA),
      ]);

    await program.methods
      .claim()
      .accounts({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rewardAAccount: userRewardAATA,
        rewardBAccount: userRewardBATA,
        rewardAVault: poolState.rewardAVault,
        rewardBVault: poolState.rewardBVault,
        stakingVault: poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userStakingAddress,
      })
      .signers([USER_KEYPAIR])
      .rpc();

    const [afterUserRewardABalance, afterUserRewardBBalance] =
      await Promise.all([
        program.provider.connection.getTokenAccountBalance(userRewardAATA),
        program.provider.connection.getTokenAccountBalance(userRewardBATA),
      ]);

    const isUserReceivedRewardA = new anchor.BN(
      afterUserRewardABalance.value.amount
    ).gt(new anchor.BN(beforeUserRewardABalance.value.amount));
    const isUserReceivedRewardB = new anchor.BN(
      afterUserRewardBBalance.value.amount
    ).gt(new anchor.BN(beforeUserRewardBBalance.value.amount));

    assert.deepStrictEqual(isUserReceivedRewardA, true);
    assert.deepStrictEqual(isUserReceivedRewardB, true);
  });

  it("user able to unstake at anytime when the farming is in progress", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    const [userStakingAddress, _userStakingAddressBump] = await getUserPda(
      program,
      farmingPoolAddress,
      USER_KEYPAIR.publicKey
    );

    const [poolState, beforeUnstakeBalance, beforeUserAccount] =
      await Promise.all([
        program.account.pool.fetch(farmingPoolAddress),
        program.provider.connection.getTokenAccountBalance(userStakingATA),
        program.account.user.fetch(userStakingAddress),
      ]);
    const withdrawHalfAmount = UNSTAKE_AMOUNT.div(new anchor.BN(2));

    await program.methods
      .withdraw(withdrawHalfAmount)
      .accounts({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        stakeFromAccount: userStakingATA,
        stakingVault: poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userStakingAddress,
      })
      .signers([USER_KEYPAIR])
      .rpc();

    const [afterUnstakeBalance, afterUserAccount] = await Promise.all([
      program.provider.connection.getTokenAccountBalance(userStakingATA),
      program.account.user.fetch(userStakingAddress),
    ]);

    const isAccountBalanceIncreased = new anchor.BN(
      afterUnstakeBalance.value.amount
    ).gt(new anchor.BN(beforeUnstakeBalance.value.amount));

    assert.deepStrictEqual(isAccountBalanceIncreased, true);
    assert.deepStrictEqual(
      afterUserAccount.balanceStaked.lt(beforeUserAccount.balanceStaked),
      true
    );
  });

  it("authorize funder", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    await program.methods
      .authorizeFunder(FUNDER_KEYPAIR.publicKey)
      .accounts({
        authority: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
      })
      .signers([ADMIN_KEYPAIR])
      .rpc();

    const poolState = await program.account.pool.fetch(farmingPoolAddress);
    const funder = poolState.funders.find((f) =>
      f.equals(FUNDER_KEYPAIR.publicKey)
    );
    assert.notStrictEqual(funder, undefined);
  });

  it("extend pool reward duration", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    let beforePoolState = await program.account.pool.fetch(farmingPoolAddress);

    await program.methods
      .fund(FUND_AMOUNT, FUND_AMOUNT)
      .accounts({
        fromA: funderRewardAATA,
        fromB: funderRewardBATA,
        funder: FUNDER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rewardAVault: beforePoolState.rewardAVault,
        rewardBVault: beforePoolState.rewardBVault,
        stakingVault: beforePoolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([FUNDER_KEYPAIR])
      .rpc();

    let afterPoolState = await program.account.pool.fetch(farmingPoolAddress);

    const isRewardDurationExtended = afterPoolState.rewardDurationEnd.gt(
      beforePoolState.rewardDurationEnd
    );

    assert.deepStrictEqual(isRewardDurationExtended, true);
  });

  it("deauthorize funder", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    await program.methods
      .deauthorizeFunder(FUNDER_KEYPAIR.publicKey)
      .accounts({
        authority: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
      })
      .signers([ADMIN_KEYPAIR])
      .rpc();

    const poolState = await program.account.pool.fetch(farmingPoolAddress);
    const funder = poolState.funders.find((f) =>
      f.equals(FUNDER_KEYPAIR.publicKey)
    );
    assert.deepStrictEqual(funder, undefined);

    // Unauthorized funder cannot fund
    let result = program.methods
      .fund(FUND_AMOUNT, FUND_AMOUNT)
      .accounts({
        fromA: funderRewardAATA,
        fromB: funderRewardBATA,
        funder: FUNDER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rewardAVault: poolState.rewardAVault,
        rewardBVault: poolState.rewardBVault,
        stakingVault: poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([FUNDER_KEYPAIR])
      .rpc();

    await assert.rejects(result);
  });

  it("pause the pool when farming finished", async () => {
    // Wait pool reward period end
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    let poolState = await program.account.pool.fetch(farmingPoolAddress);
    let clockState: ParsedClockState | null;

    console.log("Wait for reward end");
    do {
      let parsedClock = await program.provider.connection.getParsedAccountInfo(
        SYSVAR_CLOCK_PUBKEY
      );
      clockState = (parsedClock.value!.data as ParsedAccountData)
        .parsed as ParsedClockState;
      await sleep(1000);
    } while (
      clockState.info.unixTimestamp <= poolState.rewardDurationEnd.toNumber()
    );
    console.log("Reward ended");

    await program.methods
      .pause()
      .accounts({
        authority: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
      })
      .signers([ADMIN_KEYPAIR])
      .rpc();

    poolState = await program.account.pool.fetch(farmingPoolAddress);
    assert.deepStrictEqual(poolState.paused, true);
  });

  it("fail to close user with claimable reward", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    const [userStakingAddress, _userStakingAddressBump] = await getUserPda(
      program,
      farmingPoolAddress,
      USER_KEYPAIR.publicKey
    );

    let result = program.methods
      .closeUser()
      .accounts({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        user: userStakingAddress,
      })
      .signers([USER_KEYPAIR])
      .rpc();

    await assert.rejects(result);
  });

  it("user claim reward from paused, and reward ended pool", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );
    const [userStakingAddress, _userStakingAddressBump] = await getUserPda(
      program,
      farmingPoolAddress,
      USER_KEYPAIR.publicKey
    );

    const [poolState, beforeUserRewardABalance, beforeUserRewardBBalance] =
      await Promise.all([
        program.account.pool.fetch(farmingPoolAddress),
        program.provider.connection.getTokenAccountBalance(userRewardAATA),
        program.provider.connection.getTokenAccountBalance(userRewardBATA),
      ]);

    await program.methods
      .claim()
      .accounts({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rewardAAccount: userRewardAATA,
        rewardBAccount: userRewardBATA,
        rewardAVault: poolState.rewardAVault,
        rewardBVault: poolState.rewardBVault,
        stakingVault: poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userStakingAddress,
      })
      .signers([USER_KEYPAIR])
      .rpc();

    const [afterUserRewardABalance, afterUserRewardBBalance] =
      await Promise.all([
        program.provider.connection.getTokenAccountBalance(userRewardAATA),
        program.provider.connection.getTokenAccountBalance(userRewardBATA),
      ]);

    const isUserReceivedRewardA = new anchor.BN(
      afterUserRewardABalance.value.amount
    ).gt(new anchor.BN(beforeUserRewardABalance.value.amount));
    const isUserReceivedRewardB = new anchor.BN(
      afterUserRewardBBalance.value.amount
    ).gt(new anchor.BN(beforeUserRewardBBalance.value.amount));

    assert.deepStrictEqual(isUserReceivedRewardA, true);
    assert.deepStrictEqual(isUserReceivedRewardB, true);
  });

  it("fail to close user with balance staked", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    const [userStakingAddress, _userStakingAddressBump] = await getUserPda(
      program,
      farmingPoolAddress,
      USER_KEYPAIR.publicKey
    );

    let result = program.methods
      .closeUser()
      .accounts({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        user: userStakingAddress,
      })
      .signers([USER_KEYPAIR])
      .rpc();

    await assert.rejects(result);
  });

  it("user unstake from paused, and reward ended pool", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    const [userStakingAddress, _userStakingAddressBump] = await getUserPda(
      program,
      farmingPoolAddress,
      USER_KEYPAIR.publicKey
    );

    const [poolState, beforeUserState, beforeUserStakingBalance] =
      await Promise.all([
        program.account.pool.fetch(farmingPoolAddress),
        program.account.user.fetch(userStakingAddress),
        program.provider.connection.getTokenAccountBalance(userStakingATA),
      ]);

    await program.methods
      .withdraw(beforeUserState.balanceStaked)
      .accounts({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        stakeFromAccount: userStakingATA,
        stakingVault: poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userStakingAddress,
      })
      .signers([USER_KEYPAIR])
      .rpc();

    const [afterUserState, afterUserStakingBalance] = await Promise.all([
      program.account.user.fetch(userStakingAddress),
      program.provider.connection.getTokenAccountBalance(userStakingATA),
    ]);

    assert.deepStrictEqual(
      afterUserState.balanceStaked.eq(new anchor.BN(0)),
      true
    );
    assert.deepStrictEqual(
      new anchor.BN(afterUserStakingBalance.value.amount).gt(
        new anchor.BN(beforeUserStakingBalance.value.amount)
      ),
      true
    );
  });

  it("fail to extend reward duration on paused pool", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    const poolState = await program.account.pool.fetch(farmingPoolAddress);

    let result = program.methods
      .fund(FUND_AMOUNT, FUND_AMOUNT)
      .accounts({
        fromA: adminRewardAATA,
        fromB: adminRewardBATA,
        funder: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        rewardAVault: poolState.rewardAVault,
        rewardBVault: poolState.rewardBVault,
        stakingVault: poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ADMIN_KEYPAIR])
      .rpc();

    await assert.rejects(result);
  });

  it("un-pause reward ended pool", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    await program.methods
      .unpause()
      .accounts({
        authority: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
      })
      .signers([ADMIN_KEYPAIR])
      .rpc();

    const poolState = await program.account.pool.fetch(farmingPoolAddress);
    assert.deepStrictEqual(poolState.paused, false);
  });

  it("close user account", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    const [userStakingAddress, _userStakingAddressBump] = await getUserPda(
      program,
      farmingPoolAddress,
      USER_KEYPAIR.publicKey
    );

    await program.methods
      .closeUser()
      .accounts({
        owner: USER_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        user: userStakingAddress,
      })
      .signers([USER_KEYPAIR])
      .rpc();

    const poolState = await program.account.pool.fetch(farmingPoolAddress);
    const closedUserAccount = await program.account.user.fetchNullable(
      userStakingAddress
    );

    assert.deepStrictEqual(poolState.userStakeCount.toString(), "0");
    assert.deepStrictEqual(closedUserAccount, null);
  });

  it("close pool", async () => {
    const [farmingPoolAddress, _farmingPoolBump] = await getPoolPda(
      program,
      stakingMint,
      BASE_KEYPAIR.publicKey
    );

    // Pause before close
    await program.methods
      .pause()
      .accounts({
        authority: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
      })
      .signers([ADMIN_KEYPAIR])
      .rpc();

    const poolAccount = await program.account.pool.fetch(farmingPoolAddress);

    await program.methods
      .closePool()
      .accounts({
        authority: ADMIN_KEYPAIR.publicKey,
        pool: farmingPoolAddress,
        refundee: ADMIN_KEYPAIR.publicKey,
        rewardARefundee: adminRewardAATA,
        rewardBRefundee: adminRewardBATA,
        rewardAVault: poolAccount.rewardAVault,
        rewardBVault: poolAccount.rewardBVault,
        stakingRefundee: adminStakingATA,
        stakingVault: poolAccount.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ADMIN_KEYPAIR])
      .rpc();

    const closedPoolAccount = await program.account.pool.fetchNullable(
      farmingPoolAddress
    );

    assert.deepStrictEqual(closedPoolAccount, null);
  });
});
