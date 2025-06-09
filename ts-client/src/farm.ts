import { BN, EventParser } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Cluster,
  ComputeBudgetProgram,
  Connection,
  ParsedAccountData,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as BufferLayout from "buffer-layout";

import { FarmProgram, Opt, PoolState, UserState } from "./types";
import {
  chunks,
  getFarmInfo,
  getFarmProgram,
  getOrCreateATAInstruction,
  parseLogs,
} from "./utils";
import { FARM_PROGRAM_ID } from "./constant";
import { chunkedGetMultipleAccountInfos } from "@meteora-ag/dynamic-amm-sdk/dist/cjs/src/amm/utils";

const chunkedFetchMultipleUserAccount = async (
  program: FarmProgram,
  pks: PublicKey[],
  chunkSize: number = 100
) => {
  const accounts = (
    await Promise.all(
      chunks(pks, chunkSize).map((chunk) =>
        program.account.user.fetchMultiple(chunk)
      )
    )
  ).flat();

  return accounts.filter(Boolean);
};

const chunkedFetchMultiplePoolAccount = async (
  program: FarmProgram,
  pks: PublicKey[],
  chunkSize: number = 100
) => {
  const accounts = (
    await Promise.all(
      chunks(pks, chunkSize).map((chunk) =>
        program.account.pool.fetchMultiple(chunk)
      )
    )
  ).flat();

  return accounts.filter(Boolean);
};

const getAllPoolState = async (
  farmMints: Array<PublicKey>,
  program: FarmProgram
) => {
  const poolStates = (await chunkedFetchMultiplePoolAccount(
    program,
    farmMints
  )) as Array<PoolState>;

  return poolStates;
};

const MAX_CLAIM_ALL_ALLOWED = 2;

export class PoolFarmImpl {
  private opt: Opt = {
    cluster: "mainnet-beta",
  };

  private constructor(
    public address: PublicKey,
    private program: FarmProgram,
    private eventParser: EventParser,
    public poolState: PoolState,
    opt: Opt
  ) {
    this.opt = opt;
  }

  public static async create(
    connection: Connection,
    farm: PublicKey,
    opt?: { cluster?: Cluster }
  ) {
    const cluster = opt?.cluster ?? "mainnet-beta";
    const { program } = getFarmProgram(connection);
    const eventParser = new EventParser(FARM_PROGRAM_ID, program.coder);

    const poolState = await program.account.pool.fetchNullable(farm);

    if (!poolState) throw new Error("No pool state found");

    return new PoolFarmImpl(farm, program, eventParser, poolState, {
      cluster,
    });
  }

  public static async createMultiple(
    connection: Connection,
    farmList: Array<PublicKey>,
    opt?: {
      cluster?: Cluster;
    }
  ) {
    const cluster = opt?.cluster ?? "mainnet-beta";
    const { program } = getFarmProgram(connection);
    const eventParser = new EventParser(FARM_PROGRAM_ID, program.coder);

    const poolsState = await getAllPoolState(farmList, program);

    return poolsState.map((poolState, idx) => {
      const address = farmList[idx];
      return new PoolFarmImpl(address, program, eventParser, poolState, {
        cluster,
      });
    });
  }

  public static async getFarmAddressesByPoolAddress(
    poolAddress: PublicKey,
    cluster?: Cluster
  ) {
    const apiData = await getFarmInfo(cluster);

    const farms = apiData.filter(
      (farm) => farm.pool_address === poolAddress.toBase58()
    );

    if (!farms.length) throw new Error("No pool address found ");

    return farms.map((farm) => ({
      farmAddress: new PublicKey(farm.farming_pool),
      APY: farm.farming_apy,
      expired: farm.farm_expire,
    }));
  }

  public static async getFarmAddressesByLp(
    lpAddress: PublicKey,
    cluster?: Cluster
  ) {
    const apiData = await getFarmInfo(cluster);

    const farms = apiData.filter(
      (farm) => farm.lp_mint === lpAddress.toBase58()
    );

    if (!farms.length) throw new Error("No pool address found ");

    return farms.map((farm) => ({
      farmAddress: new PublicKey(farm.farming_pool),
      APY: farm.farming_apy,
      expired: farm.farm_expire,
    }));
  }

