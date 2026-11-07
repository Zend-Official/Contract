import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  Address, Asset, BASE_FEE, Contract, Horizon, Keypair, Networks,
  Operation, TransactionBuilder, rpc, scValToNative, xdr,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const localDir = new URL("./.local/", import.meta.url);
const stateFile = new URL("usdc.json", localDir);
const publicFile = new URL("./usdc-testnet.json", import.meta.url);
const horizon = new Horizon.Server(HORIZON_URL);
const server = new rpc.Server(RPC_URL);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function save(state) {
  await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

async function loadState() {
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    if (state.networkPassphrase !== NETWORK) {
      throw new Error("Saved wallets belong to a different network.");
    }
    return state;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(localDir, { recursive: true });
    const issuer = Keypair.random();
    const distributor = Keypair.random();
    const state = {
      networkPassphrase: NETWORK,
      issuerSecret: issuer.secret(),
      distributorSecret: distributor.secret(),
    };
    // Persist keys before making network requests so interrupted runs are resumable.
    await save(state);
    return state;
  }
}

async function fundAccount(keypair) {
  try {
    await horizon.loadAccount(keypair.publicKey());
    return;
  } catch (error) {
    if (error.response?.status !== 404) throw error;
  }
  console.log("Funding testnet wallet", keypair.publicKey());
  const response = await fetch(
    "https://friendbot.stellar.org/?addr=" + encodeURIComponent(keypair.publicKey()),
    { signal: AbortSignal.timeout(60_000) },
  );
  if (!response.ok) throw new Error("Friendbot returned HTTP " + response.status);
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await horizon.loadAccount(keypair.publicKey());
      return;
    } catch (error) {
      if (error.response?.status !== 404) throw error;
    }
    await wait(1_000);
  }
  throw new Error("Funded account has not appeared in Horizon yet. Rerun the script.");
}

async function submit(source, operations, prepare = false) {
  const account = await server.getAccount(source.publicKey());
  let transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  }).addOperation(operations).setTimeout(60).build();
  if (prepare) transaction = await server.prepareTransaction(transaction);
  transaction.sign(source);
  const sent = await server.sendTransaction(transaction);
  if (!["PENDING", "DUPLICATE"].includes(sent.status)) {
    throw new Error("Transaction submission failed with status " + sent.status);
  }
  console.log("Submitted", sent.hash);
  for (let attempt = 0; attempt < 45; attempt++) {
    await wait(2_000);
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") return sent.hash;
    if (result.status === "FAILED") {
      throw new Error("Transaction failed on-chain: " + sent.hash);
    }
  }
  throw new Error("Transaction confirmation timed out. Check hash " + sent.hash + " before rerunning.");
}

async function main() {
  const state = await loadState();
  const issuer = Keypair.fromSecret(state.issuerSecret);
  const distributor = Keypair.fromSecret(state.distributorSecret);
  const asset = new Asset("USDC", issuer.publicKey());
  await fundAccount(issuer);
  await fundAccount(distributor);

  let account = await horizon.loadAccount(distributor.publicKey());
  const findBalance = (record) => record.balances.find(
    (balance) => balance.asset_code === "USDC" && balance.asset_issuer === issuer.publicKey(),
  );
  if (!findBalance(account)) {
    await submit(distributor, Operation.changeTrust({
      asset, limit: "1000000000",
    }));
  }

  // Read the trustline through RPC to avoid waiting on Horizon ingestion.
  const trustlineKey = xdr.LedgerKey.trustline(new xdr.LedgerKeyTrustLine({
    accountId: distributor.xdrAccountId(),
    asset: asset.toTrustLineXDRObject(),
  }));
  const entries = await server.getLedgerEntries(trustlineKey);
  if (entries.entries.length !== 1) throw new Error("Distribution trustline was not found.");
  const rawBalance = entries.entries[0].val.trustLine.balance.toString();
  if (rawBalance === "0") {
    await submit(issuer, Operation.payment({
      destination: distributor.publicKey(), asset, amount: "1000000",
    }));
  }

  const contractId = asset.contractId(NETWORK);
  const instanceKey = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract: new Address(contractId).toScAddress(),
    key: xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: xdr.ContractDataDurability.persistent,
  }));
  const instance = await server.getLedgerEntries(instanceKey);
  if (instance.entries.length === 0) {
    await submit(distributor, Operation.createStellarAssetContract({ asset }), true);
  }

  async function readToken(method, args = []) {
    const account = await server.getAccount(distributor.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(60).build();
    const result = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(result) || !result.result) {
      throw new Error("Could not verify token " + method);
    }
    return scValToNative(result.result.retval);
  }

  const decimals = await readToken("decimals");
  const balance = await readToken("balance", [new Address(distributor.publicKey()).toScVal()]);
  if (Number(decimals) !== 7 || BigInt(balance) <= 0n) {
    throw new Error("Token verification returned unexpected decimals or balance.");
  }
  const summary = {
    network: "testnet",
    networkPassphrase: NETWORK,
    rpcUrl: RPC_URL,
    assetCode: "USDC",
    issuer: issuer.publicKey(),
    distributor: distributor.publicKey(),
    contractId,
    decimals: Number(decimals),
    distributorBalanceRaw: balance.toString(),
    credentialFile: ".local/usdc.json",
  };
  await writeFile(publicFile, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});



