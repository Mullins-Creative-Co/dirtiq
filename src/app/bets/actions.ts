"use server";

import { revalidatePath } from "next/cache";
import { parseBetInput, prepareBetEdit } from "@/lib/my-bets/input";

import { betSaveError, addCardBet, addBet, deleteBet, setBetStatus, getBet, updateBet, settleOpenBets } from "@/lib/my-bets";
import { getTeamNames } from "@/lib/model-reports";
import { buildCardView } from "@/lib/card";
import { cardBetInputs } from "@/lib/my-bets/card";
import { BET_STATUSES, type MyBet, type BetStatus } from "@/lib/my-bets/grade";

export async function logBetAction(fd: FormData): Promise<{ error?: string; id?: number; bet?: MyBet }> {
  const storageError = betSaveError();
  if (storageError) return {error:storageError};
  const input = parseBetInput(fd);
  if ("error" in input) return input;
  const bet = await addBet(input.bet,input.grading);
  await settleOpenBets([bet]);
  revalidatePath("/bets");
  return {id:bet.id,bet};
}

export async function updateBetAction(fd: FormData): Promise<{ error?: string; id?: number; bet?: MyBet }> {
  const id = Number(fd.get("id"));
  if (!Number.isSafeInteger(id)||id<=0) return {error:"Invalid bet."};
  const previous = await getBet(id);
  if (!previous) return {error:"That bet no longer exists."};
  const storageError = betSaveError();
  if (storageError) return {error:storageError};
  const input = parseBetInput(fd);
  if ("error" in input) return input;
  const edited = prepareBetEdit(previous,input);
  const bet = await updateBet(id,edited.bet,edited.grading);
  if (!bet) return {error:"That bet no longer exists."};
  await settleOpenBets([bet]);
  revalidatePath("/bets");
  return {id,bet};
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

export async function logCardBetsAction(date: string): Promise<{bets:MyBet[];added:number;existing:number;error?:string}> {
  const response = {bets:[] as MyBet[],added:0,existing:0,error:undefined as string|undefined};
  const storageError = betSaveError();
  if (storageError) return {...response,error:storageError};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return {...response,error:"Choose a saved card date."};
  const view = await buildCardView(date);
  const card = view ? { ...view, picks: view.picks.map(p => view.today === date && p.live ? { ...p, line: p.live.line, price: p.live.price ?? p.price } : p) } : null;
  if (!card) return {...response,error:"This saved card is unavailable."};
  try {
    for (const input of cardBetInputs(card,getTeamNames())) {
      const result = await addCardBet(input);
      response.bets.push(result.bet);
      if (result.added) response.added++; else response.existing++;
    }
    await settleOpenBets(response.bets);
  } catch {
    response.error = "Some saves could not be confirmed. Try again; already logged picks will be skipped.";
  }
  revalidatePath("/bets");
  return response;
}
