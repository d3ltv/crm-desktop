import React from "react";
import "@/App.css";
import { CrmProvider, useCrm } from "@/context/CrmContext";
import { VoiceSessionProvider } from "@/context/VoiceSessionContext";
import { WorkspacesPage } from "@/components/WorkspacesPage";
import { WorkspacePage } from "@/components/WorkspacePage";
import { CrashRecovery } from "@/components/CrashRecovery";
import { Relia2FeatureTour } from "@/components/Relia2FeatureTour";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";
import { ReliaConsoleApp } from "@/components/ReliaConsoleApp";
import { isReliaConsole, isRelia2Export } from "@/lib/reliaVariant";
import { Toaster } from "sonner";

// ── Router ────────────────────────────────────────────────────────────────────
function Router() {
    const { state, dispatch } = useCrm();

    const workspaceCount = Object.keys(state.workspaces || {}).length;

    const handleRestore = (parsedState) => {
        // Restaurer l'état complet via RESTORE_SNAPSHOT — même chemin que le undo
        dispatch({ type: "RESTORE_SNAPSHOT", snapshot: parsedState });
    };

    return (
        <>
            {/* Détection silencieuse d'anomalie — invisible si tout va bien */}
            <CrashRecovery
                crashError={null}
                currentWorkspaceCount={workspaceCount}
                onRestore={handleRestore}
            />
            {state.currentId ? <WorkspacePage /> : <WorkspacesPage />}
            {/* Relia 2 export-only — assistant proactif (no-op hors variant) */}
            <Relia2FeatureTour />
            {/* MAJ auto = canal Rellia uniquement (pas Relia perso) */}
            {isRelia2Export ? <AppUpdateBanner /> : null}
        </>
    );
}

// ── ErrorBoundary ─────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error("[CRM] Crash capturé :", error, info);
    }

    handleReset() {
        // Réinitialisation douce : on efface le localStorage mais PAS IndexedDB
        // (les backups automatiques sont préservés pour la récupération)
        try {
            localStorage.removeItem("crm_state_v1");
            localStorage.removeItem("crm_state_v1_backup");
        } catch {}
        window.location.reload();
    }

    render() {
        if (this.state.error) {
            return (
                <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-6 p-8 text-center">
                    {/* Le CrashRecovery s'affiche en overlay et propose le backup */}
                    <CrashRecovery
                        crashError={this.state.error}
                        currentWorkspaceCount={0}
                        onRestore={(parsedState) => {
                            // Écrire directement dans localStorage puis recharger
                            // (le provider n'est plus disponible après un crash React)
                            try {
                                const { lastDeleted: _ld, ...persistent } = parsedState;
                                localStorage.setItem("crm_state_v1", JSON.stringify(persistent));
                            } catch {}
                            window.location.reload();
                        }}
                        onDismiss={() => this.setState({ error: null })}
                    />

                    <div className="space-y-2">
                        <h1 className="text-2xl font-semibold">Une erreur est survenue</h1>
                        <p className="text-sm text-muted-foreground max-w-md">
                            {String(this.state.error?.message || this.state.error)}
                        </p>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={() => this.setState({ error: null })}
                            className="px-4 py-2 rounded-full border border-border text-sm hover:bg-muted transition-colors"
                        >
                            Réessayer
                        </button>
                        <button
                            onClick={() => this.handleReset()}
                            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-full text-sm hover:bg-destructive/90 transition-colors"
                        >
                            Réinitialiser l'application
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
    if (isReliaConsole) {
        return (
            <ErrorBoundary>
                <div className="App min-h-screen bg-background text-foreground">
                    <ReliaConsoleApp />
                    <Toaster
                        position="top-center"
                        toastOptions={{
                            className:
                                "rounded-full !shadow-panel !bg-card !text-card-foreground !border-border",
                        }}
                    />
                </div>
            </ErrorBoundary>
        );
    }

    return (
        <ErrorBoundary>
            <CrmProvider>
                <VoiceSessionProvider>
                    <div className="App min-h-screen bg-background text-foreground">
                        <Router />
                        <Toaster
                            position="top-center"
                            toastOptions={{
                                className:
                                    "rounded-full !shadow-panel !bg-card !text-card-foreground !border-border",
                            }}
                        />
                    </div>
                </VoiceSessionProvider>
            </CrmProvider>
        </ErrorBoundary>
    );
}

export default App;
