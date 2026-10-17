import "server-only";
import { db } from "../database";
import type { Chat } from "../../domain/records";
export const listChat = (id: string) =>
  db<Chat[]>(
    `report_chat_history?report_id=eq.${id}&select=*&order=created_at.desc,id.desc&limit=100`,
  );
export const conversationContext = (id: string) =>
  db<Chat[]>(
    `report_chat_history?report_id=eq.${id}&select=role,content&order=created_at.desc&limit=12`,
  );
export const appendConversation = (
  rows: Array<Omit<Chat, "id"> & { report_id: string }>,
) =>
  db<void>("report_chat_history", {
    method: "POST",
    body: JSON.stringify(rows),
  });
