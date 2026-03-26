// src/components/admin/LiveStreamingTab.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tv, Play, Power, RotateCcw, AlertTriangle, Copy, ExternalLink, Satellite, Loader2, MessageSquare, Video } from 'lucide-react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { Textarea } from '../ui/textarea';
import Image from 'next/image';

// New LiveControl interface based on user feedback
interface LiveControl {
  activeFeedType: 'youtube' | 'black' | 'message';
  youtubeVideoId?: string | null;
  message?: string | null;
  updatedAt: string;
}

function extractYouTubeId(url: string): string | null {
    if (!url) return null;
    const match = url.match(/(?:live\/|watch\?v=|embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

export default function LiveStreamingTab() {
    const { toast } = useToast();
    const [currentControl, setCurrentControl] = useState<LiveControl | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    
    // State for inputs
    const [youtubeUrl, setYoutubeUrl] = useState('');
    const [customMessage, setCustomMessage] = useState('');

    const [publicLink, setPublicLink] = useState('');
    const [lastKnownVideoId, setLastKnownVideoId] = useState<string | null>(null);


    useEffect(() => {
        setPublicLink(`${window.location.origin}/live`);
    }, []);

    useEffect(() => {
        const controlDocRef = doc(db, 'liveControl', 'current');
        const unsubscribe = onSnapshot(controlDocRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data() as LiveControl;
                setCurrentControl(data);
                if(data.youtubeVideoId) {
                    setLastKnownVideoId(data.youtubeVideoId);
                }
            } else {
                setCurrentControl(null);
            }
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, []);
    
    const updateLiveScreen = async (payload: Partial<Omit<LiveControl, 'updatedAt'>>) => {
        setIsSaving(true);
        try {
            const controlDocRef = doc(db, 'liveControl', 'current');
            const updatePayload = {
                ...currentControl, // carry over existing state
                ...payload, // apply new changes
                updatedAt: new Date().toISOString()
            };
            await setDoc(controlDocRef, updatePayload);
            toast({ title: 'Success', description: `Live screen updated to: ${payload.activeFeedType?.toUpperCase()}` });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: `Failed to update live screen: ${error.message}` });
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleShowVideo = () => {
        const videoId = extractYouTubeId(youtubeUrl);
        if (!videoId) {
            toast({ variant: 'destructive', title: 'Invalid URL', description: 'Could not find a valid YouTube Video ID in the URL.' });
            return;
        }
        updateLiveScreen({ activeFeedType: 'youtube', youtubeVideoId: videoId });
    };

    const handleShowMessage = () => {
        if (!customMessage.trim()) {
            toast({ variant: 'destructive', title: 'Invalid Message', description: 'Custom message cannot be empty.' });
            return;
        }
        updateLiveScreen({ activeFeedType: 'message', message: customMessage.trim(), youtubeVideoId: null });
    };

    const handleBlackScreen = () => {
        updateLiveScreen({ activeFeedType: 'black', youtubeVideoId: null, message: null });
    };
    
    const handleRestoreLast = () => {
        if (lastKnownVideoId) {
             updateLiveScreen({ activeFeedType: 'youtube', youtubeVideoId: lastKnownVideoId });
        } else {
            toast({ description: "No previous video feed to restore." });
        }
    };
    
    const copyToClipboard = (text: string) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        toast({ title: 'Link Copied!', description: 'The URL has been copied to your clipboard.' });
    };

    const currentEmbedUrl = (currentControl?.activeFeedType === 'youtube' && currentControl.youtubeVideoId)
        ? `https://www.youtube.com/embed/${currentControl.youtubeVideoId}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&showinfo=0`
        : null;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-primary" />Stream Control</CardTitle>
                        <CardDescription>Paste a YouTube Live URL to broadcast it.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                           <Label htmlFor="youtube-url">YouTube Live URL</Label>
                           <Input id="youtube-url" value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/live/..." />
                        </div>
                        <Button onClick={handleShowVideo} disabled={isSaving || !youtubeUrl} className="w-full">
                           {isSaving ? <Loader2 className="animate-spin mr-2"/> : <Play className="mr-2 h-4 w-4" />} Show on Screen
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" />Custom Message</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Textarea value={customMessage} onChange={(e) => setCustomMessage(e.target.value)} placeholder="e.g., Race paused due to weather. Updates to follow." />
                        <Button onClick={handleShowMessage} disabled={isSaving || !customMessage} className="w-full" variant="secondary">
                           Display Message
                        </Button>
                    </CardContent>
                </Card>

                 <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />Emergency Controls</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                         <Button className="w-full bg-destructive hover:bg-destructive/90" onClick={handleBlackScreen} disabled={isSaving}>
                           <Power className="h-4 w-4 mr-2"/> BLACK SCREEN
                        </Button>
                        <Button className="w-full" variant="outline" onClick={handleRestoreLast} disabled={isSaving}>
                           <RotateCcw className="h-4 w-4 mr-2"/> RESTORE LAST FEED
                        </Button>
                    </CardContent>
                </Card>
            </div>
            <div className="lg:col-span-2">
                <Card>
                     <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Tv className="h-5 w-5 text-primary"/>Live Screen Preview</CardTitle>
                        <CardDescription>This is what viewers see on the public live screen. It updates automatically.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="relative aspect-video bg-black rounded-lg overflow-hidden border">
                            {isLoading ? <Loader2 className="animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"/> 
                            : currentControl?.activeFeedType === 'youtube' && currentControl.youtubeVideoId ? (
                                <iframe src={`https://www.youtube.com/embed/${currentControl.youtubeVideoId}?autoplay=1&mute=1&controls=0`} allow="autoplay; encrypted-media" allowFullScreen className="w-full h-full"></iframe>
                            ) : currentControl?.activeFeedType === 'message' && currentControl.message ? (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 p-4 text-center">
                                    <h2 className="text-3xl font-bold text-yellow-400">{currentControl.message}</h2>
                                </div>
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-black p-4 text-center">
                                    <Image src="/Bmlogowhite.png" alt="Bergman Logo" width={200} height={66} className="object-contain" />
                                    <p className="text-slate-400 mt-4 text-lg">LIVE SCREEN STANDBY</p>
                                </div>
                            )}
                        </div>
                        <div className="mt-4 space-y-2">
                            <Label>Public Live Screen URL</Label>
                            <div className="flex gap-2">
                                <Input readOnly value={publicLink} />
                                <Button variant="outline" onClick={() => copyToClipboard(publicLink)}><Copy className="h-4 w-4"/></Button>
                                <Button asChild><Link href={publicLink} target="_blank"><ExternalLink className="h-4 w-4"/></Link></Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
