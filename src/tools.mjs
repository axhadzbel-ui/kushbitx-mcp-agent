import { KushBitxClient } from '@kushbitx/sdk';

export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
/** Public example payTo from KushBitx docs — not a user wallet. */
export const DEMO_RECIPIENT = '0x0d68028d06af13379C872FEE032568B4Be712f22';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const PAID_SERVICES = new Set(['token-risk', 'verify-payment', 'transaction-preflight']);

export const TOOL_NAMES = Object.freeze([
    'kushbitx_preview_token',
    'kushbitx_evaluate_spend',
    'kushbitx_get_payment_challenge'
  ]);

export const SPENDGUARD_ADVISORY =
    'SpendGuard is advisory. It does not execute or block a transaction. Enforcement belongs to the signing or execution layer.';

export function validateAddress(address, name = 'address') {
    if (typeof address !== 'string' || !ADDRESS_RE.test(address)) {
          throw new Error(name + ' must be a 0x-prefixed 40-hex-character address');
    }
    return address;
}

export function createClient(options = {}) {
    return new KushBitxClient(options);
}

export async function withPreviewRetry(fn, { attempts = 4, delayMs = 350 } = {}) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
          try {
                  return await fn();
          } catch (error) {
                  lastError = error;
                  const message = String(error?.message || error);
                  const transient = /503|temporarily unavailable|Market data/i.test(message);
                  if (!transient || i === attempts - 1) throw error;
                  await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
          }
    }
    throw lastError;
}

export function normalizeSpendArgs(args = {}) {
    const agentId = args.agentId || 'mcp-bounty-agent';
    const requestId = args.requestId || 'req-' + Date.now();
    const chain = 'base';
    const asset = 'USDC';
    const recipient = validateAddress(args.recipient || DEMO_RECIPIENT, 'recipient');
    const amount = typeof args.amount === 'string' && args.amount.trim() !== '' ? args.amount : '1.00';
    const policy = args.policy && typeof args.policy === 'object' ? args.policy : {};
    return {
          agentId,
          requestId,
          chain,
          asset,
          recipient,
          amount,
          policy: {
                  maxPerTransaction: policy.maxPerTransaction || '5.00',
                  remainingDailyBudget: policy.remainingDailyBudget || '20.00',
                  requireHumanAbove: policy.requireHumanAbove || '2.00',
                  maxRepeats: Number.isInteger(policy.maxRepeats) ? policy.maxRepeats : 1,
                  allowedRecipients: Array.isArray(policy.allowedRecipients) && policy.allowedRecipients.length > 0
                    ? policy.allowedRecipients.map((a) => validateAddress(a, 'policy.allowedRecipients[]'))
                            : [recipient],
                  blockUnknownRecipients: typeof policy.blockUnknownRecipients === 'boolean' ? policy.blockUnknownRecipients : true
          }
    };
}

export async function handleTool(name, rawArgs, client) {
    if (!TOOL_NAMES.includes(name)) throw new Error('Unknown or forbidden tool: ' + name);
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    if (name === 'kushbitx_preview_token') {
          const address = validateAddress(args.address || USDC_BASE, 'address');
          const data = await withPreviewRetry(() => client.previewToken(address));
          return {
                  ok: true, tool: name, advisory: true,
                  note: 'Market preview only. Not a security verdict or safety guarantee.',
                  data
          };
    }
    if (name === 'kushbitx_evaluate_spend') {
          const input = normalizeSpendArgs(args);
          const data = await client.evaluateSpend(input);
          return {
                  ok: true, tool: name, advisory: true,
                  executionAuthorized: data?.executionAuthorized === true,
                  note: SPENDGUARD_ADVISORY,
                  data
          };
    }
    const service = args.service || 'token-risk';
    if (!PAID_SERVICES.has(service)) throw new Error('unknown paid service');
    const input = service === 'token-risk'
      ? { chain: 'base', address: validateAddress(args.address || USDC_BASE, 'address') }
          : service === 'transaction-preflight'
        ? { chain: 'base', to: validateAddress(args.to || DEMO_RECIPIENT, 'to') }
            : { chain: 'base', txHash: args.txHash, expectedTo: args.expectedTo, expectedAmount: args.expectedAmount };
    const result = await client.getPaymentChallenge(service, input);
    return {
          ok: true, tool: name, signed: false, paid: false,
          stoppedAt: 'HTTP 402 payment challenge',
          note: 'Challenge discovered only. No signature, payment, recovery key, or private key was created.',
          service: result.service,
          path: result.path,
          paymentRequiredHeaderPresent: Boolean(result.paymentRequired),
          challenge: result.challenge
    };
}
