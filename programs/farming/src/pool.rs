pub use crate::*;
use ruint::aliases::U192;

/// Rate by funding
fn calculate_reward_rate(funding_amount: u64, reward_duration: u64) -> Option<u128> {
    let funding_amount: u128 = funding_amount.into();
    let reward_duration: u128 = reward_duration.into();
    let reward_rate = funding_amount
        .checked_mul(PRECISION)?
        .checked_div(reward_duration)?;
    Some(reward_rate)
}

/// Calculate reward per token
pub fn reward_per_token(
    pool: &Account<Pool>,
    total_staked: u64,
    last_time_reward_applicable: u64,
) -> (u128, u128) {
    if total_staked == 0 {
        return (
            pool.reward_a_per_token_stored,
            pool.reward_b_per_token_stored,
        );
    }

    let time_period = U192::from(last_time_reward_applicable)
        .checked_sub(U192::from(pool.last_update_time))
        .unwrap();
    let a = pool
        .reward_a_per_token_stored
        .checked_add(
            u128::try_from(
                time_period
                    .checked_mul(U192::from(pool.get_reward_a_rate()))
                    .unwrap()
                    .checked_div(U192::from(total_staked))
                    .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();

    let b = pool
        .reward_b_per_token_stored
        .checked_add(
            u128::try_from(
                time_period
                    .checked_mul(U192::from(pool.get_reward_b_rate()))
                    .unwrap()
                    .checked_div(U192::from(total_staked))
                    .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();

    (a, b)
}

/// Farming rate after funding
pub fn rate_after_funding(
    pool: &mut Account<Pool>,
    funding_amount_a: u64,
    funding_amount_b: u64,
) -> Result<(u128, u128)> {
    let current_time = clock::Clock::get()
        .unwrap()
        .unix_timestamp
        .try_into()
        .unwrap();
    let reward_period_end = pool.reward_duration_end;

    if current_time >= reward_period_end {
        let a = calculate_reward_rate(funding_amount_a, pool.reward_duration).unwrap();
        let b = calculate_reward_rate(funding_amount_b, pool.reward_duration).unwrap();
        Ok((a, b))
    } else {
        let remaining_seconds = reward_period_end.checked_sub(current_time).unwrap();
        let leftover_a: u64 = (remaining_seconds as u128)
            .checked_mul(pool.get_reward_a_rate())
            .unwrap()
            .checked_div(PRECISION)
            .unwrap()
            .try_into()
            .unwrap(); //back to u64
        let leftover_b: u64 = (remaining_seconds as u128)
            .checked_mul(pool.get_reward_b_rate())
            .unwrap()
            .checked_div(PRECISION)
            .unwrap()
            .try_into()
            .unwrap(); //back to u64

        let total_a = leftover_a.checked_add(funding_amount_a).unwrap();
        let total_b = leftover_b.checked_add(funding_amount_b).unwrap();

        let a = calculate_reward_rate(total_a, pool.reward_duration).unwrap();
        let b = calculate_reward_rate(total_b, pool.reward_duration).unwrap();
        Ok((a, b))
    }
}

/// Calculate earned reward amount of staking user
pub fn user_earned_amount(pool: &Account<Pool>, user: &Account<User>) -> (u64, u64) {
    let a: u64 = (user.balance_staked as u128)
        .checked_mul(
            (pool.reward_a_per_token_stored as u128)
                .checked_sub(user.reward_a_per_token_complete as u128)
                .unwrap(),
        )
        .unwrap()
        .checked_div(PRECISION)
        .unwrap()
        .checked_add(user.reward_a_per_token_pending as u128)
        .unwrap()
        .try_into()
        .unwrap(); //back to u64

    let b: u64 = (user.balance_staked as u128)
        .checked_mul(
            (pool.reward_b_per_token_stored as u128)
                .checked_sub(user.reward_b_per_token_complete as u128)
                .unwrap(),
        )
        .unwrap()
        .checked_div(PRECISION)
        .unwrap()
        .checked_add(user.reward_b_per_token_pending as u128)
        .unwrap()
        .try_into()
        .unwrap(); //back to u64

    (a, b)
}

#[cfg(test)]
mod overflow_test {
    use super::*;
    #[test]
    fn test_overflow() {
        let reward_duration = 1u64;
        let funding_amount = u64::MAX;
        println!(
            "reward rate {}",
            calculate_reward_rate(funding_amount, reward_duration).unwrap()
        );
    }
}
