// src/components/admin/StoreInventoryTab.tsx
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { 
  getStoreProductsAction, 
  saveStoreProductAction, 
  deleteStoreProductAction,
  getStoreCouponsAction,
  saveStoreCouponAction,
  deleteStoreCouponAction,
  getStoreSettingsAction,
  saveStoreSettingsAction,
  updateStoreProductOrderAction
} from '@/lib/actions/storeActions';
import type { StoreProduct, ProductVariant, StoreCoupon, StoreSettings } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Package, Tag, Settings, Plus, Trash2, Edit, Image as ImageIcon, X, Save, Upload, ArrowUp, ArrowDown, Star, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Image from 'next/image';
import { cn, isValidImageUrl } from '@/lib/utils';

export default function StoreInventoryTab() {
  const { toast } = useToast();
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [coupons, setCoupons] = useState<StoreCoupon[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Modals
  const [productModal, setProductModal] = useState<{ open: boolean; item: Partial<StoreProduct> | null }>({ open: false, item: null });
  const [couponModal, setCouponModal] = useState<{ open: boolean; item: Partial<StoreCoupon> | null }>({ open: false, item: null });
  const [viewStockModal, setViewStockModal] = useState<{ open: boolean; item: StoreProduct | null }>({ open: false, item: null });
  
  const [imageUrlInput, setImageUrlInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes, sRes] = await Promise.all([
        getStoreProductsAction(),
        getStoreCouponsAction(),
        getStoreSettingsAction()
      ]);
      if (pRes && pRes.success) {
          setProducts(pRes.products || []);
      } else if (pRes) {
          toast({ variant: 'destructive', title: 'Catalog Error', description: pRes.message || 'Failed to fetch products.' });
      }

      if (cRes && cRes.success) setCoupons(cRes.coupons || []);
      if (sRes && sRes.success) {
          const settingsData = sRes.settings as any;
          setSettings(settingsData ? {
              minAmountFreeShipping: settingsData.minAmountFreeShipping || 2499,
              standardShipping: settingsData.standardShipping || 150
          } : { minAmountFreeShipping: 2499, standardShipping: 150 });
      }
      
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Load Error', description: 'Failed to synchronize store data.' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleProductSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productModal.item?.name || !productModal.item?.variants?.length) {
        toast({ variant: 'destructive', title: 'Error', description: 'Name and at least one Variant are required.' });
        return;
    }
    setIsSubmitting(true);
    try {
      const res = await saveStoreProductAction(productModal.item?.id || null, productModal.item!);
      if (res && res.success) {
        toast({ title: "Success", description: "Product catalog updated." });
        setProductModal({ open: false, item: null });
        loadData();
      } else {
        toast({ variant: "destructive", title: "Error", description: res?.message || "Failed to save product." });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message || "An unexpected error occurred." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCouponSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponModal.item?.code || !couponModal.item?.value) {
        toast({ variant: 'destructive', title: 'Error', description: 'Code and Value are required.' });
        return;
    }
    setIsSubmitting(true);
    try {
      const res = await saveStoreCouponAction(couponModal.item?.id || null, couponModal.item!);
      if (res && res.success) {
        toast({ title: "Success", description: "Coupon saved." });
        setCouponModal({ open: false, item: null });
        loadData();
      } else {
        toast({ variant: "destructive", title: "Error", description: res?.message || "Failed to save coupon." });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message || "An unexpected error occurred." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFilesUpload = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const uploadedUrls: string[] = [];
    let errorCount = 0;

    for (const file of Array.from(files)) {
      if (file.size > 2 * 1024 * 1024) {
        toast({ variant: 'destructive', title: `File ${file.name} too large`, description: 'Maximum file size is 2MB.' });
        errorCount++;
        continue;
      }

      try {
        const storageRef = ref(storage, `store-products/${productModal.item?.id || 'temp'}/${Date.now()}-${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        const url = await getDownloadURL(snapshot.ref);
        uploadedUrls.push(url);
      } catch (error: any) {
        console.error("Upload error:", error);
        errorCount++;
      }
    }

    if (uploadedUrls.length > 0) {
      const currentImages = productModal.item?.images || [];
      setProductModal({
        ...productModal,
        item: { ...productModal.item!, images: [...currentImages, ...uploadedUrls] }
      });
      toast({ title: `${uploadedUrls.length} image(s) uploaded.` });
    }

    if (errorCount > 0) {
      toast({ variant: 'destructive', title: "Some uploads failed", description: `${errorCount} files could not be uploaded.` });
    }

    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFilesUpload(e.dataTransfer.files);
    }
  };

  const handleProductDelete = async (id: string) => {
    try {
      const res = await deleteStoreProductAction(id);
      if (res && res.success) {
        setProducts(prev => prev.filter(p => p.id !== id));
        toast({ title: "Deleted" });
      } else {
        toast({ variant: 'destructive', title: 'Delete Failed', description: res?.message });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    }
  };

  const handleCouponDelete = async (id: string) => {
    try {
      const res = await deleteStoreCouponAction(id);
      if (res && res.success) {
        setCoupons(prev => prev.filter(c => c.id !== id));
        toast({ title: "Deleted" });
      } else {
        toast({ variant: 'destructive', title: 'Delete Failed', description: res?.message });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    }
  };

  const handleMoveProduct = (index: number, direction: 'up' | 'down') => {
    const newProducts = [...products];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= newProducts.length) return;
    
    const temp = newProducts[index];
    newProducts[index] = newProducts[newIndex];
    newProducts[newIndex] = temp;
    
    setProducts(newProducts);
  };

  const handleSaveOrder = async () => {
    setIsSubmitting(true);
    const orderData = products.map((p, i) => ({ id: p.id, order: i + 1 }));
    try {
      const res = await updateStoreProductOrderAction(orderData);
      if (res.success) {
        toast({ title: "Display order saved." });
      } else {
        toast({ variant: 'destructive', title: 'Error', description: res.message });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const addVariant = () => {
    const currentVariants = productModal.item?.variants || [];
    const newVariant: ProductVariant = {
        size: '',
        mrp: 0,
        salePrice: 0,
        stock: 0,
        sku: ''
    };
    setProductModal({
        ...productModal,
        item: { ...productModal.item!, variants: [...currentVariants, newVariant] }
    });
  };

  const updateVariant = (index: number, field: keyof ProductVariant, value: any) => {
    const currentVariants = [...(productModal.item?.variants || [])];
    currentVariants[index] = { ...currentVariants[index], [field]: value };
    setProductModal({
        ...productModal,
        item: { ...productModal.item!, variants: currentVariants }
    });
  };

  const removeVariant = (index: number) => {
    const currentVariants = productModal.item?.variants || [];
    setProductModal({
        ...productModal,
        item: { ...productModal.item!, variants: currentVariants.filter((_, i) => i !== index) }
    });
  };

  const addImageUrl = () => {
    if (!imageUrlInput.trim()) return;
    const currentImages = productModal.item?.images || [];
    setProductModal({
        ...productModal,
        item: { ...productModal.item!, images: [...currentImages, imageUrlInput.trim()] }
    });
    setImageUrlInput('');
  };

  const removeImageUrl = (index: number) => {
    const currentImages = productModal.item?.images || [];
    setProductModal({
        ...productModal,
        item: { ...productModal.item!, images: currentImages.filter((_, i) => i !== index) }
    });
  };

  const handleSettingsSave = async () => {
    if (!settings) return;
    setIsSubmitting(true);
    try {
      const res = await saveStoreSettingsAction(settings);
      if (res && res.success) {
        toast({ title: "Settings Saved" });
      } else {
        toast({ variant: 'destructive', title: 'Save Failed', description: res?.message });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div>;

  return (
    <Tabs defaultValue="products" className="space-y-6 text-left">
      <TabsList className="bg-muted/50 p-1">
        <TabsTrigger value="products"><Package className="mr-2 h-4 w-4"/> Products</TabsTrigger>
        <TabsTrigger value="coupons"><Tag className="mr-2 h-4 w-4"/> Coupons</TabsTrigger>
        <TabsTrigger value="settings"><Settings className="mr-2 h-4 w-4"/> Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="products">
        <Card>
          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <CardTitle>Product Catalog</CardTitle>
              <CardDescription>Manage Bergman store inventory, pricing, and variants.</CardDescription>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")}/> Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleSaveOrder} disabled={isSubmitting}>
                <Save className="mr-2 h-4 w-4"/> Save Order
              </Button>
              <Button onClick={() => setProductModal({ open: true, item: { isActive: true, images: [], category: 'Apparel', variants: [], gstPercent: 12, order: products.length + 1 } })}>
                <Plus className="mr-2 h-4 w-4"/> Add Product
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Order</TableHead>
                    <TableHead>Preview</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Variants</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>HSN/GST</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground italic">No products found.</TableCell></TableRow>
                  ) : products.map((p, index) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" disabled={index === 0} onClick={() => handleMoveProduct(index, 'up')}>
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" disabled={index === products.length - 1} onClick={() => handleMoveProduct(index, 'down')}>
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="relative h-10 w-10 rounded overflow-hidden bg-muted border">
                          {p.images?.[0] ? (
                            <Image 
                              src={p.images[0]} 
                              alt={p.name} 
                              fill 
                              sizes="40px"
                              className="object-cover" 
                            />
                          ) : (
                            <ImageIcon className="h-full w-full p-2 text-muted-foreground" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="font-bold text-sm uppercase tracking-tight">{p.name}</div>
                          {p.isBestseller && <Badge className="bg-amber-500 hover:bg-amber-600 text-[8px] h-4 px-1.5 uppercase font-black"><Star className="mr-1 h-2 w-2 fill-white"/>Best</Badge>}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">{p.category}</div>
                      </TableCell>
                      <TableCell>
                        <button 
                          onClick={() => setViewStockModal({ open: true, item: p })}
                          className="flex flex-wrap gap-1 hover:opacity-80 transition-opacity text-left"
                          title="Click to view detailed stock"
                        >
                          {p.variants?.map((v: ProductVariant) => (
                            <Badge key={v.size} variant="outline" className="text-[10px] uppercase cursor-pointer hover:bg-muted">{v.size}</Badge>
                          ))}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {p.variants?.reduce((acc: number, v: ProductVariant) => acc + v.stock, 0)} units
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[10px] font-mono">
                        HSN: {p.hsnCode}<br />
                        GST: {p.gstPercent}%
                      </TableCell>
                      <TableCell>
                        <Switch checked={p.isActive} disabled />
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setProductModal({ open: true, item: p })}><Edit className="h-4 w-4"/></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4"/></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete product?</AlertDialogTitle>
                              <AlertDialogDescription>This will permanently remove the product from your store.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleProductDelete(p.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <Dialog open={viewStockModal.open} onOpenChange={(o) => !o && setViewStockModal({ open: false, item: null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Stock Availability: {viewStockModal.item?.name}</DialogTitle>
            <DialogDescription>Current stock levels across all variants.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Size</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewStockModal.item?.variants?.map((v: ProductVariant) => (
                  <TableRow key={v.size}>
                    <TableCell className="font-bold uppercase">{v.size}</TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">{v.sku || 'N/A'}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={v.stock > 0 ? (v.stock <= 5 ? "secondary" : "default") : "destructive"}>
                        {v.stock} units
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TabsContent value="coupons">
        <Card>
          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <CardTitle>Store Coupons</CardTitle>
              <CardDescription>Manage discount codes for the Bergman store.</CardDescription>
            </div>
            <Button onClick={() => setCouponModal({ open: true, item: { isActive: true, type: 'percentage', value: 0, usageLimit: 100 } })}>
              <Plus className="mr-2 h-4 w-4"/> Add Coupon
            </Button>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Used</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coupons.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground italic">No coupons found.</TableCell></TableRow>
                  ) : coupons.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-bold font-mono">{c.code}</TableCell>
                      <TableCell className="capitalize">{c.type}</TableCell>
                      <TableCell>{c.type === 'percentage' ? `${c.value}%` : `₹${c.value}`}</TableCell>
                      <TableCell>{c.usedCount} / {c.usageLimit}</TableCell>
                      <TableCell><Badge variant={c.isActive ? 'default' : 'secondary'}>{c.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCouponModal({ open: true, item: c })}><Edit className="h-4 w-4"/></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4"/></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete coupon?</AlertDialogTitle>
                              <AlertDialogDescription>This will remove the coupon code from your store.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleCouponDelete(c.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <Dialog open={productModal.open} onOpenChange={(o) => !o && setProductModal({ open: false, item: null })}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>{productModal.item?.id ? 'Edit' : 'Add'} Product</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-4 -mr-4">
            <form onSubmit={handleProductSave} className="space-y-6 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 text-left">
                  <Label className="text-xs font-bold uppercase">Product Name</Label>
                  <Input required value={productModal.item?.name || ''} onChange={e => setProductModal({ ...productModal, item: { ...productModal.item!, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })} />
                </div>
                <div className="space-y-2 text-left">
                  <Label className="text-xs font-bold uppercase">Category</Label>
                  <Input value={productModal.item?.category || ''} onChange={e => setProductModal({ ...productModal, item: { ...productModal.item!, category: e.target.value } })} placeholder="e.g., Apparel, Equipment" />
                </div>
              </div>

              <div className="space-y-2 text-left">
                <Label className="text-xs font-bold uppercase">Description</Label>
                <Textarea 
                  value={productModal.item?.description || ''} 
                  onChange={e => setProductModal({ ...productModal, item: { ...productModal.item!, description: e.target.value } })} 
                  placeholder="Detailed product specifications..."
                  className="min-h-[100px]"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
                <div className="space-y-2 text-left">
                  <Label className="text-xs font-bold uppercase">HSN Code</Label>
                  <Input required value={productModal.item?.hsnCode || ''} onChange={e => setProductModal({ ...productModal, item: { ...productModal.item!, hsnCode: e.target.value } })} />
                </div>
                <div className="space-y-2 text-left">
                  <Label className="text-xs font-bold uppercase">GST %</Label>
                  <Input type="number" required value={productModal.item?.gstPercent || ''} onChange={e => setProductModal({ ...productModal, item: { ...productModal.item!, gstPercent: Number(e.target.value) } })} />
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase">Variants (Sizes & Stock)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addVariant}>
                    <Plus className="mr-2 h-4 w-4"/> Add Size
                  </Button>
                </div>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>Size</TableHead>
                        <TableHead>MRP</TableHead>
                        <TableHead>Sale Price</TableHead>
                        <TableHead>Stock</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productModal.item?.variants?.map((v: ProductVariant, i: number) => (
                        <TableRow key={i}>
                          <TableCell><Input className="h-8 uppercase font-bold" value={v.size} onChange={e => updateVariant(i, 'size', e.target.value)} placeholder="S, M, L..." /></TableCell>
                          <TableCell><Input type="number" className="h-8" value={v.mrp || ''} onChange={e => updateVariant(i, 'mrp', Number(e.target.value))} placeholder="₹" /></TableCell>
                          <TableCell><Input type="number" className="h-8" value={v.salePrice || ''} onChange={e => updateVariant(i, 'salePrice', Number(e.target.value))} placeholder="₹" /></TableCell>
                          <TableCell><Input type="number" className="h-8 font-mono" value={v.stock || ''} onChange={e => updateVariant(i, 'stock', Number(e.target.value))} /></TableCell>
                          <TableCell><Input className="h-8 font-mono text-[10px]" value={v.sku} onChange={e => updateVariant(i, 'sku', e.target.value)} placeholder="SKU-001" /></TableCell>
                          <TableCell>
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeVariant(i)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <Separator />

              <div 
                className={cn(
                    "space-y-4 p-4 border-2 border-dashed rounded-xl transition-colors text-left",
                    isDragging ? "border-primary bg-primary/5" : "border-muted"
                )}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold uppercase">Product Images</Label>
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Drag & Drop supported</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-grow flex gap-2">
                    <Input 
                      placeholder="Paste Image URL..." 
                      value={imageUrlInput} 
                      onChange={e => setImageUrlInput(e.target.value)}
                    />
                    <Button type="button" variant="outline" onClick={addImageUrl}><Plus className="h-4 w-4"/></Button>
                  </div>
                  <div className="relative">
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={(e) => handleFilesUpload(e.target.files!)} 
                        className="hidden" 
                        accept="image/*" 
                        multiple 
                    />
                    <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                      {isUploading ? <Loader2 className="animate-spin h-4 w-4 mr-2"/> : <Upload className="h-4 w-4 mr-2"/>} Select Files
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {productModal.item?.images?.map((url: string, i: number) => (
                    <div key={i} className="relative aspect-square rounded-md overflow-hidden border group bg-muted">
                      <Image src={url} alt={`Preview ${i}`} fill sizes="100px" className="object-cover" />
                      <button type="button" onClick={() => removeImageUrl(i)} className="absolute top-0.5 right-0.5 bg-background/80 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 text-left">
                <div className="flex items-center space-x-2">
                  <Switch 
                    id="product-active"
                    checked={productModal.item?.isActive} 
                    onCheckedChange={v => setProductModal({ ...productModal, item: { ...productModal.item!, isActive: v } })} 
                  />
                  <Label htmlFor="product-active" className="text-sm font-bold uppercase">Product is Active</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch 
                    id="product-bestseller"
                    checked={productModal.item?.isBestseller} 
                    onCheckedChange={v => setProductModal({ ...productModal, item: { ...productModal.item!, isBestseller: v } })} 
                  />
                  <Label htmlFor="product-bestseller" className="text-sm font-bold uppercase flex items-center gap-1.5"><Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" /> Bestseller</Label>
                </div>
              </div>
            </form>
          </ScrollArea>
          <DialogFooter className="pt-4 border-t">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button onClick={handleProductSave} disabled={isSubmitting || isUploading}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 mr-2"/> : <Save className="mr-2 h-4 w-4"/>} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={couponModal.open} onOpenChange={(o) => !o && setCouponModal({ open: false, item: null })}>
        <DialogContent>
          <DialogHeader><DialogTitle>{couponModal.item?.id ? 'Edit' : 'Add'} Coupon</DialogTitle></DialogHeader>
          <form onSubmit={handleCouponSave} className="space-y-4 py-4 text-left">
            <div className="space-y-2 text-left">
              <Label className="text-xs font-bold uppercase">Coupon Code</Label>
              <Input required value={couponModal.item?.code || ''} onChange={e => setCouponModal({ ...couponModal, item: { ...couponModal.item!, code: e.target.value.toUpperCase() } })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 text-left">
                <Label className="text-xs font-bold uppercase">Type</Label>
                <Select value={couponModal.item?.type} onValueChange={v => setCouponModal({ ...couponModal, item: { ...couponModal.item!, type: v as any } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                    <SelectItem value="fixed">Fixed (₹)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 text-left">
                <Label className="text-xs font-bold uppercase">Value</Label>
                <Input type="number" required value={couponModal.item?.value || ''} onChange={e => setCouponModal({ ...couponModal, item: { ...couponModal.item!, value: Number(e.target.value) } })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 text-left">
                <Label className="text-xs font-bold uppercase">Min Order Amount (₹)</Label>
                <Input type="number" value={couponModal.item?.minCartValue || ''} onChange={e => setCouponModal({ ...couponModal, item: { ...couponModal.item!, minCartValue: Number(e.target.value) } })} />
              </div>
              <div className="space-y-2 text-left">
                <Label className="text-xs font-bold uppercase">Usage Limit</Label>
                <Input type="number" value={couponModal.item?.usageLimit || ''} onChange={e => setCouponModal({ ...couponModal, item: { ...couponModal.item!, usageLimit: Number(e.target.value) } })} />
              </div>
            </div>
            <div className="flex items-center space-x-2 pt-2 text-left">
              <Switch checked={couponModal.item?.isActive} onCheckedChange={v => setCouponModal({ ...couponModal, item: { ...couponModal.item!, isActive: v } })} />
              <Label className="text-sm font-bold uppercase">Coupon is Active</Label>
            </div>
            <DialogFooter className="pt-4">
              <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
              <Button type="submit" disabled={isSubmitting}>Save Coupon</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TabsContent value="settings">
        <Card>
          <CardHeader><CardTitle>Store & Shipping Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2 text-left">
                <Label className="text-xs font-bold uppercase">Standard Shipping Fee (₹)</Label>
                <Input type="number" value={settings?.standardShipping || 0} onChange={e => setSettings((prev: StoreSettings | null) => ({ ...prev!, standardShipping: Number(e.target.value) }))} />
                <p className="text-[10px] text-muted-foreground">Standard delivery time: 5 to 10 working days.</p>
              </div>
              <div className="space-y-2 text-left">
                <Label className="text-xs font-bold uppercase">Free Shipping Above (Subtotal ₹)</Label>
                <Input type="number" value={settings?.minAmountFreeShipping || 0} onChange={e => setSettings((prev: StoreSettings | null) => ({ ...prev!, minAmountFreeShipping: Number(e.target.value) }))} />
              </div>
            </div>
            <Button onClick={handleSettingsSave} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <Save className="mr-2 h-4 w-4" />}
              Save Configuration
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
