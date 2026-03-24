# Battle of Nodes — Challenge 3: Crossover — Summary & Lessons Learned

## Guild: SuperRareBears

## Part 1 Summary (16:00–16:30 UTC)

### Setup
- 500 wallets generated, distributed across 3 shards (~167 per shard)
- 2,000 EGLD budget distributed (4 EGLD per wallet)
- Transaction type: cross-shard MoveBalance, value = 1e-18 EGLD
- Gas price: 1,000,000,000 (1x default)
- Batch size: 96 (mempool limit)
- Network: Post-Supernova shadow fork, Chain ID "B", 600ms rounds

### Results
- Estimated ~115,000–500,000 cross-shard transactions (sampling was unreliable due to API congestion during the challenge)
- Shard 2 wallets performed best (avg nonce ~275), Shard 0 wallets were underperforming (stuck at ~101)
- Gas spent: estimated ~5-25 EGLD out of 2,000 EGLD budget
- The single-process blaster was CPU-bound — signing for 500 wallets in one Node.js process was the main bottleneck
- API/Gateway became congested during the challenge, making monitoring difficult

### Key Metrics
- Wallet distribution: 167 (shard 0) / 167 (shard 1) / 166 (shard 2)
- Mempool limit: 96 txs per sender
- Gas cost per tx: 0.00005 EGLD
- Blaster ran on a sandboxed environment with 2 vCPUs — not ideal for 500 concurrent wallet signers

---

## Lessons Learned

### 1. Single-Process Node.js is a Bottleneck
**Problem:** Running 500 wallet blasters in a single Node.js process meant the event loop was dominated by ed25519 signing operations. Only a fraction of wallets made meaningful progress.

**Fix for Part 2:** Created multi-process blaster (`4-blast-multi.js`) that spawns one worker per shard (3 processes), each handling ~167 wallets. Better CPU utilization across cores.

**Ideal fix:** Run on a multi-core VPS (4+ cores). Each worker gets a dedicated core. Or use worker_threads for parallel signing.

### 2. PEM Format Was Double-Encoded
**Problem:** The guild leader PEM file contained base64-encoded hex strings (not raw bytes). The initial parsing read raw bytes from the base64 decode, producing invalid signatures.

**Fix:** Created `loadGuildLeaderKey()` helper that properly decodes: base64 → UTF-8 hex string → first 64 hex chars → 32-byte secret key.

**Lesson:** Always test signing + broadcasting a real transaction before the challenge starts.

### 3. Nonce Management is Critical
**Problem:** The gateway's `/transaction/send-multiple` silently drops transactions with invalid nonces (returns `numOfSentTxs: 0` without an error message). When we sent batches of 96 txs and some were rejected, the local nonce counter got ahead of reality, causing ALL subsequent batches to fail.

**Fix:** Aggressive nonce resync — after any partial batch accept (numOfSentTxs < batchSize), immediately re-fetch the on-chain nonce. Roll back local nonce to `batchStartNonce + numOfSentTxs` for partial accepts.

**Lesson:** Never trust optimistic nonce incrementing. Always validate against actual acceptance.

### 4. Mempool Limit is 96
**Problem:** Initially used batch size of 100, causing the gateway to reject the excess. The BoN network has a per-sender mempool limit of 96.

**Fix:** Set batch size to exactly 96.

**Lesson:** Know the mempool limits before you blast. Test a small batch first.

### 5. Fund Distribution Needs Batching
**Problem:** Sending 500 fund transactions from the guild leader wallet at once hit the mempool limit. Only 96-102 of 500 were accepted in the first attempt.

**Fix:** Send in batches of 96 with delays. Resync GL nonce between batches.

**Lesson:** The mempool limit applies to the guild leader wallet too. Batch accordingly and verify receipt.

### 6. Recirculation is Key for Part 2
**Problem:** Part 2 has a 0.01 EGLD minimum tx value. Without recirculation, each wallet can only send 99 txs before running dry (49,500 total).

**Fix:** Wallets send to each other across shards. The 0.01 EGLD flows back, so only gas (0.00005–0.0002 EGLD) is consumed. This allows 5,000–20,000 txs per wallet instead of 99.

**Lesson:** When tx value is significant relative to budget, recirculate through your own wallets.

### 7. Higher Gas Price = Priority
**Discovery:** Increasing gas price above the minimum (1 Gwei) gives mempool priority. For Part 2, using 4x gas (0.0002 EGLD/tx) to jump the queue.

**Tradeoff:** 4x gas means 4x fee cost. With recirculation and 1 EGLD/wallet, max txs drops from 20,000 to 5,000/wallet. Still 2.5M total — more than enough for 30 minutes.

**Backup:** 2x gas scripts ready (`*-2x.js`) if 4x burns budget too fast.

