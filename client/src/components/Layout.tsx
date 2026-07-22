import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Bell, Settings,
  FileText, Map, BarChart3, Home,
  Flame, MapPinned, ShieldCheck, Database,
  Upload, HelpCircle, TrendingUp
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Header } from "@/components/Header";
import { AccessibilityBar } from "@/components/AccessibilityBar";
import { PRODUCT_NAME, PRODUCT_SUBTITLE } from "@shared/identity";
import ceresLogo from "@assets/LOGO_CERES_AI_1782244864205.png";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { icon: Home,            label: "Início",                    href: "/",              tour: undefined },
    { icon: LayoutDashboard, label: "Visão Geral",               href: "/dashboard",     tour: "dashboard-summary" },
    { icon: MapPinned,       label: "Áreas Monitoradas",         href: "/areas",         tour: "monitored-areas" },
    { icon: Flame,           label: "Análise de Risco",          href: "/risk-analysis", tour: "risk-analysis" },
    { icon: Map,             label: "Mapa de Risco",             href: "/maps",          tour: "risk-map" },
    { icon: Bell,            label: "Alertas Preventivos",       href: "/alerts",        tour: "alerts" },
    { icon: Upload,          label: "Importação de Ocorrências", href: "/data-import",   tour: undefined },
    { icon: Database,        label: "Fontes de Dados",           href: "/data-sources",  tour: undefined },
    { icon: TrendingUp,      label: "Inteligência Operacional",  href: "/insights",      tour: undefined },
    { icon: ShieldCheck,     label: "Protocolos de Prevenção",   href: "/prevention",    tour: undefined },
    { icon: FileText,        label: "Relatórios",                href: "/reports",       tour: "reports" },
    { icon: HelpCircle,      label: "Ajuda",                     href: "/help",          tour: undefined },
    { icon: Settings,        label: "Configurações",             href: "/settings",      tour: undefined },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <Header />
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-full md:w-64 bg-card border-r border-border/50 flex flex-col sticky top-0 md:h-screen z-20">
          {/* Logo */}
          <Link href="/">
            <div
              className="p-4 flex items-center gap-3 border-b border-border/30 cursor-pointer hover:bg-secondary/30 transition-colors group"
              data-testid="button-sidebar-logo"
              title="Página inicial"
            >
              <img
                src={ceresLogo}
                alt={PRODUCT_NAME}
                className="h-10 w-auto group-hover:scale-105 transition-transform"
              />
              <div>
                <h1 className="font-display font-bold text-sm leading-none tracking-tight">{PRODUCT_NAME}</h1>
                <p className="text-xs text-muted-foreground mt-0.5 font-medium leading-snug">
                  {PRODUCT_SUBTITLE}
                </p>
              </div>
            </div>
          </Link>

          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" data-tour="main-navigation">
            {navItems.map((item) => {
              const isActive =
                location === item.href ||
                (item.href !== "/" && location.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 group",
                      isActive
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                    data-testid={`nav-${item.href.replace("/", "") || "inicio"}`}
                    {...(item.tour ? { "data-tour": item.tour } : {})}
                  >
                    <item.icon
                      className={cn(
                        "w-4 h-4 transition-transform group-hover:scale-110 shrink-0",
                        isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                      )}
                    />
                    <span className="text-sm">{item.label}</span>
                    {isActive && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="p-3 m-3 rounded-xl bg-gradient-to-br from-primary/8 to-transparent border border-primary/10">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-semibold text-primary">Sistema Online</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Protótipo em validação controlada — TRL 4
            </p>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
            {children}
          </div>
        </main>
      </div>
      <AccessibilityBar />
    </div>
  );
}
