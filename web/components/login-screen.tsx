"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";

export function LoginScreen({ previewAvailable }: { previewAvailable: boolean }) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        password: data.get("password"),
        rememberMe: data.get("rememberMe") === "on",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error ?? "Unable to sign in.");
      setLoading(false);
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-art" aria-hidden="true">
          <Image src="/branding/cmotd_login_left_panel.webp" alt="" fill priority sizes="(max-width: 900px) 0px, 50vw" />
          <div className="login-art-shade" />
          <div className="login-art-copy">
            <span className="login-kicker">Enterprise Procurement</span>
            <h2>ProcureFlow</h2>
            <p>Controlled purchasing, approvals, finance, logistics and audit evidence in one command chain.</p>
          </div>
        </div>

        <div className="login-form-panel">
          <div className="login-form-inner">
            <Image className="company-wordmark" src="/branding/cmotd_company_wordmark.png" alt="Center for Marine and Offshore Technology Development" width={360} height={88} priority />
            <div className="login-title">
              <span className="product-mark">PF</span>
              <div><h1>Welcome back</h1><p>Sign in to continue to ProcureFlow.</p></div>
            </div>

            <form onSubmit={submit} className="login-form">
              <label><span>Username</span><div className="field-wrap"><UserRound size={17} /><input name="username" autoComplete="username" placeholder="Enter username" required /></div></label>
              <label><span>Password</span><div className="field-wrap"><LockKeyhole size={17} /><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter password" required /><button type="button" className="icon-button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
              <label className="remember-row"><input name="rememberMe" type="checkbox" /><span>Remember me</span></label>
              {error ? <div className="login-error">{error}</div> : null}
              <button className="primary-button" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}<ArrowRight size={17} /></button>
            </form>

            {previewAvailable ? <button className="preview-link" type="button" onClick={() => router.push("/preview")}>Open development interface preview</button> : null}
            <p className="login-footnote">Authorized users only · CMOTD ProcureFlow</p>
          </div>
        </div>
      </section>
    </main>
  );
}
