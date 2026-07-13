const encoder = new TextEncoder();
const b64 = (value) => btoa(String.fromCharCode(...new Uint8Array(value)))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replaceAll("=", "");
const unb64 = (value) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function sha256(value) {
  return b64(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function sha256Bytes(value) {
  return b64(await crypto.subtle.digest("SHA-256", value));
}

export async function issueToken(payload, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const body = b64(encoder.encode(JSON.stringify({ iat: nowSeconds, ...payload })));
  const signature = b64(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body)));
  return `${body}.${signature}`;
}

export async function verifyToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const [body, signature, extra] = String(token ?? "").split(".");
  if (!body || !signature || extra) throw new Error("访问令牌无效");
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64(signature), encoder.encode(body));
  } catch {
    valid = false;
  }
  if (!valid) throw new Error("访问令牌无效");
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(unb64(body)));
  } catch {
    throw new Error("访问令牌无效");
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) throw new Error("访问令牌已过期");
  return payload;
}
