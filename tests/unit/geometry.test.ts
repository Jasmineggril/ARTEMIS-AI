import { test } from "node:test";
import assert from "node:assert/strict";
import { areaHa, ringSelfIntersects, validateBoundary, centroid, distanceToBoundaryKm, pointInBoundary, type Ring } from "../../shared/geometry";

// ~1 km x 1 km square near Alto Paraíso de Goiás (lon/lat)
const d = 0.009; // ≈ 1 km in latitude
const sq: Ring = [[-47.51, -14.13], [-47.51 + d * 1.0307, -14.13], [-47.51 + d * 1.0307, -14.13 + d], [-47.51, -14.13 + d], [-47.51, -14.13]];

test("area of a ~1 km² square is ~100 ha (spherical calculation)", () => {
  const ha = areaHa({ type: "Polygon", coordinates: [sq] });
  assert.ok(Math.abs(ha - 100) < 2, `got ${ha}`);
});

test("holes are subtracted; multipolygons add up", () => {
  const hole: Ring = [[-47.508, -14.128], [-47.506, -14.128], [-47.506, -14.126], [-47.508, -14.126], [-47.508, -14.128]];
  const outer = areaHa({ type: "Polygon", coordinates: [sq] });
  const withHole = areaHa({ type: "Polygon", coordinates: [sq, hole] });
  assert.ok(withHole < outer);
  assert.ok(Math.abs(areaHa({ type: "MultiPolygon", coordinates: [[sq], [sq]] }) - 2 * outer) < 1e-6);
});

test("bow-tie is detected as self-intersecting; a square is not", () => {
  assert.equal(ringSelfIntersects(sq), false);
  const bow: Ring = [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]];
  assert.equal(ringSelfIntersects(bow), true);
});

test("validateBoundary: open ring, outside Brazil, swapped lat/lng, crossing edges and tiny areas are refused", () => {
  assert.equal(validateBoundary({ type: "Polygon", coordinates: [sq] }).ok, true);
  const open = sq.slice(0, -1);
  assert.match(validateBoundary({ type: "Polygon", coordinates: [open] }).errors[0], /não está fechado/);
  const swapped = sq.map(([x, y]) => [y, x] as [number, number]);
  assert.match(validateBoundary({ type: "Polygon", coordinates: [swapped] }).errors[0], /fora do Brasil.*\[longitude, latitude\]/);
  const bow: Ring = [[-47.5, -14.1], [-47.4, -14.0], [-47.4, -14.1], [-47.5, -14.0], [-47.5, -14.1]];
  assert.match(validateBoundary({ type: "Polygon", coordinates: [bow] }).errors.join(" "), /bordas se cruzam/);
  const tiny: Ring = [[-47.5, -14.1], [-47.49999, -14.1], [-47.49999, -14.09999], [-47.5, -14.1]];
  assert.match(validateBoundary({ type: "Polygon", coordinates: [tiny] }).errors.join(" "), /muito pequena/);
});

test("centroid falls inside the square; distances to the boundary", () => {
  const g = { type: "Polygon" as const, coordinates: [sq] };
  const c = centroid(g);
  assert.ok(pointInBoundary(c, g));
  assert.equal(distanceToBoundaryKm(c, g), 0, "inside = 0 km");
  const east: [number, number] = [-47.51 + d * 1.0307 + 0.0186, -14.13 + d / 2]; // ≈ 2 km east of the edge
  const km = distanceToBoundaryKm(east, g);
  assert.ok(km > 1.9 && km < 2.1, `got ${km}`);
});
