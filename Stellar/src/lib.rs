#![no_std]

// Soroban's generated client requires the declarations and implementation in
// the same module. Keep the declarations in their own source file.
include!("types.rs");

use soroban_sdk::{contractimpl, symbol_short, token, xdr::ToXdr, Env, Vec};

const CONFIG: Symbol = symbol_short!("config");
/// A conservative bound; callers must still simulate batches before submission.
pub const MAX_RECOVERY_BATCH: u32 = 10;

#[contractimpl]
impl Escrow {
    pub fn __constructor(
        env: Env,
        central_admin: Address,
        treasury: Address,
        usdc: Address,
    ) -> Result<(), Error> {
        valid_address(&env, &central_admin)?;
        valid_address(&env, &treasury)?;
        valid_address(&env, &usdc)?;
        central_admin.require_auth();
        write_config(
            &env,
            &Config {
                central_admin,
                pending_admin: None,
                treasury,
                usdc,
                paused: false,
            },
            symbol_short!("init"),
        );
        Ok(())
    }

    pub fn get_config(env: Env) -> Config {
        config(&env)
    }

    /// SHA-256 of the ScVal XDR tuple (version, contract address, terms).
    pub fn get_order_id(env: Env, terms: OrderTerms) -> BytesN<32> {
        order_id(&env, &terms)
    }

    pub fn is_funded(env: Env, id: BytesN<32>) -> bool {
        env.storage().persistent().has(&id)
    }

    pub fn create_and_fund(env: Env, terms: OrderTerms) -> Result<BytesN<32>, Error> {
        let cfg = running(&env)?;
        cfg.central_admin.require_auth();
        terms.buyer.require_auth();
        validate_terms(&env, &terms)?;
        if terms.order_admin == cfg.central_admin {
            return Err(Error::InvalidTerms);
        }
        let id = order_id(&env, &terms);
        if env.storage().persistent().has(&id) {
            return Err(Error::AlreadyFunded);
        }
        let deposit = deposit(&terms)?;
        env.storage().persistent().set(&id, &true);
        extend_ttl(&env, &id);
        token::TokenClient::new(&env, &cfg.usdc).transfer(
            &terms.buyer,
            &env.current_contract_address(),
            &deposit,
        );
        Created {
            id: id.clone(),
            terms,
        }
        .publish(&env);
        Ok(id)
    }

    pub fn release(env: Env, terms: OrderTerms) -> Result<(), Error> {
        let cfg = running(&env)?;
        terms.order_admin.require_auth();
        let id = funded_id(&env, &terms)?;
        let seller_amount = terms.price - terms.seller_fee;
        let fee = terms
            .buyer_fee
            .checked_add(terms.seller_fee)
            .ok_or(Error::Overflow)?;
        env.storage().persistent().remove(&id);
        extend_instance(&env);
        pay(&env, &cfg, &terms.seller, seller_amount);
        pay(&env, &cfg, &cfg.treasury, fee);
        Closed {
            id,
            action: symbol_short!("release"),
            recipient: terms.seller,
            amount: seller_amount,
            treasury: cfg.treasury,
            fee,
        }
        .publish(&env);
        Ok(())
    }

    pub fn refund(env: Env, terms: OrderTerms) -> Result<(), Error> {
        let cfg = running(&env)?;
        terms.order_admin.require_auth();
        let id = funded_id(&env, &terms)?;
        let amount = deposit(&terms)?;
        env.storage().persistent().remove(&id);
        extend_instance(&env);
        pay(&env, &cfg, &terms.buyer, amount);
        Closed {
            id,
            action: symbol_short!("refund"),
            recipient: terms.buyer,
            amount,
            treasury: cfg.treasury,
            fee: 0,
        }
        .publish(&env);
        Ok(())
    }

    pub fn emergency_recover(env: Env, terms: OrderTerms) -> Result<(), Error> {
        let cfg = running(&env)?;
        cfg.central_admin.require_auth();
        recover(&env, &cfg, &terms)
    }

    /// Atomic batch. Duplicate or absent entries fail and roll back the whole call.
    pub fn emergency_recover_batch(env: Env, orders: Vec<OrderTerms>) -> Result<(), Error> {
        let cfg = running(&env)?;
        cfg.central_admin.require_auth();
        if orders.is_empty() || orders.len() > MAX_RECOVERY_BATCH {
            return Err(Error::InvalidBatch);
        }
        for terms in orders.iter() {
            recover(&env, &cfg, &terms)?;
        }
        Ok(())
    }

    /// Permissionless rent maintenance, paid by the transaction submitter.
    pub fn extend_order_ttl(env: Env, terms: OrderTerms) -> Result<(), Error> {
        running(&env)?;
        let id = funded_id(&env, &terms)?;
        extend_ttl(&env, &id);
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), Error> {
        let mut cfg = running(&env)?;
        cfg.central_admin.require_auth();
        cfg.paused = true;
        write_config(&env, &cfg, symbol_short!("pause"));
        Ok(())
    }

