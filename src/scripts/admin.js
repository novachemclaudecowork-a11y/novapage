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

async function api(path, options = {}) {
  const res = await fetch(`/admin/api/${path}`, options);
  if (res.status === 401) {
    window.location.href = '/admin/login/';
    throw new Error('登入已失效');
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

async function save() {
  if (!state.dirty.size) return;
  $('save').disabled = true;
  setStatus('儲存中…', 'saving');

  try {
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
    clearDirty();
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

  /* 照片 */
  const thumbs = el('div', { class: 'thumbs' });
  const renderThumbs = () => {
    thumbs.replaceChildren(
      ...product.images.map((src, index) =>
        el('div', { class: 'thumb' },
          el('img', { src, alt: '' }),
          el('button', {
            type: 'button', title: '移除這張照片', 'aria-label': '移除這張照片',
            onclick: () => {
              product.images.splice(index, 1);
              markDirty('products');
              renderThumbs();
            },
          }, '×'),
        ),
      ),
      product.images.length ? null : el('p', { class: 'hint' }, '尚未加入照片'),
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

  return el('div', { class: 'panel' },
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
    el('div', { class: 'field', style: 'margin-top:14px' },
      el('label', { for: 'f-spec' }, '產品說明'),
      specInput,
      el('p', { class: 'hint' },
        '可使用 HTML。換段落請用 <p>文字</p>，換行用 <br>。'),
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

/** 前台樣式，從頁面上那個不會執行的 <script type="text/css"> 取出 */
function siteCss() {
  return document.getElementById('preview-css')?.textContent ?? '';
}

/**
 * 產生預覽用的 HTML。
 *
 * 內容會放進 sandbox iframe，不給 allow-scripts 也不給 allow-same-origin，
 * 所以即使內文貼進了 <script> 或 onerror 也不會執行、碰不到後台頁面。
 * 排版直接套前台的 global.css，看到的就是網站上的樣子。
 */
function previewDoc(post) {
  const escape = (t) => String(t).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8">
<style>${siteCss()}</style>
<style>
  body { padding: 20px 24px; }
  /* 預覽不需要橫向捲軸，圖片一律縮到框內 */
  img { max-width: 100%; }
</style>
</head><body><article class="news-post">
<h1>${escape(post.title) || '<span style="color:#9aa3b0">（尚未填標題）</span>'}</h1>
<time datetime="${escape(post.date)}">${escape(post.date)}</time>
<div>${post.body || '<p style="color:#9aa3b0">（尚未填內容）</p>'}</div>
</article></body></html>`;
}

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
    const frame = el('iframe', {
      class: 'news-preview-frame', sandbox: '', title: '預覽',
      srcdoc: previewDoc(post),
    });
    // 每次按鍵都重畫 iframe 會閃，稍微延遲再更新。
    // 掛在整個面板上，標題與日期改動也會跟著重畫。
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { frame.srcdoc = previewDoc(post); }, 250);
    };

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
        el('div', { class: 'news-edit' },
          el('div', { class: 'field' },
            el('label', { for: `n-body-${index}` }, '內容'),
            el('textarea', {
              id: `n-body-${index}`,
              oninput: (e) => { post.body = e.target.value; markDirty('news'); },
            }, post.body ?? ''),
            el('p', { class: 'hint' },
              '可使用 HTML。分段用 <p>…</p>，小標題用 <h2>…</h2>。'),
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

load().catch((err) => {
  setStatus('');
  notify(`載入失敗：${err.message}`, 'warn');
});
