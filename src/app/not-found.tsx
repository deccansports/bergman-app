'use client'
import Link from 'next/link';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Suspense } from 'react';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-background to-muted/30 p-4">
      <Card className="w-full max-w-md text-center shadow-2xl rounded-xl overflow-hidden">
        <CardHeader className="bg-destructive/10 p-6">
          <AlertTriangle className="h-16 w-16 text-destructive mx-auto mb-4" />
          <CardTitle className="text-4xl font-bold text-destructive">404</CardTitle>
          <CardDescription className="text-lg text-muted-foreground mt-1">
            Page Not Found
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
           <p className="text-sm text-muted-foreground">
            Oops! This page couldn&apos;t be found. Please check the URL or return to the homepage.
          </p>
          <p className="text-muted-foreground">
            Sorry, the page you are looking for does not exist or may have been moved.
          </p>
        </CardContent>
        <CardFooter className="p-6 border-t bg-muted/50">
          <Button asChild className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
            <Link href="/">Go to Homepage</Link>
          </Button>
        </CardFooter>
      </Card>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Copyright © 2025 BERGMAN. All rights reserved.
      </p>
    </div>
  );
}
