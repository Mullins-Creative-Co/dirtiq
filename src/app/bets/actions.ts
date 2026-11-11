"use server";

import { revalidatePath } from "next/cache";

import { addBet, deleteBet, setBetStatus } from "@/lib/my-bets";
import { BET_MARKETS, BET_STATUSES, parsePrice, type BetMarket, type BetStatus } from "@/lib/my-bets/grade";

function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function optionalNumber(fd: FormData, key: string): number | null {
  const s = text(fd, key);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function logBetAction(fd: FormData): Promise<{ error?: string; id?: number }> {
  const sport = text(fd, "sport").toLowerCase();
  const eventLabel = text(fd, "eventLabel");
  const market = text(fd, "market") as BetMarket;
  const selection = text(fd, "selection");
  const price = parsePrice(text(fd, "price"));
  const stake = optionalNumber(fd, "stake");
  if (!sport) return { error: "Pick a sport." };
  if (!eventLabel) return { error: "Name the game or race." };
  if (!BET_MARKETS.includes(market)) return { error: "Pick a market." };
  if (!selection) return { error: "Enter the selection." };
  if (price === null) return { error: "Price must be an American price such as -110 or +150." };
  if (stake === null || stake <= 0) return { error: "Stake must be a positive amount." };
  const line = optionalNumber(fd, "line");
  if ((market === "spread" || market === "total") && line === null) return { error: `A ${market} bet needs a line.` };
  const placedRaw = text(fd, "placedAt");
  const placedAt = placedRaw ? new Date(placedRaw).toISOString() : new Date().toISOString();
  const eventId = text(fd, "eventId") || null;
  const selectionLabel = text(fd, "selectionLabel") || (market === "spread" && line !== null ? `${selection} ${line > 0 ? "+" : ""}${line}` : market === "total" ? `${selection} ${line}` : market === "moneyline" ? `${selection} ML` : selection);
  const bet = await addBet({
    sport, eventId, eventLabel, eventStart: text(fd, "eventStart") || null, market, selection, selectionLabel, line, price, stake,
    book: text(fd, "book") || null, note: text(fd, "note") || null,
    modelProb: optionalNumber(fd, "modelProb"), marketProb: optionalNumber(fd, "marketProb"), placedAt,
  });
  revalidatePath("/bets");
  return { id: bet.id };
}

export async function deleteBetAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (Number.isFinite(id)) await deleteBet(id);
  revalidatePath("/bets");
}

export async function setBetStatusAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  const status = String(fd.get("status")) as BetStatus;
  if (Number.isFinite(id) && BET_STATUSES.includes(status)) await setBetStatus(id, status, status !== "open");
  revalidatePath("/bets");
}
