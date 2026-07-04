import path from 'path';
import https from 'https';
import { AuthType, createClient, type WebDAVClient } from 'webdav';
import { google } from 'googleapis';

export interface TerraMasterEntry {
	filename: string;
	basename: string;
	type: 'file' | 'directory';
	size?: number;
	lastmod?: string;
	etag?: string;
	mime?: string;
	relativePath: string;
}

interface TerraMasterConfig {
	url: string;
	username: string;
	password: string;
	basePath: string;
	allowSelfSigned: boolean;
	authType: AuthType;
	candidateUrls: string[];
}

interface TerraMasterConnectionAttempt {
	url: string;
	authType: AuthType;
	ok: boolean;
	error?: string;
}

interface ResolvedTerraMasterConnection {
	client: WebDAVClient;
	config: TerraMasterConfig;
	attempts: TerraMasterConnectionAttempt[];
	cacheHit: boolean;
}

interface WebDavListItem {
	filename: string;
	basename: string;
	lastmod?: string;
	size?: number;
	type: 'file' | 'directory';
	etag?: string;
	mime?: string;
}

const TERRAMASTER_DEFAULT_TIMEOUT_MS = 12000;
const TERRAMASTER_CONNECTION_CACHE_MS = 5 * 60 * 1000;
const TERRAMASTER_PROBE_RETRIES = 2;
const TERRAMASTER_RETRY_DELAY_MS = 400;

let terramasterResolvedConnectionCache:
	| {
		cacheKey: string;
		url: string;
		authType: AuthType;
		expiresAt: number;
	  }
	| null = null;

function isPrivateOrLocalHost(hostname: string): boolean {
	const host = (hostname || '').toLowerCase();
	if (!host) return true;
	if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return true;
	if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
	return false;
}

function assertReachableInProduction(rawUrl: string): void {
	if (process.env.NODE_ENV !== 'production') return;
	try {
		const parsed = new URL(rawUrl);
		if (isPrivateOrLocalHost(parsed.hostname)) {
			throw new Error(
				`TerraMaster WebDAV host \"${parsed.hostname}\" is private/local and not reachable from production. Use a public hostname or stable tunnel URL.`
			);
		}
	} catch {
		// Ignore URL parse errors here; existing callers will fail with their own config validation.
	}
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
	const timeoutMs = Number(process.env.TERRAMASTER_WEBDAV_TIMEOUT_MS || TERRAMASTER_DEFAULT_TIMEOUT_MS);
	let timer: NodeJS.Timeout | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => {
					reject(new Error(`TerraMaster timeout during ${label} after ${timeoutMs}ms.`));
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientTerraMasterError(error: unknown): boolean {
	const raw = String((error as any)?.message || error || '').toLowerCase();
	return [
		'timeout',
		'etimedout',
		'econnreset',
		'econnrefused',
		'enotfound',
		'eai_again',
		'socket hang up',
		'503',
		'502',
		'504',
	].some((token) => raw.includes(token));
}

function formatAuthType(authType: AuthType): string {
	switch (authType) {
		case AuthType.Auto:
			return 'auto';
		case AuthType.Digest:
			return 'digest';
		case AuthType.None:
			return 'none';
		case AuthType.Password:
			return 'password';
		case AuthType.Token:
			return 'token';
		default:
			return String(authType || 'unknown');
	}
}

function getResponseHeader(error: any, headerName: string): string {
	const headers = error?.response?.headers;
	if (!headers) return '';
	if (typeof headers.get === 'function') {
		return String(headers.get(headerName) || '').trim();
	}
	const direct = headers?.[headerName] || headers?.[headerName.toLowerCase()] || headers?._headers?.[headerName.toLowerCase()];
	if (Array.isArray(direct)) return String(direct[0] || '').trim();
	return String(direct || '').trim();
}

function inferTerraMasterErrorMessage(error: unknown): string | null {
	const err = error as any;
	const status = Number(err?.status || err?.response?.status || 0);
	const server = getResponseHeader(err, 'server').toLowerCase();
	const cfRay = getResponseHeader(err, 'cf-ray');
	const responseUrl = String(err?.response?.url || '').trim();
	const raw = String(err?.message || err || '').trim();

	if (status === 530 && server.includes('cloudflare')) {
		const raySuffix = cfRay ? ` CF-Ray: ${cfRay}.` : '';
		return `Cloudflare 1033/530: TerraMaster tunnel origin is unreachable for ${responseUrl || 'the configured URL'}. This is not a username/password issue.${raySuffix}`;
	}

	if (status === 401 || status === 403) {
		return `TerraMaster rejected authentication for ${responseUrl || 'the configured URL'} (${status}). Verify the WebDAV account and permissions.`;
	}

	if (raw.toLowerCase().includes('invalid response: 530')) {
		return 'Cloudflare returned HTTP 530 before WebDAV authentication completed. This usually means the tunnel/public hostname is broken or protected by Cloudflare instead of reaching the NAS WebDAV service directly.';
	}

	return null;
}

function isCloudflareOriginUnavailableError(error: unknown): boolean {
	const err = error as any;
	const status = Number(err?.status || err?.response?.status || 0);
	const server = getResponseHeader(err, 'server').toLowerCase();
	const raw = String(err?.message || err || '').toLowerCase();
	return status === 530 && (server.includes('cloudflare') || raw.includes('1033') || raw.includes('cloudflare'));
}

function normalizeProbeError(error: unknown): string {
	const inferred = inferTerraMasterErrorMessage(error);
	if (inferred) return inferred;
	const raw = String((error as any)?.message || error || 'Unknown TerraMaster error.').trim();
	return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
}

async function withRetries<T>(operation: () => Promise<T>, label: string): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= TERRAMASTER_PROBE_RETRIES; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (attempt >= TERRAMASTER_PROBE_RETRIES || !isTransientTerraMasterError(error)) {
				throw error;
			}
			await delay(TERRAMASTER_RETRY_DELAY_MS * (attempt + 1));
		}
	}
	throw lastError instanceof Error ? lastError : new Error(`TerraMaster request failed during ${label}.`);
}

