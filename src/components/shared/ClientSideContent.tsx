"use client";

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export default function ClientSideContent({ children }: { children: React.ReactNode }) {
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        setIsClient(true);
    }, []);

    // On the server and during the initial client render, show a placeholder.
    if (!isClient) {
        return <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
        </div>;
    }

    // After the client has mounted, render the actual content.
    return <>{children}</>;
}
