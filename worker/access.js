/**
 * 驗證 Cloudflare Access 簽發的身分權杖。
 *
 * 【為什麼要自己驗，不能只靠 Cloudflare Access 擋】
 * Access 是掛在網域路由上的。workers.dev 的網址、設定變更、
 * 或路由沒涵蓋到的路徑，都可能讓請求繞過 Access 直接打到 Worker。
 * 因此後台的每個請求都必須自行驗證權杖簽章，驗不過就拒絕。
 * 安全不能建立在「別人不知道網址」或「設定應該有生效」之上。
 *
 * Access 會把權杖放在 Cf-Access-Jwt-Assertion 標頭
 * （瀏覽器直接存取時也會有 CF_Authorization cookie）。
 */

/** 公鑰會被快取，避免每個請求都去抓一次 */
let jwksCache = { url: null, keys: null, fetchedAt: 0 };
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 小時

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeJson(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)));
}

async function getJwks(teamDomain) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const fresh = jwksCache.url === url && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh && jwksCache.keys) return jwksCache.keys;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`無法取得 Access 公鑰（${res.status}）`);
  const body = await res.json();
  jwksCache = { url, keys: body.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

/**
 * 驗證權杖並回傳使用者身分。
 * 任何一項不符就丟出例外，呼叫端一律視為未授權。
 *
 * @returns {Promise<{email: string, sub: string}>}
 */
export async function verifyAccessJwt(request, env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (!teamDomain || !audience) {
    // 設定不全時一律拒絕，而不是放行。設定漏掉不該變成沒有保護。
    throw new Error('後台尚未完成 Cloudflare Access 設定');
  }

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    (request.headers.get('Cookie') ?? '').match(/CF_Authorization=([^;]+)/)?.[1];
  if (!token) throw new Error('缺少登入憑證');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('登入憑證格式不正確');
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = decodeJson(headerB64);
  const payload = decodeJson(payloadB64);

  if (header.alg !== 'RS256') throw new Error('不支援的簽章演算法');

  const keys = await getJwks(teamDomain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('找不到對應的簽章金鑰');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new Error('登入憑證簽章驗證失敗');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) throw new Error('登入憑證已過期');
  if (typeof payload.nbf === 'number' && payload.nbf > now) throw new Error('登入憑證尚未生效');

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) throw new Error('登入憑證不屬於本應用');

  if (payload.iss !== `https://${teamDomain}`) throw new Error('登入憑證簽發者不正確');

  return { email: payload.email ?? '', sub: payload.sub ?? '' };
}
