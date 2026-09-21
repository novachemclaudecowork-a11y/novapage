/**
 * 後台前端邏輯。
 *
 * 資料流：
 *   載入   GET  /admin/api/content   一次取回產品、分類、訊息、公司簡介
 *   儲存   PUT  /admin/api/products  （或 news / about）
 *   上傳   POST /admin/api/upload
 *
 * 每次儲存都會在 GitHub 產生一筆 commit，Cloudflare 隨後自動重建網站，
 * 因此按下儲存後約一兩分鐘網站才會更新，這在畫面上會提示使用者。
 *
 * 取回資料時一併拿到每個檔案的 sha，儲存時帶回去。若期間有其他人改過
 * 同一份資料，GitHub 會拒絕寫入，後台會提示重新整理而不是悄悄蓋掉對方的修改。
 */

import { renderBody } from '../lib/richtext.js';

const state = {
  products: [],
  categories: [],
  news: [],
  about: { title: '公司簡介', body: '' },
  sha: {},
  dirty: new Set(),
  editingSlug: null,
  tab: 'products',
  search: '',
};

const $ = (id) => document.getElementById(id);

/* ---------- 共用小工具 ---------- */

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null && value !== false) {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function notify(message, kind = 'ok') {
  const box = $('notice');
  box.className = `note ${kind === 'ok' ? 'ok' : 'warn'}`;
  box.textContent = message;
  box.hidden = false;
  if (kind === 'ok') setTimeout(() => { box.hidden = true; }, 6000);
}

function setStatus(text, kind = '') {
  const node = $('status');
  node.textContent = text;
  node.className = `status ${kind}`;
}

function markDirty(section) {
  state.dirty.add(section);
  setStatus('尚未儲存', 'dirty');
  $('save').disabled = false;
  // 提醒的措辭會因為「有沒有未存的修改」而不同
  updateSessionNotice();
}

function clearDirty() {
  state.dirty.clear();
  setStatus('已儲存，網站約一兩分鐘後更新', 'saved');
  $('save').disabled = true;
}

/** 由中文名稱產生網址代稱的備用值；有英文字母時優先取用 */
function suggestSlug(name) {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return ascii || `item-${Date.now().toString(36)}`;
}

/* ---------- 與伺服器溝通 ---------- */

/** 登入過期。單獨一個型別，呼叫端才能和一般錯誤分開處理。 */
class SessionExpiredError extends Error {
  constructor() {
    super('登入已過期');
    this.name = 'SessionExpiredError';
  }
}

async function api(path, options = {}) {
  const res = await fetch(`/admin/api/${path}`, options);
  if (res.status === 401) {
    // 這裡絕對不能直接導去登入頁：使用者可能已經改了一堆東西還沒存，
    // 一跳轉就全沒了。交給呼叫端決定——存檔時會請使用者就地重新登入，
    // 修改留在記憶體裡，登入完直接重試。
    throw new SessionExpiredError();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `伺服器錯誤（${res.status}）`);
  return data;
}

async function load() {
  setStatus('載入中…');
  const data = await api('content');
  state.products = data.products ?? [];
  state.categories = data.categories ?? [];
  state.news = data.news ?? [];
  state.about = data.about ?? state.about;
  state.sha = data.sha ?? {};
  setStatus('');
  render();
}

async function writeDirtySections() {
  for (const section of [...state.dirty]) {
    const value =
      section === 'products' ? state.products
      : section === 'news' ? state.news
      : section === 'categories' ? state.categories
      : state.about;
    await api(section, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, sha: state.sha[section] }),
    });
    // 寫入後 sha 已改變，重新載入才能繼續編輯，否則下次儲存會被判定為衝突
  }
  const refreshed = await api('content');
  state.sha = refreshed.sha ?? {};
}

async function save() {
  if (!state.dirty.size) return;
  $('save').disabled = true;
  setStatus('儲存中…', 'saving');

  try {
    try {
      await writeDirtySections();
    } catch (err) {
      if (!(err instanceof SessionExpiredError)) throw err;
      // 登入過期。修改還在記憶體裡，請使用者就地重新登入後直接重試，
      // 不要把人丟去登入頁——那等於把剛才做的全部丟掉。
      setStatus('登入已過期', 'dirty');
      await requireLogin();
      setStatus('儲存中…', 'saving');
      await writeDirtySections();
    }
    clearDirty();
    refreshSessionInfo();
    notify('已儲存。網站會自動重新建置，約一兩分鐘後看得到變更。');
  } catch (err) {
    setStatus('儲存失敗', 'dirty');
    $('save').disabled = false;
    notify(err.message, 'warn');
  }
}

