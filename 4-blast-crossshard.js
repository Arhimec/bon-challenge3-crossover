#!/usr/bin/env node
// ============================================
// Script 4: Cross-Shard Transaction Blaster
// Fires MoveBalance transactions where sender and 
// receiver are ALWAYS on different shards.
// Maximum throughput mode.
// ============================================
// Usage:
//   node 4-blast-crossshard.js part1
//   node 4-blast-crossshard.js part2
// ============================================

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { Address, Transaction, TransactionComputer } = require("@multiversx/sdk-core");
const { UserSecretKey, UserSigner } = require("@multiversx/sdk-wallet");
const config = require("./config");
const { getShardOfAddress, sleep, ts, formatEgld } = require("./utils");

const part = process.argv[2];
if (!part || !["part1", "part2"].includes(part)) {
    console.error("Usage: node 4-blast-crossshard.js <part1|part2>");
    process.exit(1);
}

const partConfig = part === "part1" ? config.PART1 : config.PART2;
const walletsDir = part === "part1" ? config.WALLETS_DIR_PART1 : config.WALLETS_DIR_PART2;
const TX_VALUE = partConfig.MIN_TX_VALUE;

// Compute max txs per wallet to avoid running out of funds
const GAS_COST_SMALLEST = BigInt(config.GAS_LIMIT) * BigInt(config.GAS_PRICE);
const COST_PER_TX = GAS_COST_SMALLEST + TX_VALUE;
const WALLET_BUDGET = partConfig.EGLD_PER_WALLET;
const WALLET_BUDGET_SMALLEST = BigInt(Math.floor(WALLET_BUDGET * 1e18));
const MAX_TXS_PER_WALLET = Number(WALLET_BUDGET_SMALLEST / COST_PER_TX);

// Stats
let totalSent = 0;
let totalFailed = 0;
let totalApiErrors = 0;
let startTime;
let running = true;

// Graceful shutdown
process.on("SIGINT", () => {
    console.log(`\n[${ts()}] ⛔ SIGINT received — stopping...`);
    running = false;
});

async function loadWalletsAndReceivers() {
    // Load sender wallets with secrets
    const secretsPath = path.join(walletsDir, "secrets.json");
    const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));

    // Load receivers
    const receivers = JSON.parse(fs.readFileSync(config.RECEIVERS_FILE, "utf8"));

    // Build cross-shard receiver map: for each sender shard, list all receiver shards != sender shard
    const crossShardReceivers = {};
    for (let shard = 0; shard < config.NUM_SHARDS; shard++) {
        crossShardReceivers[shard] = [];
        for (let otherShard = 0; otherShard < config.NUM_SHARDS; otherShard++) {
            if (otherShard !== shard) {
                crossShardReceivers[shard].push(...receivers[otherShard.toString()]);
            }
        }
    }

    // Pre-create signers for each wallet
    const wallets = secrets.map((w) => {
        const sk = UserSecretKey.fromString(w.secretKeyHex);
        return {
            index: w.index,
            address: w.address,
            shard: w.shard,
            signer: new UserSigner(sk),
            addressObj: new Address(w.address),
        };
    });

    return { wallets, crossShardReceivers };
}

/**
 * Fetch nonces for all wallets in parallel (batched)
 */
async function fetchNonces(wallets) {
    const nonces = new Map();
    const BATCH = 50;

    for (let i = 0; i < wallets.length; i += BATCH) {
        const batch = wallets.slice(i, i + BATCH);
        const promises = batch.map(async (w) => {
            try {
                const resp = await axios.get(
                    `${config.GATEWAY_URL}/address/${w.address}`,
                    { timeout: 5000 }
                );
                return { address: w.address, nonce: BigInt(resp.data.data.account.nonce) };
            } catch (err) {
                // Default to 0 if fetch fails
                return { address: w.address, nonce: 0n };
            }
        });
        const results = await Promise.all(promises);
        for (const r of results) {
            nonces.set(r.address, r.nonce);
        }
        if (i % 200 === 0 && i > 0) {
            console.log(`[${ts()}]   Fetched nonces for ${i + batch.length}/${wallets.length} wallets...`);
        }
    }
    return nonces;
}

/**
 * Fire transactions from a single wallet in a loop
 */