function normalizeAbsolutePosix(input: string): string {
	const raw = (input || '/').trim();
	const absolute = raw.startsWith('/') ? raw : `/${raw}`;
	return path.posix.normalize(absolute);
}

function normalizeWebDavUrl(input: string): string {
	const raw = (input || '').trim();
	if (!raw) return '';
	const parsed = new URL(raw);
	parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
	parsed.hash = '';
	const serialized = parsed.toString();
	return parsed.pathname === '/' ? serialized.replace(/\/$/, '') : serialized;
}

function buildCandidateUrls(rawUrl: string): string[] {
	const primary = normalizeWebDavUrl(rawUrl);
	if (!primary) return [];

	let parsed: URL;
	try {
		parsed = new URL(primary);
	} catch {
		return [primary];
	}

	const origin = parsed.origin;
	const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
	const lastSegment = pathname.split('/').filter(Boolean).at(-1)?.toLowerCase() || '';
	const candidates = new Set<string>([primary]);

	if (pathname !== '/') {
		candidates.add(origin);
	}

	if (!['webdav', 'dav'].includes(lastSegment)) {
		candidates.add(`${origin}/webdav`);
		candidates.add(`${origin}/dav`);
	}

	return Array.from(candidates).filter(Boolean);
}

function parseAuthType(value: string): AuthType {
	switch ((value || '').trim().toLowerCase()) {
		case 'none':
			return AuthType.None;
		case 'password':
		case 'basic':
			return AuthType.Password;
		case 'digest':
			return AuthType.Digest;
		case 'auto':
		case '':
		default:
			return AuthType.Auto;
	}
}

function getAuthTypeCandidates(preferred: AuthType): AuthType[] {
	if (preferred === AuthType.None) return [AuthType.None];
	if (preferred === AuthType.Digest) return [AuthType.Digest, AuthType.Auto, AuthType.Password];
	if (preferred === AuthType.Password) return [AuthType.Password, AuthType.Auto, AuthType.Digest];
	return [AuthType.Auto, AuthType.Digest, AuthType.Password];
}

function createCacheKey(config: TerraMasterConfig): string {
	return JSON.stringify({
		url: config.url,
		basePath: config.basePath,
		allowSelfSigned: config.allowSelfSigned,
		authType: config.authType,
		username: config.username,
		passwordLength: config.password.length,
		candidateUrls: config.candidateUrls,
	});
}

function assertNoTraversal(input: string): void {
	const segments = input.split('/');
	if (segments.includes('..')) {
		throw new Error('Path traversal is not allowed.');
	}
}

function getConfig(): TerraMasterConfig {
	const url = (process.env.TERRAMASTER_WEBDAV_URL || '').trim();
	const rawUsername = (process.env.TERRAMASTER_WEBDAV_USERNAME || '').trim();
	const rawPassword = (process.env.TERRAMASTER_WEBDAV_PASSWORD || '').trim();
	const username = rawUsername === '__EMPTY__' ? '' : rawUsername;
	const password = rawPassword === '__EMPTY__' ? '' : rawPassword;
	const basePath = normalizeAbsolutePosix(process.env.TERRAMASTER_WEBDAV_BASE_PATH || '/public');
	const allowSelfSigned = String(process.env.TERRAMASTER_WEBDAV_ALLOW_SELF_SIGNED || '').trim().toLowerCase() === 'true';
	const authType = parseAuthType(process.env.TERRAMASTER_WEBDAV_AUTH_TYPE || 'auto');
	const candidateUrls = buildCandidateUrls(url);

	if (!url) {
		throw new Error('TerraMaster is not configured. Set TERRAMASTER_WEBDAV_URL.');
	}

	if (process.env.NODE_ENV === 'production' && (!username || !password)) {
		throw new Error('TerraMaster credentials missing in production. Set TERRAMASTER_WEBDAV_USERNAME and TERRAMASTER_WEBDAV_PASSWORD.');
	}

	assertReachableInProduction(url);

	return {
		url: normalizeWebDavUrl(url),
		username,
		password,
		basePath,
		allowSelfSigned,
		authType,
		candidateUrls,
	};
}

function createAttemptClient(config: TerraMasterConfig, url: string, authType: AuthType): WebDAVClient {
	const isHttps = url.toLowerCase().startsWith('https://');
	return createClient(url, {
		authType,
		...(config.username || config.password ? { username: config.username, password: config.password } : {}),
		...(isHttps && config.allowSelfSigned
			? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
			: {}),
	});
}

async function probeTerraMasterConnection(client: WebDAVClient, config: TerraMasterConfig, url: string, authType: AuthType): Promise<void> {
	await withRetries(
		() => withTimeout(client.exists(config.basePath), `connection probe (${url}, ${formatAuthType(authType)})`),
		`connection probe (${url}, ${formatAuthType(authType)})`
	);
}

