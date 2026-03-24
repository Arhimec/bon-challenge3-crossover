#!/usr/bin/env node
// ============================================
// Script 2: Generate Cross-Shard Receiver Addresses
// Creates receiver addresses for each shard so senders 
// can always pick a receiver on a DIFFERENT shard.
// These are just addresses — they don't need funding.
// ============================================
// Usage:
//   node 2-generate-receivers.js [count_per_shard]
//   Default: 100 receivers per shard
// ============================================

const fs = require("fs");
const config = require("./config");
const { generateWalletForShard, ts } = require("./utils");

const COUNT_PER_SHARD = parseInt(process.argv[2]) || 100;
const NUM_SHARDS = config.NUM_SHARDS;

console.log(`[${ts()}] Generating ${COUNT_PER_SHARD} receiver addresses per shard (${COUNT_PER_SHARD * NUM_SHARDS} total)`);

const receivers = {};

for (let shard = 0; shard < NUM_SHARDS; shard++) {
    receivers[shard] = [];
    console.log(`[${ts()}] Generating receivers for shard ${shard}...`);

    for (let i = 0; i < COUNT_PER_SHARD; i++) {
        const wallet = generateWalletForShard(shard);
        receivers[shard].push(wallet.address);
    }
}

fs.writeFileSync(config.RECEIVERS_FILE, JSON.stringify(receivers, null, 2));

console.log(`\n[${ts()}] ✅ Done! Saved to ${config.RECEIVERS_FILE}`);
console.log(`[${ts()}] Receivers per shard:`);
for (let s = 0; s < NUM_SHARDS; s++) {
    console.log(`  Shard ${s}: ${receivers[s].length} addresses`);
}
console.log(`\n[${ts()}] Cross-shard mapping:`);
console.log(`  Sender on shard 0 → receivers on shards 1, 2`);
console.log(`  Sender on shard 1 → receivers on shards 0, 2`);
console.log(`  Sender on shard 2 → receivers on shards 0, 1`);
