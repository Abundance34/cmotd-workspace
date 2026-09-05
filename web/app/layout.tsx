import type { Metadata } from "next";
import "./globals.css";
import "./live-data.css";
import "./facility.css";
import "./approver.css";
import "./finance.css";
import "./logistics.css";
import "./auditor.css";
import "./admin.css";
import "./income.css";
import "./settings.css";

export const metadata: Metadata = {
  title: "ProcureFlow",
  description: "CMOTD enterprise procurement command centre",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
