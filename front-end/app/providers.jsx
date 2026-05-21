"use client";

import { FeedbackProvider } from "@/components/feedback/FeedbackProvider";

export default function Providers({ children }) {
  return <FeedbackProvider>{children}</FeedbackProvider>;
}
