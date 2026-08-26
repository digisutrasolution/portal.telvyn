"use client";

import { Menu } from "lucide-react";
import { useShell } from "./shell-provider";
import { Brand } from "./brand";
import { NavList } from "./nav-list";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

/** Mobile navigation — left sheet, same NavList as the desktop rail. */
export function MobileNav() {
  const { mobileNavOpen, setMobileNavOpen } = useShell();

  return (
    <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu aria-hidden strokeWidth={1.5} />
        </Button>
      </DialogTrigger>
      <SheetContent aria-describedby={undefined}>
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="px-3 pb-2 pt-3">
          <Brand />
        </div>
        <Separator className="mb-2" />
        <NavList onNavigate={() => setMobileNavOpen(false)} />
      </SheetContent>
    </Dialog>
  );
}
