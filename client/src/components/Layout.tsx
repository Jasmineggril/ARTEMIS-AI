import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Bell, Settings,
  FileText, Map, Home,
  Flame, MapPinned, ShieldCheck, Database,
  Upload, HelpCircle, TrendingUp
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Header } from "@/components/Header";
import { AccessibilityBar } from "@/components/AccessibilityBar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PRODUCT_NAME, PRODUCT_SUBTITLE } from "@shared/identity";
import ceresLogo from "@assets/LOGO_CERES_AI_web.png";

interface LayoutProps {
  children: React.ReactNode;
}

const NAV_ITEMS = [
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

/** Logo, navigation and status box — used by the desktop sidebar and the mobile drawer. */
function SidebarContent({ location, onNavigate }: { location: string; onNavigate?: () => void }) {
  return (
    <>
      {/* Logo */}
      <Link href="/" onClick={onNavigate}>
        <div
          className="p-4 flex items-center gap-3 border-b border-border/30 cursor-pointer hover:bg-secondary/30 transition-colors group"
          data-testid="button-sidebar-logo"
          title="Página inicial"
        >
          <img
            src={ceresLogo}
            alt={PRODUCT_NAME}
            className="h-10 w-10 shrink-0 object-contain group-hover:scale-105 transition-transform"
          />
          <div className="min-w-0">
            <p className="font-display font-bold text-sm leading-none tracking-tight">{PRODUCT_NAME}</p>
            <p className="text-xs text-muted-foreground mt-0.5 font-medium leading-snug">
              {PRODUCT_SUBTITLE}
            </p>
          </div>
        </div>
      </Link>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" data-tour="main-navigation" aria-label="Navegação principal">
        {NAV_ITEMS.map((item) => {
          const isActive =
            location === item.href ||
            (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} onClick={onNavigate}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 lg:py-2 rounded-lg cursor-pointer transition-all duration-200 group",
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
                aria-current={isActive ? "page" : undefined}
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
    </>
  );
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location]);

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <Header onOpenMenu={() => setMobileNavOpen(true)} />
      <div className="flex flex-1 min-w-0">
        {/* Sidebar — permanent from 1024px; below that the drawer is used */}
        <aside className="hidden lg:flex w-64 shrink-0 bg-card border-r border-border/50 flex-col sticky top-16 h-[calc(100vh-4rem)] z-20">
          <SidebarContent location={location} />
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          <div className="max-w-7xl mx-auto px-4 pt-6 pb-24 sm:px-6 lg:p-8 space-y-8 animate-in fade-in duration-500">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile / tablet navigation drawer */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-[85vw] max-w-xs p-0 gap-0 flex flex-col bg-card lg:hidden"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <SidebarContent location={location} onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <AccessibilityBar />
    </div>
  );
}
