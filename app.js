/**
 * AI Prompt ศึกษานิเทศก์ (ทุกสังกัด) — Main Application
 * app.js
 *
 * Globals expected:
 *   PROMPTS_DATA    – array of prompt objects (from data/prompts.js)
 *   BOOKS_META      – array of book metadata
 *   CHAPTERS_META   – array of chapter metadata
 *   SUPABASE_CONFIG – { url, anonKey, enabled }
 *   SITE_CONFIG     – { promptsPerPage, maxSearchSuggestions }
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. APP STATE
═══════════════════════════════════════════════════════════════ */
const state = {
  currentView:      'home',
  filteredPrompts:  [],
  currentPage:      1,
  viewMode:         'grid',   // 'grid' | 'list'
  activeBook:       null,
  activeChapter:    null,
  activeSituation:  'all',
  activeTag:        null,
  searchQuery:      '',
  isMasterOnly:     false,
  currentPrompt:    null,
  user:             null,
  favorites:        new Set(),
  copyHistory:      [],
  sortMode:         'default'
};

/* ═══════════════════════════════════════════════════════════════
   2. SUPABASE INIT
═══════════════════════════════════════════════════════════════ */
let _sb = null;

function initSupabase() {
  if (!SUPABASE_CONFIG.enabled) return;
  if (window.supabase) {
    try {
      _sb = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      console.log('[Supabase] Client initialised');
      setupAuthListeners();
    } catch (err) { console.warn('[Supabase] init failed:', err); }
    return;
  }
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  script.onload = function() {
    try {
      _sb = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      console.log('[Supabase] Client initialised (dynamic)');
      setupAuthListeners();
    } catch (err) { console.warn('[Supabase] dynamic init failed:', err); }
  };
  document.head.appendChild(script);
}

function setupAuthListeners() {
  if (!_sb) return;
  _sb.auth.getSession().then(async ({ data: { session } }) => {
    if (session?.user) await onAuthStateChanged(session.user);
  });
  _sb.auth.onAuthStateChange(async (_event, session) => {
    await onAuthStateChanged(session?.user || null);
  });
}

/* ═══════════════════════════════════════════════════════════════
   3. NAVIGATION
═══════════════════════════════════════════════════════════════ */
const VIEWS = ['home', 'favorites', 'dashboard', 'map', 'profile'];

function navigateTo(view) {
  if (!VIEWS.includes(view)) return;
  state.currentView = view;

  VIEWS.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) if (v === view) {
      el.style.display = 'block';
      el.classList.add('active');
    } else {
      el.style.display = 'none';
      el.classList.remove('active');
    }
  });

  updateNavActive(view);

  if (view === 'favorites')  renderFavoritesView();
  if (view === 'dashboard')  loadDashboard();
  if (view === 'map')        renderLegalMap();
}

function updateNavActive(view) {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === view);
  });
  document.querySelectorAll('[data-bottom-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.bottomNav === view);
  });
}

/* ═══════════════════════════════════════════════════════════════
   4. SEARCH
═══════════════════════════════════════════════════════════════ */
let _searchTimer = null;

function onSearchInput(query) {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    state.searchQuery = query.trim();
    state.currentPage = 1;
    applySortAndFilter();
    renderSuggestions(query.trim());
    toggleClearButton(query.trim().length > 0);
  }, 300);
}

function toggleClearButton(show) {
  document.querySelectorAll('.search-clear').forEach(btn => {
    btn.classList.toggle('hidden', !show);
  });
}

function clearSearch() {
  state.searchQuery = '';
  document.querySelectorAll('.search-input-field').forEach(el => { el.value = ''; });
  toggleClearButton(false);
  hideSuggestions();
  state.currentPage = 1;
  applySortAndFilter();
}

function renderSuggestions(query) {
  const container = document.getElementById('search-suggestions');
  if (!container || !query) { hideSuggestions(); return; }

  const max = (SITE_CONFIG && SITE_CONFIG.maxSearchSuggestions) || 8;
  const lower = query.toLowerCase();
  const matches = PROMPTS_DATA
    .filter(p =>
      p.title.toLowerCase().includes(lower) ||
      (p.promptNum && p.promptNum.includes(lower))
    )
    .slice(0, max);

  if (matches.length === 0) { hideSuggestions(); return; }

  container.innerHTML = matches.map(p => `
    <div class="suggestion-item" onclick="selectSuggestion('${p.id}')">
      <span class="suggestion-num">${p.promptNum}</span>
      <span class="suggestion-title">${highlightText(p.title, query)}</span>
    </div>
  `).join('');
  container.classList.remove('hidden');
}

function hideSuggestions() {
  const c = document.getElementById('search-suggestions');
  if (c) c.classList.add('hidden');
}

function selectSuggestion(promptId) {
  hideSuggestions();
  openPromptModal(promptId);
}

/* ═══════════════════════════════════════════════════════════════
   5. FILTERING
═══════════════════════════════════════════════════════════════ */
function filterByBook(bookNum) {
  if (state.currentView !== 'home') navigateTo('home');
  state.activeBook    = bookNum;
  state.activeChapter = null;
  state.currentPage   = 1;
  updateSidebarActive();
  applySortAndFilter();
}

function filterByChapter(bookNum, chapterNum) {
  if (state.currentView !== 'home') navigateTo('home');
  state.activeBook    = bookNum;
  state.activeChapter = chapterNum;
  state.currentPage   = 1;
  updateSidebarActive();
  applySortAndFilter();
}

function filterBySituation(situation) {
  if (state.currentView !== 'home') navigateTo('home');
  state.activeSituation = situation;
  state.currentPage     = 1;
  document.querySelectorAll('[data-situation]').forEach(el => {
    el.classList.toggle('active', el.dataset.situation === situation);
  });
  applySortAndFilter();
}

function filterByTag(tag) {
  if (state.currentView !== 'home') navigateTo('home');
  state.activeTag   = (state.activeTag === tag) ? null : tag;
  state.currentPage = 1;
  renderTagsBar();
  applySortAndFilter();
}

function filterMaster() {
  if (state.currentView !== 'home') navigateTo('home');
  state.isMasterOnly = !state.isMasterOnly;
  state.currentPage  = 1;
  const btn = document.getElementById('master-filter-btn');
  if (btn) btn.classList.toggle('active', state.isMasterOnly);
  applySortAndFilter();
}

// Toggle chapter sub-menu expand/collapse in sidebar
function toggleBook(bookNum) {
  if (state.currentView !== 'home') navigateTo('home');
  const chapters = document.getElementById('chapters-' + bookNum);
  const chevron  = document.querySelector('[data-book="' + bookNum + '"] .chevron');

  if (!chapters) {
    filterByBook(bookNum);
    return;
  }

  const isOpen = chapters.style.display !== 'none' && chapters.style.display !== '';

  // Close all other chapter menus first
  [1, 2, 3].forEach(function(b) {
    const ch = document.getElementById('chapters-' + b);
    const cv = document.querySelector('[data-book="' + b + '"] .chevron');
    if (ch) ch.style.display = 'none';
    if (cv) cv.textContent = '▸';
  });

  if (!isOpen) {
    chapters.style.display = 'block';
    if (chevron) chevron.textContent = '▾';
    filterByBook(bookNum);
  } else {
    filterByBook(null);
  }
}

// Highlight active item in sidebar
function updateSidebarActive() {
  // Highlight "ทั้งหมด"
  document.querySelectorAll('[data-filter="all"]').forEach(function(el) {
    el.classList.toggle('active', state.activeBook === null && state.activeChapter === null);
  });
  // Highlight active book header
  [1, 2, 3].forEach(function(b) {
    const header = document.querySelector('[data-book="' + b + '"] .nav-book-header');
    if (header) header.classList.toggle('active', state.activeBook === b);
  });
  // Highlight active chapter button
  document.querySelectorAll('.nav-chapter').forEach(function(btn) {
    btn.classList.remove('active');
  });
}

