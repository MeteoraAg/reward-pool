mod args;
mod utils;

use crate::args::*;
use crate::utils::*;
use anchor_client::anchor_lang::InstructionData;
use anchor_client::anchor_lang::ToAccountMetas;
use anchor_client::{Client, CommitmentConfig, Instruction, Program, Signer};
use anchor_lang::prelude::Pubkey;
use anchor_spl::token::spl_token;
use anyhow::Ok;
use anyhow::Result;
use clap::*;
use farming::Pool;
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_keypair::{read_keypair_file, Keypair};
use std::ops::Deref;
use std::rc::Rc;
use std::str::FromStr;

fn main() -> Result<()> {
    let opts = Opts::parse();
    let payer =
        read_keypair_file(opts.config_override.wallet_path).expect("Wallet keypair file not found");
    let wallet = payer.pubkey();

    println!("Wallet {:#?}", wallet);
    println!("Program ID: {:#?}", opts.config_override.program_id);

    let payer = Rc::new(payer);

    let program_id = Pubkey::from_str(opts.config_override.program_id.as_str())?;
    let client = Client::new_with_options(
        opts.config_override.cluster,
        Rc::clone(&payer),
        CommitmentConfig::finalized(),
    );

    let program = client.program(program_id)?;
    let priority_fee = opts.config_override.priority_fee;
    match opts.command {
        CliCommand::Init {
            staking_mint,
            reward_a_mint,
            reward_b_mint,
            reward_duration,
        } => {
            let base = opts.config_override.base;
            initialize_pool(
                &program,
                priority_fee,
                base,
                &payer,
                &staking_mint,
                &reward_a_mint,
                &reward_b_mint,
                reward_duration,
            )?;
        }
        CliCommand::CreateUser { pool } => {
            create_user(&program, priority_fee, &payer, &pool)?;
        }
        CliCommand::Pause { pool } => {
            pause(&program, priority_fee, &payer, &pool)?;
        }
        CliCommand::Unpause { pool } => {
            unpause(&program, priority_fee, &payer, &pool)?;
        }
        CliCommand::Deposit { pool, amount } => {
            stake(&program, priority_fee, &payer, &pool, amount)?;
        }
        CliCommand::Withdraw { pool, spt_amount } => {
            unstake(&program, priority_fee, &payer, &pool, spt_amount)?;
        }
        CliCommand::Authorize { pool, funder } => {
            authorize_funder(&program, priority_fee, &payer, &pool, &funder)?;
        }
        CliCommand::Deauthorize { pool, funder } => {
            deauthorize_funder(&program, priority_fee, &payer, &pool, &funder)?;
        }
        CliCommand::Fund {
            pool,
            amount_a,
            amount_b,
        } => {
            fund(&program, priority_fee, &payer, &pool, amount_a, amount_b)?;
        }
        CliCommand::Claim { pool } => {
            claim(&program, priority_fee, &payer, &pool)?;
        }
        CliCommand::CloseUser { pool } => {
            close_user(&program, priority_fee, &payer, &pool)?;
        }
        CliCommand::ClosePool { pool } => {
            close_pool(&program, priority_fee, &payer, &pool)?;
        }
        CliCommand::ShowInfo { pool } => {
            show_info(&program, &pool)?;
        }
        CliCommand::StakeInfo { pool } => {
            stake_info(&program, &pool, &payer.pubkey())?;
        }
        CliCommand::CheckFunderAllPool {} => {
            check_funder_all_pool(&program)?;
        }
        CliCommand::MigrateFarmingRate {} => {
            migrate_farming_rate(&program)?;
        }
    }

    Ok(())
}

