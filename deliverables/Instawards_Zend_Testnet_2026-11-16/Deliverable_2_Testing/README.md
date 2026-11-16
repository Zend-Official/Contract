# Deliverable 2 deployment and testing

## Submission links

- [Latest passing contract test results](https://github.com/Zend-Official/Contract/blob/TEst/deliverables/Instawards_Zend_Testnet_2026-11-16/Deliverable_2_Testing/contract-test-results.txt)
- [Current verified funding and release](https://github.com/Zend-Official/Contract/blob/TEst/deliverables/Instawards_Zend_Testnet_2026-11-16/Deliverable_2_Testing/current-workflow-verification.json)
- [Resolved issues and edge cases](https://github.com/Zend-Official/Contract/blob/TEst/deliverables/Instawards_Zend_Testnet_2026-11-16/Deliverable_2_Testing/resolved-issues-and-edge-cases.md)
- [Deployed Testnet contract](https://stellar.expert/explorer/testnet/contract/CBGEFI5QAOE4TQXIIGMTIXQNYU6TTV6HC5JFRTBQOWF3Y4JM326OQ7S7)
- [GitHub unit tests](https://github.com/Zend-Official/Contract/blob/bee4af06961dcce673fdeb74f4a6dda00b7c16f1/Stellar/src/test.rs)
- [GitHub signed Testnet test script](https://github.com/Zend-Official/Contract/blob/bee4af06961dcce673fdeb74f4a6dda00b7c16f1/Stellar/testnet/live-test.mjs)
- [Published historical live-test report](https://github.com/Zend-Official/Contract/blob/bee4af06961dcce673fdeb74f4a6dda00b7c16f1/Stellar/testnet/live-report.json)

## Current demonstration

Reference is z/mFaxJmD. Funding transaction [cc78528f6939d4e69637ca16bb3f434c415003acd1005dd2fc8ee213a63c5b21](https://stellar.expert/explorer/testnet/tx/cc78528f6939d4e69637ca16bb3f434c415003acd1005dd2fc8ee213a63c5b21) succeeded at ledger 5764754. Its token event transfers 3.6979297 test USDC from the buyer to escrow.

Release transaction [e41be66213f5934e495e1eb76f6df55f10e71a8e4bb4a42d050cd826cad1786c](https://stellar.expert/explorer/testnet/tx/e41be66213f5934e495e1eb76f6df55f10e71a8e4bb4a42d050cd826cad1786c) succeeded at ledger 5764762. Its closure event identifies the same contract order ID, and its token event transfers 3.6979297 test USDC from escrow to the committed vendor. The independent checks and decoded events are in current-workflow-verification.json.

The local Rust test command and complete output are in contract-test-results.txt. The historical report contains 28 passing checks and a recorded account-reserve limitation. See resolved-issues-and-edge-cases.md for its resolution and the difference between the historical report and the current successful workflow.

The current evidence files are published with this package on the contract repository's TEst branch.
