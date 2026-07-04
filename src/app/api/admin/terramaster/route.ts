import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import {
  createTerraMasterFolder,
  deleteFileFromTerraMaster,
  diagnoseTerraMasterConnection,
  fetchFileBufferFromTerraMaster,
  isGoogleDriveFolderUrl,
  listTerraMasterDirectory,
  renameTerraMasterEntry,
  syncGoogleDriveFolderToTerraMaster,
  uploadFromRemoteUrlToTerraMaster,
  uploadGoogleDriveFolderToTerraMaster,
  uploadToTerraMaster,
} from '@/lib/terramaster/webdav';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getContentTypeFromFilename(filename: string): string {
  const ext = path.extname(filename || '').toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.csv': 'text/csv; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
  };
  return map[ext] || 'application/octet-stream';
}

function isExternallyReachableHost(hostname: string): boolean {
  const host = (hostname || '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return false;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  return true;
}

function getPublicOrigin(request: NextRequest): string | null {
  const xfHost = (request.headers.get('x-forwarded-host') || '').split(',')[0].trim();
  const xfProto = (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim() || 'https';
  if (xfHost && isExternallyReachableHost(xfHost) && xfProto === 'https') {
    return `${xfProto}://${xfHost}`;
  }

  const host = request.nextUrl.hostname;
  const proto = request.nextUrl.protocol.replace(':', '');
  if (isExternallyReachableHost(host) && proto === 'https') {
    return `${proto}://${host}`;
  }

  return null;
}

function buildNoPreviewHtml(args: { filename: string; downloadUrl: string; viewUrl: string; message?: string }) {
  const { filename, downloadUrl, viewUrl, message } = args;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>No preview available</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; }
      .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
      .card { max-width: 560px; width: 100%; background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      h1 { font-size: 24px; margin: 0 0 8px; }
      p { color: #475569; line-height: 1.5; }
      .name { font-weight: 600; color: #0f172a; word-break: break-all; }
      .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
      a { text-decoration: none; padding: 10px 14px; border-radius: 10px; border: 1px solid #cbd5e1; color: #0f172a; }
      a.primary { background: #0f172a; color: white; border-color: #0f172a; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>No preview available</h1>
        <p>${message || 'This file cannot be previewed in the browser.'}</p>
        <p class="name">${filename}</p>
        <div class="actions">
          <a class="primary" href="${downloadUrl}">Download file</a>
          <a href="${viewUrl}">Try direct open</a>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

function getErrorHeader(error: any, headerName: string): string {
  const headers = error?.response?.headers;
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return String(headers.get(headerName) || '').trim();
  }
  const direct = headers?.[headerName] || headers?.[headerName.toLowerCase()] || headers?._headers?.[headerName.toLowerCase()];
  if (Array.isArray(direct)) return String(direct[0] || '').trim();
  return String(direct || '').trim();
}

function normalizeTerraMasterApiError(error: any): { message: string; status: number } {
  const raw = String(error?.message || error || '').trim();
  const lc = raw.toLowerCase();
  const status = Number(error?.status || error?.response?.status || 0);
  const server = getErrorHeader(error, 'server').toLowerCase();
  const responseUrl = String(error?.response?.url || '').trim();

  if (status === 530 && server.includes('cloudflare')) {
    return {
      message:
        `TerraMaster endpoint is failing at Cloudflare before WebDAV auth. Cloudflare returned 530/1033 for ${responseUrl || 'the configured URL'}, which means the tunnel/origin behind tnas.bergmantri.com is unreachable or misrouted. Fix the Cloudflare Tunnel/public hostname first; credentials will not help until the hostname reaches the NAS WebDAV service directly.`,
      status: 502,
    };
  }

  if (lc.includes('1033') || (lc.includes('cloudflare') && lc.includes('530'))) {
    return {
      message:
        'TerraMaster endpoint is behind Cloudflare but origin is unreachable (Cloudflare 1033/530). Ensure the NAS tunnel/origin is online and DNS for TERRAMASTER_WEBDAV_URL points to an active tunnel before retrying.',
      status: 502,
    };
  }

  if (lc.includes('530') || lc.includes('invalid response 530')) {
    return {
      message:
        'TerraMaster authentication failed (530). This is often caused by the wrong WebDAV endpoint, a digest-vs-basic auth mismatch, or a Cloudflare/Tunnel login page in front of the NAS. Verify the credentials, confirm TERRAMASTER_WEBDAV_URL is the actual WebDAV endpoint, and run /api/admin/terramaster?action=diagnose for a full probe.',
      status: 502,
    };
  }

  if (lc.includes('self signed certificate') || lc.includes('unable to verify the first certificate')) {
    return {
      message:
        'TerraMaster TLS certificate validation failed. If your NAS uses a self-signed certificate, set TERRAMASTER_WEBDAV_ALLOW_SELF_SIGNED=true in production.',
      status: 502,
    };
  }

  if (lc.includes('timeout')) {
    return {
      message:
        'TerraMaster request timed out. Check NAS reachability from Cloud Run and consider increasing TERRAMASTER_WEBDAV_TIMEOUT_MS.',
      status: 504,
    };
  }

  return {
    message: raw || 'Server error while processing TerraMaster request.',
    status: 500,
  };
}

function logTerraMasterApiError(actionName: string, error: any) {
  const normalized = normalizeTerraMasterApiError(error);
  const attempts = Array.isArray(error?.attempts) ? error.attempts.slice(0, 3) : [];

  if (normalized.status === 502 || normalized.status === 504) {
    console.error(`${actionName} ${normalized.status}: ${normalized.message}`, attempts.length ? { attempts } : undefined);
    return normalized;
  }

  console.error(`${actionName} Error:`, error);
  return normalized;
}

type DriveUploadJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

interface DriveUploadJob {
  id: string;
  mode: 'upload' | 'sync';
  status: DriveUploadJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  url: string;
  requestedDirectory: string;
  progress: {
    total: number;
    done: number;
    current: string;
    uploaded: { filename: string; filePath: string; size: number }[];
    skipped: { filename: string; reason: string }[];
    deleted?: { filename: string; reason: string }[];
    errors: { filename: string; error: string }[];
    canceled?: boolean;
  };
  cancelRequested: boolean;
  errorMessage?: string;
}

const driveUploadJobs = new Map<string, DriveUploadJob>();
const DRIVE_JOB_COLLECTION = 'terramaster_drive_jobs';

async function persistDriveJob(job: DriveUploadJob) {
  try {
    const db = getFirestoreInstance();
    await db.collection(DRIVE_JOB_COLLECTION).doc(job.id).set({
      ...job,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch {
    // Non-fatal: in-memory map remains fallback
  }
}

async function loadDriveJob(jobId: string): Promise<DriveUploadJob | null> {
  const inMemory = driveUploadJobs.get(jobId);
  if (inMemory) return inMemory;

  try {
    const db = getFirestoreInstance();
    const snap = await db.collection(DRIVE_JOB_COLLECTION).doc(jobId).get();
    if (!snap.exists) return null;
    const data = snap.data() as DriveUploadJob;
    if (!data?.id) return null;
    driveUploadJobs.set(jobId, data);
    return data;
  } catch {
    return null;
  }
}

function createDriveUploadJob(url: string, requestedDirectory: string, mode: 'upload' | 'sync' = 'upload'): DriveUploadJob {
  const id = crypto.randomUUID();
  const job: DriveUploadJob = {
    id,
    mode,
    status: 'queued',
    createdAt: new Date().toISOString(),
    url,
    requestedDirectory,
    progress: {
      total: 0,
      done: 0,
      current: '',
      uploaded: [],
      skipped: [],
      errors: [],
    },
    cancelRequested: false,
  };
  driveUploadJobs.set(id, job);
  void persistDriveJob(job);
  return job;
}

async function runDriveUploadJob(job: DriveUploadJob) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  await persistDriveJob(job);

  try {
    const result = job.mode === 'sync'
      ? await syncGoogleDriveFolderToTerraMaster(
        job.url,
        job.requestedDirectory,
        (progress) => {
          job.progress = { ...progress };
          void persistDriveJob(job);
        },
        {
          shouldCancel: () => job.cancelRequested,
        }
      )
      : await uploadGoogleDriveFolderToTerraMaster(
        job.url,
        job.requestedDirectory,
        (progress) => {
          job.progress = { ...progress };
          void persistDriveJob(job);
        },
        {
          shouldCancel: () => job.cancelRequested,
        }
      );

    job.progress = { ...result };
    if (result.canceled || job.cancelRequested) {
      job.status = 'canceled';
    } else {
      job.status = 'completed';
    }
    await persistDriveJob(job);
  } catch (error: any) {
    job.status = 'failed';
    job.errorMessage = error?.message || 'Upload job failed.';
    await persistDriveJob(job);
  } finally {
    job.finishedAt = new Date().toISOString();
    await persistDriveJob(job);
  }
}

export async function GET(request: NextRequest) {
  const actionName = '[API /admin/terramaster GET]';

  try {
    const action = (request.nextUrl.searchParams.get('action') || 'list').trim().toLowerCase();
    const requestedPath = request.nextUrl.searchParams.get('path') || '/';

    if (action === 'public') {
      if (!requestedPath) {
        return jsonError('File path is required for public view.', 400);
      }

      const ext = path.extname(requestedPath).toLowerCase();
      const officeExt = new Set(['.doc', '.docx', '.ppt', '.pptx']);
      const excelExt = new Set(['.xls', '.xlsx']);
      const viewPath = `/api/admin/terramaster?action=view&path=${encodeURIComponent(requestedPath)}`;
      const downloadPath = `/api/admin/terramaster?action=download&path=${encodeURIComponent(requestedPath)}`;
      const filename = path.basename(requestedPath);
      const publicOrigin = getPublicOrigin(request);
      const canUseExternalViewer = !!publicOrigin;

      if (excelExt.has(ext)) {
        const html = buildNoPreviewHtml({
          filename,
          downloadUrl: downloadPath,
          viewUrl: viewPath,
          message: 'This Excel file cannot be previewed in the browser.',
        });

        return new NextResponse(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }

      if (officeExt.has(ext)) {
        if (!canUseExternalViewer) {
          const html = buildNoPreviewHtml({
            filename,
            downloadUrl: downloadPath,
            viewUrl: viewPath,
            message: 'Office preview needs a public HTTPS URL. Localhost/private network links cannot be opened by external viewers.',
          });

          return new NextResponse(html, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          });
        }
        const absoluteViewUrl = `${publicOrigin}${viewPath}`;
        const googleViewerUrl = `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(absoluteViewUrl)}`;
        return NextResponse.redirect(googleViewerUrl, 302);
      }

      return new NextResponse(null, {
        status: 302,
        headers: {
          Location: viewPath,
        },
      });
    }

    if (action === 'download' || action === 'view') {
      if (!requestedPath) {
        return jsonError('File path is required for download.', 400);
      }

      const { filename, buffer } = await fetchFileBufferFromTerraMaster(requestedPath);
      const isView = action === 'view';
      const contentType = getContentTypeFromFilename(filename);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `${isView ? 'inline' : 'attachment'}; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (action === 'list') {
      const listed = await listTerraMasterDirectory(requestedPath);
      return NextResponse.json({ success: true, ...listed });
    }

    if (action === 'diagnose') {
      const refresh = ['1', 'true', 'yes'].includes((request.nextUrl.searchParams.get('refresh') || '').trim().toLowerCase());
      const diagnosis = await diagnoseTerraMasterConnection(refresh);
      return NextResponse.json(diagnosis, { status: diagnosis.success ? 200 : 502 });
    }

    if (action === 'upload_job_status') {
      const jobId = (request.nextUrl.searchParams.get('jobId') || '').trim();
      if (!jobId) return jsonError('jobId is required.', 400);

      const job = await loadDriveJob(jobId);
      if (!job) return jsonError('Upload job not found.', 404);

      return NextResponse.json({
        success: true,
        jobId: job.id,
        mode: job.mode,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        progress: job.progress,
        cancelRequested: job.cancelRequested,
        errorMessage: job.errorMessage,
      });
    }

    return jsonError('Unsupported action for GET request.', 400);
  } catch (error: any) {
    const normalized = logTerraMasterApiError(actionName, error);
    return jsonError(normalized.message, normalized.status);
  }
}

export async function POST(request: NextRequest) {
  const actionName = '[API /admin/terramaster POST]';

  try {
    const formData = await request.formData();
    const action = String(formData.get('action') || '').trim().toLowerCase();

    if (action === 'create_folder') {
      const requestedDirectory = String(formData.get('path') || '/').trim() || '/';
      const folderName = String(formData.get('folderName') || '').trim();

      if (!folderName) {
        return jsonError('Folder name is required.', 400);
      }

      const created = await createTerraMasterFolder(requestedDirectory, folderName);
      return NextResponse.json({
        success: true,
        message: 'Folder created successfully.',
        ...created,
      });
    }

    if (action === 'rename_entry') {
      const relativePath = String(formData.get('path') || '').trim();
      const newName = String(formData.get('newName') || '').trim();

      if (!relativePath) {
        return jsonError('Entry path is required.', 400);
      }
      if (!newName) {
        return jsonError('New name is required.', 400);
      }

      const renamed = await renameTerraMasterEntry(relativePath, newName);
      return NextResponse.json({
        success: true,
        message: 'Renamed successfully.',
        ...renamed,
      });
    }

    if (action === 'upload') {
      const file = formData.get('file') as File | null;
      const requestedDirectory = String(formData.get('path') || '/').trim() || '/';

      if (!file) {
        return jsonError('File is required for upload.', 400);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const uploaded = await uploadToTerraMaster(buffer, file.name, requestedDirectory);

      return NextResponse.json({
        success: true,
        message: 'File uploaded to TerraMaster successfully.',
        ...uploaded,
        size: buffer.byteLength,
      });
    }

    if (action === 'upload_folder') {
      const requestedDirectory = String(formData.get('path') || '/').trim() || '/';
      const files = formData.getAll('files') as File[];
      const relativePaths = formData.getAll('relativePaths').map((p) => String(p || ''));

      if (!files.length) {
        return jsonError('Folder files are required for upload.', 400);
      }

      const uploaded: { filename: string; filePath: string; size: number }[] = [];

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const rel = String(relativePaths[i] || file.name)
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        const normalizedRel = path.posix.normalize(rel);
        const subDir = path.posix.dirname(normalizedRel);
        const effectiveDirectory = subDir === '.' ? requestedDirectory : path.posix.join(requestedDirectory, subDir);

        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await uploadToTerraMaster(buffer, file.name, effectiveDirectory);
        uploaded.push({ filename: file.name, filePath: result.filePath, size: buffer.byteLength });
      }

      return NextResponse.json({
        success: true,
        message: 'Folder uploaded to TerraMaster successfully.',
        uploaded,
        uploadedCount: uploaded.length,
      });
    }

    if (action === 'upload_from_link') {
      const url = String(formData.get('url') || '').trim();
      const requestedDirectory = String(formData.get('path') || '/').trim() || '/';
      const providedFilename = String(formData.get('filename') || '').trim();

      if (!url) {
        return jsonError('File URL is required.', 400);
      }

      // If it's a Google Drive FOLDER link, stream progress back as SSE
      if (isGoogleDriveFolderUrl(url)) {
        const stream = new ReadableStream({
          async start(controller) {
            const encode = (data: object) => {
              const chunk = `data: ${JSON.stringify(data)}\n\n`;
              controller.enqueue(new TextEncoder().encode(chunk));
            };

            try {
              const result = await uploadGoogleDriveFolderToTerraMaster(
                url,
                requestedDirectory,
                (progress) => {
                  encode({ type: 'progress', ...progress });
                }
              );
              encode({ type: 'done', ...result });
            } catch (err: any) {
              encode({ type: 'error', message: err?.message || 'Folder upload failed.' });
            } finally {
              controller.close();
            }
          },
        });

        return new NextResponse(stream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      }

      const uploaded = await uploadFromRemoteUrlToTerraMaster({
        url,
        requestedDirectory,
        providedFilename,
      });

      return NextResponse.json({
        success: true,
        message: 'Remote file fetched and uploaded to TerraMaster successfully.',
        ...uploaded,
      });
    }

    if (action === 'upload_from_link_start') {
      const url = String(formData.get('url') || '').trim();
      const requestedDirectory = String(formData.get('path') || '/').trim() || '/';

      if (!url) {
        return jsonError('File URL is required.', 400);
      }

      if (!isGoogleDriveFolderUrl(url)) {
        return jsonError('Background upload is currently supported for Google Drive folder links only.', 400);
      }

      const job = createDriveUploadJob(url, requestedDirectory, 'upload');
      void runDriveUploadJob(job);

      return NextResponse.json({
        success: true,
        message: 'Drive folder upload started in background.',
        jobId: job.id,
      });
    }

    if (action === 'sync_from_link_start') {
      const url = String(formData.get('url') || '').trim();
      const requestedDirectory = String(formData.get('path') || '/').trim() || '/';

      if (!url) {
        return jsonError('Folder URL is required.', 400);
      }

      if (!isGoogleDriveFolderUrl(url)) {
        return jsonError('Sync is supported for Google Drive folder links only.', 400);
      }

      const job = createDriveUploadJob(url, requestedDirectory, 'sync');
      void runDriveUploadJob(job);

      return NextResponse.json({
        success: true,
        message: 'Drive folder sync started in background.',
        jobId: job.id,
      });
    }

    if (action === 'upload_job_cancel') {
      const jobId = String(formData.get('jobId') || '').trim();
      if (!jobId) return jsonError('jobId is required.', 400);

      const job = await loadDriveJob(jobId);
      if (!job) return jsonError('Upload job not found.', 404);

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') {
        return NextResponse.json({
          success: true,
          message: `Job already ${job.status}.`,
          jobId: job.id,
          status: job.status,
        });
      }

      job.cancelRequested = true;
      await persistDriveJob(job);

      return NextResponse.json({
        success: true,
        message: 'Cancel requested. Upload will stop shortly.',
        jobId: job.id,
        status: job.status,
      });
    }

    return jsonError('Unsupported action for POST request.', 400);
  } catch (error: any) {
    const normalized = logTerraMasterApiError(actionName, error);
    return jsonError(normalized.message, normalized.status);
  }
}

export async function DELETE(request: NextRequest) {
  const actionName = '[API /admin/terramaster DELETE]';
  try {
    const requestedPath = request.nextUrl.searchParams.get('path') || '';
    if (!requestedPath) return jsonError('File path is required for delete.', 400);
    await deleteFileFromTerraMaster(requestedPath);
    return NextResponse.json({ success: true, message: 'File deleted successfully.' });
  } catch (error: any) {
    const normalized = logTerraMasterApiError(actionName, error);
    return jsonError(normalized.message, normalized.status);
  }
}