    pub fn unpause(env: Env) {
        let mut cfg = config(&env);
        cfg.central_admin.require_auth();
        cfg.paused = false;
        write_config(&env, &cfg, symbol_short!("unpause"));
    }

    pub fn set_treasury(env: Env, treasury: Address) -> Result<(), Error> {
        let mut cfg = running(&env)?;
        cfg.central_admin.require_auth();
        valid_address(&env, &treasury)?;
        cfg.treasury = treasury;
        write_config(&env, &cfg, symbol_short!("treasury"));
        Ok(())
    }

    pub fn propose_admin(env: Env, successor: Address) -> Result<(), Error> {
        let mut cfg = running(&env)?;
        cfg.central_admin.require_auth();
        valid_address(&env, &successor)?;
        if successor == cfg.central_admin {
            return Err(Error::InvalidTerms);
        }
        cfg.pending_admin = Some(successor);
        write_config(&env, &cfg, symbol_short!("propose"));
        Ok(())
    }

    pub fn accept_admin(env: Env) -> Result<(), Error> {
        let mut cfg = running(&env)?;
        let successor = cfg.pending_admin.clone().ok_or(Error::NoPendingAdmin)?;
        successor.require_auth();
        cfg.central_admin = successor;
        cfg.pending_admin = None;
        write_config(&env, &cfg, symbol_short!("accept"));
        Ok(())
    }

    pub fn upgrade(env: Env, wasm_hash: BytesN<32>) -> Result<(), Error> {
        let cfg = running(&env)?;
        cfg.central_admin.require_auth();
        extend_instance(&env);
        env.deployer()
            .update_current_contract(soroban_sdk::ContractExecutable::Wasm(wasm_hash.clone()));
        Upgraded { wasm_hash }.publish(&env);
        Ok(())
    }
}

fn config(env: &Env) -> Config {
    env.storage().instance().get(&CONFIG).unwrap()
}

fn running(env: &Env) -> Result<Config, Error> {
    let cfg = config(env);
    if cfg.paused {
        return Err(Error::Paused);
    }
    Ok(cfg)
}

fn valid_address(env: &Env, address: &Address) -> Result<(), Error> {
    if *address == env.current_contract_address() {
        return Err(Error::InvalidTerms);
    }
    Ok(())
}

fn validate_terms(env: &Env, terms: &OrderTerms) -> Result<(), Error> {
    for address in [&terms.buyer, &terms.seller, &terms.order_admin] {
        valid_address(env, address)?;
    }
    if terms.price <= 0
        || terms.buyer_fee < 0
        || terms.seller_fee < 0
        || terms.seller_fee > terms.price
        || terms.buyer == terms.seller
        || terms.order_admin == terms.buyer
        || terms.order_admin == terms.seller
    {
        return Err(Error::InvalidTerms);
    }
    deposit(terms)?;
    Ok(())
}

fn deposit(terms: &OrderTerms) -> Result<i128, Error> {
    terms
        .price
        .checked_add(terms.buyer_fee)
        .ok_or(Error::Overflow)
}

fn order_id(env: &Env, terms: &OrderTerms) -> BytesN<32> {
    let encoded = (1_u32, env.current_contract_address(), terms.clone()).to_xdr(env);
    env.crypto().sha256(&encoded).into()
}

fn funded_id(env: &Env, terms: &OrderTerms) -> Result<BytesN<32>, Error> {
    validate_terms(env, terms)?;
    let id = order_id(env, terms);
    if !env.storage().persistent().has(&id) {
        return Err(Error::NotFunded);
    }
    Ok(id)
}

fn pay(env: &Env, cfg: &Config, recipient: &Address, amount: i128) {
    if amount > 0 {
        token::TokenClient::new(env, &cfg.usdc).transfer(
            &env.current_contract_address(),
            recipient,
            &amount,
        );
    }
}

fn recover(env: &Env, cfg: &Config, terms: &OrderTerms) -> Result<(), Error> {
    let id = funded_id(env, terms)?;
    let amount = deposit(terms)?;
    env.storage().persistent().remove(&id);
    extend_instance(env);
    pay(env, cfg, &cfg.treasury, amount);
    Closed {
        id,
        action: symbol_short!("recover"),
        recipient: cfg.treasury.clone(),
        amount,
        treasury: cfg.treasury.clone(),
        fee: 0,
    }
    .publish(env);
    Ok(())
}

fn write_config(env: &Env, cfg: &Config, action: Symbol) {
    env.storage().instance().set(&CONFIG, cfg);
    extend_instance(env);
    Administration {
        action,
        config: cfg.clone(),
    }
    .publish(env);
}

fn extend_instance(env: &Env) {
    let max = env.storage().max_ttl();
    env.storage().instance().extend_ttl(max / 2, max);
}

fn extend_ttl(env: &Env, id: &BytesN<32>) {
    let max = env.storage().max_ttl();
    env.storage().persistent().extend_ttl(id, max / 2, max);
    extend_instance(env);
}

#[cfg(test)]
mod test;
