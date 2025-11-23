"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Toaster } from "react-hot-toast"

export function ThemeAwareToaster() {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  const isDark = resolvedTheme === "dark"

  const baseStyle = isDark
    ? {
        borderRadius: "10px",
        background: "#333",
        color: "#fff",
      }
    : {
        borderRadius: "10px",
        background: "#ffffff",
        color: "#0f172a",
        border: "1px solid rgba(15, 23, 42, 0.12)",
        boxShadow: "0 18px 30px rgba(15, 23, 42, 0.15)",
      }

  return (
    <Toaster
      position="bottom-right"
      gutter={12}
      toastOptions={{
        duration: 4000,
        style: baseStyle,
        success: {
          iconTheme: {
            primary: isDark ? "#22c55e" : "#16a34a",
            secondary: isDark ? "#0f172a" : "#ffffff",
          },
        },
        error: {
          iconTheme: {
            primary: isDark ? "#fb7185" : "#ef4444",
            secondary: isDark ? "#0f172a" : "#ffffff",
          },
        },
      }}
    />
  )
}

