// src/lib/types/pages.ts
import type { ContentBlock } from './index';

export interface Page {
  id: string;
  title: string;
  slug: string;
  published: boolean;
  showInHeader: boolean;
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
  alt: string;
  dataAiHint?: string;
  eventId?: string | null;
  pageSlug?: string | null;
  showOnHomepage?: boolean;
}
