# 🗺️ GOOGLE MAPS SETUP GUIDE

**Purpose:** Enable Google Maps integration in Live Tracking Pro V2  
**Status:** Required for production  
**Time to Setup:** 5-10 minutes  

---

## 🚀 Step 1: Get Google Maps API Key

### Option A: Google Cloud Console
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project or select existing
3. Go to "APIs & Services" → "Credentials"
4. Click "Create Credentials" → "API Key"
5. Restrict key to "Maps JavaScript API"
6. Restrict by HTTP referrers: `yourdomain.com/*`
7. Copy the API key

### Option B: Google Maps Platform
1. Visit [Google Maps Platform](https://developers.google.com/maps/billing-and-pricing/billing)
2. Enable billing (required)
3. Create API key from credentials
4. Copy the key

---

## ⚙️ Step 2: Set Environment Variables

### Development (.env.local)
```bash
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_api_key_here
```

### Production (.env.production)
```bash
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_production_api_key
```

### Vercel Dashboard
```
Settings → Environment Variables
Add: NEXT_PUBLIC_GOOGLE_MAPS_KEY = your_key
```

---

## 🔗 Step 3: Add Script to HTML

### Option A: In Next.js Layout (Recommended)
File: `src/app/layout.tsx`

```tsx
export const metadata: Metadata = {
  title: "Live Tracking",
  // ...
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Google Maps Script */}
        <script
          src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY}`}
          async
          defer
        ></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
```

### Option B: In Document (Next.js 13+)
File: `src/app/layout.tsx` (head section)

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Tracking",
  viewport: "width=device-width, initial-scale=1",
  head: [
    {
      tag: "script",
      src: `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY}`,
      async: true,
      defer: true,
    },
  ],
};
```

### Option C: Using next/script
```tsx
import Script from "next/script";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY}`}
          strategy="lazyOnload"
        />
        {children}
      </body>
    </html>
  );
}
```

---

## ✅ Step 4: Verify Setup

### Test in Browser Console
```javascript
// Should return the Google Maps API object
typeof google.maps

// Should return "object" if loaded
```

### Check Network Tab
- Look for `/maps/api/js?key=...` request
- Status should be 200 (success)
- Size should be ~200KB

### Test Live Tracking Page
1. Navigate to `/live-tracking/tri2026`
2. Map should display (not blank)
3. Markers should appear
4. Dark/light theme should work

---

## 🔑 API Key Security Best Practices

### Restrict Key Access
1. **Domain Restriction:**
   - Restrict to: `yourdomain.com/*`
   - Prevent misuse on other domains

2. **API Restriction:**
   - Enable only: "Maps JavaScript API"
   - Disable unused APIs

3. **Application Restriction:**
   - Type: HTTP referrers
   - Value: `yourdomain.com/*`

### Rotate Keys Regularly
```bash
# Create new key every 6-12 months
# Update environment variables
# Monitor old key usage
# Disable old key
```

### Monitor Billing
- Google Maps API is paid after free tier
- Check quotas: https://console.cloud.google.com/quotas
- Set up billing alerts
- Typical cost: $5-50/month depending on usage

---

## 🐛 Troubleshooting

### Map Not Showing
```
Problem: Blank gray area where map should be
Solution: 
  1. Check API key in environment variables
  2. Verify script is loaded (Network tab)
  3. Check browser console for errors
  4. Ensure domain is whitelisted
```

### "Google is not defined"
```
Problem: typeof google === "undefined"
Solution:
  1. API key not set correctly
  2. Script not added to layout.tsx
  3. Wrong script URL
  4. API key rate limited
```

### "RefererNotAllowedMapError"
```
Problem: Map shows error message
Solution:
  1. Domain restriction too strict
  2. Accessing from different domain
  3. API key for different project
  4. Clear browser cache and restart
```

### Markers Not Showing
```
Problem: Map loads but no markers
Solution:
  1. Verify athletes array has data
  2. Check lat/lng values are valid
  3. Verify map.current is defined
  4. Check browser console for errors
```

### Theme Not Changing
```
Problem: Light/dark toggle doesn't work
Solution:
  1. Verify isDarkMode state changes
  2. Check map style definitions
  3. Verify CSS classes apply correctly
  4. Check for CSS conflicts
```

---

## 📊 Monitoring & Quotas

### Check API Usage
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select project
3. Go to "APIs & Services" → "Credentials"
4. View API quotas and usage

### Common Quotas
| Quota | Limit | Status |
|-------|-------|--------|
| Requests/min | 600/min | Default |
| Requests/day | 25,000/day | Default |
| Markers | Unlimited | - |
| Map instances | Unlimited | - |

### Reduce Quota Usage
```typescript
// Use marker clustering
// Limit marker count
// Cache map data
// Reduce update frequency
// Use vector tiles
```

---

## 🚀 Deployment Checklist

### Before Deploying
- [ ] API key created
- [ ] Billing enabled
- [ ] Domain whitelisted
- [ ] Environment variables set
- [ ] Script added to layout.tsx
- [ ] Tested locally
- [ ] Console shows no errors
- [ ] Markers display correctly
- [ ] Theme toggle works
- [ ] Replay mode functional

### Deploy to Production
```bash
# 1. Ensure environment variables are set in hosting
# For Vercel: Dashboard → Settings → Environment Variables

# 2. Build and deploy
npm run build
npm run deploy
# or
git push (if connected to Vercel)

# 3. Test in production
# Navigate to: https://yourdomain.com/live-tracking/tri2026

# 4. Monitor
# Check error logs regularly
# Monitor billing
```

### Post-Deployment
- [ ] Test on mobile
- [ ] Test on slow network
- [ ] Test dark/light modes
- [ ] Test replay functionality
- [ ] Monitor error logs
- [ ] Check billing

---

## 💡 Advanced Configuration

### Dark Map Style
```typescript
const darkStyle = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
];

mapRef.current.setOptions({ styles: darkStyle });
```

### Custom Markers
```typescript
const marker = new google.maps.Marker({
  position: { lat: 18.52, lng: 73.85 },
  map: mapRef.current,
  icon: {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 8,
    fillColor: "#ef4444",
    fillOpacity: 1,
    strokeColor: "#fff",
    strokeWeight: 2,
  },
});
```

### Marker Clustering (Phase 2)
```typescript
// Install: npm install @googlemaps/markerclusterer
import { MarkerClusterer } from "@googlemaps/markerclusterer";

const markerCluster = new MarkerClusterer({
  map: mapRef.current,
  markers: athleteMarkers,
});
```

---

## 📞 Support

### Google Maps Support
- [Documentation](https://developers.google.com/maps/documentation)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/google-maps)
- [GitHub Issues](https://github.com/googlemaps/js-api-loader)

### This Project
- See: [LIVE_TRACKING_PRO_V2.md](LIVE_TRACKING_PRO_V2.md)
- See: [LIVE_TRACKING_IMPLEMENTATION_SUMMARY.md](LIVE_TRACKING_IMPLEMENTATION_SUMMARY.md)

---

## ✅ Checklist

- [ ] Google Maps API key obtained
- [ ] Billing enabled
- [ ] Domain whitelisted
- [ ] Environment variable set (`.env.local`)
- [ ] Script added to `src/app/layout.tsx`
- [ ] Tested locally - Map displays
- [ ] Tested locally - Markers show
- [ ] Tested locally - Theme works
- [ ] Tested locally - Replay works
- [ ] Deployed to production
- [ ] Tested in production
- [ ] Monitoring configured
- [ ] Billing alerts set up

---

**Version:** 1.0  
**Last Updated:** March 27, 2026  
**Status:** ✅ Ready to Use