function applySortAndFilter() {
  let prompts = [...PROMPTS_DATA];

  // Book filter
  if (state.activeBook !== null) {
    prompts = prompts.filter(p => p.book === state.activeBook);
  }

  // Chapter filter
  if (state.activeChapter !== null) {
    prompts = prompts.filter(p => p.chapter === state.activeChapter);
  }

  // Situation filter
  if (state.activeSituation && state.activeSituation !== 'all') {
    prompts = prompts.filter(p =>
      Array.isArray(p.situations) && p.situations.includes(state.activeSituation)
    );
  }

  // Tag filter
  if (state.activeTag) {
    prompts = prompts.filter(p =>
      Array.isArray(p.tags) && p.tags.includes(state.activeTag)
    );
  }

  // Master-only filter
  if (state.isMasterOnly) {
    prompts = prompts.filter(p => p.isMaster);
  }

  // Search query
  if (state.searchQuery) {
    const lower = state.searchQuery.toLowerCase();
    prompts = prompts.filter(p =>
      (p.title   && p.title.toLowerCase().includes(lower)) ||
      (p.content && p.content.toLowerCase().includes(lower)) ||
      (Array.isArray(p.tags) && p.tags.some(t => t.toLowerCase().includes(lower))) ||
      (p.promptNum && p.promptNum.includes(lower))
    );
  }

  // Sort
  prompts = sortPrompts(prompts);

  state.filteredPrompts = prompts;

  // Render
  const perPage = (SITE_CONFIG && SITE_CONFIG.promptsPerPage) || 12;
  const start   = (state.currentPage - 1) * perPage;
  const page    = prompts.slice(start, start + perPage);

  renderPrompts(page);
  renderPagination(prompts.length, perPage, state.currentPage);
  updateResultCount(prompts.length);
}

function updateResultCount(total) {
  const el = document.getElementById('result-count');
  if (el) el.textContent = `${total} prompt${total === 1 ? '' : 's'}`;
}

/* ═══════════════════════════════════════════════════════════════
   6. SORTING
═══════════════════════════════════════════════════════════════ */
function sortPrompts(prompts) {
  switch (state.sortMode) {
    case 'az':
      return [...prompts].sort((a, b) => a.title.localeCompare(b.title, 'th'));

    case 'popular': {
      const stats = getCopyStats();
      return [...prompts].sort((a, b) => (stats[b.id] || 0) - (stats[a.id] || 0));
    }

    default: // 'default'
      return [...prompts].sort((a, b) => {
        if (a.book !== b.book) return a.book - b.book;
        if (a.chapter !== b.chapter) return a.chapter - b.chapter;
        return (a.promptNum || '').localeCompare(b.promptNum || '', undefined, { numeric: true });
      });
  }
}

function setSortMode(mode) {
  state.sortMode    = mode;
  state.currentPage = 1;
  document.querySelectorAll('[data-sort]').forEach(el => {
    el.classList.toggle('active', el.dataset.sort === mode);
  });
  applySortAndFilter();
}

