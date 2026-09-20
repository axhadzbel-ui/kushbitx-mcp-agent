#!/usr/bin/env node
/**
   * MCP server exposing exactly three KushBitx tools.
   * stdio transport — plug into any MCP-compatible host (Claude Desktop, MCP Inspector, etc.).
   * No signing surface: submitPaidCheck / prepareRecovery / restoreReport are NOT exposed.
   * No private keys anywhere.
   */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TOOL_NAMES, USDC_BASE, DEMO_RECIPIENT, SPENDGUARD_ADVISORY, createClient, handleTool } from './tools.mjs';

export function buildServer(client) {
    const kushbitx = client || createClient();
    const server = new McpServer(
      { name: 'kushbitx-mcp-agent', version: '1.0.0' },
      { instructions: 'KushBitx AgentProof inspection tools. Free preview + advisory SpendGuard + unsigned x402 challenge discovery. ' + SPENDGUARD_ADVISORY }
        );

  server.registerTool('kushbitx_preview_token', {
        description: 'Free Base token market preview via @kushbitx/sdk. Not a security verdict. No wallet required.',
        inputSchema: { address: z.string().default(USDC_BASE).describe('Base token contract address, 0x-prefixed') }
  }, async (args) => {
        const result = await handleTool('kushbitx_preview_token', args, kushbitx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('kushbitx_evaluate_spend', {
        description: 'Advisory SpendGuard policy evaluation via @kushbitx/sdk. Does not execute, authorize, or block a transaction.',
        inputSchema: {
                agentId: z.string().default('mcp-bounty-agent'),
                requestId: z.string().optional(),
                recipient: z.string().default(DEMO_RECIPIENT),
                amount: z.string().default('1.00')
        }
  }, async (args) => {
        const result = await handleTool('kushbitx_evaluate_spend', args, kushbitx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('kushbitx_get_payment_challenge', {
        description: 'Discover an x402 HTTP 402 payment challenge. Stops at the challenge. Never signs or pays.',
        inputSchema: {
                service: z.enum(['token-risk', 'verify-payment', 'transaction-preflight']).default('token-risk'),
                address: z.string().default(USDC_BASE)
        }
  }, async (args) => {
        const result = await handleTool('kushbitx_get_payment_challenge', args, kushbitx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}

export function listToolNames() {
    return [...TOOL_NAMES];
}

const invoked = process.argv[1] && process.argv[1].endsWith('server.mjs');
if (invoked) {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
