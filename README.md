# Kropka – panel www

Statyczna strona (HTML/CSS/JS, bez budowania), gotowa do wrzucenia na GitHub Pages.
Rozmawia z małym API, które działa **wewnątrz bota** (`bot-env/api`).

```
przeglądarka ── panel (GitHub Pages, publiczne pliki, zero sekretów)
     │
     └── fetch + token sesji ──> API bota (twój serwer) ──> Discord
                                 token bota i client secret są TYLKO tutaj, w .env
```

## Co gdzie jest (i czemu nic nie wycieknie)

| Rzecz | Gdzie | Publiczne? |
|---|---|---|
| Token bota, Client Secret | `.env` przy bocie | nie, nigdy nie opuszcza serwera |
| Tokeny Discorda zalogowanych osób | pamięć bota | nie |
| Token sesji panelu (losowy, ważny 24h) | `localStorage` przeglądarki | tylko u tej osoby |
| `config.js` panelu | GitHub Pages | tak, jest tam tylko adres API |

- Logowanie przez Discord OAuth2 z parametrem `state` (ochrona przed CSRF). Token sesji nie trafia do adresu URL,
  tylko jednorazowy kod ważny 60 s, wymieniany zapytaniem POST.
- API odpowiada przeglądarce tylko z adresu `PANEL_URL` (CORS) i domyślnie nasłuchuje tylko na localhost.
- Każda akcja na serwerze sprawdza po stronie bota, czy zalogowana osoba ma **Zarządzanie serwerem**.
  Nie da się rozdać przyciskiem roli wyższej niż własna ani niż rola bota.
- Statusy i eventy Pokémon (wspólne dla wszystkich serwerów) może zmieniać tylko właściciel bota.
- Panel wstawia dane wyłącznie przez `textContent` (bez `innerHTML`). Ma też restrykcyjne CSP:
  bez zewnętrznych skryptów, fontów i trackerów.
- Limit zapytań na IP i na osobę.

## Uruchomienie lokalnie

1. **Discord Developer Portal** → twoja aplikacja → **OAuth2**:
   - w *Redirects* dodaj `http://localhost:3001/api/auth/callback`,
   - skopiuj *Client Secret* (*Reset Secret*, jeśli nie widać).
2. W `bot-env/.env` dopisz (wzór w `bot-env/.env.example`):
   ```
   DISCORD_CLIENT_SECRET=wklej_tutaj
   PANEL_URL=http://localhost:5500
   API_PUBLIC_URL=http://localhost:3001
   ```
3. Uruchom bota (`npm start`). W konsoli pojawi się `Panel API: http://localhost:3001 ...`.
4. Serwuj ten folder na porcie 5500, np.:
   ```
   cd panel
   python -m http.server 5500
   ```
5. Wejdź na http://localhost:5500.

> Bot musi działać tylko w jednym miejscu naraz. Jeśli chodzi na serwerze, nie odpalaj go drugi raz lokalnie
> z tym samym tokenem. Zamiast tego przekieruj port z serwera: `ssh -L 3001:localhost:3001 kuba@192.168.6.72`.
> Wtedy `localhost:3001` na twoim komputerze to API bota z serwera.

## GitHub Pages (publicznie)

Strona na GitHub Pages ma HTTPS, więc API też musi mieć publiczny adres **HTTPS**.
Nie otwieraj portu na routerze, użyj tunelu:

- **Tailscale Funnel**: `sudo tailscale funnel --bg 3001` daje stały adres `https://<maszyna>.<tailnet>.ts.net`.
- **Cloudflare Tunnel**: `cloudflared tunnel ...`, wymaga własnej domeny podpiętej pod Cloudflare.

Potem:

1. Wrzuć zawartość folderu `panel/` do repozytorium na GitHubie → *Settings → Pages* → branch `main`, folder `/` (root).
2. W `panel/config.js` ustaw `apiUrl` na adres tunelu, np. `https://kropka.tail1234.ts.net`.
3. W `.env` bota:
   ```
   PANEL_URL=https://twojnick.github.io/nazwa-repo
   API_PUBLIC_URL=https://kropka.tail1234.ts.net
   TRUST_PROXY=1
   ```
4. W Developer Portal → OAuth2 → Redirects dodaj `https://kropka.tail1234.ts.net/api/auth/callback`.
5. Zrestartuj bota.

Opcjonalnie zawęź CSP w `index.html`: zamień `https:` w `connect-src` na dokładny adres API.
