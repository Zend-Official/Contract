use super::*;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, MockAuth, MockAuthInvoke},
    IntoVal,
};

struct Fixture {
    env: Env,
    contract: Address,
    usdc: Address,
    central: Address,
    treasury: Address,
    terms: OrderTerms,
}

impl Fixture {
    fn new() -> Self {
        let mut env = Env::default();
        env.set_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        let central = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        let contract = env.register(Escrow, (central.clone(), treasury.clone(), usdc.clone()));
        let terms = OrderTerms {
            order_hash: BytesN::from_array(&env, &[1; 32]),
            buyer: Address::generate(&env),
            seller: Address::generate(&env),
            price: 1_000,
            buyer_fee: 25,
            seller_fee: 25,
            order_admin: Address::generate(&env),
        };
        token::StellarAssetClient::new(&env, &usdc).mint(&terms.buyer, &10_000);
        Self {
            env,
            contract,
            usdc,
            central,
            treasury,
            terms,
        }
    }

    fn client(&self) -> EscrowClient<'_> {
        EscrowClient::new(&self.env, &self.contract)
    }

    fn balance(&self, address: &Address) -> i128 {
        token::TokenClient::new(&self.env, &self.usdc).balance(address)
    }
}

#[test]
fn release_pays_committed_destinations_and_closes_once() {
    let f = Fixture::new();
    let c = f.client();
    let id = c.create_and_fund(&f.terms);
    assert_eq!(id, c.get_order_id(&f.terms));
    assert_eq!(f.balance(&f.contract), 1_025);
    assert_eq!(f.balance(&f.treasury), 0);
    assert_eq!(
        c.try_create_and_fund(&f.terms),
        Err(Ok(Error::AlreadyFunded))
    );
    c.release(&f.terms);
    assert!(!c.is_funded(&id));
    assert_eq!(f.balance(&f.terms.seller), 975);
    assert_eq!(f.balance(&f.treasury), 50);
    assert_eq!(f.balance(&f.contract), 0);
    assert_eq!(c.try_release(&f.terms), Err(Ok(Error::NotFunded)));
    assert_eq!(c.try_refund(&f.terms), Err(Ok(Error::NotFunded)));
}

#[test]
fn refund_returns_buyer_fee_and_collects_no_fee() {
    let f = Fixture::new();
    let c = f.client();
    c.create_and_fund(&f.terms);
    c.refund(&f.terms);
    assert_eq!(f.balance(&f.terms.buyer), 10_000);
    assert_eq!(f.balance(&f.terms.seller), 0);
    assert_eq!(f.balance(&f.treasury), 0);
    assert_eq!(f.balance(&f.contract), 0);
}

#[test]
fn creation_requires_central_approval_and_buyer_debit_authorization() {
    let f = Fixture::new();
    let c = f.client();
    // A buyer's complete authorization, including its token debit, cannot
    // replace the central admin's approval of the order admin and terms.
    let transfer = MockAuthInvoke {
        contract: &f.usdc,
        fn_name: "transfer",
        args: (f.terms.buyer.clone(), f.contract.clone(), 1_025_i128).into_val(&f.env),
        sub_invokes: &[],
    };
    let create = MockAuthInvoke {
        contract: &f.contract,
        fn_name: "create_and_fund",
        args: (f.terms.clone(),).into_val(&f.env),
        sub_invokes: &[transfer],
    };
    assert!(c
        .mock_auths(&[MockAuth {
            address: &f.terms.buyer,
            invoke: &create
        }])
        .try_create_and_fund(&f.terms)
        .is_err());

    let create = MockAuthInvoke {
        contract: &f.contract,
        fn_name: "create_and_fund",
        args: (f.terms.clone(),).into_val(&f.env),
        sub_invokes: &[],
    };
    assert!(c
        .mock_auths(&[MockAuth {
            address: &f.central,
            invoke: &create
        }])
        .try_create_and_fund(&f.terms)
        .is_err());
    assert_eq!(f.balance(&f.terms.buyer), 10_000);
    assert!(!c.is_funded(&c.get_order_id(&f.terms)));
}

#[test]
fn only_the_committed_order_admin_can_normally_settle() {
    let f = Fixture::new();
    let c = f.client();
    c.create_and_fund(&f.terms);
    for signer in [&f.terms.buyer, &f.terms.seller, &f.central] {
        for function in ["release", "refund"] {
            let invoke = MockAuthInvoke {
                contract: &f.contract,
                fn_name: function,
                args: (f.terms.clone(),).into_val(&f.env),
                sub_invokes: &[],
            };
            let auths = [MockAuth {
                address: signer,
                invoke: &invoke,
            }];
            let restricted = c.mock_auths(&auths);
            if function == "release" {
                assert!(restricted.try_release(&f.terms).is_err());
            } else {
                assert!(restricted.try_refund(&f.terms).is_err());
            }
        }
    }
    // A fresh address, with no funded classic account in this unit-test host,
    // supplies the only release authorization.
    c.mock_auths(&[MockAuth {
        address: &f.terms.order_admin,
        invoke: &MockAuthInvoke {
            contract: &f.contract,
            fn_name: "release",
            args: (f.terms.clone(),).into_val(&f.env),
            sub_invokes: &[],
        },
    }])
    .release(&f.terms);
    assert_eq!(f.balance(&f.terms.seller), 975);
}