async function resolveTerraMasterConnection(forceRefresh = false): Promise<ResolvedTerraMasterConnection> {
	const baseConfig = getConfig();
	const cacheKey = createCacheKey(baseConfig);
	const now = Date.now();

	if (!forceRefresh && terramasterResolvedConnectionCache && terramasterResolvedConnectionCache.cacheKey === cacheKey && terramasterResolvedConnectionCache.expiresAt > now) {
		const resolvedConfig = {
			...baseConfig,
			url: terramasterResolvedConnectionCache.url,
			authType: terramasterResolvedConnectionCache.authType,
		};
		return {
			client: createAttemptClient(resolvedConfig, resolvedConfig.url, resolvedConfig.authType),
			config: resolvedConfig,
			attempts: [],
			cacheHit: true,
		};
	}

	const attempts: TerraMasterConnectionAttempt[] = [];
	let lastError: unknown = null;

	for (const candidateUrl of baseConfig.candidateUrls) {
		for (const candidateAuthType of getAuthTypeCandidates(baseConfig.authType)) {
			const candidateConfig = { ...baseConfig, url: candidateUrl, authType: candidateAuthType };
			const client = createAttemptClient(candidateConfig, candidateUrl, candidateAuthType);
			try {
				await probeTerraMasterConnection(client, candidateConfig, candidateUrl, candidateAuthType);
				attempts.push({ url: candidateUrl, authType: candidateAuthType, ok: true });
				terramasterResolvedConnectionCache = {
					cacheKey,
					url: candidateUrl,
					authType: candidateAuthType,
					expiresAt: now + TERRAMASTER_CONNECTION_CACHE_MS,
				};
				return { client, config: candidateConfig, attempts, cacheHit: false };
			} catch (error) {
				lastError = error;
				attempts.push({
					url: candidateUrl,
					authType: candidateAuthType,
					ok: false,
					error: normalizeProbeError(error),
				});
				if (isCloudflareOriginUnavailableError(error)) {
					const finalMessage = inferTerraMasterErrorMessage(error) || 'Unable to connect to TerraMaster WebDAV.';
					const failure = error instanceof Error ? error : new Error(finalMessage);
					if (failure.message !== finalMessage) {
						failure.message = finalMessage;
					}
					(failure as any).attempts = attempts;
					throw failure;
				}
			}
		}
	}

	const finalMessage = inferTerraMasterErrorMessage(lastError) || 'Unable to connect to TerraMaster WebDAV.';
	const failure = lastError instanceof Error ? lastError : new Error(finalMessage);
	if (failure.message !== finalMessage) {
		failure.message = finalMessage;
	}
	(failure as any).attempts = attempts;
	throw failure;
}

async function createWebDavClient(): Promise<{ client: WebDAVClient; config: TerraMasterConfig }> {
	const resolved = await resolveTerraMasterConnection();
	return { client: resolved.client, config: resolved.config };
}

export async function diagnoseTerraMasterConnection(forceRefresh = false) {
	const config = getConfig();
	try {
		const resolved = await resolveTerraMasterConnection(forceRefresh);
		return {
			success: true,
			cacheHit: resolved.cacheHit,
			configuredUrl: config.url,
			resolvedUrl: resolved.config.url,
			basePath: config.basePath,
			allowSelfSigned: config.allowSelfSigned,
			authPreference: formatAuthType(config.authType),
			resolvedAuthType: formatAuthType(resolved.config.authType),
			credentialsPresent: {
				username: Boolean(config.username),
				password: Boolean(config.password),
			},
			candidateUrls: config.candidateUrls,
			attempts: resolved.attempts.map((attempt) => ({
				url: attempt.url,
				authType: formatAuthType(attempt.authType),
				ok: attempt.ok,
				error: attempt.error,
			})),
		};
	} catch (error) {
		const attempts = Array.isArray((error as any)?.attempts) ? ((error as any).attempts as TerraMasterConnectionAttempt[]) : [];
		return {
			success: false,
			cacheHit: false,
			configuredUrl: config.url,
			basePath: config.basePath,
			allowSelfSigned: config.allowSelfSigned,
			authPreference: formatAuthType(config.authType),
			credentialsPresent: {
				username: Boolean(config.username),
				password: Boolean(config.password),
			},
			candidateUrls: config.candidateUrls,
			error: normalizeProbeError(error),
			attempts: attempts.map((attempt) => ({
				url: attempt.url,
				authType: formatAuthType(attempt.authType),
				ok: attempt.ok,
				error: attempt.error,
			})),
		};
	}
}

function resolvePathWithinBase(basePath: string, requestedPath: string): string {
	const normalizedRequested = normalizeAbsolutePosix(requestedPath || '/');
	assertNoTraversal(normalizedRequested);

	const fullPath = path.posix.normalize(path.posix.join(basePath, normalizedRequested));
	const basePrefix = basePath.endsWith('/') ? basePath : `${basePath}/`;
	if (fullPath !== basePath && !fullPath.startsWith(basePrefix)) {
		throw new Error('Requested path is outside configured base path.');
	}

	return fullPath;
}

function toRelativePath(basePath: string, fullPath: string): string {
	if (fullPath === basePath) return '/';
	const withoutBase = fullPath.slice(basePath.length);
	return withoutBase.startsWith('/') ? withoutBase : `/${withoutBase}`;
}

