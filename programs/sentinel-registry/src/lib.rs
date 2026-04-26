use anchor_lang::prelude::*;

declare_id!("2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk");

#[program]
pub mod sentinel_registry {
    use super::*;

    pub fn register_policy(
        ctx: Context<RegisterPolicy>,
        agent: Pubkey,
        root: [u8; 32],
    ) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        let now = Clock::get()?.unix_timestamp;

        policy.owner = ctx.accounts.owner.key();
        policy.agent = agent;
        policy.root = root;
        policy.version = 1;
        policy.revoked = false;
        policy.created_at = now;
        policy.updated_at = now;
        policy.bump = ctx.bumps.policy;
        policy._reserved = [0u8; 100];

        emit!(PolicyRegistered {
            agent,
            owner: ctx.accounts.owner.key(),
            root,
            timestamp: now,
        });

        Ok(())
    }

    pub fn update_policy(ctx: Context<UpdatePolicy>, new_root: [u8; 32]) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        let previous_root = policy.root;
        let now = Clock::get()?.unix_timestamp;

        policy.root = new_root;
        policy.version = policy
            .version
            .checked_add(1)
            .ok_or(SentinelError::VersionOverflow)?;
        policy.updated_at = now;

        emit!(PolicyUpdated {
            agent: policy.agent,
            previous_root,
            new_root,
            version: policy.version,
            timestamp: now,
        });

        Ok(())
    }

    pub fn revoke_policy(ctx: Context<RevokePolicy>) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        let now = Clock::get()?.unix_timestamp;

        policy.revoked = true;
        policy.updated_at = now;

        emit!(PolicyRevoked {
            agent: policy.agent,
            timestamp: now,
        });

        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct PolicyRecord {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub root: [u8; 32],
    pub version: u32,
    pub revoked: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
    pub _reserved: [u8; 100],
}

#[derive(Accounts)]
#[instruction(agent: Pubkey)]
pub struct RegisterPolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + PolicyRecord::INIT_SPACE,
        seeds = [b"policy", agent.as_ref()],
        bump
    )]
    pub policy: Account<'info, PolicyRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"policy", policy.agent.as_ref()],
        bump = policy.bump,
        has_one = owner @ SentinelError::Unauthorized,
        constraint = !policy.revoked @ SentinelError::PolicyRevoked,
    )]
    pub policy: Account<'info, PolicyRecord>,
}

#[derive(Accounts)]
pub struct RevokePolicy<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"policy", policy.agent.as_ref()],
        bump = policy.bump,
        has_one = owner @ SentinelError::Unauthorized,
    )]
    pub policy: Account<'info, PolicyRecord>,
}

#[event]
pub struct PolicyRegistered {
    pub agent: Pubkey,
    pub owner: Pubkey,
    pub root: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct PolicyUpdated {
    pub agent: Pubkey,
    pub previous_root: [u8; 32],
    pub new_root: [u8; 32],
    pub version: u32,
    pub timestamp: i64,
}

#[event]
pub struct PolicyRevoked {
    pub agent: Pubkey,
    pub timestamp: i64,
}

#[error_code]
pub enum SentinelError {
    #[msg("Caller is not the policy owner")]
    Unauthorized,
    #[msg("Policy is revoked and cannot be modified")]
    PolicyRevoked,
    #[msg("Policy version counter overflowed")]
    VersionOverflow,
}
