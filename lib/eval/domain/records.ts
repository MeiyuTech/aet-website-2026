import type { SampleData } from "./report";
export type SavedReport = {
  id: string;
  name: string;
  content: SampleData;
  updated_at: string;
  created_at?: string;
  archived_at: string | null;
};
export type Revision = {
  id: string;
  created_at: string;
  created_by: string;
  content?: SampleData;
};
export type Chat = {
  id: string;
  role: string;
  content: string;
  image_urls: string[] | null;
  created_at: string;
};
