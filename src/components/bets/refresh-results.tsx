"use client";
import {useRouter} from "next/navigation";
import {useTransition} from "react";
export function RefreshResults(){const router=useRouter(),[pending,start]=useTransition();return <button type="button" disabled={pending} onClick={()=>start(()=>router.refresh())} className="text-xs font-bold text-[var(--accent)]">{pending?'Checking…':'Refresh results'}</button>;}