async function upload(file, kind, name) {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  if (name) form.append('name', name);
  return api('upload', { method: 'POST', body: form });
}

/* ---------- 登入狀態 ---------- */

/**
 * 登入過期是這個後台最容易讓人白做工的地方：一次編輯可能動到幾十個欄位，
 * 若直到按下儲存才發現過期，而且還被踢回登入頁，那些修改就全沒了。
 *
 * 因此分三層處理：
 *   1. 有在動作就自動續期（後端負責，見 worker/api.js 的 withRenewal）
 *   2. 快到期時先出面提醒，並在過期當下就告知，而不是等到存檔失敗
 *   3. 真的過期時就地重新登入，修改留在記憶體裡，登入完直接接著存
 */
const session = {
  expiresAt: null,
  /** 快到期的提醒門檻 */
  warnBefore: 10 * 60 * 1000,
  timer: null,
};

/** 向伺服器問目前的登入狀態。不透過 api()，以免自己觸發重新登入的流程。 */
async function refreshSessionInfo() {
  try {
    const res = await fetch('/admin/api/me');
    if (res.status === 401) {
      session.expiresAt = 0;
    } else if (res.ok) {
      session.expiresAt = (await res.json()).expiresAt ?? null;
    }
  } catch {
    // 網路不通就先維持原本的判斷，下次再問
  }
  updateSessionNotice();
}

function updateSessionNotice() {
  const box = $('session-notice');
  if (!box) return;
  if (!session.expiresAt) {
    // 0 代表已確認過期；null 代表還不知道（例如用 Cloudflare Access 登入）
    if (session.expiresAt === 0) {
      box.className = 'note warn';
      box.textContent = state.dirty.size
        ? '登入已過期。你的修改都還在，按儲存時會請你重新輸入密碼。'
        : '登入已過期，請重新登入。';
      box.hidden = false;
    } else {
      box.hidden = true;
    }
    return;
  }

  const remaining = session.expiresAt - Date.now();
  if (remaining <= 0) {
    session.expiresAt = 0;
    updateSessionNotice();
    return;
  }
  if (remaining < session.warnBefore) {
    box.className = 'note warn';
    box.textContent =
      `登入將於 ${Math.max(1, Math.round(remaining / 60000))} 分鐘後到期。` +
      '建議先按儲存，存檔會自動延長登入時間。';
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

function watchSession() {
  clearInterval(session.timer);
  // 到期時間是登入時就知道的，平常在本機算就好，不必一直問伺服器
  session.timer = setInterval(updateSessionNotice, 30_000);
  // 分頁重新回到前景時才真的問一次：電腦可能剛從休眠醒來，
  // 也可能在別的分頁登出或續期過
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshSessionInfo();
  });
  refreshSessionInfo();
}

/**
 * 就地重新登入。
 * @returns {Promise<void>} 登入成功才 resolve；使用者取消則 reject
 */
function requireLogin() {
  return new Promise((resolve, reject) => {
    const password = el('input', {
      id: 'relogin-password', type: 'password', autocomplete: 'current-password',
    });
    const error = el('p', { class: 'hint warn-text', hidden: true });
    const submit = el('button', { class: 'btn', type: 'submit' }, '重新登入並繼續儲存');

    const close = () => overlay.remove();

    const form = el('form', {
      class: 'relogin',
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        error.hidden = true;
        try {
          const res = await fetch('/admin/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password.value }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error ?? `登入失敗（${res.status}）`);
          }
          close();
          await refreshSessionInfo();
          resolve();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          submit.disabled = false;
          password.select();
        }
      },
    },
      el('h2', {}, '登入已過期'),
      el('p', { class: 'note' },
        '你剛才的修改都還在，沒有遺失。輸入密碼後會直接接著儲存。'),
      el('div', { class: 'field' },
        el('label', { for: 'relogin-password' }, '密碼'),
        password,
      ),
      error,
      el('div', { class: 'relogin-actions' },
        submit,
        el('button', {
          class: 'btn ghost', type: 'button',
          onclick: () => {
            close();
            reject(new Error('已取消重新登入。修改仍保留在畫面上，可稍後再儲存。'));
          },
        }, '稍後再說'),
      ),
    );

    const overlay = el('div', { class: 'overlay' }, form);
    document.body.append(overlay);
    password.focus();
  });
}

/* ---------- 預覽 ---------- */

/** 把值放進 HTML 屬性或內文前一律逸出 */
function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** 灰字的提示文字，用在還沒填內容的地方 */
const placeholder = (text) => `<p style="color:#9aa3b0">${escapeHtml(text)}</p>`;

