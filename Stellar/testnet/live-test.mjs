import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  Address, Asset, BASE_FEE, Contract, Keypair, Networks, Operation,
  TransactionBuilder, authorizeEntry, nativeToScVal, rpc, scValToNative, xdr,
} from "@stellar/stellar-sdk";

const NETWORK = Networks.TESTNET;
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const assetInfo = JSON.parse(await readFile(new URL("./usdc-testnet.json", import.meta.url)));
const assetKeys = JSON.parse(await readFile(new URL("./.local/usdc.json", import.meta.url)));
assert.equal(assetInfo.networkPassphrase, NETWORK);
const gas = Keypair.fromSecret(assetKeys.distributorSecret);
const asset = new Asset("USDC", assetInfo.issuer);
const resume = process.argv.includes("--resume");
const previous = resume ? JSON.parse(await readFile(new URL("./live-report.json", import.meta.url))) : null;
const runId = previous?.runId ?? Date.now().toString();
const reportFile = new URL("./live-report.json", import.meta.url);
const report = previous ?? { runId, network: "testnet", transactions: [], checks: [], issues: [] };
const secrets = resume ? JSON.parse(await readFile(new URL("./.local/live-" + runId + ".json", import.meta.url))) : { runId, networkPassphrase: NETWORK };
const signers = new Map([[gas.publicKey(), [gas]]]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const addr = (value) => new Address(value).toScVal();
const bytes = (value) => nativeToScVal(value, { type: "bytes" });
const i128 = (value) => nativeToScVal(value, { type: "i128" });

async function checkpoint() {
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  await writeFile(new URL("./.local/live-" + runId + ".json", import.meta.url),
    JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600 });
}

function wallet(name) {
  const key = secrets[name] ? Keypair.fromSecret(secrets[name]) : Keypair.random();
  secrets[name] = key.secret();
  signers.set(key.publicKey(), [key]);
  return key;
}

async function transaction(operations) {
  const account = await server.getAccount(gas.publicKey());
  const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK });
  for (const op of operations) builder.addOperation(op);
  return builder.setTimeout(180).build();
}

async function broadcast(tx, label, additional = [], expectFailure = false) {
  tx.sign(gas, ...additional);
  const outer = TransactionBuilder.buildFeeBumpTransaction(gas, BASE_FEE, tx, NETWORK);
  outer.sign(gas);
  const hash = Buffer.from(outer.hash()).toString("hex");
  const entry = { label, hash, status: "submitting" };
  report.transactions.push(entry);
  await checkpoint();
  const sent = await server.sendTransaction(outer);
  assert.ok(["PENDING", "DUPLICATE"].includes(sent.status),
    label + ": submission " + sent.status);
  console.log(label, hash);
  for (let count = 0; count < 60; count++) {
    await sleep(2_000);
    const result = await server.getTransaction(hash);
    if (result.status === "NOT_FOUND") continue;
    entry.status = result.status;
    await checkpoint();
    assert.equal(result.status, expectFailure ? "FAILED" : "SUCCESS", label);
    return result;
  }
  throw new Error(label + ": confirmation timeout; inspect " + hash + " before retrying.");
}

async function classic(label, operations, additional = []) {
  if (report.transactions.some((tx) => tx.label === label && tx.status === "SUCCESS")) return;
  return broadcast(await transaction(operations), label, additional);
}

async function simulate(op) {
  const tx = await transaction([op]);
  const sim = await server.simulateTransaction(tx, undefined, "record_allow_nonroot");
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error("Simulation failed: " + sim.error);
  }
  return { tx, sim };
}

function accountSignature(keys, payload) {
  const sorted = [...keys].sort((a, b) =>
    Buffer.compare(Buffer.from(a.rawPublicKey()), Buffer.from(b.rawPublicKey())));
  return xdr.ScVal.scvVec(sorted.map((key) => xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("public_key"), val: bytes(key.rawPublicKey()) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signature"), val: bytes(key.sign(payload)) }),
  ])));
}

async function prepare(op, overrides = new Map()) {
  const { tx, sim } = await simulate(op);
  const latest = await server.getLatestLedger();
  const auth = [];
  for (const entry of sim.result?.auth ?? []) {
    if (entry.credentials.type === "sorobanCredentialsSourceAccount") {
      auth.push(entry);
      continue;
    }
    const address = Address.fromScAddress(entry.credentials.value.address).toString();
    const keys = overrides.get(address) ?? signers.get(address);
    assert.ok(keys, "No test signer configured for " + address);
    auth.push(await authorizeEntry(entry, async (_preimage, payload) => ({
      signatureScVal: accountSignature(keys, payload),
    }), latest.sequence + 100, NETWORK));
  }
  const parsed = tx.operations[0];
  const signedOp = Operation.invokeHostFunction({ func: parsed.func, auth });
  let prepared = rpc.assembleTransaction(tx, sim)
    .clearOperations().addOperation(signedOp).build();
  // Enforce actual signatures and include the account reads in the footprint.
  const enforced = await server.simulateTransaction(prepared, undefined, "enforce");
  return { prepared, enforced };
}

