# Testnet USDC

Run npm ci and npm run create:usdc from this directory.

The script funds disposable issuer and distribution accounts through Friendbot,
creates a USDC trustline, issues 1,000,000 units when the distribution balance
is zero, deploys the Stellar Asset Contract, and verifies decimals and balance.

This custom USDC asset has its own issuer and no dollar backing.
Public details are in usdc-testnet.json. Secret keys are in .local/usdc.json,
which is ignored by Git. Keep that file local.

Reruns reuse saved keys, the existing trustline, and deployed contract. If a
transaction times out, check its printed hash before rerunning. Testnet resets
can remove all test state. This script deploys only the built-in asset contract.

## Live escrow tests

Run npm run test:live to deploy the locally built escrow Wasm and exercise it
on testnet. Build the contract first with stellar contract build --locked
from the Stellar directory. The script uses the saved test USDC distributor
as the transaction source and fee-bump payer. It creates fresh test wallets,
configures a 2-of-2 central multisig, creates trustlines, funds the buyer with
100 test USDC, and deploys a fresh escrow instance on every run.

The suite checks canonical order IDs, signed buyer and central approvals,
order admin authority, exact release and refund balances, pause behavior,
TTL maintenance, emergency recovery, treasury changes, admin succession,
and replacement with the same uploaded Wasm. Rejected operations are checked
using RPC simulation with signature enforcement where relevant. Successful
writes are submitted and confirmed as fee-bump transactions.

The script explicitly probes an unfunded order admin. If the network rejects
that authorization, it records an issue and funds the test admin to continue
checking the remaining contract behavior. Such a run is marked
completed-with-issues rather than passed.

Public transaction hashes, assertions, and any errors are saved incrementally
in live-report.json. Disposable secrets are kept in .local/live-<runId>.json,
which is ignored by Git. The successor in the admin-transfer test is a single
key test account. Replacing a production central admin requires configuring
the successor multisig separately.
