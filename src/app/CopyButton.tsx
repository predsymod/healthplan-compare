"use client";

import { useState } from "react";

// Copies text to the clipboard and says so. Falls back to selecting nothing if the browser blocks clipboard access.
export default function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
