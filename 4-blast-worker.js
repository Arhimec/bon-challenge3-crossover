#!/usr/bin/env node
// ============================================
// Worker: Blasts txs for wallets on ONE shard
// Spawned by 4-blast-multi.js
// ============================================

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { Address, Transaction, TransactionComputer } = require("@multiversx/sdk-core");
const { UserSecretKey, UserSigner } = require("@multiversx/sdk-wallet");
const config = require("./config");
const { ts, sleep } = require("./utils");

const part = process.argv[2];
const shard = parseInt(process.argv[3]);
const partConfig = part === "part1" ? config.PART1 : config.PART2;
const walletsDir = part === "part1" ? config.WALLETS_DIR_PART1 : config.WALLETS_DIR_PART2;
const TX_VALUE = partConfig.MIN_TX_VALUE;
const GAS_PRICE = part === "part2" ? config.GAS_PRICE_2X : config.GAS_PRICE;

let running = true;
process.on("SIGINT", () => { running = false; });

async function resyncNonce(address) {
    try {
        const resp = await axios.get(`${config.GATEWAY_URL}/address/${address}`, { timeout: 5000 });
        return BigInt(resp.data.data.account.nonce);
    } catch (_) { return null; }
}

async function main() {
    // Load all wallets, filter to this shard
    const secrets = JSON.parse(fs.readFileSync(path.join(walletsDir, "secrets.json"), "utf8"));
    const myWallets = secrets.filter(w => w.shard === shard);

    // Load ALL wallets for cross-shard targets
    const allWallets = secrets;
    const crossShardAddresses = allWallets.filter(w => w.shard !== shard).map(w => w.address);

    console.log(`Shard ${shard}: ${myWallets.length} wallets → ${crossShardAddresses.length} cross-shard targets`);

    // Build signers
    const wallets = myWallets.map(w => ({
        ...w,
        signer: new UserSigner(UserSecretKey.fromString(w.secretKeyHex)),
        addressObj: new Address(w.address),
    }));

    // Fetch nonces
    console.log(`Fetching nonces for ${wallets.length} wallets...`);
    const nonces = new Map();
    for (const w of wallets) {
        const n = await resyncNonce(w.address);
        nonces.set(w.address, n || 0n);
    }
    console.log(`Nonces ready. Starting blast...`);

    const txComputer = new TransactionComputer();
    let totalSent = 0;
    let totalFailed = 0;
    let reportTimer = Date.now();

    // Process wallets in round-robin to keep all active
    const walletStates = wallets.map((w, i) => ({
        wallet: w,
        nonce: nonces.get(w.address) || 0n,
        receiverIdx: Math.floor(Math.random() * crossShardAddresses.length),
        consecutivePartial: 0,
    }));

    while (running) {
        for (const state of walletStates) {
            if (!running) break;

            const { wallet } = state;
            const batchSize = config.BATCH_SIZE;
            const txBatch = [];
            const batchStartNonce = state.nonce;

            for (let i = 0; i < batchSize && running; i++) {
                const receiver = crossShardAddresses[state.receiverIdx % crossShardAddresses.length];
                state.receiverIdx++;

                const tx = new Transaction({
                    nonce: state.nonce,
                    sender: wallet.addressObj,
                    receiver: new Address(receiver),
                    value: TX_VALUE,
                    gasLimit: config.GAS_LIMIT,
                    gasPrice: GAS_PRICE,
                    chainID: config.CHAIN_ID,
                    version: config.TX_VERSION,
                });

                const serialized = txComputer.computeBytesForSigning(tx);
                tx.signature = await wallet.signer.sign(serialized);
                const plain = txComputer.toPlainObject(tx);
                plain.signature = Buffer.from(tx.signature).toString("hex");
                txBatch.push(plain);
                state.nonce++;
            }

            if (txBatch.length === 0) continue;

            try {
                const resp = await axios.post(
                    `${config.GATEWAY_URL}/transaction/send-multiple`,
                    txBatch,
                    { timeout: config.SEND_TIMEOUT_MS }
                );

                const sent = resp.data?.data?.numOfSentTxs || 0;
                totalSent += sent;
                const notSent = txBatch.length - sent;

                if (notSent > 0) {
                    totalFailed += notSent;
                    state.consecutivePartial++;
                    if (sent === 0 || state.consecutivePartial >= 2) {
                        const synced = await resyncNonce(wallet.address);
                        if (synced !== null) { state.nonce = synced; state.consecutivePartial = 0; }
                    } else {
                        state.nonce = batchStartNonce + BigInt(sent);
                    }
                } else {
                    state.consecutivePartial = 0;
                }
            } catch (err) {
                totalFailed += txBatch.length;
                const synced = await resyncNonce(wallet.address);
                if (synced !== null) state.nonce = synced;
                await sleep(50);
            }
        }

        // Report stats every 10s
        if (Date.now() - reportTimer > 10000) {
            console.log(`Sent: ${totalSent.toLocaleString()} | Failed: ${totalFailed.toLocaleString()}`);
            if (process.send) process.send({ type: "stats", sent: totalSent, failed: totalFailed });
            totalSent = 0;
            totalFailed = 0;
            reportTimer = Date.now();
        }
    }

    console.log(`Worker shard ${shard} shutting down. Final sent: ${totalSent}, failed: ${totalFailed}`);
}

main().catch(err => {
    console.error(`Worker shard ${shard} error:`, err);
    process.exit(1);
});
