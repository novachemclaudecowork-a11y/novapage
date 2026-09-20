/**
 * 後台身分驗證的安全測試。
 *
 * 這段程式是整個後台的安全邊界：驗證通過就能改動網站內容。
 * 因此這裡實際產生金鑰、簽出權杖，再逐一竄改各個欄位，
 * 確認每一種偽造都會被擋下來，而不是只測「正常情況下可以通過」。
 *
 * 用法：node scripts/test_access.mjs
 */
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const TEAM = 'example.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const KID = 'test-key-1';

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const jwk = await crypto.subtle.exportKey('jwk', publicKey);

// 另一把金鑰，用來模擬「用不是 Access 的金鑰簽出來的權杖」
const other = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);

const b64url = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encodeJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function makeToken({ header = {}, payload = {}, key = privateKey, tamper = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = encodeJson({ alg: 'RS256', kid: KID, typ: 'JWT', ...header });
  const p = encodeJson({
    aud: AUD,
    iss: `https://${TEAM}`,
    email: 'someone@novananoinks.com.tw',
    sub: 'user-1',
    iat: now,
    exp: now + 3600,
    ...payload,
  });
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${h}.${p}`),
  );
  const signature = b64url(sig);
  if (tamper) {
    // 竄改內容但沿用原簽章
    const evil = encodeJson({ aud: AUD, iss: `https://${TEAM}`, email: 'attacker@evil.test', exp: now + 3600 });
    return `${h}.${evil}.${signature}`;
  }
  return `${h}.${p}.${signature}`;
}

// 攔截取得公鑰的請求，改由本機提供
globalThis.fetch = async (url) => {
  if (String(url) === `https://${TEAM}/cdn-cgi/access/certs`) {
    return new Response(JSON.stringify({ keys: [{ ...jwk, kid: KID }] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response('not found', { status: 404 });
};

const { verifyAccessJwt } = await import('../worker/access.js');

const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const req = (token, headers = {}) =>
  new Request('https://x/admin/api/me', {
    headers: { ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}), ...headers },
  });

let pass = 0;
const failures = [];

async function expectAccept(label, request, environment = env) {
  try {
    const user = await verifyAccessJwt(request, environment);
    console.log(`  ✅ ${label} → 通過（${user.email}）`);
    pass++;
  } catch (err) {
    failures.push(`${label}：應該通過卻被拒絕（${err.message}）`);
  }
}

async function expectReject(label, request, environment = env) {
  try {
    await verifyAccessJwt(request, environment);
    failures.push(`${label}：❌ 應該被拒絕卻通過了`);
  } catch (err) {
    console.log(`  ✅ ${label} → 拒絕（${err.message}）`);
    pass++;
  }
}

const now = Math.floor(Date.now() / 1000);

console.log('合法情況：');
await expectAccept('正常權杖', req(await makeToken()));
await expectAccept('放在 cookie 而非標頭', req(null, { Cookie: `CF_Authorization=${await makeToken()}` }));

console.log('\n偽造與異常情況：');
await expectReject('完全沒有權杖', req(null));
await expectReject('格式不是 JWT', req('not-a-jwt'));
await expectReject('竄改內容沿用原簽章', req(await makeToken({ tamper: true })));
await expectReject('用別把金鑰簽的', req(await makeToken({ key: other.privateKey })));
await expectReject('已過期', req(await makeToken({ payload: { exp: now - 10 } })));
await expectReject('尚未生效', req(await makeToken({ payload: { nbf: now + 600 } })));
await expectReject('aud 不是本應用', req(await makeToken({ payload: { aud: 'someone-elses-app' } })));
await expectReject('iss 不是本團隊', req(await makeToken({ payload: { iss: 'https://evil.cloudflareaccess.com' } })));
await expectReject('alg 改成 none', req(await makeToken({ header: { alg: 'none' } })));
await expectReject('kid 指向不存在的金鑰', req(await makeToken({ header: { kid: 'unknown-key' } })));
await expectReject('環境變數未設定時不得放行', req(await makeToken()), {});
await expectReject('只設了 team domain 也不放行', req(await makeToken()), { ACCESS_TEAM_DOMAIN: TEAM });

console.log(`\n${failures.length ? '❌' : '✅'} 通過 ${pass} 項${failures.length ? `，失敗 ${failures.length} 項` : '，全數符合預期'}`);
for (const f of failures) console.log('   ' + f);
process.exit(failures.length ? 1 : 0);
