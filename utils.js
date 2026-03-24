// ============================================
// Shared Utilities
// ============================================

const { Address, AddressComputer } = require("@multiversx/sdk-core");
const { Mnemonic, UserSecretKey } = require("@multiversx/sdk-wallet");
const config = require("./config");

const addressComputer = new AddressComputer(config.NUM_SHARDS);

/**
 * Get shard ID for a bech32 address
 */
function getShardOfAddress(bech32) {
    return addressComputer.getShardOfAddress(new Address(bech32));
}

/**
 * Generate a wallet on a specific shard.
 * Brute-forces mnemonic derivations until the address lands on the target shard.
 */
function generateWalletForShard(targetShard) {
    while (true) {
        const mnemonic = Mnemonic.generate();
        const sk = mnemonic.deriveKey(0);
        const pk = sk.generatePublicKey();
        const addr = pk.toAddress("erd");
        const bech32 = addr.bech32();
        const shard = getShardOfAddress(bech32);

        if (shard === targetShard) {
            return {
                address: bech32,
                shard,
                secretKeyHex: sk.hex(),
                mnemonic: mnemonic.toString(),
            };
        }
    }
}

/**
 * Build PEM content from a secret key hex and address
 */
function buildPemContent(address, secretKeyHex) {
    const sk = UserSecretKey.fromString(secretKeyHex);
    const pk = sk.generatePublicKey();
    // PEM is base64 of (secretKey || publicKey) = 64 bytes
    const combined = Buffer.concat([
        Buffer.from(secretKeyHex, "hex"),
        pk.valueOf(),
    ]);
    const b64 = combined.toString("base64");
    // PEM format with 64-char lines
    const lines = b64.match(/.{1,64}/g);
    return `-----BEGIN PRIVATE KEY for ${address}-----\n${lines.join("\n")}\n-----END PRIVATE KEY for ${address}-----`;
}

/**
 * Format EGLD amount (from smallest denomination to human-readable)
 */
function formatEgld(amountStr) {
    const val = BigInt(amountStr);
    const whole = val / 10n ** 18n;
    const frac = val % 10n ** 18n;
    const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "") || "0";
    return `${whole}.${fracStr}`;
}

/**
 * Convert EGLD (number) to smallest denomination (bigint)
 */
function egldToSmallest(egld) {
    // Use string math to avoid floating point issues
    const [whole, frac = ""] = egld.toString().split(".");
    const fracPadded = frac.padEnd(18, "0").slice(0, 18);
    return BigInt(whole) * 10n ** 18n + BigInt(fracPadded);
}

/**
 * Sleep utility
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Timestamp for logging
 */
function ts() {
    return new Date().toISOString().replace("T", " ").replace("Z", "");
}

module.exports = {
    getShardOfAddress,
    generateWalletForShard,
    buildPemContent,
    formatEgld,
    egldToSmallest,
    sleep,
    ts,
    addressComputer,
};
