import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Health plan compare",
  description: "Educational ACA plan cost comparison. Not medical advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