/**
 * 包成一份完整的預覽網頁。
 *
 * 前台的 global.css 原封不動內嵌進來（頁面上那個不會執行的
 * <script type="text/css">），所以預覽的字體、間距、顏色就是網站上的樣子。
 * 不能改成引用 /_astro/… 的路徑，那個檔名每次建置都會變。
 */
function previewShell(inner, extraCss = '') {
  const css = document.getElementById('preview-css')?.textContent ?? '';
  return `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8">
<style>${css}</style>
<style>
  body { padding: 20px 24px; }
  /* 預覽不需要橫向捲軸，圖片一律縮到框內 */
  img { max-width: 100%; }
${extraCss}</style>
</head><body>${inner}</body></html>`;
}

/**
 * 建立預覽框。
 *
 * sandbox 為空字串＝最嚴格：不給 allow-scripts 也不給 allow-same-origin，
 * 所以即使內文貼進 <script> 或 onerror 也不會執行、碰不到後台頁面。
 *
 * @param {() => string} buildDoc 每次更新時重新產生整份預覽 HTML
 * @returns {{ frame: HTMLIFrameElement, refresh: () => void }}
 */
function makePreview(buildDoc, modifier = '') {
  const frame = el('iframe', {
    class: `preview-frame${modifier ? ` ${modifier}` : ''}`, sandbox: '', title: '預覽',
    srcdoc: buildDoc(),
  });
  // 每次按鍵都重畫 iframe 會閃，稍微延遲再更新
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { frame.srcdoc = buildDoc(); }, 250);
  };
  return { frame, refresh };
}

/* ---------- 內文格式 ---------- */

/**
 * 內文可以用 HTML 或 Markdown 寫，每一則各自記著自己用的是哪一種
 * （欄位：訊息是 format，產品說明是 spec_format）。
 *
 * 沒有記錄的舊資料一律當成 HTML——舊站匯入的 39 筆產品說明都是 HTML，
 * 若預設成 Markdown，那些 <p>、<table> 會整個走樣。
 *
 * @param {object} owner 要改的物件（一則訊息或一項產品）
 * @param {string} key   存放格式的欄位名稱
 * @param {() => void} onChange 切換後要做的事（通常是重畫預覽）
 */
