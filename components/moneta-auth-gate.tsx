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
    const signInWithGoogle = async () => {
      if (!supabase) return;
      setSubmitting(true);
      setMessage("");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) {
        setMessage(error.message);
        setSubmitting(false);
      }
    };

    return <main className="auth-shell"><section className="auth-card">
      <div className="auth-brand"><div className="auth-mark">M</div><strong>MONETA</strong></div>
      <span>YOUR PLAN, EXPLAINED</span>
      <h1>Know what you can spend.<br /><em>Make your money last.</em></h1>
      <p>Moneta turns your balances and planned bills into a monthly spending target through the date you choose.</p>
      <ul className="auth-benefits"><li>See a plan-safe monthly amount</li><li>Try purchases before you commit</li><li>Review and edit every assumption</li></ul>
      <button type="button" className="google-sign-in" disabled={submitting} onClick={signInWithGoogle}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.35Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.9A6.02 6.02 0 0 1 6.08 12c0-.66.11-1.3.31-1.9V7.51H3.04A10 10 0 0 0 2 12c0 1.61.38 3.13 1.04 4.49l3.35-2.59Z"/><path fill="#EA4335" d="M12 5.97c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.59C7.18 7.73 9.39 5.97 12 5.97Z"/></svg><span>{submitting ? "Opening Google…" : "Continue with Google"}</span></button>
      {message && <div className="auth-message" role="alert">{message}</div>}
      <small><strong>Your financial data stays private to your account.</strong> Sign in securely with Google. Moneta never receives your Google password.</small>
    </section></main>;
  }

  return children({
    session,
    signOut: async () => {
      if (supabase) await supabase.auth.signOut();
    },
  });
}
