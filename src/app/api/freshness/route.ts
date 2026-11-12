import { getFreshness } from "@/lib/freshness";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(await getFreshness(), { headers: { "Cache-Control": "no-store" } });
}
