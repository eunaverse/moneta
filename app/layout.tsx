import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Moneta — Finances at a glance",
  description: "A private multi-currency budget dashboard with recurring costs and cash-flow forecasts.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Moneta — Finances at a glance",
    description: "A private budget dashboard with recurring costs and cash-flow forecasts",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Moneta financial planner" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