function formatSwitch(owner, key, onChange) {
  const current = () => (owner[key] === 'markdown' ? 'markdown' : 'html');
  const note = el('span', { class: 'hint' });

  const describe = () => {
    note.textContent = current() === 'markdown'
      ? '用 ## 標題、**粗體**、- 項目。也可以直接混用 HTML 標籤。'
      : '直接寫網頁標籤，例如 <p>文字</p>、<strong>粗體</strong>。';
  };
  describe();

  const option = (value, label) =>
    el('button', {
      type: 'button',
      class: `seg${current() === value ? ' on' : ''}`,
      'aria-pressed': current() === value ? 'true' : 'false',
      onclick: () => {
        if (current() === value) return;
        owner[key] = value;
        // 兩種格式的內容不互相轉換，原文原封不動留著。
        // Markdown 允許直接寫 HTML，所以 HTML → Markdown 不會壞；
        // 反過來 Markdown 語法就不再生效，右邊的預覽會立刻顯示差別。
        markDirty(key === 'format' ? 'news' : 'products');
        for (const btn of group.querySelectorAll('.seg')) {
          const on = btn.dataset.value === value;
          btn.classList.toggle('on', on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        describe();
        onChange();
      },
      dataset: { value },
    }, label);

  const group = el('div', { class: 'format-switch', role: 'group', 'aria-label': '內文格式' },
    option('html', 'HTML'),
    option('markdown', 'Markdown'),
    note,
  );
  return group;
}

/** 最新訊息在網站上的樣子 */
function newsPreviewDoc(post) {
  const body = renderBody(post.body, post.format);
  return previewShell(`<article class="news-post">
<h1>${escapeHtml(post.title) || '<span style="color:#9aa3b0">（尚未填標題）</span>'}</h1>
<time datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time>
<div>${body || placeholder('（尚未填內容）')}</div>
</article>`);
}

/** 產品說明在產品頁上的樣子。標題與說明的排版比照 src/pages/products/[slug].astro */
function productPreviewDoc(product) {
  const specHtml = renderBody(product.spec_html, product.spec_format);
  const spec = specHtml
    ? `<div class="spec"><h2 style="margin-top:1.5rem">產品說明</h2>${specHtml}</div>`
    : '<div class="spec"><p class="notice warn">此產品尚無說明資料，歡迎來電洽詢。</p></div>';
  // 產品頁只會用第一張照片；沒有照片時是一塊「尚無產品照」的灰底
  const photo = product.images[0]
    ? `<img src="${escapeHtml(product.images[0])}" alt="" width="420" height="315">`
    : '<div class="placeholder">尚無產品照</div>';
  return previewShell(`<article class="product">
<div class="product-photo">${photo}</div>
<div>
<h1>${escapeHtml(product.name) || '<span style="color:#9aa3b0">（尚未填名稱）</span>'}</h1>
<dl class="product-meta">${
    product.code ? `<dt>產品編號</dt><dd>${escapeHtml(product.code)}</dd>` : ''
  }</dl>
${spec}
</div>
</article>`,
  // 預覽框比實際的產品頁窄很多，照片若照原尺寸會把說明整個擠到看不見。
  // 這裡只縮照片，文字的字級與間距維持和網站一致。
  `  .product-photo { max-width: 220px; }
  .product-photo img { max-height: 140px; width: auto; margin: 0 auto; }
`);
}

/* ---------- 產品 ---------- */

function categoryName(slug) {
  return state.categories.find((c) => c.slug === slug)?.name ?? slug ?? '（未分類）';
}

function renderProductList() {
  const keyword = state.search.trim().toLowerCase();
  const rows = state.products
    .filter((p) => {
      if (!keyword) return true;
      return [p.name, p.code, p.slug].some((v) => (v ?? '').toLowerCase().includes(keyword));
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hant'));

  const tbody = el('tbody');
  for (const product of rows) {
    tbody.append(
      el('tr', {},
        el('td', { class: 'num' },
          el('input', {
            type: 'number', value: product.order, 'aria-label': `${product.name} 的排序`,
            onchange: (e) => {
              product.order = Number(e.target.value) || 0;
              markDirty('products');
            },
          }),
        ),
        el('td', { class: 'name' }, product.name),
        el('td', {}, product.code || '—'),
        el('td', {}, categoryName(product.category)),
        el('td', {},
          el('button', {
            class: `pill ${product.published ? 'on' : 'off'}`,
            type: 'button',
            title: product.published ? '點擊下架' : '點擊上架',
            onclick: () => {
              product.published = !product.published;
              markDirty('products');
              // 必須呼叫 render() 把新表格掛回畫面；
              // renderProductList() 只是產生節點，單獨呼叫不會更新畫面
              render();
            },
          }, product.published ? '已上架' : '已下架'),
        ),
        el('td', { class: 'actions' },
          el('button', {
            class: 'btn ghost small', type: 'button',
            onclick: () => { state.editingSlug = product.slug; render(); },
          }, '編輯'),
        ),
      ),
    );
  }

  const table = el('table', {},
    el('thead', {},
      el('tr', {},
        el('th', {}, '排序'), el('th', {}, '名稱'), el('th', {}, '編號'),
        el('th', {}, '分類'), el('th', {}, '狀態'), el('th', {}),
      ),
    ),
    tbody,
  );

  return rows.length
    ? table
    : el('p', { class: 'empty' }, keyword ? '找不到符合的產品。' : '目前沒有產品。');
}

function renderProductEditor(product) {
  const category = state.categories.find((c) => c.slug === product.category);

  const field = (label, control, hint) =>
    el('div', { class: 'field' },
      el('label', { for: control.id }, label),
      control,
      hint ? el('p', { class: 'hint' }, hint) : null,
    );

  const nameInput = el('input', {
    id: 'f-name', type: 'text', value: product.name,
    oninput: (e) => { product.name = e.target.value; markDirty('products'); },
  });
  const codeInput = el('input', {
    id: 'f-code', type: 'text', value: product.code ?? '',
    oninput: (e) => { product.code = e.target.value; markDirty('products'); },
  });
  const slugInput = el('input', {
    id: 'f-slug', type: 'text', value: product.slug,
    oninput: (e) => { product.slug = e.target.value.trim(); markDirty('products'); },
  });

  const subSelect = el('select', {
    id: 'f-sub',
    onchange: (e) => { product.subcategory = e.target.value || null; markDirty('products'); },
  });
  const fillSubs = () => {
    subSelect.replaceChildren(el('option', { value: '' }, '（不指定）'));
    const current = state.categories.find((c) => c.slug === product.category);
    for (const sub of current?.children ?? []) {
      subSelect.append(
        el('option', { value: sub.slug, selected: sub.slug === product.subcategory }, sub.name),
      );
    }
  };

  const catSelect = el('select', {
    id: 'f-cat',
    onchange: (e) => {
      product.category = e.target.value;
      product.subcategory = null;
      markDirty('products');
      fillSubs();
    },
  }, state.categories.map((c) =>
    el('option', { value: c.slug, selected: c.slug === product.category }, c.name),
  ));
  fillSubs();

  const specInput = el('textarea', {
    id: 'f-spec',
    oninput: (e) => { product.spec_html = e.target.value; markDirty('products'); },
  }, product.spec_html ?? '');

  // 產品說明同樣是 HTML，同樣看不出效果，所以比照最新訊息並排一個預覽。
  // refresh 掛在整張表單上，名稱與產品編號改動也會跟著重畫。
  const specPreview = makePreview(() => productPreviewDoc(product), 'tall');

  /* 照片 */
  const thumbs = el('div', { class: 'thumbs' });
  const renderThumbs = () => {
    const move = (from, to) => {
      if (to < 0 || to >= product.images.length) return;
      const [img] = product.images.splice(from, 1);
      product.images.splice(to, 0, img);
      markDirty('products');
      renderThumbs();
      specPreview.refresh();
    };

    // replaceChildren 不會忽略 null，直接傳進去會在畫面上印出字串 "null"，
    // 所以空狀態要另外判斷，不能沿用 el() 那種寫法
    if (!product.images.length) {
      thumbs.replaceChildren(el('p', { class: 'hint' }, '尚未加入照片'));
      return;
    }

    thumbs.replaceChildren(
      ...product.images.map((src, index) =>
        el('div', { class: 'thumb' },
          // 另開分頁看原圖，縮圖看不清楚的時候用得上
          el('a', { href: src, target: '_blank', rel: 'noopener', title: '另開分頁看原圖' },
            el('img', { src, alt: '' }),
          ),
          el('button', {
            class: 'thumb-remove',
            type: 'button', title: '移除這張照片', 'aria-label': '移除這張照片',
            onclick: () => {
              product.images.splice(index, 1);
              markDirty('products');
              renderThumbs();
              specPreview.refresh();
            },
          }, '×'),
          // 產品頁只會用第一張當主圖，所以順序是有意義的，要讓使用者看得出來
          index === 0 ? el('span', { class: 'thumb-main' }, '主圖') : null,
          el('span', { class: 'thumb-name', title: src }, src.split('/').pop()),
          el('div', { class: 'thumb-move' },
            el('button', {
              type: 'button', title: '往前移', 'aria-label': `${src} 往前移`,
              disabled: index === 0,
              onclick: () => move(index, index - 1),
            }, '←'),
            el('button', {
              type: 'button', title: '往後移', 'aria-label': `${src} 往後移`,
              disabled: index === product.images.length - 1,
              onclick: () => move(index, index + 1),
            }, '→'),
          ),
        ),
      ),
    );
  };
  renderThumbs();

  const imageInput = el('input', {
    id: 'f-image', type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif',
    multiple: true,
    onchange: async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      for (const file of files) {
        try {
          notify(`上傳「${file.name}」中…`);
          const result = await upload(file, 'image', product.slug);
          product.images.push(result.path);
          markDirty('products');
          renderThumbs();
          specPreview.refresh();
          notify(`已加入「${file.name}」，記得按右上角儲存。`);
        } catch (err) {
          notify(`上傳失敗：${err.message}`, 'warn');
        }
      }
    },
  });

  /* 文件（SDS、說明書） */
  const docList = el('ul', { class: 'docs' });
  const renderDocs = () => {
    docList.replaceChildren(
      ...(product.documents ?? []).map((doc, index) =>
        el('li', {},
          el('input', {
            type: 'text', class: 'label', value: doc.label,
            'aria-label': '文件名稱',
            oninput: (e) => { doc.label = e.target.value; markDirty('products'); },
          }),
          el('a', { href: doc.file, target: '_blank', rel: 'noopener' }, '檢視'),
          el('button', {
            class: 'btn danger small', type: 'button',
            onclick: () => {
              product.documents.splice(index, 1);
              markDirty('products');
              renderDocs();
            },
          }, '移除'),
        ),
      ),
      (product.documents ?? []).length ? null : el('p', { class: 'hint' }, '尚未上傳文件'),
    );
  };
  renderDocs();

  const docInput = el('input', {
    id: 'f-doc', type: 'file', accept: 'application/pdf', multiple: true,
    onchange: async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      for (const file of files) {
        try {
          notify(`上傳「${file.name}」中…`);
          const result = await upload(file, 'document', `${product.slug}-${file.name}`);
          product.documents = product.documents ?? [];
          product.documents.push({
            label: file.name.replace(/\.pdf$/i, ''),
            file: result.path,
          });
          markDirty('products');
          renderDocs();
          notify(`已加入「${file.name}」，記得按右上角儲存。`);
        } catch (err) {
          notify(`上傳失敗：${err.message}`, 'warn');
        }
      }
    },
  });

  return el('div', { class: 'panel', oninput: specPreview.refresh },
    el('h2', {}, `編輯產品：${product.name || '（未命名）'}`),
    el('div', { class: 'grid2' },
      field('產品名稱', nameInput),
      field('產品編號', codeInput),
      field('主分類', catSelect),
      field('產品線', subSelect, '選「不指定」時，產品只會出現在主分類底下'),
      field('網址代稱', slugInput,
        `網址會是 /products/${product.slug || '…'}/。只能用小寫英文、數字與連字號。` +
        '已上線的產品請避免更動，否則既有連結會失效。'),
      el('div', { class: 'field check' },
        el('input', {
          id: 'f-pub', type: 'checkbox', checked: product.published,
          onchange: (e) => { product.published = e.target.checked; markDirty('products'); },
        }),
        el('label', { for: 'f-pub' }, '在網站上顯示'),
      ),
    ),
    el('div', { class: 'edit-with-preview' },
      el('div', { class: 'field' },
        el('label', { for: 'f-spec' }, '產品說明'),
        formatSwitch(product, 'spec_format', specPreview.refresh),
        specInput,
      ),
      el('div', { class: 'field' },
        el('label', {}, '預覽（產品頁上的樣子）'),
        specPreview.frame,
        el('p', { class: 'hint' }, '邊打字邊更新，不必儲存。'),
      ),
    ),
    el('div', { class: 'field', style: 'margin-top:18px' },
      el('label', { for: 'f-image' }, '產品照片'),
      thumbs,
      el('div', { style: 'margin-top:10px' }, imageInput),
      el('p', { class: 'hint' }, '支援 JPG、PNG、WebP、GIF，單張上限 8 MB。'),
    ),
    el('div', { class: 'field', style: 'margin-top:18px' },
      el('label', { for: 'f-doc' }, '安全資料表與說明書'),
      docList,
      docInput,
      el('p', { class: 'hint' }, '只接受 PDF，單份上限 25 MB。上傳後會出現在產品頁供客戶下載。'),
    ),
    el('div', { style: 'margin-top:22px; display:flex; gap:10px; flex-wrap:wrap' },
      el('button', {
        class: 'btn', type: 'button',
        onclick: () => { state.editingSlug = null; render(); },
      }, '完成編輯'),
      el('button', {
        class: 'btn danger', type: 'button',
        onclick: () => {
          if (!confirm(`確定要刪除「${product.name}」嗎？\n\n刪除後這個產品頁會消失。\n若只是暫時不賣，建議改用「下架」而不是刪除。`)) return;
          state.products = state.products.filter((p) => p !== product);
          state.editingSlug = null;
          markDirty('products');
          render();
        },
      }, '刪除這項產品'),
    ),
  );
}

function renderProductsTab(root) {
  const editing = state.products.find((p) => p.slug === state.editingSlug);
  if (editing) {
    root.append(renderProductEditor(editing));
    return;
  }

  root.append(
    el('div', { class: 'toolbar' },
      el('input', {
        type: 'search', placeholder: '搜尋產品名稱或編號…', value: state.search,
        'aria-label': '搜尋產品',
        oninput: (e) => { state.search = e.target.value; render(); },
      }),
      el('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          const name = prompt('新產品的名稱：');
          if (!name) return;
          const product = {
            slug: suggestSlug(name),
            name,
            code: '',
            category: state.categories[0]?.slug ?? '',
            subcategory: null,
            published: false,
            order: (Math.max(0, ...state.products.map((p) => p.order)) + 10),
            images: [],
            documents: [],
            spec_html: '',
          };
          state.products.push(product);
          state.editingSlug = product.slug;
          markDirty('products');
          render();
        },
      }, '＋ 新增產品'),
    ),
    el('p', { class: 'hint', style: 'margin:0 0 12px; color:var(--muted); font-size:.8125rem' },
      `共 ${state.products.length} 項產品，其中 ${state.products.filter((p) => p.published).length} 項已上架。` +
      '排序數字越小越前面。'),
    renderProductList(),
  );
}

