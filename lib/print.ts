"use client";
/**
 * Ouvre une fenêtre d'impression (→ « Enregistrer en PDF »).
 * Format A4 ; chaque bulletin (.payslip) est réduit automatiquement pour tenir sur une seule page.
 */
export function printHtml(title: string, html: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  const css = Array.from(document.querySelectorAll("style,link[rel=stylesheet]")).map((n) => n.outerHTML).join("");
  const page = `<style>
    @page { size: A4 portrait; margin: 8mm; }
    html, body { background: #fff !important; }
    body { margin: 0; padding: 0; font-family: Inter, system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .payslip { max-width: 820px !important; width: 820px; margin: 0 auto; font-size: 12px !important; }
    /* bulletin compact à l'impression : moins d'espaces verticaux */
    .payslip .mb-5 { margin-bottom: 8px !important; }
    .payslip .mb-4 { margin-bottom: 6px !important; }
    .payslip .mt-6 { margin-top: 8px !important; }
    .payslip .pb-3 { padding-bottom: 6px !important; }
    .payslip .py-4 { padding-top: 8px !important; padding-bottom: 8px !important; }
    .payslip .py-1\\.5 { padding-top: 2px !important; padding-bottom: 2px !important; }
    .payslip .gap-4 { gap: 8px !important; }
    .payslip .gap-3 { gap: 6px !important; }
    .payslip [style*="height: 90px"] { height: 55px !important; }
    .payslip, .payslip * { break-inside: avoid; page-break-inside: avoid; }
    .slip-page { break-after: page; page-break-after: always; }
    .slip-page:last-child { break-after: auto; page-break-after: auto; }
    @media screen { body { padding: 16px; } }
  </style>`;
  // Réduction pour tenir sur une page A4 : 194 × 281 mm utiles ≈ 733 × 1062 px
  const fit = `<script>
    function fitA4(){
      var W = 733, H = 1000; // marge de sécurité (en-têtes du navigateur)
      document.querySelectorAll('.payslip').forEach(function(el){
        el.style.zoom = 1;
        var z = Math.min(1, W / el.offsetWidth, H / el.offsetHeight);
        el.style.zoom = String(Math.floor(z * 1000) / 1000);
      });
    }
    window.addEventListener('load', function(){ fitA4(); setTimeout(function(){ window.print(); }, 250); });
  <\/script>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${css}${page}</head><body>${html}${fit}</body></html>`);
  w.document.close();
}
