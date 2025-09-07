import { cellToBoundary } from 'h3-js'

export interface H3Item {
  h3Index?: string
  index?: string
  h3?: string
  id?: string
  hex?: string
  cell?: string
  value: number
}

export interface HexFeatureProperties {
  id: string
  value: number
}

export type Position = [number, number]
export interface PolygonGeometry { type: 'Polygon'; coordinates: [Position[]] }
export interface Feature<P = any> { type: 'Feature'; properties: P; geometry: PolygonGeometry }
export interface FeatureCollection<F extends Feature = Feature> { type: 'FeatureCollection'; features: F[] }

export interface HexFeature extends Feature<HexFeatureProperties> {}

export function asH3Index(item: H3Item & { cell?: string }): string | undefined {
  return item.h3Index || item.index || item.h3 || item.hex || item.id || (item as any).cell
}

function isFinitePair(pt: any): pt is [number, number] {
  return Array.isArray(pt) && pt.length === 2 && isFinite(pt[0]) && isFinite(pt[1])
}

function shouldSwapLngLat(ring: [number, number][]): boolean {
  // Si el primer componente se parece a latitud (<=90) y el segundo a longitud (>90 a menudo),
  // asumimos [lat,lng] y hacemos swap. Usamos promedio para ser robustos.
  let sumAbsX = 0
  let sumAbsY = 0
  let n = 0
  for (const [x, y] of ring) {
    if (isFinite(x) && isFinite(y)) {
      sumAbsX += Math.abs(x)
      sumAbsY += Math.abs(y)
      n++
    }
  }
  if (n === 0) return false
  const avgX = sumAbsX / n
  const avgY = sumAbsY / n
  return avgX <= 90 && avgY > 90
}

function normalizeLngLat(ring: [number, number][]): [number, number][] {
  if (shouldSwapLngLat(ring)) return ring.map(([a, b]) => [b, a])
  return ring
}

function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  const isClosed = last[0] === first[0] && last[1] === first[1]
  return isClosed ? ring : [...ring, first]
}

function signedArea(ring: [number, number][]): number {
  // Shoelace sobre lon/lat en grados: suficiente para orientación
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j]
    const [x2, y2] = ring[i]
    area += (x1 * y2 - x2 * y1)
  }
  return area / 2
}

function ensureCCW(ring: [number, number][]): [number, number][] {
  // Ensure exterior rings are counterclockwise (RFC 7946). If our planar signed area
  // ends up positive, flip the ring to keep CCW for d3-geo rendering.
  return signedArea(ring) > 0 ? [...ring].reverse() : ring
}

export function buildHexFeature(index: string, value: number): HexFeature | null {
  try {
    // h3-js v4: use 'geojson' to get [lng, lat] directly
    const raw: [number, number][] = cellToBoundary(index, 'geojson' as any)
    if (!Array.isArray(raw) || raw.length < 3) return null
    const filtered = raw.filter(isFinitePair)
    if (filtered.length < 3) return null
    const lnglat = normalizeLngLat(filtered)
    const closed = closeRing(lnglat)
    const ccw = ensureCCW(closed)
    return {
      type: 'Feature',
      properties: { id: index, value },
      geometry: { type: 'Polygon', coordinates: [ccw] },
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('Invalid H3 index for hex feature:', index, e)
    }
    return null
  }
}

export function sanitizePolygonFeature(f: any): HexFeature | null {
  if (!f || f.geometry?.type !== 'Polygon') return null
  const coords = f.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length === 0) return null
  const ring = coords[0]
  if (!Array.isArray(ring) || ring.length < 3) return null
  const filtered = ring.filter((pt: any) => Array.isArray(pt) && isFinite(pt[0]) && isFinite(pt[1]))
  if (filtered.length < 3) return null
  const lnglat = normalizeLngLat(filtered as [number, number][])
  const closed = closeRing(lnglat)
  const ccw = ensureCCW(closed)
  const id = f.properties?.id ?? f.id
  const value = f.properties?.value
  if (id == null || !isFinite(Number(value))) return null
  return {
    type: 'Feature',
    properties: { id: String(id), value: Number(value) },
    geometry: { type: 'Polygon', coordinates: [ccw] },
  }
}
