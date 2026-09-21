/**
 * 後台 API。
 *
 * 支援兩種登入方式，擇一即可：
 *   1. 密碼登入（worker/auth.js）—— 不需任何前置設定，隨處可用
 *   2. Cloudflare Access（worker/access.js）—— 日後搬到自有網域後可改用
 * 兩者皆未通過時一律回 401，不會有「設定沒做好就放行」的情況。
 *
 * 所有寫入都會變成 GitHub 上的一筆 commit，commit 訊息會記錄操作者的
 * Email，因此誰在什麼時候改了什麼，在 repo 的歷史裡查得到。
 */
import { verifyAccessJwt } from './access.js';
import {
  clientIdOf,
  createSession,
  isRateLimited,
  readSessionCookie,
  sessionCookieHeader,
  sessionExpiry,
  shouldRenewSession,
  verifyPassword,
} from './auth.js';
import { GitHubContent } from './github.js';

const PATHS = {
  products: 'content/products.json',
  categories: 'content/categories.json',
  news: 'content/news.json',
  about: 'content/about.json',
};

// 上傳檔案的允許類型與大小上限
const UPLOAD_KINDS = {
  image: {
    dir: 'public/images/products',
    maxBytes: 8 * 1024 * 1024,
    types: {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    },
  },
  document: {
    dir: 'public/documents',
    maxBytes: 25 * 1024 * 1024,
    types: {
      'application/pdf': 'pdf',
    },
  },
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const fail = (message, status = 400) => json({ error: message }, status);

/** 檔名只保留安全字元，避免路徑穿越或奇怪的檔名 */
function safeName(name) {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9一-鿿-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function validateProducts(products) {
  if (!Array.isArray(products)) throw new Error('產品資料必須是陣列');
  const seen = new Set();
  for (const p of products) {
    if (!p || typeof p !== 'object') throw new Error('產品資料格式不正確');
    if (!SLUG_RE.test(p.slug ?? '')) {
      throw new Error(`產品代稱「${p.slug}」不合法，只能使用小寫英文、數字與連字號`);
    }
    if (seen.has(p.slug)) throw new Error(`產品代稱重複：${p.slug}`);
    seen.add(p.slug);
    if (!p.name || typeof p.name !== 'string') throw new Error(`產品「${p.slug}」缺少名稱`);
    if (typeof p.published !== 'boolean') throw new Error(`產品「${p.slug}」缺少上下架狀態`);
    // legacy 欄位是舊網址轉址的依據，不能被後台弄丟
    if (p.legacy && (typeof p.legacy.m !== 'string' || typeof p.legacy.pg !== 'number')) {
      throw new Error(`產品「${p.slug}」的轉址對照欄位格式不正確`);
    }
  }
}

async function handleUpload(request, gh, user) {
  const form = await request.formData();
  const file = form.get('file');
  const kind = String(form.get('kind') ?? 'image');
  const spec = UPLOAD_KINDS[kind];
  if (!spec) return fail('不支援的上傳類型');
  if (!file || typeof file === 'string') return fail('沒有收到檔案');

  const ext = spec.types[file.type];
  if (!ext) {
    return fail(`不支援的檔案格式（${file.type || '未知'}），允許：${Object.keys(spec.types).join('、')}`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > spec.maxBytes) {
    return fail(`檔案過大，上限為 ${Math.round(spec.maxBytes / 1024 / 1024)} MB`);
  }

  const base = safeName(String(form.get('name') || file.name || kind)) || kind;
  // 加上時間戳避免覆蓋既有檔案，也讓舊檔仍可被既有頁面引用
  const filename = `${base}-${Date.now().toString(36)}.${ext}`;
  const repoPath = `${spec.dir}/${filename}`;

  await gh.putFile(repoPath, bytes, `後台上傳 ${filename}（${user.email}）`, {
    sha: undefined,
    author: { name: user.email.split('@')[0] || 'admin', email: user.email },
  });

  // 回傳網站上的公開路徑（public/ 會被當成網站根目錄）
  return json({ path: repoPath.replace(/^public/, ''), name: filename });
}

async function readJsonFile(gh, path, fallback) {
  const file = await gh.getFile(path);
  if (!file) return { value: fallback, sha: undefined };
  return { value: JSON.parse(file.text), sha: file.sha };
}

/**
 * 判斷請求是否已登入。
 * 先試 Cloudflare Access，再試密碼登入的通行證；都不通過回傳 null。
 */
export async function authenticate(request, env) {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    try {
      return await verifyAccessJwt(request, env);
    } catch {
      // Access 未通過時繼續嘗試密碼登入，兩種方式可並存
    }
  }
  const expiresAt = await sessionExpiry(readSessionCookie(request), env);
  if (expiresAt) {
    return { email: '後台管理者', via: 'password', expiresAt };
  }
  return null;
}

export async function handleAdminApi(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/admin\/api\/?/, '').replace(/\/$/, '');

  // 登入端點本身不能要求已登入
  if (route === 'login') {
    if (request.method !== 'POST') return fail('請以 POST 登入', 405);
    const clientId = clientIdOf(request);
    if (isRateLimited(clientId)) {
      return fail('嘗試次數過多，請稍後再試', 429);
    }
    let password = '';
    try {
      password = (await request.json()).password ?? '';
    } catch {
      return fail('請求格式不正確');
    }
    try {
      if (!(await verifyPassword(password, env, clientId))) {
        return fail('密碼不正確', 401);
      }
    } catch (err) {
      return fail(err.message, 500);
    }
    const token = await createSession(env);
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': sessionCookieHeader(token),
      },
    });
  }

  if (route === 'logout') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': sessionCookieHeader(null),
      },
    });
  }

  const user = await authenticate(request, env);
  if (!user) return fail('尚未登入', 401);

  /**
   * 過了效期一半就換一張新的通行證，讓持續在編輯的人不會做到一半被登出。
   * me 不在此列——它是前端定時探詢用的，若連它也續期，
   * 一個沒人在用、只是開著的分頁就能讓登入永遠不過期。
   */
  const withRenewal = async (response) => {
    if (route === 'me' || user.via !== 'password') return response;
    if (!shouldRenewSession(user.expiresAt)) return response;
    const renewed = new Response(response.body, response);
    renewed.headers.append('Set-Cookie', sessionCookieHeader(await createSession(env)));
    return renewed;
  };

  if (route === 'me') {
    // 回傳到期時間，前端才能在還沒過期前就先提醒，而不是等存檔失敗才說
    return json({ email: user.email, expiresAt: user.expiresAt ?? null });
  }

  let gh;
  try {
    gh = new GitHubContent(env);
  } catch (err) {
    return fail(err.message, 500);
  }

  const author = { name: user.email.split('@')[0] || 'admin', email: user.email };

  try {
    // 一次取回後台需要的所有資料，減少往返
    if (route === 'content' && request.method === 'GET') {
      const [products, categories, news, about] = await Promise.all([
        readJsonFile(gh, PATHS.products, []),
        readJsonFile(gh, PATHS.categories, []),
        readJsonFile(gh, PATHS.news, []),
        readJsonFile(gh, PATHS.about, { title: '公司簡介', body: '' }),
      ]);
      return withRenewal(json({
        products: products.value,
        categories: categories.value,
        news: news.value,
        about: about.value,
        sha: {
          products: products.sha,
          categories: categories.sha,
          news: news.sha,
          about: about.sha,
        },
      }));
    }

    if (route === 'upload' && request.method === 'POST') {
      return withRenewal(await handleUpload(request, gh, user));
    }

    if (request.method === 'PUT' && PATHS[route]) {
      const body = await request.json();
      if (route === 'products') validateProducts(body.value);

      // sha 用來偵測衝突：若期間有人改過同一個檔案，GitHub 會拒絕寫入，
      // 而不是把對方的修改悄悄蓋掉
      await gh.putJson(PATHS[route], body.value, body.message || `後台更新 ${route}（${user.email}）`, {
        sha: body.sha,
        author,
      });
      return withRenewal(json({ ok: true }));
    }

    return fail('找不到這個端點', 404);
  } catch (err) {
    const message = err.message ?? String(err);
    // GitHub 在 sha 不符時回 409，代表有人同時改了同一份資料
    if (message.includes('409')) {
      return fail('資料已被其他人修改，請重新整理後再儲存', 409);
    }
    return fail(message, 500);
  }
}
