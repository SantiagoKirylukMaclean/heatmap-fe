import { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import MapGL, { MapRef } from 'react-map-gl/maplibre';
import { cellToLatLng, polygonToCells, cellToParent } from 'h3-js';
import { feature as topojsonFeature } from 'topojson-client';

// ===== Config =====
const API_HOST = (import.meta as any).env?.VITE_API_HOST ?? 'http://localhost:8080';
const MAPTILER_KEY = (import.meta as any).env?.VITE_MAPTILER_KEY as string;

// Forzamos MapTiler Streets (look tipo Google). Sin key => throw claro en red.
const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;

const US_STATES_TOPOJSON =
    'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

// Solo “Lower 48”
const BOUNDS_US_LOWER48: [[number, number], [number, number]] = [
    [-125.00165, 24.9493], // [minLng, minLat]
    [-66.9326, 49.5904],   // [maxLng, maxLat]
];

// Centro y bounds de New Jersey
const NJ_BOUNDS: [[number, number], [number, number]] = [
    [-75.8, 38.8],  // [minLng, minLat]
    [-73.9, 41.4],  // [maxLng, maxLat]
];
const NJ_CENTER = { lng: -74.5, lat: 40.06 };

// Si quieres arrancar más cerca que res=5, cambia este zoom inicial
const START_ZOOM = 3.4; // ~res=5  (prueba 6.2 para ver todo NJ)

// Hasta qué resolución construimos el set exacto de NJ.
// r=9 es razonable para NJ (~decenas de miles de celdas).
const MASK_MAX_SET_RES = 9;

// cache: res -> Set<h3Index>
const njMaskCache = new Map<number, Set<string>>();

// construye (y cachea) el set de celdas de NJ a una resolución dada
function ensureNjMask(geom: PolygonLL, res: number): Set<string> {
    const hit = njMaskCache.get(res);
    if (hit) return hit;
    const idxs = polygonToCells(geom, res, true);
    const set = new Set(idxs);
    njMaskCache.set(res, set);
    return set;
}


// ===== Helpers =====
type ApiTuple = [h3: string, value: number];
type LonLat = [number, number];
type PolygonLL = LonLat[][]; // anillos: exterior + agujeros

const PALETTE: [number, number, number][] = [
    [13, 8, 135], [91, 2, 163], [154, 23, 155], [203, 70, 121],
    [237, 121, 83], [251, 159, 58], [253, 202, 38], [240, 249, 33],
];

const USD_FMT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const MIN_ZOOM = 3.2; // ≈ res 5
const MAX_ZOOM = 9.8; // ≈ res 10

function resFromZoom(z: number) {
    if (z < 4.0) return 5;
    if (z < 5.0) return 6;
    if (z < 6.0) return 7;
    if (z < 7.5) return 8;
    if (z < 9.0) return 9;
    return 10;
}

function colorFor(v: number, min: number, max: number): [number, number, number] {
    if (!Number.isFinite(v) || max <= min) return [226, 232, 240];
    const t = Math.min(0.93, Math.max(0.07, (v - min) / (max - min)));
    const i = Math.min(PALETTE.length - 1, Math.floor(t * (PALETTE.length - 1)));
    return PALETTE[i];
}

function boundsToBbox(map: MapRef | null) {
    const b = map?.getBounds();
    if (!b) return null;
    return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`; // minLat,minLon,maxLat,maxLon
}

function clampBBoxStrToBounds(bbox: string, bounds: [[number, number], [number, number]]) {
    const [s, w, n, e] = bbox.split(',').map(Number);
    const [[minLng, minLat], [maxLng, maxLat]] = bounds;
    return `${Math.max(s, minLat)},${Math.max(w, minLng)},${Math.min(n, maxLat)},${Math.min(e, maxLng)}`;
}

function bboxFromPolygonLL(poly: PolygonLL) {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const ring of poly) for (const [lng, lat] of ring) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    }
    return `${minLat},${minLng},${maxLat},${maxLng}`;
}

function hashBBox(bbox: string) {
    const [s, w, n, e] = bbox.split(',').map(Number);
    const r = (x: number) => x.toFixed(3);
    return `${r(s)},${r(w)},${r(n)},${r(e)}`;
}

const njSetsCache = new Map<number, Set<string>>();

export default function MapWebGL() {
    const mapRef = useRef<MapRef | null>(null);

    const [metric, setMetric] = useState('price');
    const [bucket, setBucket] = useState('day');
    const [at, setAt] = useState('2025-09-08');

    const [viewState, setViewState] = useState({
        longitude: NJ_CENTER.lng,
        latitude: NJ_CENTER.lat,
        zoom: START_ZOOM,
        bearing: 0,
        pitch: 0
    });
    const resolution = useMemo(() => resFromZoom(viewState.zoom), [viewState.zoom]);

    // Geometría de New Jersey
    const [njGeom, setNjGeom] = useState<PolygonLL | null>(null);
    useEffect(() => {
        let alive = true;
        (async () => {
            const topo = await (await fetch(US_STATES_TOPOJSON)).json();
            const statesFc: any = topojsonFeature(topo, (topo as any).objects.states);
            const nj = statesFc.features.find(
                (f: any) => f?.id === 34 || f?.properties?.name === 'New Jersey'
            );
            if (!nj?.geometry) return;
            const geom: PolygonLL =
                nj.geometry.type === 'Polygon'
                    ? (nj.geometry.coordinates as PolygonLL)
                    : (nj.geometry.coordinates as PolygonLL[])[0];
            if (alive) {
                setNjGeom(geom);
                const [s, w, n, e] = bboxFromPolygonLL(geom).split(',').map(Number);
                mapRef.current?.fitBounds([[w, s], [e, n]], { padding: 40, duration: 0 });
            }
        })().catch(console.warn);
        return () => { alive = false; };
    }, []);

    // Cache/estado de datos
    const cache = useRef(new Map<string, ApiTuple[]>());
    const [rows, setRows] = useState<ApiTuple[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch con bbox del viewport o bbox de NJ al inicio
    useEffect(() => {
        if (!njGeom) return;

        const bboxRaw = boundsToBbox(mapRef.current) ?? bboxFromPolygonLL(njGeom);
        const bbox = clampBBoxStrToBounds(bboxRaw, BOUNDS_US_LOWER48);

        // Recorte FE por NJ (r<=8)
        let filterFn: ((row: ApiTuple) => boolean) | null = null;
        if (njGeom) {
            if (resolution <= MASK_MAX_SET_RES) {
                // r<=9: set exacto a esa resolución
                const mask = ensureNjMask(njGeom, resolution);
                filterFn = ([h]) => mask.has(h);
            } else {
                // r=10: usa el parent a r=9 para evitar sets gigantes
                const maskR9 = ensureNjMask(njGeom, MASK_MAX_SET_RES);
                filterFn = ([h]) => maskR9.has(cellToParent(h, MASK_MAX_SET_RES));
            }
        }

        const key = JSON.stringify({ metric, bucket, at, resolution, bbox: hashBBox(bbox) });
        const cached = cache.current.get(key);
        if (cached) {
            setRows(filterFn ? cached.filter(filterFn) : cached);
            setError(null);
            return;
        }

        const ctrl = new AbortController();
        const timer = setTimeout(async () => {
            try {
                setLoading(true);
                const params = new URLSearchParams({
                    metric, bucket, at,
                    resolution: String(resolution),
                    bbox,
                });
                const url = `${API_HOST}/api/v2/heatmap/h3?${params.toString()}`;
                const resp = await fetch(url, { signal: ctrl.signal });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data: ApiTuple[] = await resp.json();
                cache.current.set(key, data);
                setRows(filterFn ? data.filter(filterFn) : data);
                setError(null);
            } catch (e: any) {
                if (e?.name !== 'AbortError') {
                    console.error(e);
                    setError(e?.message || 'fetch error');
                    setRows([]);
                }
            } finally { setLoading(false); }
        }, 150);

        return () => { clearTimeout(timer); ctrl.abort(); };
    }, [metric, bucket, at, resolution, viewState, njGeom]);

    // Dominio de color
    const [min, max] = useMemo(() => {
        if (!rows?.length) return [0, 1];
        let lo = Infinity, hi = -Infinity;
        for (const [, v] of rows) { if (v < lo) lo = v; if (v > hi) hi = v; }
        return [lo, hi];
    }, [rows]);

    // Capa de puntos (tamaño px)
    const layers = useMemo(() => {
        if (!rows) return [];
        return [
            new ScatterplotLayer<ApiTuple>({
                id: 'h3-points',
                data: rows,
                getPosition: d => {
                    const [lat, lon] = cellToLatLng(d[0]); return [lon, lat];
                },
                getFillColor: d => colorFor(d[1], min, max),
                radiusUnits: 'pixels',
                getRadius: 2.6,
                pickable: true,
                updateTriggers: { getFillColor: [min, max] }
            })
        ];
    }, [rows, min, max]);

    // Leyenda
    const legendStops = useMemo(() => {
        const n = PALETTE.length;
        return Array.from({ length: n }, (_, i) => (min + ((max - min) * i) / (n - 1)));
    }, [min, max]);

    return (
        <div className="w-full">
            {/* Controles */}
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                    <span className="text-slate-600">Métrica</span>
                    <select className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                            value={metric} onChange={e => setMetric(e.target.value)}>
                        <option value="price">price</option>
                    </select>
                </label>
                <label className="flex items-center gap-2">
                    <span className="text-slate-600">Bucket</span>
                    <select className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                            value={bucket} onChange={e => setBucket(e.target.value)}>
                        <option value="day">day</option>
                        <option value="week">week</option>
                        <option value="month">month</option>
                    </select>
                </label>
                <label className="flex items-center gap-2">
                    <span className="text-slate-600">Fecha</span>
                    <input type="date" className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                           value={at} onChange={e => setAt(e.target.value)} />
                </label>

                <div className="ml-auto text-xs text-slate-500">
                    res={resolution} • zoom={viewState.zoom.toFixed(2)}
                    {loading && <span className="ml-2 text-slate-400">cargando…</span>}
                    {error && <span className="ml-2 text-amber-600">({error})</span>}
                </div>
            </div>

            {/* Mapa + DeckGL */}
            <DeckGL
                layers={layers}
                controller
                initialViewState={viewState}
                onViewStateChange={(e: any) => {
                    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, e.viewState.zoom));
                    setViewState(v => ({ ...v, ...e.viewState, zoom: z }));
                }}
                getTooltip={(info: any) => info?.object ? { text: USD_FMT.format((info.object as ApiTuple)[1]) } : null}
                getCursor={({ isDragging, isHovering }: any) => isDragging ? 'grabbing' : (isHovering ? 'pointer' : 'grab')}
                style={{ position: 'relative', width: '100%', height: '70vh' }}
            >
                <MapGL
                    ref={mapRef}
                    reuseMaps
                    mapStyle={MAP_STYLE}
                    maxBounds={BOUNDS_US_LOWER48}
                    minZoom={MIN_ZOOM}
                    maxZoom={MAX_ZOOM}
                    dragRotate={false}
                    pitchWithRotate={false}
                    renderWorldCopies={false}
                    onLoad={() => {
                        mapRef.current?.fitBounds(NJ_BOUNDS, { padding: 40, duration: 0 });
                    }}
                    style={{ position: 'absolute', inset: 0 }}
                />
            </DeckGL>

            {/* Leyenda */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-700">
                <span className="mr-2">Leyenda:</span>
                {PALETTE.map((rgb, i) => (
                    <span key={i}
                          className="h-3 w-6 rounded"
                          style={{ backgroundColor: `rgb(${rgb.join(',')})` }}
                          title={`${(legendStops[i] ?? 0).toFixed(3)}`} />
                ))}
                <span className="ml-2 text-[10px] text-slate-500">
          {min.toFixed(3)} — {max.toFixed(3)}
        </span>
            </div>
        </div>
    );
}
