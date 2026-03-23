// src/lib/googleMaps.ts
import { Libraries } from '@react-google-maps/api';

// Define the libraries to be loaded by Google Maps API.
// This ensures a consistent set of libraries is loaded across the application.
export const GOOGLE_MAPS_LIBRARIES: Libraries = [
  'geometry',
  'places',
];
