// src/sections/map/hex-helpers.ts
import { cellToBoundary, isValidCell } from 'h3-js'

export interface HexFeature {
    type: 'Feature'
    properties: {
        id: string
        value: number
    }
    geometry: {
        type: 'Polygon'
        coordinates: [number, number][][]
    }
}

export interface H3Item {
    h3?: string
    h3Index?: string
    cell?: string
    id?: string
    index?: string
    value: number
    resolution?: number
}

function pointsEqual(a: [number, number], b: [number, number]) {
    return a[0] === b[0] && a[1] === b[1]
}

export function asH3Index(it: H3Item | any): string | null {
    const cand =
        it?.h3 ??
        it?.h3Index ??
        it?.cell ??
        it?.id ??
        it?.index ??
        (typeof it === 'string' ? it : null)

    if (!cand || typeof cand !== 'string') return null
    try {
        if (isValidCell?.(cand) === false) return null
    } catch {
        const hex = /^[0-9a-f]+$/i.test(cand)
        if (!hex || cand.length < 15) return null
    }
    return cand
}

export function buildHexFeature(index: string, value: number): HexFeature | null {
    try {
        const ring = cellToBoundary(index, true) as [number, number][]
        if (!Array.isArray(ring) || ring.length < 5) return null
        const coords = pointsEqual(ring[0], ring[ring.length - 1]) ? ring : [...ring, ring[0]]
        return {
            type: 'Feature',
            properties: { id: index, value },
            geometry: { type: 'Polygon', coordinates: [coords] },
        }
    } catch {
        return null
    }
}

export function sanitizePolygonFeature(input: any): HexFeature | null {
    if (!input || input.type !== 'Feature') return null
    const geom = input.geometry
    if (!geom || geom.type !== 'Polygon' || !Array.isArray(geom.coordinates)) return null

    const rings = geom.coordinates as [number, number][][]
    if (!Array.isArray(rings[0]) || rings[0].length < 4) return null

    const outer = rings[0]
    const closed = pointsEqual(outer[0], outer[outer.length - 1]) ? outer : [...outer, outer[0]]

    const id: string =
        asH3Index(input.properties?.id) ??
        asH3Index(input.properties?.h3) ??
        input.properties?.id ??
        'unknown'

    const value =
        typeof input.properties?.value === 'number'
            ? input.properties.value
            : typeof input.value === 'number'
                ? input.value
                : NaN

    if (!isFinite(value)) return null

    return {
        type: 'Feature',
        properties: { id, value },
        geometry: { type: 'Polygon', coordinates: [closed] },
    }
}
