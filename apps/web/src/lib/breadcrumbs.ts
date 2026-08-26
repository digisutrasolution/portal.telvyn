import { navItemForPath } from "./nav";

export interface Crumb {
  label: string;
  href: string;
  current: boolean;
}

/**
 * Derive breadcrumbs from a pathname using the nav config. Pure — unit tested.
 * "/" → [Operations]; "/numbers" → [Numbers]; "/numbers/abc" → [Numbers, abc].
 */
export function breadcrumbsForPath(pathname: string): Crumb[] {
  const item = navItemForPath(pathname);
  if (!item) return [{ label: "Not found", href: pathname, current: true }];

  const crumbs: Crumb[] = [{ label: item.label, href: item.href, current: pathname === item.href }];
  if (pathname !== item.href && item.href !== "/") {
    const rest = pathname.slice(item.href.length).split("/").filter(Boolean);
    let acc = item.href;
    for (const [i, seg] of rest.entries()) {
      acc += `/${seg}`;
      crumbs.push({ label: decodeURIComponent(seg), href: acc, current: i === rest.length - 1 });
    }
  }
  return crumbs;
}