/* ═══════════════════════════════════════════════════════════════
   7. PROMPT CARDS RENDERING
═══════════════════════════════════════════════════════════════ */
function renderPrompts(prompts) {
  const grid = document.getElementById('prompts-grid');
  if (!grid) return;

  if (prompts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p class="empty-text">ไม่พบ Prompt ที่ตรงกัน</p>
        <button class="btn-secondary" onclick="clearSearch()">ล้างการค้นหา</button>
      </div>`;
    return;
  }

  grid.innerHTML = prompts.map(p => buildCardHTML(p)).join('');
}

function buildCardHTML(p) {
  const favClass  = state.favorites.has(p.id) ? 'favorited' : '';
  const favStar   = state.favorites.has(p.id) ? '★' : '☆';
  const masterBadge = p.isMaster
    ? '<span class="master-badge">MASTER</span>'
    : '';
  const tags = (p.tags || []).slice(0, 3)
    .map(t => `<span class="tag">${t}</span>`).join('');
  const promptNum = p.promptNum || (p.id ? p.id.replace(/^b(\d+)_(\d+)_(\d+)$/, '$1.$2.$3') : '');
  const promptText = p.content || p.prompt || '';

  return `
    <div class="prompt-card book-${p.book}" data-id="${p.id}" onclick="openPromptModal('${p.id}')">
      <div class="card-header">
        <span class="card-book-badge book${p.book}">เล่ม ${p.book}</span>
        <span class="card-num">${promptNum}</span>
        ${masterBadge}
      </div>
      <h3 class="card-title">${highlightText(p.title, state.searchQuery)}</h3>
      <p class="card-preview">${highlightText(truncate(promptText, 120), state.searchQuery)}</p>
      <div class="card-tags">${tags}</div>
      <div class="card-footer">
        <button class="btn-copy" onclick="event.stopPropagation(); copyPrompt('${p.id}')">
          📋 คัดลอก
        </button>
        <button class="btn-favorite ${favClass}"
                onclick="event.stopPropagation(); toggleFavorite('${p.id}')"
                title="บันทึกรายการโปรด">
          ${favStar}
        </button>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   8. PAGINATION
═══════════════════════════════════════════════════════════════ */
function renderPagination(total, perPage, currentPage) {
  const container = document.getElementById('pagination');
  if (!container) return;

  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  const pages = buildPageNumbers(currentPage, totalPages);

  container.innerHTML = pages.map(p => {
    if (p === '...') return `<span class="page-ellipsis">…</span>`;
    return `<button class="page-btn ${p === currentPage ? 'active' : ''}"
                    onclick="goToPage(${p})">${p}</button>`;
  }).join('');

  // Prev / Next
  const prevDisabled = currentPage <= 1 ? 'disabled' : '';
  const nextDisabled = currentPage >= totalPages ? 'disabled' : '';
  container.insertAdjacentHTML('afterbegin',
    `<button class="page-btn page-prev" onclick="goToPage(${currentPage - 1})" ${prevDisabled}>‹</button>`);
  container.insertAdjacentHTML('beforeend',
    `<button class="page-btn page-next" onclick="goToPage(${currentPage + 1})" ${nextDisabled}>›</button>`);
}

function buildPageNumbers(current, total, maxVisible = 7) {
  if (total <= maxVisible) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = [];
  const half  = Math.floor(maxVisible / 2);
  let start   = Math.max(2, current - half);
  let end     = Math.min(total - 1, current + half);

  if (current - half <= 2)       end   = Math.min(total - 1, maxVisible - 2);
  if (current + half >= total-1) start = Math.max(2, total - maxVisible + 2);

  pages.push(1);
  if (start > 2)    pages.push('...');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('...');
  pages.push(total);

  return pages;
}

function goToPage(page) {
  const perPage    = (SITE_CONFIG && SITE_CONFIG.promptsPerPage) || 12;
  const totalPages = Math.ceil(state.filteredPrompts.length / perPage);
  if (page < 1 || page > totalPages) return;
  state.currentPage = page;
  const start = (page - 1) * perPage;
  const slice = state.filteredPrompts.slice(start, start + perPage);
  renderPrompts(slice);
  renderPagination(state.filteredPrompts.length, perPage, page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ═══════════════════════════════════════════════════════════════
   9. COPY PROMPT
═══════════════════════════════════════════════════════════════ */
async function copyPrompt(promptId) {
  const p = PROMPTS_DATA.find(x => x.id === promptId);
  if (!p) return;

  // Access check — MODE B/C gates copy action
  if (typeof checkCopyAccess === 'function') {
    checkCopyAccess(promptId, () => _doCopyPrompt(p));
    return;
  }
  await _doCopyPrompt(p);
}

async function _doCopyPrompt(p) {
  const promptId = p.id;
  const textToCopy = p.content || p.prompt || '';

  try {
    await navigator.clipboard.writeText(textToCopy);
  } catch {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = textToCopy;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  // Visual feedback on all copy buttons for this prompt
  document.querySelectorAll('.btn-copy[data-id="' + promptId + '"], .btn-copy-modal').forEach(btn => {
    const original = btn.textContent;
    btn.textContent = '✅ คัดลอกแล้ว!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied');
    }, 2000);
  });

  // Log to localStorage
  logCopyEvent(promptId);

  // Log to Supabase
  if (_sb) {
    const copyData = {
      prompt_id: promptId,
      user_id: (state.user && state.user.id) ? state.user.id : null,
      book_number: p.book || null,
      chapter_number: p.chapter || null,
      session_id: getOrCreateSessionId()
    };

    _sb.from('copy_events').insert(copyData).then(({ error }) => {
      if (error) {
        console.warn('[Supabase] copy_events insert error:', error);
      } else {
        console.log('[Supabase] Logged copy event for', promptId);
        if (state.currentView === 'dashboard') loadDashboard();
      }
    });
  }

  showToast('คัดลอก Prompt แล้ว! วางใน Claude, ChatGPT หรือ Gemini ได้เลย', 'success');
  if (state.currentView === 'dashboard') loadDashboard();
  if (typeof updateAccessIndicator === 'function') updateAccessIndicator();
}

function logCopyEvent(promptId) {
  try {
    const key   = 'ai_prompt_kruthai_copy_stats';
    const stats = JSON.parse(localStorage.getItem(key) || '{}');
    stats[promptId] = (stats[promptId] || 0) + 1;
    localStorage.setItem(key, JSON.stringify(stats));

    // Also keep a history array (last 50)
    const histKey = 'ai_prompt_kruthai_copy_history';
    const hist    = JSON.parse(localStorage.getItem(histKey) || '[]');
    hist.unshift({ id: promptId, ts: Date.now() });
    localStorage.setItem(histKey, JSON.stringify(hist.slice(0, 50)));
    state.copyHistory = hist;
  } catch (err) {
    console.warn('[LocalStorage] logCopyEvent error:', err);
  }
}

function getCopyStats() {
  try {
    return JSON.parse(localStorage.getItem('ai_prompt_kruthai_copy_stats') || '{}');
  } catch { return {}; }
}

function getOrCreateSessionId() {
  try {
    let sid = sessionStorage.getItem('ai_prompt_session_id');
    if (!sid) {
      sid = 'sess_' + Math.random().toString(36).substring(2, 12);
      sessionStorage.setItem('ai_prompt_session_id', sid);
    }
    return sid;
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   10. FAVORITES
═══════════════════════════════════════════════════════════════ */
async function toggleFavorite(promptId) {
  if (state.favorites.has(promptId)) {
    state.favorites.delete(promptId);
    showToast('นำออกจากรายการโปรดแล้ว', 'info');

    if (_sb && state.user) {
      const { error } = await _sb
        .from('favorites')
        .delete()
        .eq('user_id', state.user.id)
        .eq('prompt_id', promptId);
      if (error) console.warn('[Supabase] delete favorite error:', error);
    }
  } else {
    state.favorites.add(promptId);
    showToast('บันทึกเป็นรายการโปรดแล้ว ★', 'success');

    if (_sb && state.user) {
      const { error } = await _sb
        .from('favorites')
        .upsert({ user_id: state.user.id, prompt_id: promptId, created_at: new Date().toISOString() });
      if (error) console.warn('[Supabase] insert favorite error:', error);
    }
  }

  // Persist locally as fallback
  try {
    localStorage.setItem('ai_prompt_kruthai_favs', JSON.stringify([...state.favorites]));
  } catch (err) {
    console.warn('[LocalStorage] save favorites error:', err);
  }

  updateFavCount();
  refreshFavButtons(promptId);
}

function refreshFavButtons(promptId) {
  const isFav = state.favorites.has(promptId);
  document.querySelectorAll(`.btn-favorite[data-id="${promptId}"]`).forEach(btn => {
    btn.textContent = isFav ? '★' : '☆';
    btn.classList.toggle('favorited', isFav);
  });
  // Re-render modal fav button if open
  if (state.currentPrompt && state.currentPrompt.id === promptId) {
    const modalFavBtn = document.getElementById('modal-fav-btn');
    if (modalFavBtn) {
      modalFavBtn.textContent = isFav ? '★ รายการโปรด' : '☆ บันทึก';
      modalFavBtn.classList.toggle('favorited', isFav);
    }
  }
}

async function loadFavoritesFromSupabase() {
  if (!_sb || !state.user) return;
  try {
    const { data, error } = await _sb
      .from('favorites')
      .select('prompt_id')
      .eq('user_id', state.user.id);
    if (error) throw error;
    data.forEach(row => state.favorites.add(row.prompt_id));
    updateFavCount();
  } catch (err) {
    console.warn('[Supabase] loadFavorites error:', err);
  }
}

/* ═══════════════════════════════════════════════════════════════
   11. PROMPT MODAL
═══════════════════════════════════════════════════════════════ */
function openPromptModal(promptId) {
  const p = PROMPTS_DATA.find(x => x.id === promptId);
  if (!p) return;
  state.currentPrompt = p;

  const promptNum = p.promptNum || (p.id ? p.id.replace(/^b(\d+)_(\d+)_(\d+)$/, '$1.$2.$3') : '');
  const promptText = p.content || p.prompt || '';

  // 1. Fill title & number
  setModalField('modal-prompt-num', promptNum);
  setModalField('modal-title', p.title);

  // 2. Badges
  const bookBadge = document.getElementById('modal-book-badge');
  if (bookBadge) {
    bookBadge.textContent = `เล่ม ${p.book}`;
    bookBadge.className = `chip book${p.book}`;
  }

  const chapterBadge = document.getElementById('modal-chapter-badge');
  if (chapterBadge) {
    chapterBadge.textContent = p.chapter ? `บทที่ ${p.chapter}` : (p.category || '');
    chapterBadge.classList.remove('hidden');
  }

  const masterBadge = document.getElementById('modal-master-badge') || document.getElementById('modal-book-badge_master_na');
  if (masterBadge) {
    masterBadge.classList.toggle('hidden', !p.isMaster);
  }

  // 3. Content with syntax/placeholder formatting
  const contentEl = document.getElementById('modal-content');
  if (contentEl) {
    contentEl.innerHTML = formatPromptContent(promptText);
  }

  // 4. Tip / Role / Framework Box
  const tipBox = document.getElementById('modal-tip-box') || document.getElementById('modal-tip-section');
  const tipEl = document.getElementById('modal-tip') || document.getElementById('modal-tip-text');
  const tipContent = p.tip || (p.role ? `<strong>บทบาท AI:</strong> ${escapeHtml(p.role)}` : '') || (p.framework ? `<strong>Framework:</strong> ${escapeHtml(p.framework)}` : '');
  if (tipEl) {
    if (tipContent) {
      tipEl.innerHTML = tipContent;
      if (tipBox) tipBox.classList.remove('hidden');
    } else {
      if (tipBox) tipBox.classList.add('hidden');
    }
  }

  // 5. Customize Chips
  const customizeBox = document.getElementById('modal-customize-box') || document.getElementById('modal-customize-section');
  const customizeEl = document.getElementById('modal-customize') || document.getElementById('modal-customize-chips');
  let customizeStr = p.customize || '';
  if (!customizeStr) {
    const matches = promptText.match(/\[([^[\]\n]{2,40})\]/g);
    if (matches && matches.length > 0) {
      const unique = [...new Set(matches)].slice(0, 8);
      customizeStr = unique.join(' ');
    }
  }
  if (customizeEl) {
    if (customizeStr) {
      const chips = customizeStr.split(/[\s,]+/).filter(Boolean)
        .map(c => `<span class="chip customize-chip">${escapeHtml(c)}</span>`).join('');
      customizeEl.innerHTML = chips;
      if (customizeBox) customizeBox.classList.remove('hidden');
    } else {
      if (customizeBox) customizeBox.classList.add('hidden');
    }
  }

  // 6. Tags
  const tagsEl = document.getElementById('modal-tags') || document.getElementById('modal-tags-na');
  if (tagsEl) {
    const allTags = [...(p.tags || []), ...(p.situations || [])];
    tagsEl.innerHTML = allTags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  }

  // 7. Situations
  const sitEl = document.getElementById('modal-situations-na');
  if (sitEl) {
    sitEl.innerHTML = (p.situations || []).map(s => `<span class="situation-badge">${escapeHtml(s)}</span>`).join('');
  }

  // 8. Favorite button
  updateModalFavBtn(p.id);

  // 9. Reset copy button
  const copyBtn = document.getElementById('modal-copy-btn');
  if (copyBtn) {
    copyBtn.innerHTML = '📋 คัดลอก Prompt';
    copyBtn.classList.remove('copied');
  }

  // 10. Show overlay
  const overlay = document.getElementById('modal-overlay') || document.getElementById('prompt-modal-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.add('show');
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  // Deep linking
  history.pushState(null, '', `#${p.id}`);

  // Load rating and reviews if defined
  if (typeof loadPromptFeedback === 'function') {
    loadPromptFeedback(p.id);
  }
}

function closePromptModal(event) {
  const overlay = document.getElementById('modal-overlay') || document.getElementById('prompt-modal-overlay');
  if (!overlay) return;
  // Close only if clicking the backdrop itself or modal-close button
  if (event && event.target !== overlay && !event.target.classList.contains('modal-close')) return;
  overlay.classList.add('hidden');
  overlay.classList.remove('show');
  overlay.style.display = 'none';
  document.body.style.overflow = '';
  history.pushState('', document.title, window.location.pathname);
  state.currentPrompt = null;
}

function closeModal(event) {
  closePromptModal(event);
}

function closePromptModalForce() {
  const overlay = document.getElementById('modal-overlay') || document.getElementById('prompt-modal-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.classList.remove('show');
    overlay.style.display = 'none';
  }
  document.body.style.overflow = '';
  history.pushState('', document.title, window.location.pathname);
  state.currentPrompt = null;
}

function setModalField(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

async function copyModalPrompt() {
  if (!state.currentPrompt) return;
  await copyPrompt(state.currentPrompt.id);
  const btns = document.querySelectorAll('#modal-copy-btn, .modal-footer .btn-primary');
  btns.forEach(btn => {
    const original = btn.innerHTML;
    btn.innerHTML = '✅ คัดลอกแล้ว!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove('copied');
    }, 2000);
  });
}

function toggleModalFav() {
  if (!state.currentPrompt) return;
  toggleFavorite(state.currentPrompt.id);
  updateModalFavBtn(state.currentPrompt.id);
}

function updateModalFavBtn(promptId) {
  const favBtn = document.getElementById('modal-fav-btn');
  if (!favBtn) return;
  const isFav = state.favorites.has(promptId);
  favBtn.innerHTML = isFav ? '⭐' : '☆';
  favBtn.title = isFav ? 'อยู่ในรายการโปรด (คลิกเพื่อนำออก)' : 'บันทึกรายการโปรด';
  favBtn.classList.toggle('favorited', isFav);
}

async function shareCurrentPrompt() {
  if (!state.currentPrompt) return;
  const shareUrl = `${window.location.origin}${window.location.pathname}#${state.currentPrompt.id}`;
  if (navigator.share) {
    try {
      await navigator.share({
        title: state.currentPrompt.title,
        text: `AI Prompt สำหรับศึกษานิเทศก์: ${state.currentPrompt.title}`,
        url: shareUrl,
      });
      return;
    } catch {}
  }
  try {
    await navigator.clipboard.writeText(shareUrl);
    if (typeof showToast === 'function') {
      showToast('🔗 คัดลอกลิงก์ของ Prompt เรียบร้อยแล้ว!');
    } else {
      alert('คัดลอกลิงก์เรียบร้อยแล้ว: ' + shareUrl);
    }
  } catch {
    prompt('คัดลอกลิงก์นี้เพื่อแชร์:', shareUrl);
  }
}

function openInLLM(llm) {
  if (!state.currentPrompt) return;
  const promptText = state.currentPrompt.content || state.currentPrompt.prompt || '';
  
  // Copy to clipboard first
  copyPrompt(state.currentPrompt.id);

  let url = '';
  if (llm === 'claude') {
    url = 'https://claude.ai/new';
  } else if (llm === 'chatgpt') {
    url = 'https://chatgpt.com/?q=' + encodeURIComponent(promptText.slice(0, 1000));
  } else if (llm === 'gemini') {
    url = 'https://gemini.google.com/app';
  }

  if (url) {
    window.open(url, '_blank');
    if (typeof showToast === 'function') {
      showToast(`📋 คัดลอก Prompt แล้ว และกำลังเปิด ${llm.toUpperCase()}`);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   11.5 RATING & FEEDBACK SYSTEM (5 ดาว & คำแนะนำจากผู้ใช้)
═══════════════════════════════════════════════════════════════ */
let currentSelectedRating = 0;

const RATING_LABELS = {
  0: 'คลิกดาวเพื่อให้คะแนน Prompt นี้',
  1: '⭐ 1 ดาว — พอใช้ / ควรปรับปรุง',
  2: '⭐⭐ 2 ดาว — พอใช้ได้',
  3: '⭐⭐⭐ 3 ดาว — ปานกลาง / มีประโยชน์',
  4: '⭐⭐⭐⭐ 4 ดาว — ดีมาก / แนะนำ',
  5: '⭐⭐⭐⭐⭐ 5 ดาว — ยอดเยี่ยม! นำไปใช้ได้จริง'
};

function selectStarRating(val) {
  currentSelectedRating = val;
  updateStarUI(val);
  const label = document.getElementById('star-label');
  if (label) label.textContent = RATING_LABELS[val] || '';
}

function hoverStarRating(val) {
  document.querySelectorAll('.star-btn').forEach(btn => {
    const r = parseInt(btn.dataset.rating, 10);
    btn.classList.toggle('hover', r <= val);
  });
}

function resetStarHover() {
  document.querySelectorAll('.star-btn').forEach(btn => {
    btn.classList.remove('hover');
  });
}

function updateStarUI(rating) {
  document.querySelectorAll('.star-btn').forEach(btn => {
    const r = parseInt(btn.dataset.rating, 10);
    btn.classList.toggle('active', r <= rating);
  });
}

async function loadPromptFeedback(promptId) {
  currentSelectedRating = 0;
  updateStarUI(0);
  const label = document.getElementById('star-label');
  if (label) label.textContent = RATING_LABELS[0];
  const commentInput = document.getElementById('feedback-comment');
  if (commentInput) commentInput.value = '';

  const reviewsList = document.getElementById('reviews-list');
  if (reviewsList) {
    reviewsList.innerHTML = '<div class="no-reviews">กำลังโหลดความคิดเห็น...</div>';
  }

  let reviews = [];

  // 1. Try fetching from Supabase
  if (_sb) {
    try {
      const { data, error } = await _sb
        .from('prompt_ratings')
        .select('*')
        .eq('prompt_id', promptId)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        reviews = data;
        try { localStorage.setItem(`ai_ratings_${promptId}`, JSON.stringify(data)); } catch {}
      }
    } catch (err) {
      console.warn('[Supabase] Failed to fetch ratings:', err);
    }
  }

  // 2. Fallback to localStorage if no reviews fetched
  if (reviews.length === 0) {
    try {
      const cached = localStorage.getItem(`ai_ratings_${promptId}`);
      if (cached) reviews = JSON.parse(cached);
    } catch {}
  }

  // 3. Render score summary
  const scoreNum   = document.getElementById('modal-score-num');
  const scoreStars = document.getElementById('modal-score-stars');
  const scoreCount = document.getElementById('modal-score-count');

  if (reviews.length > 0) {
    const sum = reviews.reduce((acc, r) => acc + (Number(r.rating) || 0), 0);
    const avg = (sum / reviews.length).toFixed(1);
    const starCount = Math.round(Number(avg));
    const starStr = '★'.repeat(starCount) + '☆'.repeat(5 - starCount);

    if (scoreNum)   scoreNum.textContent = avg;
    if (scoreStars) scoreStars.textContent = starStr;
    if (scoreCount) scoreCount.textContent = `(${reviews.length} รีวิว)`;
  } else {
    if (scoreNum)   scoreNum.textContent = '--';
    if (scoreStars) scoreStars.textContent = '☆☆☆☆☆';
    if (scoreCount) scoreCount.textContent = '(0 รีวิว)';
  }

  // 4. Pre-fill user's previous rating if logged in
  if (state.user) {
    const myReview = reviews.find(r => r.user_id === state.user.id);
    if (myReview) {
      selectStarRating(myReview.rating);
      if (commentInput && myReview.comment) commentInput.value = myReview.comment;
      if (label) label.textContent = `${RATING_LABELS[myReview.rating]} (คะแนนเดิมของคุณ)`;
      const btn = document.getElementById('btn-submit-feedback');
      if (btn) btn.innerHTML = '<span>✏️ อัปเดตคำแนะนำของคุณ</span>';
    } else {
      const btn = document.getElementById('btn-submit-feedback');
      if (btn) btn.innerHTML = '<span>💬 ส่งคำแนะนำ / รีวิว</span>';
    }
  } else {
    const btn = document.getElementById('btn-submit-feedback');
    if (btn) btn.innerHTML = '<span>💬 ส่งคำแนะนำ / รีวิว</span>';
  }

  // 5. Render reviews list
  if (reviewsList) {
    const reviewsWithComments = reviews.filter(r => r.comment && r.comment.trim());
    if (reviewsWithComments.length === 0) {
      reviewsList.innerHTML = '<div class="no-reviews">ยังไม่มีข้อเสนอแนะ เป็นคนแรกที่ให้คำแนะนำสำหรับ Prompt นี้!</div>';
    } else {
      reviewsList.innerHTML = reviewsWithComments.map(r => {
        const author = r.user_name || 'คุณครู';
        const stars = '★'.repeat(r.rating || 5) + '☆'.repeat(5 - (r.rating || 5));
        const date = r.created_at ? new Date(r.created_at).toLocaleDateString('th-TH') : '';
        return `
          <div class="review-item">
            <div class="review-item-header">
              <span class="review-author">👤 ${escapeHtml(author)}</span>
              <div>
                <span class="review-stars">${stars}</span>
                <span class="review-date">${date}</span>
              </div>
            </div>
            <div class="review-text">${escapeHtml(r.comment)}</div>
          </div>
        `;
      }).join('');
    }
  }
}

async function submitPromptFeedback() {
  if (currentSelectedRating === 0) {
    showToast('กรุณาคลิกเลือกดาว (1-5 ดาว) เพื่อประเมินก่อนครับ ⭐', 'info');
    return;
  }

  if (!state.user) {
    showToast('กรุณาเข้าสู่ระบบก่อนส่งคำแนะนำหรือให้คะแนนครับ', 'info');
    openAuthModal('login');
    return;
  }

  const p = state.currentPrompt;
  if (!p) return;

  const commentInput = document.getElementById('feedback-comment');
  const comment = commentInput ? commentInput.value.trim() : '';

  const submitBtn = document.getElementById('btn-submit-feedback');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ กำลังบันทึก...</span>';
  }

  const userName = state.user.user_metadata?.display_name || state.user.email?.split('@')[0] || 'คุณครู';

  const reviewObj = {
    prompt_id: p.id,
    user_id: state.user.id,
    user_name: userName,
    rating: currentSelectedRating,
    comment: comment,
    created_at: new Date().toISOString()
  };

  // 1. Save to Supabase
  if (_sb) {
    try {
      const { error } = await _sb.from('prompt_ratings').upsert(reviewObj, {
        onConflict: 'user_id,prompt_id'
      });
      if (error) {
        console.warn('[Supabase] prompt_ratings upsert error:', error);
      }
    } catch (err) {
      console.warn('[Supabase] ratings error:', err);
    }
  }

  // 2. Also cache in localStorage
  try {
    const key = `ai_ratings_${p.id}`;
    let cached = [];
    const raw = localStorage.getItem(key);
    if (raw) cached = JSON.parse(raw);
    const existingIdx = cached.findIndex(r => r.user_id === state.user.id);
    if (existingIdx >= 0) {
      cached[existingIdx] = reviewObj;
    } else {
      cached.unshift(reviewObj);
    }
    localStorage.setItem(key, JSON.stringify(cached));
  } catch {}

  if (submitBtn) {
    submitBtn.disabled = false;
  }

  showToast('บันทึกคะแนนและคำแนะนำเรียบร้อยแล้ว ขอบคุณมากครับ! ⭐', 'success');
  loadPromptFeedback(p.id);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

/* ═══════════════════════════════════════════════════════════════
   12. FORMAT PROMPT CONTENT
═══════════════════════════════════════════════════════════════ */
function formatPromptContent(text) {
  // Escape HTML first to prevent XSS
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Highlight [placeholders] in orange/amber
  const highlighted = escaped.replace(/\[([^\]]+)\]/g,
    '<span class="placeholder">[$1]</span>');

  // Convert newlines to <br>
  return highlighted.replace(/\n/g, '<br>');
}

/* ═══════════════════════════════════════════════════════════════
   13. OPEN IN AI
═══════════════════════════════════════════════════════════════ */
function openInAI(service) {
  const p = state.currentPrompt;
  if (!p) return;
  const encoded = encodeURIComponent(p.content || '');
  const urls = {
    claude:  `https://claude.ai/new?q=${encoded}`,
    chatgpt: `https://chat.openai.com/?q=${encoded}`,
    gemini:  `https://gemini.google.com/app?q=${encoded}`
  };
  const url = urls[service];
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

/* ═══════════════════════════════════════════════════════════════
   14. SHARE PROMPT
═══════════════════════════════════════════════════════════════ */
async function sharePrompt() {
  const p = state.currentPrompt;
  if (!p) return;
  const url = `${window.location.origin}${window.location.pathname}#${p.id}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: p.title, url });
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('[Share] error:', err);
    }
  } else {
    try {
      await navigator.clipboard.writeText(url);
      showToast('คัดลอก URL แล้ว', 'success');
    } catch {
      showToast('ไม่สามารถคัดลอก URL ได้', 'error');
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   15. AUTH FUNCTIONS (SUPABASE)
═══════════════════════════════════════════════════════════════ */
async function signIn() {
  if (!_sb) { showToast('ระบบล็อกอินยังไม่พร้อมใช้งาน (กำลังเชื่อมต่อ Supabase...)', 'error'); return; }

  const email    = document.getElementById('login-email')?.value?.trim();
  const password = document.getElementById('login-password')?.value;
  const errEl    = document.getElementById('login-error');
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }

  if (!email || !password) {
    const msg = 'กรุณากรอกอีเมลและรหัสผ่าน';
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    showToast(msg, 'error');
    return;
  }

  const btn = document.querySelector('#auth-login .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ...'; }

  try {
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (btn) { btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; }

    if (error) {
      let msg = error.message;
      if (msg.includes('Invalid login credentials')) {
        msg = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือยังไม่ได้สมัครสมาชิก';
      }
      if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
      showToast(msg, 'error');
      return;
    }

    state.user = data.user;
    closeAuthModal(null, true);
    showToast('เข้าสู่ระบบสำเร็จ! ยินดีต้อนรับ 🎉', 'success');
    await onAuthStateChanged(data.user);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; }
    showToast('เกิดข้อผิดพลาด: ' + (err.message || err), 'error');
  }
}

async function signUp() {
  if (!_sb) { showToast('ระบบสมัครสมาชิกยังไม่พร้อมใช้งาน (กำลังเชื่อมต่อ Supabase...)', 'error'); return; }

  const email    = document.getElementById('signup-email')?.value?.trim();
  const password = document.getElementById('signup-password')?.value;
  const name     = document.getElementById('signup-name')?.value?.trim() || '';
  const errEl    = document.getElementById('signup-error');
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }

  if (!email || !password) {
    const msg = 'กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน';
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    showToast(msg, 'error');
    return;
  }

  if (password.length < 6) {
    const msg = 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร';
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    showToast(msg, 'error');
    return;
  }

  const btn = document.querySelector('#auth-signup .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังสมัครสมาชิก...'; }

  try {
    const { data, error } = await _sb.auth.signUp({
      email, password,
      options: { data: { display_name: name } }
    });
    if (btn) { btn.disabled = false; btn.textContent = 'สมัครสมาชิก'; }

    if (error) {
      if (errEl) { errEl.textContent = error.message; errEl.classList.remove('hidden'); }
      showToast('สมัครสมาชิกไม่สำเร็จ: ' + error.message, 'error');
      return;
    }

    if (data?.session) {
      state.user = data.user;
      closeAuthModal(null, true);
      showToast('สมัครสมาชิกและเข้าสู่ระบบสำเร็จ 🎉', 'success');
      await onAuthStateChanged(data.user);
    } else {
      closeAuthModal(null, true);
      showToast('สมัครสำเร็จ! โปรดตรวจสอบอีเมลของคุณเพื่อยืนยันการสมัคร', 'success');
    }
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'สมัครสมาชิก'; }
    showToast('เกิดข้อผิดพลาด: ' + (err.message || err), 'error');
  }
}

async function signInWithGoogle() {
  if (!_sb) { showToast('ระบบล็อกอินยังไม่พร้อมใช้งาน', 'error'); return; }
  const { error } = await _sb.auth.signInWithOAuth({
    provider: 'google',
    options:  { redirectTo: window.location.href }
  });
  if (error) showToast('ล็อกอินด้วย Google ไม่สำเร็จ: ' + error.message, 'error');
}

async function signOut() {
  if (_sb) {
    const { error } = await _sb.auth.signOut();
    if (error) console.warn('[Supabase] signOut error:', error);
  }
  state.user = null;
  updateProfileUI(null);
  showToast('ออกจากระบบแล้ว', 'info');
}

async function resetPassword() {
  if (!_sb) return;
  const email = document.getElementById('reset-email')?.value?.trim();
  if (!email) { showToast('กรุณากรอกอีเมล', 'error'); return; }

  const { error } = await _sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href
  });
  if (error) { showToast('เกิดข้อผิดพลาด: ' + error.message, 'error'); return; }
  showToast('ส่งลิงก์รีเซ็ตรหัสผ่านไปที่อีเมลแล้ว', 'success');
  switchAuthPanel('login');
}

function openAuthModal(panel = 'login') {
  const overlay = document.getElementById('auth-modal-overlay');
  if (overlay) overlay.classList.remove('hidden');
  switchAuthPanel(panel);
}

function closeAuthModal(event, force = false) {
  const overlay = document.getElementById('auth-modal-overlay');
  if (!overlay) return;
  if (!force && event && event.target !== overlay) return;
  overlay.classList.add('hidden');
}

function switchAuthPanel(panel) {
  ['login', 'signup', 'reset'].forEach(p => {
    const el = document.getElementById(`auth-${p}`);
    if (el) {
      if (p === panel) {
        el.classList.add('active');
        el.classList.remove('hidden');
        el.style.display = 'block';
      } else {
        el.classList.remove('active');
        el.classList.add('hidden');
        el.style.display = 'none';
      }
    }
  });

  // Clear errors
  ['login-error', 'signup-error', 'reset-msg'].forEach(id => {
    const errEl = document.getElementById(id);
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
  });
}

async function onAuthStateChanged(user) {
  state.user = user;
  updateProfileUI(user);
  if (user) {
    // Logged in — remove access walls
    if (typeof onUserLoggedIn === 'function') onUserLoggedIn(user);
    await loadFavoritesFromSupabase();
    applySortAndFilter();
    // Update bottom nav profile button
    const bnProfile = document.getElementById('bn-profile');
    if (bnProfile) bnProfile.onclick = function() { navigateTo('profile'); };
    if (state.currentView === 'dashboard') loadDashboard();
  } else {
    // Logged out — re-enforce access rules
    if (typeof initAccessSystem === 'function') initAccessSystem();
    if (state.currentView === 'dashboard') loadDashboard();
  }
}

function updateProfileUI(user) {
  const loginBtn        = document.getElementById('login-btn');
  const userAvatarWrap  = document.getElementById('user-avatar-wrap');
  const avatarInitials  = document.getElementById('avatar-initials');
  const dropdownName    = document.getElementById('dropdown-name');
  const dropdownEmail   = document.getElementById('dropdown-email');
  const logoutBtn       = document.getElementById('logout-btn');
  const userName        = document.getElementById('profile-username');

  if (user) {
    // Logged in: Hide login button, show avatar
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userAvatarWrap) userAvatarWrap.classList.remove('hidden');

    const displayName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'ผู้ใช้';
    const email = user.email || '';

    // Initials: First Thai or English character
    const initial = displayName.trim().charAt(0).toUpperCase() || '👤';
    if (avatarInitials) avatarInitials.textContent = initial;
    if (dropdownName) dropdownName.textContent = displayName;
    if (dropdownEmail) dropdownEmail.textContent = email;
    if (userName) userName.textContent = displayName;
    if (logoutBtn) logoutBtn.classList.remove('hidden');
  } else {
    // Logged out: Show login button, hide avatar
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userAvatarWrap) {
      userAvatarWrap.classList.add('hidden');
      const dropdown = document.getElementById('user-dropdown');
      if (dropdown) dropdown.classList.add('hidden');
    }
    if (userName) userName.textContent = 'ล็อกอินเพื่อซิงค์ข้อมูล';
    if (logoutBtn) logoutBtn.classList.add('hidden');
  }
}

function toggleUserDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('user-dropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}

// Close user dropdown when clicking outside
document.addEventListener('click', (e) => {
  const userMenu = document.getElementById('user-menu');
  const dropdown = document.getElementById('user-dropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!userMenu || !userMenu.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  }
});

/* ═══════════════════════════════════════════════════════════════
   16. TOAST NOTIFICATIONS
═══════════════════════════════════════════════════════════════ */
function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText =
      'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
      'z-index:9999;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }

  const colors = {
    success: '#059669',
    error:   '#dc2626',
    info:    '#2563eb'
  };

  const toast = document.createElement('div');
  toast.style.cssText =
    `background:${colors[type] || colors.success};color:#fff;padding:10px 20px;` +
    'border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.2);' +
    'animation:toastIn 0.3s ease;max-width:90vw;text-align:center;pointer-events:auto;';
  toast.textContent = message;
  container.appendChild(toast);

  // Ensure keyframes exist
  if (!document.getElementById('toast-keyframes')) {
    const style = document.createElement('style');
    style.id = 'toast-keyframes';
    style.textContent =
      '@keyframes toastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}' +
      '@keyframes toastOut{from{opacity:1}to{opacity:0;transform:translateY(10px)}}';
    document.head.appendChild(style);
  }

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ═══════════════════════════════════════════════════════════════
   17. DARK MODE
═══════════════════════════════════════════════════════════════ */
function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch {}
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
}

function loadTheme() {
  try {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (!saved && prefersDark)) {
      document.body.classList.add('dark-mode');
      const btn = document.getElementById('theme-toggle');
      if (btn) btn.textContent = '☀️';
    }
  } catch {}
}

/* ═══════════════════════════════════════════════════════════════
   18. LEGAL MAP RENDERING
═══════════════════════════════════════════════════════════════ */
function renderLegalMap() {
  const container = document.getElementById('legal-map-table');
  if (!container) return;

  const rows = [
    { duty: 'ด้านที่ 1: การจัดการเรียนรู้',                         b1: true,  b2: true,  b3: false },
    { duty: 'ด้านที่ 2: สนับสนุนการเรียนรู้',                        b1: true,  b2: false, b3: false },
    { duty: 'ด้านที่ 3: พัฒนาตนเองและวิชาชีพ',                       b1: false, b2: false, b3: true  },
    { duty: 'ด้านที่ 4: PLC ชุมชนการเรียนรู้ทางวิชาชีพ',             b1: false, b2: false, b3: true  },
    { duty: 'หมวด 4 ม.22–28: กระบวนการเรียนรู้',                     b1: true,  b2: true,  b3: false },
    { duty: 'ม.26: วัดและประเมินตามสภาพจริง',                         b1: false, b2: true,  b3: false },
    { duty: 'ม.53: สิทธิพัฒนาทางวิชาชีพ',                           b1: false, b2: false, b3: true  },
    { duty: 'มาตรฐานวิชาชีพ ด้าน 2',                                 b1: true,  b2: true,  b3: false },
    { duty: 'มาตรฐานวิชาชีพ ด้าน 3 จรรยาบรรณ',                       b1: false, b2: false, b3: true  },
  ];

  const check = (val) => val
    ? '<td class="map-check yes" title="ครอบคลุม">✅</td>'
    : '<td class="map-check no"  title="ไม่ครอบคลุม">—</td>';

  const headerColors = ['#059669', '#2563eb', '#d97706'];

  container.innerHTML = `
    <table class="legal-map-tbl">
      <thead>
        <tr>
          <th class="map-duty-col">กฎหมาย / มาตรฐาน</th>
          ${headerColors.map((c, i) => `<th style="color:${c}">เล่ม ${i+1}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="map-duty">${r.duty}</td>
            ${check(r.b1)}
            ${check(r.b2)}
            ${check(r.b3)}
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ═══════════════════════════════════════════════════════════════
   19. TAGS BAR
═══════════════════════════════════════════════════════════════ */
function renderTagsBar() {
  const container = document.getElementById('tags-bar');
  if (!container) return;

  // Count tag frequency
  const freq = {};
  PROMPTS_DATA.forEach(p => {
    (p.tags || []).forEach(t => { freq[t] = (freq[t] || 0) + 1; });
  });

  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag]) => tag);

  container.innerHTML = [
    `<button class="tag-chip ${!state.activeTag ? 'active' : ''}" onclick="filterByTag(null)">ทั้งหมด</button>`,
    ...top.map(t =>
      `<button class="tag-chip ${state.activeTag === t ? 'active' : ''}"
               onclick="filterByTag('${t}')">${t}</button>`
    )
  ].join('');
}

/* ═══════════════════════════════════════════════════════════════
   20. SIDEBAR BOOK TOGGLE
═══════════════════════════════════════════════════════════════ */
function toggleBook(bookNum) {
  const chapters = document.getElementById(`chapters-${bookNum}`);
  const chevron  = document.getElementById(`chevron-${bookNum}`);
  if (!chapters) return;
  const isHidden = chapters.classList.toggle('hidden');
  if (chevron) chevron.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(90deg)';
}

function updateSidebarActive() {
  document.querySelectorAll('.sidebar-book-item').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.book) === state.activeBook);
  });
  document.querySelectorAll('.sidebar-chapter-item').forEach(el => {
    el.classList.toggle('active',
      Number(el.dataset.book) === state.activeBook &&
      Number(el.dataset.chapter) === state.activeChapter
    );
  });
}

