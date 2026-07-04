// src/lib/types/pages.ts
import type { ContentBlock } from './index';

export interface Page {
  id: string;
  title: string;
  slug: string;
  published: boolean;
  requiresLogin?: boolean;
  showInHeader: boolean;
  showInFooter?: boolean;
  footerCategory?: string | null;
  blocks: ContentBlock[];
  url?: string | null;
  eventId?: string | null;
}

export interface FooterConfig {
  tagline?: string;
  htmlContent?: string;
  socials: {
    instagram?: string | null;
    facebook?: string | null;
    x?: string | null;
    youtube?: string | null;
    threads?: string | null;
  };
}

export interface HomepageSliderItem {
  id: string;
  type: 'image' | 'video';
  src: string;
  mobileSrc?: string | null;
  alt: string;
  dataAiHint?: string;
  mobileDataAiHint?: string | null;
  desktopFocusX?: number | null;
  desktopFocusY?: number | null;
  desktopZoom?: number | null;
  mobileFocusX?: number | null;
  mobileFocusY?: number | null;
  mobileZoom?: number | null;
  eventId?: string | null;
  pageSlug?: string | null;
  customUrl?: string | null;
  header?: string | null;
  description?: string | null;
  customLinkText?: string | null;
  showOnHomepage?: boolean;
  showWaitlistButton?: boolean;
}
