// functions/src/lib/racemapFetch.ts

export async function racemapFetch(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Racemap API error ${res.status}: ${errorBody}`);
  }
  return res.json();
}