fn initialize_pool<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    base_location: String,
    authority: &Keypair,
    staking_mint: &Pubkey,
    reward_a_mint: &Pubkey,
    reward_b_mint: &Pubkey,
    reward_duration: u64,
) -> Result<()> {
    let base_keypair = read_keypair_file(base_location).expect("base keypair file not found");
    let base_pubkey = base_keypair.pubkey();
    let pool_pda = get_pool_pda(
        &program,
        reward_duration,
        &staking_mint,
        reward_a_mint,
        reward_b_mint,
        &base_pubkey,
    )?;

    println!("pool address {}", pool_pda.pubkey);

    let VaultPDAs {
        staking_vault,
        reward_a_vault,
        reward_b_vault,
    } = get_vault_pdas(&program.id(), &pool_pda.pubkey);
    let (staking_vault_pubkey, _) = staking_vault;
    let (reward_a_vault_pubkey, _) = reward_a_vault;
    let (reward_b_vault_pubkey, _) = reward_b_vault;

    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::InitializePool {
            pool: pool_pda.pubkey,
            staking_mint: *staking_mint,
            staking_vault: staking_vault_pubkey,
            reward_a_mint: *reward_a_mint,
            reward_a_vault: reward_a_vault_pubkey,
            reward_b_mint: *reward_b_mint,
            reward_b_vault: reward_b_vault_pubkey,
            authority: authority.pubkey(),
            base: base_pubkey,
            system_program: anchor_lang::solana_program::system_program::ID,
            token_program: spl_token::ID,
            rent: anchor_lang::prelude::rent::ID,
        }
        .to_account_metas(None),
        data: farming::instruction::InitializePool { reward_duration }.data(),
    });

    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(authority).signer(&base_keypair);
    let signature = builder.send()?;
    println!("Signature {:?}", signature);
    Ok(())
}

pub fn create_user<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    owner: &Keypair,
    pool: &Pubkey,
) -> Result<()> {
    let UserPDA { user } = get_user_pda(pool, &owner.pubkey(), &program.id());
    let (user_pubkey, _) = user;

    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::CreateUser {
            pool: *pool,
            user: user_pubkey,
            owner: owner.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
        data: farming::instruction::CreateUser {}.data(),
    });
    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(owner);

    let signature = builder.send()?;
    println!("Signature {:?}", signature);
    Ok(())
}

pub fn pause<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    authority: &Keypair,
    pool: &Pubkey,
) -> Result<()> {
    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::Pause {
            pool: *pool,
            authority: authority.pubkey(),
        }
        .to_account_metas(None),
        data: farming::instruction::Pause {}.data(),
    });
    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(authority);

    let signature = builder.send()?;
    println!("Signature {:?}", signature);
    Ok(())
}

pub fn unpause<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    authority: &Keypair,
    pool: &Pubkey,
) -> Result<()> {
    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::Unpause {
            pool: *pool,
            authority: authority.pubkey(),
        }
        .to_account_metas(None),
        data: farming::instruction::Unpause {}.data(),
    });
    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(authority);

    let signature = builder.send()?;
    println!("Signature {:?}", signature);
    Ok(())
}

pub fn stake<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    owner: &Keypair,
    pool_pda: &Pubkey,
    amount: u64,
) -> Result<()> {
    let pool = get_pool(program, *pool_pda)?;
    let UserPDA { user } = get_user_pda(pool_pda, &owner.pubkey(), &program.id());
    let (user_pubkey, _) = user;

    let stake_from_account = get_or_create_ata(&program, &owner.pubkey(), &pool.staking_mint)?;

    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::Deposit {
            pool: *pool_pda,
            staking_vault: pool.staking_vault,
            stake_from_account,
            user: user_pubkey,
            owner: owner.pubkey(),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: farming::instruction::Deposit { amount }.data(),
    });
    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(owner);

    let signature = builder.send()?;
    println!("Signature {:?}", signature);

    Ok(())
}

