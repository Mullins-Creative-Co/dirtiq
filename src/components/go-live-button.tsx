"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRaceLiveAction } from "@/app/actions";

export function GoLiveButton({ raceId, isLive }: { raceId: number; isLive: boolean }) {
  const [live, setLive] = useState(isLive);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    const next = !live;
    startTransition(async () => {
      await setRaceLiveAction(raceId, next);
      setLive(next);
      router.refresh();
    });
  }

  if (live) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="rounded-full border border-red-500/50 px-3 py-1 text-sm font-semibold text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
      >
        {pending ? "…" : "End Live"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className="rounded-full bg-amber-500 px-3 py-1 text-sm font-semibold text-black hover:opacity-90 transition-opacity disabled:opacity-50"
    >
      {pending ? "…" : "Go Live"}
    </button>
  );
}