/* ---------- 分類 ---------- */

/** 某個產品線底下有幾項已上架的產品 */
function publishedCountIn(subSlug) {
  return state.products.filter((p) => p.published && p.subcategory === subSlug).length;
}

function renderCategoriesTab(root) {
  const rerender = () => { root.replaceChildren(); renderCategoriesTab(root); };

  root.append(
    el('p', { class: 'note' },
      '這裡控制左側選單上顯示哪些分類與產品線。',
      el('br'),
      '「隱藏」的項目不會出現在網站選單上，但產品本身若仍上架，' +
      '產品頁與舊連結都還是正常的。'),
  );

  const sorted = [...state.categories].sort((a, b) => a.order - b.order);

  for (const cat of sorted) {
    const subs = el('ul', { class: 'cat-subs' });

    for (const sub of [...(cat.children ?? [])].sort((a, b) => a.order - b.order)) {
      const count = publishedCountIn(sub.slug);
      const hidden = sub.published === false;

      // 依「有沒有產品」與「有沒有隱藏」給出實際會發生什麼的說明，
      // 讓使用者不必自己推敲兩個開關的交互作用
      let note = '';
      let warn = false;
      if (hidden) {
        note = '已隱藏：不會出現在選單上';
        if (count > 0) {
          note += `（底下 ${count} 項產品仍在網站上，可從主分類找到）`;
        }
      } else if (count === 0) {
        note = '選單上會顯示為灰色，點進去是「尚未上架內容，請來電洽詢」。' +
               '若此品項已停售，建議改為隱藏。';
        warn = true;
      }

      subs.append(
        el('li', {
          class: hidden ? 'hidden-line' : undefined,
          dataset: { slug: sub.slug },
        },
          el('input', {
            type: 'number', class: 'cat-order', value: sub.order,
            'aria-label': `${sub.name} 的排序`,
            onchange: (e) => { sub.order = Number(e.target.value) || 0; markDirty('categories'); },
          }),
          el('input', {
            type: 'text', value: sub.name, 'aria-label': '產品線名稱',
            oninput: (e) => { sub.name = e.target.value; markDirty('categories'); },
          }),
          el('span', { class: 'cat-count' }, count ? `${count} 項產品` : '無產品'),
          el('button', {
            class: `pill ${hidden ? 'off' : 'on'}`, type: 'button',
            title: hidden ? '點擊改為顯示' : '點擊改為隱藏',
            onclick: () => {
              sub.published = hidden;
              markDirty('categories');
              rerender();
            },
          }, hidden ? '已隱藏' : '顯示中'),
          note ? el('span', { class: `cat-note${warn ? ' warn' : ''}` }, note) : null,
        ),
      );
    }

    root.append(
      el('div', { class: 'cat-group', dataset: { slug: cat.slug } },
        el('div', { class: 'cat-main' },
          el('input', {
            type: 'number', class: 'cat-order', value: cat.order,
            'aria-label': `${cat.name} 的排序`,
            onchange: (e) => { cat.order = Number(e.target.value) || 0; markDirty('categories'); },
          }),
          el('input', {
            type: 'text', value: cat.name, 'aria-label': '分類名稱',
            oninput: (e) => { cat.name = e.target.value; markDirty('categories'); },
          }),
          el('span', { class: 'cat-count' },
            `${state.products.filter((p) => p.published && p.category === cat.slug).length} 項產品`),
          el('button', {
            class: `pill ${cat.published === false ? 'off' : 'on'}`, type: 'button',
            title: cat.published === false ? '點擊改為顯示' : '點擊改為隱藏',
            onclick: () => {
              cat.published = cat.published === false;
              markDirty('categories');
              rerender();
            },
          }, cat.published === false ? '已隱藏' : '顯示中'),
        ),
        subs,
      ),
    );
  }
}