/* ═══════════════════════════════════════════════════════════════
   21. DASHBOARD
═══════════════════════════════════════════════════════════════ */
async function loadDashboard() {
  const guestEl = document.getElementById('dashboard-guest');
  const userEl  = document.getElementById('dashboard-user');

  if (!state.user) {
    if (guestEl) guestEl.classList.remove('hidden');
    if (userEl) userEl.classList.add('hidden');
    return;
  }

  if (guestEl) guestEl.classList.add('hidden');
  if (userEl) userEl.classList.remove('hidden');

  // 1. ดึงข้อมูลจาก Supabase copy_events ถ้าล็อกอินและเชื่อมต่ออยู่
  let userEvents = [];

  if (_sb && state.user && state.user.id) {
    try {
      const { data, error } = await _sb
        .from('copy_events')
        .select('prompt_id, book_number, chapter_number, copied_at')
        .eq('user_id', state.user.id)
        .order('copied_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        userEvents = data;
      } else if (error) {
        console.warn('[Supabase] loadDashboard copy_events fetch error:', error);
      }
    } catch (err) {
      console.warn('[Supabase] loadDashboard fetch exception:', err);
    }
  }

  // 2. ดึงข้อมูลจาก LocalStorage (เผื่อออฟไลน์ หรือมีประวัติในเครื่อง)
  const localStats = getCopyStats();
  const histKey = 'ai_prompt_kruthai_copy_history';
  let localHist = [];
  try {
    localHist = JSON.parse(localStorage.getItem(histKey) || '[]');
  } catch (e) {
    console.warn('[LocalStorage] parse copy history error:', e);
  }

  // ถ้าใน Cloud ไม่มีข้อมูล แต่เครื่องมีข้อมูล ให้ใช้ข้อมูลในเครื่อง
  if (userEvents.length === 0 && localHist.length > 0) {
    userEvents = localHist.map(h => ({
      prompt_id: h.id,
      copied_at: h.ts ? new Date(h.ts).toISOString() : new Date().toISOString()
    }));
  }

  // 3. คำนวณสถิติ
  // จำนวน Prompts ที่ Copy แล้ว
  const totalCopies = userEvents.length > 0
    ? userEvents.length
    : Object.values(localStats).reduce((s, v) => s + v, 0);

  // รายการโปรด
  const totalFavs = state.favorites ? state.favorites.size : 0;

  // เล่มที่ใช้ (เล่ม 1, 2, 3)
  const booksSet = new Set();
  if (userEvents.length > 0) {
    userEvents.forEach(e => {
      let b = e.book_number;
      if (!b) {
        const p = PROMPTS_DATA.find(x => x.id === e.prompt_id);
        if (p) b = p.book;
      }
      if (b) booksSet.add(b);
    });
  } else {
    Object.keys(localStats).forEach(id => {
      const p = PROMPTS_DATA.find(x => x.id === id);
      if (p && p.book) booksSet.add(p.book);
    });
  }
  const booksUsedStr = `${booksSet.size}/3`;

  // วันที่ใช้งานต่อเนื่อง (Streak)
  const streakDays = calculateUsageStreak(userEvents.length > 0 ? userEvents : localHist);

  // 4. แสดงผลตัวเลขใน Card สถิติทั้ง 4 ตัว (ตรงตาม ID ใน index.html)
  setDashboardStat('stat-total-copies', totalCopies);
  setDashboardStat('stat-favorites',    totalFavs);
  setDashboardStat('stat-streak',       streakDays > 0 ? `${streakDays} วัน` : '0 วัน');
  setDashboardStat('stat-books',        booksUsedStr);

  // 5. แสดง Prompts ที่ใช้บ่อย (Top 5)
  const promptCountMap = {};
  if (userEvents.length > 0) {
    userEvents.forEach(e => {
      if (e.prompt_id) {
        promptCountMap[e.prompt_id] = (promptCountMap[e.prompt_id] || 0) + 1;
      }
    });
  } else {
    Object.assign(promptCountMap, localStats);
  }

  const top5 = Object.entries(promptCountMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count], idx) => {
      const p = PROMPTS_DATA.find(x => x.id === id);
      return p ? { ...p, count, rank: idx + 1 } : null;
    })
    .filter(Boolean);

  const topListEl = document.getElementById('top-prompts-list');
  if (topListEl) {
    topListEl.innerHTML = top5.length
      ? top5.map(p => `
          <div class="dash-prompt-row book-${p.book}" onclick="openPromptModal('${p.id}')">
            <div class="dash-rank">#${p.rank}</div>
            <div class="dash-prompt-info">
              <div class="dash-prompt-header">
                <span class="card-book-badge book${p.book}">เล่ม ${p.book}</span>
                <span class="dash-prompt-num">Prompt ${p.promptNum}</span>
              </div>
              <div class="dash-prompt-title">${p.title}</div>
            </div>
            <div class="dash-prompt-count-pill">${p.count} ครั้ง</div>
          </div>`).join('')
      : '<div class="empty-text">ยังไม่มีข้อมูล Prompts ที่ใช้บ่อย กดคัดลอก Prompt เพื่อเริ่มต้นสะสมสถิติ</div>';
  }

  // 6. แสดงประวัติการใช้งาน (Recent History)
  const historyListEl = document.getElementById('usage-history');
  if (historyListEl) {
    const recent = userEvents.slice(0, 15);
    historyListEl.innerHTML = recent.length
      ? recent.map(item => {
          const p = PROMPTS_DATA.find(x => x.id === item.prompt_id);
          const timeAgo = formatTimeAgo(item.copied_at || item.ts);
          if (!p) {
            return `
              <div class="dash-history-row">
                <div class="history-main">
                  <div class="history-title">Prompt: ${item.prompt_id}</div>
                </div>
                <div class="history-time">${timeAgo}</div>
              </div>`;
          }
          return `
            <div class="dash-history-row book-${p.book}" onclick="openPromptModal('${p.id}')">
              <span class="dash-history-badge book${p.book}">เล่ม ${p.book}</span>
              <div class="history-main">
                <div class="history-title"><strong>${p.promptNum}</strong> ${p.title}</div>
              </div>
              <div class="history-time">${timeAgo}</div>
            </div>`;
        }).join('')
      : '<div class="empty-text">ยังไม่มีประวัติการใช้งาน</div>';
  }
}