function sanitizeFilename(input: string): string {
	const trimmed = input.trim();
	const base = path.posix.basename(trimmed);
	const cleaned = base.replace(/[<>:"\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
	if (!cleaned || cleaned === '.' || cleaned === '..') {
		throw new Error('Invalid filename.');
	}
	return cleaned;
}

export function extractGoogleDriveFileId(url: string): string | null {
	if (!url) return null;
	const trimmed = url.trim();

	const byPath = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/i);
	if (byPath?.[1]) return byPath[1];

	try {
		const parsed = new URL(trimmed);
		const id = parsed.searchParams.get('id');
		if (id) return id;
	} catch {
		return null;
	}

	return null;
}

export function toDownloadableUrl(rawUrl: string): string {
	const driveId = extractGoogleDriveFileId(rawUrl);
	if (driveId) {
		return `https://drive.google.com/uc?export=download&id=${driveId}`;
	}
	return rawUrl;
}

export function filenameFromContentDisposition(contentDisposition: string | null): string | null {
	if (!contentDisposition) return null;

	const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
	if (utf8Match?.[1]) {
		try {
			return decodeURIComponent(utf8Match[1].trim());
		} catch {
			return utf8Match[1].trim();
		}
	}

	const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
	return basicMatch?.[1]?.trim() || null;
}

export async function listTerraMasterDirectory(requestedPath = '/'): Promise<{
	currentPath: string;
	parentPath: string | null;
	basePath: string;
	entries: TerraMasterEntry[];
}> {
	const { client, config } = await createWebDavClient();
	const fullPath = resolvePathWithinBase(config.basePath, requestedPath);

	const exists = await withTimeout(client.exists(fullPath), 'directory existence check');
	if (!exists) {
		throw new Error(`Directory does not exist: ${requestedPath}`);
	}

	const directoryContents = (await withTimeout(client.getDirectoryContents(fullPath, {
		deep: false,
	}), 'directory listing')) as WebDavListItem[];

	const entries = directoryContents
		.filter((entry) => entry.filename !== fullPath)
		.map((entry) => ({
			filename: entry.filename,
			basename: entry.basename,
			type: entry.type,
			size: entry.size,
			lastmod: entry.lastmod,
			etag: entry.etag,
			mime: entry.mime,
			relativePath: toRelativePath(config.basePath, entry.filename),
		}))
		.sort((a, b) => {
			if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
			return a.basename.localeCompare(b.basename);
		});

	const currentPath = toRelativePath(config.basePath, fullPath);
	const parentPath = currentPath === '/' ? null : path.posix.dirname(currentPath);

	return {
		currentPath,
		parentPath: parentPath === '.' ? '/' : parentPath,
		basePath: config.basePath,
		entries,
	};
}

export async function uploadToTerraMaster(buffer: Buffer, originalFilename: string, requestedDirectory = '/') {
	const { client, config } = await createWebDavClient();

	const targetDirectory = resolvePathWithinBase(config.basePath, requestedDirectory);
	const filename = sanitizeFilename(originalFilename);
	const targetFilePath = path.posix.join(targetDirectory, filename);

	const directoryExists = await client.exists(targetDirectory);
	if (!directoryExists) {
		await client.createDirectory(targetDirectory, { recursive: true });
	}

	await client.putFileContents(targetFilePath, buffer, { overwrite: true });

	return {
		filePath: toRelativePath(config.basePath, targetFilePath),
		filename,
	};
}

export async function createTerraMasterFolder(parentDirectory = '/', folderName: string) {
	const { client, config } = await createWebDavClient();

	const targetParent = resolvePathWithinBase(config.basePath, parentDirectory);
	const safeFolderName = sanitizeFilename(folderName);
	const targetFolderPath = path.posix.join(targetParent, safeFolderName);

	const exists = await client.exists(targetFolderPath);
	if (exists) {
		throw new Error(`Folder already exists: ${safeFolderName}`);
	}

	await client.createDirectory(targetFolderPath, { recursive: true });

	return {
		folderPath: toRelativePath(config.basePath, targetFolderPath),
		folderName: safeFolderName,
	};
}

export async function renameTerraMasterEntry(relativePath: string, newName: string) {
	const { client, config } = await createWebDavClient();

	const sourcePath = resolvePathWithinBase(config.basePath, relativePath);
	const safeName = sanitizeFilename(newName);
	const parent = path.posix.dirname(sourcePath);
	const targetPath = path.posix.join(parent, safeName);

	if (sourcePath === targetPath) {
		return {
			oldPath: toRelativePath(config.basePath, sourcePath),
			newPath: toRelativePath(config.basePath, targetPath),
			newName: safeName,
		};
	}

	const targetExists = await client.exists(targetPath);
	if (targetExists) {
		throw new Error(`Target already exists: ${safeName}`);
	}

	await client.moveFile(sourcePath, targetPath);

	return {
		oldPath: toRelativePath(config.basePath, sourcePath),
		newPath: toRelativePath(config.basePath, targetPath),
		newName: safeName,
	};
}

export async function fetchFileBufferFromTerraMaster(requestedFilePath: string): Promise<{ filename: string; buffer: Buffer }> {
	const { client, config } = await createWebDavClient();
	const fullPath = resolvePathWithinBase(config.basePath, requestedFilePath);
	const filename = sanitizeFilename(path.posix.basename(fullPath));

	const fileBuffer = (await client.getFileContents(fullPath, { format: 'binary' })) as Buffer;

	return {
		filename,
		buffer: Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer),
	};
}

