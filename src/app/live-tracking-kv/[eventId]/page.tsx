"use client";

import { useEffect, useState, useCallback } from "react";
import AthleteLiveModalPro from "@/components/live-tracking/AthleteLiveModalPro";
import { Loader2, Search } from "lucide-react";

// ============================================
// TYPES
// ============================================

type Athlete = {
  bookingId: string;
  bibNumber: string;
  name?: string;
  lat?: number;
  lng?: number;
  distance?: number;
  speed?: number;
  rank?: number;
  checkpoint?: string;
};

// ============================================
// PAGE
// ============================================

export default function LiveTrackingKVPage({ params }: any) {
  const { eventId } = params;

  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [filtered, setFiltered] = useState<Athlete[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Athlete | null>(null);

  // ============================================
  // 🔥 FETCH FROM KV API
  // ============================================
  const fetchData = async () => {
    try {
      const res = await fetch(`/api/live/event?eventId=${eventId}`);
      const data = await res.json();

      const sorted = data.athletes.sort(
        (a: Athlete, b: Athlete) => (a.rank || 9999) - (b.rank || 9999)
      );

      setAthletes(sorted);
      setFiltered(sorted);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const memoFetchData = useCallback(fetchData, [eventId]);

  useEffect(() => {
    memoFetchData();

    const interval = setInterval(memoFetchData, 3000); // 🔥 realtime

    return () => clearInterval(interval);
  }, [memoFetchData]);

  // ============================================
  // 🔍 SEARCH
  // ============================================
  useEffect(() => {
    const q = search.toLowerCase();

    setFiltered(
      athletes.filter(
        (a) =>
          a.name?.toLowerCase().includes(q) ||
          a.bibNumber?.toLowerCase().includes(q)
      )
    );
  }, [search, athletes]);

  // ============================================
  // 🗺️ MAP URL (ALL ATHLETES)
  // ============================================
  const mapUrl = athletes.length > 0 
    ? `https://maps.google.com/maps?q=${athletes[0]?.lat || 0},${athletes[0]?.lng || 0}&z=13&output=embed`
    : "";

  return (
    <div className="flex h-screen bg-white">

      {/* ============================================ */}
      {/* 🗺️ MAP */}
      {/* ============================================ */}
      <div className="w-[65%] h-full bg-black relative">
        {mapUrl ? (
          <iframe
            src={mapUrl}
            width="100%"
            height="100%"
            loading="lazy"
            style={{ border: "none" }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-white">
            <span>Loading map...</span>
          </div>
        )}

        {/* Event Title Badge */}
        <div className="absolute top-4 left-4 bg-black/70 px-4 py-2 rounded-lg text-white font-semibold">
          Event: {eventId}
        </div>

        {/* Athletes Count Badge */}
        <div className="absolute bottom-4 left-4 bg-blue-600 px-4 py-2 rounded-lg text-white font-semibold">
          🏃 {athletes.length} Athletes Live
        </div>
      </div>

      {/* ============================================ */}
      {/* 📊 SIDEBAR */}
      {/* ============================================ */}
      <div className="w-[35%] h-full overflow-y-auto bg-white border-l border-gray-200 flex flex-col">

        {/* HEADER */}
        <div className="p-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h1 className="text-2xl font-bold text-gray-900">Live Tracking</h1>
          <p className="text-xs text-gray-500 mt-1">Real-time athlete positions</p>

          <div className="mt-3 relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              placeholder="Search Bib / Name"
              className="mt-0 w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* LOADING */}
        {loading && (
          <div className="p-5 text-center text-gray-500 flex items-center justify-center">
            <Loader2 className="animate-spin w-4 h-4 mr-2" />
            Loading athletes...
          </div>
        )}

        {/* NO RESULTS */}
        {!loading && filtered.length === 0 && (
          <div className="p-5 text-center text-gray-500">
            No athletes found
          </div>
        )}

        {/* ============================================ */}
        {/* 🏁 LEADERBOARD */}
        {/* ============================================ */}
        {!loading && filtered.length > 0 && (
          <div className="flex-1 overflow-y-auto">
            {filtered.map((athlete, i) => (
              <div
                key={athlete.bookingId}
                onClick={() => setSelected(athlete)}
                className="p-4 border-b border-gray-100 cursor-pointer hover:bg-blue-50 transition duration-200"
              >
                <div className="flex justify-between items-start">

                  {/* LEFT */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded">
                        #{athlete.bibNumber}
                      </span>
                      <p className="font-semibold text-sm text-gray-900">
                        {athlete.name || "Athlete"}
                      </p>
                    </div>

                    <p className="text-xs text-gray-500 mt-1">
                      <span className="font-medium">{(athlete.distance || 0).toFixed(1)} km</span>
                      {" • "}
                      <span className="font-medium">{(athlete.speed || 0).toFixed(1)} km/h</span>
                    </p>
                  </div>

                  {/* RIGHT */}
                  <div className="text-right ml-2">
                    <p className="font-bold text-lg text-blue-600">
                      #{athlete.rank || i + 1}
                    </p>

                    <ProgressBar distance={athlete.distance} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ============================================ */}
      {/* 🔥 MODAL */}
      {/* ============================================ */}
      {selected && (
        <AthleteLiveModalPro
          open={!!selected}
          onClose={() => setSelected(null)}
          eventId={eventId}
          bookingId={selected.bookingId}
        />
      )}
    </div>
  );
}

// ============================================
// 🔥 PROGRESS BAR
// ============================================

function ProgressBar({ distance }: any) {
  const progress = Math.min((distance || 0) / 90 * 100, 100);

  return (
    <div className="w-20 h-1.5 bg-gray-200 rounded-full mt-2">
      <div
        className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-700"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
