#!/usr/bin/env node
/**
   * MCP-compatible agent loop (no API key required).
   *
   * The agent drives the MCP server over an in-process transport with a
   * deterministic planner: list tools -> preview_token -> evaluate_spend ->
   * get_payment_challenge -> summarize. Each step is an MCP client->server
   * tool call (listTools + callTool), so the integration is a genuine
   * MCP-compatible agent runtime, not a direct SDK script.
   *
   * No private key is requested, stored, or used. Nothing is signed or paid.
   * SpendGuard output is reported as advisory with executionAuthorized as returned.
   */
import { writeFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './server.mjs';
import { USDC_BASE, DEMO_RECIPIENT, SPENDGUARD_ADVISORY, createClient } from './tools.mjs';
import { sanitizeText } from './sanitize.mjs';

export const PLAN = Object.freeze([
  { tool: 'kushbitx_preview_token', args: { address: USDC_BASE } },
  { tool: 'kushbitx_evaluate_spend', args: { agentId: 'mcp-bounty-agent', recipient: DEMO_RECIPIENT, amount: '1.00' } },
  { tool: 'kushbitx_get_payment_challenge', args: { service: 'token-risk', address: USDC_BASE } }
  ]);

export function summarizeCapability() {
    return 'MCP-compatible agent: MCP client drives MCP server tools (listTools + callTool) over an MCP transport. ' + SPENDGUARD_ADVISORY;
}

export async function runAgent({ kushbitxClient, evidence, now = () => 'req-' + Date.now() } = {}) {
    const server = buildServer(kushbitxClient || createClient());
    if (!(server instanceof McpServer)) throw new Error('agent must drive an MCP server instance');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'kushbitx-mcp-agent-loop', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.listTools();
    const available = new Set((listed.tools || []).map((t) => t.name));
    const trace = [{ step: 'listTools', tools: [...available] }];
    const toolsUsed = [];
    let preview = null;
    let spend = null;
    let challenge = null;

  try {
        for (const step of PLAN) {
                if (!available.has(step.tool)) throw new Error('MCP server is missing tool: ' + step.tool);
                const args = step.tool === 'kushbitx_evaluate_spend'
                  ? { ...step.args, requestId: now() }
                          : step.args;
                const res = await client.callTool({ name: step.tool, arguments: args });
                const text = (res.content || []).map((b) => b.text || '').join('\n');
                const parsed = JSON.parse(text);
                toolsUsed.push(step.tool);
                trace.push({ step: step.tool, ok: parsed.ok === true });
                if (step.tool === 'kushbitx_preview_token') preview = parsed;
                if (step.tool === 'kushbitx_evaluate_spend') spend = parsed;
                if (step.tool === 'kushbitx_get_payment_challenge') challenge = parsed;
        }
  } finally {
        await Promise.allSettled([client.close(), server.close()]);
  }

  if (!preview?.ok || !spend?.ok || !challenge?.ok) throw new Error('agent run incomplete: one or more MCP tool calls failed');

  const result = {
        runtime: 'MCP-compatible agent (MCP client + MCP server over MCP transport, planner-driven tool calls)',
        toolsUsed,
        signed: false,
        paid: false,
        spendGuardAdvisory: SPENDGUARD_ADVISORY,
        previewOk: preview.data?.preview === true || preview.data?.token?.symbol === 'USDC',
        spendDecision: spend.data?.decision || null,
        executionAuthorized: spend.data?.executionAuthorized === true,
        challengeService: challenge.service || null,
        challengePath: challenge.path || null,
        x402Version: challenge.challenge?.x402Version ?? null,
        paymentRequiredHeaderPresent: challenge.paymentRequiredHeaderPresent === true,
        trace
  };

  const lines = [
        '# KushBitx MCP agent - sanitized run',
        'Generated: ' + new Date().toISOString(),
        'Runtime: ' + result.runtime,
        'Tools: ' + result.toolsUsed.join(', '),
        'Signed: false; Paid: false',
        SPENDGUARD_ADVISORY,
        'No private key, seed, PAYMENT-SIGNATURE, recovery key, wallet address under test, or personal data appears in this log.',
        '',
        'preview: ' + (result.previewOk ? 'PASS' : 'MISS'),
        'spendguard: ' + (spend?.ok ? 'PASS decision=' + result.spendDecision + ' executionAuthorized=' + result.executionAuthorized : 'MISS'),
        'x402 challenge: ' + (challenge?.ok ? 'PASS service=' + result.challengeService + ' path=' + result.challengePath + ' x402Version=' + result.x402Version : 'MISS'),
        '',
        sanitizeText(JSON.stringify({ trace: result.trace }, null, 2)),
        ''
      ].join('\n');

  if (evidence) await writeFile(evidence, lines);
    return { result, evidenceText: lines };
}

function printReport(result) {
    console.log('====================================================================');
    console.log('KushBitx MCP agent (MCP-compatible, keyless)');
    console.log('====================================================================');
    console.log('Runtime:', result.runtime);
    console.log('Tools called via MCP:', result.toolsUsed.join(', '));
    console.log('Signed:', result.signed, '| Paid:', result.paid);
    console.log(result.spendGuardAdvisory);
    console.log('preview      :', result.previewOk ? 'PASS' : 'MISS');
    console.log('spendguard   :', 'decision=' + result.spendDecision, 'executionAuthorized=' + result.executionAuthorized);
    console.log('x402 challenge:', 'service=' + result.challengeService, 'path=' + result.challengePath, 'x402Version=' + result.x402Version);
    console.log('No private key was requested, read, or stored. No payment was signed.');
}

const invoked = process.argv[1] && process.argv[1].endsWith('agent.mjs');
if (invoked) {
    let evidence = 'evidence/run-output.txt';
    const idx = process.argv.indexOf('--evidence');
    if (idx !== -1 && process.argv[idx + 1]) evidence = process.argv[idx + 1];
    const { result, evidenceText } = await runAgent({ evidence });
    printReport(result);
    console.log('\nWrote sanitized evidence to', evidence);
    void evidenceText;
}
