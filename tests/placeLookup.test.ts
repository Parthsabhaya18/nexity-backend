import { describe, expect, it } from 'vitest';

import { toPlaces } from '../src/modules/search/placeLookup';

describe('toPlaces', () => {
  it('turns map results into named places with coordinates, without repeats', () => {
    const places = toPlaces([
      {
        geometry: { coordinates: [70.48, 22.4335] },
        properties: {
          name: 'Hadmatiya',
          county: 'Paddhari Taluka',
          state: 'Gujarat',
          country: 'India',
        },
      },
      {
        geometry: { coordinates: [70.471, 22.4284] },
        properties: {
          name: 'Hadmatiya',
          county: 'Paddhari Taluka',
          state: 'Gujarat',
          country: 'India',
        },
      },
      {
        geometry: { coordinates: [72.6855, 24.6418] },
        properties: { name: 'Hadmatiya', county: 'Reodar Tehsil', state: 'Rajasthan', country: 'India' },
      },
      { geometry: { coordinates: [1, 2] }, properties: {} },
      { properties: { name: 'No coordinates' } },
    ]);
    expect(places).toEqual([
      {
        name: 'Hadmatiya',
        area: 'Paddhari Taluka, Gujarat, India',
        latitude: 22.4335,
        longitude: 70.48,
      },
      {
        name: 'Hadmatiya',
        area: 'Reodar Tehsil, Rajasthan, India',
        latitude: 24.6418,
        longitude: 72.6855,
      },
    ]);
  });

  it('does not repeat the place name in its area', () => {
    const [goa] = toPlaces([
      {
        geometry: { coordinates: [74.12, 15.3] },
        properties: { name: 'Goa', state: 'Goa', country: 'India' },
      },
    ]);
    expect(goa?.area).toBe('India');
  });
});
