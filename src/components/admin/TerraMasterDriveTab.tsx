"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  ExternalLink,
  File,
  Folder,
  FolderPlus,
  HardDrive,
  History,
  Link as LinkIcon,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TerraMasterEntry {
  filename: string;
  basename: string;
  type: 'file' | 'directory';
  size?: number;
  lastmod?: string;
  relativePath: string;
}

interface RecentUpload {
  filename: string;
  filePath: string;
  size: number;
  uploadedAt: string;
  source: 'local' | 'link';
  directory: string;
}

interface SavedDriveFolderLink {
  id: string;
  url: string;
  targetPath: string;
  autoSync: boolean;
  lastQueuedAt?: string;
}

interface TerraMasterDiagnosis {
  success: boolean;
  cacheHit: boolean;
  configuredUrl: string;
  resolvedUrl?: string;
  basePath: string;
  allowSelfSigned: boolean;
  authPreference: string;
  resolvedAuthType?: string;
  error?: string;
  attempts?: Array<{
    url: string;
    authType: string;
    ok: boolean;
    error?: string;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(input?: number): string {
  if (!input || input <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = input;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) { value /= 1024; idx++; }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatDate(input?: string): string {
  if (!input) return '—';
  const d = new Date(input);
  if (isNaN(d.getTime())) return input;
  return d.toLocaleString('en-IN');
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function isImageFile(name: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif|bmp|svg|heic|heif)$/i.test(name);
}

function formatDateLabel(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function isGoogleDriveFolderUrl(url: string): boolean {
  return /\/folders\/([a-zA-Z0-9_-]+)/i.test(url);
}

function groupByDate(entries: TerraMasterEntry[]): { dateLabel: string; items: TerraMasterEntry[] }[] {
  const map = new Map<string, TerraMasterEntry[]>();
  for (const entry of entries) {
    const label = entry.lastmod ? formatDateLabel(entry.lastmod) : 'Unknown date';
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(entry);
  }
  return Array.from(map.entries()).map(([dateLabel, items]) => ({ dateLabel, items }));
}

const RECENT_UPLOADS_KEY = 'terramaster_recent_uploads';
const SAVED_DRIVE_FOLDERS_KEY = 'terramaster_saved_drive_folders';
const DRIVE_UPLOAD_POLL_INTERVAL_MS = 2500;

function loadRecentUploads(): RecentUpload[] {
  try {
    const raw = localStorage.getItem(RECENT_UPLOADS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRecentUpload(upload: RecentUpload) {
  try {
    const existing = loadRecentUploads();
    const updated = [upload, ...existing].slice(0, 30);
    localStorage.setItem(RECENT_UPLOADS_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
}

function loadSavedDriveFolders(): SavedDriveFolderLink[] {
  try {
    const raw = localStorage.getItem(SAVED_DRIVE_FOLDERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedDriveFolders(items: SavedDriveFolderLink[]) {
  try {
    localStorage.setItem(SAVED_DRIVE_FOLDERS_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TerraMasterDriveTab() {
  const { toast } = useToast();

  // Browser state
  const [entries, setEntries] = useState<TerraMasterEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('/');
  const [isLoading, setIsLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ name: string; relativePath: string } | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(-1);
  const [viewMode, setViewMode] = useState<'list' | 'date'>('list');

  // Local upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFolderFiles, setSelectedFolderFiles] = useState<File[]>([]);
  const [uploadPath, setUploadPath] = useState('/');
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [localUploadProgress, setLocalUploadProgress] = useState(0);
  const [localUploadDone, setLocalUploadDone] = useState(false);

  // Link upload state
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteFilename, setRemoteFilename] = useState('');
  const [remotePath, setRemotePath] = useState('/');
  const [isUploadingFromLink, setIsUploadingFromLink] = useState(false);
  const [linkUploadProgress, setLinkUploadProgress] = useState(0);
  const [linkUploadDone, setLinkUploadDone] = useState(false);
  const linkProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Folder upload state (Google Drive folder)
  const [isFolderUploadMode, setIsFolderUploadMode] = useState(false);
  const [folderUploadTotal, setFolderUploadTotal] = useState(0);
  const [folderUploadDone, setFolderUploadDone] = useState(0);
  const [folderUploadCurrent, setFolderUploadCurrent] = useState('');
  const [folderUploadSkipped, setFolderUploadSkipped] = useState<{ filename: string; reason: string }[]>([]);
  const [folderUploadDeleted, setFolderUploadDeleted] = useState<{ filename: string; reason: string }[]>([]);
  const [folderUploadErrors, setFolderUploadErrors] = useState<{ filename: string; error: string }[]>([]);
  const [folderUploadFinished, setFolderUploadFinished] = useState(false);
  const [driveUploadJobId, setDriveUploadJobId] = useState<string | null>(null);
  const [activeDriveJobMode, setActiveDriveJobMode] = useState<'upload' | 'sync' | null>(null);
  const [isCancelingDriveUpload, setIsCancelingDriveUpload] = useState(false);
  const driveUploadPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drivePollInFlightRef = useRef(false);
  const driveLastProgressDoneRef = useRef(0);
  const driveLastProgressTotalRef = useRef(0);
  const [savedDriveFolders, setSavedDriveFolders] = useState<SavedDriveFolderLink[]>([]);
  const autoSyncTickRef = useRef(false);

  // Recent uploads
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>([]);
  const [lastConnectionError, setLastConnectionError] = useState<string | null>(null);
  const [connectionDiagnosis, setConnectionDiagnosis] = useState<TerraMasterDiagnosis | null>(null);
  const [isDiagnosingConnection, setIsDiagnosingConnection] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; relativePath: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);

  useEffect(() => {
    setRecentUploads(loadRecentUploads());
    setSavedDriveFolders(loadSavedDriveFolders());
  }, []);

  useEffect(() => {
    persistSavedDriveFolders(savedDriveFolders);
  }, [savedDriveFolders]);

  useEffect(() => {
    return () => {
      if (driveUploadPollRef.current) clearTimeout(driveUploadPollRef.current);
    };
  }, []);

  // ─── Stats ───────────────────────────────────────────────────────────────

  const totalFileSize = useMemo(
    () => entries.filter(e => e.type === 'file').reduce((s, e) => s + Number(e.size || 0), 0),
    [entries]
  );
  const fileCount = useMemo(() => entries.filter(e => e.type === 'file').length, [entries]);
  const folderCount = useMemo(() => entries.filter(e => e.type === 'directory').length, [entries]);
  const imageCount = useMemo(() => entries.filter(e => e.type === 'file' && isImageFile(e.basename)).length, [entries]);

  // ─── Load directory ──────────────────────────────────────────────────────

  const runConnectionDiagnosis = useCallback(async (refresh = true) => {
    setIsDiagnosingConnection(true);
    try {
      const res = await fetch(`/api/admin/terramaster?action=diagnose${refresh ? '&refresh=1' : ''}`, { cache: 'no-store' });
      const result = await res.json();
      setConnectionDiagnosis(result);

      if (result?.success) {
        setLastConnectionError(null);
        toast({
          title: 'TerraMaster connection verified',
          description: result?.resolvedUrl ? `Connected via ${result.resolvedUrl}` : 'Connection probe succeeded.',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'TerraMaster diagnosis failed',
          description: result?.error || result?.message || 'Unable to reach TerraMaster WebDAV.',
        });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'TerraMaster diagnosis failed', description: e?.message || 'Unable to run TerraMaster diagnosis.' });
    } finally {
      setIsDiagnosingConnection(false);
    }
  }, [toast]);

  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/terramaster?action=list&path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result?.message || 'Failed to list directory.');
      setEntries(Array.isArray(result.entries) ? result.entries : []);
      setCurrentPath(result.currentPath || '/');
      setParentPath(result.parentPath || null);
      setPathInput(result.currentPath || '/');
      setLastConnectionError(null);
      // Keep upload target paths stable unless user edits them manually.
    } catch (e: any) {
      setLastConnectionError(e?.message || 'Failed to list directory.');
      toast({ variant: 'destructive', title: 'TerraMaster list failed', description: e?.message });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadDirectory('/'); }, [loadDirectory]);

  // ─── Grouped by date ─────────────────────────────────────────────────────

  const filesOnly = useMemo(() => entries.filter(e => e.type === 'file').sort((a, b) => {
    const ta = a.lastmod ? new Date(a.lastmod).getTime() : 0;
    const tb = b.lastmod ? new Date(b.lastmod).getTime() : 0;
    return tb - ta;
  }), [entries]);

  const grouped = useMemo(() => groupByDate(filesOnly), [filesOnly]);

  // All image entries in current folder (for prev/next navigation)
  const imageEntries = useMemo(
    () => entries.filter(e => e.type === 'file' && isImageFile(e.basename)),
    [entries]
  );

  const openPreview = useCallback((entry: { name: string; relativePath: string }) => {
    const idx = imageEntries.findIndex(e => e.relativePath === entry.relativePath);
    setPreviewImage(entry);
    setPreviewIndex(idx);
  }, [imageEntries]);

  const goPreviewNext = useCallback(() => {
    if (imageEntries.length === 0) return;
    const next = (previewIndex + 1) % imageEntries.length;
    const e = imageEntries[next];
    setPreviewImage({ name: e.basename, relativePath: e.relativePath });
    setPreviewIndex(next);
  }, [imageEntries, previewIndex]);

  const goPreviewPrev = useCallback(() => {
    if (imageEntries.length === 0) return;
    const prev = (previewIndex - 1 + imageEntries.length) % imageEntries.length;
    const e = imageEntries[prev];
    setPreviewImage({ name: e.basename, relativePath: e.relativePath });
    setPreviewIndex(prev);
  }, [imageEntries, previewIndex]);

  // Keyboard left/right when dialog open
  useEffect(() => {
    if (!previewImage) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goPreviewNext();
      if (e.key === 'ArrowLeft') goPreviewPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewImage, goPreviewNext, goPreviewPrev]);

  // ─── Local file upload (XHR for real progress) ───────────────────────────

  const handleLocalUpload = useCallback(() => {
    if (!selectedFile) {
      toast({ variant: 'destructive', title: 'No file selected' });
      return;
    }
    setIsUploadingFile(true);
    setLocalUploadProgress(0);
    setLocalUploadDone(false);

    const formData = new FormData();
    formData.append('action', 'upload');
    formData.append('file', selectedFile);
    formData.append('path', uploadPath || currentPath || '/');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/terramaster');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setLocalUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      setIsUploadingFile(false);
      try {
        const result = JSON.parse(xhr.responseText);
        if (!result.success) throw new Error(result.message || 'Upload failed.');
        setLocalUploadProgress(100);
        setLocalUploadDone(true);
        const record: RecentUpload = {
          filename: result.filename,
          filePath: result.filePath,
          size: result.size || 0,
          uploadedAt: new Date().toISOString(),
          source: 'local',
          directory: uploadPath || currentPath || '/',
        };
        saveRecentUpload(record);
        setRecentUploads(loadRecentUploads());
        toast({ title: 'Upload complete', description: `${result.filename} uploaded.` });
        setSelectedFile(null);
        loadDirectory(currentPath);
        setTimeout(() => { setLocalUploadProgress(0); setLocalUploadDone(false); }, 3000);
      } catch (e: any) {
        setLocalUploadProgress(0);
        toast({ variant: 'destructive', title: 'Upload failed', description: e?.message });
      }
    };

    xhr.onerror = () => {
      setIsUploadingFile(false);
      setLocalUploadProgress(0);
      toast({ variant: 'destructive', title: 'Upload failed', description: 'Network error.' });
    };

    xhr.send(formData);
  }, [selectedFile, uploadPath, currentPath, toast, loadDirectory]);

  const handleLocalFolderUpload = useCallback(async () => {
    if (selectedFolderFiles.length === 0) {
      toast({ variant: 'destructive', title: 'No folder selected' });
      return;
    }

    setIsUploadingFile(true);
    setLocalUploadProgress(0);
    setLocalUploadDone(false);

    const baseTarget = (uploadPath || currentPath || '/').trim() || '/';
    const uploaded: { filename: string; filePath: string; size: number }[] = [];
    const failed: { filename: string; error: string }[] = [];
    const total = selectedFolderFiles.length;

    const joinPath = (base: string, subDir: string) => {
      const b = base.replace(/\/+$/, '') || '/';
      const s = subDir.replace(/^\/+/, '').replace(/\/+$/, '');
      if (!s) return b;
      return `${b === '/' ? '' : b}/${s}`.replace(/\/+/g, '/') || '/';
    };

    const uploadOne = (file: File, targetDir: string, index: number) => new Promise<void>((resolve) => {
      const formData = new FormData();
      formData.append('action', 'upload');
      formData.append('file', file);
      formData.append('path', targetDir);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/terramaster');

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const perFile = e.loaded / e.total;
        const overall = ((index + perFile) / total) * 100;
        setLocalUploadProgress(Math.max(1, Math.min(99, Math.round(overall))));
      };

      xhr.onload = () => {
        try {
          const result = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300 && result.success) {
            uploaded.push({
              filename: result.filename || file.name,
              filePath: result.filePath,
              size: result.size || file.size || 0,
            });
          } else {
            failed.push({ filename: file.name, error: result?.message || `HTTP ${xhr.status}` });
          }
        } catch {
          failed.push({ filename: file.name, error: `HTTP ${xhr.status}` });
        }
        setLocalUploadProgress(Math.round(((index + 1) / total) * 100));
        resolve();
      };

      xhr.onerror = () => {
        failed.push({ filename: file.name, error: 'Network error' });
        setLocalUploadProgress(Math.round(((index + 1) / total) * 100));
        resolve();
      };

      xhr.send(formData);
    });

    try {
      for (let i = 0; i < selectedFolderFiles.length; i += 1) {
        const file = selectedFolderFiles[i];
        const rel = String((file as any).webkitRelativePath || file.name).replace(/\\/g, '/');
        const parts = rel.split('/');
        parts.pop();
        const subDir = parts.join('/');
        const targetDir = joinPath(baseTarget, subDir);
        await uploadOne(file, targetDir, i);
      }

      setLocalUploadProgress(100);
      setLocalUploadDone(true);

      for (const file of uploaded) {
        saveRecentUpload({
          filename: file.filename,
          filePath: file.filePath,
          size: file.size || 0,
          uploadedAt: new Date().toISOString(),
          source: 'local',
          directory: baseTarget,
        });
      }
      setRecentUploads(loadRecentUploads());

      toast({
        title: 'Folder upload complete',
        description: `${uploaded.length} uploaded${failed.length ? `, ${failed.length} failed` : ''}.`,
      });

      setSelectedFolderFiles([]);
      loadDirectory(currentPath);
      setTimeout(() => { setLocalUploadProgress(0); setLocalUploadDone(false); }, 3000);
    } finally {
      setIsUploadingFile(false);
    }
  }, [selectedFolderFiles, uploadPath, currentPath, toast, loadDirectory]);

  const startDriveFolderJob = useCallback(async (args: { action: 'upload_from_link_start' | 'sync_from_link_start'; url: string; targetPath: string; mode: 'upload' | 'sync' }) => {
    const { action, url, targetPath, mode } = args;

    setIsUploadingFromLink(true);
    setFolderUploadTotal(0);
    setFolderUploadDone(0);
    setFolderUploadCurrent('');
    setFolderUploadSkipped([]);
    setFolderUploadDeleted([]);
    setFolderUploadErrors([]);
    setFolderUploadFinished(false);
    setLinkUploadProgress(0);
    setLinkUploadDone(false);
    setDriveUploadJobId(null);
    driveLastProgressDoneRef.current = 0;
    driveLastProgressTotalRef.current = 0;
    drivePollInFlightRef.current = false;
    setActiveDriveJobMode(mode);

    const formData = new FormData();
    formData.append('action', action);
    formData.append('url', url);
    formData.append('path', targetPath);

    const startRes = await fetch('/api/admin/terramaster', { method: 'POST', body: formData });
    const startResult = await startRes.json();
    if (!startRes.ok || !startResult.success || !startResult.jobId) {
      throw new Error(startResult?.message || `Failed to start ${mode} job.`);
    }

    const jobId = String(startResult.jobId);
    setDriveUploadJobId(jobId);
    toast({
      title: mode === 'sync' ? 'Auto sync started' : 'Background upload started',
      description: mode === 'sync'
        ? 'Drive folder sync (update/delete) is running in background.'
        : 'Drive folder upload is running in background. You can continue browsing.',
    });

    let notFoundStreak = 0;
    let shouldContinuePolling = true;
    const poll = async () => {
      if (drivePollInFlightRef.current) return;
      drivePollInFlightRef.current = true;
      try {
      const statusRes = await fetch(`/api/admin/terramaster?action=upload_job_status&jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
      const statusResult = await statusRes.json();
      if (statusRes.status === 404) {
        notFoundStreak += 1;
        if (notFoundStreak <= 10) return; // tolerate cross-instance lag
      } else {
        notFoundStreak = 0;
      }

      if (!statusRes.ok || !statusResult.success) {
        throw new Error(statusResult?.message || 'Failed to read upload job status.');
      }

      const progress = statusResult.progress || {};
      const total = Number(progress.total || 0);
      const done = Number(progress.done || 0);
      const safeTotal = Math.max(total, driveLastProgressTotalRef.current);
      const safeDone = Math.max(done, driveLastProgressDoneRef.current);
      driveLastProgressTotalRef.current = safeTotal;
      driveLastProgressDoneRef.current = safeDone;

      setFolderUploadTotal(safeTotal);
      setFolderUploadDone(safeDone);
      setFolderUploadCurrent(String(progress.current || ''));
      setFolderUploadSkipped(Array.isArray(progress.skipped) ? progress.skipped : []);
      setFolderUploadDeleted(Array.isArray(progress.deleted) ? progress.deleted : []);
      setFolderUploadErrors(Array.isArray(progress.errors) ? progress.errors : []);
      if (safeTotal > 0) {
        setLinkUploadProgress(Math.round((safeDone / safeTotal) * 100));
      }

      const status = String(statusResult.status || '');
      if (status === 'completed' || status === 'failed' || status === 'canceled') {
        shouldContinuePolling = false;
        if (driveUploadPollRef.current) {
          clearTimeout(driveUploadPollRef.current);
          driveUploadPollRef.current = null;
        }

        setIsUploadingFromLink(false);
        setDriveUploadJobId(null);
        setIsCancelingDriveUpload(false);
        setActiveDriveJobMode(null);
        drivePollInFlightRef.current = false;

        if (status === 'completed') {
          setLinkUploadProgress(100);
          setLinkUploadDone(true);
          setFolderUploadFinished(true);

          const uploaded: { filename: string; filePath: string; size: number }[] = Array.isArray(progress.uploaded) ? progress.uploaded : [];
          for (const f of uploaded) {
            saveRecentUpload({
              filename: f.filename,
              filePath: f.filePath,
              size: f.size,
              uploadedAt: new Date().toISOString(),
              source: 'link',
              directory: targetPath,
            });
          }
          setRecentUploads(loadRecentUploads());

          toast({
            title: mode === 'sync' ? 'Auto sync complete' : 'Folder upload complete',
            description: `${uploaded.length} uploaded${progress.skipped?.length ? `, ${progress.skipped.length} skipped` : ''}${progress.deleted?.length ? `, ${progress.deleted.length} deleted` : ''}${progress.errors?.length ? `, ${progress.errors.length} error(s)` : ''}.`,
          });
          loadDirectory(currentPath);
        } else if (status === 'canceled') {
          toast({ title: 'Job canceled', description: 'Background Drive job was canceled.' });
        } else {
          throw new Error(statusResult?.errorMessage || 'Background Drive job failed.');
        }
      }
      } finally {
        drivePollInFlightRef.current = false;
      }
    };

    const scheduleNextPoll = () => {
      if (driveUploadPollRef.current) {
        clearTimeout(driveUploadPollRef.current);
      }

      driveUploadPollRef.current = setTimeout(async () => {
        try {
          await poll();
          if (shouldContinuePolling) {
            scheduleNextPoll();
          }
        } catch (pollErr: any) {
          shouldContinuePolling = false;
          if (driveUploadPollRef.current) {
            clearTimeout(driveUploadPollRef.current);
            driveUploadPollRef.current = null;
          }
          setIsUploadingFromLink(false);
          setDriveUploadJobId(null);
          setIsCancelingDriveUpload(false);
          setActiveDriveJobMode(null);
          toast({ variant: 'destructive', title: 'Drive job failed', description: pollErr?.message || String(pollErr) });
        }
      }, DRIVE_UPLOAD_POLL_INTERVAL_MS);
    };

    await poll();
    if (shouldContinuePolling) {
      scheduleNextPoll();
    }
  }, [currentPath, loadDirectory, toast]);

  // ─── Upload from link / Google Drive folder ──────────────────────────────

  const handleUploadFromLink = useCallback(async () => {
    const url = remoteUrl.trim();
    if (!url) {
      toast({ variant: 'destructive', title: 'Missing URL' });
      return;
    }

    const targetPath = remotePath || currentPath || '/';
    const folderMode = isGoogleDriveFolderUrl(url);
    setIsFolderUploadMode(folderMode);

    // ── Google Drive FOLDER ──
    if (folderMode) {
      try {
        await startDriveFolderJob({ action: 'upload_from_link_start', url, targetPath, mode: 'upload' });
      } catch (e: any) {
        if (driveUploadPollRef.current) {
          clearTimeout(driveUploadPollRef.current);
          driveUploadPollRef.current = null;
        }
        setIsUploadingFromLink(false);
        setActiveDriveJobMode(null);
        setDriveUploadJobId(null);
        toast({ variant: 'destructive', title: 'Folder upload failed', description: e?.message });
      }
      return;
    }

    // ── Single file / direct URL ──
    setIsUploadingFromLink(true);
    setLinkUploadProgress(0);
    setLinkUploadDone(false);

    let simProgress = 0;
    linkProgressIntervalRef.current = setInterval(() => {
      simProgress = Math.min(simProgress + Math.random() * 8 + 2, 90);
      setLinkUploadProgress(Math.round(simProgress));
    }, 400);

    try {
      const formData = new FormData();
      formData.append('action', 'upload_from_link');
      formData.append('url', url);
      formData.append('path', targetPath);
      if (remoteFilename.trim()) formData.append('filename', remoteFilename.trim());

      const res = await fetch('/api/admin/terramaster', { method: 'POST', body: formData });
      const result = await res.json();

      if (linkProgressIntervalRef.current) clearInterval(linkProgressIntervalRef.current);
      if (!res.ok || !result.success) throw new Error(result?.message || 'Upload from link failed.');

      setLinkUploadProgress(100);
      setLinkUploadDone(true);
      saveRecentUpload({
        filename: result.filename,
        filePath: result.filePath,
        size: result.size || 0,
        uploadedAt: new Date().toISOString(),
        source: 'link',
        directory: targetPath,
      });
      setRecentUploads(loadRecentUploads());
      toast({ title: 'Link upload complete', description: `${result.filename} saved to NAS.` });
      setRemoteUrl('');
      setRemoteFilename('');
      loadDirectory(currentPath);
      setTimeout(() => { setLinkUploadProgress(0); setLinkUploadDone(false); }, 3000);
    } catch (e: any) {
      if (linkProgressIntervalRef.current) clearInterval(linkProgressIntervalRef.current);
      setLinkUploadProgress(0);
      toast({ variant: 'destructive', title: 'Upload from link failed', description: e?.message });
    } finally {
      setIsUploadingFromLink(false);
    }
  }, [remoteUrl, remoteFilename, remotePath, currentPath, toast, loadDirectory, startDriveFolderJob]);

  const handleSyncFromLink = useCallback(async () => {
    const url = remoteUrl.trim();
    if (!isGoogleDriveFolderUrl(url)) {
      toast({ variant: 'destructive', title: 'Folder link required', description: 'Auto sync works with Google Drive folder links only.' });
      return;
    }

    const targetPath = remotePath || currentPath || '/';
    try {
      await startDriveFolderJob({ action: 'sync_from_link_start', url, targetPath, mode: 'sync' });
    } catch (e: any) {
      if (driveUploadPollRef.current) {
        clearTimeout(driveUploadPollRef.current);
        driveUploadPollRef.current = null;
      }
      setIsUploadingFromLink(false);
      setActiveDriveJobMode(null);
      setDriveUploadJobId(null);
      toast({ variant: 'destructive', title: 'Auto sync failed', description: e?.message || 'Failed to start sync.' });
    }
  }, [remoteUrl, remotePath, currentPath, toast, startDriveFolderJob]);

  const handleSaveDriveFolderLink = useCallback(() => {
    const url = remoteUrl.trim();
    if (!isGoogleDriveFolderUrl(url)) {
      toast({ variant: 'destructive', title: 'Folder link required', description: 'Save works for Google Drive folder links only.' });
      return;
    }

    const targetPath = (remotePath || currentPath || '/').trim() || '/';
    setSavedDriveFolders((prev) => {
      if (prev.some((x) => x.url === url && x.targetPath === targetPath)) {
        return prev;
      }
      return [{ id: crypto.randomUUID(), url, targetPath, autoSync: true }, ...prev];
    });
    toast({ title: 'Folder link saved', description: 'Auto sync entry added.' });
  }, [remoteUrl, remotePath, currentPath, toast]);

  const handleMapDriveFolderForPath = useCallback((targetPath: string) => {
    const url = window.prompt('Paste Google Drive FOLDER link to map with this folder');
    const trimmed = (url || '').trim();
    if (!trimmed) return;
    if (!isGoogleDriveFolderUrl(trimmed)) {
      toast({ variant: 'destructive', title: 'Invalid folder link', description: 'Please paste a Google Drive folder link.' });
      return;
    }

    const normalizedTarget = (targetPath || '/').trim() || '/';
    setRemoteUrl(trimmed);
    setRemotePath(normalizedTarget);
    setIsFolderUploadMode(true);

    setSavedDriveFolders((prev) => {
      if (prev.some((x) => x.url === trimmed && x.targetPath === normalizedTarget)) return prev;
      return [{ id: crypto.randomUUID(), url: trimmed, targetPath: normalizedTarget, autoSync: true }, ...prev];
    });

    toast({ title: 'Folder mapping added', description: `Drive folder linked to ${normalizedTarget}` });
  }, [toast]);

  const handleRemoveSavedDriveFolder = useCallback((id: string) => {
    setSavedDriveFolders((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const handleToggleSavedDriveFolderAutoSync = useCallback((id: string, enabled: boolean) => {
    setSavedDriveFolders((prev) => prev.map((x) => (x.id === id ? { ...x, autoSync: enabled } : x)));
  }, []);

  const handleRunSavedDriveFolderSync = useCallback(async (entry: SavedDriveFolderLink) => {
    setRemoteUrl(entry.url);
    setRemotePath(entry.targetPath);
    try {
      await startDriveFolderJob({ action: 'sync_from_link_start', url: entry.url, targetPath: entry.targetPath, mode: 'sync' });
      setSavedDriveFolders((prev) => prev.map((x) => (x.id === entry.id ? { ...x, lastQueuedAt: new Date().toISOString() } : x)));
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Sync failed', description: e?.message || 'Could not start sync job.' });
    }
  }, [startDriveFolderJob, toast]);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (autoSyncTickRef.current) return;
      if (isUploadingFromLink || !!driveUploadJobId) return;

      const next = savedDriveFolders.find((x) => {
        if (!x.autoSync) return false;
        if (!x.lastQueuedAt) return true;
        return Date.now() - new Date(x.lastQueuedAt).getTime() >= 5 * 60 * 1000;
      });

      if (!next) return;

      autoSyncTickRef.current = true;
      try {
        await startDriveFolderJob({ action: 'sync_from_link_start', url: next.url, targetPath: next.targetPath, mode: 'sync' });
        setSavedDriveFolders((prev) => prev.map((x) => (x.id === next.id ? { ...x, lastQueuedAt: new Date().toISOString() } : x)));
      } catch {
        // silent on background auto tick
      } finally {
        autoSyncTickRef.current = false;
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [savedDriveFolders, isUploadingFromLink, driveUploadJobId, startDriveFolderJob]);

  const handleCancelDriveUpload = useCallback(async () => {
    if (!driveUploadJobId) return;
    setIsCancelingDriveUpload(true);
    try {
      const formData = new FormData();
      formData.append('action', 'upload_job_cancel');
      formData.append('jobId', driveUploadJobId);

      const res = await fetch('/api/admin/terramaster', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result?.message || 'Failed to cancel upload.');
      toast({ title: 'Cancel requested', description: 'Upload will stop shortly.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Cancel failed', description: e?.message });
    } finally {
      setIsCancelingDriveUpload(false);
    }
  }, [driveUploadJobId, toast]);

  // ─── Download ────────────────────────────────────────────────────────────

  const handleDownload = useCallback(async (relativePath: string, filename: string) => {
    try {
      const res = await fetch(`/api/admin/terramaster?action=download&path=${encodeURIComponent(relativePath)}`);
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message || 'Download failed.'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Download failed', description: e?.message });
    }
  }, [toast]);

  const buildPublicFileUrl = useCallback((relativePath: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/api/admin/terramaster?action=public&path=${encodeURIComponent(relativePath)}`;
  }, []);

  const handleCopyPublicLink = useCallback(async (relativePath: string, filename: string) => {
    try {
      const url = buildPublicFileUrl(relativePath);
      if (!url) throw new Error('Unable to build public URL.');

      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      toast({ title: 'Public link copied', description: `${filename} link copied.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Copy failed', description: e?.message || 'Could not copy link.' });
    }
  }, [buildPublicFileUrl, toast]);

  const handleOpenPublicLink = useCallback((relativePath: string) => {
    const url = buildPublicFileUrl(relativePath);
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [buildPublicFileUrl]);

  // ─── Delete ──────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/terramaster?path=${encodeURIComponent(deleteTarget.relativePath)}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result?.message || 'Delete failed.');
      toast({ title: 'Deleted', description: `${deleteTarget.name} was deleted from TerraMaster.` });
      setDeleteTarget(null);
      loadDirectory(currentPath);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Delete failed', description: e?.message });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, currentPath, toast, loadDirectory]);

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt('Enter new folder name');
    if (!name?.trim()) return;

    setIsCreatingFolder(true);
    try {
      const formData = new FormData();
      formData.append('action', 'create_folder');
      formData.append('path', currentPath || '/');
      formData.append('folderName', name.trim());

      const res = await fetch('/api/admin/terramaster', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result?.message || 'Create folder failed.');

      toast({ title: 'Folder created', description: `${result.folderName} created.` });
      await loadDirectory(currentPath);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Create folder failed', description: e?.message });
    } finally {
      setIsCreatingFolder(false);
    }
  }, [currentPath, loadDirectory, toast]);

  const handleRenameFolder = useCallback(async (entry: TerraMasterEntry) => {
    const newName = window.prompt('Rename folder', entry.basename);
    if (!newName?.trim() || newName.trim() === entry.basename) return;

    setIsRenamingFolder(true);
    try {
      const formData = new FormData();
      formData.append('action', 'rename_entry');
      formData.append('path', entry.relativePath);
      formData.append('newName', newName.trim());

      const res = await fetch('/api/admin/terramaster', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result?.message || 'Rename failed.');

      toast({ title: 'Folder renamed', description: `${entry.basename} → ${result.newName}` });
      await loadDirectory(currentPath);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Rename failed', description: e?.message });
    } finally {
      setIsRenamingFolder(false);
    }
  }, [currentPath, loadDirectory, toast]);

  // ─── Render file row ─────────────────────────────────────────────────────

  const renderFileRow = (entry: TerraMasterEntry) => (
    <TableRow key={entry.filename}>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          {entry.type === 'directory'
            ? <Folder className="h-4 w-4 text-amber-500 shrink-0" />
            : <File className="h-4 w-4 text-muted-foreground shrink-0" />}
          {entry.type === 'directory' ? (
            <button type="button" className="text-left text-primary hover:underline truncate max-w-[200px]" onClick={() => loadDirectory(entry.relativePath)}>
              {entry.basename}
            </button>
          ) : <span className="truncate max-w-[200px]">{entry.basename}</span>}
        </div>
      </TableCell>
      <TableCell>
        {entry.type === 'file' && isImageFile(entry.basename) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/admin/terramaster?action=view&path=${encodeURIComponent(entry.relativePath)}`}
            alt={entry.basename}
            loading="lazy"
            className="h-10 w-10 rounded border object-cover cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => openPreview({ name: entry.basename, relativePath: entry.relativePath })}
          />
        ) : <span className="text-muted-foreground text-sm">—</span>}
      </TableCell>
      <TableCell>
        <Badge variant={entry.type === 'directory' ? 'secondary' : 'outline'}>{entry.type}</Badge>
      </TableCell>
      <TableCell className="text-sm">{entry.type === 'file' ? formatBytes(entry.size) : '—'}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{formatDate(entry.lastmod)}</TableCell>
      <TableCell className="text-right">
        {entry.type === 'file' ? (
          <div className="flex flex-wrap justify-end gap-2">
            {isImageFile(entry.basename) && (
              <Button size="sm" variant="secondary" onClick={() => openPreview({ name: entry.basename, relativePath: entry.relativePath })}>
                <Eye className="mr-1 h-3.5 w-3.5" /> View
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => handleDownload(entry.relativePath, entry.basename)}>
              <Download className="mr-1 h-3.5 w-3.5" /> Download
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleCopyPublicLink(entry.relativePath, entry.basename)}>
              <Copy className="mr-1 h-3.5 w-3.5" /> Public Link
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleOpenPublicLink(entry.relativePath)}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open Public Link
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDeleteTarget({ name: entry.basename, relativePath: entry.relativePath })}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => loadDirectory(entry.relativePath)}>
              <Folder className="mr-1 h-3.5 w-3.5" /> Open
            </Button>
            {(() => {
              const mapped = savedDriveFolders.find((x) => x.targetPath === entry.relativePath);
              if (!mapped) {
                return (
                  <Button size="sm" variant="outline" onClick={() => handleMapDriveFolderForPath(entry.relativePath)}>
                    <LinkIcon className="mr-1 h-3.5 w-3.5" /> Map Drive
                  </Button>
                );
              }
              return (
                <>
                  <Button size="sm" variant="outline" disabled={isUploadingFromLink} onClick={() => handleRunSavedDriveFolderSync(mapped)}>
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> Sync
                  </Button>
                  <Button
                    size="sm"
                    variant={mapped.autoSync ? 'default' : 'outline'}
                    disabled={isUploadingFromLink}
                    onClick={() => handleToggleSavedDriveFolderAutoSync(mapped.id, !mapped.autoSync)}
                  >
                    {mapped.autoSync ? 'Auto ON' : 'Auto OFF'}
                  </Button>
                  <Button size="sm" variant="destructive" disabled={isUploadingFromLink} onClick={() => handleRemoveSavedDriveFolder(mapped.id)}>
                    Unmap
                  </Button>
                </>
              );
            })()}
            <Button size="sm" variant="secondary" disabled={isRenamingFolder} onClick={() => handleRenameFolder(entry)}>
              <Pencil className="mr-1 h-3.5 w-3.5" /> Rename
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );

  // ─── JSX ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header stats ── */}
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-primary" /> TerraMaster Drive
              </CardTitle>
              <CardDescription>Browse, upload, and download files via WebDAV. Import directly from Google Drive links.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => runConnectionDiagnosis(true)} disabled={isDiagnosingConnection}>
              {isDiagnosingConnection ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Diagnose connection
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {[
              { label: 'Current path', value: currentPath },
              { label: 'Files', value: fileCount },
              { label: 'Folders', value: folderCount },
              { label: 'Total size', value: formatBytes(totalFileSize) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-2 font-semibold break-all">{value}</p>
              </div>
            ))}
          </div>

          {(lastConnectionError || connectionDiagnosis) && (
            <Alert variant={connectionDiagnosis?.success ? 'default' : 'destructive'}>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {connectionDiagnosis?.success ? 'TerraMaster connection resolved' : 'TerraMaster connection needs attention'}
              </AlertTitle>
              <AlertDescription className="space-y-2">
                {!connectionDiagnosis?.success && lastConnectionError && <p>{lastConnectionError}</p>}
                {connectionDiagnosis?.success ? (
                  <div className="space-y-1 text-xs">
                    <p><span className="font-medium">Resolved URL:</span> <span className="break-all">{connectionDiagnosis.resolvedUrl || connectionDiagnosis.configuredUrl}</span></p>
                    <p><span className="font-medium">Auth mode:</span> {connectionDiagnosis.resolvedAuthType || connectionDiagnosis.authPreference}</p>
                    <p><span className="font-medium">Base path:</span> {connectionDiagnosis.basePath}</p>
                  </div>
                ) : connectionDiagnosis ? (
                  <div className="space-y-2 text-xs">
                    {connectionDiagnosis.error && <p>{connectionDiagnosis.error}</p>}
                    <div className="space-y-1">
                      <p><span className="font-medium">Configured URL:</span> <span className="break-all">{connectionDiagnosis.configuredUrl}</span></p>
                      <p><span className="font-medium">Auth preference:</span> {connectionDiagnosis.authPreference}</p>
                      <p><span className="font-medium">Base path:</span> {connectionDiagnosis.basePath}</p>
                    </div>
                    {!!connectionDiagnosis.attempts?.length && (
                      <div className="space-y-1">
                        <p className="font-medium">Probe attempts</p>
                        {connectionDiagnosis.attempts.slice(0, 5).map((attempt, idx) => (
                          <p key={`${attempt.url}-${attempt.authType}-${idx}`} className="break-all">
                            {attempt.authType.toUpperCase()} → {attempt.url}{attempt.error ? ` — ${attempt.error}` : ''}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* ── Upload panels ── */}
      <div className="grid gap-6 xl:grid-cols-2">

        {/* Local file upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Upload Local File / Folder</CardTitle>
            <CardDescription>Select a file or full folder from your computer to send to TerraMaster.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>File</Label>
              <Input type="file" onChange={(e) => {
                setSelectedFile(e.target.files?.[0] || null);
                setSelectedFolderFiles([]);
                setLocalUploadDone(false);
                setLocalUploadProgress(0);
              }} />
              {selectedFile && <p className="text-xs text-muted-foreground">{selectedFile.name} — {formatBytes(selectedFile.size)}</p>}
            </div>
            <div className="space-y-2">
              <Label>Folder</Label>
              <Input
                type="file"
                multiple
                {...({ webkitdirectory: 'true', directory: 'true' } as any)}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  setSelectedFolderFiles(files);
                  setSelectedFile(null);
                  setLocalUploadDone(false);
                  setLocalUploadProgress(0);
                }}
              />
              {selectedFolderFiles.length > 0 && (
                <p className="text-xs text-muted-foreground">{selectedFolderFiles.length} files selected from folder.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Target folder path</Label>
              <Input value={uploadPath} onChange={(e) => setUploadPath(e.target.value)} placeholder="/" />
            </div>

            {/* Progress */}
            {(isUploadingFile || localUploadProgress > 0) && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{localUploadDone ? 'Upload complete!' : 'Uploading…'}</span>
                  <span>{localUploadProgress}%</span>
                </div>
                <Progress value={localUploadProgress} className="h-2" />
              </div>
            )}
            {localUploadDone && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                <CheckCircle2 className="h-4 w-4" /> Upload saved to TerraMaster.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleLocalUpload} disabled={!selectedFile || isUploadingFile} className="w-full sm:w-auto">
                {isUploadingFile && selectedFile
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading {localUploadProgress}%…</>
                  : <><Upload className="mr-2 h-4 w-4" /> Upload File</>}
              </Button>
              <Button variant="secondary" onClick={handleLocalFolderUpload} disabled={selectedFolderFiles.length === 0 || isUploadingFile} className="w-full sm:w-auto">
                {isUploadingFile && selectedFolderFiles.length > 0
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading Folder {localUploadProgress}%…</>
                  : <><Folder className="mr-2 h-4 w-4" /> Upload Full Folder</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Google Drive / URL upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><LinkIcon className="h-5 w-5" /> Upload from Google Drive / URL</CardTitle>
            <CardDescription>Backend fetches the remote file and saves it directly to NAS.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Google Drive or public URL</Label>
              <Input value={remoteUrl} onChange={(e) => {
                const nextUrl = e.target.value;
                setRemoteUrl(nextUrl);
                setIsFolderUploadMode(isGoogleDriveFolderUrl(nextUrl));
                setLinkUploadDone(false);
                setLinkUploadProgress(0);
                setFolderUploadFinished(false);
              }} placeholder="https://drive.google.com/file/d/… or /folders/…" />
              {(isFolderUploadMode || isGoogleDriveFolderUrl(remoteUrl)) && (
                <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">📂 Google Drive folder detected — all files will be uploaded to TerraMaster.</p>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Save as filename <span className="text-muted-foreground">(single file only)</span></Label>
                <Input value={remoteFilename} onChange={(e) => setRemoteFilename(e.target.value)} placeholder="photo.jpg" disabled={isFolderUploadMode || isGoogleDriveFolderUrl(remoteUrl)} />
              </div>
              <div className="space-y-2">
                <Label>Target folder path</Label>
                <Input value={remotePath} onChange={(e) => setRemotePath(e.target.value)} placeholder="/" />
                {(isFolderUploadMode || isGoogleDriveFolderUrl(remoteUrl)) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => setRemotePath(currentPath)}>
                      Link to current browsed folder
                    </Button>
                    <p className="text-[11px] text-muted-foreground">Use &quot;Save Folder Link&quot; below for persistent auto-sync mapping.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Folder upload progress */}
            {(isFolderUploadMode || isGoogleDriveFolderUrl(remoteUrl)) && (isUploadingFromLink || folderUploadTotal > 0 || folderUploadFinished) && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>
                    {folderUploadFinished
                      ? `✅ Done — ${folderUploadDone} of ${folderUploadTotal} files uploaded`
                      : folderUploadTotal > 0
                        ? `Uploading ${folderUploadDone + 1} / ${folderUploadTotal}…`
                        : 'Reading folder…'}
                  </span>
                  <span>{linkUploadProgress}%</span>
                </div>
                <Progress value={linkUploadProgress} className="h-2" />
                {folderUploadCurrent && !folderUploadFinished && (
                  <p className="text-xs text-muted-foreground truncate">⏳ {folderUploadCurrent}</p>
                )}
                {folderUploadSkipped.length > 0 && (
                  <p className="text-xs text-amber-600">⏭ Skipped duplicates: {folderUploadSkipped.length}</p>
                )}
                {folderUploadDeleted.length > 0 && (
                  <p className="text-xs text-blue-600">🗑 Deleted (removed from Drive): {folderUploadDeleted.length}</p>
                )}
                {folderUploadErrors.length > 0 && (
                  <div className="text-xs text-destructive space-y-0.5 max-h-24 overflow-auto">
                    {folderUploadErrors.map((e, i) => (
                      <p key={i}>⚠ {e.filename}: {e.error}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Single-file progress */}
            {!isGoogleDriveFolderUrl(remoteUrl) && (isUploadingFromLink || linkUploadProgress > 0) && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{linkUploadDone ? 'Saved to NAS!' : 'Fetching & uploading…'}</span>
                  <span>{linkUploadProgress}%</span>
                </div>
                <Progress value={linkUploadProgress} className="h-2" />
              </div>
            )}
            {!isGoogleDriveFolderUrl(remoteUrl) && linkUploadDone && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                <CheckCircle2 className="h-4 w-4" /> File saved to TerraMaster.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleUploadFromLink} disabled={!remoteUrl.trim() || isUploadingFromLink} className="w-full sm:w-auto">
                {isUploadingFromLink
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {(isFolderUploadMode || isGoogleDriveFolderUrl(remoteUrl)) && folderUploadTotal > 0
                        ? `${folderUploadDone}/${folderUploadTotal} files…`
                        : `${activeDriveJobMode === 'sync' ? 'Syncing' : 'Uploading'} ${linkUploadProgress}%…`}
                    </>
                  : (isFolderUploadMode || isGoogleDriveFolderUrl(remoteUrl))
                    ? <><Upload className="mr-2 h-4 w-4" /> Upload Entire Folder</>
                    : <><LinkIcon className="mr-2 h-4 w-4" /> Fetch and Upload</>}
              </Button>

              {(isFolderUploadMode || isGoogleDriveFolderUrl(remoteUrl)) && !isUploadingFromLink && (
                <Button variant="outline" onClick={handleSyncFromLink} className="w-full sm:w-auto">
                  <RefreshCw className="mr-2 h-4 w-4" /> Manual Sync Now (Update/Upload/Delete)
                </Button>
              )}

              {(isFolderUploadMode || isGoogleDriveFolderUrl(remoteUrl)) && !isUploadingFromLink && (
                <Button variant="secondary" onClick={handleSaveDriveFolderLink} className="w-full sm:w-auto">
                  <FolderPlus className="mr-2 h-4 w-4" /> Save Folder Link (Auto Sync)
                </Button>
              )}

              <Button variant="outline" onClick={() => handleMapDriveFolderForPath(currentPath)} className="w-full sm:w-auto">
                <LinkIcon className="mr-2 h-4 w-4" /> Map Drive Link to Current Folder
              </Button>

              {(isFolderUploadMode || isGoogleDriveFolderUrl(remoteUrl)) && isUploadingFromLink && driveUploadJobId && (
                <Button
                  variant="destructive"
                  onClick={handleCancelDriveUpload}
                  disabled={isCancelingDriveUpload}
                  className="w-full sm:w-auto"
                >
                  {isCancelingDriveUpload
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Canceling…</>
                    : <>Cancel Upload</>}
                </Button>
              )}
            </div>

            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved Drive Folder Links (Auto Sync every ~5 min)</p>
              {savedDriveFolders.length === 0 ? (
                <p className="text-xs text-muted-foreground">No mapping saved yet. Use “Save Folder Link” or “Map Drive Link to Current Folder”.</p>
              ) : (
                <div className="space-y-2 max-h-44 overflow-auto">
                  {savedDriveFolders.map((item) => (
                    <div key={item.id} className="rounded border bg-muted/20 p-2">
                      <p className="text-xs truncate" title={item.url}>{item.url}</p>
                      <p className="text-[11px] text-muted-foreground truncate" title={item.targetPath}>→ {item.targetPath}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleRunSavedDriveFolderSync(item)} disabled={isUploadingFromLink}>
                          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Manual Sync
                        </Button>
                        <Button
                          size="sm"
                          variant={item.autoSync ? 'default' : 'outline'}
                          onClick={() => handleToggleSavedDriveFolderAutoSync(item.id, !item.autoSync)}
                          disabled={isUploadingFromLink}
                        >
                          {item.autoSync ? 'Auto ON' : 'Auto OFF'}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleRemoveSavedDriveFolder(item.id)} disabled={isUploadingFromLink}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Recent Uploads ── */}
      {recentUploads.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /> Recent Uploads</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => { localStorage.removeItem(RECENT_UPLOADS_KEY); setRecentUploads([]); }}>Clear</Button>
            </div>
            <CardDescription>Last {recentUploads.length} file{recentUploads.length !== 1 ? 's' : ''} uploaded (stored locally in your browser).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border max-h-[280px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Directory</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentUploads.map((u, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium max-w-[160px] truncate">{u.filename}</TableCell>
                      <TableCell>{formatBytes(u.size)}</TableCell>
                      <TableCell>
                        <Badge variant={u.source === 'link' ? 'secondary' : 'outline'}>
                          {u.source === 'link' ? 'Drive/URL' : 'Local'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{u.directory}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                          <Clock className="h-3 w-3" /> {formatRelativeTime(u.uploadedAt)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleCopyPublicLink(u.filePath, u.filename)}>
                            <Copy className="mr-1 h-3.5 w-3.5" /> Copy Link
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleDownload(u.filePath, u.filename)}>
                            <Download className="mr-1 h-3.5 w-3.5" /> Download
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── File Browser ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle>Browse TerraMaster</CardTitle>
              <CardDescription>
                Navigate folders.{imageCount > 0 ? ` ${imageCount} image${imageCount !== 1 ? 's' : ''} in this folder.` : ''}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={viewMode === 'list' ? 'default' : 'outline'} onClick={() => setViewMode('list')}>List</Button>
              <Button size="sm" variant={viewMode === 'date' ? 'default' : 'outline'} onClick={() => setViewMode('date')}>By Date</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Navigation bar */}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">
            <Input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="/"
              onKeyDown={(e) => e.key === 'Enter' && loadDirectory(pathInput || '/')}
            />
            <Button variant="outline" onClick={() => loadDirectory(pathInput || '/')} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Open</span>
            </Button>
            <Button variant="outline" onClick={() => parentPath && loadDirectory(parentPath)} disabled={!parentPath || isLoading}>
              <ArrowUp className="mr-2 h-4 w-4" /> Up
            </Button>
            <Button variant="secondary" onClick={() => loadDirectory(currentPath)} disabled={isLoading}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button onClick={handleCreateFolder} disabled={isLoading || isCreatingFolder}>
              {isCreatingFolder ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderPlus className="mr-2 h-4 w-4" />}
              New Folder
            </Button>
          </div>

          {(() => {
            const mappedCurrent = savedDriveFolders.find((x) => x.targetPath === currentPath);
            if (!mappedCurrent) return null;
            return (
              <div className="rounded-md border bg-muted/20 p-2 flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground mr-1">Mapped Drive sync for this folder</p>
                <Button size="sm" variant="outline" disabled={isUploadingFromLink} onClick={() => handleRunSavedDriveFolderSync(mappedCurrent)}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> Manual Sync
                </Button>
                <Button
                  size="sm"
                  variant={mappedCurrent.autoSync ? 'default' : 'outline'}
                  disabled={isUploadingFromLink}
                  onClick={() => handleToggleSavedDriveFolderAutoSync(mappedCurrent.id, !mappedCurrent.autoSync)}
                >
                  {mappedCurrent.autoSync ? 'Auto ON' : 'Auto OFF'}
                </Button>
                <Button size="sm" variant="destructive" disabled={isUploadingFromLink} onClick={() => handleRemoveSavedDriveFolder(mappedCurrent.id)}>
                  Unmap
                </Button>
              </div>
            );
          })()}

          {/* ── List view ── */}
          {viewMode === 'list' && (
            <div className="rounded-md border max-h-[520px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Thumbnail</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Last Modified</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                      </TableCell>
                    </TableRow>
                  ) : entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">Folder is empty.</TableCell>
                    </TableRow>
                  ) : entries.map(renderFileRow)}
                </TableBody>
              </Table>
            </div>
          )}

          {/* ── Date view — files grouped by modification date ── */}
          {viewMode === 'date' && (
            <div className="space-y-8 max-h-[640px] overflow-auto pr-1">
              {isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : filesOnly.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No files in this folder.</p>
              ) : grouped.map(({ dateLabel, items }) => (
                <div key={dateLabel}>
                  {/* Date divider */}
                  <div className="mb-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">{dateLabel}</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  {/* Grid of files */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {items.map((entry) => (
                      <div key={entry.filename} className="group relative rounded-xl border bg-background overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                        {isImageFile(entry.basename) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/admin/terramaster?action=view&path=${encodeURIComponent(entry.relativePath)}`}
                            alt={entry.basename}
                            loading="lazy"
                            className="aspect-square w-full object-cover cursor-pointer"
                            onClick={() => openPreview({ name: entry.basename, relativePath: entry.relativePath })}
                          />
                        ) : (
                          <div className="aspect-square w-full bg-muted flex items-center justify-center">
                            <File className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        <div className="p-2">
                          <p className="truncate text-xs font-medium" title={entry.basename}>{entry.basename}</p>
                          <p className="text-[10px] text-muted-foreground">{formatBytes(entry.size)}</p>
                        </div>
                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          {isImageFile(entry.basename) && (
                            <button
                              type="button"
                              className="rounded-full bg-white/20 p-2 text-white hover:bg-white/40 transition-colors"
                              onClick={() => openPreview({ name: entry.basename, relativePath: entry.relativePath })}
                              title="View full size"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="rounded-full bg-white/20 p-2 text-white hover:bg-white/40 transition-colors"
                            onClick={() => handleDownload(entry.relativePath, entry.basename)}
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-full bg-white/20 p-2 text-white hover:bg-white/40 transition-colors"
                            onClick={() => handleCopyPublicLink(entry.relativePath, entry.basename)}
                            title="Copy public link"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-full bg-white/20 p-2 text-white hover:bg-white/40 transition-colors"
                            onClick={() => handleOpenPublicLink(entry.relativePath)}
                            title="Open public link"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-full bg-red-500/70 p-2 text-white hover:bg-red-600/90 transition-colors"
                            onClick={() => setDeleteTarget({ name: entry.basename, relativePath: entry.relativePath })}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Delete confirmation dialog ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete{' '}
              <span className="font-semibold text-foreground">{deleteTarget?.name}</span> from TerraMaster?
              <br />
              <span className="text-destructive font-medium">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…</> : <><Trash2 className="mr-2 h-4 w-4" /> Yes, delete</>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Image preview dialog ── */}
      <Dialog open={!!previewImage} onOpenChange={(open) => { if (!open) { setPreviewImage(null); setPreviewIndex(-1); } }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-4 pr-8">
              <span className="truncate">{previewImage?.name || 'Image preview'}</span>
              {imageEntries.length > 1 && (
                <span className="text-xs font-normal text-muted-foreground whitespace-nowrap">
                  {previewIndex + 1} / {imageEntries.length}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {previewImage && (
            <div className="flex flex-col gap-3">
              <div className="relative max-h-[70vh] overflow-auto rounded-md border bg-muted/20 p-2 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/admin/terramaster?action=view&path=${encodeURIComponent(previewImage.relativePath)}`}
                  alt={previewImage.name}
                  className="max-h-[68vh] w-auto rounded object-contain"
                />
                {/* Prev / Next overlays */}
                {imageEntries.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={goPreviewPrev}
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/70 transition-colors"
                      title="Previous image (←)"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={goPreviewNext}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/70 transition-colors"
                      title="Next image (→)"
                    >
                      <ArrowRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center justify-between">
                {imageEntries.length > 1 ? (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={goPreviewPrev}>
                      <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
                    </Button>
                    <Button variant="outline" size="sm" onClick={goPreviewNext}>
                      Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : <div />}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => handleCopyPublicLink(previewImage.relativePath, previewImage.name)}>
                    <Copy className="mr-2 h-4 w-4" /> Copy Link
                  </Button>
                  <Button variant="outline" onClick={() => handleOpenPublicLink(previewImage.relativePath)}>
                    <ExternalLink className="mr-2 h-4 w-4" /> Open Link
                  </Button>
                  <Button variant="outline" onClick={() => handleDownload(previewImage.relativePath, previewImage.name)}>
                    <Download className="mr-2 h-4 w-4" /> Download
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
