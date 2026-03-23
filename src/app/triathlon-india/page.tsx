
// src/app/triathlon-india/page.tsx
import type { Metadata } from 'next';
import { TriathlonIndiaContent } from './content';
import ClientSideContent from '@/components/shared/ClientSideContent';

export const metadata: Metadata = {
  title: "Triathlon in India | Bergman Triathlon & Swimathon Events",
  description:
    "Discover triathlon and swimathon events in India with Bergman Triathlon. Participate in open water swimming, Olympic triathlon races and endurance sports competitions across India.",
  keywords:
    "Triathlon India, Swimathon India, Pune Triathlon, Open Water Swimming India, Bergman Triathlon, Endurance Race India",

  alternates: {
    canonical: "https://bergmantri.com/triathlon-india",
  },

  robots: {
    index: true,
    follow: true,
  },

  openGraph: {
    title: "Triathlon in India | Bergman Triathlon",
    description:
      "Explore triathlon and swimathon events in India hosted by Bergman Triathlon.",
    url: "https://bergmantri.com/triathlon-india",
    siteName: "Bergman Triathlon",
    images: [
      {
        url: "https://bergmantri.com/og-triathlon-india.jpg",
        width: 1200,
        height: 630,
      },
    ],
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "Triathlon in India | Bergman Triathlon",
    description:
      "Discover triathlon and swimathon events in India with Bergman Triathlon.",
    images: ["https://bergmantri.com/og-triathlon-india.jpg"],
  },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Bergman Triathlon",
  "url": "https://bergmantri.com",
  "logo": "https://bergmantri.com/favicon.png",
  "sameAs": [
    "https://www.instagram.com/bergmantriathlon",
    "https://www.facebook.com/bergmantriathlon"
  ]
};

const eventSchema = {
  "@context": "https://schema.org",
  "@type": "SportsEvent",
  name: "Bergman Ozar Pune Triathlon",
  sport: "Triathlon",
  startDate: "2026-10-04",
  eventStatus: "https://schema.org/EventScheduled",
  eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
  location: {
    "@type": "Place",
    name: "Ozar Dam",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Ozar",
      addressRegion: "Maharashtra",
      addressCountry: "India"
    }
  },
  organizer: {
    "@type": "Organization",
    name: "Bergman Triathlon",
    url: "https://bergmantri.com"
  }
};

const breadcrumbSchema = {
 "@context": "https://schema.org",
 "@type": "BreadcrumbList",
 "itemListElement": [
   {
     "@type": "ListItem",
     "position": 1,
     "name": "Home",
     "item": "https://bergmantri.com"
   },
   {
     "@type": "ListItem",
     "position": 2,
     "name": "Triathlon India",
     "item": "https://bergmantri.com/triathlon-india"
   }
 ]
};

export default function TriathlonIndiaPage() {
  return (
    <main className="bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(eventSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      
      <header className="hero bg-gradient-to-br from-[#0B5ED7] to-[#0A2F6B] text-white py-24 md:py-32 px-6 text-center">
        <div className="container mx-auto">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tighter text-white mb-6">
            Triathlon & Swimathon Events in India
          </h1>
          <p className="max-w-2xl mx-auto text-lg md:text-xl text-blue-50/90 leading-relaxed">
            Discover endurance sports through Bergman Triathlon – one of India&apos;s fastest growing 
            multisport and open water swimming race platforms.
          </p>
        </div>
      </header>
      
      <div className="container mx-auto px-6 py-12 md:py-20">
        <ClientSideContent>
          <div className="prose prose-blue dark:prose-invert max-w-none">
            <TriathlonIndiaContent />
          </div>
        </ClientSideContent>
      </div>
    </main>
  );
}
