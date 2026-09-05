import type { Metadata } from "next";
import "./globals.css";
import "./live-data.css";
import "./facility.css";
import "./approver.css";

export const metadata: Metadata = {
  title: "ProcureFlow",
  description: "CMOTD enterprise procurement command centre",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
