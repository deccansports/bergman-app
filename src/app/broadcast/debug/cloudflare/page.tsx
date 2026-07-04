'use client';

import { useEffect, useState } from 'react';

interface Camera {
  id: string;
  name: string;
  liveInputUid: string;
}

interface TimelineEntry {
  timestamp: string;
  second: number;
  connected: boolean | null;
  status: string | null;
  lastSeen: string | null;
  lastError: string | null;
  everReceivedHandshake: boolean;
}

export default function CloudflareDebugPage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [liveInputUid, setLiveInputUid] = useState('');
  const [observing, setObserving] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Load cameras on mount
  useEffect(() => {
    const loadCameras = async () => {
      try {
        const res = await fetch('/api/broadcast/cameras?eventId=4cEm8JPYbpupoFRMDLc1');
        if (res.ok) {
          const data = await res.json();
          const cameraList = (Array.isArray(data) ? data : data.cameras || []).filter(
            (c: any) => c.cloudflare?.liveInputUid,
          );
          setCameras(
            cameraList.map((c: any) => ({
              id: c.id,
              name: c.name || 'Unnamed Camera',
              liveInputUid: c.cloudflare.liveInputUid,
            })),
          );
          if (cameraList.length > 0) {
            setSelectedCameraId(cameraList[0].id);
            setLiveInputUid(cameraList[0].cloudflare.liveInputUid);
          }
        }
      } catch (err) {
        console.error('Failed to load cameras:', err);
      } finally {
        setLoading(false);
      }
    };

    loadCameras();
  }, []);

  const handleCameraChange = (cameraId: string) => {
    setSelectedCameraId(cameraId);
    const camera = cameras.find((c) => c.id === cameraId);
    if (camera) {
      setLiveInputUid(camera.liveInputUid);
    }
  };

  const handleObserve = async () => {
    const uid = liveInputUid.trim();
    if (!uid) {
      setError('Please enter or select a live input UID');
      return;
    }

    setObserving(true);
    setTimeline([]);
    setSummary(null);
    setError('');

    try {
      const params = new URLSearchParams({
        liveInputUid: uid,
        observe: 'true',
        observeSeconds: '30',
      });

      const res = await fetch(`/api/broadcast/debug/cloudflare?${params}`);
      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();
      if (data.success && data.data) {
        setTimeline(data.data.observedTimeline || []);
        setSummary(data.data.summary);
      } else {
        setError(data.error || 'Unknown error from API');
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setObserving(false);
    }
  };

  if (loading) {
    return <div className="p-4">Loading cameras...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Cloudflare Stream Debug</h1>

        {/* Camera Selection */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Select Camera</h2>
          {cameras.length > 0 ? (
            <select
              value={selectedCameraId}
              onChange={(e) => handleCameraChange(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg mb-4"
            >
              <option value="">-- Select a camera --</option>
              {cameras.map((cam) => (
                <option key={cam.id} value={cam.id}>
                  {cam.name} ({cam.liveInputUid.slice(0, 8)}...)
                </option>
              ))}
            </select>
          ) : (
            <p className="text-gray-500 mb-4">No cameras found</p>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Or paste Live Input UID:</label>
            <input
              type="text"
              value={liveInputUid}
              onChange={(e) => setLiveInputUid(e.target.value)}
              placeholder="48f9120ffd46709aeaddc330134157d3"
              className="w-full px-4 py-2 border rounded-lg font-mono text-sm"
            />
          </div>

          <button
            onClick={handleObserve}
            disabled={observing || !liveInputUid.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded-lg transition"
          >
            {observing ? 'Observing for 30 seconds...' : 'Start 30-Second Observation'}
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-800">
            {error}
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Summary</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600">Token Status</p>
                <p className="text-lg font-mono">{summary.tokenStatus || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Ever Connected</p>
                <p className="text-lg font-bold">{summary.everTransitionedConnected ? '✓ Yes' : '✗ No'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Connection Transitions</p>
                <p className="text-lg font-mono">{summary.connectedTransitions || 0} times</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Response Fields</p>
                <p className="text-lg font-mono">{summary.liveInputResponseFields?.length || 0}</p>
              </div>
            </div>

            {summary.permissionChecks && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm font-semibold mb-2">Permission Checks:</p>
                <ul className="text-sm space-y-1 font-mono">
                  <li className="flex justify-between">
                    <span>Live Inputs Read:</span>
                    <span>{summary.permissionChecks.liveInputsRead ? '✓' : '✗'}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Live Inputs Edit:</span>
                    <span>{summary.permissionChecks.liveInputsEdit ? '✓' : '✗'}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Videos Read:</span>
                    <span>{summary.permissionChecks.videosRead ? '✓' : '✗'}</span>
                  </li>
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Timeline */}
        {timeline.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">30-Second Timeline</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Second</th>
                    <th className="px-4 py-2 text-left font-semibold">Timestamp</th>
                    <th className="px-4 py-2 text-center font-semibold">Connected</th>
                    <th className="px-4 py-2 text-left font-semibold">Status</th>
                    <th className="px-4 py-2 text-left font-semibold">Last Error</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((entry, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 font-mono font-bold text-blue-600">{entry.second}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-600">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {entry.connected ? (
                          <span className="inline-block w-6 h-6 bg-green-500 rounded text-white text-xs flex items-center justify-center font-bold">
                            ✓
                          </span>
                        ) : entry.connected === false ? (
                          <span className="inline-block w-6 h-6 bg-red-500 rounded text-white text-xs flex items-center justify-center font-bold">
                            ✗
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{entry.status || '—'}</td>
                      <td className="px-4 py-2 text-xs text-red-600">{entry.lastError || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 pt-4 border-t text-sm text-gray-600">
              <p>
                <strong>Interpretation:</strong> If &quot;Connected&quot; never changes from ✗ or stays null, Cloudflare is not
                seeing the ingest attempt. If it transitions to ✓, the encoder successfully connected. Check OBS logs while
                this poll runs.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
