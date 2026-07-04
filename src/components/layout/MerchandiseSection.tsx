// src/components/layout/MerchandiseSection.tsx
"use client";

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import useEmblaCarousel from 'embla-carousel-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShoppingBag, ArrowRight, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import type { StoreProduct } from '@/lib/types';
import { cn, isValidImageUrl } from '@/lib/utils';

interface MerchandiseSectionProps {
  products: StoreProduct[];
}

export default function MerchandiseSection({ products }: MerchandiseSectionProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ 
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true
  });

  const [prevBtnEnabled, setPrevBtnEnabled] = useState(false);
  const [nextBtnEnabled, setNextBtnEnabled] = useState(false);

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);

  const onSelect = useCallback((emblaApi: any) => {
    setPrevBtnEnabled(emblaApi.canScrollPrev());
    setNextBtnEnabled(emblaApi.canScrollNext());
  }, []);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect(emblaApi);
    emblaApi.on('reInit', onSelect);
    emblaApi.on('select', onSelect);
  }, [emblaApi, onSelect]);

  if (!products || products.length === 0) return null;

  return (
    <section className="w-full py-12 md:py-24 bg-background">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col md:flex-row items-end justify-between mb-10 gap-4 text-left">
          <div className="text-left space-y-2">
            <Badge variant="outline" className="text-primary font-black uppercase tracking-widest px-3 py-1 border-primary/20">
              The Gear Shop
            </Badge>
            <h2 className="text-3xl font-black uppercase italic tracking-tighter sm:text-5xl">
              Official Bergman Gear
            </h2>
            <p className="max-w-[600px] text-muted-foreground md:text-lg font-medium">
              Rep the brand. Carry the spirit. High-performance merchandise for every mile.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="icon" 
              className="rounded-full h-10 w-10" 
              onClick={scrollPrev} 
              disabled={!prevBtnEnabled}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button 
              variant="outline" 
              size="icon" 
              className="rounded-full h-10 w-10" 
              onClick={scrollNext} 
              disabled={!nextBtnEnabled}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
            <Button asChild variant="ghost" className="ml-4 font-bold uppercase text-xs tracking-widest group">
              <Link href="/shop" className="flex items-center">
                Full Store <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex gap-6">
            {products.map((p) => {
              const mainImage = p.images?.[0];
              const firstVariant = p.variants?.[0];
              const salePrice = firstVariant?.salePrice || 0;
              const mrp = firstVariant?.mrp || 0;
              const hasDiscount = mrp > salePrice;
              const discountPct = hasDiscount ? Math.round(((mrp - salePrice) / mrp) * 100) : 0;
              return (
                <div key={p.id} className="flex-[0_0_280px] sm:flex-[0_0_320px] min-w-0">
                  <motion.div 
                    whileHover={{ y: -5 }}
                    className="h-full"
                  >
                    <Link href={`/shop/${p.slug}`}>
                      <Card className="border-none shadow-xl overflow-hidden rounded-2xl h-full flex flex-col group bg-card transition-shadow hover:shadow-2xl">
                        <div className="relative aspect-[4/5] overflow-hidden bg-muted">
                          {p.isBestseller && (
                            <Badge className="absolute top-3 left-3 z-10 bg-amber-500 hover:bg-amber-600 text-[10px] font-black uppercase tracking-widest shadow-lg py-1 border-none">
                              <Star className="mr-1 h-3 w-3 fill-white" /> Bestseller
                            </Badge>
                          )}
                          <Image 
                            src={isValidImageUrl(mainImage) ? mainImage : 'https://picsum.photos/seed/shop/600/800'} 
                            alt={p.name} 
                            fill 
                            sizes="(max-width: 768px) 100vw, 320px"
                            className="object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        </div>
                        <CardContent className="p-5 flex flex-col flex-grow text-left">
                          <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-1">{p.category}</p>
                          <h3 className="font-bold text-base leading-tight line-clamp-2 mb-4 group-hover:text-primary transition-colors">
                            {p.name}
                          </h3>
                          <div className="mt-auto flex items-center justify-between">
                            <div className="flex flex-col items-start leading-tight">
                              <span className="text-xl font-black">₹{salePrice.toLocaleString()}</span>
                              {hasDiscount ? (
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="text-muted-foreground line-through font-bold">₹{mrp.toLocaleString()}</span>
                                  <span className="text-emerald-700 font-black">{discountPct}% OFF</span>
                                </div>
                              ) : null}
                            </div>
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                              <ShoppingBag className="h-4 w-4" />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  </motion.div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
