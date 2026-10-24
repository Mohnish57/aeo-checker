import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { jsonLdScript } from "@/lib/json-ld";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const siteTitle = "AEO Checker | Score your site for ChatGPT, Claude, Gemini & Perplexity";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f9" },
    { media: "(prefers-color-scheme: dark)", color: "#f7f8f9" },
  ],
  colorScheme: "light",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteTitle,
    template: "%s | AEO Checker",
  },
  description:
    "Free AEO checker for founders. See how ChatGPT, Claude, Gemini and Perplexity read your website, what your score could be after fixes, and get copy-paste fix prompts for Webflow, WordPress, Wix, Lovable and more.",
  applicationName: "AEO Checker",
  keywords: [
    "AI SEO",
    "AEO audit",
    "GEO",
    "generative engine optimization",
    "AEO",
    "answer engine optimization",
    "LLM SEO",
    "ChatGPT SEO",
    "Gemini SEO",
    "Claude SEO",
    "Perplexity SEO",
    "AI crawlability",
    "llms.txt",
    "schema.org",
    "structured data audit",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: siteTitle,
    description:
      "Free AI visibility score, your score after fixes, and fix prompts made for your website builder.",
    url: siteUrl,
    siteName: "AEO Checker",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description:
      "Check whether a page is readable and citation-ready for AI answer engines.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  category: "technology",
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      {
        url: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const softwareSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "AEO Checker",
    description:
      "Free AEO and SEO audit tool. Score any page for ChatGPT, Claude, Gemini, and Perplexity visibility and get fix prompts tailored to your website builder.",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "SEO",
    operatingSystem: "Web",
    url: siteUrl,
    isAccessibleForFree: true,
    browserRequirements: "Requires JavaScript. Requires HTML5.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "AEO Checker",
    url: siteUrl,
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/?domain={domain}`,
      "query-input": "required name=domain",
    },
  };

  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body className="font-sans">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(softwareSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(websiteSchema) }}
        />
        <div className="isolate flex min-h-dvh flex-col">
          <div className="grow">{children}</div>
        </div>
      </body>
    </html>
  );
}
