import { createElement } from 'react';

import { useTheme } from '@/core/theme';

import type { GuidebookPdfViewerProps } from './GuidebookPdfViewer';
import { getPdfViewerFallbackUrl, isDirectPdfUrl } from '../utils/guidebook';

export function GuidebookPdfViewer({ uri, viewerKey }: GuidebookPdfViewerProps) {
  const theme = useTheme();
  // Mobile browsers, especially iOS Safari, do not reliably paginate a PDF
  // inside an iframe. Google’s document viewer supplies a scrollable,
  // multi-page viewer for public direct-PDF URLs. Drive preview URLs already
  // have their own document viewer, so leave those untouched.
  const viewerUri = uri && isDirectPdfUrl(uri) ? getPdfViewerFallbackUrl(uri) : uri ?? '';

  return createElement('iframe', {
    key: viewerKey,
    src: viewerUri,
    title: 'Athlete Guidebook PDF',
    scrolling: 'yes',
    style: {
      display: 'block',
      border: '0',
      flex: 1,
      width: '100%',
      height: '100%',
      minHeight: 'calc(100vh - 180px)',
      backgroundColor: theme.colors.surface,
    },
  });
}
