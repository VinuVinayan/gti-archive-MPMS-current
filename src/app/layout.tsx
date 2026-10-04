import type { Metadata } from "next";

import { AppToaster } from "@/components/ui/app-toaster";

import "./globals.css";

export const metadata: Metadata = {
  title: "GTI Archive",
  description:
    "A secure project archive and workflow management platform for organizing projects, documents, approvals, and team collaboration.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        {process.env.FLUX_DEMO_MODE === "local" && (
          <div className="sticky top-0 z-[100] bg-amber-200 px-4 py-2 text-center text-sm font-semibold text-amber-950">
            DEMO / QA · Fake data · Local database · Email, cloud files and AI disabled
          </div>
        )}
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
