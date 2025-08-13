/*
  轻量前端应用（无框架）
  - 记录三餐：本地保存到 localStorage，支持拍照/上传、文本备注、标签、餐别
  - 导入外部菜谱：输入菜谱网页 URL，尝试抓取页面标题/主图（CORS 允许范围内），并保存为菜谱
  - 查询菜谱：基于标题、标签关键字本地搜索
*/

const STORAGE_KEYS = {
  meals: 'carol.meals.v1',
  recipes: 'carol.recipes.v1'
};

/** ---------- 基础工具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('Storage read error', e);
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Storage write error', e);
  }
}

/** ---------- 状态 ---------- */
let state = {
  meals: readStorage(STORAGE_KEYS.meals, []),
  recipes: readStorage(STORAGE_KEYS.recipes, []),
  route: '#/meals'
};

function setState(next) {
  state = { ...state, ...next };
  if (next.meals) writeStorage(STORAGE_KEYS.meals, state.meals);
  if (next.recipes) writeStorage(STORAGE_KEYS.recipes, state.recipes);
  render();
}

/** ---------- 视图：路由切换 ---------- */
function navigate(hash) {
  state.route = hash || '#/meals';
  history.replaceState(null, '', state.route);
  render();
}

window.addEventListener('hashchange', () => navigate(location.hash));

/** ---------- 组件：通用 ---------- */
function MealBadge(mealType) {
  return `<span class="badge">${mealType}</span>`;
}

function ImageOrPlaceholder(src, alt) {
  if (!src) return '';
  return `<img src="${src}" alt="${alt || ''}">`;
}

/** ---------- 视图：三餐 ---------- */
function MealsView() {
  const meals = state.meals.slice().sort((a, b) => b.createdAt - a.createdAt);
  return `
  <section class="panel">
    <h2 class="panel-title">记录今天的三餐</h2>
    <form id="meal-form" class="meal-form">
      <div class="form-row">
        <div class="segmented" role="tablist" aria-label="餐别">
          <button type="button" class="seg-btn is-active" data-value="早餐" aria-selected="true">早餐</button>
          <button type="button" class="seg-btn" data-value="午餐" aria-selected="false">午餐</button>
          <button type="button" class="seg-btn" data-value="晚餐" aria-selected="false">晚餐</button>
          <button type="button" class="seg-btn" data-value="加餐" aria-selected="false">加餐</button>
        </div>
        <input type="hidden" name="mealType" value="早餐">
        <input type="text" name="title" placeholder="菜名 / 简要描述" required>
      </div>
      <div class="form-row">
        <input type="file" accept="image/*" name="photo" id="meal-photo" capture="environment">
      </div>
      <div class="form-row">
        <textarea name="notes" placeholder="口味、用料、感受…"></textarea>
      </div>
      <div class="form-row">
        <input type="text" name="tags" placeholder="标签：逗号分隔 如 家常,低脂,快手">
      </div>
      <div class="form-row">
        <button class="btn" type="submit">保存</button>
        <button class="btn secondary" type="reset" id="meal-reset">清空</button>
      </div>
      <img id="meal-preview" class="preview-img" style="display:none;" alt="预览"/>
    </form>
  </section>

  <section class="panel">
    <h3 class="panel-title">最近记录</h3>
    <div class="grid">
      ${meals.map(m => `
        <article class="card" data-id="${m.id}">
          ${ImageOrPlaceholder(m.photoDataUrl, m.title)}
          <div class="card-body">
            <div>${MealBadge(m.mealType)} <strong>${m.title}</strong></div>
            <div class="muted">${new Date(m.createdAt).toLocaleString()}</div>
            ${m.tags?.length ? `<div class="muted">#${m.tags.join(' #')}</div>` : ''}
          </div>
        </article>
      `).join('')}
    </div>
  </section>
  `;
}

