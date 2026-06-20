"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ACCOUNT_NAME_KEY } from "@/components/account-picker-form";

export function RememberAccountRedirect({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    const savedName = localStorage.getItem(ACCOUNT_NAME_KEY)?.trim();
    if (savedName) {
      router.replace(`/bet?name=${encodeURIComponent(savedName)}`);
    }
  }, [enabled, router]);

  return null;
}
