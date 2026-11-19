import type { Metadata } from "next";
import { Inter, Inter_Tight, IBM_Plex_Mono, Source_Serif_4 } from "next/font/google";
import { Providers } from "./providers";
import { themeBootScript } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

const sourceSerif4 = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Axis — Teleradiology PACS & Clinical Reporting",
    template: "%s | Axis",
  },
  applicationName: "Axis",
  description:
    "Axis connects hospitals, radiologists, and workflow managers with a secure teleradiology PACS, reporting, and study delivery platform.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
  openGraph: {
    type: "website",
    siteName: "Axis",
    title: "Axis — Teleradiology PACS & Clinical Reporting",
    description:
      "A secure workflow platform for study submission, radiology reporting, review, and hospital delivery.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Axis — Teleradiology PACS & Clinical Reporting",
    description:
      "A secure workflow platform for study submission, radiology reporting, review, and hospital delivery.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeBootScript() }}
        />
      </head>
      <body
        className={`${inter.variable} ${ibmPlexMono.variable} ${interTight.variable} ${sourceSerif4.variable}`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
