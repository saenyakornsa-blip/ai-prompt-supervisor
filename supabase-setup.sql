-- ============================================================
-- AI Prompt ศึกษานิเทศก์ (ทุกสังกัด) — Supabase Production Setup SQL
-- รองรับระบบสมาชิก (Auth), สถิติการคัดลอก (Copy Events), 
-- รายการโปรด (Favorites), การประเมินและรีวิว 5 ดาว (Prompt Ratings)
-- ============================================================

-- 1. Profiles Table (ซิงก์อัตโนมัติจาก auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  affiliation TEXT, -- สังกัด เช่น สพฐ., สช., อปท., สอศ., กทม., ตชด., สกร.
  role TEXT DEFAULT 'supervisor',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON public.user_profiles;
CREATE POLICY "Users can read own profile" ON public.user_profiles
  FOR SELECT USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
CREATE POLICY "Users can insert own profile" ON public.user_profiles
  FOR INSERT WITH CHECK ((select auth.uid()) = id);

-- Trigger auto-create user_profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ป้องกันไม่ให้เรียกใช้ trigger function ผ่าน public API
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Copy Events Table (บันทึกสถิติการใช้งานทั้ง Guest และ Member)
CREATE TABLE IF NOT EXISTS public.copy_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  prompt_id TEXT NOT NULL,
  book_number INT,
  chapter_number INT,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- เพิ่มคอลัมน์ในกรณีที่สร้างตารางไว้ก่อนแล้ว
ALTER TABLE public.copy_events 
  ADD COLUMN IF NOT EXISTS book_number INT,
  ADD COLUMN IF NOT EXISTS chapter_number INT,
  ADD COLUMN IF NOT EXISTS session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_copy_events_prompt_id ON public.copy_events(prompt_id);
CREATE INDEX IF NOT EXISTS idx_copy_events_user_id ON public.copy_events(user_id);
CREATE INDEX IF NOT EXISTS idx_copy_events_book_number ON public.copy_events(book_number);

ALTER TABLE public.copy_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow insert copy events" ON public.copy_events;
CREATE POLICY "Allow insert copy events" ON public.copy_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (prompt_id IS NOT NULL AND length(trim(prompt_id)) > 0);

DROP POLICY IF EXISTS "Users can read own copy events" ON public.copy_events;
DROP POLICY IF EXISTS "Anyone can read copy events" ON public.copy_events;
CREATE POLICY "Anyone can read copy events" ON public.copy_events
  FOR SELECT TO anon, authenticated
  USING (true);

-- 3. Favorites Table (ซิงก์รายการโปรดข้ามอุปกรณ์)
CREATE TABLE IF NOT EXISTS public.favorites (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  prompt_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON public.favorites(user_id);

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Anyone can read favorites" ON public.favorites;
CREATE POLICY "Anyone can read favorites" ON public.favorites
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can insert own favorites" ON public.favorites;
CREATE POLICY "Users can insert own favorites" ON public.favorites
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own favorites" ON public.favorites;
CREATE POLICY "Users can delete own favorites" ON public.favorites
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- Backward compatibility view (กำหนด security_invoker = true เพื่อไม่ให้ข้าม RLS)
CREATE OR REPLACE VIEW public.user_favorites WITH (security_invoker = true) AS SELECT * FROM public.favorites;

-- 4. Prompt Ratings & User Feedback Table (ให้คะแนน 1-5 ดาวและคำแนะนำ)
CREATE TABLE IF NOT EXISTS public.prompt_ratings (
  id BIGSERIAL PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  user_name TEXT,
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_ratings_prompt_id ON public.prompt_ratings(prompt_id);

ALTER TABLE public.prompt_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view ratings" ON public.prompt_ratings;
CREATE POLICY "Anyone can view ratings" ON public.prompt_ratings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert or update own ratings" ON public.prompt_ratings;
CREATE POLICY "Users can insert or update own ratings" ON public.prompt_ratings
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- Backward compatibility view (กำหนด security_invoker = true เพื่อไม่ให้ข้าม RLS)
CREATE OR REPLACE VIEW public.user_feedback WITH (security_invoker = true) AS SELECT * FROM public.prompt_ratings;

-- 5. Dashboard Stats View (สถิติแดชบอร์ดส่วนบุคคล)
CREATE OR REPLACE VIEW public.v_dashboard_stats WITH (security_invoker = true) AS
SELECT
  COUNT(*) AS total_copies,
  COUNT(DISTINCT prompt_id) AS unique_prompts_used,
  COUNT(DISTINCT DATE(created_at)) AS active_days
FROM public.copy_events
WHERE user_id = auth.uid();

-- ============================================================
-- 6. COMMUNITY FEEDBACK TABLE (ระบบเสียงสะท้อน & ขอ Prompt เพิ่ม)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.community_feedback (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  role_or_school TEXT,
  category TEXT DEFAULT 'ข้อเสนอแนะงานนิเทศ',
  message TEXT NOT NULL,
  rating INTEGER DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_featured BOOLEAN DEFAULT false
);

ALTER TABLE public.community_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read feedback" ON public.community_feedback;
CREATE POLICY "Anyone can read feedback" ON public.community_feedback
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON public.community_feedback;
CREATE POLICY "Authenticated users can insert feedback" ON public.community_feedback
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id AND message IS NOT NULL AND length(message) >= 3);

DROP POLICY IF EXISTS "Users can update own feedback" ON public.community_feedback;
CREATE POLICY "Users can update own feedback" ON public.community_feedback
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id AND message IS NOT NULL AND length(message) >= 3);

DROP POLICY IF EXISTS "Users can delete own feedback" ON public.community_feedback;
CREATE POLICY "Users can delete own feedback" ON public.community_feedback
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- 7. RPC Functions สำหรับ Dynamic Community Dashboard (4 เล่ม)
-- ============================================================

-- ซิงค์ผู้ใช้ทุกคนใน auth.users เข้าตาราง user_profiles (เพื่อให้ข้อมูลตรงกัน)
INSERT INTO public.user_profiles (id, email, display_name)
SELECT 
  id, 
  email,
  COALESCE(raw_user_meta_data->>'display_name', split_part(email, '@', 1))
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- อนุญาตให้อ่านโปรไฟล์และนับจำนวนสมาชิกได้
DROP POLICY IF EXISTS "Anyone can read user_profiles" ON public.user_profiles;
CREATE POLICY "Anyone can read user_profiles" ON public.user_profiles FOR SELECT TO anon, authenticated USING (true);

-- 1. ภาพรวมตัวเลขสถิติทั้งระบบ (SECURITY INVOKER + SET search_path = public)
CREATE OR REPLACE FUNCTION public.get_community_overview()
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'total_members', (SELECT count(*) FROM public.user_profiles),
    'total_copies', (SELECT count(*) FROM public.copy_events),
    'total_favorites', (SELECT count(*) FROM public.favorites),
    'total_feedback', (SELECT count(*) FROM public.community_feedback)
  ) INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_community_overview() TO anon, authenticated;

