import type { BroadcastProvider } from '@/lib/types/broadcast';

export type CreateLiveInputParams = {
  name: string;
  meta?: Record<string, string>;
};

export type CreateLiveInputResult = {
  liveInputUid: string;
  rtmpsUrl: string;
  streamKey: string;
  playbackUid: string | null;
};

export type BroadcastProviderService = {
  provider: BroadcastProvider;
  createLiveInput(params: CreateLiveInputParams): Promise<CreateLiveInputResult>;
  deleteLiveInput(liveInputUid: string): Promise<void>;
  getLiveInput(liveInputUid: string): Promise<any>;
  listLiveInputs(): Promise<any[]>;
  getPlaybackUrl(playbackUid: string): string;
  getViewerCounts(playbackUid: string): Promise<number>;
};
