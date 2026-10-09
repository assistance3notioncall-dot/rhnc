"use client";
export function printHtml(title: string, html: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  const css = Array.from(document.querySelectorAll("style,link[rel=stylesheet]")).map((n) => n.outerHTML).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${css}<style>body{background:#fff;padding:32px;font-family:Inter,system-ui,sans-serif}</style></head><body>${html}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

