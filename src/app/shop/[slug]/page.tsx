// src/app/shop/[slug]/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCart } from '@/context/StoreCartContext';
import { getStoreProductBySlugAction } from '@/lib/actions/storeActions';
import type { StoreProduct, ProductVariant } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { 
    Loader2, ShoppingBag, ArrowLeft, Star, ShieldCheck, 
    Package, Ruler, Truck, RotateCcw, CheckCircle2,
    IndianRupee, Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import Image from 'next/image';
import { cn, isValidImageUrl } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ProductDetailPage() {
  const { slug } = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { addToCart } = useCart();

  const [product, setProducts] = useState<StoreProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (slug) {
      getStoreProductBySlugAction(slug as string).then(res => {
        if (res.success && res.product) {
          setProducts(res.product);
          // Auto-select first available size
          const available = res.product.variants?.find((v: ProductVariant) => v.stock > 0);
          if (available) setSelectedSize(available.size);
        } else {
          toast({ variant: 'destructive', title: 'Product Not Found', description: res.message });
          router.push('/shop');
        }
        setLoading(false);
      });
    }
  }, [slug, router, toast]);

  const activeVariant = useMemo(() => 
    product?.variants?.find(v => v.size === selectedSize),
  [product, selectedSize]);

  const handleAddToCart = () => {
    if (!product || !activeVariant) {
        toast({ variant: 'destructive', description: "Please select a size first." });
        return;
    }
    
    setIsAdding(true);
    addToCart({
      productId: product.id,
      name: product.name,
      salePrice: activeVariant.salePrice,
      mrp: activeVariant.mrp,
      image: product.images?.[0] || '',
      size: activeVariant.size,
      sku: activeVariant.sku,
      hsnCode: product.hsnCode,
      gstPercent: product.gstPercent
    });

    toast({
      title: "Added to Bag",
      description: `${product.name} (${selectedSize}) is ready for checkout.`,
      action: <Button variant="outline" size="sm" onClick={() => router.push('/cart')}>View Bag</Button>
    });

    setTimeout(() => setIsAdding(false), 500);
  };

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>;
  if (!product) return null;

  const images = product.images?.length > 0 ? product.images : ['https://picsum.photos/seed/shop/1200/1600'];

  return (
    <div className="container mx-auto py-12 px-4 max-w-7xl text-left">
      <Button variant="ghost" onClick={() => router.push('/shop')} className="mb-10 font-bold uppercase text-[10px] tracking-widest text-muted-foreground hover:text-primary">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Shop
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 text-left">
        
        {/* MEDIA SECTION */}
        <div className="lg:col-span-7 space-y-6 text-left">
          <div className="relative aspect-[4/5] rounded-[2.5rem] overflow-hidden bg-muted border shadow-2xl group">
            {product.isBestseller && (
                <Badge className="absolute top-6 left-6 z-10 bg-amber-500 text-white font-black uppercase text-xs tracking-widest py-1.5 px-4 border-none shadow-2xl">
                    <Star className="mr-2 h-4 w-4 fill-white" /> Bergman Selection
                </Badge>
            )}
            <Image 
              src={images[activeImage]} 
              alt={product.name} 
              fill 
              priority
              className="object-cover transition-transform duration-700 group-hover:scale-105" 
            />
          </div>
          
          <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar text-left">
            {images.map((img, i) => (
              <button 
                key={i} 
                onClick={() => setActiveImage(i)}
                className={cn(
                    "relative h-24 w-20 rounded-2xl overflow-hidden border-2 transition-all flex-shrink-0",
                    activeImage === i ? "border-primary ring-4 ring-primary/10" : "border-muted opacity-60 hover:opacity-100"
                )}
              >
                <Image src={img} alt="Product view" fill className="object-cover" />
              </button>
            ))}
          </div>
        </div>

        {/* ACTIONS SECTION */}
        <div className="lg:col-span-5 space-y-10 text-left">
          <div className="space-y-4 text-left">
            <div className="flex items-center gap-3 text-left">
                <Badge variant="secondary" className="bg-primary/5 text-primary border-primary/20 font-black uppercase text-[10px] tracking-widest">Official {product.category}</Badge>
                {activeVariant && activeVariant.stock <= 5 && activeVariant.stock > 0 && (
                    <Badge className="bg-orange-600 font-black text-[9px] uppercase">Filling Fast!</Badge>
                )}
            </div>
            <h1 className="text-4xl md:text-5xl font-black uppercase italic tracking-tighter leading-tight text-left">
                {product.name}
            </h1>
            
            <div className="flex items-baseline gap-4 pt-2 text-left">
                <span className="text-4xl font-black text-primary italic tracking-tighter">
                    ₹{activeVariant?.salePrice || product.variants?.[0]?.salePrice}
                </span>
                {activeVariant?.mrp && activeVariant.mrp > activeVariant.salePrice && (
                    <span className="text-lg text-muted-foreground line-through font-bold">
                        ₹{activeVariant.mrp}
                    </span>
                )}
            </div>
          </div>

          <Separator className="opacity-50" />

          {/* SIZE SELECTION */}
          <div className="space-y-4 text-left">
            <div className="flex justify-between items-center text-left">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 text-left">
                    <Ruler className="h-3.5 w-3.5" /> 1. Select Your Size
                </Label>
                <button className="text-[10px] font-black uppercase text-primary hover:underline underline-offset-4">Size Guide</button>
            </div>
            <div className="flex flex-wrap gap-3 text-left">
              {product.variants?.map((v) => (
                <button
                  key={v.size}
                  disabled={v.stock <= 0}
                  onClick={() => setSelectedSize(v.size)}
                  className={cn(
                    "min-w-[60px] h-12 rounded-xl font-black border-2 transition-all uppercase text-sm",
                    v.stock <= 0 ? "opacity-30 cursor-not-allowed bg-muted border-transparent" :
                    selectedSize === v.size ? "border-orange-600 bg-orange-600 text-white shadow-lg shadow-orange-600/20" : "border-muted hover:border-primary/50"
                  )}
                >
                  {v.size}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 pt-4 text-left">
            <Button 
                onClick={handleAddToCart}
                disabled={!selectedSize || activeVariant?.stock === 0 || isAdding}
                className="w-full h-16 rounded-[1.5rem] bg-orange-600 hover:bg-orange-700 text-white font-black uppercase tracking-widest text-lg shadow-2xl shadow-orange-600/30 group"
            >
                {isAdding ? <Loader2 className="animate-spin h-6 w-6"/> : (
                    <>
                        <ShoppingBag className="mr-3 h-6 w-6 group-hover:scale-110 transition-transform" />
                        {activeVariant?.stock === 0 ? "Out of Stock" : "Add to Gear Bag"}
                    </>
                )}
            </Button>
            
            <div className="grid grid-cols-3 gap-2 text-center pt-2">
                <div className="space-y-1">
                    <div className="mx-auto h-10 w-10 bg-muted/50 rounded-xl flex items-center justify-center"><Truck className="h-5 w-5 text-primary" /></div>
                    <p className="text-[9px] font-black uppercase text-muted-foreground">Global Ship</p>
                </div>
                <div className="space-y-1">
                    <div className="mx-auto h-10 w-10 bg-muted/50 rounded-xl flex items-center justify-center"><RotateCcw className="h-5 w-5 text-primary" /></div>
                    <p className="text-[9px] font-black uppercase text-muted-foreground">Easy Exchange</p>
                </div>
                <div className="space-y-1">
                    <div className="mx-auto h-10 w-10 bg-muted/50 rounded-xl flex items-center justify-center"><ShieldCheck className="h-5 w-5 text-primary" /></div>
                    <p className="text-[9px] font-black uppercase text-muted-foreground">Secure Pay</p>
                </div>
            </div>
          </div>

          <Tabs defaultValue="desc" className="pt-6">
            <TabsList className="bg-muted/50 w-full justify-start p-1 rounded-xl">
                <TabsTrigger value="desc" className="text-[10px] font-black uppercase tracking-widest">Details</TabsTrigger>
                <TabsTrigger value="shipping" className="text-[10px] font-black uppercase tracking-widest">Fulfillment</TabsTrigger>
                <TabsTrigger value="compliance" className="text-[10px] font-black uppercase tracking-widest">Tax info</TabsTrigger>
            </TabsList>
            <TabsContent value="desc" className="pt-4 text-sm text-muted-foreground leading-relaxed whitespace-pre-line font-medium text-left">
                {product.description || "Official Bergman performance product. Built for athletes, tested on the course."}
            </TabsContent>
            <TabsContent value="shipping" className="pt-4 space-y-3 text-left">
                <div className="flex items-start gap-3 text-sm text-left">
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                    <p className="font-medium text-muted-foreground text-left">Dispatched within 5-7 business days via trackable courier partners.</p>
                </div>
                <div className="flex items-start gap-3 text-sm text-left">
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                    <p className="font-medium text-muted-foreground text-left">Exchange available within 7 days for size issues or manufacturing defects.</p>
                </div>
            </TabsContent>
            <TabsContent value="compliance" className="pt-4 text-left">
                <div className="bg-muted/30 p-4 rounded-xl border border-dashed text-left">
                    <div className="flex justify-between text-xs font-bold uppercase tracking-tight text-left">
                        <span className="text-muted-foreground flex items-center gap-2 text-left"><Info className="h-3 w-3"/> HSN Code</span>
                        <span className="text-foreground font-mono text-left">{product.hsnCode}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between text-xs font-bold uppercase tracking-tight text-left">
                        <span className="text-muted-foreground flex items-center gap-2 text-left"><IndianRupee className="h-3 w-3"/> GST Rate</span>
                        <span className="text-foreground text-left">{product.gstPercent}% Included</span>
                    </div>
                </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
