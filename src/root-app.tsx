import React, { lazy } from 'react'

const MapUSA = lazy(() => import('./sections/map/map-usa'))

export function App() {
  return (
    <div className="container py-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Bienvenido a Heatmap USA</h1>
        <p className="text-sm text-slate-600">
          Esta es una versión inicial. Abajo verás un mapa de los Estados Unidos que pronto será un heatmap de precios.
        </p>
      </header>
      <main className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm p-3 sm:p-4">
          <h2 className="sr-only">Mapa de Estados Unidos</h2>
          <MapUSA />
        </section>
      </main>
      <footer className="text-xs text-slate-500 pb-4">© {new Date().getFullYear()} Heatmap</footer>
    </div>
  )
}
