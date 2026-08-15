"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type ReactNode } from "react";
import { e2eSession, isE2EMode } from "../lib/e2e-mode";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

export type MonetaAccount = {
  session: Session;
  signOut: () => Promise<void>;
};

export function MonetaAuthGate({ children }: { children: (account: MonetaAccount) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(hasSupabaseConfig);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (isE2EMode) {
    return children({ session: e2eSession, signOut: async () => undefined });
  }

  if (!hasSupabaseConfig) {
    return <main className="auth-shell"><section className="auth-card setup"><div className="auth-mark">M</div><span>DATABASE SETUP</span><h1>Connect Moneta to Supabase</h1><p>Add the two public Supabase values to the deployment environment, then redeploy.</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_ANON_KEY</code></section></main>;
  }

  if (loading) return <main className="auth-shell"><section className="auth-card loading"><div className="auth-mark">M</div><h1>Opening Moneta…</h1></section></main>;

  if (!session) {
    const sendMagicLink = async (event: React.FormEvent) => {
      event.preventDefault();
      if (!supabase || !email.trim()) return;
      setSubmitting(true);
      setMessage("");
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      setMessage(error ? error.message : "Check your email for a secure sign-in link.");
      setSubmitting(false);
    };

    return <main className="auth-shell"><section className="auth-card"><div className="auth-mark">M</div><span>PRIVATE MONEY WORKSPACE</span><h1>Your finances,<br /><em>available anywhere.</em></h1><p>Sign in with email. Each account can only access its own financial data and receipts.</p><form onSubmit={sendMagicLink}><label><span>EMAIL</span><input type="email" autoComplete="email" required value={email} placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} /></label><button disabled={submitting}>{submitting ? "Sending…" : "Email me a sign-in link"}</button></form>{message && <div className="auth-message" role="status">{message}</div>}<small>No password required · secure link expires automatically</small></section></main>;
  }

  return children({
    session,
    signOut: async () => {
      if (supabase) await supabase.auth.signOut();
    },
  });
}