pub fn unstake<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    owner: &Keypair,
    pool_pda: &Pubkey,
    spt_amount: u64,
) -> Result<()> {
    let pool = get_pool(program, *pool_pda)?;
    let UserPDA { user } = get_user_pda(pool_pda, &owner.pubkey(), &program.id());
    let (user_pubkey, _) = user;
    let stake_from_account = get_or_create_ata(&program, &owner.pubkey(), &pool.staking_mint)?;

    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::Deposit {
            pool: *pool_pda,
            staking_vault: pool.staking_vault,
            stake_from_account,
            user: user_pubkey,
            owner: owner.pubkey(),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: farming::instruction::Withdraw { spt_amount }.data(),
    });
    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(owner);

    let signature = builder.send()?;
    println!("Signature {:?}", signature);

    Ok(())
}

pub fn authorize_funder<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    authority: &Keypair,
    pool: &Pubkey,
    funder_to_add: &Pubkey,
) -> Result<()> {
    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::FunderChange {
            pool: *pool,
            authority: authority.pubkey(),
        }
        .to_account_metas(None),
        data: farming::instruction::AuthorizeFunder {
            funder_to_add: *funder_to_add,
        }
        .data(),
    });
    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(authority);

    let signature = builder.send()?;
    println!("Signature {:?}", signature);
    Ok(())
}

pub fn deauthorize_funder<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    authority: &Keypair,
    pool: &Pubkey,
    funder_to_remove: &Pubkey,
) -> Result<()> {
    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::FunderChange {
            pool: *pool,
            authority: authority.pubkey(),
        }
        .to_account_metas(None),
        data: farming::instruction::DeauthorizeFunder {
            funder_to_remove: *funder_to_remove,
        }
        .data(),
    });
    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(authority);

    let signature = builder.send()?;
    println!("Signature {:?}", signature);
    Ok(())
}

pub fn fund<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    funder: &Keypair,
    pool_pda: &Pubkey,
    amount_a: u64,
    amount_b: u64,
) -> Result<()> {
    let pool = get_pool(program, *pool_pda)?;
    let from_a = get_or_create_ata(&program, &funder.pubkey(), &pool.reward_a_mint)?;
    let from_b = get_or_create_ata(&program, &funder.pubkey(), &pool.reward_b_mint)?;

    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::Fund {
            pool: *pool_pda,
            staking_vault: pool.staking_vault,
            reward_a_vault: pool.reward_a_vault,
            reward_b_vault: pool.reward_b_vault,
            funder: funder.pubkey(),
            from_a,
            from_b,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: farming::instruction::Fund { amount_a, amount_b }.data(),
    });
    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(funder);

    let signature = builder.send()?;
    println!("Signature {:?}", signature);
    Ok(())
}

pub fn claim<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    owner: &Keypair,
    pool_pda: &Pubkey,
) -> Result<()> {
    let pool = get_pool(program, *pool_pda)?;
    let UserPDA { user } = get_user_pda(pool_pda, &owner.pubkey(), &program.id());
    let (user_pubkey, _) = user;

    let reward_a_account = get_or_create_ata(&program, &owner.pubkey(), &pool.reward_a_mint)?;
    let reward_b_account = get_or_create_ata(&program, &owner.pubkey(), &pool.reward_b_mint)?;

    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::ClaimReward {
            pool: *pool_pda,
            staking_vault: pool.staking_vault,
            reward_a_vault: pool.reward_a_vault,
            reward_b_vault: pool.reward_b_vault,
            user: user_pubkey,
            owner: owner.pubkey(),
            reward_a_account,
            reward_b_account,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: farming::instruction::Claim {}.data(),
    });
    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(owner);

    let signature = builder.send()?;
    println!("Signature {:?}", signature);
    Ok(())
}

pub fn close_user<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    owner: &Keypair,
    pool_pda: &Pubkey,
) -> Result<()> {
    let UserPDA { user } = get_user_pda(pool_pda, &owner.pubkey(), &program.id());
    let (user_pubkey, _) = user;

    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::CloseUser {
            pool: *pool_pda,
            user: user_pubkey,
            owner: owner.pubkey(),
        }
        .to_account_metas(None),
        data: farming::instruction::CloseUser {}.data(),
    });
    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(owner);

    let signature = builder.send()?;
    println!("Signature {:?}", signature);
    Ok(())
}

