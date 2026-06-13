"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 30_000;

export function LivePolling({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [enabled, router]);

  return null;
}
