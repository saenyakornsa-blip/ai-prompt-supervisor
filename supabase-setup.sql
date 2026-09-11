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

CREATE POLICY "Users can read own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Trigger auto-create user_profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Copy Events Table (บันทึกสถิติการใช้งานทั้ง Guest และ Member)
CREATE TABLE IF NOT EXISTS public.copy_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  prompt_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copy_events_prompt_id ON public.copy_events(prompt_id);
CREATE INDEX IF NOT EXISTS idx_copy_events_user_id ON public.copy_events(user_id);

ALTER TABLE public.copy_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow insert copy events" ON public.copy_events
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can read own copy events" ON public.copy_events
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

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

CREATE POLICY "Users can view own favorites" ON public.favorites
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own favorites" ON public.favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own favorites" ON public.favorites
  FOR DELETE USING (auth.uid() = user_id);

-- Backward compatibility view
CREATE OR REPLACE VIEW public.user_favorites AS SELECT * FROM public.favorites;

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

CREATE POLICY "Anyone can view ratings" ON public.prompt_ratings
  FOR SELECT USING (true);

CREATE POLICY "Users can insert or update own ratings" ON public.prompt_ratings
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Backward compatibility view
CREATE OR REPLACE VIEW public.user_feedback AS SELECT * FROM public.prompt_ratings;

-- 5. Dashboard Stats View (สถิติแดชบอร์ดส่วนบุคคล)
CREATE OR REPLACE VIEW public.v_dashboard_stats WITH (security_invoker = true) AS
SELECT
  COUNT(*) AS total_copies,
  COUNT(DISTINCT prompt_id) AS unique_prompts_used,
  COUNT(DISTINCT DATE(created_at)) AS active_days
FROM public.copy_events
WHERE user_id = auth.uid();
