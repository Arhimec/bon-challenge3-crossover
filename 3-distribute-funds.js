#!/usr/bin/env node
// ============================================
// Script 3: Distribute Funds
// Sends EGLD from guild leader wallet to all 
// 500 sending wallets (DIRECT — no intermediaries)
// ============================================
// Usage:
//   node 3-distribute-funds.js part1
//   node 3-distribute-funds.js part2
// ============================================

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { Address, Transaction, TransactionComputer } = require("@multiversx/sdk-core");
const config = require("./config");
const { egldToSmallest, formatEgld, sleep, ts, loadGuildLeaderKey } = require("./utils");

const part = process.argv[2];
if (!part || !["part1", "part2"].includes(part)) {
    console.error("Usage: node 3-distribute-funds.js <part1|part2>");
    process.exit(1);
}

const partConfig = part === "part1" ? config.PART1 : config.PART2;
const walletsDir = part === "part1" ? config.WALLETS_DIR_PART1 : config.WALLETS_DIR_PART2;

async function main() {
    // Load guild leader key
    const { address: glAddress, signer: glSigner } = loadGuildLeaderKey();
    const txComputer = new TransactionComputer();

    console.log(`[${ts()}] Guild Leader: ${glAddress}`);
    console.log(`[${ts()}] Part: ${part.toUpperCase()}`);
    console.log(`[${ts()}] Budget: ${partConfig.TOTAL_BUDGET_EGLD} EGLD`);
    console.log(`[${ts()}] EGLD per wallet: ${partConfig.EGLD_PER_WALLET}`);

    // Get current nonce
    const accountResp = await axios.get(
        `${config.GATEWAY_URL}/address/${glAddress}`
    );
    let nonce = BigInt(accountResp.data.data.account.nonce);
    const balance = accountResp.data.data.account.balance;
    console.log(`[${ts()}] GL Balance: ${formatEgld(balance)} EGLD`);
    console.log(`[${ts()}] GL Nonce: ${nonce}`);

    // Load wallets manifest
    const manifestPath = path.join(walletsDir, "wallets.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const wallets = manifest.wallets;
    console.log(`[${ts()}] Distributing to ${wallets.length} wallets...`);

    const amountPerWallet = egldToSmallest(partConfig.EGLD_PER_WALLET);
    console.log(`[${ts()}] Amount per wallet: ${formatEgld(amountPerWallet.toString())} EGLD`);

    const BATCH_SIZE = config.MEMPOOL_LIMIT; // 96 = mempool limit
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
        const batch = wallets.slice(i, i + BATCH_SIZE);
        const txBatch = [];

        for (const wallet of batch) {
            const tx = new Transaction({
                nonce: nonce,
                sender: new Address(glAddress),
                receiver: new Address(wallet.address),
                value: amountPerWallet,
                gasLimit: config.GAS_LIMIT,
                gasPrice: config.GAS_PRICE,
                chainID: config.CHAIN_ID,
                version: config.TX_VERSION,
            });

            const serialized = txComputer.computeBytesForSigning(tx);
            tx.signature = await glSigner.sign(serialized);

            const plain = txComputer.toPlainObject(tx);
            plain.signature = Buffer.from(tx.signature).toString("hex");
            txBatch.push(plain);

            nonce++;
        }

        try {
            const resp = await axios.post(
                `${config.GATEWAY_URL}/transaction/send-multiple`,
                txBatch,
                { timeout: config.SEND_TIMEOUT_MS }
            );

            const result = resp.data;
            if (result.data && result.data.numOfSentTxs !== undefined) {
                sent += result.data.numOfSentTxs;
                console.log(
                    `[${ts()}] Batch ${Math.floor(i / BATCH_SIZE) + 1}: sent ${result.data.numOfSentTxs}/${batch.length} txs (total: ${sent}/${wallets.length})`
                );
            } else {
                console.log(`[${ts()}] Batch response:`, JSON.stringify(result).substring(0, 200));
                sent += batch.length;
            }
        } catch (err) {
            failed += batch.length;
            console.error(
                `[${ts()}] ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} FAILED:`,
                err.response?.data || err.message
            );
        }

        // Small delay between batches to not overwhelm the gateway
        if (i + BATCH_SIZE < wallets.length) {
            await sleep(200);
        }
    }

    console.log(`\n[${ts()}] ✅ Distribution complete!`);
    console.log(`[${ts()}] Sent: ${sent}, Failed: ${failed}`);
    console.log(`[${ts()}] Total EGLD distributed: ~${(sent * partConfig.EGLD_PER_WALLET).toFixed(2)} EGLD`);
    console.log(`[${ts()}] ⏳ Wait ~6-12 seconds for cross-shard finality before starting the blaster.`);
}

main().catch((err) => {
    console.error(`[${ts()}] Fatal error:`, err);
    process.exit(1);
});
