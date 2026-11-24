import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { AppProviders } from "@/components/app-providers";
import "./globals.css";

// Self-hosted fonts (BUILD-001). The three families (Space Grotesk, IBM Plex
// Sans, IBM Plex Mono) are vendored as SIL OFL 1.1 woff2 under ./fonts, so the
// production build performs NO build-time Google Fonts fetch. Families, CSS
// variables, weights, and `display: swap` are preserved from the prior
// Google-hosted setup. See ./fonts/FONTS.md for provenance + checksums.
const spaceGrotesk = localFont({
  // Variable woff2 (weight axis 300–700) preserves the prior discrete 500/600/700.
  src: "./fonts/SpaceGrotesk-Variable.woff2",
  weight: "500 700",
  style: "normal",
  variable: "--font-space-grotesk",
  display: "swap",
});

const plexSans = localFont({
  src: [
    { path: "./fonts/IBMPlexSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexSans-SemiBold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexMono-SemiBold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Telvyn DID Portal", template: "%s · Telvyn" },
  description: "Telvyn PROMAX — enterprise DID management control plane.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce set by middleware in production (undefined in dev, where there is no CSP).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body>
        <AppProviders nonce={nonce}>{children}</AppProviders>
      </body>
    </html>
  );
}
