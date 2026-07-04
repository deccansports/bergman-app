export type BroadcastCameraStatus =
  | 'offline'
  | 'waiting_for_stream'
  | 'connecting'
  | 'live'
  | 'stopping'
  | 'archived'
  | 'authentication_failed'
  | 'invalid_stream_key'
  | 'connection_timed_out'
  | 'signal_lost'
  | 'recording'
  | 'error'
  | 'disabled';
export type BroadcastCameraType =
  | 'finish'
  | 'swim'
  | 'stage'
  | 'swim_exit'
  | 'transition'
  | 'transition_entry'
  | 'transition_exit'
  | 'bike'
  | 'bike_turnaround'
  | 'run'
  | 'aid_station'
  | 'awards'
  | 'medical'
  | 'interview'
  | 'expo'
  | 'mobile'
  | 'drone'
  | 'motorcycle'
  | 'lead_vehicle'
  | 'custom';
export type BroadcastProvider = 'cloudflare' | 'youtube' | 'mux' | 'aws_ivs' | 'custom_rtmp';

export type BroadcastSettings = {
  eventId: string;
  enableBroadcast: boolean;
  publicBroadcast: boolean;
  privateBroadcast: boolean;
  autoRecording: boolean;
  allowReplay: boolean;
  cameraSwitching: boolean;
  enableAthleteAutoCamera: boolean;
  lowLatencyMode: boolean;
  viewerChat: boolean;
  sponsorOverlay: boolean;
  updatedAt: string;
  updatedBy?: string | null;
};

export type BroadcastCamera = {
  cameraId: string;
  eventId: string;
  name: string;
  cameraType: BroadcastCameraType;
  provider: BroadcastProvider;
  locationMode?: 'fixed' | 'mobile';
  courseLocationId?: string | null;
  courseLocationName?: string | null;
  cloudflare?: {
    liveInputUid?: string | null;
    playbackUid?: string | null;
    playbackUrl?: string | null;
    playbackIframeUrl?: string | null;
    rtmpsPlaybackUrl?: string | null;
    webRTCPlaybackUrl?: string | null;
    videoUid?: string | null;
    recordingUid?: string | null;
    thumbnailUrl?: string | null;
    durationSeconds?: number | null;
    bitrate?: number | null;
    fps?: number | null;
    protocol?: string | null;
    currentViewers?: number | null;
    peakViewers?: number | null;
    averageViewers?: number | null;
    uptime?: number | null;
    rtmpsUrl?: string | null;
    streamKeyEncrypted?: string | null;
    recordingMode?: string | null;
  };
  status: BroadcastCameraStatus;
  priority: number;
  latitude?: number | null;
  longitude?: number | null;
  coverageRadius?: number | null;
  playbackDelay?: number | null;
  overlayTheme?: string | null;
  recordingQuality?: string | null;
  customMetadata?: Record<string, any> | null;
  viewerCount: number;
  latency: number;
  recordingEnabled: boolean;
  signal?: number | null;
  battery?: number | null;
  assignedLocation?: string | null;
  previewThumbnail?: string | null;
  lastConnectedAt?: string | null;
  lastDisconnectedAt?: string | null;
  lastStreamStartedAt?: string | null;
  lastStreamEndedAt?: string | null;
  lastHealthCheckAt?: string | null;
  healthScore?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type BroadcastSession = {
  sessionId: string;
  eventId: string;
  active: boolean;
  layout: 'single' | '2' | '4' | '9' | 'auto';
  selectedCameraIds: string[];
  startedAt?: string | null;
  endedAt?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
};

export type BroadcastEventSummary = {
  eventId: string;
  liveCameras: number;
  offlineCameras: number;
  connectingCameras: number;
  disabledCameras: number;
  currentViewers: number;
  averageLatency: number;
  networkHealth: 'good' | 'degraded' | 'poor';
};

export type BroadcastCourseLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  coverageRadius: number;
  aliases?: string[];
};

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
};
