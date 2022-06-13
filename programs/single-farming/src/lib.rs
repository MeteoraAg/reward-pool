//! Single farming program
#![deny(rustdoc::all)]
#![allow(rustdoc::missing_doc_code_examples)]
#![warn(clippy::unwrap_used)]
#![warn(clippy::integer_arithmetic)]
#![warn(missing_docs)]

use crate::constants::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use std::convert::Into;
use std::convert::TryInto;
use std::str::FromStr;

/// Export for pool implementation
pub mod state;

declare_id!("EnkQuN7PGSdvqDmB9Z1dDRKuYnXnCeEMpUwHU37E3kQd");

#[cfg(not(feature = "dev"))]
mod constants {
    use super::*;
    pub const MIN_DURATION: u64 = 86400;
    // 1 day
    pub fn validate_admin_address(pubkey: Pubkey) -> bool {
        if pubkey == Pubkey::from_str("DHLXnJdACTY83yKwnUkeoDjqi4QBbsYGa1v8tJL76ViX").unwrap() {
            return true;
        }
        false
    }

    pub fn validate_staking_mint(pubkey: Pubkey) -> bool {
        if pubkey == Pubkey::from_str("MERt85fc5boKw3BW1eYdxonEuJNvXbiMbs6hvheau5K").unwrap() {
            return true;
        }
        false
    }
}

#[cfg(feature = "dev")]
mod constants {
    use super::*;
    pub const MIN_DURATION: u64 = 1;
    pub fn validate_admin_address(pubkey: Pubkey) -> bool {
        return true;
    }

    pub fn validate_staking_mint(pubkey: Pubkey) -> bool {
        return true;
    }
}

/// Updates the pool with the total reward per token that is due stakers
/// Using the calculator specific to that pool version which uses the reward
/// rate on the pool.
/// Optionally updates user with pending rewards and "complete" rewards.
/// A new user to the pool has their completed set to current amount due
/// such that they start earning from that point. Hence "complete" is a
/// bit misleading - it does not mean actually earned.
pub fn update_rewards(
    pool: &mut Box<Account<Pool>>,
    user: Option<&mut Box<Account<User>>>,
    total_staked: u64,
) -> Result<()> {
    let last_time_reward_applicable = pool.last_time_reward_applicable();

    let reward = pool
        .reward_per_token(total_staked, last_time_reward_applicable)
        .ok_or(ErrorCode::MathOverFlow)?;

    pool.reward_per_token_stored = reward;
    pool.last_update_time = last_time_reward_applicable;

    if let Some(u) = user {
        let amount = pool.user_earned_amount(u).ok_or(ErrorCode::MathOverFlow)?;

        u.reward_per_token_pending = amount;
        u.reward_per_token_complete = pool.reward_per_token_stored;
    }

    Ok(())
}

/// Single farming program
#[program]
pub mod single_farming {
    use super::*;

