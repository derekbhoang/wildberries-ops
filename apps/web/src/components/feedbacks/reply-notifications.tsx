"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

const ReplyNotificationContext = createContext<
  ((message: string) => void) | null
>(null);

export function useReplyNotification() {
  const notify = useContext(ReplyNotificationContext);
  if (!notify) {
    throw new Error("ReplyComposer must be rendered inside ReplyNotifications.");
  }
  return notify;
}

export default function ReplyNotifications({
  children,
}: {
  children: ReactNode;
}) {
  const [message, setMessage] = useState("");

  return (
    <ReplyNotificationContext.Provider value={setMessage}>
      {message && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground">
          <p role="status" className="text-sm">
            {message}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Dismiss notification"
            onClick={() => setMessage("")}
          >
            Dismiss
          </Button>
        </div>
      )}
      {children}
    </ReplyNotificationContext.Provider>
  );
}
