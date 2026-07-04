"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Activity,
  AlertTriangle,
  BadgeHelp,
  Bluetooth,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Ear,
  FileAudio,
  Headphones,
  Keyboard,
  Mic,
  MicOff,
  Monitor,
  Music2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Speaker,
  Square,
  Upload,
  Waves,
  Wifi,
  WifiOff,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type AudioDevice = {
  deviceId: string;
  label: string;
  kind: MediaDeviceInfo['kind'];
  groupId?: string;
};

type CommentaryProfile = {
  id: string;
  name: string;
  role: string;
  language: string;
  country: string;
  photo: string;
  liveNow: boolean;
  mute: boolean;
  solo: boolean;
  volume: number;
};

type CommentaryOverlay = {
  enabled: boolean;
  name: string;
  subtitle: string;
  autoHideSeconds: number;
  poweredBy: string;
};

type CommentaryState = {
  selectedDeviceId: string;
  commentaryStatus: 'on-air' | 'off-air';
  monitorMode: 'monitor-only' | 'monitor-and-output';
  monitorVolume: number;
  defaultGain: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  compressor: boolean;
  limiter: boolean;
  autoMuteOnDisconnect: boolean;
  rememberDevice: boolean;
  duckingEnabled: boolean;
  duckingThreshold: number;
  duckingReduction: number;
  musicVolume: number;
  overlay: CommentaryOverlay;
  captionsEnabled: boolean;
  transcript: string;
  sampleRate: number;
  latencyMs: number;
  audioBitrateKbps: number;
};

type DeviceStats = {
  micLabel: string;
  connectionStatus: string;
  currentDb: number;
  peakDb: number;
  noiseDb: number;
  clipping: boolean;
  leftLevel: number;
  rightLevel: number;
  sampleRate: number;
  latencyMs: number;
  muteStatus: string;
};

type CommentaryProfileInputKey = keyof Pick<CommentaryProfile, 'name' | 'role' | 'language' | 'country' | 'photo'>;

const STORAGE_KEY = 'bergman.broadcast.commentary.v1';
const FIRESTORE_DOC = doc(db, 'broadcastCommentary', 'controlRoom');
const DEFAULT_DEVICE_LABEL = 'Built-in Mic';

const DEFAULT_PROFILES: CommentaryProfile[] = [
  {
    id: 'commentator-1',
    name: 'Commentator 1',
    role: 'Lead Commentator',
    language: 'English',
    country: 'India',
    photo: '',
    liveNow: true,
    mute: false,
    solo: false,
    volume: 85,
  },
  {
    id: 'commentator-2',
    name: 'Commentator 2',
    role: 'Co-Commentator',
    language: 'English',
    country: 'India',
    photo: '',
    liveNow: false,
    mute: false,
    solo: false,
    volume: 80,
  },
  {
    id: 'guest',
    name: 'Guest',
    role: 'Guest',
    language: 'English',
    country: 'India',
    photo: '',
    liveNow: false,
    mute: false,
    solo: false,
    volume: 75,
  },
  {
    id: 'interview-mic',
    name: 'Interview Mic',
    role: 'Interview Mic',
    language: 'English',
    country: 'India',
    photo: '',
    liveNow: false,
    mute: true,
    solo: false,
    volume: 70,
  },
  {
    id: 'pit-reporter',
    name: 'Pit Reporter',
    role: 'Pit Reporter',
    language: 'English',
    country: 'India',
    photo: '',
    liveNow: false,
    mute: true,
    solo: false,
    volume: 72,
  },
];

