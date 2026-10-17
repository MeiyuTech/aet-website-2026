import { handle } from "@/lib/eval/server/http/handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export { handle as GET, handle as POST, handle as PATCH };
