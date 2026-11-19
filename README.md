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
7. Zkopíruj ho do souboru [`js/firebase-config.js`](js/firebase-config.js) místo `null`, například:

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

> Údaje ve `firebase-config.js` nejsou tajné. Klidně můžou být veřejně na GitHubu.
> Bezpečnost zajišťují pravidla databáze a anonymní přihlášení.

## Zveřejnění na GitHub Pages

1. Nahraj soubory do repozitáře (commit + push na větev `main`).
2. Na GitHubu otevři **Settings → Pages** → *Source: Deploy from a branch* → větev `main`, složka `/ (root)` → *Save*.
3. Za minutu až dvě bude hra na adrese `https://TVOJE-JMENO.github.io/NAZEV-REPOZITARE/`.

---

## Jak se hraje

- Jeden hráč hru **založí** (stane se hostitelem) a pošle ostatním **odkaz** nebo **5místný kód**.
- Hostitel v lobby nastaví startovní kapitál, odměnu za Start a délku hry a hru spustí.
- Pořadí hráčů se při startu náhodně zamíchá.

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
| Kůň kulhá | (roh naproti Distancu) příští tah vynecháš; do té doby bereš za koně jen základní poplatek, ne za tréninky |
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
- Offline hráče může kdokoli vyřadit, online hráče jen hostitel.

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
| `js/firebase-config.js` | tvoje Firebase konfigurace |
| `database.rules.json` | pravidla databáze (vložit do Firebase konzole) |