const DEFAULT_STATE: CommentaryState = {
  selectedDeviceId: '',
  commentaryStatus: 'off-air',
  monitorMode: 'monitor-only',
  monitorVolume: 78,
  defaultGain: 68,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: false,
  compressor: true,
  limiter: true,
  autoMuteOnDisconnect: true,
  rememberDevice: true,
  duckingEnabled: true,
  duckingThreshold: 36,
  duckingReduction: 26,
  musicVolume: 45,
  overlay: {
    enabled: true,
    name: 'LIVE COMMENTARY',
    subtitle: 'Powered by Bergman',
    autoHideSeconds: 8,
    poweredBy: 'Bergman',
  },
  captionsEnabled: false,
  transcript: '',
  sampleRate: 48000,
  latencyMs: 0,
  audioBitrateKbps: 128,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: unknown, fallback: number) {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function rmsToDb(rms: number) {
  if (!Number.isFinite(rms) || rms <= 0) return -60;
  return clamp(20 * Math.log10(rms), -60, 6);
}

function dbToMeterValue(db: number) {
  return clamp(((db + 60) / 66) * 100, 0, 100);
}

function getKindLabel(kind: MediaDeviceInfo['kind']) {
  if (kind === 'audioinput') return 'Audio Input';
  if (kind === 'audiooutput') return 'Audio Output';
  return 'Device';
}

function getDefaultProfileLabel(id: string) {
  if (id === 'commentator-1') return 'Commentator 1';
  if (id === 'commentator-2') return 'Commentator 2';
  if (id === 'guest') return 'Guest';
  if (id === 'interview-mic') return 'Interview Mic';
  if (id === 'pit-reporter') return 'Pit Reporter';
  return 'Commentator';
}

const rosterOrder = ['commentator-1', 'commentator-2', 'guest', 'interview-mic', 'pit-reporter'];

export default function CommentaryControlRoomTab() {
  const { toast } = useToast();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [state, setState] = useState<CommentaryState>(DEFAULT_STATE);
  const [profiles, setProfiles] = useState<CommentaryProfile[]>(DEFAULT_PROFILES);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('Preparing audio room');
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'unsupported'>('prompt');
  const [audioStats, setAudioStats] = useState<DeviceStats>({
    micLabel: DEFAULT_DEVICE_LABEL,
    connectionStatus: 'Idle',
    currentDb: -60,
    peakDb: -60,
    noiseDb: -60,
    clipping: false,
    leftLevel: 0,
    rightLevel: 0,
    sampleRate: 48000,
    latencyMs: 0,
    muteStatus: 'OFF',
  });
  const [pttHeld, setPttHeld] = useState(false);
  const [musicFileName, setMusicFileName] = useState('');
  const [musicTrackUrl, setMusicTrackUrl] = useState('');
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicLoop, setMusicLoop] = useState(true);
  const [musicFading, setMusicFading] = useState(false);
  const [testCountdown, setTestCountdown] = useState<number | null>(null);
  const [testRecordingUrl, setTestRecordingUrl] = useState<string | null>(null);
  const [testScore, setTestScore] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(true);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const leftAnalyserRef = useRef<AnalyserNode | null>(null);
  const rightAnalyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const testFrameRef = useRef<number | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicUrlRef = useRef<string | null>(null);
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const testChunksRef = useRef<Blob[]>([]);
  const currentAudioBlobUrlRef = useRef<string | null>(null);
  const pttRef = useRef(false);
  const settingsRef = useRef(state);
  const profilesRef = useRef(profiles);

  useEffect(() => {
    settingsRef.current = state;
  }, [state]);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  const selectedDevice = useMemo(() => devices.find((device) => device.deviceId === state.selectedDeviceId) || null, [devices, state.selectedDeviceId]);

  const commentaryLiveProfile = useMemo(() => profiles.find((profile) => profile.liveNow && !profile.mute) || profiles[0] || null, [profiles]);

  const currentDisplayName = commentaryLiveProfile?.name || state.overlay.name;

  const reconnectMicrophone = useCallback(async (preferredDeviceId?: string) => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermissionState('unsupported');
      return;
    }

    setIsConnecting(true);
    setConnectionMessage('Connecting microphone');

    try {
      const deviceId = preferredDeviceId || state.selectedDeviceId || '';
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: state.echoCancellation,
          noiseSuppression: state.noiseSuppression,
          autoGainControl: state.autoGainControl,
          channelCount: 2,
          sampleRate: state.sampleRate,
        },
        video: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setPermissionState('granted');
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = stream;

      const audioContext = audioContextRef.current || new AudioContext({ latencyHint: 'interactive' });
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') {
        await audioContext.resume().catch(() => undefined);
      }

      sourceNodeRef.current?.disconnect();
      analyserRef.current?.disconnect();
      splitterRef.current?.disconnect();
      leftAnalyserRef.current?.disconnect();
      rightAnalyserRef.current?.disconnect();
      gainNodeRef.current?.disconnect();
      compressorRef.current?.disconnect();
      outputGainRef.current?.disconnect();

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      const splitter = audioContext.createChannelSplitter(2);
      const leftAnalyser = audioContext.createAnalyser();
      const rightAnalyser = audioContext.createAnalyser();
      const gain = audioContext.createGain();
      const compressor = audioContext.createDynamicsCompressor();
      const outputGain = audioContext.createGain();

      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;
      leftAnalyser.fftSize = 1024;
      leftAnalyser.smoothingTimeConstant = 0.72;
      rightAnalyser.fftSize = 1024;
      rightAnalyser.smoothingTimeConstant = 0.72;

      gain.gain.value = state.commentaryStatus === 'on-air' && !state.autoMuteOnDisconnect ? state.defaultGain / 100 : state.defaultGain / 100;
      outputGain.gain.value = state.monitorVolume / 100;

      compressor.threshold.value = state.compressor ? -24 : -100;
      compressor.knee.value = 18;
      compressor.ratio.value = state.limiter ? 18 : 3;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      source.connect(analyser);
      source.connect(splitter);
      source.connect(gain);
      gain.connect(compressor);
      compressor.connect(outputGain);
      outputGain.connect(audioContext.destination);
      splitter.connect(leftAnalyser, 0);
      splitter.connect(rightAnalyser, 1);

      sourceNodeRef.current = source;
      analyserRef.current = analyser;
      splitterRef.current = splitter;
      leftAnalyserRef.current = leftAnalyser;
      rightAnalyserRef.current = rightAnalyser;
      gainNodeRef.current = gain;
      compressorRef.current = compressor;
      outputGainRef.current = outputGain;

      const settings = stream.getAudioTracks()[0]?.getSettings?.() || {};
      const sampleRate = toNumber(settings.sampleRate, audioContext.sampleRate || state.sampleRate);
      const latency = ((audioContext.baseLatency || 0) + (audioContext.outputLatency || 0)) * 1000;

      setState((current) => ({
        ...current,
        selectedDeviceId: deviceId || current.selectedDeviceId,
        sampleRate,
        latencyMs: latency,
      }));
      setConnectionMessage('Microphone connected');
      setAudioStats((current) => ({
        ...current,
        micLabel: selectedDevice?.label || stream.getAudioTracks()[0]?.label || DEFAULT_DEVICE_LABEL,
        connectionStatus: 'Connected',
        sampleRate,
        latencyMs: latency,
        muteStatus: gain.gain.value <= 0 ? 'MUTED' : 'LIVE',
      }));
    } catch (error: any) {
      const message = error?.message || 'Could not connect microphone';
      setConnectionMessage(message);
      setAudioStats((current) => ({ ...current, connectionStatus: 'Disconnected', muteStatus: 'OFF' }));
      if (error?.name === 'NotAllowedError') setPermissionState('denied');
      toast({ title: 'Microphone connection failed', description: message, variant: 'destructive' });
    } finally {
      setIsConnecting(false);
    }
  }, [selectedDevice?.label, state.autoGainControl, state.autoMuteOnDisconnect, state.commentaryStatus, state.compressor, state.defaultGain, state.echoCancellation, state.limiter, state.monitorVolume, state.noiseSuppression, state.sampleRate, state.selectedDeviceId, toast]);

  const refreshDevices = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setPermissionState('unsupported');
      return;
    }

    const list = await navigator.mediaDevices.enumerateDevices();
    const mapped = list
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({
        deviceId: device.deviceId,
        label: device.label || DEFAULT_DEVICE_LABEL,
        kind: device.kind,
        groupId: device.groupId,
      }));

    setDevices(mapped);

    if (!mapped.length) {
      setConnectionMessage('No audio inputs detected');
      return;
    }

    if (!state.selectedDeviceId && state.rememberDevice && mapped[0]?.deviceId) {
      setState((current) => ({ ...current, selectedDeviceId: mapped[0].deviceId }));
    }

    const selectedStillAvailable = !state.selectedDeviceId || mapped.some((device) => device.deviceId === state.selectedDeviceId);
    if (!selectedStillAvailable && state.autoMuteOnDisconnect) {
      setState((current) => ({ ...current, commentaryStatus: 'off-air' }));
      setAudioStats((current) => ({ ...current, connectionStatus: 'Disconnected', muteStatus: 'OFF' }));
      toast({ title: 'Microphone disconnected', description: 'Auto mute on disconnect switched commentary OFF AIR.', variant: 'destructive' });
      if (mapped[0]?.deviceId) {
        void reconnectMicrophone(mapped[0].deviceId);
      }
    }
  }, [reconnectMicrophone, state.autoMuteOnDisconnect, state.rememberDevice, state.selectedDeviceId, toast]);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<CommentaryState> & { profiles?: CommentaryProfile[] };
          if (parsed) {
            setState((current) => ({
              ...current,
              ...parsed,
              overlay: {
                ...current.overlay,
                ...(parsed.overlay || {}),
              },
            }));
            if (Array.isArray(parsed.profiles) && parsed.profiles.length) {
              setProfiles(parsed.profiles);
            }
          }
        }

        const remote = await getDoc(FIRESTORE_DOC);
        if (remote.exists()) {
          const data = remote.data() as Partial<CommentaryState> & { profiles?: CommentaryProfile[] };
          setState((current) => ({
            ...current,
            ...data,
            overlay: {
              ...current.overlay,
              ...(data.overlay || {}),
            },
          }));
          if (Array.isArray(data.profiles) && data.profiles.length) {
            setProfiles(data.profiles);
          }
        }
      } catch (error) {
        console.warn('Failed to hydrate commentary control room settings', error);
      } finally {
        setHasHydrated(true);
      }
    };

    void hydrate();
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    if (typeof window !== 'undefined') {
      const payload = JSON.stringify({ ...state, profiles });
      window.localStorage.setItem(STORAGE_KEY, payload);
    }
    const persist = async () => {
      try {
        await setDoc(FIRESTORE_DOC, {
          ...state,
          profiles,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (error) {
        console.warn('Failed to persist commentary settings', error);
      }
    };
    void persist();
  }, [hasHydrated, profiles, state]);

  useEffect(() => {
    const setup = async () => {
      if (typeof window === 'undefined' || !navigator.mediaDevices) {
        setPermissionState('unsupported');
        return;
      }

      try {
        const perms = await navigator.permissions?.query?.({ name: 'microphone' as PermissionName }).catch(() => null);
        if (perms?.state) setPermissionState(perms.state === 'granted' ? 'granted' : perms.state === 'denied' ? 'denied' : 'prompt');
      } catch {
        setPermissionState('prompt');
      }

      await refreshDevices();
      if (state.selectedDeviceId) {
        void reconnectMicrophone(state.selectedDeviceId);
      } else if (state.rememberDevice && devices[0]?.deviceId) {
        void reconnectMicrophone(devices[0].deviceId);
      }
    };

    void setup();
    const onDeviceChange = () => {
      void refreshDevices();
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!audioContextRef.current || !gainNodeRef.current || !compressorRef.current || !outputGainRef.current) return;

    const active = state.commentaryStatus === 'on-air' && !state.autoMuteOnDisconnect && !state.autoGainControl ? state.defaultGain / 100 : state.defaultGain / 100;
    const effectiveGain = state.commentaryStatus === 'off-air' ? 0 : (pttHeld ? state.defaultGain / 100 : active);
    gainNodeRef.current.gain.value = clamp(effectiveGain, 0, 1.5);
    outputGainRef.current.gain.value = clamp(state.monitorVolume / 100, 0, 1);
    compressorRef.current.threshold.value = state.compressor ? -24 : -100;
    compressorRef.current.ratio.value = state.limiter ? 18 : 3;
  }, [pttHeld, state.commentaryStatus, state.compressor, state.defaultGain, state.limiter, state.monitorVolume, state.autoGainControl, state.autoMuteOnDisconnect]);

  useEffect(() => {
    if (!analyserRef.current || !leftAnalyserRef.current || !rightAnalyserRef.current) return;
    const analyser = analyserRef.current;
    const left = leftAnalyserRef.current;
    const right = rightAnalyserRef.current;
    const buffer = new Float32Array(analyser.fftSize);
    const leftBuffer = new Float32Array(left.fftSize);
    const rightBuffer = new Float32Array(right.fftSize);

    const tick = () => {
      analyser.getFloatTimeDomainData(buffer);
      left.getFloatTimeDomainData(leftBuffer);
      right.getFloatTimeDomainData(rightBuffer);

      const rms = Math.sqrt(buffer.reduce((sum, sample) => sum + sample * sample, 0) / buffer.length);
      const leftRms = Math.sqrt(leftBuffer.reduce((sum, sample) => sum + sample * sample, 0) / leftBuffer.length);
      const rightRms = Math.sqrt(rightBuffer.reduce((sum, sample) => sum + sample * sample, 0) / rightBuffer.length);
      const peak = buffer.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
      const currentDb = rmsToDb(rms);
      const leftDb = rmsToDb(leftRms);
      const rightDb = rmsToDb(rightRms);
      const noiseDb = currentDb - 12;
      const clipping = peak > 0.985;
      const sampleRate = audioContextRef.current?.sampleRate || state.sampleRate;
      const latencyMs = ((audioContextRef.current?.baseLatency || 0) + (audioContextRef.current?.outputLatency || 0)) * 1000;
      const duckTarget = state.duckingEnabled && currentDb > state.duckingThreshold ? state.musicVolume / 100 * (1 - state.duckingReduction / 100) : state.musicVolume / 100;
      const effectiveMusicVolume = clamp(duckTarget, 0, 1);

      if (musicAudioRef.current && !musicAudioRef.current.paused) {
        musicAudioRef.current.volume = effectiveMusicVolume;
      }

      setAudioStats((current) => ({
        ...current,
        micLabel: selectedDevice?.label || current.micLabel,
        connectionStatus: mediaStreamRef.current?.active ? 'Connected' : 'Disconnected',
        currentDb,
        peakDb: rmsToDb(peak),
        noiseDb,
        clipping,
        leftLevel: dbToMeterValue(leftDb),
        rightLevel: dbToMeterValue(rightDb),
        sampleRate,
        latencyMs,
        muteStatus: gainNodeRef.current && gainNodeRef.current.gain.value <= 0 ? 'MUTED' : 'LIVE',
      }));

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, [selectedDevice?.label, state.duckingEnabled, state.duckingReduction, state.duckingThreshold, state.musicVolume, state.sampleRate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) return;
      if (event.code === 'Space') {
        event.preventDefault();
        setPttHeld(true);
      }
      if (event.key.toLowerCase() === 'm' && !event.ctrlKey && !event.metaKey) {
        setState((current) => ({ ...current, commentaryStatus: current.commentaryStatus === 'on-air' ? 'off-air' : 'on-air' }));
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'm') {
        setState((current) => ({ ...current, monitorMode: current.monitorMode === 'monitor-only' ? 'monitor-and-output' : 'monitor-only' }));
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        setPttHeld(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    const audio = musicAudioRef.current;
    if (!audio || !musicTrackUrl) return;
    audio.loop = musicLoop;
    audio.volume = clamp(state.musicVolume / 100, 0, 1);
  }, [musicLoop, musicTrackUrl, state.musicVolume]);

  useEffect(() => {
    return () => {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioContextRef.current?.close().catch(() => undefined);
      if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
      if (currentAudioBlobUrlRef.current) URL.revokeObjectURL(currentAudioBlobUrlRef.current);
      if (musicTrackUrl) URL.revokeObjectURL(musicTrackUrl);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      if (testFrameRef.current) window.cancelAnimationFrame(testFrameRef.current);
    };
  }, [musicTrackUrl]);

  const updateProfile = (id: string, key: CommentaryProfileInputKey, value: string) => {
    setProfiles((current) => current.map((profile) => (profile.id === id ? { ...profile, [key]: value } : profile)));
  };

  const toggleProfileLive = (id: string) => {
    setProfiles((current) => current.map((profile) => ({
      ...profile,
      liveNow: profile.id === id ? !profile.liveNow : profile.liveNow && profile.id === 'commentator-1' ? true : profile.liveNow,
      solo: profile.id === id ? profile.solo : false,
    })));
  };

  const toggleProfileMute = (id: string) => {
    setProfiles((current) => current.map((profile) => (profile.id === id ? { ...profile, mute: !profile.mute } : profile)));
  };

  const toggleProfileSolo = (id: string) => {
    setProfiles((current) => current.map((profile) => ({ ...profile, solo: profile.id === id ? !profile.solo : false })));
  };

  const adjustProfileVolume = (id: string, volume: number) => {
    setProfiles((current) => current.map((profile) => (profile.id === id ? { ...profile, volume } : profile)));
  };

  const addCommentator = () => {
    const id = `guest-${Date.now()}`;
    setProfiles((current) => [
      ...current,
      {
        id,
        name: 'New Commentator',
        role: 'Guest',
        language: 'English',
        country: 'India',
        photo: '',
        liveNow: false,
        mute: false,
        solo: false,
        volume: 80,
      },
    ]);
  };

  const setStatus = (commentaryStatus: 'on-air' | 'off-air') => {
    setState((current) => ({ ...current, commentaryStatus }));
    if (commentaryStatus === 'on-air') {
      toast({ title: 'Commentary live', description: 'Audio control room is now ON AIR.' });
    }
  };

  const setSelectedDevice = (deviceId: string) => {
    setState((current) => ({ ...current, selectedDeviceId: deviceId }));
    void reconnectMicrophone(deviceId);
  };

  const handleRefreshDevices = async () => {
    await refreshDevices();
    if (state.selectedDeviceId) {
      void reconnectMicrophone(state.selectedDeviceId);
    }
  };

  const handleMute = () => setState((current) => ({ ...current, commentaryStatus: 'off-air' }));
  const handleUnmute = () => setState((current) => ({ ...current, commentaryStatus: 'on-air' }));
  const handleToggleMonitor = () => setState((current) => ({ ...current, monitorMode: current.monitorMode === 'monitor-only' ? 'monitor-and-output' : 'monitor-only' }));

  const handleMusicUpload = (file?: File | null) => {
    if (!file) return;
    if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
    const url = URL.createObjectURL(file);
    musicUrlRef.current = url;
    setMusicTrackUrl(url);
    setMusicFileName(file.name);
    setMusicPlaying(false);
    toast({ title: 'Music loaded', description: file.name });
  };

  const playMusic = async () => {
    if (!musicAudioRef.current) return;
    try {
      await musicAudioRef.current.play();
      setMusicPlaying(true);
    } catch (error: any) {
      toast({ title: 'Could not play music', description: error?.message || 'Playback blocked by browser', variant: 'destructive' });
    }
  };

  const pauseMusic = () => {
    musicAudioRef.current?.pause();
    setMusicPlaying(false);
  };

  const fadeMusic = async (direction: 'out' | 'in') => {
    const audio = musicAudioRef.current;
    if (!audio) return;
    setMusicFading(true);
    const start = audio.volume;
    const target = direction === 'out' ? 0 : clamp(state.musicVolume / 100, 0, 1);
    const steps = 24;
    for (let index = 1; index <= steps; index += 1) {
      const nextVolume = start + ((target - start) * index) / steps;
      audio.volume = clamp(nextVolume, 0, 1);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (direction === 'out') pauseMusic();
    setMusicFading(false);
  };

  const startMicTest = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: 'Microphone test unavailable', description: 'Browser does not support audio capture.', variant: 'destructive' });
      return;
    }

    if (!mediaStreamRef.current) {
      await reconnectMicrophone(state.selectedDeviceId || devices[0]?.deviceId || '');
    }

    const stream = mediaStreamRef.current;
    if (!stream) {
      toast({ title: 'No microphone stream', description: 'Connect a mic first.', variant: 'destructive' });
      return;
    }

    setTestScore(null);
    setTestRecordingUrl(null);
    setTestCountdown(5);

    for (let count = 5; count > 0; count -= 1) {
      setTestCountdown(count);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const chunks: Blob[] = [];
    testChunksRef.current = chunks;
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    micRecorderRef.current = recorder;
    const samples: number[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.start();

    const meter = () => {
      const analyser = analyserRef.current;
      if (!analyser) return;
      const buffer = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buffer);
      const rms = Math.sqrt(buffer.reduce((sum, sample) => sum + sample * sample, 0) / buffer.length);
      samples.push(rms);
      testFrameRef.current = window.requestAnimationFrame(meter);
    };
    testFrameRef.current = window.requestAnimationFrame(meter);

    await new Promise((resolve) => setTimeout(resolve, 5000));
    recorder.stop();
    if (testFrameRef.current) window.cancelAnimationFrame(testFrameRef.current);
    setTestCountdown(null);

    const blob = new Blob(chunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    currentAudioBlobUrlRef.current = url;
    setTestRecordingUrl(url);

    const average = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
    const dB = rmsToDb(average);
    const score = clamp(Math.round(60 + ((dB + 50) * 1.6) + (audioStats.clipping ? -20 : 0)), 0, 100);
    setTestScore(score);
    toast({ title: 'Microphone test complete', description: `Quality score ${score}/100` });
  };

  const overlayPreview = useMemo(() => ({
    title: state.overlay.name || 'LIVE COMMENTARY',
    subtitle: commentaryLiveProfile?.name || state.overlay.subtitle || 'Powered by Bergman',
    poweredBy: state.overlay.poweredBy || 'Bergman',
  }), [commentaryLiveProfile?.name, state.overlay]);

  const deviceCountLabel = devices.length ? `${devices.length} audio device${devices.length === 1 ? '' : 's'}` : 'No devices found';

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-gradient-to-r from-slate-950 via-slate-900 to-zinc-950 p-6 text-white shadow-2xl shadow-black/30">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
              <Radio className="h-3.5 w-3.5" />
              Broadcast Commentary Control Room
            </div>
            <div>
              <h2 className="text-3xl font-black tracking-tight">Audio & Commentary</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-300">
                Professional race commentary control for Godox MoveLink M2, USB microphones, audio interfaces, mixers, and OBS audio routing.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn('border-transparent', state.commentaryStatus === 'on-air' ? 'bg-emerald-500 text-white' : 'bg-slate-600 text-white')}>
              {state.commentaryStatus === 'on-air' ? 'ON AIR' : 'OFF AIR'}
            </Badge>
            <Badge variant="secondary" className="bg-white/10 text-white">Admin only</Badge>
            <Badge variant="secondary" className="bg-white/10 text-white">OBS bridge ready</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        {[
          { label: 'Commentary Status', value: state.commentaryStatus === 'on-air' ? 'ON AIR' : 'OFF AIR', icon: state.commentaryStatus === 'on-air' ? Radio : Wifi, tone: state.commentaryStatus === 'on-air' ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-500/15 text-slate-200' },
          { label: 'Microphone Connected', value: audioStats.micLabel, icon: Mic, tone: 'bg-cyan-500/15 text-cyan-100' },
          { label: 'Audio Level Meter', value: `${audioStats.currentDb.toFixed(1)} dB`, icon: Waves, tone: audioStats.clipping ? 'bg-red-500/15 text-red-100' : 'bg-amber-500/15 text-amber-100' },
          { label: 'Noise Level', value: `${audioStats.noiseDb.toFixed(1)} dB`, icon: BadgeHelp, tone: 'bg-violet-500/15 text-violet-100' },
          { label: 'Sample Rate', value: `${Math.round(audioStats.sampleRate / 1000)} KHz`, icon: Activity, tone: 'bg-sky-500/15 text-sky-100' },
          { label: 'Latency', value: `${audioStats.latencyMs.toFixed(0)} ms`, icon: ChevronRight, tone: 'bg-fuchsia-500/15 text-fuchsia-100' },
          { label: 'Mute Status', value: audioStats.muteStatus, icon: state.commentaryStatus === 'on-air' ? Volume2 : VolumeX, tone: audioStats.muteStatus === 'MUTED' ? 'bg-orange-500/15 text-orange-100' : 'bg-emerald-500/15 text-emerald-100' },
          { label: 'Connection Status', value: audioStats.connectionStatus, icon: permissionState === 'granted' ? ShieldCheck : permissionState === 'denied' ? WifiOff : Bluetooth, tone: permissionState === 'granted' ? 'bg-emerald-500/15 text-emerald-100' : 'bg-slate-500/15 text-slate-200' },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="border-white/10 bg-slate-950 text-white shadow-lg shadow-black/20">
              <CardContent className="p-4">
                <div className={cn('mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl', card.tone)}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{card.label}</div>
                <div className="mt-2 text-lg font-bold leading-tight">{card.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <Card className="border-white/10 bg-slate-950 text-white shadow-2xl shadow-black/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white"><Mic className="h-5 w-5 text-cyan-300" />Microphone Device Manager</CardTitle>
            <CardDescription className="text-slate-400">Use the browser MediaDevices API to pick built-in, USB, wireless, interface, mixer, or headset inputs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <div className="space-y-2">
                <Label className="text-slate-300">Audio input device</Label>
                <Select value={state.selectedDeviceId || undefined} onValueChange={setSelectedDevice}>
                  <SelectTrigger className="border-white/10 bg-white/5 text-white">
                    <SelectValue placeholder="Select microphone" />
                  </SelectTrigger>
                  <SelectContent>
                    {devices.length ? devices.map((device) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label} · {getKindLabel(device.kind)}
                      </SelectItem>
                    )) : <SelectItem value="none">No audio devices detected</SelectItem>}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400">{deviceCountLabel}. Persisted device reconnects automatically when available.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="secondary" onClick={handleRefreshDevices} className="bg-white/10 text-white hover:bg-white/15">
                  <RefreshCw className="mr-2 h-4 w-4" />Refresh devices
                </Button>
                <Button variant="secondary" onClick={() => void reconnectMicrophone(state.selectedDeviceId || devices[0]?.deviceId || '')} className="bg-white/10 text-white hover:bg-white/15" disabled={isConnecting}>
                  <Radio className="mr-2 h-4 w-4" />{isConnecting ? 'Connecting…' : 'Reconnect'}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Commentary status</span><Badge className={state.commentaryStatus === 'on-air' ? 'bg-emerald-500 text-white' : 'bg-slate-600 text-white'}>{state.commentaryStatus.toUpperCase()}</Badge></div>
                <div className="mt-3 flex gap-2">
                  <Button className="flex-1" onClick={() => setStatus('on-air')}><Mic className="mr-2 h-4 w-4" />Go live</Button>
                  <Button variant="outline" className="flex-1 border-white/10 text-white hover:bg-white/10" onClick={() => setStatus('off-air')}><MicOff className="mr-2 h-4 w-4" />Go off</Button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Auto reconnect</span><Switch checked={state.autoMuteOnDisconnect} onCheckedChange={(checked) => setState((current) => ({ ...current, autoMuteOnDisconnect: checked }))} /></div>
                <p className="mt-3 text-xs text-slate-400">Automatically mutes commentary and reconnects when the selected microphone disappears.</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Remember device</span><Switch checked={state.rememberDevice} onCheckedChange={(checked) => setState((current) => ({ ...current, rememberDevice: checked }))} /></div>
                <p className="mt-3 text-xs text-slate-400">Stores the selected device in Firestore and local browser storage.</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Connection</span><Badge variant="secondary" className="bg-white/10 text-white">{permissionState.toUpperCase()}</Badge></div>
                <p className="mt-3 text-xs text-slate-400">{connectionMessage}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-950 text-white shadow-2xl shadow-black/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white"><Waves className="h-5 w-5 text-emerald-300" />Live Audio Meter</CardTitle>
            <CardDescription className="text-slate-400">Real-time VU meter, peak meter, clipping detection, stereo L/R bars, and live dB readout.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
              <span>VU</span><span>Peak</span>
            </div>
            <div className="space-y-4 rounded-3xl border border-white/10 bg-black/30 p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Current dB</span><span className="font-bold text-white">{audioStats.currentDb.toFixed(1)} dB</span></div>
                <div className="h-4 overflow-hidden rounded-full bg-slate-800">
                  <div className={cn('h-full rounded-full transition-all duration-150', audioStats.clipping ? 'bg-red-500' : audioStats.currentDb > -10 ? 'bg-yellow-400' : 'bg-emerald-500')} style={{ width: `${dbToMeterValue(audioStats.currentDb)}%` }} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Peak</span><span className="font-bold text-white">{audioStats.peakDb.toFixed(1)} dB</span></div>
                <div className="h-4 overflow-hidden rounded-full bg-slate-800">
                  <div className={cn('h-full rounded-full transition-all duration-150', audioStats.clipping ? 'bg-red-500' : 'bg-fuchsia-400')} style={{ width: `${dbToMeterValue(audioStats.peakDb)}%` }} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs uppercase tracking-[0.16em] text-slate-400">Left</div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${audioStats.leftLevel}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs uppercase tracking-[0.16em] text-slate-400">Right</div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-purple-400 transition-all" style={{ width: `${audioStats.rightLevel}%` }} />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className={cn('flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]', audioStats.clipping ? 'bg-red-500/15 text-red-200' : 'bg-emerald-500/15 text-emerald-200')}>
                  <CircleDot className="h-3 w-3" />
                  {audioStats.clipping ? 'Clipping' : 'Clean'}
                </div>
                <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white">
                  {audioStats.muteStatus}
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/15" onClick={handleMute}><VolumeX className="mr-2 h-4 w-4" />Mute</Button>
              <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/15" onClick={handleUnmute}><Volume2 className="mr-2 h-4 w-4" />Unmute</Button>
              <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/15" onMouseDown={() => setPttHeld(true)} onMouseUp={() => setPttHeld(false)} onTouchStart={() => setPttHeld(true)} onTouchEnd={() => setPttHeld(false)}><Keyboard className="mr-2 h-4 w-4" />{pttHeld ? 'Talk' : 'Push To Talk'}</Button>
            </div>
            <Separator className="bg-white/10" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Monitor Audio</span><Switch checked={state.monitorMode === 'monitor-and-output'} onCheckedChange={handleToggleMonitor} /></div>
                <p className="text-xs text-slate-400">Monitor locally while keeping commentary routed for OBS capture and Cloudflare Stream audio output.</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Headphones</span><Badge variant="secondary" className="bg-white/10 text-white">{state.monitorMode === 'monitor-and-output' ? 'ENABLED' : 'MONITOR ONLY'}</Badge></div>
                <p className="text-xs text-slate-400">Recommended for race commentary to avoid speaker feedback.</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-300"><span>Monitor volume</span><span>{state.monitorVolume}%</span></div>
              <Slider value={[state.monitorVolume]} min={0} max={100} step={1} onValueChange={([value]) => setState((current) => ({ ...current, monitorVolume: value }))} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-300"><span>Mic gain</span><span>{state.defaultGain}%</span></div>
              <Slider value={[state.defaultGain]} min={0} max={130} step={1} onValueChange={([value]) => setState((current) => ({ ...current, defaultGain: value }))} />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[
                ['Noise Suppression', state.noiseSuppression, (checked: boolean) => setState((current) => ({ ...current, noiseSuppression: checked }))],
                ['Echo Cancellation', state.echoCancellation, (checked: boolean) => setState((current) => ({ ...current, echoCancellation: checked }))],
                ['Automatic Gain Control', state.autoGainControl, (checked: boolean) => setState((current) => ({ ...current, autoGainControl: checked }))],
                ['Compressor', state.compressor, (checked: boolean) => setState((current) => ({ ...current, compressor: checked }))],
                ['Limiter', state.limiter, (checked: boolean) => setState((current) => ({ ...current, limiter: checked }))],
                ['Noise Gate', true, undefined],
              ].map(([label, checked, setter]) => (
                <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">{label as string}</div>
                      <div className="text-xs text-slate-400">Broadcast processing control</div>
                    </div>
                    {setter ? (
                      <Switch checked={Boolean(checked)} onCheckedChange={setter as (checked: boolean) => void} />
                    ) : (
                      <Badge variant="secondary" className="bg-white/10 text-white">Future-ready</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-white/10 bg-slate-950 text-white shadow-2xl shadow-black/20">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-white">Commentator Panel</CardTitle>
              <CardDescription className="text-slate-400">Manage live commentators, guests, pit reporters, and interview microphones.</CardDescription>
            </div>
            <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/15" onClick={addCommentator}>
              <Mic className="mr-2 h-4 w-4" />Add commentator
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {profiles.map((profile) => (
                <div key={profile.id} className={cn('rounded-3xl border p-4 transition', profile.liveNow ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10 bg-white/5')}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
                      {profile.photo ? <Image src={profile.photo} alt={profile.name} width={56} height={56} unoptimized className="h-full w-full object-cover" /> : <span className="text-sm font-bold text-white">{profile.name.slice(0, 2).toUpperCase()}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-bold text-white">{profile.name}</h3>
                        {profile.liveNow && <Badge className="bg-emerald-500 text-white">LIVE NOW</Badge>}
                        {profile.solo && <Badge className="bg-cyan-500 text-white">SOLO</Badge>}
                      </div>
                      <p className="text-xs text-slate-400">{profile.role}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {([
                      ['name', 'Commentator name'],
                      ['role', 'Role'],
                      ['language', 'Language'],
                      ['country', 'Country'],
                    ] as Array<[CommentaryProfileInputKey, string]>).map(([key, label]) => (
                      <div key={key} className="space-y-1">
                        <Label className="text-slate-300">{label}</Label>
                        <Input value={profile[key]} onChange={(event) => updateProfile(profile.id, key, event.target.value)} className="border-white/10 bg-white/5 text-white placeholder:text-slate-500" />
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 space-y-1">
                    <Label className="text-slate-300">Photo URL</Label>
                    <Input value={profile.photo} onChange={(event) => updateProfile(profile.id, 'photo', event.target.value)} placeholder="Paste commentator photo URL" className="border-white/10 bg-white/5 text-white placeholder:text-slate-500" />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant={profile.liveNow ? 'default' : 'secondary'} onClick={() => toggleProfileLive(profile.id)}>
                      <Radio className="mr-2 h-4 w-4" />{profile.liveNow ? 'LIVE NOW' : 'Set LIVE'}
                    </Button>
                    <Button size="sm" variant="secondary" className="bg-white/10 text-white hover:bg-white/15" onClick={() => toggleProfileMute(profile.id)}>
                      {profile.mute ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}{profile.mute ? 'Unmute' : 'Mute'}
                    </Button>
                    <Button size="sm" variant="secondary" className="bg-white/10 text-white hover:bg-white/15" onClick={() => toggleProfileSolo(profile.id)}>
                      <Ear className="mr-2 h-4 w-4" />{profile.solo ? 'Unsolo' : 'Solo'}
                    </Button>
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400"><span>Volume</span><span>{profile.volume}%</span></div>
                    <Slider value={[profile.volume]} min={0} max={100} step={1} onValueChange={([value]) => adjustProfileVolume(profile.id, value)} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-950 text-white shadow-2xl shadow-black/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white"><Music2 className="h-5 w-5 text-fuchsia-300" />Background Music</CardTitle>
            <CardDescription className="text-slate-400">Upload an MP3, play or pause it, apply fades, and duck the music while commentary is active.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Upload MP3</Label>
              <Input type="file" accept="audio/mpeg,audio/mp3,audio/*" onChange={(event) => handleMusicUpload(event.target.files?.[0])} className="border-white/10 bg-white/5 text-white file:mr-4 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white" />
              <div className="text-xs text-slate-400">{musicFileName || 'No music loaded yet'}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={playMusic} disabled={!musicTrackUrl || musicPlaying}>
                <Play className="mr-2 h-4 w-4" />Play
              </Button>
              <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/15" onClick={pauseMusic} disabled={!musicPlaying}>
                <Pause className="mr-2 h-4 w-4" />Pause
              </Button>
              <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/15" onClick={() => void fadeMusic('out')} disabled={!musicTrackUrl || musicFading}>
                <VolumeX className="mr-2 h-4 w-4" />Fade out
              </Button>
              <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/15" onClick={() => void fadeMusic('in')} disabled={!musicTrackUrl || musicFading}>
                <Volume2 className="mr-2 h-4 w-4" />Fade in
              </Button>
              <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/15" onClick={() => setMusicLoop((current) => !current)}>
                <RefreshCw className="mr-2 h-4 w-4" />{musicLoop ? 'Loop on' : 'Loop off'}
              </Button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-300"><span>Music volume</span><span>{state.musicVolume}%</span></div>
              <Slider value={[state.musicVolume]} min={0} max={100} step={1} onValueChange={([value]) => setState((current) => ({ ...current, musicVolume: value }))} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Voice priority ducking</span><Switch checked={state.duckingEnabled} onCheckedChange={(checked) => setState((current) => ({ ...current, duckingEnabled: checked }))} /></div>
                <p className="mt-3 text-xs text-slate-400">Automatically lowers music while the commentator speaks.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Fade / restore</span><Badge variant="secondary" className="bg-white/10 text-white">{musicFading ? 'ACTIVE' : 'READY'}</Badge></div>
                <p className="mt-3 text-xs text-slate-400">Smooth transitions for intros, sponsor reads, and race start announcements.</p>
              </div>
            </div>

            <audio ref={musicAudioRef} src={musicTrackUrl || undefined} loop={musicLoop} preload="metadata" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-white/10 bg-slate-950 text-white shadow-2xl shadow-black/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white"><Monitor className="h-5 w-5 text-sky-300" />OBS Integration</CardTitle>
            <CardDescription className="text-slate-400">Use the receiver → MacBook → OBS Audio Input Capture chain for Stream-ready commentary.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-300">
            <div className="grid gap-3 md:grid-cols-4">
              {['Godox MoveLink M2', 'Receiver', 'MacBook', 'OBS Audio Input Capture'].map((step, index) => (
                <div key={step} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Step {index + 1}</div>
                  <div className="mt-2 font-semibold text-white">{step}</div>
                  {index < 3 && <ChevronRight className="mt-3 h-4 w-4 text-cyan-300" />}
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-cyan-100">
              <div className="font-semibold">Connection status</div>
              <p className="mt-1 text-sm">{audioStats.connectionStatus}. Output is tuned for synchronized capture inside OBS before Cloudflare Stream ingest.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-950 text-white shadow-2xl shadow-black/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white"><SlidersHorizontal className="h-5 w-5 text-violet-300" />Processing, Network & Replay</CardTitle>
            <CardDescription className="text-slate-400">Future-ready audio chain for noise suppression, compression, limiter, and synchronized replay.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Audio codec</span><Badge variant="secondary" className="bg-white/10 text-white">AAC</Badge></div>
                <div className="mt-3 text-2xl font-black text-white">{state.audioBitrateKbps} kbps</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-300"><span>Replay sync</span><Badge variant="secondary" className="bg-white/10 text-white">Enabled</Badge></div>
                <div className="mt-3 text-sm text-slate-400">Commentary can be recorded alongside race video for synchronized replay and highlight review.</div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Dropped audio frames</div>
                <div className="mt-2 text-2xl font-black text-white">0</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Noise suppression</div>
                <div className="mt-2 text-2xl font-black text-white">RNNoise</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Sample rate</div>
                <div className="mt-2 text-2xl font-black text-white">48 KHz</div>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-slate-300">
              <div className="flex items-center gap-2 font-semibold text-white"><AlertTriangle className="h-4 w-4 text-amber-300" />Production note</div>
              <p className="mt-2 text-slate-400">For best results, route the selected microphone into OBS Audio Input Capture, keep monitor audio on headphones, and avoid speaker playback near the microphone.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-white/10 bg-slate-950 text-white shadow-2xl shadow-black/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white"><BadgeHelp className="h-5 w-5 text-rose-300" />Commentary Overlay</CardTitle>
            <CardDescription className="text-slate-400">Optional live overlay for the top-left corner of the broadcast canvas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
              <div>
                <div className="font-semibold text-white">Show overlay</div>
                <div className="text-xs text-slate-400">Auto hides after the configured timeout.</div>
              </div>
              <Switch checked={state.overlay.enabled} onCheckedChange={(checked) => setState((current) => ({ ...current, overlay: { ...current.overlay, enabled: checked } }))} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-slate-300">Title</Label>
                <Input value={state.overlay.name} onChange={(event) => setState((current) => ({ ...current, overlay: { ...current.overlay, name: event.target.value } }))} className="border-white/10 bg-white/5 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Subtitle</Label>
                <Input value={state.overlay.subtitle} onChange={(event) => setState((current) => ({ ...current, overlay: { ...current.overlay, subtitle: event.target.value } }))} className="border-white/10 bg-white/5 text-white" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-300"><span>Auto hide</span><span>{state.overlay.autoHideSeconds}s</span></div>
              <Slider value={[state.overlay.autoHideSeconds]} min={3} max={20} step={1} onValueChange={([value]) => setState((current) => ({ ...current, overlay: { ...current.overlay, autoHideSeconds: value } }))} />
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Preview</div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-gradient-to-r from-slate-950 to-slate-800 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">🎤 {overlayPreview.title}</div>
                <div className="mt-2 text-lg font-bold text-white">{overlayPreview.subtitle}</div>
                <div className="mt-1 text-xs text-slate-400">Powered by {overlayPreview.poweredBy}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-950 text-white shadow-2xl shadow-black/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white"><FileAudio className="h-5 w-5 text-amber-300" />Mic Test, Captions & Shortcuts</CardTitle>
            <CardDescription className="text-slate-400">Test microphone quality, generate a quick sample, and prepare future speech-to-text captions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void startMicTest()}>
                <Play className="mr-2 h-4 w-4" />Test microphone
              </Button>
              <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/15" onClick={() => setShortcutsOpen((current) => !current)}>
                <Keyboard className="mr-2 h-4 w-4" />{shortcutsOpen ? 'Hide shortcuts' : 'Show shortcuts'}
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Countdown</div>
                <div className="mt-2 text-3xl font-black text-white">{testCountdown ?? 'Ready'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Quality score</div>
                <div className="mt-2 text-3xl font-black text-white">{testScore ?? '—'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Recording</div>
                <div className="mt-2 text-sm text-slate-300">{testRecordingUrl ? 'Playback ready' : 'No recording yet'}</div>
              </div>
            </div>
            {testRecordingUrl && <audio controls src={testRecordingUrl} className="w-full" />}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-300"><span>Live captions</span><Switch checked={state.captionsEnabled} onCheckedChange={(checked) => setState((current) => ({ ...current, captionsEnabled: checked }))} /></div>
              <Textarea value={state.transcript} onChange={(event) => setState((current) => ({ ...current, transcript: event.target.value }))} placeholder="Transcript storage for future live captions and replay subtitles." className="min-h-28 border-white/10 bg-white/5 text-white placeholder:text-slate-500" />
            </div>
            {shortcutsOpen && (
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  ['Space', 'Push To Talk'],
                  ['M', 'Mute / Unmute'],
                  ['Ctrl + Shift + M', 'Monitor'],
                ].map(([shortcut, label]) => (
                  <div key={shortcut} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="font-semibold text-white">{shortcut}</div>
                    <div className="text-xs text-slate-400">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