#[test]
fn altered_terms_cannot_unlock_an_existing_deposit() {
    let f = Fixture::new();
    let c = f.client();
    let id = c.create_and_fund(&f.terms);
    let mut altered = f.terms.clone();
    altered.buyer_fee += 1;
    assert_ne!(c.get_order_id(&altered), id);
    assert_eq!(c.try_refund(&altered), Err(Ok(Error::NotFunded)));
    altered = f.terms.clone();
    altered.order_admin = Address::generate(&f.env);
    assert_eq!(c.try_release(&altered), Err(Ok(Error::NotFunded)));
    assert_eq!(f.balance(&f.contract), 1_025);
}

#[test]
fn pause_blocks_all_writes_except_central_unpause() {
    let f = Fixture::new();
    let c = f.client();
    let id = c.create_and_fund(&f.terms);
    c.pause();
    assert!(c.get_config().paused);
    assert!(c.is_funded(&id));
    assert_eq!(c.try_pause(), Err(Ok(Error::Paused)));
    assert_eq!(c.try_create_and_fund(&f.terms), Err(Ok(Error::Paused)));
    assert_eq!(c.try_release(&f.terms), Err(Ok(Error::Paused)));
    assert_eq!(c.try_refund(&f.terms), Err(Ok(Error::Paused)));
    assert_eq!(c.try_emergency_recover(&f.terms), Err(Ok(Error::Paused)));
    assert_eq!(
        c.try_emergency_recover_batch(&Vec::new(&f.env)),
        Err(Ok(Error::Paused))
    );
    assert_eq!(c.try_extend_order_ttl(&f.terms), Err(Ok(Error::Paused)));
    assert_eq!(c.try_set_treasury(&f.treasury), Err(Ok(Error::Paused)));
    assert_eq!(c.try_propose_admin(&f.terms.seller), Err(Ok(Error::Paused)));
    assert_eq!(c.try_accept_admin(), Err(Ok(Error::Paused)));
    assert_eq!(
        c.try_upgrade(&BytesN::from_array(&f.env, &[0; 32])),
        Err(Ok(Error::Paused))
    );
    assert!(c.set_auths(&[]).try_unpause().is_err());
    c.unpause();
    c.refund(&f.terms);
}

#[test]
fn admin_transfer_requires_successor_acceptance_and_revokes_old_admin() {
    let f = Fixture::new();
    let c = f.client();
    let next = Address::generate(&f.env);
    assert_eq!(c.try_accept_admin(), Err(Ok(Error::NoPendingAdmin)));
    assert!(c.set_auths(&[]).try_propose_admin(&next).is_err());
    c.propose_admin(&next);
    assert_eq!(c.get_config().central_admin, f.central);
    assert!(c.set_auths(&[]).try_accept_admin().is_err());
    c.accept_admin();
    assert_eq!(c.get_config().central_admin, next);
    assert_eq!(c.get_config().pending_admin, None);
    let invoke = MockAuthInvoke {
        contract: &f.contract,
        fn_name: "pause",
        args: ().into_val(&f.env),
        sub_invokes: &[],
    };
    assert!(c
        .mock_auths(&[MockAuth {
            address: &f.central,
            invoke: &invoke
        }])
        .try_pause()
        .is_err());
}

#[test]
fn recovery_requires_central_admin_and_uses_current_treasury() {
    let f = Fixture::new();
    let c = f.client();
    let id = c.create_and_fund(&f.terms);
    let next = Address::generate(&f.env);
    assert!(c.set_auths(&[]).try_set_treasury(&next).is_err());
    c.set_treasury(&next);
    assert!(c.set_auths(&[]).try_emergency_recover(&f.terms).is_err());
    c.emergency_recover(&f.terms);
    assert!(!c.is_funded(&id));
    assert_eq!(f.balance(&next), 1_025);
    assert_eq!(f.balance(&f.treasury), 0);
}

#[test]
fn duplicate_recovery_rolls_back_entire_batch() {
    let f = Fixture::new();
    let c = f.client();
    let id = c.create_and_fund(&f.terms);
    let mut orders = Vec::new(&f.env);
    orders.push_back(f.terms.clone());
    orders.push_back(f.terms.clone());
    assert_eq!(
        c.try_emergency_recover_batch(&orders),
        Err(Ok(Error::NotFunded))
    );
    assert!(c.is_funded(&id));
    assert_eq!(f.balance(&f.contract), 1_025);
    assert_eq!(f.balance(&f.treasury), 0);
    orders.pop_back();
    let mut second = f.terms.clone();
    second.order_hash = BytesN::from_array(&f.env, &[2; 32]);
    second.order_admin = Address::generate(&f.env);
    let second_id = c.create_and_fund(&second);
    orders.push_back(second);
    c.emergency_recover_batch(&orders);
    assert!(!c.is_funded(&id));
    assert!(!c.is_funded(&second_id));
    assert_eq!(f.balance(&f.treasury), 2_050);
}

#[test]
fn invalid_money_terms_and_insufficient_balance_leave_no_entry() {
    let f = Fixture::new();
    let c = f.client();
    for (price, buyer_fee, seller_fee, expected) in [
        (0, 0, 0, Error::InvalidTerms),
        (1_000, -1, 0, Error::InvalidTerms),
        (1_000, 0, 1_001, Error::InvalidTerms),
        (i128::MAX, 1, 0, Error::Overflow),
    ] {
        let mut terms = f.terms.clone();
        terms.price = price;
        terms.buyer_fee = buyer_fee;
        terms.seller_fee = seller_fee;
        assert_eq!(c.try_create_and_fund(&terms), Err(Ok(expected)));
    }
    let mut terms = f.terms.clone();
    terms.price = 20_000;
    let id = c.get_order_id(&terms);
    assert!(c.try_create_and_fund(&terms).is_err());
    assert!(!c.is_funded(&id));
    assert_eq!(f.balance(&f.terms.buyer), 10_000);
}
