#!/usr/bin/env node
// ============================================
// Script 5: Real-Time Monitor
// Tracks tx counts, success rate, fee spend,
// and balance for all sending wallets.
// ============================================
// Usage:
//   node 5-monitor.js part1
//   node 5-monitor.js part2
//   node 5-monitor.js part1 --loop     (auto-refresh every 10s)
// ============================================

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const config = require("./config");
const { formatEgld, ts, sleep, loadGuildLeaderKey } = require("./utils");

const part = process.argv[2];
if (!part || !["part1", "part2"].includes(part)) {
    console.error("Usage: node 5-monitor.js <part1|part2> [--loop]");
    process.exit(1);
}

const loopMode = process.argv.includes("--loop");
const partConfig = part === "part1" ? config.PART1 : config.PART2;
const walletsDir = part === "part1" ? config.WALLETS_DIR_PART1 : config.WALLETS_DIR_PART2;

async function getAccountInfo(address) {
    try {
        const resp = await axios.get(`${config.GATEWAY_URL}/address/${address}`, {
            timeout: 5000,
        });
        return resp.data.data.account;
    } catch {
        return null;
    }
}

async function getTxCount(address) {
    try {
        const resp = await axios.get(
            `${config.API_URL}/accounts/${address}/transactions/count`,
            { timeout: 5000 }
        );
        return typeof resp.data === "number" ? resp.data : 0;
    } catch {
        return 0;
    }
}

async function monitor() {
    const manifestPath = path.join(walletsDir, "wallets.json");
    if (!fs.existsSync(manifestPath)) {
        console.error(`No wallets found at ${manifestPath}. Run 1-generate-wallets.js first.`);
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const wallets = manifest.wallets;

    console.log(`[${ts()}] 📊 MONITOR — ${part.toUpperCase()} (${wallets.length} wallets)`);
    console.log(`[${ts()}] Budget: ${partConfig.TOTAL_BUDGET_EGLD} EGLD`);
    console.log();

    // Guild leader balance
    try {
        const { address: glAddr } = loadGuildLeaderKey();
        const glInfo = await getAccountInfo(glAddr);
        if (glInfo) {
            console.log(`  Guild Leader: ${glAddr}`);
            console.log(`  GL Balance:   ${formatEgld(glInfo.balance)} EGLD`);
            console.log(`  GL Nonce:     ${glInfo.nonce}`);
            console.log();
        }
    } catch (_) {}

    // Sample wallets for balance checks (checking all 500 is slow)
    const SAMPLE_SIZE = 20;
    const sampleIndices = [];
    const step = Math.max(1, Math.floor(wallets.length / SAMPLE_SIZE));
    for (let i = 0; i < wallets.length && sampleIndices.length < SAMPLE_SIZE; i += step) {
        sampleIndices.push(i);
    }

    let totalBalance = 0n;
    let totalNonces = 0n;
    let sampledBalance = 0n;
    let sampledCount = 0;
    let shardStats = {};

    for (const idx of sampleIndices) {
        const w = wallets[idx];
        const info = await getAccountInfo(w.address);
        if (info) {
            const bal = BigInt(info.balance);
            sampledBalance += bal;
            sampledCount++;
            totalNonces += BigInt(info.nonce);

            if (!shardStats[w.shard]) {
                shardStats[w.shard] = { count: 0, totalNonce: 0n, totalBalance: 0n };
            }
            shardStats[w.shard].count++;
            shardStats[w.shard].totalNonce += BigInt(info.nonce);
            shardStats[w.shard].totalBalance += bal;
        }
    }

    // Extrapolate from sample
    const avgBalancePerWallet = sampledCount > 0 ? sampledBalance / BigInt(sampledCount) : 0n;
    const estimatedTotalBalance = avgBalancePerWallet * BigInt(wallets.length);
    const avgNoncePerWallet = sampledCount > 0 ? Number(totalNonces) / sampledCount : 0;
    const estimatedTotalTxs = Math.round(avgNoncePerWallet * wallets.length);

    // Fee estimation: each tx costs gasLimit * gasPrice
    const gasCostPerTx = Number(config.GAS_LIMIT) * Number(config.GAS_PRICE); // in smallest denomination
    const estimatedFeeSpent = (estimatedTotalTxs * gasCostPerTx) / 1e18;

    // Value spent (tx value * total txs)
    const txValueEgld = Number(TX_VALUE_FOR_PART()) / 1e18;
    const estimatedValueSpent = estimatedTotalTxs * txValueEgld;

    console.log(`  ── Summary (sampled ${sampledCount}/${wallets.length} wallets) ──`);
    console.log(`  Est. total txs sent:    ${estimatedTotalTxs.toLocaleString()}`);
    console.log(`  Avg nonce per wallet:   ${avgNoncePerWallet.toFixed(1)}`);
    console.log(`  Est. fee spent:         ${estimatedFeeSpent.toFixed(4)} EGLD`);
    console.log(`  Est. value spent:       ${estimatedValueSpent.toFixed(4)} EGLD`);
    console.log(`  Est. total spent:       ${(estimatedFeeSpent + estimatedValueSpent).toFixed(4)} EGLD`);
    console.log(`  Est. remaining balance: ${formatEgld(estimatedTotalBalance.toString())} EGLD`);
    console.log(`  Budget used:            ${(((estimatedFeeSpent + estimatedValueSpent) / partConfig.TOTAL_BUDGET_EGLD) * 100).toFixed(2)}%`);
    console.log();

    // Per-shard breakdown
    console.log(`  ── Shard Breakdown ──`);
    for (const [shard, stats] of Object.entries(shardStats)) {
        const avgNonce = stats.count > 0 ? Number(stats.totalNonce) / stats.count : 0;
        const shardWallets = wallets.filter((w) => w.shard === parseInt(shard)).length;
        console.log(
            `  Shard ${shard}: ${shardWallets} wallets | avg nonce: ${avgNonce.toFixed(1)} | sampled balance: ${formatEgld(stats.totalBalance.toString())} EGLD`
        );
    }
    console.log();
}

function TX_VALUE_FOR_PART() {
    return Number(partConfig.MIN_TX_VALUE);
}

async function main() {
    if (loopMode) {
        console.log(`[${ts()}] Loop mode — refreshing every 10 seconds. Press Ctrl+C to stop.\n`);
        while (true) {
            try {
                await monitor();
            } catch (err) {
                console.error(`[${ts()}] Monitor error:`, err.message);
            }
            await sleep(10000);
            console.log("─".repeat(60));
        }
    } else {
        await monitor();
    }
}

main().catch((err) => {
    console.error(`[${ts()}] Fatal error:`, err);
    process.exit(1);
});