    /// Initializes a new pool
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        pool_nonce: u8,
        reward_duration: u64,
        funding_amount: u64,
    ) -> Result<()> {
        if reward_duration < MIN_DURATION {
            return Err(ErrorCode::DurationTooShort.into());
        }

        let pool = &mut ctx.accounts.pool;
        pool.nonce = pool_nonce;
        pool.staking_mint = ctx.accounts.staking_mint.key();
        pool.staking_vault = ctx.accounts.staking_vault.key();
        pool.reward_mint = ctx.accounts.reward_mint.key();
        pool.reward_vault = ctx.accounts.reward_vault.key();
        pool.reward_duration = reward_duration;
        pool.last_update_time = 0;
        pool.reward_end_timestamp = 0;
        pool.admin = ctx.accounts.admin.key();
        pool.reward_rate =
            rate_by_funding(funding_amount, reward_duration).ok_or(ErrorCode::MathOverFlow)?;
        pool.reward_per_token_stored = 0;
        Ok(())
    }

    /// Admin activates farming
    pub fn activate_farming<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ActivateFarming<'info>>,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let current_time = clock::Clock::get()
            .unwrap()
            .unix_timestamp
            .try_into()
            .unwrap();
        pool.last_update_time = current_time;
        pool.reward_end_timestamp = current_time
            .checked_add(pool.reward_duration)
            .ok_or(ErrorCode::MathOverFlow)?;
        Ok(())
    }

    /// Initialize a user staking account
    pub fn create_user<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, CreateUser<'info>>,
        nonce: u8,
    ) -> Result<()> {
        let user = &mut ctx.accounts.user;
        user.pool = *ctx.accounts.pool.to_account_info().key;
        user.owner = *ctx.accounts.owner.key;
        user.reward_per_token_complete = 0;
        user.reward_per_token_pending = 0;
        user.balance_staked = 0;
        user.nonce = nonce;
        Ok(())
    }

    /// A user deposit all tokens into the pool.
    pub fn deposit_full(ctx: Context<Deposit>) -> Result<()> {
        let full_amount = ctx.accounts.stake_from_account.amount;
        deposit(ctx, full_amount)
    }

    /// A user deposit tokens in the pool.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        if amount == 0 {
            return Err(ErrorCode::AmountMustBeGreaterThanZero.into());
        }
        let pool = &mut ctx.accounts.pool;
        let total_staked = ctx.accounts.staking_vault.amount;
        let user_opt = Some(&mut ctx.accounts.user);
        update_rewards(pool, user_opt, total_staked)?;
        ctx.accounts.user.balance_staked = ctx
            .accounts
            .user
            .balance_staked
            .checked_add(amount)
            .unwrap();
        // Transfer tokens into the stake vault.
        {
            let cpi_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.stake_from_account.to_account_info(),
                    to: ctx.accounts.staking_vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(), //todo use user account as signer
                },
            );
            token::transfer(cpi_ctx, amount)?;
        }
        Ok(())
    }

    /// A user withdraw tokens in the pool.
    pub fn withdraw(ctx: Context<Deposit>, spt_amount: u64) -> Result<()> {
        if spt_amount == 0 {
            return Err(ErrorCode::AmountMustBeGreaterThanZero.into());
        }

        let pool = &mut ctx.accounts.pool;
        let total_staked = ctx.accounts.staking_vault.amount;

        if ctx.accounts.user.balance_staked < spt_amount {
            return Err(ErrorCode::InsufficientFundWithdraw.into());
        }

        let user_opt = Some(&mut ctx.accounts.user);
        update_rewards(pool, user_opt, total_staked)?;
        ctx.accounts.user.balance_staked = ctx
            .accounts
            .user
            .balance_staked
            .checked_sub(spt_amount)
            .ok_or(ErrorCode::CannotWithdrawMoreThanBalance)?;

        // Transfer tokens from the pool vault to user vault.
        {
            let staking_mint = pool.staking_mint;
            let seeds = &[b"pool".as_ref(), staking_mint.as_ref(), &[pool.nonce]];
            let pool_signer = &[&seeds[..]];

            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.staking_vault.to_account_info(),
                    to: ctx.accounts.stake_from_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                pool_signer,
            );
            token::transfer(cpi_ctx, spt_amount)?;
        }

        Ok(())
    }

    /// A user claiming rewards
    pub fn claim(ctx: Context<ClaimReward>) -> Result<()> {
        let total_staked = ctx.accounts.staking_vault.amount;

        let pool = &mut ctx.accounts.pool;
        let user_opt = Some(&mut ctx.accounts.user);
        update_rewards(pool, user_opt, total_staked)?;

        let staking_mint = pool.staking_mint;
        let seeds = &[b"pool".as_ref(), staking_mint.as_ref(), &[pool.nonce]];
        let pool_signer = &[&seeds[..]];

        // emit pending reward
        emit!(EventPendingReward {
            value: ctx.accounts.user.reward_per_token_pending,
        });
        if ctx.accounts.user.reward_per_token_pending > 0 {
            let reward_per_token_pending = ctx.accounts.user.reward_per_token_pending;
            let vault_balance = ctx.accounts.reward_vault.amount;

            let reward_amount = if vault_balance < reward_per_token_pending {
                vault_balance
            } else {
                reward_per_token_pending
            };
            if reward_amount > 0 {
                ctx.accounts.user.reward_per_token_pending = reward_per_token_pending
                    .checked_sub(reward_amount)
                    .ok_or(ErrorCode::MathOverFlow)?;

                let cpi_ctx = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.reward_vault.to_account_info(),
                        to: ctx.accounts.reward_account.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    pool_signer,
                );
                token::transfer(cpi_ctx, reward_amount)?;
                emit!(EventClaimReward {
                    value: reward_amount,
                });
            }
        }

        Ok(())
    }

    /// Closes a users stake account. Validation is done to ensure this is only allowed when
    /// the user has nothing staked and no rewards pending.
    pub fn close_user(_ctx: Context<CloseUser>) -> Result<()> {
        Ok(())
    }
}