-- 2. 10 อันดับ Prompt ยอดนิยม
CREATE OR REPLACE FUNCTION public.get_top_prompts(limit_count int DEFAULT 10)
RETURNS TABLE (prompt_id text, total_copies bigint)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT prompt_id, count(*) as total_copies
  FROM public.copy_events
  GROUP BY prompt_id
  ORDER BY total_copies DESC
  LIMIT limit_count;
$$;

GRANT EXECUTE ON FUNCTION public.get_top_prompts(int) TO anon, authenticated;

-- 3. สถิติการใช้งานแยกตาม 4 เล่ม
CREATE OR REPLACE FUNCTION public.get_book_usage_stats()
RETURNS TABLE (book_number int, total_copies bigint)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT book_number, count(*) as total_copies
  FROM public.copy_events
  WHERE book_number IS NOT NULL AND book_number BETWEEN 1 AND 4
  GROUP BY book_number
  ORDER BY book_number;
$$;

GRANT EXECUTE ON FUNCTION public.get_book_usage_stats() TO anon, authenticated;

-- 4. สถิติกิจกรรมย้อนหลัง 7 วัน
CREATE OR REPLACE FUNCTION public.get_daily_usage_stats(days_back int DEFAULT 7)
RETURNS TABLE (usage_date date, copy_count bigint)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DATE(created_at) as usage_date, count(*) as copy_count
  FROM public.copy_events
  WHERE created_at >= NOW() - (days_back || ' days')::interval
  GROUP BY DATE(created_at)
  ORDER BY usage_date ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_usage_stats(int) TO anon, authenticated;