async function walletBlaster(wallet, crossShardReceivers, startNonce) {
    const txComputer = new TransactionComputer();
    const receivers = crossShardReceivers[wallet.shard];
    let nonce = startNonce;
    let receiverIdx = Math.floor(Math.random() * receivers.length);
    let localSent = 0;
    let localFailed = 0;

    while (running && localSent < MAX_TXS_PER_WALLET) {
        // Build a batch of transactions (cap to remaining budget)
        const remaining = MAX_TXS_PER_WALLET - localSent;
        const batchSize = Math.min(config.BATCH_SIZE, remaining);
        const txBatch = [];

        for (let i = 0; i < batchSize && running; i++) {
            const receiverAddr = receivers[receiverIdx % receivers.length];
            receiverIdx++;

            const tx = new Transaction({
                nonce: nonce,
                sender: wallet.addressObj,
                receiver: new Address(receiverAddr),
                value: TX_VALUE,
                gasLimit: config.GAS_LIMIT,
                gasPrice: config.GAS_PRICE,
                chainID: config.CHAIN_ID,
                version: config.TX_VERSION,
            });

            const serialized = txComputer.computeBytesForSigning(tx);
            tx.signature = await wallet.signer.sign(serialized);

            const plain = txComputer.toPlainObject(tx);
            plain.signature = Buffer.from(tx.signature).toString("hex");
            txBatch.push(plain);

            nonce++;
        }

        if (txBatch.length === 0) break;

        // Send batch
        try {
            const resp = await axios.post(
                `${config.GATEWAY_URL}/transaction/send-multiple`,
                txBatch,
                { timeout: config.SEND_TIMEOUT_MS }
            );

            if (resp.data?.data?.numOfSentTxs !== undefined) {
                const sent = resp.data.data.numOfSentTxs;
                localSent += sent;
                totalSent += sent;
                const notSent = txBatch.length - sent;
                if (notSent > 0) {
                    localFailed += notSent;
                    totalFailed += notSent;
                }
            } else {
                localSent += txBatch.length;
                totalSent += txBatch.length;
            }
        } catch (err) {
            totalApiErrors++;
            // On error, try to resync nonce
            if (err.response?.data?.error?.includes("nonce")) {
                try {
                    const resp = await axios.get(
                        `${config.GATEWAY_URL}/address/${wallet.address}`,
                        { timeout: 5000 }
                    );
                    nonce = BigInt(resp.data.data.account.nonce);
                } catch (_) {}
            }
            // Brief backoff on error
            await sleep(100);
        }

        if (config.TX_DELAY_MS > 0) {
            await sleep(config.TX_DELAY_MS);
        }
    }

    return { localSent, localFailed };
}

/**
 * Stats reporter
 */
function startStatsReporter() {
    const interval = setInterval(() => {
        if (!running) {
            clearInterval(interval);
            return;
        }
        const elapsed = (Date.now() - startTime) / 1000;
        const tps = Math.round(totalSent / elapsed);
        console.log(
            `[${ts()}] 📊 STATS | Sent: ${totalSent.toLocaleString()} | Failed: ${totalFailed.toLocaleString()} | Errors: ${totalApiErrors} | TPS: ${tps} | Elapsed: ${elapsed.toFixed(1)}s`
        );
    }, 5000);
    return interval;
}

async function main() {
    console.log(`[${ts()}] 🚀 Cross-Shard Blaster — ${part.toUpperCase()}`);
    console.log(`[${ts()}] TX value: ${partConfig.MIN_TX_VALUE_DISPLAY}`);
    console.log(`[${ts()}] Max txs per wallet: ${MAX_TXS_PER_WALLET}`);
    console.log(`[${ts()}] Max total txs: ${(MAX_TXS_PER_WALLET * partConfig.MAX_WALLETS).toLocaleString()}`);
    console.log(`[${ts()}] Batch size: ${config.BATCH_SIZE}`);
    console.log(`[${ts()}] Concurrent wallets: ${config.CONCURRENT_WALLETS}`);
    console.log(`[${ts()}] Gateway: ${config.GATEWAY_URL}`);
    console.log();

    // Load wallets and receivers
    console.log(`[${ts()}] Loading wallets and receivers...`);
    const { wallets, crossShardReceivers } = await loadWalletsAndReceivers();
    console.log(`[${ts()}] Loaded ${wallets.length} sender wallets`);

    for (let s = 0; s < config.NUM_SHARDS; s++) {
        const walletsInShard = wallets.filter((w) => w.shard === s).length;
        const receiversForShard = crossShardReceivers[s].length;
        console.log(`  Shard ${s}: ${walletsInShard} senders → ${receiversForShard} cross-shard receivers`);
    }

    // Fetch all nonces
    console.log(`\n[${ts()}] Fetching nonces...`);
    const nonces = await fetchNonces(wallets);
    console.log(`[${ts()}] Nonces fetched for ${nonces.size} wallets`);

    // Launch blasters in parallel batches
    console.log(`\n[${ts()}] 🔥 STARTING BLAST — Press Ctrl+C to stop`);
    startTime = Date.now();
    const statsInterval = startStatsReporter();

    // Process wallets in concurrent groups
    const CONCURRENT = config.CONCURRENT_WALLETS;
    const results = [];

    for (let i = 0; i < wallets.length; i += CONCURRENT) {
        if (!running) break;
        const batch = wallets.slice(i, i + CONCURRENT);
        const promises = batch.map((w) => {
            const startNonce = nonces.get(w.address) || 0n;
            return walletBlaster(w, crossShardReceivers, startNonce);
        });

        // Don't await all at once — they run indefinitely
        // Instead, run all wallets concurrently
        if (i === 0) {
            // First batch — start all and let them run
            // For subsequent wallets, we chain them
        }
        results.push(...promises);
    }

    // Wait for all to complete (they complete when running = false)
    await Promise.all(results);

    clearInterval(statsInterval);

    const elapsed = (Date.now() - startTime) / 1000;
    const tps = Math.round(totalSent / elapsed);

    console.log(`\n[${ts()}] ============================================`);
    console.log(`[${ts()}] 🏁 BLAST COMPLETE`);
    console.log(`[${ts()}] Total sent:    ${totalSent.toLocaleString()}`);
    console.log(`[${ts()}] Total failed:  ${totalFailed.toLocaleString()}`);
    console.log(`[${ts()}] API errors:    ${totalApiErrors}`);
    console.log(`[${ts()}] Duration:      ${elapsed.toFixed(1)}s`);
    console.log(`[${ts()}] Avg TPS:       ${tps}`);
    console.log(`[${ts()}] ============================================`);
}

main().catch((err) => {
    console.error(`[${ts()}] Fatal error:`, err);
    process.exit(1);
});
