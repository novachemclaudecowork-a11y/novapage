/**
 * 透過 GitHub API 讀寫 content/ 底下的檔案。
 *
 * 後台的每一次儲存都會變成 repo 裡的一筆 commit，Cloudflare 隨後自動重建網站。
 * 好處是內容有完整修改歷史、可回溯、可還原，而且不需要另外維護資料庫。
 *
 * 需要的環境變數：
 *   GITHUB_TOKEN   具備該 repo 內容寫入權限的權杖（存為 Worker secret）
 *   GITHUB_REPO    owner/repo
 *   GITHUB_BRANCH  要寫入的分支
 */
const API = 'https://api.github.com';

function encodeBase64(bytes) {
  let binary = '';
  const chunk = 0x8000; // 分段處理，避免一次展開過大的陣列
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeBase64(text) {
  const binary = atob(text.replace(/\n/g, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export class GitHubContent {
  constructor(env) {
    this.token = env.GITHUB_TOKEN;
    this.repo = env.GITHUB_REPO;
    this.branch = env.GITHUB_BRANCH || 'main';
    if (!this.token || !this.repo) {
      throw new Error('後台尚未設定 GITHUB_TOKEN 或 GITHUB_REPO');
    }
  }

  async request(path, init = {}) {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'novapage-admin',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`GitHub API ${res.status}：${detail.slice(0, 300)}`);
    }
    return res.status === 204 ? true : res.json();
  }

  contentsUrl(path) {
    return `/repos/${this.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** 讀取單一檔案，回傳 { text, bytes, sha }；檔案不存在回傳 null */
  async getFile(path) {
    const data = await this.request(`${this.contentsUrl(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (!data || Array.isArray(data)) return null;
    const bytes = data.content ? decodeBase64(data.content) : new Uint8Array();
    return { bytes, text: new TextDecoder().decode(bytes), sha: data.sha };
  }

  /** 列出目錄內容，回傳 [{ name, path, sha, size }] */
  async listDir(path) {
    const data = await this.request(`${this.contentsUrl(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (!Array.isArray(data)) return [];
    return data.map((f) => ({ name: f.name, path: f.path, sha: f.sha, size: f.size, type: f.type }));
  }

  /**
   * 寫入檔案。
   * 未傳 sha 時會自行查詢既有檔案的 sha；GitHub 以此偵測衝突，
   * 若期間有人改過同一個檔案，寫入會被拒絕而不是悄悄覆蓋。
   */
  async putFile(path, bytes, message, { sha, author } = {}) {
    let currentSha = sha;
    if (currentSha === undefined) {
      const existing = await this.getFile(path);
      currentSha = existing?.sha;
    }
    const body = {
      message,
      content: encodeBase64(bytes),
      branch: this.branch,
      ...(currentSha ? { sha: currentSha } : {}),
      ...(author ? { committer: author, author } : {}),
    };
    return this.request(this.contentsUrl(path), { method: 'PUT', body: JSON.stringify(body) });
  }

  async putJson(path, value, message, options) {
    const text = JSON.stringify(value, null, 2) + '\n';
    return this.putFile(path, new TextEncoder().encode(text), message, options);
  }

  async deleteFile(path, message, { sha, author } = {}) {
    let currentSha = sha;
    if (!currentSha) {
      const existing = await this.getFile(path);
      if (!existing) return null;
      currentSha = existing.sha;
    }
    return this.request(this.contentsUrl(path), {
      method: 'DELETE',
      body: JSON.stringify({
        message,
        sha: currentSha,
        branch: this.branch,
        ...(author ? { committer: author, author } : {}),
      }),
    });
  }
}
