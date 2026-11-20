"use client";

import type { ReactNode } from "react";
import { DraftProvider } from "@/lib/draft";

export function Providers({ children }: { children: ReactNode }) {
  return <DraftProvider>{children}</DraftProvider>;
}
