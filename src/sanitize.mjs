const SECRET_PATTERNS = [
    /0x[a-fA-F0-9]{64}/g, // private keys / tx hashes / nonces
    /[A-Za-z0-9+/]{40,}={0,2}/g, // base64 blobs (PAYMENT-SIGNATURE etc.)
    /(sk-[A-Za-z0-9-_]+|xai-[A-Za-z0-9-_]+|gsk_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9-_.~+/]+)/g
  ];

export function sanitizeText(text) {
    let out = String(text ?? '');
    for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
    return out;
}
