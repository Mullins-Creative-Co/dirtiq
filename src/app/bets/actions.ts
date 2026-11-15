"use server";

import { revalidatePath } from "next/cache";
import { parseBetInput, prepareBetEdit } from "@/lib/my-bets/input";

import { addBet, deleteBet, setBetStatus, getBet, updateBet, settleOpenBets } from "@/lib/my-bets";
import { BET_STATUSES, type BetStatus } from "@/lib/my-bets/grade";

export async function logBetAction(fd: FormData): Promise<{ error?: string; id?: number }> {
  const input = parseBetInput(fd);
  if ("error" in input) return input;
  const bet = await addBet(input.bet,input.grading);
  await settleOpenBets([bet]);
  revalidatePath("/bets");
  return {id:bet.id};
}

export async function updateBetAction(fd: FormData): Promise<{ error?: string; id?: number }> {
  const id = Number(fd.get("id"));
  if (!Number.isSafeInteger(id)||id<=0) return {error:"Invalid bet."};
  const previous = await getBet(id);
  if (!previous) return {error:"That bet no longer exists."};
  const input = parseBetInput(fd);
  if ("error" in input) return input;
  const edited = prepareBetEdit(previous,input);
  const bet = await updateBet(id,edited.bet,edited.grading);
  if (!bet) return {error:"That bet no longer exists."};
  await settleOpenBets([bet]);
  revalidatePath("/bets");
  return {id};
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
