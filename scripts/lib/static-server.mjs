/**
 * 測試用的靜態檔案伺服器。
 *
 * 瀏覽器測試需要一個真的在跑的網站。原本得先手動開 `astro preview`，
 * 忘了開就只會看到 ERR_CONNECTION_REFUSED，看不出是漏了哪一步；
 * 而 astro preview 是常駐程序，測試結束後不好收乾淨。
 * 這裡直接把 dist/ 端出去，用完就關，測試本身就是完整的。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** 依序試幾個可能的檔案位置，比照 Astro 產出的目錄結構 */
async function resolveFile(root, urlPath) {
  // normalize 之後再去掉開頭的 ../，避免用 %2e%2e 之類的寫法跳出 dist/
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const candidates = clean.endsWith('/')
    ? [join(root, clean, 'index.html')]
    : [join(root, clean), join(root, `${clean}.html`), join(root, clean, 'index.html')];

  for (const file of candidates) {
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      // 試下一個
    }
  }
  return null;
}

/**
 * 啟動伺服器。
 * @returns {Promise<{ base: string, stop: () => Promise<void> }>}
 */
export async function startStaticServer(root = 'dist', port = 0) {
  const server = createServer(async (req, res) => {
    const urlPath = new URL(req.url, 'http://127.0.0.1').pathname;
    const file = await resolveFile(root, urlPath);
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404');
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
