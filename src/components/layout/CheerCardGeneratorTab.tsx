"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Heart, ImageUp, RefreshCcw, Share2, ZoomIn, ZoomOut } from 'lucide-react';

const BERGMAN_LOGO_URL = '/brand/bm-logo.png';

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  baseSize: number,
  minSize = 20
) {
  let size = baseSize;
  ctx.font = `700 ${size}px Arial`;
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 2;
    ctx.font = `700 ${size}px Arial`;
  }
  return size;
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  zoom: number,
  offsetX: number,
  offsetY: number
) {
  const baseScale = Math.max(canvas.width / image.width, canvas.height / image.height);
  const scale = baseScale * zoom;
  const x = canvas.width / 2 - (image.width * scale) / 2 + offsetX;
  const y = canvas.height / 2 - (image.height * scale) / 2 + offsetY;
  ctx.drawImage(image, x, y, image.width * scale, image.height * scale);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';

  for (let n = 0; n < words.length; n++) {
    const testLine = `${line}${words[n]} `;
    const width = ctx.measureText(testLine).width;

    if (width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, y);
      line = `${words[n]} `;
      y += lineHeight;
    } else {
      line = testLine;
    }
  }

  ctx.fillText(line.trim(), x, y);
}

export default function CheerCardGeneratorTab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragTargetRef = useRef<'image' | 'text'>('image');
  const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  const [athleteName, setAthleteName] = useState('');
  const [senderName, setSenderName] = useState('');
  const [relation, setRelation] = useState('Friend');
  const [customRelation, setCustomRelation] = useState('');
  const [message, setMessage] = useState('');
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [logoImage, setLogoImage] = useState<HTMLImageElement | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageOffsetX, setImageOffsetX] = useState(0);
  const [imageOffsetY, setImageOffsetY] = useState(0);
  const [textOffsetX, setTextOffsetX] = useState(0);
  const [textOffsetY, setTextOffsetY] = useState(0);
  const [overlayOpacity, setOverlayOpacity] = useState(0.25);

  const [titleColor, setTitleColor] = useState('#ffffff');
  const [messageColor, setMessageColor] = useState('#ffffff');
  const [supporterColor, setSupporterColor] = useState('#ffffff');
  const [footerColor, setFooterColor] = useState('#ffffff');

  const [titleYAdjust, setTitleYAdjust] = useState(0);
  const [messageYAdjust, setMessageYAdjust] = useState(0);
  const [supporterYAdjust, setSupporterYAdjust] = useState(0);
  const [footerYAdjust, setFooterYAdjust] = useState(0);

  const relationLabel = useMemo(() => {
    if (relation !== 'Other') return relation;
    return customRelation.trim() || 'Supporter';
  }, [relation, customRelation]);

  useEffect(() => {
    const logo = new Image();
    logo.onload = () => setLogoImage(logo);
    logo.onerror = () => setLogoImage(null);
    logo.src = BERGMAN_LOGO_URL;
  }, []);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      setImage(img);
      setImageZoom(1);
      setImageOffsetX(0);
      setImageOffsetY(0);
      URL.revokeObjectURL(url);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
    };

    img.src = url;
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 1080;
    const H = 1080;

    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    if (image) {
      drawCoverImage(ctx, canvas, image, imageZoom, imageOffsetX, imageOffsetY);
    } else {
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#dc2626');
      grad.addColorStop(1, '#facc15');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.fillStyle = `rgba(0,0,0,${overlayOpacity})`;
    ctx.fillRect(0, 0, W, H);

    const tx = W / 2 + textOffsetX;
    const titleY = 200 + textOffsetY + titleYAdjust;
    const messageY = 350 + textOffsetY + messageYAdjust;
    const supporterY = 900 + textOffsetY + supporterYAdjust;
    const footerY = 1020 + textOffsetY + footerYAdjust;

    ctx.textAlign = 'center';

    const titleText = `GO ${athleteName || 'ATHLETE'}`.toUpperCase();
    const titleSize = fitText(ctx, titleText, 940, 90, 46);
    ctx.fillStyle = titleColor;
    ctx.font = `900 ${titleSize}px Arial`;
    ctx.fillText(titleText, tx, titleY);

    ctx.fillStyle = messageColor;
    ctx.font = "700 50px Arial";
    wrapText(ctx, (message || 'YOU GOT THIS 💪').toUpperCase(), tx, messageY, 820, 60);

    ctx.fillStyle = supporterColor;
    ctx.font = "600 40px Arial";
    ctx.fillText(`${(senderName || 'FRIEND').toUpperCase()} (${relationLabel.toUpperCase()})`, tx, supporterY);

    ctx.fillStyle = footerColor;
    ctx.font = "700 28px Arial";
    ctx.fillText('#BERGMANTRIATHLON', tx, footerY);

    if (logoImage) {
      const targetWidth = 340;
      const targetHeight = (logoImage.height / logoImage.width) * targetWidth;
      const logoX = W / 2 - targetWidth / 2;
      const logoY = H - targetHeight - 16;
      ctx.drawImage(logoImage, logoX, logoY, targetWidth, targetHeight);
    }
  }, [
    athleteName,
    senderName,
    relationLabel,
    message,
    image,
    imageZoom,
    imageOffsetX,
    imageOffsetY,
    textOffsetX,
    textOffsetY,
    overlayOpacity,
    titleColor,
    messageColor,
    supporterColor,
    footerColor,
    titleYAdjust,
    messageYAdjust,
    supporterYAdjust,
    footerYAdjust,
    logoImage,
  ]);

  const handlePreviewPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      pinchStartDistRef.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartZoomRef.current = imageZoom;
      isDraggingRef.current = false;
      lastPointerPositionRef.current = null;
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const canvas = canvasRef.current;
    const scale = rect.width > 0 && canvas ? canvas.width / rect.width : 1;
    const px = (e.clientX - rect.left) * scale;
    const py = (e.clientY - rect.top) * scale;

    const inTextX = px >= 120 && px <= 960;
    const inTextY = py >= 120 && py <= 960;
    dragTargetRef.current = inTextX && inTextY ? 'text' : 'image';

    if (dragTargetRef.current === 'image' && !image) return;

    isDraggingRef.current = true;
    lastPointerPositionRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePreviewPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (activePointersRef.current.size === 2 && pinchStartDistRef.current !== null) {
      if (!image) return;
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const ratio = dist / pinchStartDistRef.current;
      const newZoom = Math.min(3, Math.max(1, pinchStartZoomRef.current * ratio));
      setImageZoom(Number(newZoom.toFixed(2)));
      return;
    }

    if (!isDraggingRef.current || !lastPointerPositionRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const canvas = canvasRef.current;
    const scale = rect.width > 0 && canvas ? canvas.width / rect.width : 1;
    const dx = (e.clientX - lastPointerPositionRef.current.x) * scale;
    const dy = (e.clientY - lastPointerPositionRef.current.y) * scale;
    lastPointerPositionRef.current = { x: e.clientX, y: e.clientY };

    if (dragTargetRef.current === 'text') {
      setTextOffsetX((prev) => prev + Math.round(dx));
      setTextOffsetY((prev) => prev + Math.round(dy));
      return;
    }

    if (!image) return;
    setImageOffsetX((prev) => prev + Math.round(dx));
    setImageOffsetY((prev) => prev + Math.round(dy));
  };

  const handlePreviewPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) pinchStartDistRef.current = null;
    isDraggingRef.current = false;
    lastPointerPositionRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handlePreviewWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!image) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setImageZoom((prev) => Math.min(3, Math.max(1, Number((prev + delta).toFixed(2)))));
  };

  useEffect(() => {
    draw();
  }, [draw]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = 'bergman-cheer-card.png';
    link.href = canvas.toDataURL('image/png', 1.0);
    link.click();
  };

  const shareCard = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !navigator.share) return;

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;

    const file = new File([blob], 'bergman-cheer-card.png', { type: 'image/png' });
    const data: ShareData = {
      title: 'Bergman Cheer Card',
      text: 'Cheering for you with Bergman!',
      files: [file],
    };

    try {
      if ((navigator as Navigator & { canShare?: (data: ShareData) => boolean }).canShare?.(data)) {
        await navigator.share(data);
      } else {
        await navigator.share({ title: data.title, text: data.text });
      }
    } catch {
      // ignore user cancel
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 md:p-5">
        <div className="space-y-2">
          <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Athlete Name</Label>
          <Input value={athleteName} onChange={(e) => setAthleteName(e.target.value)} placeholder="Athlete Name" className="h-11 border-white/60 bg-slate-900/70 font-bold text-white placeholder:text-slate-400" />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Your Name</Label>
          <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Your Name" className="h-11 border-white/60 bg-slate-900/70 font-bold text-white placeholder:text-slate-400" />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Relation</Label>
          <Select value={relation} onValueChange={setRelation}>
            <SelectTrigger className="h-11 border-white/60 bg-slate-900/70 font-bold text-white">
              <SelectValue placeholder="Select relation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Friend">Friend</SelectItem>
              <SelectItem value="Husband">Husband</SelectItem>
              <SelectItem value="Wife">Wife</SelectItem>
              <SelectItem value="Coach">Coach</SelectItem>
              <SelectItem value="Brother">Brother</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {relation === 'Other' && (
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Custom Relation</Label>
            <Input
              value={customRelation}
              onChange={(e) => setCustomRelation(e.target.value)}
              placeholder="e.g. Sister, Parent, Teammate"
              className="h-11 border-white/60 bg-slate-900/70 font-bold text-white placeholder:text-slate-400"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Message</Label>
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="You got this 💪" className="h-11 border-white/60 bg-slate-900/70 font-bold text-white placeholder:text-slate-400" />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Upload Image</Label>
          <Input type="file" accept="image/*" onChange={handleUpload} className="h-11 border-white/60 bg-slate-900/70 text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1 file:text-xs file:font-black file:text-slate-900" />
        </div>

        <div className="space-y-3 rounded-lg border border-white/40 bg-slate-900/60 p-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-black uppercase tracking-widest text-slate-300">Cheer Style</Label>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setImageZoom(1);
                setImageOffsetX(0);
                setImageOffsetY(0);
                setTextOffsetX(0);
                setTextOffsetY(0);
                setTitleYAdjust(0);
                setMessageYAdjust(0);
                setSupporterYAdjust(0);
                setFooterYAdjust(0);
              }}
              className="h-7 px-2 text-[10px] font-black uppercase tracking-widest text-slate-300 hover:bg-white/10"
            >
              Reset Positions
            </Button>
          </div>

          <p className="text-[10px] uppercase tracking-widest text-slate-500">
            Mouse/Touch: drag on text = move text • drag elsewhere = move image • wheel/pinch = zoom image.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-slate-400">Title Color</Label>
              <Input type="color" value={titleColor} onChange={(e) => setTitleColor(e.target.value)} className="h-9 w-full border-white/40 bg-slate-900 p-1" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-slate-400">Message Color</Label>
              <Input type="color" value={messageColor} onChange={(e) => setMessageColor(e.target.value)} className="h-9 w-full border-white/40 bg-slate-900 p-1" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-slate-400">Supporter Color</Label>
              <Input type="color" value={supporterColor} onChange={(e) => setSupporterColor(e.target.value)} className="h-9 w-full border-white/40 bg-slate-900 p-1" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-slate-400">Footer Color</Label>
              <Input type="color" value={footerColor} onChange={(e) => setFooterColor(e.target.value)} className="h-9 w-full border-white/40 bg-slate-900 p-1" />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">Overlay Transparency: {overlayOpacity.toFixed(2)}</Label>
            <Input
              type="range"
              min={0}
              max={0.9}
              step={0.01}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(Number(e.target.value))}
              className="h-8 border-0 bg-transparent px-0"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">Title Position: {titleYAdjust}</Label>
            <Input type="range" min={-220} max={220} step={1} value={titleYAdjust} onChange={(e) => setTitleYAdjust(Number(e.target.value))} className="h-8 border-0 bg-transparent px-0" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">Message Position: {messageYAdjust}</Label>
            <Input type="range" min={-220} max={220} step={1} value={messageYAdjust} onChange={(e) => setMessageYAdjust(Number(e.target.value))} className="h-8 border-0 bg-transparent px-0" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">Supporter Position: {supporterYAdjust}</Label>
            <Input type="range" min={-220} max={220} step={1} value={supporterYAdjust} onChange={(e) => setSupporterYAdjust(Number(e.target.value))} className="h-8 border-0 bg-transparent px-0" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">Footer Position: {footerYAdjust}</Label>
            <Input type="range" min={-220} max={220} step={1} value={footerYAdjust} onChange={(e) => setFooterYAdjust(Number(e.target.value))} className="h-8 border-0 bg-transparent px-0" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setImageZoom((z) => Math.max(1, Number((z - 0.1).toFixed(2))))} className="h-9 border-white/60 bg-transparent text-white hover:bg-white/10">
              <ZoomOut className="mr-2 h-4 w-4" /> Zoom Out
            </Button>
            <Button type="button" variant="outline" onClick={() => setImageZoom((z) => Math.min(3, Number((z + 0.1).toFixed(2))))} className="h-9 border-white/60 bg-transparent text-white hover:bg-white/10">
              <ZoomIn className="mr-2 h-4 w-4" /> Zoom In
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button onClick={draw} className="h-11 rounded-xl border border-white bg-white text-slate-900 font-black uppercase tracking-widest hover:bg-slate-200">
            <RefreshCcw className="mr-2 h-4 w-4" />
            Generate
          </Button>
          <Button onClick={download} variant="secondary" className="h-11 rounded-xl border border-white bg-slate-200 font-black uppercase tracking-widest text-slate-900 hover:bg-slate-300">
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
          <Button onClick={shareCard} variant="outline" className="h-11 rounded-xl border-white bg-transparent font-black uppercase tracking-widest text-white hover:bg-white/10">
            <Share2 className="mr-2 h-4 w-4" />
            Share
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-white bg-black/30 p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-300">
          <Heart className="h-4 w-4 text-rose-300" />
          Cheer Preview
        </div>
        <div className="overflow-hidden rounded-2xl border border-white bg-slate-950/80">
          <canvas
            ref={canvasRef}
            width={1080}
            height={1080}
            onPointerDown={handlePreviewPointerDown}
            onPointerMove={handlePreviewPointerMove}
            onPointerUp={handlePreviewPointerUp}
            onPointerCancel={handlePreviewPointerUp}
            onWheel={handlePreviewWheel}
            className="h-auto w-full touch-none"
            aria-label="Cheer card preview"
          />
        </div>
        <p className="mt-2 text-center text-[10px] text-slate-400">
          Mobile supported: drag + pinch zoom. Desktop gives the best output quality.
        </p>
      </div>
    </div>
  );
}
