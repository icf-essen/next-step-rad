import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// WICHTIG: "base" muss zum Namen deines GitHub-Repos passen, z. B. bei
// https://github.com/VivianSVZ/next-step-rad -> base: "/next-step-rad/"
export default defineConfig({
  base: "/next-step-rad/",
  // Lokale Entwicklung: API-Aufrufe an die lokal laufende API weiterreichen.
  server: {
    proxy: {
      "/next-step-rad/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // Die API darf nie vom Service Worker beantwortet werden (kein index.html-Fallback, kein Cache).
        navigateFallbackDenylist: [/\/api\//],
      },
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "Next Step Rad",
        short_name: "Next Step",
        description:
          "Wöchentliche Reflexion über Glaube, Beziehungen, Gesundheit, Ressourcen und Arbeit nach dem ICF Next-Step-Rad.",
        lang: "de",
        theme_color: "#B5723C",
        background_color: "#F3EFE4",
        display: "standalone",
        start_url: "/next-step-rad/",
        scope: "/next-step-rad/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
});
