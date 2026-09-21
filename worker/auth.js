/**
 * 後台的密碼登入與登入狀態。
 *
 * 設計要點：
 *   - 伺服器只存密碼的 PBKDF2 雜湊，不存密碼本身。即使設定外流也無法反推。
 *   - 比對雜湊與簽章都用固定時間比較，避免從回應時間推測正確值。
 *   - 登入後發一張 HMAC 簽章的通行證放在 cookie，內容無法被竄改。
 *   - 失敗次數過多會暫時鎖住，配合 PBKDF2 的運算成本壓制暴力破解。
 *
 * 需要的 Secret（在 Cloudflare 的 Worker 設定中新增）：
 *   ADMIN_PASSWORD_HASH  由 scripts/make-admin-password.mjs 產生
 *   SESSION_SECRET       同上，用來簽發通行證
 */
const COOKIE_NAME = 'novapage_admin';

// Cloudflare Workers 的 Web Crypto 對 PBKDF2 疊代次數的上限。
// 超過這個值，crypto.subtle.deriveBits 會直接失敗。
const MAX_ITERATIONS = 100_000;
const SESSION_HOURS = 12;

// 同一來源在時間窗內可嘗試的次數。
// 這份計數存在記憶體中，Worker 重啟或換執行個體就會歸零，
// 因此它只是第一道防線；真正的阻力來自 PBKDF2 每次驗證的運算成本。
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map();

const encoder = new TextEncoder();

const b64urlEncode = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function b64urlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** 固定時間比較，長度不同一律視為不符 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** 檢查來源是否已被暫時鎖住 */
export function isRateLimited(clientId) {
  const record = attempts.get(clientId);
  if (!record) return false;
  if (Date.now() - record.firstAt > WINDOW_MS) {
    attempts.delete(clientId);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(clientId) {
  const record = attempts.get(clientId);
  if (!record || Date.now() - record.firstAt > WINDOW_MS) {
    attempts.set(clientId, { count: 1, firstAt: Date.now() });
  } else {
    record.count += 1;
  }
}

/**
 * 驗證密碼。
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, env, clientId) {
  const stored = env.ADMIN_PASSWORD_HASH;
  // 沒設定密碼時一律拒絕，而不是放行
  if (!stored) throw new Error('後台尚未設定密碼');

  const [scheme, iterationsText, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterationsText || !saltB64 || !hashB64) {
    throw new Error('後台密碼設定格式不正確');
  }

  // Cloudflare Workers 的 PBKDF2 上限為 10 萬次疊代。
  // 早期版本的產生器用了 20 萬次，那種雜湊在此無法驗證，
  // 直接說明該怎麼處理，而不是拋出平台的英文錯誤訊息。
  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations > MAX_ITERATIONS) {
    throw new Error(
      `後台密碼設定不相容（疊代次數 ${iterationsText} 超過平台上限 ${MAX_ITERATIONS}）。` +
        '請重新執行 npm run admin:password 產生一組新的，並更新 Cloudflare 上的 ADMIN_PASSWORD_HASH。',
    );
  }

  const derived = await pbkdf2(password ?? '', decodeBase64(saltB64), iterations);
  const ok = timingSafeEqual(derived, decodeBase64(hashB64));
  if (!ok) recordFailure(clientId);
  else attempts.delete(clientId);
  return ok;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** 發一張有效期限內的通行證 */
export async function createSession(env) {
  if (!env.SESSION_SECRET) throw new Error('後台尚未設定 SESSION_SECRET');
  const payload = b64urlEncode(
    encoder.encode(
      JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600 * 1000, v: 1 }),
    ),
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(env.SESSION_SECRET),
    encoder.encode(payload),
  );
  return `${payload}.${b64urlEncode(new Uint8Array(signature))}`;
}

/**
 * 驗證通行證並取出到期時間。
 * 任何不符都回傳 null，不丟出例外以免洩漏細節。
 *
 * @returns {Promise<number|null>} 到期時間（毫秒），無效則為 null
 */
export async function sessionExpiry(token, env) {
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(env.SESSION_SECRET),
    encoder.encode(payload),
  );
  if (!timingSafeEqual(new Uint8Array(expected), b64urlDecode(signature))) return null;

  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    return data.exp;
  } catch {
    return null;
  }
}

/** 驗證通行證。任何不符都回傳 false，不丟出例外以免洩漏細節。 */
export async function verifySession(token, env) {
  return (await sessionExpiry(token, env)) !== null;
}

/**
 * 通行證是否該換新的。
 *
 * 過了效期一半就重發，讓持續在編輯的人不會做到一半被登出。
 * 只在「真的有動作」的請求上呼叫（存檔、讀資料、上傳），
 * 不包含前端定時探詢的 me——否則一個沒人在用、只是開著的分頁
 * 就能讓登入永遠不過期。
 */
export function shouldRenewSession(expiresAt) {
  if (!expiresAt) return false;
  const remaining = expiresAt - Date.now();
  return remaining < (SESSION_HOURS * 3600 * 1000) / 2;
}

export function readSessionCookie(request) {
  const cookie = request.headers.get('Cookie') ?? '';
  return cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))?.[1] ?? null;
}

export function sessionCookieHeader(token) {
  const maxAge = token ? SESSION_HOURS * 3600 : 0;
  return (
    `${COOKIE_NAME}=${token ?? ''}; Path=/admin; HttpOnly; Secure; ` +
    `SameSite=Strict; Max-Age=${maxAge}`
  );
}

export function clientIdOf(request) {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}
