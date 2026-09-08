module.exports = ({ config }) => {
  // The existing EAS production secret is named GOOGLE_MAPS_API_KEY. Keep the
  // platform-specific name as the preferred option, with the deployed secret
  // name as a backward-compatible fallback.
  const androidGoogleMapsKey =
    process.env.GOOGLE_MAPS_ANDROID_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  const mapboxPublicAccessToken = [
    process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN,
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    process.env.MAPBOX_PUBLIC_ACCESS_TOKEN,
    process.env.MAPBOX_ACCESS_TOKEN,
    config.extra?.mapboxPublicAccessToken,
  ]
    .map((value) => String(value || "").trim())
    .find((value) => value.startsWith("pk."));

  config.ios = config.ios || {};
  config.ios.config = {
    ...(config.ios.config || {}),
    usesNonExemptEncryption: false,
  };

  // Expo 57 still generates the removed react-native-google-maps pod when this
  // key is set. iOS uses Apple Maps; Android continues to use Google Maps.

  if (androidGoogleMapsKey) {
    config.android = config.android || {};
    config.android.config = {
      ...(config.android.config || {}),
      googleMaps: {
        apiKey: androidGoogleMapsKey,
      },
    };
  }

  config.extra = {
    ...(config.extra || {}),
    hasAndroidGoogleMapsKey: Boolean(androidGoogleMapsKey),
    mapboxPublicAccessToken: mapboxPublicAccessToken || undefined,
    hasMapboxPublicAccessToken: Boolean(mapboxPublicAccessToken),
  };

  return config;
};
