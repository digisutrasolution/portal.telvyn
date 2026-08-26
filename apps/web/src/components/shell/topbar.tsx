"use client";

import { Breadcrumbs } from "./breadcrumbs";
import { SearchButton } from "./search-button";
import { MobileNav } from "./mobile-nav";
import { TenantSelector } from "./tenant-selector";
import { RegionSelector } from "./region-selector";
import { HealthIndicator } from "./health-indicator";
import { Notifications } from "./notifications";
import { ThemeSelector } from "./theme-selector";
import { UserMenu } from "./user-menu";
import { Separator } from "@/components/ui/separator";

/** Top navigation bar: context (breadcrumbs) + global controls. */
export function Topbar() {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-canvas/95 px-3 backdrop-blur-sm md:px-5">
      <MobileNav />
      <div className="hidden min-w-0 md:block">
        <Breadcrumbs />
      </div>
      <div className="flex flex-1 justify-center px-2">
        <SearchButton />
      </div>
      <div className="flex items-center gap-0.5">
        <HealthIndicator />
        <Separator orientation="vertical" className="mx-1.5 hidden h-5 md:block" />
        <TenantSelector />
        <RegionSelector />
        <Separator orientation="vertical" className="mx-1.5 hidden h-5 sm:block" />
        <Notifications />
        <ThemeSelector />
        <UserMenu />
      </div>
    </header>
  );
}