function bindMealsViewEvents() {
  const form = $('#meal-form');
  const fileInput = $('#meal-photo');
  const preview = $('#meal-preview');
  const resetBtn = $('#meal-reset');
  const segButtons = $$('.seg-btn');

  segButtons.forEach(btn => btn.addEventListener('click', () => {
    segButtons.forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('is-active');
    btn.setAttribute('aria-selected', 'true');
    const hidden = $('input[name="mealType"]');
    hidden.value = btn.dataset.value;
  }));

  function updatePreview(file) {
    if (!file) { preview.style.display = 'none'; preview.src=''; return; }
    const reader = new FileReader();
    reader.onload = e => { preview.src = e.target.result; preview.style.display = 'block'; };
    reader.readAsDataURL(file);
  }

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    updatePreview(file);
  });

  resetBtn?.addEventListener('click', () => {
    preview.style.display = 'none';
    preview.src = '';
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const meal = {
      id: uid(),
      mealType: fd.get('mealType') || '早餐',
      title: String(fd.get('title') || '').trim(),
      notes: String(fd.get('notes') || '').trim(),
      tags: String(fd.get('tags') || '').split(',').map(s => s.trim()).filter(Boolean),
      photoDataUrl: '',
      createdAt: Date.now()
    };

    const file = fd.get('photo');
    if (file && file instanceof File && file.size > 0) {
      meal.photoDataUrl = await fileToDataUrl(file);
    }

    setState({ meals: [meal, ...state.meals] });
    form.reset();
    $('#meal-preview').style.display = 'none';
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

/** ---------- 视图：菜谱列表/搜索 ---------- */
function RecipesView() {
  return `
  <section class="panel">
    <h2 class="panel-title">查询菜谱</h2>
    <div class="search-bar">
      <input id="recipe-q" type="text" placeholder="按标题或标签搜索…">
      <button id="recipe-search" class="btn">搜索</button>
    </div>
  </section>
  <section class="panel">
    <h3 class="panel-title">我的菜谱</h3>
    <div id="recipe-results" class="grid"></div>
  </section>
  `;
}

function bindRecipesViewEvents() {
  const results = $('#recipe-results');
  function renderList(list) {
    results.innerHTML = list.map(r => `
      <article class="card">
        ${ImageOrPlaceholder(r.cover, r.title)}
        <div class="card-body">
          <div><strong>${r.title}</strong></div>
          ${r.sourceUrl ? `<div class="muted"><a href="${r.sourceUrl}" target="_blank" rel="noopener">原文链接</a></div>` : ''}
          ${r.tags?.length ? `<div class="muted">#${r.tags.join(' #')}</div>` : ''}
        </div>
      </article>
    `).join('');
  }

  renderList(state.recipes);

  $('#recipe-search')?.addEventListener('click', () => doSearch());
  $('#recipe-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  function doSearch() {
    const q = String($('#recipe-q').value || '').trim().toLowerCase();
    if (!q) { renderList(state.recipes); return; }
    const hits = state.recipes.filter(r => {
      const inTitle = r.title.toLowerCase().includes(q);
      const inTags = (r.tags || []).some(t => t.toLowerCase().includes(q));
      return inTitle || inTags;
    });
    renderList(hits);
  }
}

/** ---------- 视图：导入外部菜谱 ---------- */
function ImportView() {
  return `
  <section class="panel">
    <h2 class="panel-title">导入外部网页菜谱</h2>
    <p class="muted">输入菜谱网页链接，将尝试抓取页面标题和主图（受 CORS 限制）。</p>
    <form id="import-form">
      <div class="form-row">
        <input type="url" name="url" placeholder="https://…" required>
      </div>
      <div class="form-row">
        <button class="btn" type="submit" id="import-btn">抓取并保存</button>
      </div>
    </form>
  </section>
  <section class="panel" id="import-preview" style="display:none;">
    <h3 class="panel-title">预览</h3>
    <div id="import-preview-body"></div>
  </section>
  `;
}

async function fetchPageMeta(url) {
  // 采用 no-cors fetch 将受限，这里尝试通过 text() 获取同源或允许的跨域资源
  try {
    const res = await fetch(url, { mode: 'cors' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.querySelector('meta[property="og:title"]')?.content || doc.title || url;
    const cover = doc.querySelector('meta[property="og:image"]')?.content || '';
    return { title, cover };
  } catch (e) {
    console.warn('Fetch meta failed', e);
    return { title: url, cover: '' };
  }
}

function bindImportViewEvents() {
  const form = $('#import-form');
  const preview = $('#import-preview');
  const previewBody = $('#import-preview-body');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const url = String(fd.get('url') || '').trim();
    if (!url) return;
    $('#import-btn').disabled = true;
    const meta = await fetchPageMeta(url);
    const recipe = {
      id: uid(),
      title: meta.title || '未命名菜谱',
      cover: meta.cover || '',
      sourceUrl: url,
      tags: []
    };
    setState({ recipes: [recipe, ...state.recipes] });
    preview.style.display = 'block';
    previewBody.innerHTML = `
      <article class="card">
        ${ImageOrPlaceholder(recipe.cover, recipe.title)}
        <div class="card-body">
          <div><strong>${recipe.title}</strong></div>
          <div class="muted"><a href="${recipe.sourceUrl}" target="_blank" rel="noopener">原文链接</a></div>
        </div>
      </article>
    `;
    $('#import-btn').disabled = false;
    form.reset();
  });
}

/** ---------- 主渲染 ---------- */
function render() {
  const app = $('#app');
  const route = state.route || location.hash || '#/meals';
  $$('.tab-btn').forEach(btn => {
    if (btn.dataset.route === route) btn.classList.add('is-active');
    else btn.classList.remove('is-active');
  });

  if (route === '#/meals') app.innerHTML = MealsView();
  else if (route === '#/recipes') app.innerHTML = RecipesView();
  else if (route === '#/import') app.innerHTML = ImportView();
  else app.innerHTML = '<section class="panel">未找到页面</section>';

  // 绑定事件
  if (route === '#/meals') bindMealsViewEvents();
  if (route === '#/recipes') bindRecipesViewEvents();
  if (route === '#/import') bindImportViewEvents();
}

// 启动
document.addEventListener('DOMContentLoaded', () => {
  const tabs = $$('.tab-btn');
  tabs.forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.route)));
  navigate(location.hash || '#/meals');
});


