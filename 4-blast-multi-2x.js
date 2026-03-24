#!/usr/bin/env node
// ============================================
// Script 4b: Multi-Process Cross-Shard Blaster
// Spawns one child process per shard to fully
// utilize all CPU cores for signing.
// ============================================
// Usage:
//   node 4-blast-multi.js part1
//   node 4-blast-multi.js part2
// ============================================

const { fork } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("./config-2x");
const { ts } = require("./utils");

const part = process.argv[2];
if (!part || !["part1", "part2"].includes(part)) {
    console.error("Usage: node 4-blast-multi.js <part1|part2>");
    process.exit(1);
}

const partConfig = part === "part1" ? config.PART1 : config.PART2;
const walletsDir = part === "part1" ? config.WALLETS_DIR_PART1 : config.WALLETS_DIR_PART2;

// Load secrets and split by shard
const secrets = JSON.parse(fs.readFileSync(path.join(walletsDir, "secrets.json"), "utf8"));
const byShard = { 0: [], 1: [], 2: [] };
for (const w of secrets) byShard[w.shard].push(w);

console.log(`[${ts()}] 🚀 Multi-Process Blaster — ${part.toUpperCase()}`);
console.log(`[${ts()}] Total wallets: ${secrets.length}`);
for (let s = 0; s < 3; s++) console.log(`  Shard ${s}: ${byShard[s].length} wallets`);
console.log();

// Global stats
let totalSent = 0;
let totalFailed = 0;
const children = [];

// Spawn one worker per shard
for (let shard = 0; shard < 3; shard++) {
    const child = fork(path.join(__dirname, "4-blast-worker-2x.js"), [part, shard.toString()], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    child.stdout.on("data", (data) => process.stdout.write(`[S${shard}] ${data}`));
    child.stderr.on("data", (data) => process.stderr.write(`[S${shard}] ${data}`));

    child.on("message", (msg) => {
        if (msg.type === "stats") {
            totalSent += msg.sent;
            totalFailed += msg.failed;
        }
    });

    child.on("exit", (code) => {
        console.log(`[${ts()}] Shard ${shard} worker exited with code ${code}`);
    });

    children.push(child);
}

// Stats reporter
const startTime = Date.now();
const statsInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const tps = Math.round(totalSent / elapsed);
    console.log(
        `[${ts()}] 📊 TOTAL | Sent: ${totalSent.toLocaleString()} | Failed: ${totalFailed.toLocaleString()} | TPS: ${tps} | ${elapsed.toFixed(0)}s`
    );
}, 10000);

// Graceful shutdown
process.on("SIGINT", () => {
    console.log(`\n[${ts()}] ⛔ Stopping all workers...`);
    clearInterval(statsInterval);
    for (const child of children) child.kill("SIGINT");
    setTimeout(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`[${ts()}] 🏁 FINAL | Sent: ${totalSent.toLocaleString()} | Failed: ${totalFailed.toLocaleString()} | TPS: ${Math.round(totalSent / elapsed)} | ${elapsed.toFixed(0)}s`);
        process.exit(0);
    }, 2000);
});