export async function uploadFromRemoteUrlToTerraMaster(args: {
	url: string;
	requestedDirectory?: string;
	providedFilename?: string;
}) {
	const { url, requestedDirectory = '/', providedFilename } = args;
	const downloadableUrl = toDownloadableUrl(url);

	const response = await fetch(downloadableUrl, {
		method: 'GET',
		redirect: 'follow',
		cache: 'no-store',
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch remote file (${response.status}).`);
	}

	const contentDisposition = response.headers.get('content-disposition');
	const parsedFilename = filenameFromContentDisposition(contentDisposition);

	let filename = (providedFilename || '').trim() || (parsedFilename || '').trim();
	if (!filename) {
		try {
			const parsed = new URL(downloadableUrl);
			filename = path.posix.basename(parsed.pathname || '') || `download-${Date.now()}`;
		} catch {
			filename = `download-${Date.now()}`;
		}
	}

	const arrayBuffer = await response.arrayBuffer();
	const fileBuffer = Buffer.from(arrayBuffer);

	const uploaded = await uploadToTerraMaster(fileBuffer, filename, requestedDirectory);

	return {
		...uploaded,
		size: fileBuffer.byteLength,
	};
}

// ─── Google Drive folder helpers ─────────────────────────────────────────────

export function extractGoogleDriveFolderId(url: string): string | null {
	if (!url) return null;
	const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/i);
	return match?.[1] || null;
}

export function isGoogleDriveFolderUrl(url: string): boolean {
	return !!extractGoogleDriveFolderId(url);
}

export interface FolderUploadProgress {
	total: number;
	done: number;
	current: string;
	uploaded: { filename: string; filePath: string; size: number }[];
	skipped: { filename: string; reason: string }[];
	errors: { filename: string; error: string }[];
	canceled?: boolean;
}

interface FolderUploadOptions {
	shouldCancel?: () => boolean;
}

const DEFAULT_DRIVE_FOLDER_UPLOAD_CONCURRENCY = 3;

function getDriveFolderUploadConcurrency(): number {
	const raw = Number(process.env.TERRAMASTER_DRIVE_UPLOAD_CONCURRENCY || DEFAULT_DRIVE_FOLDER_UPLOAD_CONCURRENCY);
	if (!Number.isFinite(raw)) return DEFAULT_DRIVE_FOLDER_UPLOAD_CONCURRENCY;
	return Math.max(1, Math.min(6, Math.floor(raw)));
}

type DriveListItem = {
	id?: string | null;
	name?: string | null;
	mimeType?: string | null;
	size?: string | null;
	md5Checksum?: string | null;
	modifiedTime?: string | null;
};

interface DriveSyncManifestEntry {
	id: string;
	filename: string;
	relativePath: string;
	signature: string;
}

function makeDriveFileSignature(file: DriveListItem): string {
	const md5 = String(file.md5Checksum || '').trim();
	if (md5) return `md5:${md5}`;
	return `meta:${String(file.size || '')}:${String(file.modifiedTime || '')}`;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientGoogleReason(reason: string): boolean {
	return [
		'ratelimitexceeded',
		'userratelimitexceeded',
		'backenderror',
		'internalerror',
		'serviceunavailable',
		'dailyLimitExceeded'.toLowerCase(),
	].includes(reason.toLowerCase());
}

function extractGoogleErrorInfo(payload: any): { reason: string; message: string } {
	const reason = String(payload?.error?.errors?.[0]?.reason || payload?.error?.status || '').trim();
	const message = String(payload?.error?.message || payload?.message || '').trim();
	return { reason, message };
}

async function downloadDriveFileWithRetry(args: {
	fileId: string;
	apiKey?: string;
	accessToken?: string;
	maxAttempts?: number;
}): Promise<Buffer> {
	const { fileId, apiKey, accessToken, maxAttempts = 4 } = args;
	let lastError = 'Unknown Google Drive error';

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const useServiceAccount = !!accessToken;
		const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media${useServiceAccount ? '' : `&key=${apiKey}`}`;
		const response = await fetch(downloadUrl, {
			redirect: 'follow',
			headers: useServiceAccount && accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
		});

		if (response.ok) {
			const arrayBuffer = await response.arrayBuffer();
			return Buffer.from(arrayBuffer);
		}

		let payload: any = null;
		try {
			payload = await response.clone().json();
		} catch {
			try {
				const raw = await response.text();
				payload = raw ? JSON.parse(raw) : null;
			} catch {
				payload = null;
			}
		}

		const { reason, message } = extractGoogleErrorInfo(payload);
		const normalizedReason = reason || `http_${response.status}`;
		lastError = `Google Drive ${response.status}${reason ? ` (${reason})` : ''}${message ? `: ${message}` : ''}`;

		const transientByStatus = response.status === 429 || response.status === 500 || response.status === 503;
		const transientByReason = isTransientGoogleReason(normalizedReason);
		const canRetry = attempt < maxAttempts && (transientByStatus || transientByReason);

		if (!canRetry) break;

		const waitMs = Math.min(1000 * (2 ** (attempt - 1)), 8000);
		await sleep(waitMs);
	}

	throw new Error(lastError);
}

function getServiceAccountAuth() {
	const email = (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || '').trim();
	const rawPrivateKey = (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || '').trim();
	if (!email || !rawPrivateKey) return null;

	const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
	return new google.auth.JWT({
		email,
		key: privateKey,
		scopes: ['https://www.googleapis.com/auth/drive.readonly'],
	});
}

async function listDriveFolderFilesWithApiKey(folderId: string, apiKey: string): Promise<DriveListItem[]> {
	const files: DriveListItem[] = [];
	let pageToken: string | undefined;

	while (true) {
		const params = new URLSearchParams({
			q: `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
			fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime)',
			pageSize: '1000',
			includeItemsFromAllDrives: 'true',
			supportsAllDrives: 'true',
			key: apiKey,
		});
		if (pageToken) params.set('pageToken', pageToken);

		const listResponse = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
			method: 'GET',
			cache: 'no-store',
		});

		const listBody = await listResponse.json().catch(() => ({} as any));
		if (!listResponse.ok) {
			const gErr = listBody?.error;
			const gMsg = gErr?.message || `Google Drive list failed (${listResponse.status}).`;
			const reason = gErr?.errors?.[0]?.reason || '';
			throw new Error(`API_KEY_LIST_FAILED::${reason}::${gMsg}`);
		}

		const pageFiles = Array.isArray(listBody?.files) ? (listBody.files as DriveListItem[]) : [];
		files.push(...pageFiles);
		pageToken = listBody?.nextPageToken || undefined;
		if (!pageToken) break;
	}

	return files;
}

async function listDriveFolderFilesWithServiceAccount(folderId: string): Promise<DriveListItem[]> {
	const auth = getServiceAccountAuth();
	if (!auth) {
		throw new Error('SERVICE_ACCOUNT_NOT_CONFIGURED');
	}

	const drive = google.drive({ version: 'v3', auth });
	const files: DriveListItem[] = [];
	let pageToken: string | undefined;

	while (true) {
		const listRes = await drive.files.list({
			q: `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
			fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime)',
			pageSize: 1000,
			includeItemsFromAllDrives: true,
			supportsAllDrives: true,
			pageToken,
		});

		const pageFiles = Array.isArray(listRes.data.files) ? (listRes.data.files as DriveListItem[]) : [];
		files.push(...pageFiles);
		pageToken = listRes.data.nextPageToken || undefined;
		if (!pageToken) break;
	}

	return files;
}

