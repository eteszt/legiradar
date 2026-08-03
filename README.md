# Légiradar – élő repülőjárat-követés

Teljes Next.js webalkalmazás repülőjáratok élő ADS-B helyzetének, útvonalának,
telemetriájának és várható időadatainak megjelenítésére.

## Fő funkciók

- járatszám vagy callsign szerinti keresés;
- célzott, pontos Flightradar24 live-ID keresés teljes járatrészlettel és telemetriával;
- közösségi ADS-B fallback az airplanes.live és adsb.lol hálózatokból;
- útvonal- és azonosítóadatok az adsbdb.com adatbázisából;
- a legkorábbi, nem törölt, **valós FR24 menetrendi példány** kiválasztása a következő 24 órából;
- nincs történeti adatokból kikövetkeztetett „következő járat”;
- aktív járatnál aktuális indulási és érkezési reptéri METAR;
- közelgő járatnál az indulási/érkezési célidőponthoz illesztett TAF-szakasz;
- Open-Meteo órás célhőmérséklet és hőérzet, külön forrás- és érvényességi idővel;
- az átfedő `TEMPO`/`PROB` TAF-kockázatok külön megjelenítése;
- budapesti időzóna szerinti időpontok;
- menetirányba forduló repülőikon és útvonalnyom;
- kapcsolható NOAA SIGMET/G-AIRMET turbulenciaréteg;
- mobil- és asztali nézet.

## Helyi indítás

Szükséges: Node.js 22 vagy újabb.

```bash
cp .env.example .env.local
npm install
npm run dev
```

A `.env.local` fájlban add meg a saját Aviationstack API-kulcsodat:

```env
AVIATIONSTACK_API_KEY=sajat_api_kulcs
```

Ezután nyisd meg a `http://localhost:3000` címet.

## Ellenőrzés

```bash
npm test
npm run lint
npm run build
```

A tesztek lefedik többek között a pontos FR24 live-egyezést, a prefix-találatok kizárását,
az óceáni telemetria korlátozott frissességét, a 24 órás menetrendi határt,
a törölt járatok kizárását és az Open-Meteo órás UTC-időpontok illesztését.

## Feltöltés GitHubra

1. Hozz létre egy üres GitHub repositoryt, például `legiradar` néven.
2. Töltsd fel a ZIP kicsomagolt tartalmát a repository gyökerébe.
3. A valódi `.env.local` fájlt ne töltsd fel; ezt a `.gitignore` is kizárja.

Parancssorból:

```bash
git init
git add .
git commit -m "Légiradar első Railway-verzió"
git branch -M main
git remote add origin https://github.com/FELHASZNALONEV/legiradar.git
git push -u origin main
```

## Telepítés Railwayre

1. A Railway felületén válaszd a **New Project → Deploy from GitHub repo** lehetőséget.
2. Válaszd ki a `legiradar` repositoryt.
3. A szolgáltatás **Variables** részében add hozzá:

   ```text
   AVIATIONSTACK_API_KEY = a_sajat_kulcsod
   ```

4. A Railway a mellékelt `railway.json` alapján automatikusan buildeli és elindítja az alkalmazást.
5. A **Settings → Networking → Generate Domain** gombbal hozz létre nyilvános címet.

A Railway által biztosított `PORT` változót az alkalmazás automatikusan használja.

## Adatforrások

- [Flightradar24](https://www.flightradar24.com/) – célzott élő azonosítás és valós menetrendi példányok;
- [airplanes.live](https://airplanes.live/) – közösségi ADS-B fallback;
- [adsb.lol](https://adsb.lol/) – közösségi ADS-B fallback;
- [adsbdb.com](https://www.adsbdb.com/) – járat-, légitársaság- és útvonalazonosítás;
- [Aviationstack](https://aviationstack.com/) – opcionális régi menetrendi fallback;
- [NOAA Aviation Weather Center](https://aviationweather.gov/) – METAR, TAF, SIGMET és G-AIRMET;
- [Open-Meteo](https://open-meteo.com/) – órás reptéri hőmérséklet és hőérzet.

A Flightradar24-integráció nem dokumentált webes végpontokra támaszkodik. Éles,
nagy forgalmú használat előtt ellenőrizni kell a szolgáltatási feltételeket és a
rate limiteket, illetve lehetőség szerint hivatalos/licencelt API-ra kell cserélni.

Az alkalmazás tájékoztató célú, navigációra vagy repülésbiztonsági döntésekhez nem használható.