function setDashboardStat(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function calculateUsageStreak(events) {
  if (!events || events.length === 0) return 0;
  const dateStrings = new Set();
  events.forEach(e => {
    const raw = e.copied_at || e.ts;
    if (!raw) return;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      dateStrings.add(`${yyyy}-${mm}-${dd}`);
    }
  });

  if (dateStrings.size === 0) return 0;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yY = yesterday.getFullYear();
  const yM = String(yesterday.getMonth() + 1).padStart(2, '0');
  const yD = String(yesterday.getDate()).padStart(2, '0');
  const yesterdayStr = `${yY}-${yM}-${yD}`;

  let checkDate = null;
  if (dateStrings.has(todayStr)) {
    checkDate = new Date(today);
  } else if (dateStrings.has(yesterdayStr)) {
    checkDate = new Date(yesterday);
  } else {
    return 0; // ไม่ได้ใช้ในวันนี้หรือเมื่อวาน ถือว่า Streak ขาด
  }

  let streak = 0;
  while (true) {
    const cy = checkDate.getFullYear();
    const cm = String(checkDate.getMonth() + 1).padStart(2, '0');
    const cd = String(checkDate.getDate()).padStart(2, '0');
    const key = `${cy}-${cm}-${cd}`;
    if (dateStrings.has(key)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'เมื่อสักครู่';
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  if (diffHr < 24) return `${diffHr} ชั่วโมงที่แล้ว`;
  if (diffDay === 1) return 'เมื่อวานนี้';
  if (diffDay < 7) return `${diffDay} วันที่แล้ว`;

  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear() + 543;
  return `${d}/${m}/${y}`;
}

/* ═══════════════════════════════════════════════════════════════
   22. FAVORITES VIEW
═══════════════════════════════════════════════════════════════ */
function renderFavoritesView() {
  const emptyEl = document.getElementById('fav-empty');
  const gridEl  = document.getElementById('fav-grid');
  const favPrompts = PROMPTS_DATA.filter(p => state.favorites.has(p.id));

  if (favPrompts.length === 0) {
    emptyEl?.classList.remove('hidden');
    if (gridEl) gridEl.innerHTML = '';
  } else {
    emptyEl?.classList.add('hidden');
    renderToGrid(favPrompts, 'fav-grid');
  }
}

function renderToGrid(prompts, gridId) {
  const el = document.getElementById(gridId);
  if (!el) return;
  el.innerHTML = prompts.map(p => buildCardHTML(p)).join('');
}

/* ═══════════════════════════════════════════════════════════════
   23. APP INIT
═══════════════════════════════════════════════════════════════ */
async function init() {
  // 0. Normalize prompts schema for 100% consistency across all 4 books
  if (typeof PROMPTS_DATA !== 'undefined' && Array.isArray(PROMPTS_DATA)) {
    PROMPTS_DATA.forEach(p => {
      if (!p.content && p.prompt) p.content = p.prompt;
      if (!p.prompt && p.content) p.prompt = p.content;
      if (!p.promptNum && p.id) {
        p.promptNum = p.id.replace(/^b(\d+)_(\d+)_(\d+)$/, '$1.$2.$3');
      }
      if (!p.chapter && p.id) {
        const m = p.id.match(/^b(\d+)_(\d+)_(\d+)$/);
        if (m) p.chapter = parseInt(m[2], 10);
      }
      if (!p.book && p.id) {
        const m = p.id.match(/^b(\d+)_(\d+)_(\d+)$/);
        if (m) p.book = parseInt(m[1], 10);
      }
    });
  }

  // 1. Load theme
  loadTheme();

  // 2. Load favorites from localStorage
  try {
    const saved = localStorage.getItem('ai_prompt_kruthai_favs');
    if (saved) JSON.parse(saved).forEach(id => state.favorites.add(id));
  } catch {}

  // 3. Load copy history from localStorage
  try {
    const hist = localStorage.getItem('ai_prompt_kruthai_copy_history');
    if (hist) state.copyHistory = JSON.parse(hist);
  } catch {}

  // 4. Init Supabase
  initSupabase();

  // 5. Check auth state
  if (_sb) {
    _sb.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) await onAuthStateChanged(session.user);
    });

    _sb.auth.onAuthStateChange(async (_event, session) => {
      await onAuthStateChanged(session?.user || null);
    });
  }

  // 6. Initial render
  applySortAndFilter();
  renderTagsBar();
  updateFavCount();

  // 7a. Init access control system
  if (typeof initAccessSystem === 'function') {
    initAccessSystem();
    updateAccessIndicator();
  }

  // 7. Set up event listeners
  setupEventListeners();

  // 8. Check URL hash for deep-link
  if (window.location.hash) {
    const promptId = window.location.hash.slice(1);
    if (PROMPTS_DATA.find(p => p.id === promptId)) {
      setTimeout(() => openPromptModal(promptId), 100);
    }
  } else if (localStorage.getItem('ai_supervisor_guide_dismissed') !== '1') {
    // 9. Onboarding Guide (แสดงคำแนะนำ 3 ขั้นตอนอัตโนมัติสำหรับผู้ใช้ใหม่)
    setTimeout(openGuideModal, 800);
  }

  console.log('[App] Initialised —', PROMPTS_DATA.length, 'prompts loaded');
}

