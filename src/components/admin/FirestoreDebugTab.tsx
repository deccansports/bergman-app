// src/components/admin/FirestoreDebugTab.tsx
"use client";

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Server, AlertTriangle, ExternalLink } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function FirestoreDebugTab() {
  const gcpProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const loggingUrl = `https://console.cloud.google.com/logs/query;query=resource.type%3D"audited_resource"%0Aresource.labels.service%3D"firestore.googleapis.com";timeRange=PT1H;?project=${gcpProjectId}`;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5 text-amber-600" />
          Firestore Operations Debugging
        </CardTitle>
        <CardDescription>
          Monitor and analyze your Firestore database usage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 border border-dashed rounded-lg bg-background">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-500 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold text-foreground">Live UI Logging is Not Available</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Displaying a real-time log of every single Firestore read and write operation directly in this dashboard is not feasible for performance, security, and cost reasons.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                The recommended and most powerful tool for this purpose is **Google Cloud Logging**.
              </p>
            </div>
          </div>
        </div>
        <div className="text-center">
            <Button asChild>
                <a href={loggingUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Google Cloud Logging for Firestore
                </a>
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
                This will take you to the Cloud Logs Explorer, pre-filtered for your Firestore database operations.
            </p>
        </div>
      </CardContent>
    </Card>
  );
}
