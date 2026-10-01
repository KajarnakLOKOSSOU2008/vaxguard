import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VaxGuard — Edge-AI Cold-Chain Monitoring",
  description: "VaxGuard — predictive Edge-AI cold-chain monitoring for the last-mile vaccine transport. CNN-GRU model, INT8-quantized, ESP32-S3 ready.",
  keywords: ["VaxGuard", "Edge-AI", "TinyML", "CNN-GRU", "PyTorch", "ESP32", "cold-chain", "vaccine", "Benin"],
  authors: [{ name: "VaxGuard Team" }],
  openGraph: {
    title: "VaxGuard — Edge-AI Cold-Chain",
    description: "Predictive CNN-GRU model for vaccine transport — INT8-quantized, ESP32-S3 ready.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
