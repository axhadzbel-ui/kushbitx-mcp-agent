# KushBitx MCP agent

MCP-compatible agent driving the published [`@kushbitx/sdk@0.1.0`](https://www.npmjs.com/package/@kushbitx/sdk) — submitted against [kushBitxHQ/kushbitx-sdk#1](https://github.com/kushBitxHQ/kushbitx-sdk/issues/1).

Keyless and reproducible: the full run needs **no LLM key, no wallet, no payment**. An MCP client drives an MCP server (`McpServer` + `InMemoryTransport` from `@modelcontextprotocol/sdk`) through `listTools` + `callTool`: free token preview → advisory SpendGuard evaluation → unsigned x402 challenge discovery → summary.

## What it does

| MCP tool | SDK method | Notes |
|---|---|---|
| `kushbitx_preview_token` | `previewToken` | Free market preview. Not a security verdict. Retries one transient HTTP 503. |
| `kushbitx_evaluate_spend` | `evaluateSpend` | Advisory policy evaluation only. `executionAuthorized` reported as returned. |
| `kushbitx_get_payment_challenge` | `getPaymentChallenge` | Stops at HTTP 402. Never signs or pays. |

SpendGuard **does not execute or block transactions**. Enforcement belongs to the signing or execution layer. No tool requests, stores, or sends a private key. `submitPaidCheck`, recovery, and policy mutation are not exposed.

## Setup

Node 22+.

```bash
git clone <this-repo>
cd kushbitx-mcp-agent
npm install   # pulls @kushbitx/sdk@0.1.0 from the public registry
```

## Run the agent (keyless, free path only)

```bash
npm start
```

Writes sanitized evidence to `evidence/run-output.txt`.

Expected console tail:

```text
preview      : PASS
spendguard   : decision=... executionAuthorized=false
x402 challenge: service=token-risk path=/api/token-risk x402Version=2
No private key was requested, read, or stored. No payment was signed.
```

## Run the MCP server standalone (any MCP host)

```bash
npm run server
```

stdio transport — attach from Claude Desktop, MCP Inspector, or any MCP-compatible client; the server exposes exactly the three tools above.

## Tests (no key required)

```bash
npm test
```

Covers: exactly three tools with no signing surface, input validation, preview 503-retry + genuine-500 failure, SpendGuard advisory / `executionAuthorized: false`, x402 402 handling, MCP `listTools`/`callTool` round-trip, and the full agent loop on a fake client.

## Sample output

See [`evidence/run-output.txt`](evidence/run-output.txt) — sanitized live run. Secrets, keys, signatures, wallet addresses under test, and personal data are stripped.

## Acceptance map

| Requirement | Where |
|---|---|
| Public repo with working integration | this repository |
| `npm install @kushbitx/sdk` | `package.json` (`0.1.0` pinned) |
| Actual agent runtime, not a manual script | `src/agent.mjs` — MCP client drives MCP server tools over an MCP transport |
| Free token preview | `kushbitx_preview_token` |
| One SpendGuard evaluation | `kushbitx_evaluate_spend` |
| Unsigned x402 challenge | `kushbitx_get_payment_challenge` |
| Reproducible setup | this README |
| Sanitized sample output | `evidence/run-output.txt` |
| Automated tests | `npm test` |

## Security

- No keys in the repo (`.gitignore` covers `.env`, `*.pem`).
- - Base payout address sent privately after acceptance, never posted publicly.
  - - Demo recipient `0x0d68…12f22` is the public KushBitx example `payTo`, not a user wallet.
   
    - Apache-2.0.
    - 

## Related tool

Base swap fee comparison (Relay 1% / LI.FI 2% / Socket 0.5%, disclosed, own wallet executes): https://vercel-enrich.netlify.app