function setupEventListeners() {
  // Desktop search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', e => onSearchInput(e.target.value));
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') clearSearch();
    });
  }

  // Mobile search
  const mobileInput = document.getElementById('mobile-search-input');
  if (mobileInput) {
    mobileInput.addEventListener('input', e => {
      onSearchInput(e.target.value);
      // Sync desktop input
      if (searchInput) searchInput.value = e.target.value;
    });
    mobileInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeMobileSearch();
    });
  }

  // Close modal on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closePromptModalForce();
      closeAuthModal(null, true);
      closeMobileSearch();
    }
  });

  // Close suggestions when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('#search-suggestions') && !e.target.closest('#search-input')) {
      hideSuggestions();
    }
  });

  // Browser back/forward for hash-based deep links
  window.addEventListener('hashchange', () => {
    const promptId = window.location.hash.slice(1);
    if (promptId && PROMPTS_DATA.find(p => p.id === promptId)) {
      openPromptModal(promptId);
    } else {
      closePromptModalForce();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);

/* ═══════════════════════════════════════════════════════════════
   24. MOBILE SEARCH
═══════════════════════════════════════════════════════════════ */
function openMobileSearch() {
  const overlay = document.getElementById('mobile-search-overlay');
  if (overlay) overlay.classList.remove('hidden');
  const input = document.getElementById('mobile-search-input');
  if (input) {
    // Sync value from desktop
    const desktop = document.getElementById('search-input');
    if (desktop) input.value = desktop.value;
    setTimeout(() => input.focus(), 100);
  }
}

function closeMobileSearch() {
  const overlay = document.getElementById('mobile-search-overlay');
  if (overlay) overlay.classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════════════
   25. COPY FROM MODAL
═══════════════════════════════════════════════════════════════ */
async function copyPromptFromModal() {
  if (!state.currentPrompt) return;

  await copyPrompt(state.currentPrompt.id);

  const btn = document.getElementById('modal-copy-btn');
  if (btn) {
    const original = btn.textContent;
    btn.textContent = '✅ คัดลอกแล้ว!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied');
    }, 2000);
  }
}

