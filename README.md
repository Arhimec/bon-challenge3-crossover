# Battle of Nodes — Challenge 3: Crossover

Scripts for maximizing **cross-shard MoveBalance transactions** on the MultiversX post-Supernova shadow fork (600ms block times).

## Challenge Overview

- **Objective:** Maximize successful cross-shard MoveBalance transactions
- **Network:** Post-Supernova shadow fork — Chain ID `B`, 3 shards, 600ms rounds
- **Two parts:**
  - **Part 1** (16:00–16:30 UTC): 2,000 EGLD budget, 500 wallets, min tx value `1e-18 EGLD`
  - **Part 2** (17:00–17:30 UTC): 500 EGLD budget, 500 fresh wallets, min tx value `0.01 EGLD`
- Only **cross-shard** sends count — sender and receiver must be on different shards

## Architecture

```
Guild Leader Wallet (receives 2,500 EGLD at 15:45 UTC)
    │
    ├── DIRECT funding → 500 Part 1 wallets (shards 0, 1, 2)
    │       │
    │       └── Each wallet blasts cross-shard txs to receivers on OTHER shards
    │
    └── DIRECT funding → 500 Part 2 wallets (fresh set)
            │
            └── Same cross-shard blast with 0.01 EGLD min value
```

Key design decisions:
- **Shard-aware wallet generation** — wallets are distributed equally across 3 shards
- **Pre-generated receiver addresses** — receivers on each shard are generated upfront; senders always pick a receiver on a different shard
- **Nonce management** — nonces are tracked locally per wallet for max throughput
- **Batch sending** — transactions are signed locally and sent in batches of 100 via `/transaction/send-multiple`
- **No intermediary wallets** — all sending wallets are funded directly by the guild leader

## Setup

```bash
npm install
```

Place your guild leader PEM file as `guild-leader.pem` in the project root.

## Scripts

| # | Script | Purpose |
|---|--------|---------|
| 1 | `1-generate-wallets.js` | Generate 500 shard-distributed wallets with PEM files |
| 2 | `2-generate-receivers.js` | Generate cross-shard receiver addresses |
| 3 | `3-distribute-funds.js` | Distribute EGLD from guild leader to sending wallets |
| 4 | `4-blast-crossshard.js` | Fire cross-shard MoveBalance transactions at max throughput |
| 5 | `5-monitor.js` | Real-time monitoring of tx counts, fees, balances |
| 6 | `6-reclaim-funds.js` | Reclaim remaining EGLD back to guild leader |

## Execution Playbook

### Before 15:45 UTC — Preparation

```bash
# 1. Generate receiver addresses (only once, reuse for both parts)
node 2-generate-receivers.js

# 2. Generate Part 1 wallets
node 1-generate-wallets.js part1

# 3. Generate Part 2 wallets (do this now to save time during the break)
node 1-generate-wallets.js part2
```

### 15:45 UTC — Funds Arrive

```bash
# 4. Distribute ~2,000 EGLD to Part 1 wallets
node 3-distribute-funds.js part1

# 5. Wait ~10 seconds for cross-shard finality
```

### 16:00 UTC — Part 1 Starts

```bash
# 6. BLAST!
node 4-blast-crossshard.js part1

# In a separate terminal — monitor progress
node 5-monitor.js part1 --loop
```

### 16:30 UTC — Break

```bash
# 7. Stop the blaster (Ctrl+C)
# 8. Distribute 500 EGLD to Part 2 wallets
node 3-distribute-funds.js part2
```

### 17:00 UTC — Part 2 Starts

```bash
# 9. BLAST with Part 2 params (0.01 EGLD min value)
node 4-blast-crossshard.js part2

# Monitor
node 5-monitor.js part2 --loop
```

### 17:30 UTC — Challenge Ends

```bash
# 10. Stop the blaster (Ctrl+C)
# 11. Optionally reclaim remaining funds
node 6-reclaim-funds.js part1
node 6-reclaim-funds.js part2
```

## Configuration

Edit `config.js` to tune:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `BATCH_SIZE` | 100 | Transactions per API call |
| `CONCURRENT_WALLETS` | 50 | Wallets sending in parallel |
| `TX_DELAY_MS` | 0 | Delay between batches (0 = max speed) |
| `SEND_TIMEOUT_MS` | 10000 | API call timeout |

## Network Details

| Parameter | Value |
|-----------|-------|
| Gateway | `https://gateway.battleofnodes.com` |
| API | `https://api.battleofnodes.com` |
| Chain ID | `B` |
| Shards | 3 (0, 1, 2) |
| Gas Limit | 50,000 |
| Gas Price | 1,000,000,000 |
| Round Duration | 600ms |
| Gas per TX | 0.00005 EGLD |

## Wallet Rules

- 500 unique wallets per part (1,000 total)
- Part 1 and Part 2 use **different** wallet sets
- All wallets funded **directly** by guild leader (no intermediaries)
- Guild leader wallet does **not** send MoveBalance transactions
- Only cross-shard sends count

## Tech Stack

- Node.js
- `@multiversx/sdk-core` — transaction building & signing
- `@multiversx/sdk-wallet` — key management
- `@multiversx/sdk-network-providers` — network interaction
- `axios` — HTTP client

## License

MIT
