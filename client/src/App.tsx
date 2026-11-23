import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense, useEffect } from "react";
import { useAuthStatus } from "@/hooks/use-auth";
import Home from "@/pages/Home";
import { OnboardingTour } from "@/components/OnboardingTour";

// Pages are loaded on demand: the first visit (especially on mobile networks)
// downloads only the code of the page being opened.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Sensors = lazy(() => import("@/pages/Sensors"));
const SensorDetails = lazy(() => import("@/pages/SensorDetails"));
const Alerts = lazy(() => import("@/pages/Alerts"));
const Reports = lazy(() => import("@/pages/Reports"));
const Admin = lazy(() => import("@/pages/Admin"));
const Login = lazy(() => import("@/pages/Login"));
const Signup = lazy(() => import("@/pages/Signup"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const CeresMaps = lazy(() => import("@/pages/CeresMaps"));
const CeresInsights = lazy(() => import("@/pages/CeresInsights"));
const RiskAnalysis = lazy(() => import("@/pages/RiskAnalysis"));
const Areas = lazy(() => import("@/pages/Areas"));
const Prevention = lazy(() => import("@/pages/Prevention"));
const Settings = lazy(() => import("@/pages/Settings"));
const Help = lazy(() => import("@/pages/Help"));
const DataImport = lazy(() => import("@/pages/DataImport"));
const DataSources = lazy(() => import("@/pages/DataSources"));
const NotFound = lazy(() => import("@/pages/not-found"));

function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#F5F7F8" }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#0F5132", borderTopColor: "transparent" }} />
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { data: user, isLoading } = useAuthStatus();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return <FullPageSpinner label="Verificando acesso..." />;
  }

  if (!user) return null;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/reset-password" component={ResetPassword} />
      {/* Public — analysis page accessible without login */}
      <Route path="/simulacao" component={RiskAnalysis} />
      <Route path="/risk-analysis" component={RiskAnalysis} />
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/sensors"><ProtectedRoute component={Sensors} /></Route>
      <Route path="/sensors/:id"><ProtectedRoute component={SensorDetails} /></Route>
      <Route path="/alerts"><ProtectedRoute component={Alerts} /></Route>
      <Route path="/reports"><ProtectedRoute component={Reports} /></Route>
      <Route path="/admin"><ProtectedRoute component={Admin} /></Route>
      <Route path="/maps"><ProtectedRoute component={CeresMaps} /></Route>
      <Route path="/insights"><ProtectedRoute component={CeresInsights} /></Route>
      <Route path="/areas"><ProtectedRoute component={Areas} /></Route>
      <Route path="/prevention"><ProtectedRoute component={Prevention} /></Route>
      <Route path="/data-import"><ProtectedRoute component={DataImport} /></Route>
      <Route path="/data-sources"><ProtectedRoute component={DataSources} /></Route>
      {/* Legacy redirects */}
      <Route path="/aprende"><ProtectedRoute component={Prevention} /></Route>
      <Route path="/comunidade"><ProtectedRoute component={Prevention} /></Route>
      <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
      <Route path="/help"><ProtectedRoute component={Help} /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Suspense fallback={<FullPageSpinner label="Carregando..." />}>
          <Router />
        </Suspense>
        <OnboardingTour />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
