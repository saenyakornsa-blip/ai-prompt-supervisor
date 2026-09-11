# 🏛️ AI Prompt ศึกษานิเทศก์ (ทุกสังกัด) — คู่มือการติดตั้ง & Deploy

เว็บแอปพลิเคชันคลัง **AI Prompt เชิงยุทธศาสตร์สำหรับศึกษานิเทศก์ทุกสังกัด** (สพฐ., สช., อปท., สอศ., กทม., ตชด., สกร.) ครอบคลุม **4 เล่ม 16 บท รวม 315 Prompts** พร้อมระบบค้นหาอัจฉริยะ, กรองตามเสาหลัก/บริบท, คัดลอกแบบคลิกเดียว, ระบบสมาชิกผ่าน Supabase, ประวัติการใช้งาน และ Quick Guide 3 ขั้นตอน

---

## 📚 โครงสร้างคลัง 315 Prompts (4 เล่ม 16 บท)

| เล่ม | ชื่อเล่ม | จำนวนบท | จำนวน Prompts | จุดเน้นและขอบเขตภารกิจ |
|:---:|---|:---:|:---:|---|
| **เล่ม 1** | **การวิเคราะห์ข้อมูล วางแผน และยุทธศาสตร์การนิเทศ** | 4 บท | 75 Prompts | วินิจฉัยสารสนเทศ O-NET/NT/PISA, สังเคราะห์ SAR สถานศึกษา, แผนนิเทศบูรณาการ 4 ไตรมาส, ยกร่างโครงการนิเทศตามระเบียบงบประมาณ |
| **เล่ม 2** | **กระบวนการนิเทศ เทคนิคการโค้ช และชุมชนการเรียนรู้ (PLC)** | 4 บท | 80 Prompts | การนิเทศคลินิกครบวงจร, เทคนิค Coaching & Feedback แบบไม่ตัดสิน, นิเทศเชิงรุก Active Learning & สมรรถนะ, ขับเคลื่อน PLC เครือข่าย & Lesson Study |
| **เล่ม 3** | **เครื่องมือนิเทศ การวิจัย และการประเมินโครงการ** | 4 บท | 80 Prompts | พัฒนาเครื่องมือนิเทศและการหาคุณภาพ (IOC/Alpha), ระเบียบวิธีวิจัยพัฒนานิเทศ (R&D/CAR), สถิติวิเคราะห์เชิงปริมาณและคุณภาพ, การประเมินโครงการ (CIPP/SROI) |
| **เล่ม 4** | **การพัฒนางานตามข้อตกลง (วPA) และภาวะผู้นำทางวิชาการ** | 4 บท | 80 Prompts | การจัดทำข้อตกลง วPA (ว11/2564), ประเด็นท้าทายตามระดับวิทยฐานะ (ชำนาญการพิเศษ/เชี่ยวชาญ/เชี่ยวชาญพิเศษ), การประเมิน PA & SAR ศน., ภาวะผู้นำนิเทศเฉพาะสังกัด |
| **รวม** | **ครบถ้วนตามมาตรฐานวิชาชีพศึกษานิเทศก์** | **16 บท** | **315 Prompts** | **ครอบคลุมทุกมิติงานนิเทศการศึกษาไทย** |

---

## 🚀 วิธีนำขึ้น GitHub และเปิดใช้เว็บไซต์ฟรี (GitHub Pages)

