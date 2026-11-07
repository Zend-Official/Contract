# Zend Soroban USDC escrow

The central admin approves each funded order and binds a fresh order admin
address to its terms. That order admin authorizes normal release or refund.
The central admin can recover funded deposits to the current treasury.
Configure the actual USDC Stellar Asset Contract for the selected network
when deploying. The token address is fixed for this deployment.

## Functions and authority

| Function | Authorization | Effect |
| --- | --- | --- |
| Constructor | Initial central admin | Configure central admin, USDC, and treasury |
| create_and_fund | Central admin and buyer | Pull price plus buyer fee, store marker, emit full terms |
| release | Committed order admin | Pay seller price minus seller fee and treasury both fees |
| refund | Committed order admin | Return the entire deposit to the buyer |
| emergency_recover | Central admin | Send one full deposit to the current treasury |
| emergency_recover_batch | Central admin | Atomically recover 1 through 10 orders |
| pause / unpause | Central admin | Freeze or resume contract writes |
| set_treasury | Central admin | Change the destination for subsequent treasury transfers |
| propose_admin | Current central admin | Propose a successor; a new proposal replaces a pending one |
| accept_admin | Proposed successor | Transfer central authority and clear the proposal |
| upgrade | Central admin | Replace contract code using an already uploaded Wasm hash |
| extend_order_ttl | Anyone | Pay rent to extend an existing funded marker |
| get_config / get_order_id / is_funded | Public | Read configuration, derive ID, or check funded status |

When paused, only unpause and reads work. Emergency recovery, refunds,
upgrades, admin acceptance, and storage maintenance also stop.

Normal settlement and recovery delete the funded marker. Transfers, marker
updates, and events are atomic. A failed token transfer or a duplicate,
missing, or invalid batch member rolls back the entire transaction. Each
closure emits the ID, action, destination, amount, treasury, and fee.

## Order ID and persistent storage

OrderTerms contains order_hash, buyer, seller, price, buyer_fee, seller_fee,
and order_admin. All monetary values are signed 128-bit integers expressed
in USDC's smallest unit. Price must be positive, fees nonnegative, and
seller_fee no greater than price. The contract checks deposit overflow.

The ID is SHA-256 of the Soroban ScVal XDR encoding of this tuple.

    (1_u32, current_contract_address, OrderTerms)

OrderTerms uses the SDK contracttype struct representation, a ScVal map
whose fields are serialized canonically. The version is a u32 encoded in
XDR. Clients must reproduce that exact encoding. Use get_order_id to verify
backend results. The USDC address stays fixed and the contract address
scopes commitments to one deployment.

The persistent entry uses the ID as its key and true as its marker. Supply
the exact creation terms again for release, refund, recovery, or maintenance.
Creation events include every field needed to reconstruct those terms.

Entries and instance storage are extended to the network maximum TTL on
funding and maintenance. Instance lifetime also extends on configuration
changes and settlement. Reads do not extend TTL. The backend must maintain
rent for long disputes, account for restoration of archived state, and
maintain the deployed Wasm code's TTL.

## Backend responsibilities and pending validation

Before funding, verify the seller's off-chain signed offer, record the order
in the database, generate a fresh order admin keypair, and obtain central
admin approval of the exact terms. A shared offer may back multiple orders.
Only the backend verifies offers, delivery, disputes, and PINs. The gas
account sponsors transactions without receiving contract authority.

The backend must prevent ID reuse after closure because terminal entries
are deleted. Persist and index creation and closure events. Ignore IDs
missing from both the chain and backend. Preserve the keys needed to
authorize normal settlement. Emergency recovery uses reconstructed terms,
and reimbursements happen off-chain.

Configure the central account's multisig signers and thresholds on Stellar
before deployment. The contract requires that address's authorization.
The central admin authorizes each creation, as agreed, so funding must be
integrated with the multisig signing workflow.

The batch cap of 10 is provisional. Simulate each batch and reduce it if
resource limits require. The marker storage layout and maximum-TTL policy
have not been compared against alternative layouts on testnet. Authorization
by an unfunded order admin still requires a real signed testnet check.
Unit tests mock signatures and do not establish that network behavior.

## Local verification

    cargo test --locked
    stellar contract build --locked

The Stellar CLI performs the SDK's required contract build steps. The Wasm
output is target/wasm32v1-none/release/zend_escrow.wasm.
