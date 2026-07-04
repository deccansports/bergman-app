// src/components/admin/TemplatesTab.tsx
'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  getAllTemplatesAction,
  saveTemplateAction,
  deleteTemplateAction,
  testSendTemplateAction,
  seedTemplatesAction,
  renderPreviewAction,
  getBergTechnoIntegrationAction,
  saveBergTechnoIntegrationAction,
} from '@/lib/actions/templateActions';
import type { NotificationTemplate } from '@/lib/actions/templateActions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Mail, MessageSquare, Plus, Trash2, Save, Send,
  Eye, Code2, Loader2, RefreshCw, Search, Layers, TestTube2, Database, Tag, Variable
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

// ─── Sample params used for preview and test ────────────────────────────────

const SAMPLE_PARAMS: Record<string, any> = {
  name: 'Test Athlete',
  event_name: 'BERGMAN BENGALURU 2026',
  invoice_number: 'INV-2026-001234',
  category: 'BERGMAN 102 TRIATHLON',
  event_date: 'September 6, 2026',
  amount: '14736.00',
  event_link: 'https://www.bergmantri.com',
  booking_id: 'BMINZ05MI',
  bib_number: '1011',
  venue: 'Kanteerava Stadium, Bengaluru',
  from_category: 'BERGMAN 70.3',
  to_category: 'BERGMAN 102 TRIATHLON',
  expiry_date: 'December 31, 2027',
  service_type: 'Deferral',
  otp: '847291',
};

// ─── Category colours ─────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  admin: 'bg-slate-100 text-slate-700',
  auth: 'bg-gray-100 text-gray-700',
  cancellation: 'bg-rose-100 text-rose-700',
  category_change: 'bg-purple-100 text-purple-700',
  club: 'bg-indigo-100 text-indigo-700',
  deferral: 'bg-blue-100 text-blue-700',
  invoice: 'bg-orange-100 text-orange-700',
  other: 'bg-zinc-100 text-zinc-700',
  registration: 'bg-green-100 text-green-700',
  store: 'bg-amber-100 text-amber-700',
  support: 'bg-cyan-100 text-cyan-700',
};

const CATEGORIES = ['admin', 'auth', 'cancellation', 'category_change', 'club', 'deferral', 'invoice', 'other', 'registration', 'store', 'support'];
const SUB_CATEGORIES = ['current', 'legacy'];

// ─── Blank template ───────────────────────────────────────────────────────

const BLANK_TEMPLATE: Omit<NotificationTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version'> = {
  key: '',
  name: '',
  category: 'registration',
  subCategory: 'current',
  channel: 'email',
  brevoTemplateId: null,
  subject: '',
  content: '',
  variables: [],
  aisensyCampaignName: '',
  aisensyParamKeys: [],
  active: true,
};

// ─── Component ────────────────────────────────────────────────────────────