### ขั้นตอนที่ 1: สร้าง Repository ใหม่บน GitHub
1. เข้าไปที่ [https://github.com/new](https://github.com/new)
2. ตั้งชื่อ Repository เช่น: `ai-prompt-supervisor`
3. เลือกเป็น **Public**
4. **ไม่ต้องติ๊ก** Add a README file (เพราะมีไฟล์ในเครื่องแล้ว)
5. กดปุ่ม **Create repository**

### ขั้นตอนที่ 2: อัปโหลดโค้ดจากเครื่องขึ้น GitHub
เปิด **PowerShell** หรือ **Command Prompt** ในโฟลเดอร์นี้ แล้วรันคำสั่งตามลำดับ:

```bash
# 1. เริ่มต้น git repository ในโฟลเดอร์นี้
git init

# 2. เพิ่มไฟล์ทั้งหมด
git add .

# 3. บันทึก commit แรก
git commit -m "feat: Initial release AI Prompt Supervisors (315 prompts across 4 books)"

# 4. ตั้งชื่อ branch หลักเป็น main
git branch -M main

# 5. เชื่อมต่อกับ GitHub (แทนที่ USERNAME ด้วยชื่อบัญชี GitHub ของคุณ)
git remote add origin https://github.com/USERNAME/ai-prompt-supervisor.git

# 6. อัปโหลดขึ้น GitHub
git push -u origin main
```

*(หากเคย `git init` แล้ว ให้รันเฉพาะข้อ 2, 3, 5, 6 ได้เลย)*

### ขั้นตอนที่ 3: เปิดใช้งาน GitHub Pages (ให้ทุกคนเข้าเว็บได้)
1. ไปที่หน้า GitHub Repository ของคุณ
2. คลิกที่เมนู **Settings** (แถบด้านบน)
3. เลือกเมนู **Pages** (เมนูด้านซ้าย)
4. ในส่วน **Build and deployment > Source** ให้เลือก **Deploy from a branch**
5. ในช่อง Branch ให้เลือก **main** และโฟลเดอร์ **/(root)**
6. กดปุ่ม **Save**
7. รอระบบประมาณ 1–2 นาที จะได้ URL เว็บไซต์ เช่น:
   ```text
   https://USERNAME.github.io/ai-prompt-supervisor/
   ```

---

## 🗄️ การสร้างฐานข้อมูล Supabase (ระบบสมาชิก & สถิติ)

> **หมายเหตุ:** เว็บไซต์สามารถทำงานได้ทันทีแบบ Standalone (Guest Mode) สามารถค้นหา ดู และคัดลอก Prompts ทั้ง 315 ตัวได้ทันทีโดยไม่ต้องต่อฐานข้อมูล  
> แต่หากต้องการเปิด **ระบบสมาชิก, ซิงก์รายการโปรดข้ามเครื่อง, บันทึกประวัติ และระบบให้คะแนนรีวิว 5 ดาว** ให้ทำตามขั้นตอนนี้:

### ขั้นตอนที่ 1: สมัครและสร้าง Project ใน Supabase
1. เข้าไปที่ [https://supabase.com](https://supabase.com) แล้วลงชื่อเข้าใช้ (ล็อกอินด้วย GitHub ได้ฟรี)
2. คลิกปุ่ม **New Project**
3. กรอกข้อมูล:
   - **Name:** `ai-prompt-supervisor`
   - **Database Password:** ตั้งรหัสผ่านที่ปลอดภัย (จำไว้ให้ดี)
   - **Region:** แนะนำเลือก `Singapore (ap-southeast-1)` เพื่อความเร็วสูงสุดในไทย
4. กด **Create new project** และรอระบบสร้างฐานข้อมูลประมาณ 1-2 นาที

### ขั้นตอนที่ 2: รัน SQL Setup สคริปต์
1. ในแดชบอร์ด Supabase ไปที่เมนูด้านซ้าย เลือก **SQL Editor**
2. คลิกปุ่ม **New query**
3. คัดลอกเนื้อหาทั้งหมดจากไฟล์ [`supabase-setup.sql`](./supabase-setup.sql) ไปวางในช่อง Query
4. กดปุ่ม **Run** (หรือกด `Ctrl + Enter`)
5. ระบบจะสร้างตารางและ View ดังต่อไปนี้:
   - `user_profiles` : ข้อมูลโปรไฟล์ศึกษานิเทศก์ (มี Trigger สร้างโปรไฟล์อัตโนมัติเมื่อสมัครสมาชิก)
   - `copy_events` : ประวัติการกดคัดลอก Prompt สำหรับวิเคราะห์แนวโน้ม
   - `favorites` : รายการโปรดที่บันทึกไว้ ซิงก์ทุกอุปกรณ์
   - `prompt_ratings` : คะแนนประเมิน 1-5 ดาว และข้อเสนอแนะเชิงวิชาการ
   - `v_dashboard_stats` : View สถิติการใช้งานสำหรับแสดงในหน้า Dashboard

### ขั้นตอนที่ 3: คัดลอก API Keys มาใส่ใน `config.js`
1. ใน Supabase ไปที่เมนู **Project Settings** (ไอคอนฟันเฟืองล่างซ้าย)
2. เลือกแถบ **API**
3. คัดลอกค่า 2 อย่าง:
   - **Project URL:** เช่น `https://xxxxxxxxxxxx.supabase.co`
   - **Project API Keys (anon / public):** รหัสยาวขึ้นต้นด้วย `eyJ...`
4. เปิดไฟล์ [`config.js`](./config.js) ในโปรเจกต์ แล้วแก้ไข:
   ```javascript
   const SUPABASE_CONFIG = {
     url: 'https://xxxxxxxxxxxx.supabase.co', // ใส่ Project URL ของคุณ
     anonKey: 'eyJhbGciOi...',               // ใส่ anon key ของคุณ
     enabled: true                           // เปลี่ยนจาก false เป็น true
   };
   ```
5. บันทึกไฟล์ และ commit/push ขึ้น GitHub:
   ```bash
   git add config.js
   git commit -m "chore: connect Supabase database"
   git push
   ```

---

## 📁 โครงสร้างโปรเจกต์

```text
supervisor-website/
├── index.html          # หน้าเว็บ SPA สไตล์ Academic Navy & Gold
├── style.css           # สไตล์ Responsive พร้อม Dark Mode และ Glassmorphism
├── app.js              # ระบบหลัก: Search, Filter, Modal, LLM Export, Analytics
├── access.js           # ระบบสิทธิ์การเข้าถึง (Open / Member / Gate)
├── config.js           # ไฟล์ตั้งค่า (Supabase URL, Anon Key, Site Settings)
├── supabase-setup.sql  # สคริปต์ SQL สร้างตารางและ RLS Policies
├── .gitignore          # ไฟล์ละเว้นที่ไม่ต้อง push ขึ้น Git
├── data/
│   └── prompts.js      # ฐานข้อมูล JSON รวม 315 Prompts (เล่ม 1-4 ครบถ้วน)
├── references/         # เอกสารอ้างอิงและคู่มือทั้ง 4 เล่มฉบับสมบูรณ์ (Markdown)
└── README.md           # คู่มือฉบับนี้
```

---

## 💻 การทดสอบบนเครื่องคอมพิวเตอร์ (Localhost)

สามารถรันเว็บเซิร์ฟเวอร์แบบเบา ๆ ผ่าน Python ได้ทันที:
```bash
# เปิดเทอร์มินัลในโฟลเดอร์นี้ แล้วรัน:
python -m http.server 8080
```
จากนั้นเปิดเบราว์เซอร์ไปที่: [http://localhost:8080](http://localhost:8080)

---
จัดทำขึ้นเพื่อยกระดับงานนิเทศการศึกษาไทยในยุคปัญญาประดิษฐ์ | 2568
