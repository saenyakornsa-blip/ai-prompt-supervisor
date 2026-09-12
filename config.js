// ============================================================
// AI Prompt ศึกษานิเทศก์ (ทุกสังกัด) — Configuration
// ============================================================
// คำแนะนำการเชื่อมต่อ SUPABASE (Optional):
// 1. สมัครฟรีที่ https://supabase.com
// 2. สร้าง New Project
// 3. ไปที่ Settings > API แล้วนำ Project URL และ anon key มาใส่ด้านล่าง
// 4. เปลี่ยน enabled: true
// 5. นำคำสั่งจากไฟล์ supabase-setup.sql ไปรันใน SQL Editor ของ Supabase
// ============================================================

const SUPABASE_CONFIG = {
  url: 'https://bgthbihseqglxzsfguqy.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJndGhiaWhzZXFnbHh6c2ZndXF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwOTI3ODUsImV4cCI6MjEwNDY2ODc4NX0.P70FCUiwPl_zeeirp7wLPNwJB0qpQ5tpMk825e01ueU',
  publishableKey: 'sb_publishable_PQqR2oL00DuycGofIMq2bg_4hbWw1z9',
  enabled: true
};

// ============================================================
// ACCESS CONTROL — ระบบควบคุมการเข้าถึง
// ============================================================
const ACCESS_CONFIG = {
  // สิทธิ์การใช้งาน: ผู้เยี่ยมชม (ไม่ได้ล็อกอิน) ทดลองคัดลอกได้ 3 ครั้ง
  // สมาชิก (ล็อกอินแล้ว): คัดลอกได้ไม่จำกัด
  guestLimit: 3,
  freeCopiesPerGuest: 3,
  showWelcomePopup: false,
  welcomePopupDelay: 8000,
};

// Site configuration
const SITE_CONFIG = {
  name: 'AI Prompt ศึกษานิเทศก์ (ทุกสังกัด)',
  version: '1.0.0',
  promptsPerPage: 24,
  maxSearchSuggestions: 8,
  gaId: '',  // Google Analytics 4 ID เช่น 'G-XXXXXXXXXX'
};
