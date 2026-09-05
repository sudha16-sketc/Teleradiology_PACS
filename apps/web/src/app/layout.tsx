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
  title: "Axis",
  description: "Teleradiology PACS Workflow Platform",
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
