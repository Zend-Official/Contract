# Issues and edge cases

## Account-reserve requirement

The historical Testnet report deliberately tried settlement authorization with an order-admin address that had no Stellar ledger account. The network rejected it. The test created the account and successfully continued. This is recorded in historical-live-test-report.json as completed-with-issues and has been preserved.

The application now provisions an escrow signing account with its XLM reserve before settlement. Source is src/Services/WalletProvisioningService.ts in the application repository, https://github.com/Zend-Official/App. The latest workflow in this package successfully funded and released the order using its committed signing address. This verifies the working funded-account path. It does not claim unfunded account authorization is supported.

## Tested contract boundaries

- Missing buyer or central-admin approval rejects funding.
- Unauthorized settlement and altered committed terms are rejected.
- Repeated release after closure is rejected.
- Refund returns the full deposit and collects no fee.
- Invalid amounts, overflow and insufficient balance leave no funded marker.
- A duplicate recovery batch rolls back atomically.
- Pausing blocks contract writes, and admin succession requires acceptance.

These boundaries are covered by the Rust test source and fresh command output. The historical signed Testnet suite supplies 28 recorded passing assertions. The current workflow verification independently confirms the user's latest funding and release. A full third-party security audit is outside this SOW.
