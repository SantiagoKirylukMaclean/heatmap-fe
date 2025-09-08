import 'maplibre-gl/dist/maplibre-gl.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import RootApp from './root-app';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <RootApp />
    </React.StrictMode>
);
