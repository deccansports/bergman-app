// src/app/shop/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { getStoreProductsAction } from '@/lib/actions/storeActions';
import type { StoreProduct } from '@/lib/types';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
    ShoppingBag, Search, Filter, ArrowRight, Loader2, Star, 
    ChevronRight, ShoppingCart, Package, Info, ArrowLeft
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { Input } from '@/components/ui/input';
import { cn, isValidImageUrl } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export default function ShopPage() {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    getStoreProductsAction().then(res => {
      if (res.success && res.products) {
        setProducts(res.products.filter(p => p.isActive));
      }
      setIsLoading(false);
    });
  }, []);

  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category));
    return ['all', ...Array.from(cats).sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           p.category.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, selectedCategory]);

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* HERO SECTION */}
      <header className="relative w-full py-16 md:py-24 bg-slate-900 overflow-hidden text-left">
        <div className="absolute inset-0 opacity-20">
            <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary rounded-full blur-[120px]"></div>
            <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-orange-600 rounded-full blur-[120px]"></div>
        </div>
        <div className="container px-4 md:px-6 relative z-10">
          <div className="max-w-3xl space-y-4">
            <Badge variant="outline" className="text-orange-500 border-orange-500/30 font-black uppercase tracking-[0.2em] px-3 py-1">
                Official Merchandise
            </Badge>
            <h1 className="text-4xl md:text-7xl font-black uppercase italic tracking-tighter text-white leading-none">
                Rep The <span className="text-orange-500">Spirit.</span>
            </h1>
            <p className="text-lg md:text-xl text-slate-300 font-medium max-w-xl leading-relaxed">
                High-performance gear designed for the Bergman endurance community. Every mile counts.
            </p>
          </div>
        </div>
      </header>

      <div className="container px-4 md:px-6 -mt-8 relative z-20">
        {/* FILTERS BAR */}
        <Card className="border-none shadow-2xl rounded-2xl overflow-hidden mb-12">
            <CardContent className="p-4 md:p-6 bg-card">
                <div className="flex flex-col lg:flex-row gap-6 items-center">
                    <div className="relative w-full lg:flex-grow">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input 
                            placeholder="Search catalog (e.g. Jersey, Bag)..." 
                            className="pl-10 h-12 rounded-xl bg-muted/30 border-none font-bold placeholder:font-normal"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    
                    <div className="flex flex-wrap gap-2 w-full lg:w-auto items-center">
                        <Filter className="h-4 w-4 text-muted-foreground mr-2 hidden sm:block" />
                        {categories.map(cat => (
                            <Button 
                                key={cat}
                                variant={selectedCategory === cat ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setSelectedCategory(cat)}
                                className={cn(
                                    "rounded-xl font-bold uppercase text-[10px] tracking-widest h-9 px-4 transition-all",
                                    selectedCategory === cat ? "bg-primary text-white border-none shadow-lg shadow-primary/20" : "bg-background border-muted hover:border-primary/30"
                                )}
                            >
                                {cat}
                            </Button>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>

        {/* PRODUCT GRID */}
        {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                {[...Array(8)].map((_, i) => (
                    <Card key={i} className="border-none shadow-lg animate-pulse overflow-hidden rounded-2xl">
                        <div className="aspect-[4/5] bg-muted" />
                        <CardHeader className="space-y-2"><div className="h-4 w-1/2 bg-muted rounded" /><div className="h-6 w-3/4 bg-muted rounded" /></CardHeader>
                    </Card>
                ))}
            </div>
        ) : filteredProducts.length === 0 ? (
            <div className="text-center py-24 space-y-6">
                <div className="h-20 w-20 bg-muted rounded-full flex items-center justify-center mx-auto opacity-50">
                    <ShoppingCart className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="text-2xl font-black uppercase italic tracking-tight">No gear found</h3>
                <p className="text-muted-foreground max-w-xs mx-auto">We couldn&apos;t find any products matching your current filters.</p>
                <Button variant="outline" onClick={() => { setSearchTerm(''); setSelectedCategory('all'); }} className="rounded-xl font-black uppercase tracking-widest">Clear Filters</Button>
            </div>
        ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                {filteredProducts.map((p) => {
                    const mainImage = p.images?.[0];
                    const variants = p.variants || [];
                    const sortedBySale = [...variants].sort((a, b) => a.salePrice - b.salePrice);
                    const cheapestVariant = sortedBySale[0];
                    const lowestPrice = cheapestVariant?.salePrice || 0;
                    const lowestMrp = cheapestVariant?.mrp || 0;
                    const hasDiscount = lowestMrp > lowestPrice;
                    const discountPct = hasDiscount ? Math.round(((lowestMrp - lowestPrice) / lowestMrp) * 100) : 0;
                    const isOutOfStock = p.variants?.every(v => v.stock <= 0);

                    return (
                        <motion.div
                            key={p.id}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5 }}
                        >
                            <Link href={`/shop/${p.slug}`}>
                                <Card className="group h-full border-none shadow-xl hover:shadow-2xl transition-all duration-500 rounded-3xl overflow-hidden flex flex-col bg-card relative">
                                    <div className="relative aspect-[4/5] overflow-hidden bg-muted">
                                        {p.isBestseller && (
                                            <Badge className="absolute top-4 left-4 z-10 bg-amber-500 text-white font-black uppercase text-[10px] tracking-widest py-1 border-none shadow-lg">
                                                <Star className="mr-1 h-3 w-3 fill-white" /> Bestseller
                                            </Badge>
                                        )}
                                        {isOutOfStock && (
                                            <div className="absolute inset-0 z-20 bg-background/60 backdrop-blur-sm flex items-center justify-center">
                                                <Badge variant="destructive" className="font-black uppercase text-sm px-4 py-1.5">Out of Stock</Badge>
                                            </div>
                                        )}
                                        {isValidImageUrl(mainImage) ? (
                                            <Image 
                                                src={mainImage} 
                                                alt={p.name} 
                                                fill 
                                                sizes="(max-width: 768px) 100vw, 300px"
                                                className="object-cover transition-transform duration-700 group-hover:scale-110" 
                                            />
                                        ) : (
                                            <div className="h-full w-full flex items-center justify-center"><Package className="h-12 w-12 text-muted-foreground/30" /></div>
                                        )}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                    </div>
                                    
                                    <CardContent className="p-6 flex-grow text-left flex flex-col justify-between">
                                        <div className="text-left space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-primary">{p.category}</p>
                                            <h3 className="font-black text-lg uppercase tracking-tight leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                                                {p.name}
                                            </h3>
                                        </div>
                                        
                                        <div className="mt-6 flex items-center justify-between">
                                            <div className="text-left">
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase leading-none">Starting from</p>
                                                                                                <p className="text-2xl font-black text-foreground italic tracking-tighter">₹{lowestPrice.toLocaleString()}</p>
                                                                                                {hasDiscount ? (
                                                                                                    <div className="mt-1 flex items-center gap-2 text-xs leading-none">
                                                                                                        <span className="text-muted-foreground line-through font-bold">₹{lowestMrp.toLocaleString()}</span>
                                                                                                        <span className="text-emerald-700 font-black">{discountPct}% OFF</span>
                                                                                                    </div>
                                                                                                ) : null}
                                            </div>
                                            <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all duration-300">
                                                <ArrowRight className="h-5 w-5" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        </motion.div>
                    );
                })}
            </div>
        )}
      </div>
    </div>
  );
}
