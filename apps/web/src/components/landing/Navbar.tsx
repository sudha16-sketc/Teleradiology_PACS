"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const NAV_LINKS = [
  { label: "Platform", href: "#platform" },
  { label: "Workflow", href: "#workflow" },
  { label: "Features", href: "#features" },
  { label: "Security", href: "#security" },
  { label: "About", href: "#about" },
];

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const scrolledRef = useRef(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY > 8;
      if (scrolled !== scrolledRef.current) {
        scrolledRef.current = scrolled;
        setIsScrolled(scrolled);
      }
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 bg-white/95 backdrop-blur-sm transition-shadow duration-300 ${
        isScrolled ? "shadow-lg shadow-navy-900/10" : "shadow-none"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="text-xl font-extrabold tracking-tight text-navy-900"
        >
          A<span className="text-primary">xis</span>
        </Link>

        <div className="hidden items-center gap-8 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-navy-900 transition-colors hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-4 lg:flex">
          <Link
            href="/login"
            className="text-sm font-medium text-navy-900 transition-colors hover:text-primary"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            Get Started
          </Link>
        </div>

        <button
          type="button"
          aria-label={isOpen ? "Close menu" : "Open menu"}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="relative flex h-10 w-10 items-center justify-center rounded-md lg:hidden"
        >
          <span
            className={`absolute h-0.5 w-6 rounded-full bg-navy-900 transition-all duration-300 ${
              isOpen ? "translate-y-0 rotate-45" : "-translate-y-2"
            }`}
          />
          <span
            className={`absolute h-0.5 w-6 rounded-full bg-navy-900 transition-all duration-300 ${
              isOpen ? "opacity-0" : "opacity-100"
            }`}
          />
          <span
            className={`absolute h-0.5 w-6 rounded-full bg-navy-900 transition-all duration-300 ${
              isOpen ? "translate-y-0 -rotate-45" : "translate-y-2"
            }`}
          />
        </button>
      </nav>

      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-in-out lg:hidden ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0">
          <div className="border-t border-border bg-white px-4 pb-6 pt-2 sm:px-6">
            <nav className="flex flex-col divide-y divide-border">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className="py-3 text-base font-medium text-navy-900 transition-colors hover:text-primary"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="mt-4 flex flex-col gap-3 sm:mt-6">
              <Link
                href="/login"
                onClick={() => setIsOpen(false)}
                className="rounded-lg border border-border px-5 py-2.5 text-center text-sm font-medium text-navy-900 transition-colors hover:border-primary hover:text-primary"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                onClick={() => setIsOpen(false)}
                className="rounded-lg bg-primary px-5 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}