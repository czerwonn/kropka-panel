// Ustawienia panelu. Nie wpisuj tu żadnych tokenów ani sekretów - ten plik jest publiczny na GitHub Pages.
// Adres API bota (to, co bot ma w .env jako API_PUBLIC_URL). Lokalnie - API przez tunel SSH.
// Zmieniając adres, zmień go też w connect-src w index.html.
window.KROPKA_CONFIG = {
    apiUrl: ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:3001' : 'https://kropka-api.czerw.dev',

    // Opcjonalny obrazek w tle strony głównej - wrzuć plik do folderu panelu i wpisz nazwę, np. 'hero.jpg'
    heroImage: '',
};
