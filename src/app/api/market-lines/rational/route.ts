import { NextResponse } from "next/server";

import { applyRationalMarketLines } from "@/lib/market-lines";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { raceId?: number };
  const raceId = Number(body.raceId);

  if (!Number.isFinite(raceId)) {
    return NextResponse.json({ error: "raceId is required." }, { status: 400 });
  }

  try {
    return NextResponse.json(applyRationalMarketLines(raceId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to apply rational lines." },
      { status: 400 }
    );
  }
}
