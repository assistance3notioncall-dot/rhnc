/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Application interne : aucune page ne doit apparaître dans Google ou un
  // autre moteur. L'en-tête couvre toutes les réponses (pages, fichiers, API),
  // y compris celles qui n'ont pas de <meta>. Pas de robots.txt « Disallow » :
  // un robot bloqué ne lirait jamais cet en-tête, et Google peut alors lister
  // l'adresse sans contenu.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" }],
      },
    ];
  },
};
export default nextConfig;
