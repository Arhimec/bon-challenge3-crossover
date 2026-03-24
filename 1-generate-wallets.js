#!/usr/bin/env node
// ============================================
// Script 1: Generate Wallets
// Creates 500 wallets distributed across 3 shards
// Outputs PEM files + wallets.json manifest
// ============================================
// Usage:
//   node 1-generate-wallets.js part1
//   node 1-generate-wallets.js part2
// ============================================

const fs = require("fs");
const path = require("path");
const config = require("./config");
const { generateWalletForShard, buildPemContent, ts } = require("./utils");

const part = process.argv[2];
if (!part || !["part1", "part2"].includes(part)) {
    console.error("Usage: node 1-generate-wallets.js <part1|part2>");
    process.exit(1);
}

const partConfig = part === "part1" ? config.PART1 : config.PART2;
const walletsDir = part === "part1" ? config.WALLETS_DIR_PART1 : config.WALLETS_DIR_PART2;
const MAX_WALLETS = partConfig.MAX_WALLETS;
const NUM_SHARDS = config.NUM_SHARDS;

// Distribute wallets evenly across shards: ~167 per shard for 500 wallets
const walletsPerShard = Math.floor(MAX_WALLETS / NUM_SHARDS);
const remainder = MAX_WALLETS % NUM_SHARDS;

console.log(`[${ts()}] Generating ${MAX_WALLETS} wallets for ${part.toUpperCase()}`);
console.log(`[${ts()}] Distribution: ${walletsPerShard} per shard + ${remainder} extra`);
console.log(`[${ts()}] Output dir: ${walletsDir}`);

// Create directory
fs.mkdirSync(walletsDir, { recursive: true });

const allWallets = [];
const shardCounts = {};

for (let shard = 0; shard < NUM_SHARDS; shard++) {
    const count = walletsPerShard + (shard < remainder ? 1 : 0);
    shardCounts[shard] = 0;

    console.log(`[${ts()}] Generating ${count} wallets for shard ${shard}...`);

    for (let i = 0; i < count; i++) {
        const wallet = generateWalletForShard(shard);
        const idx = allWallets.length;

        // Save PEM file
        const pemContent = buildPemContent(wallet.address, wallet.secretKeyHex);
        const pemPath = path.join(walletsDir, `wallet-${idx}.pem`);
        fs.writeFileSync(pemPath, pemContent);

        allWallets.push({
            index: idx,
            address: wallet.address,
            shard: wallet.shard,
            secretKeyHex: wallet.secretKeyHex,
            pemFile: `wallet-${idx}.pem`,
        });

        shardCounts[shard]++;

        if ((idx + 1) % 50 === 0) {
            console.log(`[${ts()}]   Generated ${idx + 1}/${MAX_WALLETS} wallets...`);
        }
    }
}

// Save manifest (WITHOUT mnemonics for security — secret keys in PEMs)
const manifest = {
    part,
    totalWallets: allWallets.length,
    shardDistribution: shardCounts,
    generatedAt: new Date().toISOString(),
    wallets: allWallets.map(({ index, address, shard, pemFile }) => ({
        index,
        address,
        shard,
        pemFile,
    })),
};

const manifestPath = path.join(walletsDir, "wallets.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// Also save a secret keys file (needed for signing without loading PEMs)
const secretsPath = path.join(walletsDir, "secrets.json");
fs.writeFileSync(
    secretsPath,
    JSON.stringify(
        allWallets.map(({ index, address, shard, secretKeyHex }) => ({
            index,
            address,
            shard,
            secretKeyHex,
        })),
        null,
        2
    )
);

console.log(`\n[${ts()}] ✅ Done! Generated ${allWallets.length} wallets`);
console.log(`[${ts()}] Shard distribution:`, shardCounts);
console.log(`[${ts()}] Manifest: ${manifestPath}`);
console.log(`[${ts()}] Secrets:  ${secretsPath}`);
console.log(`[${ts()}] PEM dir:  ${walletsDir}/`);
