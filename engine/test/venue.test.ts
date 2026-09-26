import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVenue } from '../src/context/venue.ts';

test('a ground is read by name, city and capacity', () => {
  assert.deepEqual(parseVenue({ name: 'Voith-Arena', city: 'Heidenheim', capacity: 15000 }), { name: 'Voith-Arena', city: 'Heidenheim', capacity: 15000 });
  assert.deepEqual(parseVenue({ name: 'Allianz Arena', city: { name: 'Munich' }, capacity: '75024' }), { name: 'Allianz Arena', city: 'Munich', capacity: 75024 });
});

test('a ground with no name is nothing, and a zero capacity is unknown', () => {
  assert.equal(parseVenue({ city: 'Somewhere' }), null);
  assert.equal(parseVenue(null), null);
  assert.equal(parseVenue({ name: '  ', capacity: 100 }), null);
  assert.equal(parseVenue({ name: 'Ground', capacity: 0 })!.capacity, null);
});