async function invokeOperation(label, op) {
  if (report.transactions.some((tx) => tx.label === label && tx.status === "SUCCESS")) return;
  const { prepared, enforced } = await prepare(op);
  if (!rpc.Api.isSimulationSuccess(enforced)) {
    throw new Error(label + ": signed authorization failed: " + enforced.error);
  }
  const tx = rpc.assembleTransaction(prepared, enforced).build();
  return broadcast(tx, label);
}

let escrow;
function call(method, ...args) {
  return new Contract(escrow).call(method, ...args);
}

async function invoke(method, args, label = method) {
  return invokeOperation(label, call(method, ...args));
}

async function read(contract, method, args = []) {
  const { sim } = await simulate(new Contract(contract).call(method, ...args));
  return scValToNative(sim.result.retval);
}

const balance = (account) => read(assetInfo.contractId, "balance", [addr(account)]);
const config = () => read(escrow, "get_config");
const funded = (id) => read(escrow, "is_funded", [bytes(id)]);

function termsScVal(terms) {
  const values = {
    buyer: addr(terms.buyer),
    buyer_fee: i128(terms.buyer_fee),
    order_admin: addr(terms.order_admin),
    order_hash: bytes(Buffer.from(terms.order_hash, "hex")),
    price: i128(terms.price),
    seller: addr(terms.seller),
    seller_fee: i128(terms.seller_fee),
  };
  return xdr.ScVal.scvMap(Object.entries(values).map(([key, val]) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })));
}

function localOrderId(terms) {
  const encoded = xdr.ScVal.scvVec([
    nativeToScVal(1, { type: "u32" }), addr(escrow), termsScVal(terms),
  ]);
  return createHash("sha256").update(encoded.toXdr()).digest();
}

async function check(name, fn) {
  if (report.checks.some((check) => check.name === name && check.status === "passed")) return;
  await fn();
  report.checks.push({ name, status: "passed" });
  console.log("PASS", name);
  await checkpoint();
}

async function rejectContract(name, method, args, code) {
  await check(name, async () => {
    const tx = await transaction([call(method, ...args)]);
    const sim = await server.simulateTransaction(tx, undefined, "record_allow_nonroot");
    assert.ok(rpc.Api.isSimulationError(sim), name + " unexpectedly succeeded");
    assert.match(sim.error, new RegExp("Error\\(Contract, #" + code + "\\)"));
  });
}

async function rejectAuthorization(name, method, args, signerAddress, wrongKeys) {
  await check(name, async () => {
    const { enforced } = await prepare(call(method, ...args),
      new Map([[signerAddress, wrongKeys]]));
    assert.ok(rpc.Api.isSimulationError(enforced), name + " accepted the wrong signer");
    assert.match(enforced.error, /Auth|signature|account|Unauthorized/i);
  });
}

