import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOL_NAMES, SPENDGUARD_ADVISORY, handleTool, normalizeSpendArgs, validateAddress } from '../src/tools.mjs';
import { buildServer } from '../src/server.mjs';
import { runAgent, PLAN } from '../src/agent.mjs';

function fakeKushbitx() {
    return {
          async previewToken(address) {
                  assert.match(address, /^0x[a-fA-F0-9]{40}$/);
                  return { preview: true, token: { symbol: 'USDC', address } };
          },
          async evaluateSpend(input) {
                  assert.equal(input.chain, 'base');
                  assert.equal(input.asset, 'USDC');
                  return { decision: 'HUMAN_APPROVAL', advisory: true, executionAuthorized: false, echo: input.requestId };
          },
          async getPaymentChallenge(service, input) {
                  assert.equal(service, 'token-risk');
                  assert.equal(input.chain, 'base');
                  return { service, path: '/api/token-risk', challenge: { x402Version: 2 }, paymentRequired: 'p' };
          }
    };
}

describe('tool registry', () => {
    it('exposes exactly three tools, no signing surface', () => {
          assert.deepEqual([...TOOL_NAMES], ['kushbitx_preview_token', 'kushbitx_evaluate_spend', 'kushbitx_get_payment_challenge']);
          const forbidden = ['kushbitx_sign', 'kushbitx_pay', 'kushbitx_submit_payment', 'submitPaidCheck', 'prepareRecovery', 'restoreReport'];
          assert.ok(!TOOL_NAMES.some((n) => forbidden.includes(n)));
    });
    it('rejects unknown and forbidden tools', async () => {
          await assert.rejects(() => handleTool('kushbitx_sign', {}, fakeKushbitx()), /forbidden|Unknown/);
          await assert.rejects(() => handleTool('submitPaidCheck', {}, fakeKushbitx()), /forbidden|Unknown/);
          await assert.rejects(() => handleTool('nope', {}, fakeKushbitx()), /Unknown/);
    });
    it('validates addresses and spend input', async () => {
          await assert.rejects(() => handleTool('kushbitx_preview_token', { address: 'bad' }, fakeKushbitx()), /address/);
          await assert.rejects(() => handleTool('kushbitx_get_payment_challenge', { service: 'nope' }, fakeKushbitx()), /unknown paid service/);
          assert.throws(() => validateAddress('0x123', 'address'), /address/);
          const norm = normalizeSpendArgs({});
          assert.equal(norm.chain, 'base');
          assert.equal(norm.asset, 'USDC');
    });
    it('advisory copy never claims enforcement', () => {
          assert.match(SPENDGUARD_ADVISORY, /advisory/i);
          assert.match(SPENDGUARD_ADVISORY, /signing or execution layer/);
    });
});

describe('MCP server', () => {
    it('builds a real McpServer with three tools callable over the MCP transport', async () => {
          const server = buildServer(fakeKushbitx());
          assert.ok(server instanceof McpServer);
          const [ct, st] = InMemoryTransport.createLinkedPair();
          const client = new Client({ name: 'test', version: '1.0.0' });
          await Promise.all([server.connect(st), client.connect(ct)]);
          try {
                  const listed = await client.listTools();
                  assert.deepEqual(listed.tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
                  for (const name of TOOL_NAMES) {
                            const step = PLAN.find((p) => p.tool === name);
                            const res = await client.callTool({ name, arguments: step.args });
                            const text = res.content.map((b) => b.text).join('');
                            const parsed = JSON.parse(text);
                            assert.equal(parsed.ok, true);
                            assert.equal(parsed.paid, parsed.tool === 'kushbitx_get_payment_challenge' ? false : parsed.paid);
                  }
                  const spend = await client.callTool({ name: 'kushbitx_evaluate_spend', arguments: PLAN[1].args });
                  const spendParsed = JSON.parse(spend.content.map((b) => b.text).join(''));
                  assert.equal(spendParsed.executionAuthorized, false);
                  assert.equal(spendParsed.note, SPENDGUARD_ADVISORY);
          } finally {
                  await Promise.allSettled([client.close(), server.close()]);
          }
    });
});

describe('agent loop', () => {
    it('drives all three MCP tools and stops unsigned/unpaid (fake client)', async () => {
          const { result } = await runAgent({ kushbitxClient: fakeKushbitx() });
          assert.deepEqual(result.toolsUsed, PLAN.map((p) => p.tool));
          assert.equal(result.signed, false);
          assert.equal(result.paid, false);
          assert.equal(result.executionAuthorized, false);
          assert.equal(result.x402Version, 2);
          assert.equal(result.previewOk, true);
    });
    it('preview retry recovers from one transient 503 then succeeds', async () => {
          let calls = 0;
          const flaky = fakeKushbitx();
          flaky.previewToken = async () => {
                  if (++calls === 1) throw new Error('Market data temporarily unavailable (HTTP 503)');
                  return { preview: true, token: { symbol: 'USDC' } };
          };
          const { result } = await runAgent({ kushbitxClient: flaky });
          assert.equal(result.previewOk, true);
          assert.equal(calls, 2);
    });
    it('genuine failure surfaces instead of passing silently', async () => {
          const broken = fakeKushbitx();
          broken.previewToken = async () => { throw new Error('boom 500'); };
          await assert.rejects(() => runAgent({ kushbitxClient: broken }), /boom/);
    });
});
