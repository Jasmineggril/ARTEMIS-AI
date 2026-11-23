import { useAuthStatus, useLogout } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LogOut, User, HelpCircle, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ceresLogo from "@assets/LOGO_CERES_AI_web.png";
import { PRODUCT_NAME } from "@shared/identity";

interface HeaderProps {
  /** When provided, shows the "menu" button that opens the mobile navigation drawer. */
  onOpenMenu?: () => void;
}

export function Header({ onOpenMenu }: HeaderProps) {
  const { data: user } = useAuthStatus();
  const logout = useLogout();
  const [location, setLocation] = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the user menu on navigation, on Escape and on a click/tap outside it.
  useEffect(() => setShowMenu(false), [location]);
  useEffect(() => {
    if (!showMenu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShowMenu(false);
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [showMenu]);

  const logo = (
    <button
      onClick={() => setLocation("/")}
      className="flex items-center gap-2 group shrink-0"
      data-testid="button-header-logo"
      aria-label="Voltar para página inicial"
    >
      <img
        src={ceresLogo}
        alt={PRODUCT_NAME}
        className="h-9 w-9 object-contain group-hover:scale-105 transition-transform"
      />
    </button>
  );

  const menuButton = onOpenMenu && (
    <button
      onClick={onOpenMenu}
      className="lg:hidden inline-flex items-center justify-center w-10 h-10 -ml-1 rounded-lg text-foreground hover:bg-secondary/50 transition-colors"
      aria-label="Abrir menu de navegação"
      data-testid="button-mobile-menu"
      data-tour="main-navigation"
    >
      <Menu className="w-5 h-5" />
    </button>
  );

  if (!user) {
    return (
      <header className="bg-card/95 border-b border-border/50 sticky top-0 z-40 backdrop-blur-sm">
        <div className="h-16 px-3 sm:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            {menuButton}
            {logo}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/login")}
              data-testid="button-login"
            >
              Entrar
            </Button>
            <Button
              size="sm"
              onClick={() => setLocation("/signup")}
              data-testid="button-signup"
            >
              Cadastro
            </Button>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="bg-card/95 border-b border-border/50 sticky top-0 z-40 backdrop-blur-sm">
      <div className="h-16 px-3 sm:px-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 sm:gap-2 min-w-0">
          {menuButton}
          {logo}
        </div>

        <div className="flex items-center gap-1 sm:gap-2 min-w-0">
          <button
            onClick={() => setLocation("/help")}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
            aria-label="Central de ajuda"
            data-testid="button-help"
          >
            <HelpCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Ajuda</span>
          </button>

          <div className="relative min-w-0" ref={menuRef}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-2 px-2.5 sm:px-4 py-2 rounded-lg hover:bg-secondary/50 transition-colors min-w-0"
              aria-haspopup="menu"
              aria-expanded={showMenu}
              aria-label="Menu do usuário"
              data-testid="button-profile-menu"
            >
              <User className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline text-sm font-medium truncate max-w-[150px]">{user.name}</span>
            </button>

            {showMenu && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-1.5rem)] bg-card border border-border/50 rounded-lg shadow-lg overflow-hidden z-50"
                >
                  <div className="px-4 py-3 border-b border-border/30">
                    <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                  <button
                    role="menuitem"
                    onClick={() => { setLocation("/"); setShowMenu(false); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-secondary/50 text-sm"
                    data-testid="button-home-menu"
                  >
                    Página Inicial
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { setLocation("/admin"); setShowMenu(false); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-secondary/50 text-sm"
                    data-testid="button-admin-menu"
                  >
                    Painel Admin
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { logout.mutate(); setShowMenu(false); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-destructive/10 text-sm text-destructive flex items-center gap-2"
                    data-testid="button-logout"
                  >
                    <LogOut className="w-4 h-4" />
                    Sair
                  </button>
                </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
