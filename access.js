/**
 * AI Prompt ศึกษานิเทศก์ (ทุกสังกัด) — access.js
 * ระบบควบคุมการเข้าถึงตาม ACCESS_CONFIG.mode
 *
 * MODE A: open                - ทุกคนใช้ได้, สมาชิกได้ฟีเจอร์เพิ่ม
 * MODE B: copy_requires_login - ดู/ค้นหาฟรี, copy ต้องสมัคร
 * MODE C: login_required    - ต้องเข้าสู่ระบบก่อนทุกอย่าง
 */

'use strict';

const accessState = {
  copyCountToday: 0,
  copyCountKey: 'ai_supervisor_copy_count',
  copyDateKey: 'ai_supervisor_copy_date',
  welcomeShown: false,
};

function initAccessSystem() {
  const mode = (typeof ACCESS_CONFIG !== 'undefined') ? ACCESS_CONFIG.mode : 'open';
  loadDailyCopyCount();

  if (mode === 'login_required') {
    enforceLoginWall();
  }

  if (mode === 'copy_requires_login' || mode === 'open') {
    const delay = ACCESS_CONFIG && ACCESS_CONFIG.welcomePopupDelay != null
      ? ACCESS_CONFIG.welcomePopupDelay : 8000;
    if (ACCESS_CONFIG && ACCESS_CONFIG.showWelcomePopup) {
      setTimeout(() => {
        if (!state.user && !accessState.welcomeShown) {
          showWelcomePopup();
        }
      }, delay);
    }
  }
}

