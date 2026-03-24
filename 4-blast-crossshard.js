#!/usr/bin/env node
// ============================================
// Script 4: Cross-Shard Transaction Blaster
// Fires MoveBalance transactions where sender and 
// receiver are ALWAYS on different shards.
// 
// RECIRCULATION MODE: Wallets send to each other
// across shards so the tx value (0.01 EGLD in Part 2)
// flows back. Only gas is truly consumed.
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

// Budget calculations
const GAS_COST_SMALLEST = BigInt(config.GAS_LIMIT) * BigInt(config.GAS_PRICE);
const WALLET_BUDGET_SMALLEST = BigInt(Math.floor(partConfig.EGLD_PER_WALLET * 1e18));
// With recirculation, only gas is consumed — tx value comes back from other wallets
const MAX_TXS_PER_WALLET = Number(WALLET_BUDGET_SMALLEST / GAS_COST_SMALLEST);

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

async function loadWallets() {
    const secretsPath = path.join(walletsDir, "secrets.json");
    const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));

    // Group wallets by shard and create signers
    const walletsByShard = { 0: [], 1: [], 2: [] };
    const allWallets = [];

    for (const w of secrets) {
        const sk = UserSecretKey.fromString(w.secretKeyHex);
        const wallet = {
            index: w.index,
            address: w.address,
            shard: w.shard,
            signer: new UserSigner(sk),
            addressObj: new Address(w.address),
        };
        walletsByShard[w.shard].push(wallet);
        allWallets.push(wallet);
    }

    return { allWallets, walletsByShard };
}

/**
 * Build cross-shard pairs: each wallet gets a list of partner wallets
 * on OTHER shards to send to. The partners send back, creating circulation.
 */
function buildCrossShardTargets(walletsByShard) {
    const targets = new Map(); // address → array of cross-shard wallet addresses

    for (let shard = 0; shard < config.NUM_SHARDS; shard++) {
        const senders = walletsByShard[shard];
        // Collect all wallets on other shards
        const crossShardWallets = [];
        for (let otherShard = 0; otherShard < config.NUM_SHARDS; otherShard++) {
            if (otherShard !== shard) {
                crossShardWallets.push(...walletsByShard[otherShard].map(w => w.address));
            }
        }

        for (const sender of senders) {
            targets.set(sender.address, crossShardWallets);
        }
    }

    return targets;
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
                return { address: w.address, nonce: 0n };
            }
        });
        const results = await Promise.all(promises);
        for (const r of results) {
            nonces.set(r.address, r.nonce);
        }
        if (i % 200 === 0 && i > 0) {
            console.log(`[${ts()}]   Fetched nonces for ${Math.min(i + BATCH, wallets.length)}/${wallets.length} wallets...`);
        }
    }
    return nonces;
}

/**
 * Resync nonce from network
 */
async function resyncNonce(address) {
    try {
        const resp = await axios.get(
            `${config.GATEWAY_URL}/address/${address}`,
            { timeout: 5000 }
        );
        return BigInt(resp.data.data.account.nonce);
    } catch (_) {
        return null;
    }
}

/**
 * Fire transactions from a single wallet in a loop.
 * Sends to cross-shard partner wallets (which send back = recirculation).
 * 
 * Nonce strategy: optimistic send with aggressive resync.
 * The gateway mempool accepts txs with nonces ahead of the current on-chain
 * nonce (up to a gap). We send batches and resync if acceptance drops.
 */
async function walletBlaster(wallet, crossShardTargets, startNonce) {
    const txComputer = new TransactionComputer();
    const receivers = crossShardTargets.get(wallet.address);
    let nonce = startNonce;
    let receiverIdx = Math.floor(Math.random() * receivers.length);
    let localSent = 0;
    let localFailed = 0;
    let consecutivePartial = 0; // track partial accepts for resync

    while (running) {
        // Build a batch of transactions
        const batchSize = config.BATCH_SIZE;
        const txBatch = [];
        const batchStartNonce = nonce;

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
                    consecutivePartial++;

                    // If not all txs accepted, resync nonce immediately
                    // The gateway rejected some → our nonce is likely ahead
                    if (sent === 0 || consecutivePartial >= 2) {
                        const synced = await resyncNonce(wallet.address);
                        if (synced !== null) {
                            nonce = synced;
                            consecutivePartial = 0;
                        }
                    } else {
                        // Partial accept: roll nonce back to batchStart + sent
                        nonce = batchStartNonce + BigInt(sent);
                    }
                } else {
                    consecutivePartial = 0;
                }
            } else {
                localSent += txBatch.length;
                totalSent += txBatch.length;
                consecutivePartial = 0;
            }
        } catch (err) {
            totalApiErrors++;
            // Resync nonce on any error
            const synced = await resyncNonce(wallet.address);
            if (synced !== null) nonce = synced;
            // Brief backoff on error
            await sleep(50);
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
    console.log(`[${ts()}] Mode: RECIRCULATION (wallets send to each other across shards)`);
    console.log(`[${ts()}] Gas-limited max txs/wallet: ${MAX_TXS_PER_WALLET.toLocaleString()}`);
    console.log(`[${ts()}] Gas-limited max total txs: ${(MAX_TXS_PER_WALLET * partConfig.MAX_WALLETS).toLocaleString()}`);
    console.log(`[${ts()}] Batch size: ${config.BATCH_SIZE}`);
    console.log(`[${ts()}] Concurrent wallets: ${config.CONCURRENT_WALLETS}`);
    console.log(`[${ts()}] Gateway: ${config.GATEWAY_URL}`);
    console.log();

    // Load wallets
    console.log(`[${ts()}] Loading wallets...`);
    const { allWallets, walletsByShard } = await loadWallets();
    console.log(`[${ts()}] Loaded ${allWallets.length} sender wallets`);

    // Build cross-shard targets (wallet-to-wallet for recirculation)
    const crossShardTargets = buildCrossShardTargets(walletsByShard);

    for (let s = 0; s < config.NUM_SHARDS; s++) {
        const count = walletsByShard[s].length;
        const targetCount = crossShardTargets.get(walletsByShard[s][0]?.address)?.length || 0;
        console.log(`  Shard ${s}: ${count} senders → ${targetCount} cross-shard wallet targets`);
    }

    // Fetch all nonces
    console.log(`\n[${ts()}] Fetching nonces...`);
    const nonces = await fetchNonces(allWallets);
    console.log(`[${ts()}] Nonces fetched for ${nonces.size} wallets`);

    // Launch all wallet blasters concurrently
    console.log(`\n[${ts()}] 🔥 STARTING BLAST — Press Ctrl+C to stop`);
    startTime = Date.now();
    const statsInterval = startStatsReporter();

    // Launch all wallets at once
    const promises = allWallets.map((w) => {
        const startNonce = nonces.get(w.address) || 0n;
        return walletBlaster(w, crossShardTargets, startNonce);
    });

    // Wait for all to complete (they complete when running = false via Ctrl+C)
    await Promise.all(promises);

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
