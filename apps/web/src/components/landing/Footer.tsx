import Link from "next/link";
import { phoneHref } from "@/lib/phone";
import { siteConfig } from "@/lib/site-config";

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const contactLinks: FooterLink[] = [];
if (siteConfig.supportEmail) {
  contactLinks.push({
    label: siteConfig.supportEmail,
    href: `mailto:${siteConfig.supportEmail}`,
    external: true,
  });
}
const supportPhoneHref = phoneHref(siteConfig.supportPhone);
if (supportPhoneHref) {
  contactLinks.push({
    label: siteConfig.supportPhone,
    href: supportPhoneHref,
    external: true,
  });
}

const columns: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Platform", href: "#platform" },
      { label: "Workflow", href: "#workflow" },
      { label: "Features", href: "#features" },
      { label: "Security", href: "#security" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Documentation", href: "/documentation" },
      { label: "Support", href: "/documentation#resources" },
      { label: "FAQ", href: "/documentation#faq" },
    ],
  },
  {
    heading: "Company",
    links: [{ label: "About", href: "/#about" }, ...contactLinks],
  },
];

export default function Footer() {
  return (
    <footer className="bg-navy-950 py-16 text-slate-300">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 min-[420px]:grid-cols-2 md:grid-cols-3 md:gap-10">
          {columns.map((column) => (
            <div key={column.heading}>
              <h3 className="text-sm font-semibold text-white">{column.heading}</h3>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        className="break-all text-sm text-slate-400 transition-colors hover:text-white"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-slate-400 transition-colors hover:text-white"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row">
          <p className="text-sm text-slate-500">
            © {new Date().getFullYear()} Axis. All rights reserved.
          </p>
          <Link
            href="/login"
            className="text-sm font-medium text-slate-300 transition-colors hover:text-white"
          >
            Sign In
          </Link>
        </div>
      </div>
    </footer>
  );
}