function enforceLoginWall() {
  if (state.user) {
    removeLoginWall();
    return;
  }
  if (document.getElementById('login-wall-overlay')) return;

  const cfg = ACCESS_CONFIG || {};
  const title = cfg.loginWallTitle || 'เข้าสู่ระบบเพื่อใช้งาน';
  const sub   = cfg.loginWallSubtitle || 'สมัครสมาชิกฟรีเพื่อเข้าถึงคลัง Prompts ศึกษานิเทศก์';

  const overlay = document.createElement('div');
  overlay.id = 'login-wall-overlay';
  overlay.innerHTML = `
    <div class="login-wall-inner">
      <div class="login-wall-logo">🏛️</div>
      <h1 class="login-wall-title">${title}</h1>
      <p class="login-wall-sub">${sub}</p>

      <div class="login-wall-features">
        <div class="lw-feature"><span>🏛️</span><span>คลัง AI Prompts สำหรับศึกษานิเทศก์ 4 เสาหลัก</span></div>
        <div class="lw-feature"><span>🔍</span><span>ค้นหาตามสถานการณ์และภารกิจนิเทศ</span></div>
        <div class="lw-feature"><span>📊</span><span>สถิติการใช้งานส่วนบุคคล</span></div>
        <div class="lw-feature"><span>⭐</span><span>บันทึกรายการโปรดข้ามอุปกรณ์</span></div>
        <div class="lw-feature"><span>🤖</span><span>เปิดตรงใน Claude / ChatGPT / Gemini</span></div>
        <div class="lw-feature"><span>🆓</span><span>ฟรี ไม่มีค่าใช้จ่าย</span></div>
      </div>

      <div class="login-wall-actions">
        <button class="btn-primary lw-btn" onclick="openAuthModal('signup')">
          🎉 สมัครสมาชิกฟรี
        </button>
        <button class="btn-secondary lw-btn" onclick="openAuthModal('login')">
          เข้าสู่ระบบ
        </button>
      </div>

      <p class="login-wall-hint">
        หรือถ้าต้องการ ทดลองใช้ก่อน
        <a href="#" onclick="previewMode(); return false;">ดูตัวอย่าง Prompts (จำกัด)</a>
      </p>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

function removeLoginWall() {
  const overlay = document.getElementById('login-wall-overlay');
  if (overlay) {
    overlay.remove();
    document.body.style.overflow = '';
  }
}

function previewMode() {
  removeLoginWall();
  const banner = document.createElement('div');
  banner.id = 'preview-banner';
  banner.className = 'preview-mode-banner';
  banner.innerHTML = `
    <span>👁️ โหมดทดลองดูตัวอย่าง — สมัครสมาชิกฟรีเพื่อใช้งานได้ไม่จำกัด</span>
    <button class="btn-sm btn-primary" onclick="openAuthModal('signup')">สมัครสมาชิก</button>
  `;
  const header = document.getElementById('main-header');
  if (header) header.insertAdjacentElement('afterend', banner);
}

function canCopyPrompt() {
  const mode = (typeof ACCESS_CONFIG !== 'undefined') ? ACCESS_CONFIG.mode : 'open';
  if (state.user) return { allowed: true };
  if (mode === 'open') return { allowed: true };

  const limit = (ACCESS_CONFIG && ACCESS_CONFIG.freeCopiesPerDay != null)
    ? ACCESS_CONFIG.freeCopiesPerDay : 5;

  if (limit === 0) {
    return {
      allowed: false,
      reason: 'login_required',
      message: 'กรุณาเข้าสู่ระบบหรือสมัครสมาชิกฟรี เพื่อคัดลอก Prompt'
    };
  }

  loadDailyCopyCount();
  if (accessState.copyCountToday < limit) {
    return {
      allowed: true,
      remaining: limit - accessState.copyCountToday
    };
  }

  return {
    allowed: false,
    reason: 'daily_limit_reached',
    message: `คุณใช้โควตาคัดลอกฟรีครบ ${limit} ครั้งสำหรับวันนี้แล้ว กรุณาสมัครสมาชิกฟรีเพื่อใช้งานไม่จำกัด`
  };
}

function recordCopyAction() {
  if (state.user) return;
  loadDailyCopyCount();
  accessState.copyCountToday++;
  saveDailyCopyCount();
}

function loadDailyCopyCount() {
  const today = new Date().toISOString().slice(0, 10);
  const savedDate = localStorage.getItem(accessState.copyDateKey);
  if (savedDate !== today) {
    accessState.copyCountToday = 0;
    localStorage.setItem(accessState.copyDateKey, today);
    localStorage.setItem(accessState.copyCountKey, '0');
  } else {
    accessState.copyCountToday = parseInt(localStorage.getItem(accessState.copyCountKey) || '0', 10);
  }
}

function saveDailyCopyCount() {
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem(accessState.copyDateKey, today);
  localStorage.setItem(accessState.copyCountKey, String(accessState.copyCountToday));
}

function showCopyLimitModal(message) {
  const existing = document.getElementById('copy-limit-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'copy-limit-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="modal copy-limit-modal">
      <button class="modal-close" onclick="document.getElementById('copy-limit-modal-overlay').remove()">✕</button>
      <div class="cl-icon">🔒</div>
      <h2 class="cl-title">สมัครสมาชิกเพื่อใช้งานต่อ</h2>
      <p class="cl-msg">${message || 'สมัครสมาชิกฟรี เข้าถึงคลัง Prompts งานนิเทศ 4 เสาหลัก'}</p>
      <div class="cl-actions">
        <button class="btn-primary full" onclick="document.getElementById('copy-limit-modal-overlay').remove(); openAuthModal('signup')">
          🎉 สมัครสมาชิกฟรี (ไม่ถึง 1 นาที)
        </button>
        <button class="btn-secondary full" onclick="document.getElementById('copy-limit-modal-overlay').remove(); openAuthModal('login')">
          เข้าสู่ระบบด้วยบัญชีเดิม
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function showWelcomePopup() {
  if (accessState.welcomeShown) return;
  accessState.welcomeShown = true;

  const overlay = document.createElement('div');
  overlay.id = 'welcome-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="modal welcome-modal">
      <button class="modal-close" onclick="document.getElementById('welcome-modal-overlay').remove()">✕</button>
      <div class="welcome-header">
        <div class="welcome-emoji">🏛️</div>
        <h2>ยินดีต้อนรับสู่ AI Prompt ศึกษานิเทศก์</h2>
        <p class="text-muted">คลังคำสั่ง AI 4 เสาหลัก เพื่อการนิเทศและพัฒนาการศึกษา</p>
      </div>
      <div class="welcome-features">
        <div class="wf-item"><span class="wf-icon">🏛️</span><div><strong>เสา 1: วิเคราะห์ข้อมูล & วางแผนนิเทศ</strong><span>NT, O-NET, PISA, SAR, แผนนิเทศ</span></div></div>
        <div class="wf-item"><span class="wf-icon">🤝</span><div><strong>เสา 2: นิเทศคลินิก & Coaching</strong><span>Clinical Supervision, GROWTH, PLC</span></div></div>
        <div class="wf-item"><span class="wf-icon">📊</span><div><strong>เสา 3: เครื่องมือนิเทศ & วิจัย</strong><span>Rubrics, แบบสังเกต, R&D การนิเทศ</span></div></div>
        <div class="wf-item"><span class="wf-icon">🎖️</span><div><strong>เสา 4: วPA ศน. & วิชาชีพ</strong><span>ว10/2564, ประเด็นท้าทายระดับเขต</span></div></div>
      </div>
      <div class="welcome-actions">
        <button class="btn-primary full" onclick="document.getElementById('welcome-modal-overlay').remove(); openAuthModal('signup')">
          🎉 สมัครสมาชิกฟรี
        </button>
        <button class="btn-ghost full" onclick="document.getElementById('welcome-modal-overlay').remove()">
          เข้าใช้งานเลย (โหมดทั่วไป)
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}
