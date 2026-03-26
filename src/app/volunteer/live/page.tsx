// src/app/volunteer/live/page.tsx
"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, Video } from 'lucide-react';

export default function VolunteerLivePage() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [name, setName] = useState('');
    const [location, setLocation] = useState('Finish Line');
    const [streamUrl, setStreamUrl] = useState('');
    const [isLive, setIsLive] = useState(false);

    const goLive = async () => {
        if (!name || !location || !streamUrl) {
            toast({ variant: 'destructive', title: 'Missing Information', description: 'Please fill out all fields.' });
            return;
        }

        setIsLoading(true);
        try {
            const payload = {
                volunteer: name,
                location: location,
                embedUrl: streamUrl,
                timestamp: new Date().toISOString()
            };

            const docRef = doc(db, "liveFeeds", location.replace(/\s+/g, '-'));
            await setDoc(docRef, payload);
            
            toast({ title: 'Success!', description: 'Your live feed has been sent to the admin panel.' });
            setIsLive(true);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: `Could not go live: ${error.message}` });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-slate-900 text-slate-200 min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-slate-800/50 border border-slate-700 p-6 rounded-lg shadow-2xl">
                <div className="text-center mb-6">
                    <Video className="h-10 w-10 mx-auto text-primary mb-2" />
                    <h1 className="text-2xl font-bold text-white">Bergman Volunteer Live</h1>
                    <p className="text-sm text-slate-400">Start your live camera feed for race coverage.</p>
                </div>

                <div className="space-y-4">
                    <div>
                        <Label htmlFor="name">Your Name</Label>
                        <Input id="name" placeholder="E.g., Ramesh S." value={name} onChange={e => setName(e.target.value)} className="bg-slate-700 border-slate-600 text-white"/>
                    </div>
                    <div>
                        <Label htmlFor="location">Camera Location</Label>
                        <Select value={location} onValueChange={setLocation}>
                            <SelectTrigger id="location" className="bg-slate-700 border-slate-600 text-white"><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Finish Line">Finish Line</SelectItem>
                                <SelectItem value="Swim Exit">Swim Exit</SelectItem>
                                <SelectItem value="Cycle Loop">Cycle Loop</SelectItem>
                                <SelectItem value="Run Course">Run Course</SelectItem>
                                <SelectItem value="Drone">Drone</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="stream">YouTube Live Embed URL</Label>
                        <Input id="stream" placeholder="https://www.youtube.com/embed/XXXX" value={streamUrl} onChange={e => setStreamUrl(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
                    </div>

                    <Button onClick={goLive} disabled={isLoading || isLive} className="w-full !mt-6 bg-primary hover:bg-primary/90 text-primary-foreground">
                        {isLoading ? <Loader2 className="animate-spin" /> : 'GO LIVE'}
                    </Button>

                    {isLive && (
                        <p className="text-center text-sm text-green-400 mt-4">
                            🔴 LIVE – Your feed has been sent to the Admin Panel.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