async function ensureTerraMasterDirectoryExists(client: WebDAVClient, absoluteDirectory: string): Promise<void> {
	const exists = await client.exists(absoluteDirectory);
	if (!exists) {
		await client.createDirectory(absoluteDirectory, { recursive: true });
	}
}

async function listExistingTerraMasterBasenames(client: WebDAVClient, absoluteDirectory: string): Promise<Set<string>> {
	const contents = (await withTimeout(client.getDirectoryContents(absoluteDirectory, {
		deep: false,
	}), 'directory listing')) as WebDavListItem[];

	return new Set(
		contents
			.filter((entry) => entry.filename !== absoluteDirectory)
			.map((entry) => String(entry.basename || '').trim())
			.filter(Boolean)
	);
}

async function uploadBufferToTerraMasterDirectory(args: {
	client: WebDAVClient;
	config: TerraMasterConfig;
	buffer: Buffer;
	filename: string;
	absoluteDirectory: string;
}): Promise<{ filePath: string; filename: string }> {
	const { client, config, buffer, filename, absoluteDirectory } = args;
	const safeFilename = sanitizeFilename(filename);
	const targetFilePath = path.posix.join(absoluteDirectory, safeFilename);

	await withTimeout(client.putFileContents(targetFilePath, buffer, { overwrite: true }), 'file upload');

	return {
		filePath: toRelativePath(config.basePath, targetFilePath),
		filename: safeFilename,
	};
}

