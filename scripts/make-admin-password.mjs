/**
 * 產生後台密碼的雜湊值。
 *
 * 密碼本身不會被儲存，也不需要告訴任何人——包含協助開發的人。
 * 這支程式在你自己的電腦上跑，輸出的雜湊值才貼到 Cloudflare 當作 secret。
 * 即使雜湊值外流，也無法反推回原密碼。
 *
 * 用法：
 *   node scripts/make-admin-password.mjs
 * 依提示輸入密碼，輸入時畫面不會顯示字元，是正常的。
 */
import { webcrypto } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// 疊代次數越高，每次嘗試越慢，暴力破解的成本也越高。
// 20 萬次在 Cloudflare Workers 上約需 100 毫秒，使用者無感，
// 但攻擊者每秒能試的次數會被壓到很低。
const ITERATIONS = 200_000;
const MIN_LENGTH = 12;

const b64 = (buf) => Buffer.from(buf).toString('base64');

async function hashPassword(password, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

// 輸入的字元不顯示在畫面上。用一層 Writable 過濾輸出，
// 這個做法在終端機與管線輸入下都能正常運作。
const muted = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted.hide) stdout.write(chunk);
    callback();
  },
});

// 整支程式只建立一個讀取介面，並以非同步迭代器逐行取用。
// 若為每個提問各建一個介面，第一個介面會把輸入一次讀完，
// 後續的提問就永遠等不到資料（以管線餵入時必然發生）。
const rl = createInterface({ input: stdin, output: muted, terminal: true });
const lines = rl[Symbol.asyncIterator]();

async function ask(question) {
  muted.hide = false;
  stdout.write(question);
  muted.hide = true;
  const { value, done } = await lines.next();
  stdout.write('\n');
  if (done) {
    console.error('\n❌ 輸入中斷。');
    process.exit(1);
  }
  return value;
}

function bail(message, hint) {
  console.error(`\n❌ ${message}`);
  if (hint) console.error(`   ${hint}`);
  rl.close();
  process.exit(1);
}

const password = await ask('請輸入後台密碼：');
if (password.length < MIN_LENGTH) {
  bail(
    `密碼太短，請至少 ${MIN_LENGTH} 個字元。`,
    '建議用一句好記但別人猜不到的話，例如「貝星油墨1988自主上線」。',
  );
}
const again = await ask('請再輸入一次確認：');
if (password !== again) bail('兩次輸入不一致。');
rl.close();

const salt = crypto.getRandomValues(new Uint8Array(16));
const hash = await hashPassword(password, salt);
const sessionSecret = b64(crypto.getRandomValues(new Uint8Array(32)));

console.log('\n產生完成。請到 Cloudflare 的 Worker 設定中新增以下兩個 Secret：\n');
console.log('  名稱：ADMIN_PASSWORD_HASH');
console.log(`  值　：pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}\n`);
console.log('  名稱：SESSION_SECRET');
console.log(`  值　：${sessionSecret}\n`);
console.log('設定位置：Cloudflare → 你的 Worker → Settings → Variables and Secrets');
console.log('          → Add → 類型選 Secret\n');
console.log('⚠️  這兩個值等同後台鑰匙，只貼到 Cloudflare，不要貼進對話、email 或程式碼。');
