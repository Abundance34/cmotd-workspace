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
import "./parity.css";
import "./minia-theme.css";
import "./minia-theme-polish.css";
import "./minia-theme-controls.css";
import "./local-request-authoring.css";
import { ConfirmationCenter } from "@/components/in-app-confirmation";

export const metadata: Metadata = {
  title: "ProcureFlow",
  description: "CMOTD enterprise procurement command centre",
};

const themeBoot = `
(function(){
  try {
    var saved = localStorage.getItem('procureflow-theme');
    var theme = saved === 'dark' || saved === 'light' ? saved : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
  } catch (_) {}
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeBoot}} /></head><body>{children}<ConfirmationCenter /></body></html>;
}
