import type { Listing } from '../nexon/listing.js';

export function topN(listings: Listing[], n: number): Listing[] {
  return [...listings]
    .sort((a, b) => a.pricePerItem - b.pricePerItem || (a.tradeSn < b.tradeSn ? -1 : a.tradeSn > b.tradeSn ? 1 : 0))
    .slice(0, n);
}

export function fingerprint(listings: Listing[]): string {
  return listings.map(l => `${l.tradeSn}:${l.pricePerItem}`).join('|');
}
