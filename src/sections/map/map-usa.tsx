import React, { useEffect, useMemo, useState } from 'react'
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps'
import * as RSM from 'react-simple-maps'
import { apiConfig } from '../../config'

// react-simple-maps typings in this version might not export Marker; use any-typed alias if present at runtime.
const MarkerAny: any = (RSM as any)?.Marker
import { asH3Index, buildHexFeature, sanitizePolygonFeature, type HexFeature, type H3Item } from './hex-helpers'

// TopoJSON con los estados de USA (base map para contexto)
const US_STATES_TOPOJSON = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'

interface Props {}


// Paleta tipo "plasma" (low -> high)
const palette = ['#0d0887', '#5b02a3', '#9a179b', '#cb4679', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921', '#ffffe0']

function getColorForValue(value: number, min: number, max: number) {
  if (!isFinite(value) || max <= min) return '#e2e8f0'
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)))
  const idx = Math.min(palette.length - 1, Math.floor(t * (palette.length - 1)))
  return palette[idx]
}


export default function MapUSA(_: Props) {
  const geoUrl = US_STATES_TOPOJSON

  // Debug: set VITE_DEBUG_ONE_HEX=1 to render a single hex and log sample coords
  const debugOneHex: boolean = ((import.meta as any).env?.VITE_DEBUG_ONE_HEX === '1') || ((import.meta as any).env?.VITE_DEBUG_ONE_HEX === 'true')

  const [hexFeatures, setHexFeatures] = useState<HexFeature[] | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Controles
  const metricOptions = useMemo(() => ['price'], [])
  const bucketOptions = useMemo(() => ['day', 'week', 'month'], [])
  const dateOptions = useMemo(() => [
    '2025-08-25',
    '2025-08-24',
    '2025-08-23',
  ], [])

  const [metric, setMetric] = useState<string>(metricOptions[0])
  const [bucket, setBucket] = useState<string>(bucketOptions[0])
  const [at, setAt] = useState<string>(dateOptions[0])

  // Zoom y resolución H3
  const [zoom, setZoom] = useState<number>(1)
  const resolution = useMemo(() => {
    // Mapear zoom -> resolución H3 (ajustable según necesidad)
    if (zoom < 1.2) return 5
    if (zoom < 2) return 6
    if (zoom < 3) return 7
    if (zoom < 4) return 8
    if (zoom < 5) return 9
    return 10
  }, [zoom])

  // Fetch de datos del backend con query params
  useEffect(() => {
    const controller = new AbortController()
    let mounted = true
    async function load() {
      try {
        setFetchError(null)
        const params = new URLSearchParams({
          metric,
          resolution: String(resolution),
          bucket,
          at,
        })
        const url = `${apiConfig.apiHost}/api/heatmap/h3?${params.toString()}`
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!mounted) return

        // Caso 1: FeatureCollection ya listo
        if (data && data.type === 'FeatureCollection') {
          const feats: HexFeature[] = (data.features || [])
            .map((f: any) => sanitizePolygonFeature(f))
            .filter((f: HexFeature | null): f is HexFeature => !!f)
          setHexFeatures(feats)
          return
        }

        // Caso 2: arreglo de objetos con índice H3 + valor
        if (Array.isArray(data)) {
          const feats: HexFeature[] = []
          for (const it of data as H3Item[]) {
            const idx = asH3Index(it)
            if (!idx || typeof it.value !== 'number') continue
            const f = buildHexFeature(idx, it.value)
            if (f) feats.push(f)
          }
          setHexFeatures(feats)
          return
        }

        throw new Error('Formato de respuesta no soportado')
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        console.error('Error cargando heatmap:', e)
        if (!mounted) return
        setFetchError(e?.message || 'Fallo al cargar heatmap')
        // Fallback mínimo para desarrollo si el backend no está disponible
        const sample: H3Item[] = [
          { h3Index: '8928308280fffff', value: 1.2 },
          { h3Index: '8928308280bffff', value: 2.8 },
          { h3Index: '8928308280dffff', value: 4.5 },
        ]
        const feats = sample
          .map(s => {
            const idx = asH3Index(s)
            return idx ? buildHexFeature(idx, s.value) : null
          })
          .filter((f: HexFeature | null): f is HexFeature => !!f)
        setHexFeatures(feats)
      }
    }
    load()
    return () => {
      mounted = false
      controller.abort()
    }
  }, [metric, bucket, at, resolution])

  // Extremos para la escala de color
  const [minVal, maxVal] = useMemo(() => {
    if (!hexFeatures || hexFeatures.length === 0) return [0, 1]
    let min = Infinity
    let max = -Infinity
    for (const f of hexFeatures) {
      const v = f.properties.value
      if (v < min) min = v
      if (v > max) max = v
    }
    return [min, max]
  }, [hexFeatures])

  // DEV: log one sample point to ensure [lng,lat] and sane ranges
  useEffect(() => {
    if (!(import.meta as any).env?.DEV) return
    if (!hexFeatures || hexFeatures.length === 0) return
    const ring = hexFeatures[0]?.geometry?.coordinates?.[0]
    const pt = Array.isArray(ring) && ring.length > 0 ? ring[0] : null
    // Expected like [-122.4, 37.7]
    console.log('[DEBUG] First hex point (lng,lat), ringLen:', pt, Array.isArray(ring) ? ring.length : 0)
    if (pt) {
      const [lng, lat] = pt
      if (Math.abs(lng) > 180 || Math.abs(lat) > 90) {
        console.warn('[DEBUG] Suspicious coord range (expect lng in -180..180, lat in -90..90):', pt)
      }
    }
  }, [hexFeatures])

  useEffect(() => {
    if (!(import.meta as any).env?.DEV) return
    console.log('[DEBUG] Value range:', { min: minVal, max: maxVal })
  }, [minVal, maxVal])

  const featsToRender = useMemo(() => {
    if (!hexFeatures || hexFeatures.length === 0) return null as HexFeature[] | null
    return debugOneHex ? [hexFeatures[0]] : hexFeatures
  }, [hexFeatures, debugOneHex])

  const minPolygonZoomByRes: Record<number, number> = { 5: 1.2, 6: 2, 7: 3, 8: 4, 9: 5, 10: 6 }
  const usePolygons = zoom >= (minPolygonZoomByRes[resolution] ?? 3)

  const projectionConfig = useMemo(() => ({ scale: 800, center: [-96, 38] as [number, number] }), [])

  const legendStops = useMemo(() => {
    const steps = palette.length
    const vals: number[] = []
    for (let i = 0; i < steps; i++) {
      vals.push(minVal + ((maxVal - minVal) * i) / (steps - 1))
    }
    return vals
  }, [minVal, maxVal])

  return (
    <div className="w-full">
      {/* Controles */}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-600">Métrica</span>
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            value={metric}
            onChange={e => setMetric(e.target.value)}
          >
            {metricOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-600">Bucket</span>
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            value={bucket}
            onChange={e => setBucket(e.target.value)}
          >
            {bucketOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-600">Fecha</span>
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            value={at}
            onChange={e => setAt(e.target.value)}
          >
            {dateOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
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
          center={[-96, 38]}
          zoom={zoom}
          onMoveEnd={(pos: any) => {
            const raw = pos && typeof pos.zoom === 'number' && isFinite(pos.zoom) ? pos.zoom : zoom
            const clamped = Math.max(0.9, Math.min(8, raw))
            if (clamped !== zoom) setZoom(clamped)
          }}
          minZoom={0.9}
          maxZoom={8}
          translateExtent={[[0, 0], [980, 550]]}
        >
          {/* Basemap de estados para referencia */}
          <Geographies geography={geoUrl}>
            {({ geographies }: any) =>
              Array.isArray(geographies)
                ? geographies.map((geo: any) => (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill="#f8fafc"
                      stroke="#94a3b8"
                      strokeWidth={0.5}
                      style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}
                    />
                  ))
                : null
            }
          </Geographies>

          {/* Hexágonos del heatmap */}
          {featsToRender && featsToRender.length > 0 && (
            usePolygons ? (
              <Geographies geography={{ type: 'FeatureCollection', features: featsToRender } as any}>
                {({ geographies }: any) =>
                  Array.isArray(geographies)
                    ? geographies.map((geo: any) => (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          fill={getColorForValue((geo as any).properties.value, minVal, maxVal)}
                          stroke="#ffffff88"
                          strokeWidth={debugOneHex ? 0.8 : 0.25}
                          style={{ default: { outline: 'none' }, hover: { outline: 'none', opacity: 0.9 }, pressed: { outline: 'none' } }}
                        />
                      ))
                    : null
                }
              </Geographies>
            ) : (
              <>
                {featsToRender.map((f, i) => {
                  const ring = (f.geometry?.coordinates?.[0] as [number, number][]) || []
                  if (!Array.isArray(ring) || ring.length === 0) return null
                  const first = ring[0]
                  const last = ring[ring.length - 1]
                  const ringPts = (first && last && first[0] === last[0] && first[1] === last[1]) ? ring.slice(0, -1) : ring
                  if (ringPts.length === 0) return null
                  const sums = ringPts.reduce<[number, number]>((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0])
                  const cx = sums[0] / ringPts.length
                  const cy = sums[1] / ringPts.length
                  const fill = getColorForValue(f.properties.value, minVal, maxVal)
                  return (
                    MarkerAny ? (
                      <MarkerAny key={`pt-${f.properties.id}-${i}`} coordinates={[cx, cy] as [number, number]}>
                        <circle r={2.2} fill={fill} stroke="#ffffff88" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
                      </MarkerAny>
                    ) : (
                      <g key={`pt-${f.properties.id}-${i}`} transform={`translate(${cx},${cy})`}>
                        <circle r={2.2} fill={fill} stroke="#ffffff88" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
                      </g>
                    )
                  )
                })}
              </>
            )
          )}
        </ZoomableGroup>
      </ComposableMap>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-700">
        <span className="mr-2">Leyenda:</span>
        {palette.map((c, i) => (
          <span key={i} className="h-3 w-6 rounded" style={{ backgroundColor: c }} title={`${legendStops[i]?.toFixed(2) ?? ''}`} />
        ))}
        <span className="ml-2 text-[10px] text-slate-500">
          {minVal.toFixed(2)} — {maxVal.toFixed(2)}
        </span>
      </div>

      {fetchError && (
        <div className="mt-2 text-xs text-amber-600">
          Aviso: no se pudo cargar el heatmap desde el backend ({fetchError}). Se muestra un ejemplo mínimo.
        </div>
      )}
    </div>
  )
}
