// src/app/error.tsx
"use client"; // Error components must be Client Components

import { useEffect, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { AlertTriangle, Loader2 } from 'lucide-react';

function ErrorContent({ error, reset }: { error: Error & { digest?: string }; reset: () => void; }) {
   useEffect(() => {
    // Log the error to an error reporting service
    console.error("Caught in Global Error Boundary:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-destructive/10 via-background to-background p-4">
        <Card className="w-full max-w-lg text-center shadow-2xl rounded-xl overflow-hidden border-destructive/50">
            <CardHeader className="bg-destructive/10 p-6">
                <AlertTriangle className="h-16 w-16 text-destructive mx-auto mb-4" />
                <CardTitle className="text-3xl font-bold text-destructive">Something Went Wrong</CardTitle>
                <CardDescription className="text-lg text-muted-foreground mt-1">
                    An unexpected error has occurred.
                </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
                <p className="text-sm text-muted-foreground">
                    We apologize for the inconvenience. You can try to recover by clicking the button below.
                </p>
                {error?.message && (
                    <div className="p-3 bg-muted/50 border rounded-md text-left">
                        <p className="text-xs text-muted-foreground font-mono">{error.message}</p>
                    </div>
                )}
            </CardContent>
            <CardFooter className="p-6 border-t bg-muted/50">
                <Button onClick={() => reset()} className="w-full">
                    Try Again
                </Button>
            </CardFooter>
        </Card>
    </div>
  );
}


export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Suspense fallback={
        <div className="flex flex-col items-center justify-center min-h-screen">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">Loading Error Page...</p>
        </div>
    }>
      <ErrorContent error={error} reset={reset} />
    </Suspense>
  );
}
