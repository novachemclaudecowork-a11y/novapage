/**
 * 後台密碼登入與通行證的安全測試。
 *
 * 這是後台的第二道安全邊界（第一道是 Cloudflare Access，見 test_access.mjs）。
 * 這裡不只測「密碼對了能進去」，而是逐一嘗試各種偽造與繞過手法，
 * 確認每一種都被擋下。
 *
 * 用法：node scripts/test_auth.mjs
 */
import {
  createSession,
  isRateLimited,
  sessionCookieHeader,
  verifyPassword,
  verifySession,
} from '../worker/auth.js';

// 刻意含英文字母，否則大小寫那一項測不到東西
const PASSWORD = 'NovaChem1988測試密碼';
const ITERATIONS = 1000; // 測試用低疊代，加快執行；正式設定為 20 萬次

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

async function makeHash(password, iterations = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256,
  );
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const env = {
  ADMIN_PASSWORD_HASH: await makeHash(PASSWORD),
  SESSION_SECRET: b64(crypto.getRandomValues(new Uint8Array(32))),
};

let pass = 0;
const failures = [];

function check(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    failures.push(`${label}：預期 ${expected}，實際 ${actual}`);
    console.log(`  ❌ ${label}`);
  }
}

console.log('密碼驗證：');
check('正確密碼通過', await verifyPassword(PASSWORD, env, 'ip-a'), true);
check('錯誤密碼拒絕', await verifyPassword('錯的密碼錯的密碼', env, 'ip-b'), false);
check('空密碼拒絕', await verifyPassword('', env, 'ip-c'), false);
check('英文字母大小寫不同視為錯誤', await verifyPassword('NOVACHEM1988測試密碼', env, 'ip-d'), false);

try {
  await verifyPassword(PASSWORD, {}, 'ip-e');
  failures.push('未設定密碼時應拒絕：❌ 竟然通過');
} catch (err) {
  console.log(`  ✅ 未設定密碼時拒絕（${err.message}）`);
  pass++;
}
try {
  await verifyPassword(PASSWORD, { ADMIN_PASSWORD_HASH: '亂寫的格式' }, 'ip-f');
  failures.push('設定格式錯誤時應拒絕：❌ 竟然通過');
} catch (err) {
  console.log(`  ✅ 設定格式錯誤時拒絕（${err.message}）`);
  pass++;
}

console.log('\n通行證：');
const token = await createSession(env);
check('正常通行證通過', await verifySession(token, env), true);

const [payload, signature] = token.split('.');
check('竄改內容沿用原簽章', await verifySession(`${payload}X.${signature}`, env), false);
check('竄改簽章', await verifySession(`${payload}.${signature.slice(0, -2)}AA`, env), false);
check('只有內容沒有簽章', await verifySession(payload, env), false);
check('空字串', await verifySession('', env), false);
check('亂數字串', await verifySession('abc.def', env), false);

const otherEnv = { SESSION_SECRET: b64(crypto.getRandomValues(new Uint8Array(32))) };
check('用別的密鑰簽的通行證', await verifySession(await createSession(otherEnv), env), false);
check('伺服器未設定密鑰時一律拒絕', await verifySession(token, {}), false);

// 手工組一張已過期的通行證，驗證期限確實有檢查
const b64url = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const expiredPayload = b64url(
  new TextEncoder().encode(JSON.stringify({ exp: Date.now() - 1000, v: 1 })),
);
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode(env.SESSION_SECRET),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
);
const expiredSig = b64url(
  new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(expiredPayload))),
);
check('簽章正確但已過期', await verifySession(`${expiredPayload}.${expiredSig}`, env), false);

console.log('\n嘗試次數限制：');
const attacker = 'ip-attacker';
check('一開始未被鎖', isRateLimited(attacker), false);
for (let i = 0; i < 8; i++) await verifyPassword('猜錯的密碼猜錯的密碼', env, attacker);
check('連續失敗 8 次後被鎖', isRateLimited(attacker), true);
check('其他來源不受影響', isRateLimited('ip-innocent'), false);

console.log('\nCookie 設定：');
const header = sessionCookieHeader(token);
check('標記 HttpOnly（JavaScript 讀不到）', header.includes('HttpOnly'), true);
check('標記 Secure（只走 HTTPS）', header.includes('Secure'), true);
check('標記 SameSite=Strict（防跨站攜帶）', header.includes('SameSite=Strict'), true);
check('限定 /admin 路徑', header.includes('Path=/admin'), true);
check('登出時立即失效', sessionCookieHeader(null).includes('Max-Age=0'), true);

console.log(`\n${failures.length ? '❌' : '✅'} 通過 ${pass} 項${failures.length ? `，失敗 ${failures.length} 項` : '，全數符合預期'}`);
for (const f of failures) console.log('   ' + f);
process.exit(failures.length ? 1 : 0);
