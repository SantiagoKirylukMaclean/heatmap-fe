import MapWebGL from './sections/map/map-webgl';

export default function RootApp() {
    return (
        <div className="container py-8 space-y-6">
            <header className="space-y-2">
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Bienvenido a Heatmap USA</h1>
                <p className="text-sm text-slate-600">
                    Versión MVP con base gratuita tipo “Google” y límites de estados.
                </p>
            </header>

            <main>
                <MapWebGL />
            </main>

            <footer className="text-xs text-slate-500 pt-4">
                © {new Date().getFullYear()} Heatmap
            </footer>
        </div>
    );
}
