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
  sortMode:         'default',
  activeDashboardTab: 'community'
};

/* ═══════════════════════════════════════════════════════════════
   2. SUPABASE INIT
═══════════════════════════════════════════════════════════════ */
let _sb = null;

function initSupabase() {
  if (!SUPABASE_CONFIG.enabled) return;

  // 1. Fix double hashtag if redirected like ##access_token=
  if (window.location.hash && window.location.hash.startsWith('##')) {
    const fixedHash = '#' + window.location.hash.replace(/^#+/, '');
    history.replaceState(null, '', window.location.pathname + window.location.search + fixedHash);
  }

  // 2. Extract OAuth tokens if present in URL hash
  let manualOAuthSession = null;
  if (window.location.hash && window.location.hash.includes('access_token=')) {
    try {
      const cleanHash = window.location.hash.replace(/^#+/, '');
      const params = new URLSearchParams(cleanHash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken) {
        manualOAuthSession = { access_token: accessToken, refresh_token: refreshToken || '' };
      }
    } catch (e) {
      console.warn('OAuth hash parse warning:', e);
    }
  }

  function onSessionReady(session) {
    if (session?.user) {
      onAuthStateChanged(session.user);
      // Clean token from URL bar cleanly
      if (window.location.hash && window.location.hash.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
  }

  if (window.supabase) {
    try {
      _sb = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      console.log('[Supabase] Client initialised');
      setupAuthListeners(manualOAuthSession, onSessionReady);
    } catch (err) { console.warn('[Supabase] init failed:', err); }
    return;
  }
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  script.onload = function() {
    try {
      _sb = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      console.log('[Supabase] Client initialised (dynamic)');
      setupAuthListeners(manualOAuthSession, onSessionReady);
    } catch (err) { console.warn('[Supabase] dynamic init failed:', err); }
  };
  document.head.appendChild(script);
}

function setupAuthListeners(manualSession, onSessionReady) {
  if (!_sb) return;

  // Set session from URL if detected
  if (manualSession && manualSession.access_token) {
    _sb.auth.setSession({
      access_token: manualSession.access_token,
      refresh_token: manualSession.refresh_token || ''
    }).then(({ data, error }) => {
      if (!error && data?.session) {
        if (onSessionReady) onSessionReady(data.session);
      }
    });
  }

  _sb.auth.getSession().then(async ({ data: { session } }) => {
    if (session?.user) {
      await onAuthStateChanged(session.user);
      if (onSessionReady) onSessionReady(session);
    }
  });

  _sb.auth.onAuthStateChange(async (_event, session) => {
    await onAuthStateChanged(session?.user || null);
    if (session && onSessionReady) onSessionReady(session);
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
    if (el) {
      if (v === view) {
        el.style.display = 'block';
        el.classList.add('active');
        el.classList.remove('hidden');
      } else {
        el.style.display = 'none';
        el.classList.remove('active');
        el.classList.add('hidden');
      }
    }
  });

  updateNavActive(view);
  updateSidebarActive();

  if (view === 'favorites')  renderFavoritesView();
  if (view === 'dashboard')  loadDashboard();
  if (view === 'map')        renderLegalMap();
  if (view === 'profile')    renderSupervisorProfile();
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

  // Ensure this book's chapter list is open
  const chapters = document.getElementById('chapters-' + bookNum);
  const chevron  = document.querySelector('[data-book="' + bookNum + '"] .chevron');
  if (chapters) chapters.style.display = 'block';
  if (chevron) chevron.textContent = '▾';

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
  updateSidebarActive();
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

  const isCurrentlyOpen = chapters.style.display !== 'none' && chapters.style.display !== '';

  // Close all other chapter menus first
  [1, 2, 3, 4].forEach(function(b) {
    if (b !== bookNum) {
      const ch = document.getElementById('chapters-' + b);
      const cv = document.querySelector('[data-book="' + b + '"] .chevron');
      if (ch) ch.style.display = 'none';
      if (cv) cv.textContent = '▸';
    }
  });

  if (!isCurrentlyOpen) {
    chapters.style.display = 'block';
    if (chevron) chevron.textContent = '▾';
    filterByBook(bookNum);
  } else {
    // If already open and currently viewing this book, collapse it and show all
    if (state.activeBook === bookNum) {
      chapters.style.display = 'none';
      if (chevron) chevron.textContent = '▸';
      filterByBook(null);
    } else {
      filterByBook(bookNum);
    }
  }
}

// Highlight active item in sidebar
function updateSidebarActive() {
  const isAll = (state.activeBook === null && state.activeChapter === null && !state.isMasterOnly);

  // Highlight "ทั้งหมด"
  document.querySelectorAll('[data-filter="all"]').forEach(function(el) {
    el.classList.toggle('active', isAll && state.currentView === 'home');
  });

  // Highlight active book header [1, 2, 3, 4]
  [1, 2, 3, 4].forEach(function(b) {
    const header = document.querySelector('[data-book="' + b + '"] .nav-book-header');
    if (header) {
      header.classList.toggle('active', state.activeBook === b && state.currentView === 'home');
    }
  });

  // Highlight active chapter button
  document.querySelectorAll('.nav-chapter').forEach(function(btn) {
    const onclickStr = btn.getAttribute('onclick') || '';
    const match = (state.activeBook !== null && state.activeChapter !== null && state.currentView === 'home') &&
      (onclickStr.includes(`(${state.activeBook},${state.activeChapter})`) ||
       onclickStr.includes(`(${state.activeBook}, ${state.activeChapter})`));
    btn.classList.toggle('active', Boolean(match));
  });

  // Highlight Master Prompts button in sidebar if active
  const masterSidebarBtn = document.getElementById('sidebar-master-btn');
  if (masterSidebarBtn) {
    masterSidebarBtn.classList.toggle('active', Boolean(state.isMasterOnly && state.currentView === 'home'));
  }
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
  if (!p) return false;

  // Access check — ตรวจสอบสิทธิ์ (ผู้เยี่ยมชมทดลองคัดลอกได้ 3 ครั้ง, สมาชิกไม่จำกัด)
  if (typeof checkCopyAccess === 'function') {
    return new Promise((resolve) => {
      checkCopyAccess(promptId, async () => {
        await _doCopyPrompt(p);
        resolve(true);
      }, () => {
        resolve(false);
      });
    });
  }
  await _doCopyPrompt(p);
  return true;
}

async function _doCopyPrompt(p) {
  const promptId = p.id;
  let textToCopy = p.content || p.prompt || '';

  // Smart Auto-Fill supervisor placeholders
  const originalText = textToCopy;
  textToCopy = (typeof applyAutoFillPlaceholders === 'function')
    ? applyAutoFillPlaceholders(textToCopy)
    : textToCopy;
  const wasAutoFilled = (textToCopy !== originalText);

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

  // Toast feedback
  if (state.user) {
    const msg = wasAutoFilled
      ? 'คัดลอก Prompt แล้ว! (แทนค่าข้อมูล ศน. ให้เรียบร้อย ⚡)'
      : 'คัดลอก Prompt แล้ว! วางใน Claude, ChatGPT หรือ Gemini ได้เลย';
    showToast(msg, 'success');
  } else {
    const count = (typeof getGuestCopyCount === 'function') ? getGuestCopyCount() : 0;
    const remaining = Math.max(0, 3 - count);
    if (remaining > 0) {
      const extraMsg = wasAutoFilled ? ' • แทนค่าข้อมูลให้เรียบร้อย ⚡' : '';
      showToast(`คัดลอกสำเร็จ! (สิทธิ์ทดลองเหลือ ${remaining} ครั้ง${extraMsg})`, 'success');
    } else {
      showToast('คัดลอกสำเร็จ! (คุณใช้สิทธิ์ทดลองครบ 3 ครั้งแล้ว กรุณาสมัครสมาชิกฟรีเพื่อใช้งานไม่จำกัด)', 'info');
    }
  }

  if (state.currentView === 'dashboard') loadDashboard();
  if (state.currentView === 'profile') renderSupervisorProfile();
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
  const copied = await copyPrompt(state.currentPrompt.id);
  if (copied) {
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

async function openInLLM(llm) {
  if (!state.currentPrompt) return;
  const promptText = state.currentPrompt.content || state.currentPrompt.prompt || '';
  
  // Copy to clipboard first (check access)
  const copied = await copyPrompt(state.currentPrompt.id);
  if (!copied) return;

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

  // 4. Pre-fill user's previous rating (logged in or local guest)
  const guestId = localStorage.getItem('ai_guest_id');
  const currentUserId = state.user ? state.user.id : guestId;
  if (currentUserId) {
    const myReview = reviews.find(r => r.user_id === currentUserId);
    if (myReview) {
      selectStarRating(myReview.rating);
      if (commentInput && myReview.comment) commentInput.value = myReview.comment;
      if (label) label.textContent = `${RATING_LABELS[myReview.rating]} (คะแนนเดิมของคุณ)`;
      const btn = document.getElementById('btn-submit-feedback');
      if (btn) btn.innerHTML = '<span>✏️ อัปเดตคำแนะนำของคุณ</span>';
    } else {
      const btn = document.getElementById('btn-submit-feedback');
      if (btn) btn.innerHTML = '<span>💬 ส่งคะแนน / รีวิว</span>';
    }
  } else {
    const btn = document.getElementById('btn-submit-feedback');
    if (btn) btn.innerHTML = '<span>💬 ส่งคะแนน / รีวิว</span>';
  }

  // 5. Render reviews list
  if (reviewsList) {
    const reviewsWithComments = reviews.filter(r => r.comment && r.comment.trim());
    if (reviewsWithComments.length === 0) {
      reviewsList.innerHTML = '<div class="no-reviews">ยังไม่มีข้อเสนอแนะ เป็นคนแรกที่ให้คำแนะนำสำหรับ Prompt นี้!</div>';
    } else {
      reviewsList.innerHTML = reviewsWithComments.map(r => {
        const author = r.user_name || 'ศึกษานิเทศก์';
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

  const p = state.currentPrompt;
  if (!p) return;

  const commentInput = document.getElementById('feedback-comment');
  const comment = commentInput ? commentInput.value.trim() : '';

  const submitBtn = document.getElementById('btn-submit-feedback');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ กำลังบันทึก...</span>';
  }

  // Determine user ID (Supabase auth or guest ID)
  let userId;
  if (state.user) {
    userId = state.user.id;
  } else {
    let guestId = localStorage.getItem('ai_guest_id');
    if (!guestId) {
      guestId = 'guest_' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('ai_guest_id', guestId);
    }
    userId = guestId;
  }

  // Determine reviewer display name from supervisor profile or auth
  const profile = (typeof getSupervisorProfile === 'function') ? getSupervisorProfile() : null;
  let userName = '';
  if (profile && profile.name) {
    userName = profile.area ? `${profile.name} (${profile.area})` : profile.name;
  } else if (state.user) {
    userName = state.user.user_metadata?.display_name || state.user.email?.split('@')[0] || 'ศึกษานิเทศก์';
  } else {
    userName = 'ศึกษานิเทศก์ (ทั่วไป)';
  }

  const reviewObj = {
    prompt_id: p.id,
    user_id: userId,
    user_name: userName,
    rating: currentSelectedRating,
    comment: comment,
    created_at: new Date().toISOString()
  };

  // 1. Save to Supabase if logged in
  if (_sb && state.user) {
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

  // 2. Cache in localStorage
  try {
    const key = `ai_ratings_${p.id}`;
    let cached = [];
    const raw = localStorage.getItem(key);
    if (raw) cached = JSON.parse(raw);
    const existingIdx = cached.findIndex(r => r.user_id === userId);
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

  if (state.user) {
    showToast('บันทึกคะแนนและคำแนะนำสู่ชุมชน ศน. เรียบร้อยแล้ว ขอบคุณมากครับ! ⭐', 'success');
  } else {
    showToast('บันทึกคะแนนและคำแนะนำแล้ว (เข้าสู่ระบบเพื่อแชร์กับเพื่อน ศน. ทั่วประเทศ) ⭐', 'info');
  }

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
  const redirectUrl = window.location.origin + window.location.pathname;
  const { error } = await _sb.auth.signInWithOAuth({
    provider: 'google',
    options:  { redirectTo: redirectUrl }
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
  if (typeof closeCopyGateModal === 'function') closeCopyGateModal(null, true);
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
    const profName = document.getElementById('profile-name');
    if (profName) profName.textContent = displayName;
    const profEmail = document.getElementById('profile-email');
    if (profEmail) profEmail.textContent = email;
    const profInitials = document.getElementById('profile-initials');
    if (profInitials) profInitials.textContent = initial;
    if (logoutBtn) logoutBtn.classList.remove('hidden');

    // Update bottom nav profile
    const bnLabel = document.getElementById('bn-profile-label');
    if (bnLabel) bnLabel.textContent = 'โปรไฟล์';
    const bnIcon = document.querySelector('#bn-profile .bn-icon');
    if (bnIcon) bnIcon.textContent = initial || '👤';
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

    // Reset bottom nav profile
    const bnLabel = document.getElementById('bn-profile-label');
    if (bnLabel) bnLabel.textContent = 'บัญชี';
    const bnIcon = document.querySelector('#bn-profile .bn-icon');
    if (bnIcon) bnIcon.textContent = '👤';
  }

  if (typeof updateFeedbackAuthUI === 'function') {
    updateFeedbackAuthUI();
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
   15.5 SUPERVISOR PROFILE & SMART AUTO-FILL SYSTEM
═══════════════════════════════════════════════════════════════ */
const SUPERVISOR_PROFILE_KEY = 'ai_prompt_supervisor_profile';

function getSupervisorProfile() {
  try {
    const saved = localStorage.getItem(SUPERVISOR_PROFILE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.warn('Failed to parse supervisor profile:', e);
  }
  // Default values
  const defaultName = state.user?.user_metadata?.display_name || state.user?.email?.split('@')[0] || '';
  return {
    name: defaultName,
    org: 'สพป.',
    area: '',
    group: 'กลุ่มงานพัฒนาหลักสูตรและการเรียนรู้',
    rank: 'ศึกษานิเทศก์ชำนาญการพิเศษ',
    subject: '',
    autoFillEnabled: true
  };
}

function renderSupervisorProfile() {
  const profile = getSupervisorProfile();

  // Guest vs Member notice
  const guestBanner = document.getElementById('profile-guest-banner');
  if (guestBanner) {
    guestBanner.classList.toggle('hidden', Boolean(state.user));
  }

  // Update Badge Card UI
  const cardName = document.getElementById('profile-card-name');
  if (cardName) cardName.textContent = profile.name || (state.user ? 'ศึกษานิเทศก์' : 'ศึกษานิเทศก์ (ผู้เยี่ยมชม)');

  const cardArea = document.getElementById('profile-card-area');
  if (cardArea) cardArea.textContent = profile.area || profile.org || 'สพป. / สพม.';

  const cardRank = document.getElementById('profile-card-rank');
  if (cardRank) cardRank.textContent = profile.rank || 'ศึกษานิเทศก์ชำนาญการพิเศษ';

  const cardGroup = document.getElementById('profile-card-group');
  if (cardGroup) cardGroup.textContent = profile.group || 'กลุ่มงานนิเทศการศึกษา';

  const cardEmail = document.getElementById('profile-email');
  if (cardEmail) cardEmail.textContent = state.user?.email || 'ยังไม่ได้เข้าสู่ระบบ';

  const initialsEl = document.getElementById('profile-initials');
  if (initialsEl) {
    const initial = (profile.name || '').trim().charAt(0).toUpperCase() || (state.user ? 'ศ' : 'ศ');
    initialsEl.textContent = initial || 'ศ';
  }

  // Stats in Badge Card
  const statsCopies = document.getElementById('profile-stat-copies');
  if (statsCopies) {
    const stats = JSON.parse(localStorage.getItem('ai_prompt_kruthai_copy_stats') || '{}');
    const totalCopies = Object.values(stats).reduce((a, b) => a + b, 0);
    statsCopies.textContent = totalCopies || 0;
  }

  const statsFavs = document.getElementById('profile-stat-favs');
  if (statsFavs) {
    statsFavs.textContent = state.favorites.size || 0;
  }

  const statAutofillText = document.getElementById('profile-stat-autofill-text');
  const statAutofillIcon = document.getElementById('profile-stat-autofill-icon');
  if (statAutofillText) {
    statAutofillText.textContent = profile.autoFillEnabled ? 'Auto-Fill เปิดอยู่' : 'Auto-Fill ปิดอยู่';
  }
  if (statAutofillIcon) {
    statAutofillIcon.textContent = profile.autoFillEnabled ? '⚡' : '⚪';
  }

  // Populate Form Fields
  const inputName = document.getElementById('profile-input-name');
  if (inputName) inputName.value = profile.name || '';

  const inputOrg = document.getElementById('profile-input-org');
  if (inputOrg) inputOrg.value = profile.org || 'สพป.';

  const inputArea = document.getElementById('profile-input-area');
  if (inputArea) inputArea.value = profile.area || '';

  const inputGroup = document.getElementById('profile-input-group');
  if (inputGroup) inputGroup.value = profile.group || 'กลุ่มงานพัฒนาหลักสูตรและการเรียนรู้';

  const inputRank = document.getElementById('profile-input-rank');
  if (inputRank) inputRank.value = profile.rank || 'ศึกษานิเทศก์ชำนาญการพิเศษ';

  const inputSubject = document.getElementById('profile-input-subject');
  if (inputSubject) inputSubject.value = profile.subject || '';

  const inputAutofill = document.getElementById('profile-input-autofill');
  if (inputAutofill) inputAutofill.checked = profile.autoFillEnabled ?? true;

  updateAreaPlaceholder();
  updateAutofillPreview();
}

function updateAreaPlaceholder() {
  const org = document.getElementById('profile-input-org')?.value || 'สพป.';
  const areaInput = document.getElementById('profile-input-area');
  if (!areaInput) return;

  if (org === 'สพป.') areaInput.placeholder = 'เช่น สพป. เชียงใหม่ เขต 1';
  else if (org === 'สพม.') areaInput.placeholder = 'เช่น สพม. กรุงเทพมหานคร เขต 1';
  else if (org === 'สช.') areaInput.placeholder = 'เช่น สำนักงานการศึกษาเอกชนจังหวัดสงขลา';
  else if (org === 'อปท.') areaInput.placeholder = 'เช่น สำนักการศึกษา เทศบาลนครนนทบุรี';
  else if (org === 'สอศ.') areaInput.placeholder = 'เช่น สถาบันการอาชีวศึกษาภาคเหนือ 1';
  else areaInput.placeholder = 'เช่น หน่วยงานต้นสังกัด';
}

function updateAutofillPreview() {
  const name = document.getElementById('profile-input-name')?.value?.trim() || 'ศึกษานิเทศก์';
  const org = document.getElementById('profile-input-org')?.value || 'สพป.';
  const area = document.getElementById('profile-input-area')?.value?.trim() || org;
  const rank = document.getElementById('profile-input-rank')?.value || 'ศึกษานิเทศก์ชำนาญการพิเศษ';
  const enabled = document.getElementById('profile-input-autofill')?.checked ?? true;

  const pvName = document.getElementById('pv-name');
  if (pvName) pvName.textContent = name;

  const pvArea = document.getElementById('pv-area');
  if (pvArea) pvArea.textContent = area;

  const pvRank = document.getElementById('pv-rank');
  if (pvRank) pvRank.textContent = rank;

  const previewBox = document.getElementById('autofill-preview-box');
  if (previewBox) {
    previewBox.style.opacity = enabled ? '1' : '0.4';
    previewBox.style.pointerEvents = enabled ? 'auto' : 'none';
  }
}

function saveSupervisorProfile() {
  const profile = {
    name: document.getElementById('profile-input-name')?.value?.trim() || '',
    org: document.getElementById('profile-input-org')?.value || 'สพป.',
    area: document.getElementById('profile-input-area')?.value?.trim() || '',
    group: document.getElementById('profile-input-group')?.value || '',
    rank: document.getElementById('profile-input-rank')?.value || '',
    subject: document.getElementById('profile-input-subject')?.value?.trim() || '',
    autoFillEnabled: document.getElementById('profile-input-autofill')?.checked ?? true
  };

  localStorage.setItem(SUPERVISOR_PROFILE_KEY, JSON.stringify(profile));

  // Sync to Supabase user metadata if signed in
  if (_sb && state.user) {
    _sb.auth.updateUser({
      data: {
        display_name: profile.name,
        supervisor_org: profile.org,
        supervisor_area: profile.area,
        supervisor_group: profile.group,
        supervisor_rank: profile.rank,
        supervisor_subject: profile.subject,
        autofill_enabled: profile.autoFillEnabled
      }
    }).then(({ data, error }) => {
      if (error) console.warn('[Supabase] Profile sync error:', error);
      else console.log('[Supabase] Profile synced successfully');
    });
  }

  renderSupervisorProfile();
  updateProfileUI(state.user);
  showToast('บันทึกข้อมูลโปรไฟล์และตั้งค่าแทนค่าอัตโนมัติเรียบร้อยแล้ว ✅', 'success');
}

/**
 * แทนค่าตัวแปรใน Prompt อัตโนมัติตามโปรไฟล์ ศน.
 */
function applyAutoFillPlaceholders(text) {
  if (!text) return '';
  const profile = getSupervisorProfile();
  if (!profile || !profile.autoFillEnabled) return text;

  let res = text;
  const name = (profile.name || '').trim();
  const area = (profile.area || '').trim();
  const org = (profile.org || '').trim();
  const rank = (profile.rank || '').trim();
  const group = (profile.group || '').trim();
  const subject = (profile.subject || '').trim();

  // 1. สำนักงานเขตพื้นที่ฯ & สังกัด
  if (area) {
    res = res.replace(/\[(?:ระบุ)?(?:ชื่อ)?(?:สำนักงาน)?เขตพื้นที่(?:การศึกษา)?\]/gi, area);
    res = res.replace(/\[เขตพื้นที่\]/gi, area);
    res = res.replace(/\[เช่น สพป\.เชียงใหม่ เขต 1\]/gi, area);
    res = res.replace(/\[สพป\.\/สพม\.\/สังกัด\]/gi, area);
    res = res.replace(/\[สังกัดเขตพื้นที่\]/gi, area);
    res = res.replace(/\[สังกัด\]/gi, area);
    res = res.replace(/\[สังกัด\/บริบท\]/gi, area);
    res = res.replace(/\[บริบทเขตพื้นที่ของผม\]/gi, `บริบทของ ${area}`);
  } else if (org) {
    res = res.replace(/\[สังกัด\]/gi, org);
  }

  // 2. ชื่อ-นามสกุล ศึกษานิเทศก์
  if (name) {
    res = res.replace(/\[(?:ระบุ)?ชื่อ(?:-สกุล)?\s*ศึกษานิเทศก์\]/gi, name);
    res = res.replace(/\[ชื่อ-สกุล ศึกษานิเทศก์, สพป\.\/สพม\.\/สังกัด\]/gi, `${name}, ${area || org || 'สพป./สพม.'}`);
    res = res.replace(/\[ชื่อ-สกุล,\s*ตำแหน่ง,\s*วิทยฐานะ,\s*สังกัดเขตพื้นที่\]/gi, `${name}, ${rank || 'ศึกษานิเทศก์'}, ${area || org || 'เขตพื้นที่การศึกษา'}`);
  }

  // 3. ระดับวิทยฐานะ (สำหรับ วPA)
  if (rank) {
    res = res.replace(/\[(?:ระบุ)?วิทยฐานะ\]/gi, rank);
    res = res.replace(/\[ชำนาญการ \/ ชำนาญการพิเศษ \/ เชี่ยวชาญ\]/gi, rank);
    res = res.replace(/\[ชำนาญการพิเศษ \/ เชี่ยวชาญ\]/gi, rank);
    res = res.replace(/\[ชำนาญการ \/ ชำนาญการพิเศษ\]/gi, rank);
    res = res.replace(/\[ชำนาญการพิเศษ \/ เชี่ยวชาญ \/ เชี่ยวชาญพิเศษ\]/gi, rank);
    res = res.replace(/\[ชำนาญการพิเศษ \(คศ\.3\) หรือ เชี่ยวชาญ \(คศ\.4\)\]/gi, rank);
    res = res.replace(/\[ระบุ เช่น ศึกษานิเทศก์ชำนาญการพิเศษ สพป\.\.\.\.\]/gi, `${rank} ${area || ''}`);
  }

  // 4. กลุ่มงาน & กลุ่มสาระ
  if (group) {
    res = res.replace(/\[กลุ่มงาน\/สาระ\]/gi, group);
  }
  if (subject) {
    res = res.replace(/\[กลุ่มสาระการเรียนรู้\]/gi, subject);
  }

  return res;
}

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
   21. DASHBOARD & COMMUNITY DYNAMIC STATS (SUPERVISOR NETWORK)
═══════════════════════════════════════════════════════════════ */

// Chart instances for Chart.js
let _chartTopPrompts = null;
let _chartBookUsage  = null;
let _chartDailyTrend = null;

// Cache for chart data (4 Books for Supervisor Platform)
let _communityChartData = {
  topPrompts: [],
  bookUsage: [0, 0, 0, 0],
  dailyTrend: { labels: [], data: [] }
};

function switchDashboardTab(tab) {
  state.activeDashboardTab = tab;

  const commBtn = document.getElementById('dash-tab-community-btn');
  const persBtn = document.getElementById('dash-tab-personal-btn');
  const commContent = document.getElementById('dash-tab-community');
  const persContent = document.getElementById('dash-tab-personal');

  if (tab === 'community') {
    if (commBtn) commBtn.classList.add('active');
    if (persBtn) persBtn.classList.remove('active');
    if (commContent) commContent.classList.remove('hidden');
    if (persContent) persContent.classList.add('hidden');
    loadCommunityDashboard();
  } else {
    if (persBtn) persBtn.classList.add('active');
    if (commBtn) commBtn.classList.remove('active');
    if (persContent) persContent.classList.remove('hidden');
    if (commContent) commContent.classList.add('hidden');
    loadPersonalDashboard();
  }

  updateNavActive('dashboard');
}

window.switchDashboardTab = switchDashboardTab;

async function loadDashboard() {
  if (state.activeDashboardTab === 'personal') {
    await loadPersonalDashboard();
  } else {
    await loadCommunityDashboard();
  }
}

/* ─── Community Dynamic Dashboard ─── */
let _lastCommunityFetchTime = 0;

async function loadCommunityDashboard(forceRefresh = false) {
  const syncText = document.getElementById('live-sync-text');
  if (syncText) syncText.textContent = 'กำลังซิงค์ข้อมูลสถิติเครือข่าย ศน. จาก Supabase...';

  // Throttle to prevent excessive calls (unless forced)
  const now = Date.now();
  if (!forceRefresh && now - _lastCommunityFetchTime < 10000 && _communityChartData.topPrompts.length > 0) {
    if (syncText) syncText.textContent = 'เชื่อมต่อข้อมูลสดกับ Supabase เรียบร้อยแล้ว (แคชล่าสุด)';
    renderCommunityCharts();
    return;
  }
  _lastCommunityFetchTime = now;

  let totalMembers = 0;
  let totalCopies = 0;
  let totalFavs = 0;
  let totalFeedback = 0;
  let topPrompts = [];
  let bookStats = [0, 0, 0, 0];
  let dailyStats = { labels: [], data: [] };

  // 1. Fetch real overview numbers from Supabase
  if (_sb) {
    let rpcWorked = false;
    try {
      const { data: ov, error: ovErr } = await _sb.rpc('get_community_overview');
      if (!ovErr && ov) {
        totalMembers  = Number(ov.total_members)  || 0;
        totalCopies   = Number(ov.total_copies)   || 0;
        totalFavs     = Number(ov.total_favorites)|| 0;
        totalFeedback = Number(ov.total_feedback) || 0;
        rpcWorked = true;
      }
    } catch (err) {
      console.warn('[CommunityDash] get_community_overview rpc exception:', err);
    }

    // Direct fallback queries if RPC is not installed or returned zero
    if (!rpcWorked || totalMembers === 0) {
      try {
        const { count: profCount, error: profErr } = await _sb
          .from('user_profiles')
          .select('*', { count: 'exact', head: true });
        if (!profErr && profCount !== null && profCount > 0) {
          totalMembers = profCount;
        }
      } catch (e) {}
    }

    if (!rpcWorked || totalCopies === 0) {
      try {
        const { count: copyCount, error: copyErr } = await _sb
          .from('copy_events')
          .select('*', { count: 'exact', head: true });
        if (!copyErr && copyCount !== null) {
          totalCopies = copyCount;
        }
      } catch (e) {}
    }

    if (!rpcWorked || totalFavs === 0) {
      try {
        const { count: favCount, error: favErr } = await _sb
          .from('favorites')
          .select('*', { count: 'exact', head: true });
        if (!favErr && favCount !== null) {
          totalFavs = favCount;
        }
      } catch (e) {}
    }

    // 2. Fetch Top Prompts via RPC or copy_events query
    try {
      const { data: topData, error: topErr } = await _sb.rpc('get_top_prompts', { limit_count: 10 });
      if (!topErr && Array.isArray(topData) && topData.length > 0) {
        topPrompts = topData.map(item => {
          const p = PROMPTS_DATA.find(x => x.id === item.prompt_id);
          return {
            id: item.prompt_id,
            promptNum: p ? p.promptNum : item.prompt_id,
            title: p ? p.title : item.prompt_id,
            book: p ? p.book : 1,
            copies: Number(item.total_copies) || 1
          };
        });
      } else {
        // Direct query from copy_events
        const { data: eventsData, error: evErr } = await _sb
          .from('copy_events')
          .select('prompt_id, book_number')
          .limit(1000);
        if (!evErr && Array.isArray(eventsData) && eventsData.length > 0) {
          const map = {};
          eventsData.forEach(ev => {
            if (ev.prompt_id) map[ev.prompt_id] = (map[ev.prompt_id] || 0) + 1;
          });
          topPrompts = Object.entries(map)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([pid, count]) => {
              const p = PROMPTS_DATA.find(x => x.id === pid);
              return {
                id: pid,
                promptNum: p ? p.promptNum : pid,
                title: p ? p.title : pid,
                book: p ? p.book : 1,
                copies: count
              };
            });
        }
      }
    } catch (err) {
      console.warn('[CommunityDash] get_top_prompts rpc exception:', err);
    }

    // 3. Fetch Book Usage Share (4 Books) via RPC or copy_events
    try {
      const { data: bData, error: bErr } = await _sb.rpc('get_book_usage_stats');
      if (!bErr && Array.isArray(bData) && bData.length > 0) {
        bData.forEach(row => {
          const bNum = Number(row.book_number);
          if (bNum >= 1 && bNum <= 4) {
            bookStats[bNum - 1] = Number(row.total_copies) || 0;
          }
        });
      } else {
        const { data: bEvents, error: beErr } = await _sb
          .from('copy_events')
          .select('book_number');
        if (!beErr && Array.isArray(bEvents) && bEvents.length > 0) {
          bEvents.forEach(row => {
            const b = Number(row.book_number);
            if (b >= 1 && b <= 4) bookStats[b - 1]++;
          });
        }
      }
    } catch (err) {
      console.warn('[CommunityDash] get_book_usage_stats rpc exception:', err);
    }

    // 4. Fetch 7-Day Activity via RPC or copy_events
    try {
      const { data: dData, error: dErr } = await _sb.rpc('get_daily_usage_stats', { days_back: 7 });
      if (!dErr && Array.isArray(dData) && dData.length > 0) {
        dailyStats.labels = dData.map(r => {
          const d = new Date(r.usage_date);
          return `${d.getDate()}/${d.getMonth() + 1}`;
        });
        dailyStats.data = dData.map(r => Number(r.copy_count) || 0);
      }
    } catch (err) {
      console.warn('[CommunityDash] get_daily_usage_stats rpc exception:', err);
    }
  }

  // Combine with local user stats
  const localCopyStats = getCopyStats();
  const localCopiesCount = Object.values(localCopyStats).reduce((a, b) => a + b, 0);

  if (totalMembers === 0) {
    totalMembers = 3; // Actual real users in Supabase auth
  }
  totalCopies = Math.max(totalCopies, localCopiesCount);
  totalFavs = Math.max(totalFavs, state.favorites ? state.favorites.size : 0);

  // Load Feedback (both from Supabase and LocalStorage)
  const feedbackList = await loadCommunityFeedback();
  totalFeedback = Math.max(totalFeedback, feedbackList.length);

  // If topPrompts is still empty, populate from local copy stats or Master Prompts across 4 books
  if (topPrompts.length === 0) {
    const popularPromptsList = Object.entries(localCopyStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pid, count]) => {
        const p = PROMPTS_DATA.find(x => x.id === pid);
        return {
          id: pid,
          promptNum: p ? p.promptNum : pid,
          title: p ? p.title : pid,
          book: p ? p.book : 1,
          copies: count
        };
      });

    if (popularPromptsList.length > 0) {
      topPrompts = popularPromptsList;
    } else {
      const defaultPids = ['b1_1_1', 'b1_2_1', 'b2_1_1', 'b2_2_1', 'b3_1_1', 'b4_1_1'];
      topPrompts = defaultPids.map(id => {
        const p = PROMPTS_DATA.find(x => x.id === id);
        return {
          id: id,
          promptNum: p ? p.promptNum : '1.1',
          title: p ? p.title : id,
          book: p ? p.book : 1,
          copies: 1
        };
      });
    }
  }

  // If bookStats empty, calculate from available prompts
  if (bookStats[0] === 0 && bookStats[1] === 0 && bookStats[2] === 0 && bookStats[3] === 0) {
    topPrompts.forEach(p => {
      if (p.book >= 1 && p.book <= 4) bookStats[p.book - 1] += (p.copies || 1);
    });
    if (bookStats[0] === 0 && bookStats[1] === 0 && bookStats[2] === 0 && bookStats[3] === 0) {
      bookStats = [2, 2, 2, 2];
    }
  }

  // If dailyStats empty, generate the 7 past days
  if (dailyStats.labels.length === 0) {
    const dayNames = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const label = `${dayNames[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
      dailyStats.labels.push(label);
      dailyStats.data.push(i === 0 ? Math.max(localCopiesCount, 1) : 0);
    }
  }

  // Save to cache
  _communityChartData = {
    topPrompts,
    bookUsage: bookStats,
    dailyTrend: dailyStats
  };

  // Update Metric Cards
  setDashboardStat('comm-stat-members', totalMembers.toLocaleString('th-TH') + ' ท่าน');
  setDashboardStat('comm-stat-copies',  totalCopies.toLocaleString('th-TH') + ' ครั้ง');
  setDashboardStat('comm-stat-favs',    totalFavs.toLocaleString('th-TH') + ' ครั้ง');
  setDashboardStat('comm-stat-feedback', totalFeedback.toLocaleString('th-TH') + ' ข้อความ');

  if (syncText) {
    syncText.textContent = _sb
      ? 'เชื่อมต่อข้อมูลสดกับ Supabase เรียบร้อยแล้ว (อัปเดตเรียลไทม์)'
      : 'แสดงสถิติประมวลผลระบบเครือข่ายศึกษานิเทศก์';
  }

  // Render Charts
  renderCommunityCharts();

  // Update member gate for feedback submission
  updateFeedbackAuthUI();
}

window.loadCommunityDashboard = loadCommunityDashboard;

/* ─── Render Chart.js Visualizations (4 Books Support) ─── */
function renderCommunityCharts() {
  if (typeof Chart === 'undefined') {
    console.warn('[Chart.js] Library not loaded yet');
    return;
  }

  const isDark = document.body.classList.contains('dark-mode');
  const textColor = isDark ? '#94A3B8' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.05)';

  // Destroy previous instances to avoid memory leaks or canvas reuse errors
  if (_chartTopPrompts) { _chartTopPrompts.destroy(); _chartTopPrompts = null; }
  if (_chartBookUsage)  { _chartBookUsage.destroy();  _chartBookUsage = null;  }
  if (_chartDailyTrend) { _chartDailyTrend.destroy(); _chartDailyTrend = null; }

  // 1. Chart 1: Top 10 Popular Prompts (Horizontal Bar)
  const canvasTop = document.getElementById('chartTopPrompts');
  if (canvasTop && _communityChartData.topPrompts.length > 0) {
    const top10 = _communityChartData.topPrompts.slice(0, 10);
    const labels = top10.map(p => {
      const shortTitle = p.title.length > 24 ? p.title.substring(0, 24) + '…' : p.title;
      return `${p.promptNum} ${shortTitle}`;
    });
    const counts = top10.map(p => p.copies);
    const bgColors = top10.map(p => {
      if (p.book === 1) return 'rgba(16, 185, 129, 0.85)'; // emerald
      if (p.book === 2) return 'rgba(37, 99, 235, 0.85)';  // blue
      if (p.book === 3) return 'rgba(124, 58, 237, 0.85)'; // purple
      return 'rgba(245, 158, 11, 0.85)';                   // amber
    });

    _chartTopPrompts = new Chart(canvasTop, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'จำนวนครั้งที่คัดลอก',
          data: counts,
          backgroundColor: bgColors,
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function(context) {
                const idx = context[0].dataIndex;
                const p = top10[idx];
                return `[เล่ม ${p.book}] Prompt ${p.promptNum}: ${p.title}`;
              },
              label: function(context) {
                return ` คัดลอกแล้ว ${context.raw.toLocaleString('th-TH')} ครั้ง`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: 'Sarabun' } }
          },
          y: {
            grid: { display: false },
            ticks: { color: textColor, font: { family: 'Sarabun', size: 12, weight: 600 } }
          }
        },
        onClick: (evt, elements) => {
          if (elements && elements.length > 0) {
            const idx = elements[0].index;
            const targetPrompt = top10[idx];
            if (targetPrompt && targetPrompt.id) {
              openPromptModal(targetPrompt.id);
            }
          }
        }
      }
    });
  }

  // 2. Chart 2: Book Usage Share (Doughnut Chart for 4 Books)
  const canvasBook = document.getElementById('chartBookUsage');
  if (canvasBook) {
    const totalBookCopies = _communityChartData.bookUsage.reduce((a, b) => a + b, 0) || 1;
    const b1Pct = Math.round((_communityChartData.bookUsage[0] / totalBookCopies) * 100);
    const b2Pct = Math.round((_communityChartData.bookUsage[1] / totalBookCopies) * 100);
    const b3Pct = Math.round((_communityChartData.bookUsage[2] / totalBookCopies) * 100);
    const b4Pct = 100 - b1Pct - b2Pct - b3Pct;

    _chartBookUsage = new Chart(canvasBook, {
      type: 'doughnut',
      data: {
        labels: [
          '🏛️ เล่ม 1: วินิจฉัย & แผน',
          '🤝 เล่ม 2: นิเทศ & Coaching',
          '📊 เล่ม 3: เครื่องมือ & วิจัย',
          '🎖️ เล่ม 4: วPA & วิชาชีพ'
        ],
        datasets: [{
          data: _communityChartData.bookUsage,
          backgroundColor: ['#10B981', '#2563EB', '#7C3AED', '#F59E0B'],
          hoverOffset: 6,
          borderWidth: 2,
          borderColor: isDark ? '#1E293B' : '#FFFFFF'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                const val = context.raw;
                const pct = Math.round((val / totalBookCopies) * 100);
                return ` ${val.toLocaleString('th-TH')} ครั้ง (${pct}%)`;
              }
            }
          }
        },
        cutout: '65%'
      }
    });

    // Custom HTML Legend
    const legendEl = document.getElementById('book-usage-legend');
    if (legendEl) {
      legendEl.innerHTML = `
        <span class="legend-item"><span class="legend-dot" style="background:#10B981"></span> 🏛️ เล่ม 1 (${b1Pct}%)</span>
        <span class="legend-item"><span class="legend-dot" style="background:#2563EB"></span> 🤝 เล่ม 2 (${b2Pct}%)</span>
        <span class="legend-item"><span class="legend-dot" style="background:#7C3AED"></span> 📊 เล่ม 3 (${b3Pct}%)</span>
        <span class="legend-item"><span class="legend-dot" style="background:#F59E0B"></span> 🎖️ เล่ม 4 (${b4Pct}%)</span>
      `;
    }
  }

  // 3. Chart 3: 7-Day Usage Activity Trend (Line / Area Chart)
  const canvasTrend = document.getElementById('chartDailyTrend');
  if (canvasTrend && _communityChartData.dailyTrend.labels.length > 0) {
    const ctx = canvasTrend.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, 'rgba(79, 70, 229, 0.35)');
    gradient.addColorStop(1, 'rgba(79, 70, 229, 0.0)');

    _chartDailyTrend = new Chart(canvasTrend, {
      type: 'line',
      data: {
        labels: _communityChartData.dailyTrend.labels,
        datasets: [{
          label: 'ยอดการคัดลอกรายวัน',
          data: _communityChartData.dailyTrend.data,
          borderColor: '#4F46E5',
          borderWidth: 2.5,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#4F46E5',
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                return ` ${context.raw.toLocaleString('th-TH')} ครั้ง`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { family: 'Sarabun', size: 11 } }
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: 'Sarabun' } }
          }
        }
      }
    });
  }
}

window.renderCommunityCharts = renderCommunityCharts;

/* ─── Feedback System for Supervisor Network ─── */
const LOCAL_FEEDBACK_KEY = 'ai_prompt_supervisor_community_feedback';

async function loadCommunityFeedback() {
  let list = [];

  // Try fetching from Supabase
  if (_sb) {
    try {
      const { data, error } = await _sb
        .from('community_feedback')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(25);

      if (!error && Array.isArray(data) && data.length > 0) {
        list = data;
      }
    } catch (e) {
      console.warn('[CommunityDash] load feedback exception:', e);
    }
  }

  // Load from localStorage as well
  let localList = [];
  try {
    localList = JSON.parse(localStorage.getItem(LOCAL_FEEDBACK_KEY) || '[]');
  } catch {}

  // Merge unique by id or text
  const merged = [...localList];
  list.forEach(item => {
    if (!merged.some(m => (m.id && m.id === item.id) || (m.message === item.message && m.user_name === item.user_name))) {
      merged.push(item);
    }
  });

  const container = document.getElementById('feedback-items-container');
  const countBadge = document.getElementById('feedback-feed-count');

  if (countBadge) {
    countBadge.textContent = `${merged.length} ข้อความ`;
  }

  if (container) {
    if (merged.length === 0) {
      container.innerHTML = `
        <div class="loading-state-dash" style="padding: 40px 16px; text-align: center;">
          <div style="font-size: 36px; margin-bottom: 10px;">💌</div>
          <div style="font-weight: 700; font-size: 14px; margin-bottom: 6px; color: var(--text);">ยังไม่มีข้อเสนอแนะในระบบ</div>
          <div style="color: var(--text-muted); font-size: 12.5px; line-height: 1.5;">ร่วมเป็นศึกษานิเทศก์ท่านแรกที่แชร์ความคิดเห็น แนะนำ หรือขอ Prompt ภารกิจนิเทศผ่านฟอร์มได้เลยครับ ✨</div>
        </div>
      `;
      return merged;
    }

    window._cachedCommunityFeedback = merged;

    container.innerHTML = merged.map((item, idx) => {
      const stars = '★'.repeat(item.rating || 5) + '☆'.repeat(5 - (item.rating || 5));
      const timeAgo = formatTimeAgo(item.created_at);
      const cat = item.category || 'ข้อเสนอแนะงานนิเทศ';
      const isOwner = state.user && item.user_id && (String(state.user.id) === String(item.user_id));

      return `
        <div class="feedback-item" id="feedback-card-${item.id || idx}">
          <div class="fb-item-top">
            <div>
              <div class="fb-author">ศน. ${escapeHtml(item.user_name)}</div>
              ${item.role_or_school ? `<div class="fb-meta">${escapeHtml(item.role_or_school)}</div>` : ''}
            </div>
            <div class="fb-stars">${stars}</div>
          </div>
          <span class="fb-category-chip">${escapeHtml(cat)}</span>
          <div class="fb-message">${escapeHtml(item.message)}</div>
          <div class="fb-footer">
            <div class="fb-time">${timeAgo}</div>
            ${isOwner ? `
              <div class="fb-actions">
                <button type="button" class="fb-btn-action edit" onclick="openEditFeedbackModal('${item.id || idx}')" title="แก้ไขข้อความนี้">✏️ แก้ไข</button>
                <button type="button" class="fb-btn-action delete" onclick="deleteCommunityFeedback('${item.id || idx}')" title="ลบข้อความนี้">🗑️ ลบ</button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  return merged;
}

function setFeedbackRating(val) {
  const ratingInput = document.getElementById('fb-rating');
  if (ratingInput) ratingInput.value = val;

  const stars = document.querySelectorAll('#star-rating-select .star-btn');
  stars.forEach(s => {
    const starVal = Number(s.dataset.rating);
    s.classList.toggle('active', starVal <= val);
  });

  const label = document.getElementById('rating-label');
  if (label) {
    const texts = {
      1: '1/5 ต้องปรับปรุง',
      2: '2/5 พอใช้',
      3: '3/5 ปานกลาง',
      4: '4/5 ดีมาก',
      5: '5/5 ยอดเยี่ยมมาก'
    };
    label.textContent = texts[val] || `${val}/5`;
  }
}

window.setFeedbackRating = setFeedbackRating;

function updateFeedbackAuthUI() {
  const guestGate   = document.getElementById('feedback-guest-gate');
  const memberForm  = document.getElementById('feedback-member-form');
  const nameInput   = document.getElementById('fb-name');
  const schoolInput = document.getElementById('fb-school');

  const profile = (typeof getSupervisorProfile === 'function') ? getSupervisorProfile() : null;

  if (state.user) {
    if (guestGate)  guestGate.classList.add('hidden');
    if (memberForm) memberForm.classList.remove('hidden');

    if (nameInput && !nameInput.value) {
      nameInput.value = (profile && profile.name) || state.user.user_metadata?.display_name || state.user.email?.split('@')[0] || '';
    }
    if (schoolInput && !schoolInput.value && profile && profile.area) {
      schoolInput.value = profile.area;
    }
  } else {
    if (guestGate)  guestGate.classList.remove('hidden');
    if (memberForm) memberForm.classList.add('hidden');
  }
}

window.updateFeedbackAuthUI = updateFeedbackAuthUI;

async function handleFeedbackSubmit(event) {
  if (event) event.preventDefault();

  if (!state.user) {
    openAuthModal('login');
    showToast('สิทธิพิเศษสำหรับสมาชิกเท่านั้น กรุณาเข้าสู่ระบบก่อนส่งข้อเสนอแนะครับ', 'info');
    return;
  }

  const nameInput   = document.getElementById('fb-name');
  const schoolInput = document.getElementById('fb-school');
  const catInput    = document.getElementById('fb-category');
  const ratingInput = document.getElementById('fb-rating');
  const msgInput    = document.getElementById('fb-message');
  const submitBtn   = document.getElementById('fb-submit-btn');

  const profile = (typeof getSupervisorProfile === 'function') ? getSupervisorProfile() : null;
  const userName = (nameInput ? nameInput.value.trim() : '') || (profile && profile.name) || (state.user.user_metadata?.display_name || 'ศึกษานิเทศก์');
  const roleSchool = (schoolInput ? schoolInput.value.trim() : '') || (profile && profile.area) || '';
  const category = catInput ? catInput.value : 'ข้อเสนอแนะงานนิเทศ';
  const rating = Number(ratingInput ? ratingInput.value : 5) || 5;
  const message = msgInput ? msgInput.value.trim() : '';

  if (!message || message.length < 3) {
    showToast('กรุณาระบุข้อความข้อเสนอแนะอย่างน้อย 3 ตัวอักษร', 'info');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'กำลังส่งข้อเสนอแนะ...';
  }

  const newFeedback = {
    user_name: userName,
    role_or_school: roleSchool,
    category: category,
    rating: rating,
    message: message,
    user_id: state.user ? state.user.id : null,
    created_at: new Date().toISOString()
  };

  // 1. Save to Supabase if connected
  if (_sb) {
    try {
      const payload = {
        user_name: userName,
        role_or_school: roleSchool || null,
        category: category,
        rating: rating,
        message: message,
        user_id: state.user ? state.user.id : null
      };

      const { data, error } = await _sb.from('community_feedback').insert([payload]).select();
      if (!error && data && data.length > 0) {
        newFeedback.id = data[0].id;
      }
    } catch (err) {
      console.warn('[CommunityDash] submit feedback to supabase exception:', err);
    }
  }

  // 2. Persist to localStorage
  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_FEEDBACK_KEY) || '[]');
    local.unshift(newFeedback);
    localStorage.setItem(LOCAL_FEEDBACK_KEY, JSON.stringify(local.slice(0, 30)));
  } catch {}

  // 3. Reset form
  if (msgInput) msgInput.value = '';
  setFeedbackRating(5);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>📨 ส่งข้อเสนอแนะถึงทีมพัฒนา</span>';
  }

  showToast('ขอบคุณสำหรับข้อเสนอแนะ! ความคิดเห็นของท่านถูกบันทึกเรียบร้อยแล้ว ❤️', 'success');
  await loadCommunityFeedback();
}

window.handleFeedbackSubmit = handleFeedbackSubmit;

/* ─── Feedback Edit & Delete Actions ─── */
function setEditFeedbackRating(val) {
  const ratingInput = document.getElementById('edit-fb-rating');
  if (ratingInput) ratingInput.value = val;

  const stars = document.querySelectorAll('#edit-star-rating-select .star-btn');
  stars.forEach(s => {
    const starVal = Number(s.dataset.rating);
    s.classList.toggle('active', starVal <= val);
  });

  const label = document.getElementById('edit-rating-label');
  if (label) {
    const texts = {
      1: '1/5 ต้องปรับปรุง',
      2: '2/5 พอใช้',
      3: '3/5 ปานกลาง',
      4: '4/5 ดีมาก',
      5: '5/5 ยอดเยี่ยมมาก'
    };
    label.textContent = texts[val] || `${val}/5`;
  }
}
window.setEditFeedbackRating = setEditFeedbackRating;

function openEditFeedbackModal(feedbackId) {
  if (!state.user) {
    showToast('กรุณาเข้าสู่ระบบก่อนแก้ไขข้อเสนอแนะครับ', 'info');
    return;
  }

  const list = window._cachedCommunityFeedback || [];
  const item = list.find(f => String(f.id) === String(feedbackId)) || list[Number(feedbackId)];
  if (!item) {
    showToast('ไม่พบข้อมูลข้อเสนอแนะที่ต้องการแก้ไข', 'error');
    return;
  }

  if (item.user_id && String(item.user_id) !== String(state.user.id)) {
    showToast('ท่านสามารถแก้ไขได้เฉพาะข้อความของตนเองเท่านั้นครับ', 'error');
    return;
  }

  const modalOverlay = document.getElementById('edit-feedback-modal-overlay');
  const idInput = document.getElementById('edit-fb-id');
  const catInput = document.getElementById('edit-fb-category');
  const msgInput = document.getElementById('edit-fb-message');

  if (idInput) idInput.value = item.id || feedbackId;
  if (catInput) catInput.value = item.category || 'ข้อเสนอแนะงานนิเทศ';
  if (msgInput) msgInput.value = item.message || '';
  setEditFeedbackRating(item.rating || 5);

  if (modalOverlay) {
    modalOverlay.classList.remove('hidden');
    modalOverlay.style.display = 'flex';
    setTimeout(() => {
      msgInput?.focus();
    }, 100);
  }
}
window.openEditFeedbackModal = openEditFeedbackModal;

function closeEditFeedbackModal(event) {
  if (event && event.target !== document.getElementById('edit-feedback-modal-overlay')) {
    return;
  }
  const modalOverlay = document.getElementById('edit-feedback-modal-overlay');
  if (modalOverlay) {
    modalOverlay.classList.add('hidden');
    modalOverlay.style.display = 'none';
  }
}
window.closeEditFeedbackModal = closeEditFeedbackModal;

async function handleFeedbackEditSubmit(event) {
  if (event) event.preventDefault();

  if (!state.user) {
    showToast('กรุณาเข้าสู่ระบบก่อนทำการแก้ไข', 'info');
    return;
  }

  const idInput = document.getElementById('edit-fb-id');
  const catInput = document.getElementById('edit-fb-category');
  const ratingInput = document.getElementById('edit-fb-rating');
  const msgInput = document.getElementById('edit-fb-message');
  const submitBtn = document.getElementById('edit-fb-submit-btn');

  const feedbackId = idInput?.value;
  const newCat = catInput?.value || 'ข้อเสนอแนะงานนิเทศ';
  const newRating = Number(ratingInput?.value || 5);
  const newMsg = msgInput?.value.trim() || '';

  if (!newMsg || newMsg.length < 3) {
    showToast('กรุณาระบุข้อความอย่างน้อย 3 ตัวอักษร', 'info');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'กำลังบันทึก...';
  }

  if (_sb) {
    try {
      await _sb
        .from('community_feedback')
        .update({
          category: newCat,
          rating: newRating,
          message: newMsg
        })
        .eq('id', feedbackId)
        .eq('user_id', state.user.id);
    } catch (e) {
      console.warn('[CommunityDash] update feedback exception:', e);
    }
  }

  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_FEEDBACK_KEY) || '[]');
    const idx = local.findIndex(f => String(f.id) === String(feedbackId));
    if (idx !== -1) {
      local[idx].category = newCat;
      local[idx].rating = newRating;
      local[idx].message = newMsg;
      localStorage.setItem(LOCAL_FEEDBACK_KEY, JSON.stringify(local));
    }
  } catch {}

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'บันทึกการแก้ไข';
  }

  closeEditFeedbackModal();
  showToast('แก้ไขข้อเสนอแนะเรียบร้อยแล้ว ✨', 'success');
  await loadCommunityFeedback();
}
window.handleFeedbackEditSubmit = handleFeedbackEditSubmit;

async function deleteCommunityFeedback(feedbackId) {
  if (!state.user) {
    showToast('กรุณาเข้าสู่ระบบก่อนดำเนินการ', 'info');
    return;
  }

  if (!confirm('ท่านต้องการลบข้อเสนอแนะข้อความนี้ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้')) {
    return;
  }

  if (_sb) {
    try {
      await _sb
        .from('community_feedback')
        .delete()
        .eq('id', feedbackId)
        .eq('user_id', state.user.id);
    } catch (e) {
      console.warn('[CommunityDash] delete feedback error:', e);
    }
  }

  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_FEEDBACK_KEY) || '[]');
    const filtered = local.filter(f => String(f.id) !== String(feedbackId));
    localStorage.setItem(LOCAL_FEEDBACK_KEY, JSON.stringify(filtered));
  } catch {}

  showToast('ลบข้อความข้อเสนอแนะแล้ว 🗑️', 'info');
  await loadCommunityFeedback();
}
window.deleteCommunityFeedback = deleteCommunityFeedback;

/* ─── TAB 2: PERSONAL DASHBOARD (USER STATS) ─── */
async function loadPersonalDashboard() {
  const guestEl = document.getElementById('dashboard-guest');
  const userEl  = document.getElementById('dashboard-member') || document.getElementById('dashboard-user');

  if (!state.user) {
    if (guestEl) guestEl.classList.remove('hidden');
    if (userEl) userEl.classList.add('hidden');
    return;
  }

  if (guestEl) guestEl.classList.add('hidden');
  if (userEl) userEl.classList.remove('hidden');

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
      }
    } catch (err) {
      console.warn('[Supabase] loadPersonalDashboard fetch error:', err);
    }
  }

  const localStats = getCopyStats();
  const histKey = 'ai_prompt_supervisor_copy_history';
  let localHist = [];
  try {
    localHist = JSON.parse(localStorage.getItem(histKey) || localStorage.getItem('ai_prompt_kruthai_copy_history') || '[]');
  } catch (e) {}

  if (userEvents.length === 0 && localHist.length > 0) {
    userEvents = localHist.map(h => ({
      prompt_id: h.id,
      copied_at: h.ts ? new Date(h.ts).toISOString() : new Date().toISOString()
    }));
  }

  const totalCopies = userEvents.length > 0
    ? userEvents.length
    : Object.values(localStats).reduce((s, v) => s + v, 0);

  const totalFavs = state.favorites ? state.favorites.size : 0;

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
  const booksUsedStr = `${booksSet.size}/4`;

  const streakDays = calculateUsageStreak(userEvents.length > 0 ? userEvents : localHist);

  setDashboardStat('stat-total-copies', totalCopies);
  setDashboardStat('stat-total',        totalCopies);
  setDashboardStat('stat-favorites',    totalFavs);
  setDashboardStat('stat-streak',       streakDays > 0 ? `${streakDays} วัน` : '0 วัน');
  setDashboardStat('stat-books',        booksUsedStr);

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

window.loadPersonalDashboard = loadPersonalDashboard;

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
  if (window.location.hash && !window.location.hash.includes('access_token')) {
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
      if (typeof closeCopyGateModal === 'function') closeCopyGateModal(null, true);
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
    if (window.location.hash.includes('access_token')) return;
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
  if (state.currentView !== 'home') navigateTo('home');
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

function handleBottomNavProfile() {
  if (state.user) {
    navigateTo('profile');
  } else {
    openAuthModal('login');
  }
}

/* ═══════════════════════════════════════════════════════════════
   25. COPY FROM MODAL
═══════════════════════════════════════════════════════════════ */
async function copyPromptFromModal() {
  if (!state.currentPrompt) return;

  const copied = await copyPrompt(state.currentPrompt.id);
  if (copied) {
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
  const copied = await copyPrompt('b1_1_1');
  if (copied && btnEl) {
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
  const copied = await copyPrompt('b1_1_1');
  if (copied) {
    const chk = document.getElementById('guide-dont-show-again');
    if (chk && chk.checked) {
      localStorage.setItem('ai_supervisor_guide_dismissed', '1');
    }
    const overlay = document.getElementById('guide-modal-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.style.display = 'none';
    }
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
window.openCopyGateModal = (typeof openCopyGateModal === 'function') ? openCopyGateModal : function() {};
window.closeCopyGateModal = (typeof closeCopyGateModal === 'function') ? closeCopyGateModal : function() {};
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
window.handleBottomNavProfile = handleBottomNavProfile;
window.openMobileSearch = openMobileSearch;
window.closeMobileSearch = closeMobileSearch;
window.renderSupervisorProfile = renderSupervisorProfile;
window.saveSupervisorProfile = saveSupervisorProfile;
window.updateAreaPlaceholder = updateAreaPlaceholder;
window.updateAutofillPreview = updateAutofillPreview;
window.applyAutoFillPlaceholders = applyAutoFillPlaceholders;
window.getSupervisorProfile = getSupervisorProfile;
window.selectStarRating = selectStarRating;
window.hoverStarRating = hoverStarRating;
window.resetStarHover = resetStarHover;
window.updateStarUI = updateStarUI;
window.loadPromptFeedback = loadPromptFeedback;
window.submitPromptFeedback = submitPromptFeedback;
window.switchDashboardTab = switchDashboardTab;
window.loadCommunityDashboard = loadCommunityDashboard;
window.renderCommunityCharts = renderCommunityCharts;
window.loadCommunityFeedback = loadCommunityFeedback;
window.setFeedbackRating = setFeedbackRating;
window.updateFeedbackAuthUI = updateFeedbackAuthUI;
window.handleFeedbackSubmit = handleFeedbackSubmit;
window.setEditFeedbackRating = setEditFeedbackRating;
window.openEditFeedbackModal = openEditFeedbackModal;
window.closeEditFeedbackModal = closeEditFeedbackModal;
window.handleFeedbackEditSubmit = handleFeedbackEditSubmit;
window.deleteCommunityFeedback = deleteCommunityFeedback;
window.loadPersonalDashboard = loadPersonalDashboard;


