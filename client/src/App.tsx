import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import { useAuthStatus } from "@/hooks/use-auth";
import Home from "@/pages/Home";
import Dashboard from "@/pages/Dashboard";
import Sensors from "@/pages/Sensors";
import SensorDetails from "@/pages/SensorDetails";
import Alerts from "@/pages/Alerts";
import Reports from "@/pages/Reports";
import Admin from "@/pages/Admin";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import ResetPassword from "@/pages/ResetPassword";
import CeresMaps from "@/pages/CeresMaps";
import CeresInsights from "@/pages/CeresInsights";
import RiskAnalysis from "@/pages/RiskAnalysis";
import Areas from "@/pages/Areas";
import Prevention from "@/pages/Prevention";
import Settings from "@/pages/Settings";
import Help from "@/pages/Help";
import DataImport from "@/pages/DataImport";
import DataSources from "@/pages/DataSources";
import NotFound from "@/pages/not-found";
import Organization from "@/pages/Organization";
import Privacy from "@/pages/Privacy";
import { OnboardingTour } from "@/components/OnboardingTour";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { data: user, isLoading } = useAuthStatus();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F5F7F8" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#0F5132", borderTopColor: "transparent" }} />
          <p className="text-sm text-gray-500">Verificando acesso...</p>
        </div>
      </div>
    );
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
      <Route path="/privacidade" component={Privacy} />
      <Route path="/organization" component={() => <ProtectedRoute component={Organization} />} />
      {/* Public — analysis page accessible without login */}
      <Route path="/simulacao" component={RiskAnalysis} />
      <Route path="/risk-analysis" component={RiskAnalysis} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/sensors" component={() => <ProtectedRoute component={Sensors} />} />
      <Route path="/sensors/:id" component={() => <ProtectedRoute component={SensorDetails} />} />
      <Route path="/alerts" component={() => <ProtectedRoute component={Alerts} />} />
      <Route path="/reports" component={() => <ProtectedRoute component={Reports} />} />
      <Route path="/admin" component={() => <ProtectedRoute component={Admin} />} />
      <Route path="/maps" component={() => <ProtectedRoute component={CeresMaps} />} />
      <Route path="/insights" component={() => <ProtectedRoute component={CeresInsights} />} />
      <Route path="/areas" component={() => <ProtectedRoute component={Areas} />} />
      <Route path="/prevention" component={() => <ProtectedRoute component={Prevention} />} />
      <Route path="/data-import" component={() => <ProtectedRoute component={DataImport} />} />
      <Route path="/data-sources" component={() => <ProtectedRoute component={DataSources} />} />
      {/* Legacy redirects */}
      <Route path="/aprende" component={() => <ProtectedRoute component={Prevention} />} />
      <Route path="/comunidade" component={() => <ProtectedRoute component={Prevention} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={Settings} />} />
      <Route path="/help" component={() => <ProtectedRoute component={Help} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <OnboardingTour />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
