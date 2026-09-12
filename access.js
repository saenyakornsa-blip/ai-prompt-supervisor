/**
 * AI Prompt ศึกษานิเทศก์ (ทุกสังกัด) — access.js
 * ระบบควบคุมสิทธิ์การใช้งาน (Access Control & Guest Limit)
 *
 * เงื่อนไขการใช้งาน:
 * 1. ผู้ใช้งานทั่วไป (ยังไม่ได้เข้าสู่ระบบ / ผู้เยี่ยมชม):
 *    - สามารถทดลองคัดลอก Prompt ได้ 3 ครั้ง
 *    - เมื่อครบ 3 ครั้งแล้ว จะมี Pop-up แจ้งเตือนให้สมัครสมาชิกฟรี
 * 2. สมาชิก (เข้าสู่ระบบแล้ว):
 *    - สามารถคัดลอก Prompt ได้ไม่จำกัดจำนวนครั้ง
 */

'use strict';

const GUEST_COPY_LIMIT = 3;
const GUEST_COPY_KEY   = 'ai_prompt_guest_copies';

/**
 * ดึงจำนวนครั้งที่ผู้เยี่ยมชมคัดลอกไปแล้ว
 * @returns {number}
 */
function getGuestCopyCount() {
  const val = parseInt(localStorage.getItem(GUEST_COPY_KEY) || '0', 10);
  return isNaN(val) ? 0 : val;
}

/**
 * ดึงจำนวนสิทธิ์คัดลอกที่เหลือของผู้เยี่ยมชม
 * @returns {number}
 */
function getGuestCopyRemaining() {
  return Math.max(0, GUEST_COPY_LIMIT - getGuestCopyCount());
}

/**
 * ตรวจสอบสิทธิ์ก่อนการคัดลอก Prompt
 * @param {string} promptId
 * @param {Function} onAllowed - ทำงานเมื่อได้รับอนุญาตให้คัดลอก
 * @param {Function} onBlocked - ทำงานเมื่อสิทธิ์หมด (เกิน 3 ครั้ง)
 * @returns {boolean}
 */
function checkCopyAccess(promptId, onAllowed, onBlocked) {
  // สมาชิกที่เข้าสู่ระบบแล้ว -> คัดลอกได้ไม่จำกัด
  if (typeof state !== 'undefined' && state.user) {
    if (typeof onAllowed === 'function') onAllowed();
    return true;
  }

  // ผู้เยี่ยมชมที่ยังไม่ได้เข้าสู่ระบบ
  const count = getGuestCopyCount();
  if (count < GUEST_COPY_LIMIT) {
    const newCount = count + 1;
    localStorage.setItem(GUEST_COPY_KEY, String(newCount));
    if (typeof onAllowed === 'function') onAllowed();
    updateAccessIndicator();
    return true;
  }

  // ใช้สิทธิ์ครบ 3 ครั้งแล้ว -> ปฏิเสธการคัดลอก และเปิด Pop-up แจ้งเตือนสมัครสมาชิกฟรี
  if (typeof onBlocked === 'function') onBlocked();
  openCopyGateModal();
  return false;
}

/**
 * เปิด Pop-up แจ้งเตือนสิทธิ์คัดลอกครบ 3 ครั้ง & สมัครสมาชิกฟรี
 */
function openCopyGateModal() {
  const overlay = document.getElementById('copy-gate-modal-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
  }
}

/**
 * ปิด Pop-up แจ้งเตือน
 */
function closeCopyGateModal(event, force = false) {
  const overlay = document.getElementById('copy-gate-modal-overlay');
  if (!overlay) return;
  if (!force && event && event.target !== overlay) return;
  overlay.classList.add('hidden');
  overlay.style.display = 'none';
}

/**
 * อัปเดตตัวบ่งชี้สิทธิ์การเข้าถึง (ถ้ามีบน UI)
 */
function updateAccessIndicator() {
  const badge = document.getElementById('guest-quota-badge');
  if (badge) {
    if (typeof state !== 'undefined' && state.user) {
      badge.classList.add('hidden');
    } else {
      const remaining = getGuestCopyRemaining();
      badge.textContent = `ทดลองคัดลอกเหลือ ${remaining}/${GUEST_COPY_LIMIT}`;
      badge.classList.remove('hidden');
    }
  }
}

/**
 * เริ่มต้นระบบ Access Control
 */
function initAccessSystem() {
  if (typeof state !== 'undefined' && state.user) {
    closeCopyGateModal(null, true);
  }
  updateAccessIndicator();
}

// Backward-compatibility helpers
function canCopyPrompt() {
  if (typeof state !== 'undefined' && state.user) return { allowed: true };
  const count = getGuestCopyCount();
  if (count < GUEST_COPY_LIMIT) {
    return { allowed: true, remaining: GUEST_COPY_LIMIT - count };
  }
  return { allowed: false, reason: 'guest_limit_reached', message: 'คุณใช้สิทธิ์ทดลองคัดลอกครบ 3 ครั้งแล้ว กรุณาสมัครสมาชิกฟรีเพื่อใช้งานไม่จำกัด' };
}

function recordCopyAction() {
  if (typeof state !== 'undefined' && state.user) return;
  const count = getGuestCopyCount();
  localStorage.setItem(GUEST_COPY_KEY, String(count + 1));
}
