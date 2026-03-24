// ============================================
// Battle of Nodes — Challenge 3: Crossover
// Configuration File
// ============================================

module.exports = {
    // Network
    GATEWAY_URL: "https://gateway.battleofnodes.com",
    API_URL: "https://api.battleofnodes.com",
    CHAIN_ID: "B",
    NUM_SHARDS: 3,         // shards 0, 1, 2
    GAS_LIMIT: 50000n,
    GAS_PRICE: 1000000000n,
    GAS_PRICE_BOOST: 4000000000n,  // 4x priority for Part 2 (0.0002 EGLD/tx)
    TX_VERSION: 1,

    // Gas cost per tx in EGLD (50000 * 1e9 = 5e13 = 0.00005 EGLD)
    GAS_COST_PER_TX: 0.00005,

    // Guild leader wallet PEM path
    GUILD_LEADER_PEM: "./guild-leader.pem",

    // Wallet directories
    WALLETS_DIR_PART1: "./wallets-part1",
    WALLETS_DIR_PART2: "./wallets-part2",

    // Part 1 config (16:00–16:30 UTC)
    PART1: {
        TOTAL_BUDGET_EGLD: 2000,
        MAX_WALLETS: 500,
        MIN_TX_VALUE: 1n,                          // 1e-18 EGLD (1 wei)
        MIN_TX_VALUE_DISPLAY: "1e-18 EGLD",
        EGLD_PER_WALLET: 4.0,                       // 2000 / 500 = 4 EGLD per wallet
    },

    // Part 2 config (17:00–17:30 UTC)
    PART2: {
        TOTAL_BUDGET_EGLD: 500,
        MAX_WALLETS: 500,
        MIN_TX_VALUE: 10000000000000000n,           // 0.01 EGLD = 1e16
        MIN_TX_VALUE_DISPLAY: "0.01 EGLD",
        EGLD_PER_WALLET: 1.0,                       // 500 / 500 = 1 EGLD per wallet
    },

    // Throughput tuning
    MEMPOOL_LIMIT: 96,              // max pending txs per sender in mempool
    BATCH_SIZE: 96,                 // txs per batch sent to gateway (= MEMPOOL_LIMIT)
    CONCURRENT_WALLETS: 50,         // how many wallets send in parallel
    TX_DELAY_MS: 0,                 // delay between batches (0 = max speed)
    SEND_TIMEOUT_MS: 10000,         // timeout per API call

    // Receiver wallets — pre-generated cross-shard targets
    RECEIVERS_FILE: "./receivers.json",
};