/* ---------- 最新訊息 ---------- */

function renderNewsTab(root) {
  const list = el('div');
  const rerender = () => { root.replaceChildren(); renderNewsTab(root); };

  root.append(
    el('div', { class: 'toolbar' },
      el('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          state.news.unshift({
            slug: `post-${Date.now().toString(36)}`,
            title: '',
            date: new Date().toISOString().slice(0, 10),
            body: '',
            published: false,
          });
          markDirty('news');
          rerender();
        },
      }, '＋ 發布新訊息'),
    ),
  );

  if (!state.news.length) {
    root.append(el('p', { class: 'empty' }, '目前沒有訊息。'));
    return;
  }

  for (const [index, post] of state.news.entries()) {
    // refresh 掛在整個面板上，標題與日期改動也會跟著重畫
    const { frame, refresh } = makePreview(() => newsPreviewDoc(post));

    list.append(
      el('div', {
        class: `panel${post.published ? '' : ' draft'}`,
        dataset: { slug: post.slug },
        oninput: refresh,
      },
        // 發布狀態放在最上面。先前只有面板底部一個不起眼的勾選框，
        // 結果是寫完按了儲存、網站上卻什麼也沒出現。
        el('div', { class: 'news-head' },
          el('button', {
            class: `pill ${post.published ? 'on' : 'off'}`, type: 'button',
            title: post.published ? '點擊改為草稿' : '點擊發布到網站上',
            onclick: () => {
              post.published = !post.published;
              markDirty('news');
              rerender();
            },
          }, post.published ? '已發布' : '草稿'),
          el('span', { class: 'news-head-note' },
            post.published
              ? '儲存後一到兩分鐘會出現在網站上。'
              : '目前只存在後台，網站上看不到。按左邊的「草稿」即可發布。'),
          post.published
            ? el('a', {
                class: 'news-head-link', href: `/news/${post.slug}/`, target: '_blank',
                rel: 'noopener',
              }, '在網站上查看 ↗')
            : null,
        ),
        el('div', { class: 'grid2' },
          el('div', { class: 'field' },
            el('label', { for: `n-title-${index}` }, '標題'),
            el('input', {
              id: `n-title-${index}`, type: 'text', value: post.title,
              oninput: (e) => { post.title = e.target.value; markDirty('news'); },
            }),
          ),
          el('div', { class: 'field' },
            el('label', { for: `n-date-${index}` }, '日期'),
            el('input', {
              id: `n-date-${index}`, type: 'text', value: post.date,
              placeholder: '2026-09-20',
              oninput: (e) => { post.date = e.target.value; markDirty('news'); },
            }),
          ),
        ),
        el('div', { class: 'edit-with-preview' },
          el('div', { class: 'field' },
            el('label', { for: `n-body-${index}` }, '內容'),
            formatSwitch(post, 'format', refresh),
            el('textarea', {
              id: `n-body-${index}`,
              oninput: (e) => { post.body = e.target.value; markDirty('news'); },
            }, post.body ?? ''),
          ),
          el('div', { class: 'field' },
            el('label', {}, '預覽（網站上的樣子）'),
            frame,
            el('p', { class: 'hint' }, '邊打字邊更新，不必儲存。'),
          ),
        ),
        el('div', { style: 'margin-top:16px; display:flex; gap:10px; align-items:center' },
          el('button', {
            class: 'btn danger small', type: 'button',
            onclick: () => {
              if (!confirm(`確定要刪除訊息「${post.title || '（未命名）'}」嗎？`)) return;
              state.news.splice(index, 1);
              markDirty('news');
              rerender();
            },
          }, '刪除'),
        ),
      ),
    );
  }
  root.append(list);
}

