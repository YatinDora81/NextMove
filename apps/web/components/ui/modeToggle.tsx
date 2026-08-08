"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { ThemeToggleButton, useThemeTransition } from "@/components/ui/shadcn-io/theme-toggle-button";

interface ModeToggleProps {
  className?: string;
}

export function ModeToggle({ className }: ModeToggleProps) {
  const { theme, setTheme } = useTheme();
  const { startTransition } = useThemeTransition();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleThemeToggle = React.useCallback(() => {
    startTransition(() => {
      setTheme(theme === "dark" ? "light" : "dark");
    });
  }, [theme, setTheme, startTransition]);

  if (!mounted) {
    return <div className={`size-8 rounded-lg bg-well ${className}`} />;
  }

  const currentTheme = theme === "system" ? "light" : (theme as "light" | "dark");

  return (
    <ThemeToggleButton
      theme={currentTheme}
      onClick={handleThemeToggle}
      variant="circle"
      start="top-right"
      className={className}
    />
  );
}