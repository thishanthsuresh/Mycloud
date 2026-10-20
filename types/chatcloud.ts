// Types for the ChatCloud module. They mirror the tables in supabase/chatcloud.sql.

export type CloudFile = {
  id: string;
  user_id: string;
  display_name: string;
  original_name: string;
  category: string;
  mime_type: string | null;
  size_bytes: number;
  storage_path: string;
  ai_status: "ai" | "fallback";
  source?: string;
  last_accessed_at: string | null;
  created_at: string;
};

export type ChatcloudCategory = {
  id: string;
  user_id: string;
  name: string;
  file_count: number;
  created_at: string;
};

export type Renewal = {
  id: string;
  user_id: string;
  file_id: string | null;
  title: string;
  category: string;
  due_date: string; // YYYY-MM-DD
  remind_days_before: number;
  remind_at: string | null;
  repeat_months: number | null;
  status: "active" | "renewed";
  notes: string | null;
  created_at: string;
};

export type RenewalInput = {
  title: string;
  category: string;
  due_date: string;
  remind_days_before: number;
  remind_at: string | null;
  repeat_months: number | null;
  file_id: string | null;
  notes: string | null;
  status: "active" | "renewed";
};
