# Dostihová stáj

Online dostihová obchodní hra pro **2–6 hráčů**. Každý hraje na svém mobilu nebo počítači v prohlížeči.
Stránka běží na **GitHub Pages**, hráče propojuje **Firebase Realtime Database** (zdarma).

---

## Vyzkoušení na vlastním počítači (bez Firebase)

```powershell
python -m http.server 8080
```

Otevři <http://localhost:8080/?local=1>, založ hru a odkaz hry otevři v dalších záložkách.
Každá záložka je jeden hráč. Tento režim funguje jen v rámci jednoho prohlížeče a slouží k testování.

---

## Nastavení Firebase (jednou, cca 10 minut)

1. Jdi na <https://console.firebase.google.com> a vytvoř nový projekt (Google Analytics můžeš vypnout).
2. **Authentication** → *Začít* → záložka *Sign-in method* → zapni **Anonymous** (anonymní přihlášení) → *Uložit*.
3. **Authentication** → *Settings* → *Authorized domains* → *Add domain* → přidej `TVOJE-JMENO.github.io`.
4. **Realtime Database** → *Create database* → umístění **europe-west1 (Belgie)** → *Start in locked mode*.
5. V Realtime Database otevři záložku **Rules**, smaž obsah, vlož celý obsah souboru
   [`database.rules.json`](database.rules.json) a klikni na **Publish**.
6. Ozubené kolo → **Project settings** → *Your apps* → ikona **`</>`** (Web) → zaregistruj aplikaci
   (Firebase Hosting nezaškrtávej). Zobrazí se `firebaseConfig`.
7. Zkopíruj soubor [`js/firebase-config.example.js`](js/firebase-config.example.js) jako `js/firebase-config.js`
   a místo `null` do něj vlož svůj `firebaseConfig`, například:

   ```js
   export const firebaseConfig = {
     apiKey: 'AIza...',
     authDomain: 'moje-dostihy.firebaseapp.com',
     databaseURL: 'https://moje-dostihy-default-rtdb.europe-west1.firebasedatabase.app',
     projectId: 'moje-dostihy',
     appId: '1:1234567890:web:abcdef',
   };
   ```

   Pokud v konfiguraci chybí `databaseURL`, zkopíruj adresu z horní části stránky Realtime Database.

> Soubor `js/firebase-config.js` je v `.gitignore`, takže se **na GitHub nikdy nenahraje**.
> Máš ho jen na svém počítači. Na GitHub Pages ho při každém nasazení vytvoří GitHub Actions
> z tajemství `FIREBASE_CONFIG` (viz níže).

## Zveřejnění na GitHub Pages

Web nasazuje GitHub Actions ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)) po každém pushi na `main`.

1. Na GitHubu otevři **Settings → Secrets and variables → Actions → New repository secret**.
   Název `FIREBASE_CONFIG`, hodnota je tvoje konfigurace jako **JSON** (klíče v uvozovkách):

   ```json
   {"apiKey":"AIza...","authDomain":"moje-dostihy.firebaseapp.com","databaseURL":"https://moje-dostihy-default-rtdb.europe-west1.firebasedatabase.app","projectId":"moje-dostihy","appId":"1:1234567890:web:abcdef"}
   ```

   Nebo z příkazové řádky (z `js/firebase-config.js` udělá JSON a uloží ho jako tajemství):

   ```powershell
   node --input-type=module -e "import('./js/firebase-config.js').then(m => process.stdout.write(JSON.stringify(m.firebaseConfig)))" | gh secret set FIREBASE_CONFIG
   ```

2. **Settings → Pages** → *Source:* **GitHub Actions**.
3. Pushni na `main`. Za minutu až dvě bude hra na adrese `https://TVOJE-JMENO.github.io/NAZEV-REPOZITARE/`.
   Průběh je vidět na záložce **Actions**.

### Proč je klíč na webu i tak vidět a jak ho omezit

Hra běží celá v prohlížeči, takže prohlížeč musí Firebase konfiguraci dostat. Kdo otevře hru
a podívá se do vývojářských nástrojů, klíč uvidí. To platí pro každou webovou aplikaci s Firebase.
Proto klíč není v repozitáři, ale skutečnou ochranu dávají tyto věci:

- **Pravidla databáze** ([`database.rules.json`](database.rules.json)): bez nich by klíč k ničemu nebyl.
- **Omezení klíče na tvoji doménu:** <https://console.cloud.google.com/apis/credentials> → vyber projekt →
  klíč *Browser key (auto created by Firebase)* → *Application restrictions:* **Websites** a přidej
  `https://TVOJE-JMENO.github.io/*`, `http://localhost:8080/*` a `https://PROJEKT.firebaseapp.com/*` → *Save*.
  Z jiných webů pak klíč nefunguje.
- **Authorized domains** ve Firebase Authentication (krok 3 výše): jen tyto domény smí přihlašovat hráče.

---

## Jak se hraje

- Jeden hráč hru **založí** (stane se hostitelem) a pošle ostatním **odkaz** nebo **5místný kód**.
- Kód hry je **schovaný** (vidíš jen tečky), aby ho nepřečetl nikdo, kdo se dívá na tvoji obrazovku.
  Kliknutím na kód se zkopíruje, tlačítko s okem ho ukáže nebo zase schová.
