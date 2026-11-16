# Bowling Napló

Egyszemélyes bowling eredménykövető és edzőnapló, PWA (telefonra, offline is működik).

## Fejlesztés

```bash
npm install
npm run dev      # fejlesztői szerver
npm test         # számítási tesztek (Vitest)
npm run build    # típusellenőrzés + éles build a dist/ mappába
npm run preview  # az éles build kipróbálása (service worker is)
```

## Szerkezet

- `src/domain/` – adattípusok és statisztika (tiszta függvények, tesztelve)
- `src/storage/db.ts` – IndexedDB tárolás (localStorage tartalékkal)
- `src/ui/` – képernyők: főoldal, új alkalom, napló, beállítások
- `tests/` – Vitest tesztek

## Állapot

1. lépés kész: gyors bevitel, napló szűréssel és szerkesztéssel, alapstatisztika, célkövetés,
   profil és edzői mezők, sötét/világos téma, offline működés.

2. lépés kész: pontszám-grafikon (játékonként, 20-as mozgóátlag, trendvonal, cél, érintéssel
   olvasható értékek), beépített szabályalapú edző (`src/coach/rules.ts`) tippekkel, a következő
   edzés fókuszával és mentés utáni visszajelzéssel.

3. lépés kész: frame-enkénti bevitel bábu-ábrával (`src/ui/frameEditor.ts`), pontszámítás és
   frame-statisztika (`src/domain/scoring.ts`): strike%, spare%, nyitott frame, egy bábus és
   sarokbábus spare, split-felismerés, leggyakrabban elhibázott állások; játékonkénti golyó.

4. lépés kész: export/import (`src/storage/io.ts`). JSON: teljes, pontos mentés. CSV: pontosvesszős,
   UTF-8 BOM-os (Excel). Import: JSON vagy CSV, hosszú (játékonként egy sor) vagy széles (alkalmanként egy
   sor, „1. játék”, „2. játék”… oszlopok) formátumban, többféle dátumformátummal; előnézet, összefésülés
   duplikátum-szűréssel vagy teljes csere.

5. lépés kész: Claude-edző (`src/coach/claude.ts`, `src/coach/prompt.ts`, `src/ui/coachPage.ts`).
   A saját Anthropic API-kulccsal (Beállítások → Claude-edző) a Claude Opus 5.5 kötött szerkezetű
   elemzést ad: összegzés, a korábbi tanácsok értékelése, erősségek, fókuszterületek, gyakorlatok,
   következő cél. Az elemzések az Edzőnaplóba kerülnek (`#/edzo`), és a következő elemzés megkapja őket.
   A kulcs csak az eszközön van (localStorage), az exportba nem kerül. Az SDK csak az első elemzéskor töltődik be.

Közzétéve: https://nehezgergo.github.io/bowling-naplo/ (minden push után GitHub Actions: tesztek, build, Pages).

További funkciók: szerkeszthető alkalomtípusok kategóriával (edzés / verseny / egyéb) a Beállításokban;
jól látható visszaigazolás mentéskor; mentési emlékeztető a főoldalon (30 nap után, „Később” = 1 hét).