export async function uploadGoogleDriveFolderToTerraMaster(
	folderUrl: string,
	requestedDirectory = '/',
	onProgress?: (progress: FolderUploadProgress) => void,
	options?: FolderUploadOptions
): Promise<FolderUploadProgress> {
	const folderId = extractGoogleDriveFolderId(folderUrl);
	if (!folderId) throw new Error('Invalid Google Drive folder URL.');

	const apiKey = (process.env.GOOGLE_API_KEY || '').trim();
	if (!apiKey && !getServiceAccountAuth()) {
		throw new Error('Google Drive is not configured. Set GOOGLE_API_KEY or GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL + GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY.');
	}

	let files: DriveListItem[] = [];
	let useServiceAccountForDownload = false;

	if (apiKey) {
		try {
			files = await listDriveFolderFilesWithApiKey(folderId, apiKey);
		} catch (err: any) {
			const msg = String(err?.message || err || '');
			const looksBlocked = msg.includes('API_KEY_LIST_FAILED::forbidden')
				|| msg.includes('API_KEY_LIST_FAILED::accessNotConfigured')
				|| msg.includes('API_KEY_LIST_FAILED::ipRefererBlocked')
				|| msg.includes('API_KEY_LIST_FAILED::keyInvalid')
				|| msg.toLowerCase().includes('requests to this api')
				|| msg.toLowerCase().includes('drivefiles.list are blocked');

			if (looksBlocked) {
				try {
					files = await listDriveFolderFilesWithServiceAccount(folderId);
					useServiceAccountForDownload = true;
				} catch {
					throw new Error('Google Drive API key is blocked for files.list, and service-account fallback is not available. Add GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL and GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY, and share the folder with that service account email (or keep folder public).');
				}
			} else {
				throw new Error(msg.replace(/^API_KEY_LIST_FAILED::[^:]*::/, ''));
			}
		}
	} else {
		files = await listDriveFolderFilesWithServiceAccount(folderId);
		useServiceAccountForDownload = true;
	}

	if (files.length === 0) throw new Error('No files found in the Google Drive folder (make sure it is set to "Anyone with the link").');

	const progress: FolderUploadProgress = {
		total: files.length,
		done: 0,
		current: '',
		uploaded: [],
		skipped: [],
		errors: [],
	};

	const { client, config } = await createWebDavClient();
	const resolvedTargetDirectory = resolvePathWithinBase(config.basePath, requestedDirectory);
	await ensureTerraMasterDirectoryExists(client, resolvedTargetDirectory);
	const existingFilenames = await listExistingTerraMasterBasenames(client, resolvedTargetDirectory);
	const workerCount = Math.min(getDriveFolderUploadConcurrency(), files.length);
	let nextIndex = 0;

	let serviceAccountAccessToken: string | null = null;
	const serviceAccountAuth = getServiceAccountAuth();
	if (useServiceAccountForDownload) {
		const token = await serviceAccountAuth?.getAccessToken();
		serviceAccountAccessToken = typeof token === 'string' ? token : (token?.token ?? null);
		if (!serviceAccountAccessToken) {
			throw new Error('Failed to obtain service account access token for Google Drive download.');
		}
	}

	const workers = Array.from({ length: workerCount }, async () => {
		while (true) {
			if (options?.shouldCancel?.()) {
				progress.canceled = true;
				progress.current = '';
				onProgress?.({ ...progress });
				return;
			}

			const currentIndex = nextIndex;
			nextIndex += 1;
			if (currentIndex >= files.length) return;

			const file = files[currentIndex];
			if (!file?.id || !file?.name) {
				progress.done += 1;
				onProgress?.({ ...progress });
				continue;
			}

			progress.current = String(file.name);
			onProgress?.({ ...progress });

			try {
				const safeName = sanitizeFilename(String(file.name));
				if (existingFilenames.has(safeName)) {
					progress.skipped.push({ filename: safeName, reason: 'Already exists on TerraMaster' });
				} else {
					let buffer: Buffer;
					try {
						buffer = await downloadDriveFileWithRetry({
							fileId: String(file.id),
							apiKey: useServiceAccountForDownload ? undefined : apiKey,
							accessToken: useServiceAccountForDownload ? (serviceAccountAccessToken || undefined) : undefined,
							maxAttempts: 4,
						});
					} catch (primaryErr: any) {
						const primaryMessage = String(primaryErr?.message || primaryErr || 'Google Drive download failed');

						if (!useServiceAccountForDownload && serviceAccountAuth && primaryMessage.includes('Google Drive 403')) {
							if (!serviceAccountAccessToken) {
								const token = await serviceAccountAuth.getAccessToken();
								serviceAccountAccessToken = typeof token === 'string' ? token : (token?.token ?? null);
							}

							if (serviceAccountAccessToken) {
								try {
									buffer = await downloadDriveFileWithRetry({
										fileId: String(file.id),
										accessToken: serviceAccountAccessToken,
										maxAttempts: 4,
									});
								} catch (saErr: any) {
									const saMessage = String(saErr?.message || saErr || 'Service-account download failed');
									throw new Error(`${primaryMessage}; service-account fallback failed: ${saMessage}`);
								}
							} else {
								throw new Error(`${primaryMessage}; service-account fallback token unavailable`);
							}
						} else {
							throw primaryErr;
						}
					}

					const result = await uploadBufferToTerraMasterDirectory({
						client,
						config,
						buffer,
						filename: safeName,
						absoluteDirectory: resolvedTargetDirectory,
					});
					existingFilenames.add(safeName);
					progress.uploaded.push({ filename: safeName, filePath: result.filePath, size: buffer.byteLength });
				}
			} catch (err: any) {
				progress.errors.push({ filename: String(file.name), error: err?.message || String(err) });
			}

			progress.done += 1;
			onProgress?.({ ...progress });
		}
	});

	await Promise.all(workers);
	if (progress.canceled) {
		progress.current = '';
		onProgress?.({ ...progress });
	}

	return progress;
}