### 8. Run From a Proper VPS
**Problem:** Running the blaster from a sandboxed cloud environment with 2 vCPUs and network latency to the BoN gateway was suboptimal.

**Lesson:** For Part 2 and future challenges, deploy scripts to a nearby VPS with 4+ cores and low latency to the gateway.

### 9. API Monitoring During Load is Unreliable
**Problem:** Both the gateway and API endpoints became very slow/unresponsive during the challenge window (all guilds blasting simultaneously). Monitoring scripts couldn't reliably sample wallet nonces.

**Lesson:** Build monitoring that degrades gracefully. Sample fewer wallets. Use exponential backoff. Accept approximate numbers during peak load.

### 10. Pre-Generate Everything
**What we did right:** Generated both Part 1 and Part 2 wallets before the challenge started. Generated receiver addresses ahead of time. Had fund distribution scripts ready.

**Lesson:** Every second counts. Anything that can be done before 15:45 UTC should be done before 15:45 UTC.

---

## Part 2 Summary (17:00–17:30 UTC)

### Setup
- 500 fresh wallets (different set from Part 1), distributed across 3 shards
- 500 EGLD budget distributed (1 EGLD per wallet)
- Transaction type: cross-shard MoveBalance, value = 0.01 EGLD
- Gas price: 2,000,000,000 (2x default) — mempool priority
- Batch size: 96 (mempool limit)
- Blaster: Multi-process — 3 workers, one per shard
- Recirculation mode: wallets send to each other across shards, 0.01 EGLD flows back

### Results
- Estimated ~261,500 cross-shard transactions
- Sampled nonces: Shard 0 ~384, Shard 1 ~566, Shard 2 ~619
- Multi-process approach was ~2-3x more effective than single-process (Part 1)
- Gateway congestion remained the primary throughput limiter
- Recirculation worked as designed — wallets maintained balances throughout
- GL remaining balance: ~517 EGLD

### Improvements Over Part 1
- Multi-process blaster (3 workers) vs single-process: better CPU utilization
- 2x gas price: higher mempool priority
- Recirculation: sustainable tx output without draining wallets
- Nonce resync was more aggressive and reliable

---

## Combined Results

| Metric | Part 1 | Part 2 | Total |
|--------|--------|--------|-------|
| Duration | 30 min | 30 min | 60 min |
| Budget | 2,000 EGLD | 500 EGLD | 2,500 EGLD |
| Wallets | 500 | 500 (fresh) | 1,000 |
| Min TX value | 1e-18 EGLD | 0.01 EGLD | — |
| Gas price | 1x | 2x | — |
| Blaster | Single-process | Multi-process (3 workers) | — |
| Est. cross-shard TXs | ~115K–500K | ~261K | ~375K–760K |

### What Worked
- Shard-aware wallet generation ensured 100% cross-shard sends
- Recirculation kept Part 2 wallets funded for continuous output
- Pre-generating everything (wallets, receivers) before 15:45 UTC saved critical time
- Multi-process blaster was a clear improvement for Part 2
- Aggressive nonce resync recovered from gateway drops

### What Didn't Work
- Running from a 2-vCPU sandbox instead of a dedicated VPS — signing was the bottleneck
- Single-process Part 1 blaster couldn't keep 500 wallets active simultaneously
- Gateway/API congestion during peak challenge times throttled monitoring and batch acceptance
- Other guilds with dedicated multi-core VPS infrastructure achieved 3M+ txs

### Recommendations for Future Challenges
1. **Run from a dedicated VPS** (8+ cores, low latency to gateway) — not a sandbox
2. **Use worker_threads or multiple Node processes** from the start — one per shard minimum
3. **Pre-test the full pipeline** end-to-end with real txs before challenge day
4. **Monitor via local counters** (log sent txs to file) instead of polling congested APIs
5. **Consider Go or Rust** for the blaster — ed25519 signing in native code is 10-100x faster than Node.js

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `1-generate-wallets.js` | Generate shard-distributed wallets |
| `2-generate-receivers.js` | Generate cross-shard receiver addresses |
| `3-distribute-funds.js` | Fund wallets from guild leader |
| `4-blast-crossshard.js` | Single-process blaster |
| `4-blast-multi.js` | Multi-process blaster (recommended) |
| `4-blast-worker.js` | Per-shard worker for multi-process |
| `*-2x.js` variants | 2x gas backup scripts |
| `5-monitor.js` | Real-time monitoring |
| `6-reclaim-funds.js` | Reclaim remaining EGLD |

## Repository
https://github.com/Arhimec/bon-challenge3-crossover

## Dashboard
Live monitoring dashboard was deployed during the challenge with glassmorphic bento UI, real-time TPS chart, shard distribution heatmap, budget tracker, and milestone progress.
