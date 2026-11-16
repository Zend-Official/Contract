# Zend Instawards deliverable submission

All transactions below use Stellar Testnet and a custom test USDC asset. The completed payment is **z/mFaxJmD**, for **Vox bag**, displayed as **NGN 5,000.00**. The on-chain amount is **3.6979297 test USDC**.

| Deliverable | Evidence type | Submission evidence |
| --- | --- | --- |
| Deliverable 1 | Link and repository link | [Deployed Testnet contract](https://stellar.expert/explorer/testnet/contract/CBGEFI5QAOE4TQXIIGMTIXQNYU6TTV6HC5JFRTBQOWF3Y4JM326OQ7S7), [GitHub contract repository](https://github.com/Zend-Official/Contract), [pinned contract source](https://github.com/Zend-Official/Contract/blob/bee4af06961dcce673fdeb74f4a6dda00b7c16f1/Stellar/src/lib.rs) |
| Deliverable 2 | Link and repository link with supporting files | [Deployed Testnet contract](https://stellar.expert/explorer/testnet/contract/CBGEFI5QAOE4TQXIIGMTIXQNYU6TTV6HC5JFRTBQOWF3Y4JM326OQ7S7), [GitHub contract tests](https://github.com/Zend-Official/Contract/blob/bee4af06961dcce673fdeb74f4a6dda00b7c16f1/Stellar/src/test.rs), [published historical live report](https://github.com/Zend-Official/Contract/blob/bee4af06961dcce673fdeb74f4a6dda00b7c16f1/Stellar/testnet/live-report.json). Fresh results and issue-resolution notes are attached in Deliverable_2_Testing |
| Deliverable 3 | Video recording and transaction hashes | Add the recording in Deliverable_3_Demo/Video. [Buyer funds escrow](https://stellar.expert/explorer/testnet/tx/cc78528f6939d4e69637ca16bb3f434c415003acd1005dd2fc8ee213a63c5b21) and [escrow pays vendor](https://stellar.expert/explorer/testnet/tx/e41be66213f5934e495e1eb76f6df55f10e71a8e4bb4a42d050cd826cad1786c) |

## Demonstrated transaction sequence

| Step | Testnet ledger | Time in Africa/Lagos on 16 November 2026 | Amount |
| --- | --- | --- | --- |
| Buyer funds escrow | 5764754 | 17:43:35 | 3.6979297 test USDC |
| Escrow pays vendor after confirmation | 5764762 | 17:44:15 | 3.6979297 test USDC |

Both transactions emit events for the same committed contract order ID, `febb1ca24f61eb0796e373df98ffac88ca268105acc94497014a29414d04db2e`. The funding token event identifies the buyer and escrow as sender and recipient. The release token event identifies escrow and vendor as sender and recipient.

## Tests and issue resolution

[Fresh contract test results](https://github.com/Zend-Official/Contract/blob/TEst/deliverables/Instawards_Zend_Testnet_2026-11-16/Deliverable_2_Testing/contract-test-results.txt), [current workflow verification](https://github.com/Zend-Official/Contract/blob/TEst/deliverables/Instawards_Zend_Testnet_2026-11-16/Deliverable_2_Testing/current-workflow-verification.json) and [issue-resolution notes](https://github.com/Zend-Official/Contract/blob/TEst/deliverables/Instawards_Zend_Testnet_2026-11-16/Deliverable_2_Testing/resolved-issues-and-edge-cases.md) are published on the TEst branch.

All ten Rust unit tests passed in the captured run. The latest live workflow passed seventeen independent checks against the deployed WASM, source fingerprints, database receipt ledgers and on-chain creation, closure and token-transfer events.

The historical suite contains 28 passing assertions and an explicitly recorded unfunded-account authorization limitation. The current app provisions the escrow signing account reserve before settlement. The latest successful workflow demonstrates that funded-account path. The historical report is preserved with its original status and explained in the attached resolution notes.

## Final builder step

Add the recording and its filename or sharing URL before submission. This evidence package is published on the TEst branch. Submission to the chapter lead remains a builder step.
