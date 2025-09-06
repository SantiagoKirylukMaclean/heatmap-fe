import React, { useEffect, useMemo, useState } from 'react'
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps'
import { cellToBoundary } from 'h3-js'

// TopoJSON con los estados de USA (base map para contexto)
const US_STATES_TOPOJSON = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'

interface Props {}

interface H3Item {
  h3Index?: string
  index?: string
  h3?: string
  id?: string
  hex?: string
  value: number
}

interface HexFeatureProperties {
  id: string
  value: number
}

type HexFeature = GeoJSON.Feature<GeoJSON.Polygon, HexFeatureProperties>

// Paleta tipo "plasma" (low -> high)
const palette = ['#0d0887', '#5b02a3', '#9a179b', '#cb4679', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921', '#ffffe0']

function getColorForValue(value: number, min: number, max: number) {
  if (!isFinite(value) || max <= min) return '#e2e8f0'
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)))
  const idx = Math.min(palette.length - 1, Math.floor(t * (palette.length - 1)))
  return palette[idx]
}

function asH3Index(item: H3Item): string | undefined {
  return item.h3Index || item.index || item.h3 || item.hex || item.id
}

function toHexFeature(index: string, value: number): HexFeature {
    // v4: si pones formatAsGeoJson=true te devuelve [lng,lat] y no hace falta invertir
    const ring: [number, number][] = cellToBoundary(index, true) // [[lng,lat], ...]
    return {
        type: 'Feature',
        properties: { id: index, value },
        geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
    }
}

export default function MapUSA(_: Props) {
  const geoUrl = US_STATES_TOPOJSON

  const [hexFeatures, setHexFeatures] = useState<HexFeature[] | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Fetch de datos del backend
  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setFetchError(null)
        const res = await fetch('http://localhost:8080/api/heatmap/h3')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()

        // Caso 1: FeatureCollection ya listo
        if (data && data.type === 'FeatureCollection') {
          const feats: HexFeature[] = (data.features || []).filter((f: any) => f.geometry?.type === 'Polygon')
          if (mounted) setHexFeatures(feats)
          return
        }

        // Caso 2: arreglo de objetos con índice H3 + valor
        if (Array.isArray(data)) {
          const feats: HexFeature[] = []
          for (const it of data as H3Item[]) {
            const idx = asH3Index(it)
            if (!idx || typeof it.value !== 'number') continue
            feats.push(toHexFeature(idx, it.value))
          }
          if (mounted) setHexFeatures(feats)
          return
        }

        throw new Error('Formato de respuesta no soportado')
      } catch (e: any) {
        console.error('Error cargando heatmap:', e)
        if (!mounted) return
        setFetchError(e?.message || 'Fallo al cargar heatmap')
        // Fallback mínimo para desarrollo si el backend no está disponible
        const sample: H3Item[] = [
          { h3Index: '8928308280fffff', value: 1.2 },
          { h3Index: '8928308280bffff', value: 2.8 },
          { h3Index: '8928308280dffff', value: 4.5 },
        ]
        setHexFeatures(sample.map(s => toHexFeature(asH3Index(s)!, s.value)))
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

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
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={projectionConfig}
        width={980}
        height={550}
        style={{ width: '100%', height: 'auto' }}
      >
        <ZoomableGroup zoom={1} minZoom={0.9} maxZoom={8} translateExtent={[[0, 0], [980, 550]]}>
          {/* Basemap de estados para referencia */}
          <Geographies geography={geoUrl}>
            {({ geographies }) =>
              geographies.map(geo => (
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

          {/* Hexágonos del heatmap */}
          {hexFeatures && hexFeatures.length > 0 && (
            <Geographies geography={{ type: 'FeatureCollection', features: hexFeatures } as any}>
              {({ geographies }) =>
                geographies.map(geo => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={getColorForValue((geo as any).properties.value, minVal, maxVal)}
                    stroke="#ffffff88"
                    strokeWidth={0.25}
                    style={{ default: { outline: 'none' }, hover: { outline: 'none', opacity: 0.9 }, pressed: { outline: 'none' } }}
                  />
                ))
              }
            </Geographies>
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
