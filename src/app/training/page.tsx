'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { Mail, Phone, MapPin, Loader2, Search, Users } from 'lucide-react';
import Link from 'next/link';

interface Club {
  id: string;
  name: string;
  coach_name: string;
  email: string;
  mobile?: string;
  city?: string;
  state?: string;
  country?: string;
  memberCount?: number;
  rankingScore?: number;
  lastYearRank?: number;
  lastYearPoints?: number;
  rankingYear?: number;
  logoUrl?: string;
}

export default function TrainingPage() {
  const toTitleCase = (value?: string) => {
    const input = String(value || '').trim();
    if (!input) return 'N/A';

    return input
      .toLowerCase()
      .split(/(\s+|[-/])/)
      .map((part) => {
        if (!part || /^(\s+|[-/])$/.test(part)) return part;
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join('');
  };

  const [clubs, setClubs] = useState<Club[]>([]);
  const [filteredClubs, setFilteredClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter states
  const [searchName, setSearchName] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');

  // Derived filter options
  const countries = Array.from(new Set(clubs.map(c => c.country).filter(Boolean)));
  const states = Array.from(new Set(clubs.filter(c => !selectedCountry || c.country === selectedCountry).map(c => c.state).filter(Boolean)));
  const cities = Array.from(new Set(clubs.filter(c => (!selectedCountry || c.country === selectedCountry) && (!selectedState || c.state === selectedState)).map(c => c.city).filter(Boolean)));

  // Load clubs from API
  useEffect(() => {
    async function loadClubs() {
      try {
        setLoading(true);
        const response = await fetch('/api/training-clubs');
        if (!response.ok) throw new Error('Failed to fetch clubs');
        const data = await response.json();
        
        // Debug: Log clubs with logos
        const withLogos = data.filter((c: Club) => c.logoUrl);
        console.log(`[Training Page] Loaded ${data.length} clubs, ${withLogos.length} have logos`);
        if (withLogos.length > 0) {
          console.log('[Training Page] Sample club with logo:', withLogos[0]);
        }
        
        setClubs(data);
        setFilteredClubs(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading clubs');
        console.error('Error loading clubs:', err);
      } finally {
        setLoading(false);
      }
    }

    loadClubs();
  }, []);

  // Apply filters
  useEffect(() => {
    const filtered = clubs.filter(club =>
      (searchName === '' || club.name.toLowerCase().includes(searchName.toLowerCase())) &&
      (!selectedCountry || club.country === selectedCountry) &&
      (!selectedState || club.state === selectedState) &&
      (!selectedCity || club.city === selectedCity)
    );
    setFilteredClubs(filtered);
  }, [clubs, searchName, selectedCountry, selectedState, selectedCity]);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border-b border-slate-200 dark:border-slate-700 py-10 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-4xl">🏃‍♂️</span>
            <h1 className="text-4xl font-bold text-slate-900 dark:text-white">Bergman Training & Coaching</h1>
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-lg">Connect with certified coaches and training clubs near you</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Filters */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-white">Find Clubs Near You</h2>
          
          {/* Search Box */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Search by Club Name</label>
            <div className="relative">
              <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search club name..."
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Location Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Country</label>
              <select
                value={selectedCountry}
                onChange={(e) => {
                  setSelectedCountry(e.target.value);
                  setSelectedState('');
                  setSelectedCity('');
                }}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Countries</option>
                {countries.map(country => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">State</label>
              <select
                value={selectedState}
                onChange={(e) => {
                  setSelectedState(e.target.value);
                  setSelectedCity('');
                }}
                disabled={!selectedCountry && selectedState === ''}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-100 dark:disabled:bg-slate-700 disabled:text-slate-500 dark:disabled:text-slate-400"
              >
                <option value="">All States</option>
                {states.map(state => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">City</label>
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                disabled={!selectedCountry && !selectedState && selectedCity === ''}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-100 dark:disabled:bg-slate-700 disabled:text-slate-500 dark:disabled:text-slate-400"
              >
                <option value="">All Cities</option>
                {cities.map(city => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Results Count & Info */}
        <div className="mb-4">
          <p className="font-semibold text-slate-900 dark:text-white">
            {loading ? 'Loading...' : `${filteredClubs.length} club${filteredClubs.length !== 1 ? 's' : ''} found`}
          </p>
          {!loading && filteredClubs.length > 0 && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Clubs are sorted using performance-based quality scoring and auto-updated every year.
            </p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-2 bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded">
            📸 <strong>Logo Tip:</strong> For best display, upload square logos (1:1 aspect ratio) like 512×512px or 1024×1024px in PNG/JPG format.
          </p>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="ml-2 text-slate-700 dark:text-slate-300">Loading clubs...</span>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-8">
            <p className="text-red-800 dark:text-red-200"><strong>Error:</strong> {error}</p>
          </div>
        )}

        {/* Clubs Grid */}
        {!loading && !error && (
          <>
            {filteredClubs.length === 0 ? (
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-12 text-center">
                <p className="text-slate-600 dark:text-slate-400 text-lg">No clubs found matching your criteria.</p>
                <p className="text-slate-500 dark:text-slate-500 mt-2">Try adjusting your filters or check back soon!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredClubs.map((club, index) => (
                  <div
                    key={club.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm hover:shadow-md dark:hover:shadow-lg dark:shadow-black/50 transition-all duration-200 hover:-translate-y-1 overflow-hidden"
                  >
                    {/* Club Logo or Header */}
                    {club.logoUrl && club.logoUrl.trim() ? (
                      <div className="relative w-full aspect-square bg-gradient-to-br from-blue-100 to-blue-50 dark:from-blue-950 dark:to-slate-900 flex items-center justify-center overflow-hidden">
                        <Image
                          src={club.logoUrl}
                          alt={club.name}
                          width={400}
                          height={400}
                          className="w-full h-full object-contain p-4"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      </div>
                    ) : (
                      <div className="bg-gradient-to-r from-blue-500 to-blue-600 aspect-square flex items-center justify-center">
                        <Users className="w-16 h-16 text-white/70" />
                      </div>
                    )}

                    {/* Card Header with Club Name */}
                    <div className="px-4 pt-3 pb-2">
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white line-clamp-2">{club.name}</h3>
                    </div>

                    {/* Card Body */}
                    <div className="p-4 space-y-3">
                      {/* Coach */}
                      <div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 font-medium">Coach</p>
                        <p className="text-slate-900 dark:text-white font-semibold">{toTitleCase(club.coach_name)}</p>
                      </div>

                      {/* Location */}
                      <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm text-slate-600 dark:text-slate-400">Location</p>
                          <p className="text-slate-900 dark:text-white">
                            {[club.city, club.state, club.country].filter(Boolean).join(', ')}
                          </p>
                        </div>
                      </div>

                      {/* Contact Actions */}
                      <div className="pt-2 space-y-2 border-t border-slate-200 dark:border-slate-700">
                        {club.email && (
                          <a
                            href={`mailto:${club.email}`}
                            className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors text-sm font-medium"
                          >
                            <Mail className="w-4 h-4" />
                            {club.email}
                          </a>
                        )}

                        {club.mobile && (
                          <a
                            href={`tel:${club.mobile}`}
                            className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900 transition-colors text-sm font-medium"
                          >
                            <Phone className="w-4 h-4" />
                            {club.mobile}
                          </a>
                        )}

                        {!club.email && !club.mobile && (
                          <p className="text-sm text-slate-500 dark:text-slate-500 italic">Contact info not available</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* CTA Section */}
        <div className="mt-12 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 border border-blue-200 dark:border-blue-800 rounded-lg p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Ready to Train?</h2>
          <p className="text-slate-600 dark:text-slate-300 mb-6">Join Bergman races and improve your performance with our affiliate coaches.</p>
          <Link
            href="/races"
            className="inline-block px-8 py-3 bg-blue-600 dark:bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 dark:hover:bg-blue-700 transition-colors"
          >
            View Upcoming Races →
          </Link>
        </div>
      </div>
    </div>
  );
}