pub fn close_pool<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    priority_fee: Option<u64>,
    authority: &Keypair,
    pool_pda: &Pubkey,
) -> Result<()> {
    let pool = get_pool(program, *pool_pda)?;
    let staking_refundee = get_or_create_ata(&program, &authority.pubkey(), &pool.staking_mint)?;
    let reward_a_refundee = get_or_create_ata(&program, &authority.pubkey(), &pool.reward_a_mint)?;
    let reward_b_refundee = get_or_create_ata(&program, &authority.pubkey(), &pool.reward_b_mint)?;

    let mut instructions = vec![];
    if let Some(priority_fee) = priority_fee {
        instructions.push(ComputeBudgetInstruction::set_compute_unit_price(
            priority_fee,
        ));
    }
    instructions.push(Instruction {
        program_id: program.id(),
        accounts: farming::accounts::ClosePool {
            refundee: authority.pubkey(),
            staking_refundee,
            reward_a_refundee,
            reward_b_refundee,
            pool: *pool_pda,
            authority: authority.pubkey(),
            staking_vault: pool.staking_vault,
            reward_a_vault: pool.reward_a_vault,
            reward_b_vault: pool.reward_b_vault,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: farming::instruction::ClosePool {}.data(),
    });
    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));
    let builder = builder.signer(authority);

    let signature = builder.send()?;
    println!("Signature {:?}", signature);
    Ok(())
}

pub fn show_info<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    pool_pda: &Pubkey,
) -> Result<()> {
    let pool = get_pool(program, *pool_pda)?;
    println!("pool data {:#?}", pool);
    println!("pool_pubkey {:#?}", pool_pda);
    println!("user_stake_count {:#?}", pool.user_stake_count);
    println!("staking_vault {:#?}", pool.staking_vault);

    Ok(())
}

pub fn stake_info<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    pool_pda: &Pubkey,
    user: &Pubkey,
) -> Result<()> {
    let UserPDA { user } = get_user_pda(pool_pda, &user, &program.id());
    let (user_pubkey, _) = user;
    let user = get_user(&program, user_pubkey)?;
    println!("balance_staked {:#?}", user.balance_staked);
    println!(
        "reward_a_per_token_complete {:#?}",
        user.reward_a_per_token_complete
    );
    println!(
        "reward_a_per_token_pending {:#?}",
        user.reward_a_per_token_pending
    );
    println!(
        "reward_b_per_token_complete {:#?}",
        user.reward_b_per_token_complete
    );
    println!(
        "reward_b_per_token_pending {:#?}",
        user.reward_b_per_token_pending
    );
    Ok(())
}

fn check_funder_all_pool<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
) -> Result<()> {
    let pools: Vec<(Pubkey, Pool)> = program.accounts::<Pool>(vec![]).unwrap();

    println!("len pool {}", pools.len());

    for pool in pools.iter() {
        assert_eq!(pool.1.reward_a_rate_u128, 0);
        assert_eq!(pool.1.reward_b_rate_u128, 0);
    }
    Ok(())
}

fn migrate_farming_rate<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
) -> Result<()> {
    let pools: Vec<(Pubkey, Pool)> = program.accounts::<Pool>(vec![]).unwrap();

    println!("len pool {}", pools.len());

    for pool in pools.iter() {
        let pool_state = pool.1.clone();
        let mut should_migrate = false;
        if pool_state.reward_a_rate_u128 == 0 && pool_state._reward_a_rate != 0 {
            should_migrate = true;
        }
        if pool_state.reward_b_rate_u128 == 0 && pool_state._reward_b_rate != 0 {
            should_migrate = true;
        }

        if should_migrate {
            let builder = program
                .request()
                .accounts(farming::accounts::MigrateFarmingRate { pool: pool.0 })
                .args(farming::instruction::MigrateFarmingRate {});
            let signature = builder.send()?;
            println!("Migrate pool {} signature {:?}", pool.0, signature);
        }
    }
    Ok(())
}