export async function syncGoogleDriveFolderToTerraMaster(
	folderUrl: string,
	requestedDirectory = '/',
	onProgress?: (progress: FolderUploadProgress & { deleted: { filename: string; reason: string }[] }) => void,
	options?: FolderUploadOptions
): Promise<FolderUploadProgress & { deleted: { filename: string; reason: string }[] }> {
	const folderId = extractGoogleDriveFolderId(folderUrl);
	if (!folderId) throw new Error('Invalid Google Drive folder URL.');

	const apiKey = (process.env.GOOGLE_API_KEY || '').trim();
	if (!apiKey && !getServiceAccountAuth()) {
		throw new Error('Google Drive is not configured. Set GOOGLE_API_KEY or GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL + GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY.');
	}

	let files: DriveListItem[] = [];
	let useServiceAccountForDownload = false;

	if (apiKey) {
		try {
			files = await listDriveFolderFilesWithApiKey(folderId, apiKey);
		} catch (err: any) {
			const msg = String(err?.message || err || '');
			const looksBlocked = msg.includes('API_KEY_LIST_FAILED::forbidden')
				|| msg.includes('API_KEY_LIST_FAILED::accessNotConfigured')
				|| msg.includes('API_KEY_LIST_FAILED::ipRefererBlocked')
				|| msg.includes('API_KEY_LIST_FAILED::keyInvalid')
				|| msg.toLowerCase().includes('requests to this api')
				|| msg.toLowerCase().includes('drivefiles.list are blocked');

			if (looksBlocked) {
				files = await listDriveFolderFilesWithServiceAccount(folderId);
				useServiceAccountForDownload = true;
			} else {
				throw new Error(msg.replace(/^API_KEY_LIST_FAILED::[^:]*::/, ''));
			}
		}
	} else {
		files = await listDriveFolderFilesWithServiceAccount(folderId);
		useServiceAccountForDownload = true;
	}

	const progress: FolderUploadProgress & { deleted: { filename: string; reason: string }[] } = {
		total: files.length,
		done: 0,
		current: '',
		uploaded: [],
		skipped: [],
		errors: [],
		deleted: [],
	};

	const { client, config } = await createWebDavClient();
	const targetDirectoryAbs = resolvePathWithinBase(config.basePath, requestedDirectory);
	const manifestAbsPath = path.posix.join(targetDirectoryAbs, '.drive-sync-manifest.json');

	await ensureTerraMasterDirectoryExists(client, targetDirectoryAbs);

	let oldManifest: DriveSyncManifestEntry[] = [];
	try {
		if (await client.exists(manifestAbsPath)) {
			const raw = await client.getFileContents(manifestAbsPath, { format: 'text' }) as string;
			const parsed = JSON.parse(String(raw || '[]'));
			if (Array.isArray(parsed)) {
				oldManifest = parsed.filter((x) => x && typeof x.id === 'string' && typeof x.relativePath === 'string');
			}
		}
	} catch {
		oldManifest = [];
	}

	const oldById = new Map(oldManifest.map((m) => [m.id, m]));
	const newManifest: DriveSyncManifestEntry[] = [];

	let serviceAccountAccessToken: string | null = null;
	const serviceAccountAuth = getServiceAccountAuth();
	if (useServiceAccountForDownload) {
		const token = await serviceAccountAuth?.getAccessToken();
		serviceAccountAccessToken = typeof token === 'string' ? token : (token?.token ?? null);
	}

	for (const file of files) {
		if (options?.shouldCancel?.()) {
			progress.current = '';
			progress.canceled = true;
			onProgress?.({ ...progress });
			break;
		}

		if (!file.id || !file.name) continue;

		const safeName = sanitizeFilename(String(file.name));
		const fileSignature = makeDriveFileSignature(file);
		const old = oldById.get(String(file.id));
		const relativePath = `/${safeName}`;
		const targetAbsPath = path.posix.join(targetDirectoryAbs, safeName);

		progress.current = safeName;
		onProgress?.({ ...progress });

		try {
			if (old && old.signature === fileSignature && await client.exists(targetAbsPath)) {
				progress.skipped.push({ filename: safeName, reason: 'Unchanged' });
			} else {
				let buffer: Buffer;
				try {
					buffer = await downloadDriveFileWithRetry({
						fileId: String(file.id),
						apiKey: useServiceAccountForDownload ? undefined : apiKey,
						accessToken: useServiceAccountForDownload ? (serviceAccountAccessToken || undefined) : undefined,
						maxAttempts: 4,
					});
				} catch (primaryErr: any) {
					const primaryMessage = String(primaryErr?.message || primaryErr || 'Google Drive download failed');
					if (!useServiceAccountForDownload && serviceAccountAuth && primaryMessage.includes('Google Drive 403')) {
						if (!serviceAccountAccessToken) {
							const token = await serviceAccountAuth.getAccessToken();
							serviceAccountAccessToken = typeof token === 'string' ? token : (token?.token ?? null);
						}
						if (!serviceAccountAccessToken) throw new Error(`${primaryMessage}; service-account fallback token unavailable`);
						buffer = await downloadDriveFileWithRetry({
							fileId: String(file.id),
							accessToken: serviceAccountAccessToken,
							maxAttempts: 4,
						});
					} else {
						throw primaryErr;
					}
				}

				const result = await uploadBufferToTerraMasterDirectory({
					client,
					config,
					buffer,
					filename: safeName,
					absoluteDirectory: targetDirectoryAbs,
				});
				progress.uploaded.push({ filename: safeName, filePath: result.filePath, size: buffer.byteLength });
			}

			newManifest.push({
				id: String(file.id),
				filename: safeName,
				relativePath,
				signature: fileSignature,
			});
		} catch (err: any) {
			progress.errors.push({ filename: safeName, error: err?.message || String(err) });
		}

		progress.done += 1;
		onProgress?.({ ...progress });
	}

	if (!progress.canceled) {
		const newIds = new Set(newManifest.map((m) => m.id));
		for (const oldEntry of oldManifest) {
			if (newIds.has(oldEntry.id)) continue;

			const safeRelative = normalizeAbsolutePosix(oldEntry.relativePath || '/');
			assertNoTraversal(safeRelative);
			const deleteAbs = path.posix.normalize(path.posix.join(targetDirectoryAbs, safeRelative));
			if (deleteAbs !== targetDirectoryAbs && !deleteAbs.startsWith(`${targetDirectoryAbs}/`)) continue;

			try {
				if (await client.exists(deleteAbs)) {
					await client.deleteFile(deleteAbs);
					progress.deleted.push({ filename: oldEntry.filename, reason: 'Removed from Google Drive folder' });
				}
			} catch (err: any) {
				progress.errors.push({ filename: oldEntry.filename, error: err?.message || String(err) });
			}
		}

		try {
			await client.putFileContents(manifestAbsPath, JSON.stringify(newManifest, null, 2), { overwrite: true });
		} catch (err: any) {
			progress.errors.push({ filename: '.drive-sync-manifest.json', error: err?.message || String(err) });
		}
	}

	return progress;
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteFileFromTerraMaster(relativePath: string): Promise<void> {
	const { client, config } = await createWebDavClient();

	const safe = normalizeAbsolutePosix(relativePath);
	assertNoTraversal(safe);

	// Build absolute WebDAV path using resolvePathWithinBase for safety
	const absPath = resolvePathWithinBase(config.basePath, safe);

	try {
		await client.deleteFile(absPath);
	} catch (err: any) {
		throw new Error(`Delete failed: ${err?.message || err}`);
	}
}