/* ---------- 公司簡介 ---------- */

function renderAboutTab(root) {
  root.append(
    el('div', { class: 'panel' },
      el('div', { class: 'field' },
        el('label', { for: 'a-body' }, '公司簡介內容'),
        el('textarea', {
          id: 'a-body', style: 'min-height:20rem',
          oninput: (e) => { state.about.body = e.target.value; markDirty('about'); },
        }, state.about.body ?? ''),
        el('p', { class: 'hint' }, '一行一段，空白行會被忽略。'),
      ),
    ),
  );
}

/* ---------- 版面 ---------- */

function render() {
  for (const button of document.querySelectorAll('.tabs button')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
  }
  const root = $('content');
  root.replaceChildren();
  if (state.tab === 'products') renderProductsTab(root);
  else if (state.tab === 'categories') renderCategoriesTab(root);
  else if (state.tab === 'news') renderNewsTab(root);
  else renderAboutTab(root);
}

/* ---------- 啟動 ---------- */

for (const button of document.querySelectorAll('.tabs button')) {
  button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    state.editingSlug = null;
    render();
  });
}

$('save').addEventListener('click', save);
$('logout').addEventListener('click', async () => {
  if (state.dirty.size && !confirm('還有未儲存的修改，確定要登出嗎？')) return;
  await fetch('/admin/api/logout', { method: 'POST' });
  window.location.href = '/admin/login/';
});

// 離開前提醒尚未儲存的修改
window.addEventListener('beforeunload', (event) => {
  if (!state.dirty.size) return;
  event.preventDefault();
  event.returnValue = '';
});

load()
  .then(watchSession)
  .catch((err) => {
    setStatus('');
    // 一進來就過期的話畫面上還沒有東西可以保護，直接請他重新登入即可
    if (err instanceof SessionExpiredError) {
      window.location.href = '/admin/login/';
      return;
    }
    notify(`載入失敗：${err.message}`, 'warn');
  });
