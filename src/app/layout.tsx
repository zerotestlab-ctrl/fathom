import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Outfit } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const sans = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
const serif = Fraunces({ subsets: ["latin"], variable: "--font-fraunces" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex" });

export const metadata: Metadata = {
  title: "Fathom — watch any EVM contract",
  description:
    "Index and watch any EVM contract, even unverified ones. Recover the ABI, index recent events, and alert on transfers, mints, admin changes, and proxy upgrades.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable} h-full`}>
      <body className="min-h-full antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
