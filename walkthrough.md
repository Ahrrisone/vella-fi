# Valhalla Ledger Finance Day 1/Day 2 Walkthrough

This walkthrough explains how to configure and manually test the privacy-preserving trade intent and live liquidity routing MVP.

## What Day 1/Day 2 Implements

Day 1:
- wallet-scoped trade intent API,
- strict Solana mint validation,
- raw integer token amount validation,
- private intent commitments,
- batch aggregation by pair, side, and slippage,
- public batch commitment root.

Day 2:
- live Jupiter quote integration,
- live Raydium API v3 pool lookup,
- route ranking by quoted output,
- no fallback/demo liquidity data,
- startup failure when required config is missing.

## Required Accounts and API Access

### Jupiter

1. Go to the Jupiter Developer Portal:
   - `https://portal.jup.ag/`
2. Create or sign in to your Jupiter developer account.
3. Create an API key for the Swap API.
4. Copy the key into your local `.env` or shell as `JUPITER_API_KEY`.

The code calls:

```text
https://api.jup.ag/swap/v1/quote
```

Jupiter expects:
- `inputMint`: Solana token mint address,
- `outputMint`: Solana token mint address,
- `amount`: raw integer amount in atomic units,
- `slippageBps`: allowed slippage in basis points,
- `x-api-key`: your Jupiter API key.

### Raydium

Raydium API v3 is public for pool data. You usually do not need an API key for the endpoint used by this MVP.

The code calls:

```text
https://api-v3.raydium.io/pools/info/mint
```

You can override the base URL with `RAYDIUM_API_BASE_URL` if Raydium changes environments or you want devnet:

```text
https://api-v3-devnet.raydium.io
```

## Environment Variables

Create a `.env` file if you use a shell loader, or export these variables manually before running the server.

Required:

```bash
export JUPITER_API_KEY="your-jupiter-api-key"
```

Optional:

```bash
export JUPITER_API_BASE_URL="https://api.jup.ag/swap/v1"
export RAYDIUM_API_BASE_URL="https://api-v3.raydium.io"
export RAYDIUM_SWAP_API_BASE_URL="https://transaction-v1.raydium.io"
export INTEGRATION_REQUEST_TIMEOUT_MS="10000"
export PORT="4010"
```

The server intentionally exits on startup if `JUPITER_API_KEY` is missing.

## Token Mint Examples

Use mint addresses, not symbols:

```text
SOL:  So11111111111111111111111111111111111111112
USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

Amounts must be raw integer atomic units.

Examples:
- `100000000` = 0.1 SOL because SOL has 9 decimals.
- `1000000` = 1 USDC because USDC has 6 decimals.

## Install and Build

```bash
npm install
npm run build
```

## Start the API

```bash
JUPITER_API_KEY="your-jupiter-api-key" PORT=4010 npm start
```

If config is missing, the process exits with a fatal configuration error instead of running with fallback data.

## Manual Test Flow

### 1. Health Check

```bash
curl http://127.0.0.1:4010/health
```

### 2. Submit First Private Intent

```bash
curl -X POST http://127.0.0.1:4010/api/intents \
  -H 'Content-Type: application/json' \
  -d '{
    "ownerWallet": "WalletAlpha111111111111111111111111111111",
    "inputMint": "So11111111111111111111111111111111111111112",
    "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "side": "swap",
    "amountIn": "100000000",
    "maxSlippageBps": 50,
    "signature": "replace-with-wallet-signature"
  }'
```

### 3. Submit Second Compatible Intent

```bash
curl -X POST http://127.0.0.1:4010/api/intents \
  -H 'Content-Type: application/json' \
  -d '{
    "ownerWallet": "WalletBeta2222222222222222222222222222222",
    "inputMint": "So11111111111111111111111111111111111111112",
    "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "side": "swap",
    "amountIn": "50000000",
    "maxSlippageBps": 50,
    "signature": "replace-with-wallet-signature"
  }'
```

### 4. Aggregate Pending Intents

```bash
curl -X POST http://127.0.0.1:4010/api/batches/aggregate
```

Copy the returned `batchId`.

### 5. Quote the Batch Through Live Jupiter/Raydium Integrations

```bash
curl -X POST http://127.0.0.1:4010/api/execution-batches/1/quote \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Expected result:
- a selected Jupiter or Raydium route based on live quoted output,
- Raydium route data from the live swap compute API,
- Raydium liquidity metadata from API v3 when available,
- no generated fallback route.

### 6. Inspect Live Routes Directly

```bash
curl 'http://127.0.0.1:4010/api/liquidity/routes?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amountIn=100000000&maxSlippageBps=50'
```

### 7. Preview Allocation Against the Live Quote

Day 1/Day 2 does not submit a signed swap transaction yet. This endpoint allocates fills against the live quote result so you can verify proportional returns and privacy commitments before adding transaction execution.

```bash
curl -X POST http://127.0.0.1:4010/api/execution-batches/1/execute \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### 8. Verify Proof Metadata

```bash
curl 'http://127.0.0.1:4010/api/proofs/batches/1?ownerWallet=WalletAlpha111111111111111111111111111111'
```

### 9. View Analytics

```bash
curl http://127.0.0.1:4010/api/analytics/live
```

## Common Failures

### Missing Jupiter API key

The server exits on startup:

```text
Fatal configuration error: Missing required environment variable: JUPITER_API_KEY
```

Fix:

```bash
export JUPITER_API_KEY="your-jupiter-api-key"
```

### Token symbols used instead of mint addresses

The API rejects the request:

```json
{ "error": "inputMint and outputMint must be Solana mint addresses, not token symbols" }
```

Use mint addresses such as SOL and USDC examples above.

### Decimal amount used instead of raw integer

The API rejects the request:

```json
{ "error": "amountIn must be a positive raw integer amount in atomic token units" }
```

Use raw integer atomic units.

### Provider request fails

The API returns `502` and includes the provider error details. The app does not invent fallback liquidity.

Check:
- Jupiter API key validity,
- provider status,
- token pair support,
- network access,
- `INTEGRATION_REQUEST_TIMEOUT_MS`.

## Sources

- Jupiter Swap Quote docs: `https://dev.jup.ag/docs/swap/v1/get-quote`
- Raydium API docs: `https://docs.raydium.io/raydium/for-developers/api`