export default function TemplatesTab() {
  const { toast } = useToast();
  const { firebaseUserFromAuth } = useAuth();

  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editorData, setEditorData] = useState<Omit<NotificationTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version'>>(BLANK_TEMPLATE);
  const [activeEditorTab, setActiveEditorTab] = useState<'edit' | 'preview' | 'test'>('edit');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isTestSending, setIsTestSending] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewSubject, setPreviewSubject] = useState('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [isNewMode, setIsNewMode] = useState(false);
  const [variableInput, setVariableInput] = useState('');
  const previewRef = useRef<HTMLIFrameElement>(null);
  const [activeMainTab, setActiveMainTab] = useState<'templates' | 'integration'>('templates');
  const [isIntegrationLoading, setIsIntegrationLoading] = useState(false);
  const [isIntegrationSaving, setIsIntegrationSaving] = useState(false);
  const [integrationData, setIntegrationData] = useState({
    apiBaseUrl: '',
    senderEmail: 'info@bergmantri.com',
    senderName: 'Bergman Triathlon',
    apiKeyHeader: 'x-api-key',
    templateSendPath: '/email/send-template',
    rawSendPath: '/email/send',
    timeoutMs: 15000,
    hasApiKey: false,
    apiKeyMasked: '',
  });
  const [integrationApiKey, setIntegrationApiKey] = useState('');

  // ── Load templates ────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await getAllTemplatesAction();
    if (res.success && res.templates) {
      setTemplates(res.templates);
    } else {
      toast({ variant: 'destructive', title: 'Load Error', description: res.message });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const loadIntegration = useCallback(async () => {
    setIsIntegrationLoading(true);
    const res = await getBergTechnoIntegrationAction();
    if (res.success && res.data) {
      setIntegrationData({
        apiBaseUrl: res.data.apiBaseUrl || '',
        senderEmail: res.data.senderEmail || 'info@bergmantri.com',
        senderName: res.data.senderName || 'Bergman Triathlon',
        apiKeyHeader: res.data.apiKeyHeader || 'x-api-key',
        templateSendPath: res.data.templateSendPath || '/email/send-template',
        rawSendPath: res.data.rawSendPath || '/email/send',
        timeoutMs: Number(res.data.timeoutMs || 15000),
        hasApiKey: !!res.data.hasApiKey,
        apiKeyMasked: res.data.apiKeyMasked || '',
      });
      setIntegrationApiKey('');
    } else {
      toast({ variant: 'destructive', title: 'Integration Load Failed', description: res.message || 'Could not load settings.' });
    }
    setIsIntegrationLoading(false);
  }, [toast]);

  useEffect(() => {
    loadIntegration();
  }, [loadIntegration]);

  const handleSaveIntegration = async () => {
    if (!integrationData.apiBaseUrl.trim()) {
      toast({ variant: 'destructive', title: 'API base URL required' });
      return;
    }
    if (!integrationData.hasApiKey && !integrationApiKey.trim()) {
      toast({ variant: 'destructive', title: 'API key required' });
      return;
    }

    setIsIntegrationSaving(true);
    const res = await saveBergTechnoIntegrationAction({
      apiBaseUrl: integrationData.apiBaseUrl,
      apiKey: integrationApiKey,
      senderEmail: integrationData.senderEmail,
      senderName: integrationData.senderName,
      apiKeyHeader: integrationData.apiKeyHeader,
      templateSendPath: integrationData.templateSendPath,
      rawSendPath: integrationData.rawSendPath,
      timeoutMs: Number(integrationData.timeoutMs || 15000),
    });

    if (res.success) {
      toast({ title: '✅ Integration Saved', description: res.message });
      await loadIntegration();
    } else {
      toast({ variant: 'destructive', title: 'Save Failed', description: res.message });
    }

    setIsIntegrationSaving(false);
  };

  // ── Select template ───────────────────────────────────────────────────────

  const selectTemplate = useCallback((t: NotificationTemplate) => {
    setSelectedKey(t.key);
    setIsNewMode(false);
    setEditorData({
      key: t.key,
      name: t.name,
      category: t.category,
      subCategory: t.subCategory ?? (t.key.startsWith('legacy_') ? 'legacy' : 'current'),
      channel: t.channel,
      brevoTemplateId: t.brevoTemplateId ?? null,
      subject: t.subject ?? '',
      content: t.content,
      variables: t.variables ?? [],
      aisensyCampaignName: t.aisensyCampaignName ?? '',
      aisensyParamKeys: t.aisensyParamKeys ?? [],
      active: t.active,
    });
    setActiveEditorTab('edit');
    setPreviewHtml('');
    setTestTo(''); // clear recipient when switching templates
  }, []);

  const newTemplate = () => {
    setSelectedKey(null);
    setIsNewMode(true);
    setEditorData(BLANK_TEMPLATE);
    setActiveEditorTab('edit');
    setPreviewHtml('');
    setTestTo('');
  };

  // ── Preview ───────────────────────────────────────────────────────────────

  const handlePreview = useCallback(async () => {
    setIsPreviewLoading(true);
    const res = await renderPreviewAction(
      editorData.content,
      editorData.subject ?? '',
      SAMPLE_PARAMS,
      editorData.channel,
      editorData.aisensyParamKeys ?? []
    );
    setPreviewHtml(res.html);
    setPreviewSubject(res.subject);
    setIsPreviewLoading(false);
    // push into iframe
    setTimeout(() => {
      if (previewRef.current) {
        const doc = previewRef.current.contentDocument;
        if (doc) { doc.open(); doc.write(res.html); doc.close(); }
      }
    }, 50);
  }, [editorData]);

  useEffect(() => {
    if (activeEditorTab === 'preview') handlePreview();
  }, [activeEditorTab, handlePreview]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!editorData.key) { toast({ variant: 'destructive', title: 'Key required' }); return; }
    if (!editorData.name) { toast({ variant: 'destructive', title: 'Name required' }); return; }
    if (editorData.channel === 'email' && !(editorData.brevoTemplateId && editorData.brevoTemplateId > 0) && !editorData.content?.trim()) {
      toast({ variant: 'destructive', title: 'Template ID required', description: 'Set BergTechno template ID (legacy field: brevoTemplateId). Raw HTML content is optional fallback.' });
      return;
    }
    if (editorData.channel === 'whatsapp' && !editorData.aisensyCampaignName?.trim()) {
      toast({ variant: 'destructive', title: 'AiSensy campaign name required' });
      return;
    }

    setIsSaving(true);
    const res = await saveTemplateAction(editorData);
    if (res.success) {
      toast({ title: '✅ Saved', description: res.message });
      setIsNewMode(false);
      setSelectedKey(editorData.key);
      await load();
    } else {
      toast({ variant: 'destructive', title: 'Save Failed', description: res.message });
    }
    setIsSaving(false);
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteKey) return;
    setIsDeleting(true);
    const res = await deleteTemplateAction(deleteKey);
    if (res.success) {
      toast({ title: 'Deleted' });
      setSelectedKey(null);
      setIsNewMode(false);
      setEditorData(BLANK_TEMPLATE);
      await load();
    } else {
      toast({ variant: 'destructive', title: 'Delete Failed', description: res.message });
    }
    setDeleteKey(null);
    setIsDeleting(false);
  };

  // ── Test send ─────────────────────────────────────────────────────────────

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  const isValidMobile = (value: string) => {
    const digits = value.replace(/\D/g, '');
    return digits.length === 10 || (digits.length === 12 && digits.startsWith('91'));
  };

  const handleTestSend = async () => {
    if (!testTo) { toast({ variant: 'destructive', title: 'Enter a test recipient' }); return; }
    if (!editorData.key) { toast({ variant: 'destructive', title: 'Save template first' }); return; }

    if (editorData.channel === 'email' && !isValidEmail(testTo)) {
      toast({ variant: 'destructive', title: 'Invalid test recipient', description: 'Please enter a valid email address for email templates.' });
      return;
    }

    if (editorData.channel === 'whatsapp' && !isValidMobile(testTo)) {
      toast({ variant: 'destructive', title: 'Invalid test recipient', description: 'Please enter a valid 10-digit mobile number for WhatsApp templates.' });
      return;
    }

    setIsTestSending(true);
    const res = await testSendTemplateAction({ templateKey: editorData.key, to: testTo, sampleParams: SAMPLE_PARAMS });
    if (res.success) {
      toast({ title: '📨 Test Sent', description: `Delivered to ${testTo}` });
    } else {
      toast({ variant: 'destructive', title: 'Test Failed', description: res.message });
    }
    setIsTestSending(false);
  };

  // ── Seed ──────────────────────────────────────────────────────────────────

  const handleSeed = async () => {
    setIsSeeding(true);
    const res = await seedTemplatesAction();
    if (res.success) {
      toast({ title: '🌱 Seeded', description: res.message });
      await load();
    } else {
      toast({ variant: 'destructive', title: 'Seed Failed', description: res.message });
    }
    setIsSeeding(false);
  };

  // ── Auto-detect variables ─────────────────────────────────────────────────

  const autoDetectVariables = () => {
    if (editorData.channel === 'whatsapp') {
      // AiSensy uses {{1}}, {{2}}... — count how many positional params are used
      const nums = editorData.content.match(/\{\{(\d+)\}\}/g) ?? [];
      const maxIdx = nums.reduce((max, m) => {
        const n = parseInt(m.replace(/\D/g, ''), 10);
        return n > max ? n : max;
      }, 0);
      // Build placeholder param keys like ["params.name", "params.param2", ...]
      const existing = editorData.aisensyParamKeys ?? [];
      const filled = Array.from({ length: maxIdx }, (_, i) => existing[i] ?? `params.param${i + 1}`);
      setEditorData(p => ({ ...p, aisensyParamKeys: filled }));
      toast({ title: `Detected ${maxIdx} AiSensy param(s) ({{1}}…{{${maxIdx || 1}}})` });
      return;
    }
    // Email — detect {{params.x}} style
    const matches = editorData.content.match(/\{\{params\.[a-zA-Z_]+\}\}/g) ?? [];
    const subjectMatches = (editorData.subject ?? '').match(/\{\{params\.[a-zA-Z_]+\}\}/g) ?? [];
    const unique = [...new Set([...matches, ...subjectMatches])].map(m => m.replace(/\{\{|\}\}/g, ''));
    setEditorData(p => ({ ...p, variables: unique }));
    toast({ title: `Detected ${unique.length} variable(s)` });
  };

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return templates.filter(t =>
      t.name.toLowerCase().includes(term) ||
      t.key.toLowerCase().includes(term) ||
      t.category.toLowerCase().includes(term) ||
      (t.subCategory ?? '').toLowerCase().includes(term) ||
      (t.aisensyCampaignName ?? '').toLowerCase().includes(term)
    );
  }, [templates, searchTerm]);

  const grouped = useMemo(() => {
    return filtered.reduce((acc, t) => {
      const category = t.category || 'other';
      const subCategory = t.subCategory ?? (t.key.startsWith('legacy_') ? 'legacy' : 'current');
      acc[category] = acc[category] || {};
      acc[category][subCategory] = acc[category][subCategory] || [];
      acc[category][subCategory].push(t);
      return acc;
    }, {} as Record<string, Record<string, NotificationTemplate[]>>);
  }, [filtered]);

  // ─────────────────────────────────────────────────────────────────────────

  const selectedTemplate = templates.find(t => t.key === selectedKey);
  const hasSelection = isNewMode || !!selectedKey;

  return (
    <Tabs value={activeMainTab} onValueChange={(v) => setActiveMainTab(v as 'templates' | 'integration')} className="h-full flex flex-col">
      <div className="mb-3">
        <TabsList className="w-fit">
          <TabsTrigger value="templates" className="text-xs font-bold uppercase tracking-widest">Templates</TabsTrigger>
          <TabsTrigger value="integration" className="text-xs font-bold uppercase tracking-widest">Integration</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="templates" className="m-0 flex-1 overflow-hidden">
    <div className="flex gap-0 h-full overflow-hidden rounded-2xl border shadow-sm bg-background">

      {/* ── LEFT: Template List ── */}
      <div className="w-72 shrink-0 border-r flex flex-col bg-muted/20">
        {/* Header */}
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-widest">Templates</h2>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={load} title="Refresh">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={newTemplate} title="New template">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search…" className="pl-8 h-8 text-xs" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </div>

        {/* List */}
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground space-y-3">
              <Layers className="h-8 w-8 mx-auto opacity-30" />
              <p className="text-xs">No templates yet.</p>
              <Button size="sm" variant="outline" className="text-xs" onClick={handleSeed} disabled={isSeeding}>
                {isSeeding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Database className="h-3.5 w-3.5 mr-1" />}
                Seed Default Templates
              </Button>
            </div>
          ) : (
            <div className="p-2 space-y-4">
              {Object.entries(grouped).map(([cat, subGroups]) => (
                <div key={cat}>
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-2 mb-1">{cat.replace('_', ' ')}</p>
                  {Object.entries(subGroups)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([subCategory, items]) => (
                      <div key={`${cat}-${subCategory}`} className="mb-2">
                        <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/80 px-2 mb-1">
                          {subCategory}
                        </p>
                        <div className="space-y-1">
                          {items.map(t => (
                            <button
                              key={t.key}
                              onClick={() => selectTemplate(t)}
                              className={cn(
                                'w-full text-left px-3 py-2.5 rounded-lg transition-colors group',
                                selectedKey === t.key
                                  ? 'bg-primary text-primary-foreground'
                                  : 'hover:bg-muted'
                              )}
                            >
                              <div className="flex items-center gap-2 mb-0.5">
                                {t.channel === 'email'
                                  ? <Mail className="h-3 w-3 shrink-0 opacity-70" />
                                  : <MessageSquare className="h-3 w-3 shrink-0 opacity-70" />}
                                <span className="text-xs font-bold truncate">{t.name}</span>
                              </div>
                              <div className="flex items-center gap-1.5 ml-5">
                                <code className="text-[9px] opacity-60 truncate">{t.key}</code>
                                {t.channel === 'whatsapp' ? (
                                  t.aisensyCampaignName ? (
                                    <span className="text-[9px] opacity-70 truncate">
                                      · {t.aisensyCampaignName}
                                    </span>
                                  ) : (
                                    <span className="text-[9px] text-destructive font-bold truncate">
                                      · Missing AiSensy
                                    </span>
                                  )
                                ) : null}
                                {!t.active && <Badge variant="secondary" className="text-[8px] px-1 py-0">OFF</Badge>}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              ))}

              {/* Seed button at bottom */}
              <div className="px-2 pt-2 border-t">
                <Button size="sm" variant="outline" className="w-full text-xs h-8 border-dashed" onClick={handleSeed} disabled={isSeeding}>
                  {isSeeding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Database className="h-3.5 w-3.5 mr-1" />}
                  Seed Defaults
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── RIGHT: Editor ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!hasSelection ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <Layers className="h-12 w-12 opacity-20" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Select a template to edit</p>
              <p className="text-xs opacity-60">or create a new one</p>
            </div>
            <Button variant="outline" onClick={newTemplate}><Plus className="mr-2 h-4 w-4" /> New Template</Button>
          </div>
        ) : (
          <>
            {/* Editor Header */}
            <div className="border-b px-6 py-3 flex items-center justify-between shrink-0 bg-background">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-sm font-black uppercase tracking-tight">
                    {isNewMode ? 'New Template' : editorData.name}
                  </p>
                  {!isNewMode && <code className="text-[10px] text-muted-foreground">{editorData.key}</code>}
                  {editorData.channel === 'whatsapp' ? (
                    <p className={cn(
                      'text-[10px] font-mono mt-1',
                      editorData.aisensyCampaignName ? 'text-muted-foreground' : 'text-destructive font-bold'
                    )}>
                      AiSensy: {editorData.aisensyCampaignName || 'Missing campaign name'}
                    </p>
                  ) : null}
                </div>
                {!isNewMode && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn('text-[9px] font-bold uppercase', CATEGORY_COLORS[editorData.category] || 'bg-gray-100')}>
                      {editorData.category.replace('_', ' ')}
                    </Badge>
                    <Badge variant="secondary" className="text-[9px] font-bold uppercase">
                      {editorData.subCategory ?? (editorData.key.startsWith('legacy_') ? 'legacy' : 'current')}
                    </Badge>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isNewMode && selectedKey && (
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-8 px-3 text-xs"
                    onClick={() => setDeleteKey(selectedKey)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                  </Button>
                )}
                <Button size="sm" className="h-8 px-4 text-xs font-bold uppercase tracking-widest"
                  onClick={handleSave} disabled={isSaving}>
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Save
                </Button>
              </div>
            </div>

            {/* Editor Tabs */}
            <Tabs value={activeEditorTab} onValueChange={v => setActiveEditorTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="mx-6 mt-3 mb-0 shrink-0 w-fit bg-muted/50">
                <TabsTrigger value="edit" className="text-xs font-bold uppercase tracking-widest gap-1.5 px-4">
                  <Code2 className="h-3.5 w-3.5" /> Edit
                </TabsTrigger>
                <TabsTrigger value="preview" className="text-xs font-bold uppercase tracking-widest gap-1.5 px-4" disabled={editorData.channel !== 'email' || !!(editorData.brevoTemplateId && editorData.brevoTemplateId > 0)}>
                  <Eye className="h-3.5 w-3.5" /> Preview
                </TabsTrigger>
                <TabsTrigger value="test" className="text-xs font-bold uppercase tracking-widest gap-1.5 px-4">
                  <TestTube2 className="h-3.5 w-3.5" /> Test Send
                </TabsTrigger>
              </TabsList>

              {/* ── EDIT TAB ── */}
              <TabsContent value="edit" className="flex-1 overflow-hidden m-0">
                <ScrollArea className="h-full">
                  <div className="p-6 space-y-6">

                    {/* Meta row */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-black uppercase tracking-widest">Template Key*</Label>
                        <Input
                          value={editorData.key}
                          onChange={e => setEditorData(p => ({ ...p, key: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                          placeholder="e.g. invoice_email"
                          className="font-mono text-sm h-9"
                          disabled={!isNewMode}
                        />
                        {isNewMode && <p className="text-[9px] text-muted-foreground">Lowercase, underscores only. Cannot be changed after creation.</p>}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-black uppercase tracking-widest">Display Name*</Label>
                        <Input
                          value={editorData.name}
                          onChange={e => setEditorData(p => ({ ...p, name: e.target.value }))}
                          placeholder="e.g. Invoice Email"
                          className="h-9"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-black uppercase tracking-widest">Channel</Label>
                        <Select value={editorData.channel} onValueChange={v => setEditorData(p => ({ ...p, channel: v as any }))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="email"><span className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" />Email</span></SelectItem>
                            <SelectItem value="whatsapp"><span className="flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5" />WhatsApp</span></SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-black uppercase tracking-widest">Category</Label>
                        <Select value={editorData.category} onValueChange={v => setEditorData(p => ({ ...p, category: v }))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-black uppercase tracking-widest">Sub Category</Label>
                        <Select value={editorData.subCategory ?? 'current'} onValueChange={v => setEditorData(p => ({ ...p, subCategory: v }))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SUB_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end pb-1 gap-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest mb-2">Active</Label>
                        <Switch checked={editorData.active} onCheckedChange={v => setEditorData(p => ({ ...p, active: v }))} />
                      </div>
                    </div>

                    {/* Unified provider fields (simple mode) */}
                    <div className="grid grid-cols-2 gap-4 p-4 rounded-xl border bg-muted/20">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-black uppercase tracking-widest">Email Template ID (BergTechno)</Label>
                        <Input
                          type="number"
                          value={editorData.brevoTemplateId ?? ''}
                          onChange={e => setEditorData(p => ({
                            ...p,
                            brevoTemplateId: e.target.value ? Number(e.target.value) : null,
                          }))}
                          placeholder="e.g. 199"
                          className="h-9 font-mono text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-black uppercase tracking-widest">WhatsApp Campaign Name (AiSensy)</Label>
                        <Input
                          value={editorData.aisensyCampaignName ?? ''}
                          onChange={e => setEditorData(p => ({ ...p, aisensyCampaignName: e.target.value }))}
                          placeholder="e.g. bmregconf"
                          className="h-9 font-mono text-sm"
                        />
                      </div>
                      <div className="space-y-1.5 col-span-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest">Subject (optional)</Label>
                        <Input
                          value={editorData.subject ?? ''}
                          onChange={e => setEditorData(p => ({ ...p, subject: e.target.value }))}
                          placeholder="Optional, mostly for raw HTML fallback"
                          className="h-9 font-mono text-sm"
                        />
                        <p className="text-[9px] text-muted-foreground">
                          Keep only one reference based on channel: Email → BergTechno template ID, WhatsApp → AiSensy campaign name.
                        </p>
                      </div>
                    </div>

                    <details className="rounded-xl border bg-muted/10 p-4">
                      <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                        Advanced (optional fallback content)
                      </summary>
                      <div className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-black uppercase tracking-widest">HTML/Text Content (optional)</Label>
                            <span className="text-[9px] text-muted-foreground">Use {'{{params.name}}'}, {'{{params.event_name}}'}, etc.</span>
                          </div>
                          <Textarea
                            value={editorData.content}
                            onChange={e => setEditorData(p => ({ ...p, content: e.target.value }))}
                            rows={8}
                            placeholder="Optional fallback content"
                            className="font-mono text-xs leading-relaxed resize-none"
                          />
                        </div>

                        <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                              <Variable className="h-3.5 w-3.5" /> Variables (optional)
                            </Label>
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 font-bold uppercase" onClick={autoDetectVariables}>
                              Auto-detect
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-1.5 min-h-6">
                            {(editorData.variables ?? []).map(v => (
                              <Badge key={v} variant="secondary" className="text-[9px] font-mono gap-1 pr-1">
                                {v}
                                <button
                                  className="hover:text-destructive ml-0.5"
                                  onClick={() => setEditorData(p => ({ ...p, variables: p.variables.filter(x => x !== v) }))}
                                >×</button>
                              </Badge>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <Input
                              value={variableInput}
                              onChange={e => setVariableInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && variableInput.trim()) {
                                  const v = variableInput.trim().startsWith('params.') ? variableInput.trim() : `params.${variableInput.trim()}`;
                                  setEditorData(p => ({ ...p, variables: [...new Set([...p.variables, v])] }));
                                  setVariableInput('');
                                }
                              }}
                              placeholder="params.name → Enter"
                              className="h-7 text-xs font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    </details>

                    {/* Version info */}
                    {selectedTemplate && (
                      <p className="text-[9px] text-muted-foreground">
                        Version {selectedTemplate.version} · Updated {selectedTemplate.updatedAt ? format(new Date(selectedTemplate.updatedAt), 'MMM dd, yyyy HH:mm') : '—'}
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* ── PREVIEW TAB ── */}
              <TabsContent value="preview" className="flex-1 overflow-hidden m-0 flex flex-col">
                {editorData.channel === 'email' && editorData.brevoTemplateId ? (
                  <div className="p-6">
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                      Preview is not available for provider dynamic template IDs.
                    </div>
                  </div>
                ) : null}
                <div className="px-6 py-3 border-b bg-muted/20 shrink-0 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Subject Preview</p>
                    <p className="text-sm font-bold">{previewSubject || '—'}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handlePreview} disabled={isPreviewLoading}>
                    {isPreviewLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    Refresh
                  </Button>
                </div>
                <div className="flex-1 relative bg-gray-50">
                  {isPreviewLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <iframe
                      ref={previewRef}
                      className="w-full h-full border-0"
                      sandbox="allow-same-origin"
                      title="Email Preview"
                    />
                  )}
                </div>
                <div className="px-6 py-2 border-t bg-muted/10 shrink-0">
                  <p className="text-[9px] text-muted-foreground">Rendered with sample params · Not the actual send</p>
                </div>
              </TabsContent>

              {/* ── TEST SEND TAB ── */}
              <TabsContent value="test" className="flex-1 overflow-auto m-0">
                <div className="p-6 space-y-6 max-w-lg">
                  <Card className="border-none shadow-none bg-muted/20">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                        <TestTube2 className="h-4 w-4 text-primary" /> Test Send
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Sends the template with sample params to your specified recipient.
                        {!isNewMode && editorData.key && <span className="font-bold text-foreground"> Template key: <code>{editorData.key}</code></span>}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-black uppercase tracking-widest">
                          {editorData.channel === 'email' ? 'Recipient Email' : 'Recipient Mobile (+91...)'}
                        </Label>
                        <Input
                          value={testTo}
                          onChange={e => setTestTo(e.target.value)}
                          placeholder={editorData.channel === 'email' ? 'test@email.com' : '+919999999999'}
                          className="h-10"
                        />
                      </div>

                      <Button
                        className="w-full h-11 font-black uppercase tracking-widest"
                        onClick={handleTestSend}
                        disabled={isTestSending || !testTo || isNewMode}
                      >
                        {isTestSending
                          ? <Loader2 className="animate-spin mr-2 h-4 w-4" />
                          : <Send className="mr-2 h-4 w-4" />}
                        {isNewMode ? 'Save template first' : 'Send Test'}
                      </Button>

                      {isNewMode && (
                        <p className="text-[10px] text-muted-foreground text-center">Save the template before sending a test.</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Sample params display */}
                  <Card className="border-none shadow-none bg-muted/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                        <Tag className="h-3.5 w-3.5" /> Sample Params Used
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-[10px] font-mono text-muted-foreground leading-relaxed overflow-auto max-h-48 bg-muted/30 rounded-lg p-3">
                        {JSON.stringify(SAMPLE_PARAMS, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      {/* ── Delete Dialog ── */}
      <AlertDialog open={!!deleteKey} onOpenChange={o => !o && setDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <code className="font-mono bg-muted px-1 rounded">{deleteKey}</code>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
      </TabsContent>

      <TabsContent value="integration" className="m-0 flex-1 overflow-auto">
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-black uppercase tracking-widest">Integration</CardTitle>
            <CardDescription>
              Configure BergTechno API for email delivery. Template numbers remain unchanged (existing `brevoTemplateId` values are still used as provider template IDs).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isIntegrationLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading integration settings...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest">API Base URL *</Label>
                    <Input
                      value={integrationData.apiBaseUrl}
                      onChange={(e) => setIntegrationData((p) => ({ ...p, apiBaseUrl: e.target.value }))}
                      placeholder="https://api.bergtechno.com"
                      className="h-9 font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-widest">API Key {integrationData.hasApiKey ? '(saved)' : '*'}</Label>
                    <Input
                      type="password"
                      value={integrationApiKey}
                      onChange={(e) => setIntegrationApiKey(e.target.value)}
                      placeholder={integrationData.hasApiKey ? `Leave blank to keep ${integrationData.apiKeyMasked}` : 'Enter API key'}
                      className="h-9 font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-widest">API Key Header</Label>
                    <Input
                      value={integrationData.apiKeyHeader}
                      onChange={(e) => setIntegrationData((p) => ({ ...p, apiKeyHeader: e.target.value }))}
                      placeholder="x-api-key"
                      className="h-9 font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Sender Email</Label>
                    <Input
                      value={integrationData.senderEmail}
                      onChange={(e) => setIntegrationData((p) => ({ ...p, senderEmail: e.target.value }))}
                      placeholder="info@bergmantri.com"
                      className="h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Sender Name</Label>
                    <Input
                      value={integrationData.senderName}
                      onChange={(e) => setIntegrationData((p) => ({ ...p, senderName: e.target.value }))}
                      placeholder="Bergman Triathlon"
                      className="h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Template Send Path</Label>
                    <Input
                      value={integrationData.templateSendPath}
                      onChange={(e) => setIntegrationData((p) => ({ ...p, templateSendPath: e.target.value }))}
                      placeholder="/email/send-template"
                      className="h-9 font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Raw Email Send Path</Label>
                    <Input
                      value={integrationData.rawSendPath}
                      onChange={(e) => setIntegrationData((p) => ({ ...p, rawSendPath: e.target.value }))}
                      placeholder="/email/send"
                      className="h-9 font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Timeout (ms)</Label>
                    <Input
                      type="number"
                      value={integrationData.timeoutMs}
                      onChange={(e) => setIntegrationData((p) => ({ ...p, timeoutMs: Number(e.target.value || 15000) }))}
                      className="h-9 font-mono"
                    />
                  </div>
                </div>

                <Separator />

                <div className="flex items-center gap-2">
                  <Button onClick={handleSaveIntegration} disabled={isIntegrationSaving} className="h-9 text-xs font-bold uppercase tracking-widest">
                    {isIntegrationSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                    Save Integration
                  </Button>
                  <Button variant="outline" onClick={loadIntegration} disabled={isIntegrationLoading || isIntegrationSaving} className="h-9 text-xs font-bold uppercase tracking-widest">
                    <RefreshCw className={cn('h-4 w-4 mr-1', isIntegrationLoading && 'animate-spin')} />
                    Reload
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
