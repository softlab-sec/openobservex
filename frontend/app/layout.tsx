import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenObserveX",
  description: "Full-stack observability platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly)
          inject attributes into <body> before React hydrates. */}
      <body className="min-h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