/* ═══════════════════════════════════════════════════════════════
   26. HELPER FUNCTIONS
═══════════════════════════════════════════════════════════════ */

/**
 * Truncate text to maxLen characters, appending '...' if truncated.
 */
function truncate(text, maxLen) {
  if (!text) return '';
  return text.length <= maxLen ? text : text.slice(0, maxLen) + '…';
}

/**
 * Wrap query matches in <mark> tags.
 * Returns original text if query is empty.
 */
function highlightText(text, query) {
  if (!query || !text) return text || '';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex   = new RegExp(`(${escaped})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

/**
 * Update the favorites count badge in the navigation.
 */
function updateFavCount() {
  const count = state.favorites.size;
  document.querySelectorAll('#fav-count, .fav-count-badge').forEach(el => {
    el.textContent = count > 0 ? count : '';
    el.classList.toggle('hidden', count === 0);
  });
}

/**
 * Switch between grid and list view.
 * @param {'grid'|'list'} mode
 */
function setView(mode) {
  state.viewMode = mode;
  const grid = document.getElementById('prompts-grid');
  if (grid) grid.classList.toggle('list-view', mode === 'list');

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
}

/**
 * Update the active state on both top nav and bottom nav items.
 * (Also called internally by navigateTo.)
 */
function updateNavActive(view) {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === view);
  });
  document.querySelectorAll('[data-bottom-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.bottomNav === view);
  });
}

/* ═══════════════════════════════════════════════════════════════
   QUICK GUIDE / ONBOARDING MODAL FUNCTIONS
═══════════════════════════════════════════════════════════════ */
function openGuideModal() {
  const overlay = document.getElementById('guide-modal-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    const chk = document.getElementById('guide-dont-show-again');
    if (chk) {
      chk.checked = localStorage.getItem('ai_supervisor_guide_dismissed') === '1';
    }
  }
}

function closeGuideModal(event) {
  if (event && event.target !== document.getElementById('guide-modal-overlay') && !event.target.classList.contains('modal-close') && !event.target.classList.contains('btn-secondary')) return;
  const overlay = document.getElementById('guide-modal-overlay');
  const chk = document.getElementById('guide-dont-show-again');
  if (chk && chk.checked) {
    localStorage.setItem('ai_supervisor_guide_dismissed', '1');
  } else {
    localStorage.removeItem('ai_supervisor_guide_dismissed');
  }
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
  }
}

async function copyMasterContextPrompt(btnEl) {
  await copyPrompt('b1_1_1');
  if (btnEl) {
    const originalText = btnEl.textContent;
    btnEl.textContent = '✅ คัดลอกสำเร็จ!';
    btnEl.classList.add('copied');
    setTimeout(() => {
      btnEl.textContent = originalText;
      btnEl.classList.remove('copied');
    }, 2000);
  }
}

async function copyPromptAndCloseGuide() {
  const chk = document.getElementById('guide-dont-show-again');
  if (chk && chk.checked) {
    localStorage.setItem('ai_supervisor_guide_dismissed', '1');
  }
  await copyPrompt('b1_1_1');
  const overlay = document.getElementById('guide-modal-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
  }
}

function openPrompt11Details() {
  const overlay = document.getElementById('guide-modal-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
  }
  openPromptModal('b1_1_1');
}

// Expose globally on window
window.openPromptModal = openPromptModal;
window.closeModal = closeModal;
window.closePromptModal = closePromptModal;
window.closePromptModalForce = closePromptModalForce;
window.copyModalPrompt = copyModalPrompt;
window.copyPromptFromModal = copyModalPrompt;
window.toggleModalFav = toggleModalFav;
window.shareCurrentPrompt = shareCurrentPrompt;
window.openInLLM = openInLLM;
window.copyPrompt = copyPrompt;
window.toggleFavorite = toggleFavorite;
window.navigateTo = navigateTo;
window.filterByBook = filterByBook;
window.filterByChapter = filterByChapter;
window.filterBySituation = filterBySituation;
window.filterMaster = filterMaster;
window.toggleBook = toggleBook;
window.setSortMode = setSortMode;
window.applySortAndFilter = applySortAndFilter;
window.setView = setView;
window.goToPage = goToPage;
window.openGuideModal = openGuideModal;
window.closeGuideModal = closeGuideModal;
window.copyMasterContextPrompt = copyMasterContextPrompt;
window.copyPromptAndCloseGuide = copyPromptAndCloseGuide;
window.openPrompt11Details = openPrompt11Details;


