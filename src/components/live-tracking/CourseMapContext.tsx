"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import type { CustomSplitPoint } from "@/lib/types";

interface CourseMaps {
  swimSplits: CustomSplitPoint[];
  bikeSplits: CustomSplitPoint[];
  runSplits: CustomSplitPoint[];
}

interface CourseMapContextType {
  courseMaps: CourseMaps | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const CourseMapContext = createContext<CourseMapContextType | undefined>(undefined);

export interface CourseMapProviderProps {
  eventId: string;
  children: ReactNode;
}

export function CourseMapProvider({ eventId, children }: CourseMapProviderProps) {
  const [courseMaps, setCourseMaps] = useState<CourseMaps | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCourseMaps = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/live/course-config?eventId=${encodeURIComponent(eventId)}`
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch course config: ${res.status}`);
      }

      const data = await res.json();

      if (data.success) {
        setCourseMaps(data.courseMaps);
        console.log("[CourseMap] Loaded custom splits:", data.courseMaps);
      } else {
        throw new Error(data.error || "Failed to load course config");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("[CourseMap] Error fetching course config:", err);
      // Set empty course maps as fallback
      setCourseMaps({
        swimSplits: [],
        bikeSplits: [],
        runSplits: [],
      });
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchCourseMaps();
  }, [fetchCourseMaps]);

  return (
    <CourseMapContext.Provider
      value={{
        courseMaps,
        loading,
        error,
        refetch: fetchCourseMaps,
      }}
    >
      {children}
    </CourseMapContext.Provider>
  );
}

export function useCourseMap() {
  const context = useContext(CourseMapContext);

  if (!context) {
    throw new Error("useCourseMap must be used within CourseMapProvider");
  }

  return context;
}
