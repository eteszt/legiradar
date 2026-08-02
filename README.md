# Légiradar – élő repülőjárat-követés

Teljes Next.js webalkalmazás repülőjáratok élő ADS-B helyzetének, útvonalának,
telemetriájának és várható időadatainak megjelenítésére.

## Fő funkciók

- járatszám vagy callsign szerinti keresés;
- élő ADS-B adatok az airplanes.live szolgáltatásból;
- automatikus tartalék adatforrás az adsb.lol hálózatból;
- útvonaladatok az adsbdb.com adatbázisából;
- Aviationstack menetrendi, indulási és érkezési adatok;
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

- [airplanes.live](https://airplanes.live/)
- [adsb.lol](https://adsb.lol/)
- [adsbdb.com](https://www.adsbdb.com/)
- [Aviationstack](https://aviationstack.com/)
- [NOAA Aviation Weather Center](https://aviationweather.gov/)

Az alkalmazás tájékoztató célú, navigációra vagy repülésbiztonsági döntésekhez nem használható.
