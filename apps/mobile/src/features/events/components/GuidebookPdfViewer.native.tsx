import { memo, useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Pdf from 'react-native-pdf';

import { useTheme } from '@/core/theme';
import { Text } from '@/shared/components';

import type { GuidebookPdfViewerProps } from './GuidebookPdfViewer';

function GuidebookPdfViewerComponent({
  uri,
  viewerKey,
  loadProgress,
  onLoadProgress,
  onLoadComplete,
  onPageChanged,
  onError,
}: GuidebookPdfViewerProps) {
  const theme = useTheme();
  // react-native-pdf treats a new source object as a new document. Progress
  // updates re-render this component, so keep the source reference stable and
  // avoid restarting the guidebook after it has opened.
  const source = useMemo(() => (uri ? { uri } : null), [uri]);

  const loading = (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm }}>
      <ActivityIndicator color={theme.colors.accent} />
      <Text variant="bodySmall" color="textMuted">
        Loading Athlete Guidebook...
      </Text>
      {loadProgress > 0 ? (
        <Text variant="caption" color="textMuted">
          {Math.round(loadProgress * 100)}%
        </Text>
      ) : null}
    </View>
  );

  if (!source) return loading;

  return (
    <Pdf
      key={`${viewerKey}-${uri}`}
      source={source}
      minScale={1}
      maxScale={4}
      spacing={8}
      horizontal={false}
      enableDoubleTapZoom
      showsVerticalScrollIndicator
      trustAllCerts={false}
      renderActivityIndicator={() => loading}
      onLoadProgress={onLoadProgress}
      onLoadComplete={onLoadComplete}
      onPageChanged={onPageChanged}
      onError={onError}
      style={{ flex: 1, backgroundColor: theme.colors.surface }}
    />
  );
}

// `react-native-pdf` can reset its viewport when its React tree is updated,
// even when the document URI is unchanged. The screen updates its loading and
// page indicators while a document is open, so only remount the PDF when the
// document itself (or an explicit retry) changes.
export const GuidebookPdfViewer = memo(
  GuidebookPdfViewerComponent,
  (previous, next) =>
    previous.uri === next.uri && previous.viewerKey === next.viewerKey,
);
