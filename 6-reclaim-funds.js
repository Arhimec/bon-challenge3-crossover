#!/usr/bin/env node
// ============================================
// Script 6: Reclaim Funds
// Sends remaining EGLD from all sending wallets
// back to the guild leader wallet.
// ============================================
// Usage:
//   node 6-reclaim-funds.js part1
//   node 6-reclaim-funds.js part2
// ============================================

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { Address, Transaction, TransactionComputer } = require("@multiversx/sdk-core");
const { UserSecretKey, UserSigner } = require("@multiversx/sdk-wallet");
const config = require("./config");
const { formatEgld, sleep, ts, loadGuildLeaderKey } = require("./utils");

const part = process.argv[2];
if (!part || !["part1", "part2"].includes(part)) {
    console.error("Usage: node 6-reclaim-funds.js <part1|part2>");
    process.exit(1);
}

const walletsDir = part === "part1" ? config.WALLETS_DIR_PART1 : config.WALLETS_DIR_PART2;

async function main() {
    // Get GL address
    const { address: glAddress } = loadGuildLeaderKey();

    // Load secrets
    const secretsPath = path.join(walletsDir, "secrets.json");
    const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
    const txComputer = new TransactionComputer();

    console.log(`[${ts()}] Reclaiming funds from ${secrets.length} wallets → ${glAddress}`);

    const gasCost = BigInt(config.GAS_LIMIT) * BigInt(config.GAS_PRICE);
    let totalReclaimed = 0n;
    let sent = 0;
    let skipped = 0;

    for (const wallet of secrets) {
        try {
            // Get balance and nonce
            const resp = await axios.get(`${config.GATEWAY_URL}/address/${wallet.address}`, {
                timeout: 5000,
            });
            const account = resp.data.data.account;
            const balance = BigInt(account.balance);
            const nonce = BigInt(account.nonce);

            // Need enough for gas
            if (balance <= gasCost) {
                skipped++;
                continue;
            }

            const sendAmount = balance - gasCost;
            const sk = UserSecretKey.fromString(wallet.secretKeyHex);
            const signer = new UserSigner(sk);

            const tx = new Transaction({
                nonce: nonce,
                sender: new Address(wallet.address),
                receiver: new Address(glAddress),
                value: sendAmount,
                gasLimit: config.GAS_LIMIT,
                gasPrice: config.GAS_PRICE,
                chainID: config.CHAIN_ID,
                version: config.TX_VERSION,
            });

            const serialized = txComputer.computeBytesForSigning(tx);
            tx.signature = await signer.sign(serialized);

            const plain = txComputer.toPlainObject(tx);
            plain.signature = Buffer.from(tx.signature).toString("hex");

            await axios.post(`${config.GATEWAY_URL}/transaction/send`, plain, {
                timeout: config.SEND_TIMEOUT_MS,
            });

            totalReclaimed += sendAmount;
            sent++;

            if (sent % 50 === 0) {
                console.log(`[${ts()}] Reclaimed from ${sent} wallets (${formatEgld(totalReclaimed.toString())} EGLD)...`);
            }
        } catch (err) {
            // Skip on error
        }
    }

    console.log(`\n[${ts()}] ✅ Reclaim complete!`);
    console.log(`[${ts()}] Sent: ${sent}, Skipped: ${skipped}`);
    console.log(`[${ts()}] Total reclaimed: ~${formatEgld(totalReclaimed.toString())} EGLD`);
}

main().catch((err) => {
    console.error(`[${ts()}] Fatal error:`, err);
    process.exit(1);
});