  public static async getUserBalances(
    connection: Connection,
    owner: PublicKey,
    farmMints: Array<PublicKey>
  ) {
    const { program } = getFarmProgram(connection);

    const userStakingPda = farmMints.map((mint) => {
      const [userStakingAddress] = PublicKey.findProgramAddressSync(
        [owner.toBuffer(), mint.toBuffer()],
        FARM_PROGRAM_ID
      );

      return userStakingAddress;
    });

    const usersState = (await chunkedFetchMultipleUserAccount(
      program,
      userStakingPda,
      100
    )) as Array<UserState>;
    return usersState.reduce((acc, userState) => {
      const userStaked = userState.balanceStaked;
      if (userStaked.isZero()) return acc;
      acc.set(userState.pool.toBase58(), userStaked);
      return acc;
    }, new Map<string, BN>());
  }

  public static async claimAll(
    connection: Connection,
    owner: PublicKey,
    farmMints: Array<PublicKey>,
    opt?: {
      cluster?: Cluster;
    }
  ) {
    const { program } = getFarmProgram(connection);

    const poolFarmsImpl = await PoolFarmImpl.createMultiple(
      connection,
      farmMints,
      { cluster: opt?.cluster }
    );

    const claimAllTxs = await Promise.all(
      poolFarmsImpl.map(async (poolFarmImpl) => {
        const claimMethod = await poolFarmImpl.claimMethodBuilder(owner);
        return await claimMethod.transaction();
      })
    );

    const chunkedClaimAllTx = chunks(claimAllTxs, MAX_CLAIM_ALL_ALLOWED);

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    return Promise.all(
      chunkedClaimAllTx.map(async (claimAllTx) => {
        return new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        })
          .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }))
          .add(...claimAllTx);
      })
    );
  }

  async getUserBalance(owner: PublicKey) {
    const [userStakingAddress] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), this.address.toBuffer()],
      FARM_PROGRAM_ID
    );

    const userState = await this.program.account.user.fetchNullable(
      userStakingAddress
    );

    return userState.balanceStaked;
  }

  getUserPda(owner: PublicKey) {
    const [userPda] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), this.address.toBuffer()],
      this.program.programId
    );

    return userPda;
  }

  async getUserState(owner: PublicKey) {
    const userPda = this.getUserPda(owner);

    return this.program.account.user.fetchNullable(owner);
  }

  private async createUserInstruction(owner: PublicKey) {
    const userPda = this.getUserPda(owner);

    const userState = await this.getUserState(userPda);

    if (userState) return undefined;

    return await this.program.methods
      .createUser()
      .accounts({
        owner,
        pool: this.address,
        user: userPda,
      })
      .instruction();
  }

  public async deposit(owner: PublicKey, amount: BN) {
    const userPda = this.getUserPda(owner);

    const instructions: TransactionInstruction[] = [];

    const userCreateInstruction = await this.createUserInstruction(owner);
    userCreateInstruction && instructions.push(userCreateInstruction);

    const [userStakingATA, userStakingIx] = await getOrCreateATAInstruction(
      this.poolState.stakingMint,
      owner,
      this.program.provider.connection
    );
    userStakingIx && instructions.push(userStakingIx);

    const depositTx = await this.program.methods
      .deposit(amount)
      .accounts({
        owner,
        user: userPda,
        pool: this.address,
        stakeFromAccount: userStakingATA,
        stakingVault: this.poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions(instructions)
      .transaction();

    return new Transaction({
      feePayer: owner,
      ...(await this.program.provider.connection.getLatestBlockhash(
        "finalized"
      )),
    }).add(depositTx);
  }

  public async withdraw(owner: PublicKey, amount: BN) {
    const userPda = this.getUserPda(owner);

    const instructions: TransactionInstruction[] = [];
    const [userStakingATA, userStakingIx] = await getOrCreateATAInstruction(
      this.poolState.stakingMint,
      owner,
      this.program.provider.connection
    );
    userStakingIx && instructions.push(userStakingIx);

    const withdrawTx = await this.program.methods
      .withdraw(amount)
      .accounts({
        owner,
        pool: this.address,
        stakeFromAccount: userStakingATA,
        stakingVault: this.poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userPda,
      })
      .preInstructions(instructions)
      .transaction();

    return new Transaction({
      feePayer: owner,
      ...(await this.program.provider.connection.getLatestBlockhash(
        "finalized"
      )),
    }).add(withdrawTx);
  }

  private async claimMethodBuilder(owner: PublicKey) {
    const userPda = this.getUserPda(owner);

    const isDual = !this.poolState.rewardAMint.equals(
      this.poolState.rewardBMint
    );

    const preInstructions: TransactionInstruction[] = [];

    const [[userRewardAATA, userRewardAIx], [userRewardBATA, userRewardBIx]] =
      await Promise.all(
        isDual
          ? [
              getOrCreateATAInstruction(
                this.poolState.rewardAMint,
                owner,
                this.program.provider.connection
              ),
              getOrCreateATAInstruction(
                this.poolState.rewardBMint,
                owner,
                this.program.provider.connection
              ),
            ]
          : [
              getOrCreateATAInstruction(
                this.poolState.rewardAMint,
                owner,
                this.program.provider.connection
              ),
              [undefined, undefined],
            ]
      );
    userRewardAIx && preInstructions.push(userRewardAIx);
    userRewardBIx && preInstructions.push(userRewardBIx);

    return this.program.methods
      .claim()
      .accounts({
        owner,
        pool: this.address,
        rewardAAccount: userRewardAATA,
        rewardBAccount: isDual ? userRewardBATA : userRewardAATA,
        rewardAVault: this.poolState.rewardAVault,
        rewardBVault: this.poolState.rewardBVault,
        stakingVault: this.poolState.stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: userPda,
      })
      .preInstructions(preInstructions);
  }

  public async claim(owner: PublicKey) {
    const claimTx = await (await this.claimMethodBuilder(owner)).transaction();

    return new Transaction({
      feePayer: owner,
      ...(await this.program.provider.connection.getLatestBlockhash(
        "finalized"
      )),
    }).add(claimTx);
  }

  static async getClaimableRewards(
    owner: PublicKey,
    farmMints: Array<PublicKey>,
    connection: Connection
  ) {
    const { program } = getFarmProgram(connection);

    const usersPda = farmMints.map((mint) => {
      const [userStakingAddress] = PublicKey.findProgramAddressSync(
        [owner.toBuffer(), mint.toBuffer()],
        FARM_PROGRAM_ID
      );

      return userStakingAddress;
    });

    const accountsToFetched = [SYSVAR_CLOCK_PUBKEY, ...farmMints, ...usersPda];
    const accounts = await chunkedGetMultipleAccountInfos(
      connection,
      accountsToFetched
    );

    const [clockAccountInfo, ...restAccounts] = accounts;
    const clockData = clockAccountInfo?.data;
    const onChainTime = Number(clockData.readBigInt64LE(8 * 4));

    const poolStatesMap = new Map();
    for (let i = 0; i < farmMints.length; i++) {
      const farmMint = farmMints[i];
      const poolAccount = restAccounts[i];
      const userPdaAccount = restAccounts[i + farmMints.length];

      const poolState = poolAccount?.data
        ? (program.coder.accounts.decode("pool", poolAccount.data) as PoolState)
        : undefined;
      const userState = userPdaAccount?.data
        ? (program.coder.accounts.decode(
            "user",
            userPdaAccount.data
          ) as UserState)
        : undefined;
      if (!poolState) throw new Error("Pool state not found");

      poolStatesMap.set(farmMint.toBase58(), {
        poolState,
        userState,
      });
    }

    return Array.from(poolStatesMap.entries()).reduce<
      Map<string, { rewardA: BN; rewardB: BN }>
    >((accValue, [farmMint, { poolState, userState }]) => {
      const rewardDurationEnd = poolState.rewardDurationEnd.toNumber();
      const lastTimeRewardApplicable =
        onChainTime < rewardDurationEnd ? onChainTime : rewardDurationEnd;
      const { a, b } = rewardPerToken(poolState, lastTimeRewardApplicable);

      if (!userState || !poolState) return accValue;

      const rewardA: BN = userState.balanceStaked
        .mul(a.sub(userState.rewardAPerTokenComplete))
        .div(new BN(1_000_000_000))
        .add(userState.rewardAPerTokenPending);
      const rewardB: BN = userState.balanceStaked
        .mul(b.sub(userState.rewardBPerTokenComplete))
        .div(new BN(1_000_000_000))
        .add(userState.rewardBPerTokenPending);

      if (rewardA.isZero() && rewardB.isZero()) return accValue;
      accValue.set(farmMint, {
        rewardA,
        rewardB,
      });

      return accValue;
    }, new Map());
  }
}

function rewardPerToken(pool: PoolState, lastTimeRewardApplicable: number) {
  let totalStake = pool.totalStaked;
  if (totalStake.isZero()) {
    return {
      a: pool.rewardAPerTokenStored,
      b: pool.rewardBPerTokenStored,
    };
  }
  let timePeriod = new BN(
    lastTimeRewardApplicable - pool.lastUpdateTime.toNumber()
  );
  return {
    a: pool.rewardAPerTokenStored.add(
      timePeriod.mul(pool.rewardARateU128).div(totalStake)
    ),
    b: pool.rewardBPerTokenStored.add(
      timePeriod.mul(pool.rewardBRateU128).div(totalStake)
    ),
  };
}
