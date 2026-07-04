"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Award, ExternalLink, Loader2, Mail, MessageSquare, RefreshCw, Send, ShieldCheck, Trophy, Users } from "lucide-react";

import {
  getBelSeasonContentAction,
  getBelSeasonLeaderboardAction,
  sendBelEmailCampaignAction,
  sendBelWhatsAppCampaignAction,
  sendTestCampaignEmailAction,
  sendTestWhatsAppCampaignAction,
  syncBelSeasonFromResultsKVAction,
} from "@/lib/actions";
import type { BelRankedAthlete, BelSeasonMeta } from "@/lib/actions/eliteLeagueActions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const BEL_SEASON = 2025;
type BelAudience = "all" | "qualified" | "gold" | "silver" | "bronze" | "provisional";

export default function BelAdminTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [contentSource, setContentSource] = useState<"kv" | "fallback">("fallback");
  const [leaderboardSource, setLeaderboardSource] = useState<"bel-kv" | "synced" | "empty">("empty");
  const [rankings, setRankings] = useState<BelRankedAthlete[]>([]);
  const [officialCopy, setOfficialCopy] = useState<string[]>([]);
  const [meta, setMeta] = useState<BelSeasonMeta | null>(null);
  const [emailAudience, setEmailAudience] = useState<BelAudience>("qualified");
  const [emailSubject, setEmailSubject] = useState("BEL {{season}} Update for {{name}} · {{tier}} Tier");
  const [emailHtml, setEmailHtml] = useState("<p>Hello {{name}},</p><p>Congratulations on your current <strong>{{tier}}</strong> standing in Bergman Elite League {{season}}.</p><p>You currently have <strong>{{total_points}}</strong> points across <strong>{{starts}}</strong> starts.</p><p>Keep racing strong.</p>");
  const [testEmail, setTestEmail] = useState("");
  const [isSendingBelEmail, setIsSendingBelEmail] = useState(false);
  const [isSendingBelEmailTest, setIsSendingBelEmailTest] = useState(false);
  const [whatsAppAudience, setWhatsAppAudience] = useState<BelAudience>("qualified");
  const [whatsAppCampaignName, setWhatsAppCampaignName] = useState("");
  const [whatsAppParamsText, setWhatsAppParamsText] = useState("{{name}}\n{{tier}}\n{{total_points}}\n{{season}}");
  const [testMobile, setTestMobile] = useState("");
  const [isSendingBelWhatsApp, setIsSendingBelWhatsApp] = useState(false);
  const [isSendingBelWhatsAppTest, setIsSendingBelWhatsAppTest] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [contentRes, leaderboardRes] = await Promise.all([
      getBelSeasonContentAction(BEL_SEASON),
      getBelSeasonLeaderboardAction(BEL_SEASON),
    ]);

    setContentSource(contentRes.source);
    setOfficialCopy(contentRes.content.officialCopy);
    setLeaderboardSource(leaderboardRes.source);
    setRankings(leaderboardRes.rankings || []);
    setMeta(leaderboardRes.meta || null);
    setLoading(false);
  };

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!mounted) return;
      await loadData();
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(() => {
    const eligible = rankings.filter((athlete) => athlete.racesFinished >= 2);
    const tiers = rankings.reduce(
      (acc, athlete) => {
        const tier = athlete.belTier;
        if (tier === 'Gold') acc.gold += 1;
        else if (tier === 'Silver') acc.silver += 1;
        else if (tier === 'Bronze') acc.bronze += 1;
        else if (tier === 'Provisional') acc.provisional += 1;
        else acc.none += 1;
        return acc;
      },
      { gold: 0, silver: 0, bronze: 0, provisional: 0, none: 0 }
    );

    const topMale = eligible.filter((a) => a.gender === "Male").sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 3);
    const topFemale = eligible.filter((a) => a.gender === "Female").sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 3);

    return {
      totalRanked: rankings.length,
      eligible: eligible.length,
      ...tiers,
      topMale,
      topFemale,
    };
  }, [rankings]);

  const tierAthletes = useMemo(() => {
    const sortByPoints = (a: BelRankedAthlete, b: BelRankedAthlete) =>
      (b.totalPoints || 0) - (a.totalPoints || 0) || a.name.localeCompare(b.name);

    return {
      gold: rankings.filter((athlete) => athlete.belTier === 'Gold').sort(sortByPoints),
      silver: rankings.filter((athlete) => athlete.belTier === 'Silver').sort(sortByPoints),
      bronze: rankings.filter((athlete) => athlete.belTier === 'Bronze').sort(sortByPoints),
    };
  }, [rankings]);

  const handleSync = async () => {
    setSyncing(true);
    const result = await syncBelSeasonFromResultsKVAction(BEL_SEASON);
    if (result.success) {
      toast({ title: 'BEL synced', description: result.message });
      await loadData();
    } else {
      toast({ variant: 'destructive', title: 'BEL sync failed', description: result.message });
    }
    setSyncing(false);
  };

  const handleSendBelEmailCampaign = async () => {
    setIsSendingBelEmail(true);
    try {
      const result = await sendBelEmailCampaignAction(BEL_SEASON, {
        targetTier: emailAudience,
        subject: emailSubject,
        htmlContent: emailHtml,
      });

      if (result.success) {
        toast({ title: 'BEL email campaign sent', description: result.message });
      } else {
        toast({ variant: 'destructive', title: 'BEL email campaign failed', description: result.message });
      }
    } finally {
      setIsSendingBelEmail(false);
    }
  };

  const handleSendBelEmailTest = async () => {
    setIsSendingBelEmailTest(true);
    try {
      const result = await sendTestCampaignEmailAction(testEmail, emailSubject, emailHtml, null);
      if (result.success) {
        toast({ title: 'Test email sent', description: result.message });
      } else {
        toast({ variant: 'destructive', title: 'Test email failed', description: result.message });
      }
    } finally {
      setIsSendingBelEmailTest(false);
    }
  };

  const handleSendBelWhatsAppCampaign = async () => {
    setIsSendingBelWhatsApp(true);
    try {
      const result = await sendBelWhatsAppCampaignAction(BEL_SEASON, {
        targetTier: whatsAppAudience,
        campaignName: whatsAppCampaignName,
        templateParams: whatsAppParamsText.split('\n').map((line) => line.trim()).filter(Boolean),
      });

      if (result.success) {
        toast({ title: 'BEL WhatsApp campaign sent', description: result.message });
      } else {
        toast({ variant: 'destructive', title: 'BEL WhatsApp campaign failed', description: result.message });
      }
    } finally {
      setIsSendingBelWhatsApp(false);
    }
  };

  const handleSendBelWhatsAppTest = async () => {
    setIsSendingBelWhatsAppTest(true);
    try {
      const result = await sendTestWhatsAppCampaignAction(
        testMobile,
        whatsAppCampaignName,
        whatsAppParamsText.split('\n').map((line) => line.trim()).filter(Boolean)
      );
      if (result.success) {
        toast({ title: 'Test WhatsApp sent', description: result.message });
      } else {
        toast({ variant: 'destructive', title: 'Test WhatsApp failed', description: result.message });
      }
    } finally {
      setIsSendingBelWhatsAppTest(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground py-8">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading BEL season data…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-primary text-primary-foreground">BEL {BEL_SEASON}</Badge>
            <Badge variant="secondary">Content: {contentSource.toUpperCase()}</Badge>
            <Badge variant="outline">Leaderboard: {leaderboardSource === 'bel-kv' ? 'BEL KV' : 'EMPTY'}</Badge>
          </div>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" /> Bergman Elite League
          </CardTitle>
          <CardDescription>Admin view for BEL content, qualification logic, and current season distribution.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {meta?.lastSyncedAt ? `Last synced: ${new Date(meta.lastSyncedAt).toLocaleString()}` : 'BEL KV has not been synced yet.'}
            </div>
            <Button onClick={handleSync} disabled={syncing} className="font-black uppercase tracking-widest text-xs">
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Sync Results KV → BEL KV
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Total Ranked</p>
              <p className="mt-2 text-3xl font-black text-primary">{meta?.totalRankedAthletes ?? stats.totalRanked}</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Eligible (2+ Starts)</p>
              <p className="mt-2 text-3xl font-black text-emerald-600">{meta?.eligibleAthletes ?? stats.eligible}</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Tier Counts</p>
              <p className="mt-2 text-sm font-semibold">🥇 {stats.gold} · 🥈 {stats.silver} · 🥉 {stats.bronze}</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Provisional</p>
              <p className="mt-2 text-3xl font-black text-amber-600">{meta?.provisionalAthletes ?? stats.provisional}</p>
            </CardContent>
          </Card>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3 md:w-auto md:inline-grid md:grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tiers">Gold / Silver / Bronze</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Official Copy</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-7">
                {officialCopy.map((line, idx) => (
                  <p key={idx}>{line}</p>
                ))}
                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                  BEL tier logic: Gold = top 3, Silver = next 5, Bronze = next 10, Provisional = fewer than 2 starts.
                </div>
                <div className="flex flex-wrap gap-3 pt-2">
                  <Link href="/elite-league" className="text-primary hover:underline font-medium inline-flex items-center gap-1">
                    Open public BEL page <ExternalLink className="h-4 w-4" />
                  </Link>
                  <Link href="/athlete-rankings" className="text-primary hover:underline font-medium inline-flex items-center gap-1">
                    Open athlete rankings <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-primary" /> Top BEL Snapshot</CardTitle>
                <CardDescription>Top eligible athletes by total points.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Top Male</p>
                  <div className="space-y-2">
                    {stats.topMale.map((athlete, index) => (
                      <div key={athlete.athleteId} className="rounded-lg border p-3">
                        <p className="font-semibold">{index + 1}. {athlete.name}</p>
                        <p className="text-sm text-muted-foreground">{athlete.totalPoints} pts · {athlete.ageCategory || 'Open'}</p>
                      </div>
                    ))}
                    {stats.topMale.length === 0 && <p className="text-sm text-muted-foreground">No eligible male athletes yet.</p>}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Top Female</p>
                  <div className="space-y-2">
                    {stats.topFemale.map((athlete, index) => (
                      <div key={athlete.athleteId} className="rounded-lg border p-3">
                        <p className="font-semibold">{index + 1}. {athlete.name}</p>
                        <p className="text-sm text-muted-foreground">{athlete.totalPoints} pts · {athlete.ageCategory || 'Open'}</p>
                      </div>
                    ))}
                    {stats.topFemale.length === 0 && <p className="text-sm text-muted-foreground">No eligible female athletes yet.</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Admin Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>• BEL content is read from KV first using <strong>content:bel:2025</strong>.</p>
              <p>• BEL leaderboard is now synced from <strong>results KV</strong> into dedicated <strong>BEL KV</strong> keys.</p>
              <p>• Athletes with fewer than 2 starts are treated as provisional and should not receive final season tier recognition.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tiers" className="mt-6">
          <div className="grid gap-6 xl:grid-cols-3">
            {[
              {
                key: 'gold',
                title: 'Gold Athletes',
                tone: 'text-yellow-600',
                badgeClass: 'bg-yellow-500 text-black hover:bg-yellow-500',
                empty: 'No gold athletes yet.',
                athletes: tierAthletes.gold,
              },
              {
                key: 'silver',
                title: 'Silver Athletes',
                tone: 'text-slate-500',
                badgeClass: 'bg-slate-300 text-slate-900 hover:bg-slate-300',
                empty: 'No silver athletes yet.',
                athletes: tierAthletes.silver,
              },
              {
                key: 'bronze',
                title: 'Bronze Athletes',
                tone: 'text-amber-700',
                badgeClass: 'bg-amber-600 text-white hover:bg-amber-600',
                empty: 'No bronze athletes yet.',
                athletes: tierAthletes.bronze,
              },
            ].map((tier) => (
              <Card key={tier.key}>
                <CardHeader>
                  <CardTitle className={`flex items-center justify-between gap-2 ${tier.tone}`}>
                    <span>{tier.title}</span>
                    <Badge className={tier.badgeClass}>{tier.athletes.length}</Badge>
                  </CardTitle>
                  <CardDescription>Athletes currently qualified in this BEL tier.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                    {tier.athletes.map((athlete) => (
                      <div key={athlete.athleteId} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold leading-tight">{athlete.name}</p>
                            <p className="text-xs text-muted-foreground">{athlete.gender} · {athlete.ageCategory || 'Open'} · {athlete.clubName || 'Independent'}</p>
                          </div>
                          <Badge variant="outline">#{athlete.categoryRank}</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{athlete.totalPoints} pts</span>
                          <span>{athlete.racesFinished} starts</span>
                          <span>Overall #{athlete.overallRank}</span>
                        </div>
                      </div>
                    ))}
                    {tier.athletes.length === 0 && <p className="text-sm text-muted-foreground">{tier.empty}</p>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="campaigns" className="mt-6 space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" /> Custom Email Campaign</CardTitle>
                <CardDescription>Send a custom HTML email campaign to BEL athletes by tier.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Audience</Label>
                  <Select value={emailAudience} onValueChange={(value) => setEmailAudience(value as BelAudience)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="qualified">Qualified BEL Athletes</SelectItem>
                      <SelectItem value="all">All Ranked Athletes</SelectItem>
                      <SelectItem value="gold">Gold</SelectItem>
                      <SelectItem value="silver">Silver</SelectItem>
                      <SelectItem value="bronze">Bronze</SelectItem>
                      <SelectItem value="provisional">Provisional</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="BEL subject line" />
                </div>

                <div className="space-y-2">
                  <Label>HTML Content</Label>
                  <Textarea value={emailHtml} onChange={(e) => setEmailHtml(e.target.value)} rows={10} className="font-mono text-xs" placeholder="<p>Hello {{name}}</p>" />
                </div>

                <Alert>
                  <AlertDescription className="text-xs">
                    Available placeholders: {'{{name}}'}, {'{{first_name}}'}, {'{{tier}}'}, {'{{season}}'}, {'{{total_points}}'}, {'{{starts}}'}, {'{{overall_rank}}'}, {'{{category_rank}}'}, {'{{age_category}}'}, {'{{club_name}}'}, {'{{email}}'}, {'{{mobile}}'}.
                  </AlertDescription>
                </Alert>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="test email" />
                  <Button variant="outline" onClick={handleSendBelEmailTest} disabled={isSendingBelEmailTest || !testEmail || !emailSubject || !emailHtml}>
                    {isSendingBelEmailTest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Send Test
                  </Button>
                </div>

                <Button onClick={handleSendBelEmailCampaign} disabled={isSendingBelEmail || !emailSubject || !emailHtml} className="w-full">
                  {isSendingBelEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                  Send Email Campaign
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" /> Custom WhatsApp Campaign</CardTitle>
                <CardDescription>Send a custom AiSensy campaign to BEL athletes by tier.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Audience</Label>
                  <Select value={whatsAppAudience} onValueChange={(value) => setWhatsAppAudience(value as BelAudience)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="qualified">Qualified BEL Athletes</SelectItem>
                      <SelectItem value="all">All Ranked Athletes</SelectItem>
                      <SelectItem value="gold">Gold</SelectItem>
                      <SelectItem value="silver">Silver</SelectItem>
                      <SelectItem value="bronze">Bronze</SelectItem>
                      <SelectItem value="provisional">Provisional</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>AiSensy Campaign Name</Label>
                  <Input value={whatsAppCampaignName} onChange={(e) => setWhatsAppCampaignName(e.target.value)} placeholder="approved campaign name" />
                </div>

                <div className="space-y-2">
                  <Label>Template Params</Label>
                  <Textarea value={whatsAppParamsText} onChange={(e) => setWhatsAppParamsText(e.target.value)} rows={8} className="font-mono text-xs" placeholder="One param per line" />
                </div>

                <Alert>
                  <AlertDescription className="text-xs">
                    Enter one parameter per line in the exact order expected by AiSensy. Line 1 maps to {'{{1}}'}, line 2 maps to {'{{2}}'}, and so on. You can still use BEL placeholders like {'{{name}}'} or {'{{tier}}'} inside each line.
                  </AlertDescription>
                </Alert>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={testMobile} onChange={(e) => setTestMobile(e.target.value)} placeholder="test mobile" />
                  <Button variant="outline" onClick={handleSendBelWhatsAppTest} disabled={isSendingBelWhatsAppTest || !testMobile || !whatsAppCampaignName}>
                    {isSendingBelWhatsAppTest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Send Test
                  </Button>
                </div>

                <Button onClick={handleSendBelWhatsAppCampaign} disabled={isSendingBelWhatsApp || !whatsAppCampaignName} className="w-full">
                  {isSendingBelWhatsApp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquare className="mr-2 h-4 w-4" />}
                  Send WhatsApp Campaign
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
