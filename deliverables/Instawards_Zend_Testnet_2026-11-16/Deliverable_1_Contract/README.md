# Deliverable 1 contract implementation

## Submission links

- [Deployed escrow on Stellar Testnet](https://stellar.expert/explorer/testnet/contract/CBGEFI5QAOE4TQXIIGMTIXQNYU6TTV6HC5JFRTBQOWF3Y4JM326OQ7S7)
- [Contract GitHub repository](https://github.com/Zend-Official/Contract)
- [Reviewed contract source at a pinned revision](https://github.com/Zend-Official/Contract/blob/bee4af06961dcce673fdeb74f4a6dda00b7c16f1/Stellar/src/lib.rs)
- [Contract types and events](https://github.com/Zend-Official/Contract/blob/bee4af06961dcce673fdeb74f4a6dda00b7c16f1/Stellar/src/types.rs)

## Implemented requirements

The create_and_fund function requires buyer and central-admin authorization, transfers the agreed deposit into escrow, commits the full terms and emits a creation event. The release function requires the committed order admin and pays the agreed vendor and treasury. Delivery confirmation occurs in the backend before the authorized release. Refund and administrative controls are also implemented.

The accompanying verification JSON records the current deployed WASM hash and source fingerprints. These match the clean build verified on 14 November. Contract revision is bee4af06961dcce673fdeb74f4a6dda00b7c16f1.
