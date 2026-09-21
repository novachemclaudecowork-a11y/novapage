/**
 * 在真實的 Workers 執行環境（workerd）上驗證後台登入。
 *
 * 【為什麼需要這支測試】
 * scripts/test_auth.mjs 跑在 Node 上，而 Node 與 Cloudflare Workers 的
 * Web Crypto 實作有差異。曾經密碼雜湊用了 20 萬次疊代，Node 可以算，
 * 但 Workers 的上限是 10 萬次，結果本機測試全過、部署後卻完全無法登入。
 *
 * 這支測試以 wrangler dev 啟動 workerd，用真實 HTTP 請求走完整個登入流程，
 * 因此與正式環境的行為一致，能攔下這類只在平台上才會出現的問題。
 *
 * 用法：npm run build && node scripts/test_worker_login.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// 兩段測試各用一個埠。若共用同一個埠，前一個 wrangler 尚未完全結束時，
// 後一段會連到仍在執行的舊實例，測到的其實是舊設定。
const PORTS = { normal: 8799, legacy: 8801 };
const PASSWORD = '測試用密碼NovaChem1988';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

/** 產生與 scripts/make-admin-password.mjs 相同格式的雜湊 */
async function makeHash(password, iterations) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256,
  );
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const failures = [];
let pass = 0;
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? `　${extra}` : ''}`);
  if (ok) pass++;
  else failures.push(label);
};

/** 啟動 wrangler dev 並等它就緒，回傳這個實例的基底網址與關閉函式 */
async function startWorker(port, vars) {
  // 先確認這個埠沒有殘留的實例在跑，否則會誤以為新的已經啟動
  try {
    await fetch(`http://127.0.0.1:${port}/__worker-check`);
    throw new Error(`埠 ${port} 已被佔用，請先關閉該程序再執行測試`);
  } catch (err) {
    if (String(err.message).includes('已被佔用')) throw err;
  }

  const args = ['wrangler', 'dev', '--local', '--port', String(port), '--ip', '127.0.0.1'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);

  // detached 讓 wrangler 自成一個行程群組。
  // wrangler 會再開出 workerd 等子程序，只殺父程序的話那些會留下來繼續佔用埠，
  // 下一段測試就會誤連到上一個實例。以負的 PID 終止整個群組才乾淨。
  const proc = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const base = `http://127.0.0.1:${port}`;
  const stop = () => {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
    try { proc.kill('SIGKILL'); } catch {}
  };

  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try {
      if ((await fetch(`${base}/__worker-check`)).ok) return { base, stop };
    } catch {
      // 尚未啟動完成，繼續等
    }
  }
  stop();
  throw new Error(`wrangler dev 未能在時限內於埠 ${port} 啟動`);
}

const login = (base, password) =>
  fetch(`${base}/admin/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

console.log('在 workerd 上驗證登入（這是正式環境使用的執行環境）\n');

// ---------- 正常情況：10 萬次疊代 ----------
console.log('疊代次數 10 萬（目前的設定）：');
let { base: BASE, stop } = await startWorker(PORTS.normal, {
  ADMIN_PASSWORD_HASH: await makeHash(PASSWORD, 100_000),
  SESSION_SECRET: b64(crypto.getRandomValues(new Uint8Array(32))),
});
try {
  const wrong = await login(BASE, '這是錯的密碼一二三四');
  check('密碼錯誤回 401', wrong.status === 401, (await wrong.json()).error ?? '');

  const right = await login(BASE, PASSWORD);
  const body = await right.json();
  check('密碼正確回 200', right.status === 200, JSON.stringify(body));
  check('確實完成雜湊運算而非平台錯誤', !JSON.stringify(body).includes('not supported'));

  const cookie = right.headers.get('set-cookie')?.split(';')[0] ?? '';
  check('發出登入通行證', cookie.startsWith('novapage_admin='));

  const me = await fetch(`${BASE}/admin/api/me`, { headers: { Cookie: cookie } });
  const meBody = await me.json();
  check('帶通行證可存取後台 API', me.status === 200, JSON.stringify(meBody));

  // 前端要能在還沒過期前就提醒，而不是等存檔失敗才說
  const hours = (meBody.expiresAt - Date.now()) / 3600_000;
  check('回報到期時間，前端才能提前提醒', hours > 11.9 && hours < 12.1, `剩 ${hours.toFixed(2)} 小時`);

  // me 是前端定時探詢用的。若它也續期，一個沒人在用、只是開著的分頁
  // 就能讓登入永遠不過期，12 小時的效期等於形同虛設。
  check('me 不會延長登入時效', me.headers.get('set-cookie') === null,
    me.headers.get('set-cookie') ?? '（沒有 Set-Cookie，正確）');

  const anon = await fetch(`${BASE}/admin/api/me`);
  check('未帶通行證回 401', anon.status === 401);
} finally {
  stop();
}

// ---------- 迴歸測試：超過平台上限的舊雜湊 ----------
console.log('\n疊代次數 20 萬（超過平台上限，早期版本的設定）：');
const legacy = await startWorker(PORTS.legacy, {
  ADMIN_PASSWORD_HASH: await makeHash(PASSWORD, 200_000),
  SESSION_SECRET: b64(crypto.getRandomValues(new Uint8Array(32))),
});
try {
  const res = await login(legacy.base, PASSWORD);
  const body = await res.json();
  check('拒絕登入', res.status !== 200, String(res.status));
  check(
    '訊息說明原因與處理方式',
    (body.error ?? '').includes('疊代次數') && (body.error ?? '').includes('admin:password'),
    body.error ?? '',
  );
} finally {
  legacy.stop();
}

console.log(`\n${failures.length ? '❌' : '✅'} 通過 ${pass} 項${failures.length ? `，失敗 ${failures.length} 項` : '，全數符合預期'}`);
for (const f of failures) console.log('   ' + f);
process.exit(failures.length ? 1 : 0);