/// Accounts for [InitializePool](/single_farming/instruction/struct.InitializePool.html) instruction
#[derive(Accounts)]
#[instruction(pool_nonce: u8)]
pub struct InitializePool<'info> {
    /// The farming pool PDA.
    #[account(
        init,
        seeds = [b"pool".as_ref(), staking_mint.key().as_ref()], 
        bump,
        payer = admin,
        space = 250 // 1 + 177 + buffer
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// The staking vault PDA.
    #[account(
        init,
        seeds = [b"staking_vault".as_ref(), pool.key().as_ref()],
        bump,
        payer = admin,
        token::mint = staking_mint,
        token::authority = pool,
    )]
    pub staking_vault: Box<Account<'info, TokenAccount>>,
    /// The staking Mint.
    #[account(mut, constraint = validate_staking_mint(staking_mint.key()) @ ErrorCode::WrongStakingMint)]
    pub staking_mint: Box<Account<'info, Mint>>,
    /// The reward Mint.
    pub reward_mint: Box<Account<'info, Mint>>,
    /// The reward Vault PDA.
    #[account(
        init,
        seeds = [b"reward_vault".as_ref(), pool.key().as_ref()],
        bump,
        payer = admin,
        token::mint = reward_mint,
        token::authority = pool,
    )]
    pub reward_vault: Box<Account<'info, TokenAccount>>,

    /// The authority of the pool
    #[account(mut, constraint = validate_admin_address(admin.key()) @ ErrorCode::InvalidAdminWhenCreatingPool)]
    pub admin: Signer<'info>,

    /// Token Program
    pub token_program: Program<'info, Token>,
    /// Rent
    pub rent: Sysvar<'info, Rent>,
    /// System program
    pub system_program: Program<'info, System>,
}

/// Accounts for [ActivateFarming](/single_farming/instruction/struct.ActivateFarming.html) instruction
#[derive(Accounts)]
pub struct ActivateFarming<'info> {
    #[account(
        mut,
        has_one = admin,
    )]
    pub pool: Box<Account<'info, Pool>>,
    pub admin: Signer<'info>,
}

/// Accounts for [CreateUser](/single_farming/instruction/struct.CreateUser.html) instruction
#[derive(Accounts)]
#[instruction(nonce: u8)]
pub struct CreateUser<'info> {
    /// The farming pool PDA.
    pub pool: Box<Account<'info, Pool>>,
    /// User staking PDA.
    #[account(
        init,
        payer = owner,
        seeds = [
            owner.key.as_ref(),
            pool.to_account_info().key.as_ref()
        ],
        bump,
        space = 120 // 1 + 97 + buffer
    )]
    pub user: Box<Account<'info, User>>,
    /// The authority of user
    #[account(mut)]
    pub owner: Signer<'info>,
    /// System Program
    pub system_program: Program<'info, System>,
}