async function main() {
  const central = wallet("central");
  const centralSecond = wallet("centralSecond");
  const buyer = wallet("buyer");
  const seller = wallet("seller");
  const treasury = wallet("treasury");
  const nextAdmin = wallet("nextAdmin");
  report.wallets = {
    central: central.publicKey(), centralSecond: centralSecond.publicKey(),
    buyer: buyer.publicKey(), seller: seller.publicKey(),
    treasury: treasury.publicKey(), nextAdmin: nextAdmin.publicKey(), gas: gas.publicKey(),
  };
  await checkpoint();
  await classic("create-test-accounts", [central, buyer, seller, treasury, nextAdmin].map((key) =>
    Operation.createAccount({ destination: key.publicKey(), startingBalance: "100" })));
  await classic("configure-central-2-of-2-multisig", [
    Operation.setOptions({
      source: central.publicKey(),
      signer: { ed25519PublicKey: centralSecond.publicKey(), weight: 1 },
      masterWeight: 1, lowThreshold: 2, medThreshold: 2, highThreshold: 2,
    }),
  ], [central]);
  signers.set(central.publicKey(), [central, centralSecond]);

  await classic("create-USDC-trustlines", [buyer, seller, treasury].map((key) =>
    Operation.changeTrust({ source: key.publicKey(), asset, limit: "1000000" })),
    [buyer, seller, treasury]);
  await classic("fund-buyer-100-USDC", [
    Operation.payment({ destination: buyer.publicKey(), asset, amount: "100" }),
  ]);
  const wasm = await readFile(new URL("../target/wasm32v1-none/release/zend_escrow.wasm", import.meta.url));
  const wasmHash = createHash("sha256").update(wasm).digest();
  report.wasmHash = wasmHash.toString("hex");
  await invokeOperation("upload-escrow-wasm", Operation.uploadContractWasm({ wasm }));
  secrets.deploymentSalt ??= randomBytes(32).toString("hex");
  await checkpoint();
  const deployment = Operation.createCustomContract({
    address: new Address(gas.publicKey()),
    wasmHash,
    salt: Buffer.from(secrets.deploymentSalt, "hex"),
    constructorArgs: [addr(central.publicKey()), addr(treasury.publicKey()), addr(assetInfo.contractId)],
  });
  if (report.transactions.some((tx) => tx.label === "deploy-escrow" && tx.status === "SUCCESS")) {
    escrow = report.contractId;
  } else {
    const { sim: deploymentSim } = await simulate(deployment);
    escrow = scValToNative(deploymentSim.result.retval);
  }
  report.contractId = escrow;
  await invokeOperation("deploy-escrow", deployment);
  console.log("Escrow", escrow);

  function order(name) {
    const admin = wallet(name);
    const terms = report.orders?.find((order) => order.name === name) ?? {
      order_hash: randomBytes(32).toString("hex"),
      buyer: buyer.publicKey(), seller: seller.publicKey(),
      price: "100000000", buyer_fee: "1000000", seller_fee: "1000000",
      order_admin: admin.publicKey(),
    };
    report.orders ??= [];
    if (!report.orders.some((order) => order.name === name)) report.orders.push({ name, ...terms });
    return { admin, terms, encoded: termsScVal(terms), id: localOrderId(terms) };
  }

  const released = order("releaseAdmin");
  await check("backend ID encoding matches contract", async () => {
    const remote = await read(escrow, "get_order_id", [released.encoded]);
    assert.deepEqual(Buffer.from(remote), released.id);
  });
  await rejectAuthorization("buyer cannot approve creation alone", "create_and_fund",
    [released.encoded], central.publicKey(), [buyer]);
  await rejectAuthorization("central admin cannot debit buyer alone", "create_and_fund",
    [released.encoded], buyer.publicKey(), [central]);
  await invoke("create_and_fund", [released.encoded], "fund-release-order");
  await check("funding locks 10.1 USDC and collects no fee", async () => {
    assert.equal(await balance(escrow), 101000000n);
    assert.equal(await balance(treasury.publicKey()), 0n);
    assert.equal(await funded(released.id), true);
  });
  await rejectContract("duplicate funded order rejected", "create_and_fund", [released.encoded], 3);
  await rejectAuthorization("gas cannot release funds", "release", [released.encoded],
    released.admin.publicKey(), [gas]);
  await rejectAuthorization("buyer cannot release funds", "release", [released.encoded],
    released.admin.publicKey(), [buyer]);

  // Test the open question before creating any account for this order admin.
  const adminKey = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({
    accountId: released.admin.xdrAccountId(),
  }));
  assert.equal((await server.getLedgerEntries(adminKey)).entries.length, 0);
  const probe = await prepare(call("release", released.encoded));
  if (!rpc.Api.isSimulationSuccess(probe.enforced)) {
    report.issues.push({
      name: "unfunded-order-admin",
      status: "failed",
      error: probe.enforced.error,
      workaround: "Create ledger accounts for test order admins before normal settlement.",
    });
    console.log("UNFUNDED ADMIN REJECTED", probe.enforced.error);
    await classic("fund-order-admin-fallback", [
      Operation.createAccount({ destination: released.admin.publicKey(), startingBalance: "10" }),
    ]);
  } else {
    report.checks.push({ name: "unfunded order admin authorizes release", status: "passed" });
  }
  await invoke("release", [released.encoded], "release-to-seller");
  await check("release pays 9.9 USDC to seller and 0.2 USDC in fees", async () => {
    assert.equal(await balance(seller.publicKey()), 99000000n);
    assert.equal(await balance(treasury.publicKey()), 2000000n);
    assert.equal(await balance(escrow), 0n);
    assert.equal(await funded(released.id), false);
  });
  await rejectContract("second release rejected", "release", [released.encoded], 4);

  const refunded = order("refundAdmin");
  if (report.issues.length) {
    await classic("fund-refund-admin-fallback", [
      Operation.createAccount({ destination: refunded.admin.publicKey(), startingBalance: "10" }),
    ]);
  }
  report.refundBuyerBefore ??= (await balance(buyer.publicKey())).toString();
  const buyerBefore = BigInt(report.refundBuyerBefore);
  await invoke("create_and_fund", [refunded.encoded], "fund-refund-order");
  const altered = termsScVal({ ...refunded.terms, buyer_fee: "2000000" });
  await rejectContract("altered fee cannot unlock funded entry", "refund", [altered], 4);
  await invoke("extend_order_ttl", [refunded.encoded], "extend-funded-order-TTL");
  await invoke("pause", [], "pause-contract");
  for (const [method, args] of [
    ["create_and_fund", [refunded.encoded]], ["release", [refunded.encoded]],
    ["refund", [refunded.encoded]], ["emergency_recover", [refunded.encoded]],
    ["emergency_recover_batch", [xdr.ScVal.scvVec([refunded.encoded])]],
    ["extend_order_ttl", [refunded.encoded]], ["set_treasury", [addr(treasury.publicKey())]],
    ["propose_admin", [addr(nextAdmin.publicKey())]], ["accept_admin", []],
    ["upgrade", [bytes(wasmHash)]],
  ]) {
    await rejectContract("pause blocks " + method, method, args, 1);
  }
  await rejectAuthorization("only central admin can unpause", "unpause", [],
    central.publicKey(), [gas]);
  await invoke("unpause", [], "unpause-contract");
  await invoke("refund", [refunded.encoded], "refund-full-deposit");
  await check("refund returns principal and buyer fee", async () => {
    assert.equal(await balance(buyer.publicKey()), buyerBefore);
    assert.equal(await balance(treasury.publicKey()), 2000000n);
    assert.equal(await funded(refunded.id), false);
  });

  const recovered = order("recoveryAdmin");
  await invoke("create_and_fund", [recovered.encoded], "fund-single-recovery");
  await rejectAuthorization("order admin cannot use central recovery", "emergency_recover",
    [recovered.encoded], central.publicKey(), [recovered.admin]);
  await invoke("emergency_recover", [recovered.encoded], "recover-single-order");
  const batchA = order("batchAdminA");
  const batchB = order("batchAdminB");
  await invoke("create_and_fund", [batchA.encoded], "fund-batch-order-A");
  await invoke("create_and_fund", [batchB.encoded], "fund-batch-order-B");
  await rejectContract("duplicate recovery batch rejected", "emergency_recover_batch",
    [xdr.ScVal.scvVec([batchA.encoded, batchA.encoded])], 4);
  await check("rejected batch leaves both deposits funded", async () => {
    assert.equal(await funded(batchA.id), true);
    assert.equal(await funded(batchB.id), true);
    assert.equal(await balance(escrow), 202000000n);
  });
  await invoke("emergency_recover_batch",
    [xdr.ScVal.scvVec([batchA.encoded, batchB.encoded])], "recover-batch-of-two");
  await check("recovery transfers full deposits and closes entries", async () => {
    assert.equal(await balance(treasury.publicKey()), 305000000n);
    assert.equal(await balance(escrow), 0n);
    for (const order of [recovered, batchA, batchB]) assert.equal(await funded(order.id), false);
  });

  await invoke("set_treasury", [addr(seller.publicKey())], "change-treasury");
  assert.equal((await config()).treasury, seller.publicKey());
  await invoke("set_treasury", [addr(treasury.publicKey())], "restore-treasury");
  await invoke("propose_admin", [addr(nextAdmin.publicKey())], "propose-new-central-admin");
  assert.equal((await config()).central_admin, central.publicKey());
  await invoke("accept_admin", [], "accept-central-admin");
  await rejectAuthorization("previous central admin loses authority", "pause", [],
    nextAdmin.publicKey(), [central, centralSecond]);
  await invoke("upgrade", [bytes(wasmHash)], "upgrade-to-same-tested-wasm");
  assert.equal((await config()).central_admin, nextAdmin.publicKey());
  report.checks.push({ name: "treasury update, two-step admin transfer, and upgrade", status: "passed" });
  delete report.error;
  report.status = report.issues.length ? "completed-with-issues" : "passed";
  await checkpoint();
  console.log("RESULT", report.status, report.checks.length, "checks", reportFile.pathname);
}

try {
  await main();
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  await checkpoint();
  console.error(error.message);
  process.exitCode = 1;
}




