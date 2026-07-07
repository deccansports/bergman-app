'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Search, Loader2, AlertCircle, X } from 'lucide-react';
import { searchAthletes, type SearchResult, type SearchDiagnostics } from '@/lib/athleteSearchEngine';
import { cn } from '@/lib/utils';

interface AthleteSearchInputProps {
  participants: Record<string, any>[];
  onAthleteSelected: (athlete: Record<string, any>) => void;
  maxSuggestions?: number;
  placeholder?: string;
  includeDebugInfo?: boolean;
}

export function AthleteSearchInput({
  participants,
  onAthleteSelected,
  maxSuggestions = 10,
  placeholder = 'Search by name, bib, email, or chip...',
  includeDebugInfo = false,
}: AthleteSearchInputProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [diagnostics, setDiagnostics] = useState<SearchDiagnostics | null>(null);

  // Perform search whenever query changes
  const handleSearch = useCallback(
    (searchQuery: string) => {
      setQuery(searchQuery);
      setSelectedIndex(-1);

      if (!searchQuery.trim()) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }

      const results = searchAthletes(searchQuery, participants, {
        maxResults: maxSuggestions,
        includeDiagnostics: true,
      });

      setSuggestions(results);
      setIsOpen(results.length > 0);

      // Store diagnostics from first result
      if (results.length > 0 && results[0].diagnostics) {
        setDiagnostics(results[0].diagnostics);
      }
    },
    [participants, maxSuggestions]
  );

  // Handle athlete selection from suggestion
  const handleSelectAthlete = useCallback(
    (athlete: Record<string, any>) => {
      onAthleteSelected(athlete);
      setQuery('');
      setSuggestions([]);
      setIsOpen(false);
      setSelectedIndex(-1);
    },
    [onAthleteSelected]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % suggestions.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev === 0 ? suggestions.length - 1 : prev - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            handleSelectAthlete(suggestions[selectedIndex].athlete);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setSelectedIndex(-1);
          break;
        default:
          break;
      }
    },
    [isOpen, selectedIndex, suggestions, handleSelectAthlete]
  );

  // Get formatted contest label
  const getContestLabel = (athlete: Record<string, any>) => {
    const contestName = athlete?.contestName || athlete?.category || athlete?.provider?.contestName || 'Contest TBD';
    if (contestName && !/^contest\s*\d+$/i.test(contestName)) {
      return contestName;
    }
    return 'Unmapped';
  };

  // Get formatted age group label
  const getAgeGroupLabel = (athlete: Record<string, any>) => {
    const ageGroup = athlete?.ageGroup || athlete?.ageGroupName || athlete?.provider?.ageGroupName || '';
    if (ageGroup && !/^[0-9a-f]{8}-/.test(ageGroup)) {
      return ageGroup;
    }
    return '';
  };

  return (
    <div className="relative w-full">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim() && suggestions.length > 0) {
              setIsOpen(true);
            }
          }}
          onBlur={() => {
            // Delay to allow click on suggestion
            setTimeout(() => setIsOpen(false), 200);
          }}
          placeholder={placeholder}
          className="pl-9 pr-8"
          autoComplete="off"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setSuggestions([]);
              setIsOpen(false);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 hover:text-muted-foreground text-muted-foreground/50"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Suggestions Dropdown */}
      {isOpen && suggestions.length > 0 && (
        <Card className="absolute top-full left-0 right-0 z-50 mt-2 rounded-lg border shadow-lg max-h-96 overflow-y-auto">
          {suggestions.map((result, index) => {
            const athlete = result.athlete;
            const bib = String(athlete?.bib || athlete?.bibNumber || '').trim();
            const name = String(athlete?.name || athlete?.fullName || 'Unknown Athlete').trim();
            const contest = getContestLabel(athlete);
            const ageGroup = getAgeGroupLabel(athlete);
            const gender = athlete?.gender || '';
            const status = athlete?.status || athlete?.registrationStatus || '';

            return (
              <button
                key={`${name}|${bib}`}
                onClick={() => handleSelectAthlete(athlete)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={cn(
                  'w-full px-4 py-3 text-left border-b transition-colors last:border-b-0',
                  selectedIndex === index && 'bg-muted'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-foreground line-clamp-1">{name}</div>
                    <div className="text-xs text-muted-foreground mt-1 space-y-1">
                      {bib && (
                        <div>
                          Bib <span className="font-mono font-semibold text-foreground">{bib}</span>
                          {contest && contest !== 'Unmapped' && (
                            <>
                              {' • '}
                              <span>{contest}</span>
                            </>
                          )}
                        </div>
                      )}
                      {(ageGroup || gender) && (
                        <div className="flex items-center gap-2">
                          {ageGroup && <span>{ageGroup}</span>}
                          {gender && <span>• {gender}</span>}
                        </div>
                      )}
                      {status && status.toLowerCase() !== 'registered' && (
                        <div className="text-xs">Status: {status}</div>
                      )}
                    </div>
                  </div>
                  {result.matchType === 'exact' && <Badge variant="default" className="shrink-0">Exact</Badge>}
                  {result.matchType === 'prefix' && <Badge variant="secondary" className="shrink-0">Prefix</Badge>}
                </div>
              </button>
            );
          })}
        </Card>
      )}

      {/* No Results Message */}
      {query.trim() && isOpen === false && suggestions.length === 0 && (
        <Card className="absolute top-full left-0 right-0 z-50 mt-2 p-4 text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            No athletes found for &quot;{query}&quot;
          </div>
        </Card>
      )}

      {/* Debug Info */}
      {includeDebugInfo && diagnostics && query.trim() && (
        <div className="mt-2 text-xs text-muted-foreground bg-muted p-2 rounded border">
          <div className="grid grid-cols-2 gap-2">
            <div>Query: {diagnostics.query}</div>
            <div>Type: {diagnostics.detectedType}</div>
            <div>Matches: {diagnostics.matchCount}</div>
            <div>Duration: {diagnostics.durationMs}ms</div>
            <div className="col-span-2">Fields: {diagnostics.fieldsSearched.join(', ')}</div>
          </div>
        </div>
      )}
    </div>
  );
}