/// Accounts for [Deposit](/single_farming/instruction/struct.Deposit.html) instruction and [Withdraw](/single_farming/instruction/struct.Withdraw.html) instruction
#[derive(Accounts)]
pub struct Deposit<'info> {
    /// The farming pool PDA.
    #[account(
        mut,
        has_one = staking_vault,
    )]
    pub pool: Box<Account<'info, Pool>>,
    /// The staking vault PDA.
    #[account(mut)]
    pub staking_vault: Box<Account<'info, TokenAccount>>,

    /// User staking PDA.
    #[account(
        mut,
        has_one = owner,
        has_one = pool,
    )]
    pub user: Box<Account<'info, User>>,
    /// The authority of user
    pub owner: Signer<'info>,
    /// The user ATA
    #[account(mut)]
    pub stake_from_account: Box<Account<'info, TokenAccount>>,

    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Accounts for [Claim](/single_farming/instruction/struct.Claim.html) instruction
#[derive(Accounts)]
pub struct ClaimReward<'info> {
    /// The farming pool PDA.
    #[account(
        mut,
        has_one = staking_vault,
        has_one = reward_vault,
    )]
    pub pool: Box<Account<'info, Pool>>,
    /// The staking vault PDA.
    pub staking_vault: Box<Account<'info, TokenAccount>>,
    /// Vault of the pool, which store the reward to be distributed
    #[account(mut)]
    pub reward_vault: Box<Account<'info, TokenAccount>>,

    /// User staking PDA.
    #[account(
        mut,
        has_one = owner,
        has_one = pool,
    )]
    pub user: Box<Account<'info, User>>,
    /// The authority of user
    pub owner: Signer<'info>,
    /// User token account to receive farming reward
    #[account(mut)]
    pub reward_account: Box<Account<'info, TokenAccount>>,

    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Accounts for [CloseUser](/single_farming/instruction/struct.CloseUser.html) instruction
#[derive(Accounts)]
pub struct CloseUser<'info> {
    /// The farming pool PDA.
    pub pool: Box<Account<'info, Pool>>,
    #[account(
        mut,
        close = owner,
        has_one = owner,
        has_one = pool,
        constraint = user.balance_staked == 0,
        constraint = user.reward_per_token_pending == 0,
    )]
    /// User account to be close
    pub user: Account<'info, User>,
    /// Owner of the user account
    pub owner: Signer<'info>,
}

/// Contains error code from the program
#[error_code]
pub enum ErrorCode {
    /// Staking mint is wrong
    #[msg("Staking mint is wrong")]
    WrongStakingMint,
    /// Create pool with wrong admin
    #[msg("Create pool with wrong admin")]
    InvalidAdminWhenCreatingPool,
    /// Start time cannot be smaller than current time
    #[msg("Start time cannot be smaller than current time")]
    InvalidStartDate,
    /// Cannot withdraw more than deposited amount
    #[msg("Cannot withdraw more than deposited amount")]
    CannotWithdrawMoreThanBalance,
    /// Insufficient funds to withdraw.
    #[msg("Insufficient funds to withdraw.")]
    InsufficientFundWithdraw,
    /// Amount must be greater than zero.
    #[msg("Amount must be greater than zero.")]
    AmountMustBeGreaterThanZero,
    /// Duration cannot be shorter than one day.
    #[msg("Duration cannot be shorter than one day.")]
    DurationTooShort,
    /// MathOverFlow
    #[msg("MathOverFlow")]
    MathOverFlow,
}

/// EventPendingReward
#[event]
pub struct EventPendingReward {
    /// Pending reward amount
    pub value: u64,
}

/// EventClaimReward
#[event]
pub struct EventClaimReward {
    /// Claim reward amount
    pub value: u64,
}
