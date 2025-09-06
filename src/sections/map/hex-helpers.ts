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

export function buildHexFeature(index: string, value: number): HexFeature | null {
  try {
    const ring: [number, number][] = cellToBoundary(index, true)
    if (!Array.isArray(ring) || ring.length < 3) return null
    // Guardar solo pares finitos
    const filtered = ring.filter(pt => Array.isArray(pt) && isFinite(pt[0]) && isFinite(pt[1]))
    if (filtered.length < 3) return null
    const first = filtered[0]
    const last = filtered[filtered.length - 1]
    const isClosed = Array.isArray(last) && last[0] === first[0] && last[1] === first[1]
    const closedRing = isClosed ? filtered : [...filtered, first]
    return {
      type: 'Feature',
      properties: { id: index, value },
      geometry: { type: 'Polygon', coordinates: [closedRing] },
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
  const first = filtered[0]
  const last = filtered[filtered.length - 1]
  const isClosed = Array.isArray(last) && last[0] === first[0] && last[1] === first[1]
  const closedRing = isClosed ? filtered : [...filtered, first]
  const id = f.properties?.id ?? f.id
  const value = f.properties?.value
  if (id == null || !isFinite(Number(value))) return null
  return {
    type: 'Feature',
    properties: { id: String(id), value: Number(value) },
    geometry: { type: 'Polygon', coordinates: [closedRing] },
  }
}
