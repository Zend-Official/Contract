use soroban_sdk::{contract, contracterror, contractevent, contracttype, Address, BytesN, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub central_admin: Address,
    pub pending_admin: Option<Address>,
    pub treasury: Address,
    pub usdc: Address,
    pub paused: bool,
}

/// These exact terms are supplied again to release, refund, or recover an order.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrderTerms {
    pub order_hash: BytesN<32>,
    pub buyer: Address,
    pub seller: Address,
    pub price: i128,
    pub buyer_fee: i128,
    pub seller_fee: i128,
    pub order_admin: Address,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Paused = 1,
    InvalidTerms = 2,
    AlreadyFunded = 3,
    NotFunded = 4,
    Overflow = 5,
    NoPendingAdmin = 6,
    InvalidBatch = 7,
}

#[contractevent]
pub struct Created {
    #[topic]
    pub id: BytesN<32>,
    pub terms: OrderTerms,
}

#[contractevent]
pub struct Closed {
    #[topic]
    pub id: BytesN<32>,
    pub action: Symbol,
    pub recipient: Address,
    pub amount: i128,
    pub treasury: Address,
    pub fee: i128,
}

#[contractevent]
pub struct Administration {
    #[topic]
    pub action: Symbol,
    pub config: Config,
}

#[contractevent]
pub struct Upgraded {
    pub wasm_hash: BytesN<32>,
}

#[contract]
pub struct Escrow;
