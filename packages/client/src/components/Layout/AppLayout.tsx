import { type ReactNode, useState } from "react";
import { IconButton, Text, Tooltip } from "@radix-ui/themes";
import {
  BarChart3,
  Calendar,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ConnectionBadge } from "../ConnectionBadge/ConnectionBadge.tsx";
import styles from "./AppLayout.module.css";

export type Page =
  | "dashboard"
  | "stats"
  | "schedules"
  | "settings"
  | "vehicleVisualDev";

interface AppLayoutProps {
  children: ReactNode;
  activePage: Page;
  onNavigate: (page: Page) => void;
  authMode?: string;
  onLogout?: () => void;
}

const NAV_ITEMS: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: "dashboard", label: "Home", icon: LayoutDashboard },
  { page: "stats", label: "Stats", icon: BarChart3 },
  { page: "schedules", label: "Schedules", icon: Calendar },
  { page: "settings", label: "Settings", icon: Settings },
];

const SOURCE_URL = "https://github.com/samlegs31/ChargeHA";
const LICENSE_URL = "https://github.com/samlegs31/ChargeHA/blob/main/LICENSE";

function MobileMenu(
  { activePage, authMode, onLogout, handleNavigate }: {
    activePage: Page;
    authMode?: string;
    onLogout?: () => void;
    handleNavigate: (page: Page) => void;
  },
) {
  return (
    <div className={styles.mobileMenu}>
      <nav className={styles.mobileNav}>
        {NAV_ITEMS.map(({ page, label, icon: Icon }) => (
          <Text
            key={page}
            size="3"
            weight="medium"
            className={activePage === page
              ? styles.mobileNavLinkActive
              : styles.mobileNavLink}
            onClick={() => handleNavigate(page)}
          >
            <Icon size={16} />
            {label}
          </Text>
        ))}
      </nav>
      {authMode && authMode !== "none" && onLogout && (
        <div className={styles.mobileMenuFooter}>
          <Tooltip content="Log out">
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={onLogout}
              aria-label="Log out"
            >
              <LogOut size={14} />
            </IconButton>
          </Tooltip>
          <Text size="2" color="gray">Log out</Text>
        </div>
      )}
    </div>
  );
}

export function AppLayout(
  {
    children,
    activePage,
    onNavigate,
    authMode,
    onLogout,
  }: AppLayoutProps,
) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavigate = (page: Page) => {
    setMobileMenuOpen(false);
    onNavigate(page);
  };

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div
          className={styles.brand}
          onClick={() => handleNavigate("dashboard")}
          aria-label="E.V. Solar"
        >
          <picture className={styles.brandLogo}>
            <source
              srcSet="/ev-solar-logo-dark-exact.webp"
              media="(prefers-color-scheme: dark)"
            />
            <img src="/ev-solar-logo-exact.webp" alt="E.V. Solar" />
          </picture>
        </div>
        <nav className={styles.nav}>
          {NAV_ITEMS.map(({ page, label }) => (
            <Text
              key={page}
              size="2"
              weight="medium"
              className={activePage === page
                ? styles.navLinkActive
                : styles.navLink}
              onClick={() => onNavigate(page)}
            >
              {label}
            </Text>
          ))}
        </nav>
        <div className={styles.status}>
          <ConnectionBadge />
          {authMode && authMode !== "none" && onLogout && (
            <span className={styles.statusLogout}>
              <Tooltip content="Log out">
                <IconButton
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={onLogout}
                  aria-label="Log out"
                >
                  <LogOut size={14} />
                </IconButton>
              </Tooltip>
            </span>
          )}
        </div>
        {/* Mobile hamburger button */}
        <IconButton
          size="2"
          variant="ghost"
          color="gray"
          className={styles.menuButton}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        >
          {mobileMenuOpen
            ? <X size={26} strokeWidth={2.4} />
            : <Menu size={26} strokeWidth={2.4} />}
        </IconButton>
      </header>
      {mobileMenuOpen && (
        <MobileMenu
          activePage={activePage}
          authMode={authMode}
          onLogout={onLogout}
          handleNavigate={handleNavigate}
        />
      )}
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <Text size="1" color="gray">
          E.V. Solar · {" "}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">Source code</a>
          {" · "}
          <a href={LICENSE_URL} target="_blank" rel="noreferrer">AGPL-3.0</a>
          {" · Provided without warranty"}
        </Text>
      </footer>
    </div>
  );
}
