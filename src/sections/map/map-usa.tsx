// src/sections/map/map-usa.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps'
import * as RSM from 'react-simple-maps'
import { feature as topojsonFeature } from 'topojson-client'
import { apiConfig } from '../../config'
import { buildHexFeature, type HexFeature } from './hex-helpers'

// Marker no siempre viene tipeado en RSM
const MarkerAny: any = (RSM as any)?.Marker

// TopoJSON USA
const US_STATES_TOPOJSON = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'

// Paleta
const palette = ['#0d0887', '#5b02a3', '#9a179b', '#cb4679', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921']
const getColorForValue = (v: number, min: number, max: number) => {
    if (!isFinite(v) || max <= min) return '#e2e8f0'
    const t = Math.min(0.93, Math.max(0.07, (v - min) / (max - min)))
    const i = Math.min(palette.length - 1, Math.floor(t * (palette.length - 1)))
    return palette[i]
}

type ApiTuple = [string, number]
const tuplesToFeatures = (rows: ApiTuple[]) =>
    rows.map(([id, value]) => buildHexFeature(id, value)).filter(Boolean) as HexFeature[]

// bbox (lon/lat) → devuelve en orden minLat,minLon,maxLat,maxLon (lo que pide tu BE)
function bboxFromGeometry(geom: any): [number, number, number, number] {
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
    const scan = (arr: any[]) => {
        for (const el of arr) {
            if (Array.isArray(el[0])) scan(el)
            else {
                const [lon, lat] = el as [number, number]
                if (lon < minLon) minLon = lon
                if (lat < minLat) minLat = lat
                if (lon > maxLon) maxLon = lon
                if (lat > maxLat) maxLat = lat
            }
        }
    }
    scan(geom.coordinates)
    return [minLat, minLon, maxLat, maxLon]
}

export default function MapUSA() {
    // Datos y estado
    const [hexFeatures, setHexFeatures] = useState<HexFeature[] | null>(null)
    const [fetchError, setFetchError] = useState<string | null>(null)
    const [njGeo, setNjGeo] = useState<any | null>(null)

    // Controles
    const [metric, setMetric] = useState('price')
    const [bucket, setBucket] = useState('day')
    const [at, setAt] = useState('2025-09-08')

    // Cámara
    const [zoom, setZoom] = useState(1)
    const [center, setCenter] = useState<[number, number]>([-74.7, 40.1])

    // LOD por zoom
    const resolution = useMemo(() => {
        if (zoom < 2.8) return 6
        if (zoom < 5.5) return 7
        if (zoom < 6.5) return 8
        if (zoom < 7.5) return 9
        return 10
    }, [zoom])

    // Cargar NJ (FIPS 34)
    useEffect(() => {
        let mounted = true
        ;(async () => {
            try {
                const topo = await (await fetch(US_STATES_TOPOJSON)).json()
                const statesFc: any = topojsonFeature(topo, (topo as any).objects.states)
                const nj = statesFc.features.find((f: any) => f?.id === 34 || f?.id === '34' || f?.properties?.name === 'New Jersey')
                if (mounted && nj?.geometry) {
                    setNjGeo(nj.geometry)
                    setCenter([-74.7, 40.1])
                }
            } catch (e) {
                console.warn('No se pudo cargar NJ:', e)
            }
        })()
        return () => { mounted = false }
    }, [])

    // Fetch al BE, recortado por bbox de NJ
    useEffect(() => {
        if (!njGeo) return
        const controller = new AbortController()
        ;(async () => {
            try {
                const [minLat, minLon, maxLat, maxLon] = bboxFromGeometry(njGeo)
                const params = new URLSearchParams({
                    metric,
                    resolution: String(resolution),
                    bucket,
                    at,
                    bbox: `${minLat},${minLon},${maxLat},${maxLon}`,
                })
                const url = `${apiConfig.apiHost}/api/v2/heatmap/h3?${params.toString()}`
                const res = await fetch(url, { signal: controller.signal })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data: ApiTuple[] = await res.json()
                setHexFeatures(tuplesToFeatures(data))
                setFetchError(null)
            } catch (e: any) {
                if (e?.name !== 'AbortError') {
                    console.error(e)
                    setFetchError(e?.message || 'fetch error')
                    setHexFeatures([])
                }
            }
        })()
        return () => controller.abort()
    }, [njGeo, metric, bucket, at, resolution])

    // Dominio para colores
    const [minVal, maxVal] = useMemo(() => {
        if (!hexFeatures?.length) return [0, 1]
        let min = Infinity, max = -Infinity
        for (const f of hexFeatures) {
            const v = f.properties.value
            if (v < min) min = v
            if (v > max) max = v
        }
        return [min, max]
    }, [hexFeatures])

    // Dominio global (estabiliza colores mientras no cambien metric/bucket/at)
    const [globalDomain, setGlobalDomain] = useState<{ min: number; max: number } | null>(null)
    useEffect(() => {
        if (!hexFeatures?.length) return
        setGlobalDomain(prev => {
            const next = { min: Math.min(prev?.min ?? Infinity, minVal), max: Math.max(prev?.max ?? -Infinity, maxVal) }
            return prev && prev.min === next.min && prev.max === next.max ? prev : next
        })
    }, [hexFeatures, minVal, maxVal])
    useEffect(() => setGlobalDomain(null), [metric, bucket, at])

    const domainMin = globalDomain?.min ?? minVal
    const domainMax = globalDomain?.max ?? maxVal

    const featsToRender = useMemo(() => hexFeatures ?? null, [hexFeatures])

    // Cambio a polígonos cuando zoom alto y pocas features
    const usePolygons = (zoom >= 7) && ((hexFeatures?.length ?? 0) <= 5000)

    // Proyección
    const projectionConfig = useMemo(() => ({ scale: 800, center: [-96, 38] as [number, number] }), [])

    // Leyenda
    const legendStops = useMemo(() => {
        const n = palette.length
        return Array.from({ length: n }, (_, i) => domainMin + ((domainMax - domainMin) * i) / (n - 1))
    }, [domainMin, domainMax])

    // ---- tamaño de puntos “constante” en pantalla (corrige el problema a zoom alto)
    const baseZoom = 4
    const baseRadiusPx = 2.2
    const scale = Math.max(1, zoom / baseZoom)
    const pointRadius = Math.min(4, Math.max(0.6, baseRadiusPx / scale))
    const pointStroke = Math.min(1, Math.max(0.2, 0.5 / scale))
    // ------------------------------------------------------------------------------

    return (
        <div className="w-full">
            {/* Controles */}
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                    <span className="text-slate-600">Métrica</span>
                    <select className="rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={metric} onChange={e => setMetric(e.target.value)}>
                        <option value="price">price</option>
                    </select>
                </label>
                <label className="flex items-center gap-2">
                    <span className="text-slate-600">Bucket</span>
                    <select className="rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={bucket} onChange={e => setBucket(e.target.value)}>
                        <option value="day">day</option>
                        <option value="week">week</option>
                        <option value="month">month</option>
                    </select>
                </label>
                <label className="flex items-center gap-2">
                    <span className="text-slate-600">Fecha</span>
                    <select className="rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={at} onChange={e => setAt(e.target.value)}>
                        <option value="2025-09-08">2025-09-08</option>
                    </select>
                </label>
                <div className="ml-auto text-xs text-slate-500">res={resolution} • zoom={zoom.toFixed(2)}</div>
            </div>

            <ComposableMap
                projection="geoAlbersUsa"
                projectionConfig={projectionConfig}
                width={980}
                height={550}
                style={{ width: '100%', height: 'auto' }}
            >
                <ZoomableGroup
                    center={center}
                    zoom={zoom}
                    onMoveEnd={(pos: any) => {
                        const raw = pos && typeof pos.zoom === 'number' && isFinite(pos.zoom) ? pos.zoom : zoom
                        const clamped = Math.max(0.9, Math.min(14, raw))
                        if (clamped !== zoom) setZoom(clamped)
                        const coords =
                            pos && Array.isArray(pos.coordinates) && isFinite(pos.coordinates[0]) && isFinite(pos.coordinates[1])
                                ? (pos.coordinates as [number, number])
                                : center
                        setCenter(coords)
                    }}
                    minZoom={0.9}
                    maxZoom={14}
                    translateExtent={[[0, 0], [980, 550]]}
                >
                    {/* Basemap estados */}
                    <Geographies geography={US_STATES_TOPOJSON}>
                        {({ geographies }: any) =>
                            geographies?.map((geo: any) => (
                                <Geography
                                    key={geo.rsmKey}
                                    geography={geo}
                                    fill="#f8fafc"
                                    stroke="#94a3b8"
                                    strokeWidth={0.5}
                                    style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}
                                />
                            ))
                        }
                    </Geographies>

                    {/* Heatmap */}
                    {featsToRender && featsToRender.length > 0 && (
                        usePolygons ? (
                            // Polígonos
                            <Geographies geography={{ type: 'FeatureCollection', features: featsToRender } as any}>
                                {({ geographies }: any) =>
                                    geographies?.map((geo: any) => (
                                        <Geography
                                            key={geo.rsmKey}
                                            geography={geo}
                                            fill={getColorForValue((geo as any).properties.value, domainMin, domainMax)}
                                            stroke="#2563eb88"
                                            strokeWidth={0.25}
                                            style={{
                                                default: { outline: 'none', opacity: 1, fillOpacity: 1 },
                                                hover: { outline: 'none', opacity: 0.95, fillOpacity: 1 },
                                                pressed: { outline: 'none', opacity: 1, fillOpacity: 1 },
                                            }}
                                        />
                                    ))
                                }
                            </Geographies>
                        ) : (
                            // Puntos con tamaño visual constante (no “medallones” al hacer zoom)
                            <>
                                {featsToRender.map((f, i) => {
                                    const ring = (f.geometry?.coordinates?.[0] as [number, number][]) || []
                                    if (!ring.length) return null
                                    // centroide simple del anillo exterior (en [lon,lat])
                                    const sums = ring.slice(0, -1).reduce<[number, number]>((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0])
                                    const n = Math.max(1, ring.length - 1)
                                    const cx = sums[0] / n
                                    const cy = sums[1] / n
                                    const fill = getColorForValue(f.properties.value, domainMin, domainMax)
                                    return MarkerAny ? (
                                        <MarkerAny key={`pt-${f.properties.id}-${i}`} coordinates={[cx, cy] as [number, number]}>
                                            <circle r={pointRadius} fill={fill} stroke="#ffffff88" strokeWidth={pointStroke} vectorEffect="non-scaling-stroke" />
                                        </MarkerAny>
                                    ) : (
                                        <g key={`pt-${f.properties.id}-${i}`} transform={`translate(${cx},${cy})`}>
                                            <circle r={pointRadius} fill={fill} stroke="#ffffff88" strokeWidth={pointStroke} vectorEffect="non-scaling-stroke" />
                                        </g>
                                    )
                                })}
                            </>
                        )
                    )}
                </ZoomableGroup>
            </ComposableMap>

            {/* Leyenda */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-700">
                <span className="mr-2">Leyenda:</span>
                {palette.map((c, i) => (
                    <span key={i} className="h-3 w-6 rounded" style={{ backgroundColor: c }} title={`${(legendStops[i] ?? 0).toFixed(3)}`} />
                ))}
                <span className="ml-2 text-[10px] text-slate-500">
          {domainMin.toFixed(3)} — {domainMax.toFixed(3)}
        </span>
            </div>

            {fetchError && (
                <div className="mt-2 text-xs text-amber-600">
                    Aviso: no se pudo cargar el heatmap desde el backend ({fetchError}).
                </div>
            )}
        </div>
    )
}