- Hostitel může hráče **vyhodit** (křížek u jména v lobby i ve hře, nebo v detailu hráče).
  Vyhozený hráč se do té hry už nevrátí, ani do odvety. Během hry se jeho majetek vrátí bance.
- Hostitel v lobby nastaví startovní kapitál, odměnu za Start a délku hry a hru spustí.
- Pořadí hráčů se při startu náhodně zamíchá.
- Hra má **zvuky** (kostky, kopyta, peníze, karty, fanfáry). Vypínají se tlačítkem s reproduktorem nebo klávesou **M**.
- Na počítači **mezerník** hodí kostkou nebo ukončí tah. Kostkou jde hodit i klepnutím na kostku uprostřed plánu.
- Pravidla jsou kdykoli k dispozici pod tlačítkem s knížkou („Jak se hraje“).

### Pravidla

| | |
|---|---|
| Peníze | na začátku 30 000, za každý dokončený okruh přes Start 4 000 (obojí nastavitelné v lobby) |
| Kostka | jedna; padne-li **6**, háže se znovu a hody se sčítají; **dvě šestky po sobě** = distanc |
| Koně | 22 koní v 8 stájích; volného koně můžeš koupit, když na něj stoupneš |
| Poplatek | kdo stoupne na cizího koně, platí majiteli; celá stáj bez tréninků = dvojnásobek |
| Tréninky | koupíš je, jen když **zastavíš na koni z vlastní kompletní stáje**: 1–4 tréninky, pak **Velká cena** |
| Žokejové | 4 pole; poplatek 1 000 / 2 000 / 3 000 / 4 000 podle počtu vlastněných |
| Služby | Veterinář a Kovář; poplatek hod × 80, majitel obou hod × 200 |
| Karty | Finance a Náhoda (16 + 16), propustku rušící distanc si můžeš nechat |
| Distanc | končí **šestkou** nebo použitím propustky; po osvobozující šestce házíš znovu a táhneš podle nového hodu |
| Podezření z dopingu | (roh naproti Distancu) příští tah vynecháš; do té doby bereš za koně jen základní poplatek, ne za tréninky |
| Prodej bance | koně, žokeje a služby za **plnou cenu**, tréninky za **polovinu**; stáj s tréninky nejde rozdělit |
| Obchod | na svém tahu můžeš nabídnout výměnu majetku, peněz a propustek za dohodnutou cenu |
| Dluh | když nemáš na placení, musíš prodat tréninky nebo majetek bance; jinak bankrot |
| Konec | vyhrává poslední hráč ve hře, nebo při časovém/kolovém limitu nejvyšší jmění |

Jména, ceny, poplatky i texty karet se mění v souboru [`js/config.js`](js/config.js).

---

## Zabezpečení

- Každý hráč je **anonymně přihlášený** a má vlastní neměnné ID.
- **Stav hry (peníze, majetek, pozice) smí do databáze zapisovat jen hostitel.** Hlídají to pravidla
  databáze na serverech Googlu, ne prohlížeč. Ostatní hráči posílají jen žádosti („chci hodit kostkou“).
- Hostitelův prohlížeč každou žádost ověří herním enginem: je hráč na tahu? má dost peněz? smí stavět?
  Kostkou hází hostitel, ne hráč.
- Žádost nejde podvrhnout za jiného hráče (pravidla kontrolují ID přihlášeného uživatele).
- Pořadí karet se nikde neukládá, karta se losuje až při tažení, takže nejde dopředu vykoukat.
- Když hostitel vypadne (zavře prohlížeč, zhasne mobil), roli **automaticky převezme** jiný online hráč.
  Pravidla to dovolí jen tehdy, když je původní hostitel opravdu offline.
- Offline hráče může kdokoli vyřadit, online hráče jen hostitel. Koho vyhodí hostitel, ten je
  na seznamu vyhozených: hostitelův engine odmítne jeho připojení i všechny akce a nemůže převzít roli hostitele.
- Firebase konfigurace (API klíč) není v repozitáři, viz [Zveřejnění na GitHub Pages](#zveřejnění-na-github-pages).

**Co ochráněné není:** hostitel by teoreticky mohl podvádět přes vývojářské nástroje prohlížeče,
protože jeho prohlížeč počítá hru. Pro hru s kamarády to obvykle nevadí. Úplnou ochranu by dal jen
vlastní server, například Firebase Cloud Functions. Ty ale vyžadují tarif Blaze s platební kartou.

---

## Soubory

| Soubor | Co dělá |
|---|---|
| `index.html`, `css/style.css` | stránka a vzhled |
| `js/config.js` | **data hry** – plán, koně, ceny, karty, pravidla |
| `js/engine.js` | herní logika (pravidla), bez závislosti na prohlížeči |
| `js/net.js` | síť: Firebase + lokální testovací režim |
| `js/app.js` | uživatelské rozhraní a zpracování tahů hostitelem |
| `js/sound.js` | zvuky – syntetizované v prohlížeči (Web Audio), žádné zvukové soubory |
| `js/fx.js` | efekty – plovoucí částky, konfety na konci hry |
| `js/firebase-config.example.js` | vzor Firebase konfigurace |
| `js/firebase-config.js` | tvoje Firebase konfigurace (jen u tebe, v gitu není) |
| `.github/workflows/pages.yml` | nasazení na GitHub Pages, konfiguraci doplní z tajemství `FIREBASE_CONFIG` |
| `database.rules.json` | pravidla databáze (vložit do Firebase konzole) |
