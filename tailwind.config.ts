import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pri: { DEFAULT: "#2563eb", d: "#1d4ed8", l: "#eaf1ff" },
        bg: "#f4f6fb", line: "#e3e8f0", mut: "#64748b", fg: "#0f172a",
        ok: { DEFAULT: "#15803d", l: "#dcfce7" }, warn: { DEFAULT: "#b45309", l: "#fef3c7" },
        err: { DEFAULT: "#b91c1c", l: "#fee2e2" }, gray2: { DEFAULT: "#475569", l: "#eef2f6" },
        vio: { DEFAULT: "#7c3aed", l: "#ede9fe" }, teal2: { DEFAULT: "#0f766e", l: "#ccfbf1" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "-apple-system", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
