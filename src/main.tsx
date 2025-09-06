import React, { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './root-app'

const rootEl = document.getElementById('root')!
createRoot(rootEl).render(
  <React.StrictMode>
    <Suspense fallback={<div className="flex items-center justify-center p-8">Cargando…</div>}>
      <App />
    </Suspense>
  </React.StrictMode>
)
