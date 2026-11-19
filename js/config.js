// ============================================================
//  Data hry – tady můžeš měnit jména, ceny, poplatky i karty.
// ============================================================

export const GAME_NAME = 'Dostihová stáj';

// Stáje (barevné skupiny koní). Index stáje se používá v BOARD.
export const STABLES = [
  { name: 'Stáj Podlesí', color: '#8d5a2b' },
  { name: 'Stáj Modrý vrch', color: '#4fb3e8' },
  { name: 'Stáj Vřesoviště', color: '#c056a8' },
  { name: 'Stáj Zlatý klas', color: '#f28c1b' },
  { name: 'Stáj Červený mlýn', color: '#d63a3a' },
  { name: 'Stáj Slunečnice', color: '#e9c718' },
  { name: 'Stáj Zelený háj', color: '#2e9e4f' },
  { name: 'Stáj Půlnoc', color: '#2c3f9e' },
];

export const RULES = {
  minPlayers: 2,
  maxPlayers: 6,
  startMoney: 30000, // výchozí hodnota, hostitel ji může změnit v lobby
  startBonus: 4000, // odměna za průchod Startem (také nastavitelné)
  propertySellRate: 1, // prodej koně / žokeje / služby bance = 100 % ceny
  sellRate: 0.5, // prodej tréninku bance = 50 % jeho ceny
  trainingCost: [1000, 1000, 2000, 2000, 3000, 3000, 4000, 4000], // cena tréninku podle stáje
  jockeyRent: [0, 1000, 2000, 3000, 4000], // poplatek podle počtu vlastněných žokejů
  serviceMult: [0, 80, 200], // hod kostkou × násobek (1 služba / obě služby)
  cardServiceMult: 200, // násobek u karty „jdi k nejbližší službě“
};

// Možnosti nastavení v lobby
export const SETTINGS_OPTIONS = {
  startMoney: [20000, 30000, 40000, 50000],
  startBonus: [2000, 3000, 4000, 5000],
  limits: [
    { v: 'none', label: 'Bez limitu (do posledního hráče)' },
    { v: 'rounds:20', label: '20 kol' },
    { v: 'rounds:40', label: '40 kol' },
    { v: 'minutes:45', label: '45 minut' },
    { v: 'minutes:60', label: '60 minut' },
    { v: 'minutes:90', label: '90 minut' },
    { v: 'minutes:120', label: '120 minut' },
  ],
};

export const DECKS = {
  tiket: { name: 'Tiket', icon: '🎫' },
  stesti: { name: 'Štěstí', icon: '🍀' },
};

// Kůň: [poplatek bez tréninku, 1 trénink, 2, 3, 4, Velká cena]
const H = (name, stable, price, rent) => ({ type: 'horse', name, stable, price, rent });
const CARD = (deck) => ({ type: 'card', deck, name: DECKS[deck].name, icon: DECKS[deck].icon });

// 40 polí, pole 0 je Start, hraje se po směru (na plánu doleva od pravého dolního rohu).
export const BOARD = [
  { type: 'start', name: 'Start', icon: '🏁', desc: 'Za každý průchod Startem nebo zastavení na něm dostaneš odměnu.' },
  H('Bručoun', 0, 1200, [60, 300, 900, 2700, 3800, 5000]),
  CARD('tiket'),
  H('Šiška', 0, 1400, [80, 400, 1100, 3200, 4500, 5800]),
  { type: 'tax', name: 'Startovné', acc: 'startovné', amount: 2000, icon: '💰', desc: 'Zaplať bance startovné.' },
  { type: 'jockey', name: 'Žokejka Bára', price: 4000, icon: '🏇' },
  H('Modrásek', 1, 2000, [120, 600, 1800, 5200, 7000, 9000]),
  CARD('stesti'),
  H('Vánek', 1, 2000, [120, 600, 1800, 5200, 7000, 9000]),
  H('Kapka', 1, 2400, [150, 750, 2200, 6000, 8200, 10500]),
  { type: 'jail', name: 'Karanténa', icon: '🚧', desc: 'Kdo sem jen stoupne, je na návštěvě. Z karantény tě pustí jen šestka (pak házíš znovu a táhneš podle nového hodu) nebo propustka.' },
  H('Levandule', 2, 2800, [200, 1000, 3000, 8000, 10500, 13000]),
  { type: 'service', name: 'Veterinář', price: 3000, icon: '🩺' },
  H('Bouřka', 2, 2800, [200, 1000, 3000, 8000, 10500, 13000]),
  H('Fialka', 2, 3200, [240, 1200, 3500, 9000, 12000, 15000]),
  { type: 'jockey', name: 'Žokej Tonda', price: 4000, icon: '🏇' },
  H('Měděnka', 3, 3600, [280, 1400, 4000, 11000, 14000, 17000]),
  CARD('tiket'),
  H('Pšenka', 3, 3600, [280, 1400, 4000, 11000, 14000, 17000]),
  H('Jantar', 3, 4000, [320, 1600, 4500, 12000, 15500, 19000]),
  { type: 'parking', name: 'Pastvina', icon: '🌿', desc: 'Odpočinek na pastvině – nic se neděje.' },
  H('Rubín', 4, 4400, [360, 1800, 5000, 14000, 17500, 21000]),
  CARD('stesti'),
  H('Plamínek', 4, 4400, [360, 1800, 5000, 14000, 17500, 21000]),
  H('Karmín', 4, 4800, [400, 2000, 6000, 15000, 18500, 22500]),
  { type: 'jockey', name: 'Žokejka Šárka', price: 4000, icon: '🏇' },
  H('Slunovrat', 5, 5200, [440, 2200, 6600, 16000, 19500, 23500]),
  H('Med', 5, 5200, [440, 2200, 6600, 16000, 19500, 23500]),
  { type: 'service', name: 'Kovář', price: 3000, icon: '⚒️' },
  H('Pampeliška', 5, 5600, [480, 2400, 7200, 17000, 20500, 24500]),
  { type: 'skip', name: 'Kůň kulhá', icon: '🩹', desc: 'Kůň kulhá a potřebuje odpočinek – příští tah vynecháš (nikam se nepřesouváš). Než tah proběhne, dostáváš za své koně jen základní poplatek, ne poplatky za tréninky.' },
  H('Mech', 6, 6000, [520, 2600, 7800, 18500, 22500, 26500]),
  H('Lesana', 6, 6000, [520, 2600, 7800, 18500, 22500, 26500]),
  CARD('tiket'),
  H('Jadeit', 6, 6400, [560, 3000, 9000, 20000, 24000, 28000]),
  { type: 'jockey', name: 'Žokej Mirek', price: 4000, icon: '🏇' },
  CARD('stesti'),
  H('Kometa', 7, 7000, [700, 3500, 10000, 22000, 26000, 30000]),
  { type: 'tax', name: 'Pokuta komisařů', acc: 'pokutu komisařů', amount: 1000, icon: '⚖️', desc: 'Zaplať bance pokutu.' },
  H('Polárka', 7, 8000, [1000, 4000, 12000, 28000, 34000, 40000]),
];

// Karty. {37} v textu se nahradí jménem pole č. 37.
// Efekty: money (a>0 dostaneš, a<0 platíš), collectEach, payEach, repairs (tr za trénink, vc za Velkou cenu),
// perHorse, moveTo (to), moveBy (n), jail, nearest (kind: jockey|service), pass (propustka z karantény)
export const CARDS = {
  tiket: [
    { t: 'Tvůj kůň vyhrál handicap. Získáváš 2 000.', e: 'money', a: 2000 },
    { t: 'Sázka na outsidera vyšla! Získáváš 4 000.', e: 'money', a: 4000 },
    { t: 'Upomínka za předplatné Dostihového zpravodaje. Zaplať 500.', e: 'money', a: -500 },
    { t: 'Veterinární prohlídka celé stáje: zaplať 400 za každý trénink a 1 500 za každou Velkou cenu.', e: 'repairs', tr: 400, vc: 1500 },
    { t: 'Sponzor přispívá na krmivo. Získáváš 1 000.', e: 'money', a: 1000 },
    { t: 'Máš narozeniny! Každý hráč ti dá 500.', e: 'collectEach', a: 500 },
    { t: 'Pokuta za nepovolené použití biče. Zaplať 1 000.', e: 'money', a: -1000 },
    { t: 'Zahrádkáři skoupili hnůj z tvých stájí. Získáváš 500.', e: 'money', a: 500 },
    { t: 'Pojišťovna vrací přeplatek. Získáváš 1 500.', e: 'money', a: 1500 },
    { t: 'Pořádáš raut pro majitele stájí. Zaplať každému hráči 300.', e: 'payEach', a: 300 },
    { t: 'Nové podkovy pro celou stáj: zaplať 250 za každý trénink a 1 000 za každou Velkou cenu.', e: 'repairs', tr: 250, vc: 1000 },
    { t: 'Výhra v tombole na dostihovém plese. Získáváš 1 000.', e: 'money', a: 1000 },
    { t: 'Propustka z karantény. Kartu si nech, dokud ji nepoužiješ.', e: 'pass' },
    { t: 'Bouřka poničila ohradu. Zaplať za opravu 1 500.', e: 'money', a: -1500 },
    { t: 'Banka vyplácí úroky z výher. Získáváš 800.', e: 'money', a: 800 },
    { t: 'Pozvánka na slavnostní zahájení sezóny. Jdi na Start.', e: 'moveTo', to: 0 },
  ],
  stesti: [
    { t: 'Jdi na Start a vyzvedni si odměnu.', e: 'moveTo', to: 0 },
    { t: 'Tvůj kůň kýchá! Jdi rovnou do karantény, přes Start nic nedostaneš.', e: 'jail' },
    { t: 'Splašený kůň! Vrať se o 3 pole zpět.', e: 'moveBy', n: -3 },
    { t: 'Jdi k nejbližšímu žokejovi. Pokud ho někdo vlastní, zaplať mu dvojnásobek.', e: 'nearest', kind: 'jockey' },
    { t: 'Jdi k nejbližšímu žokejovi. Pokud ho někdo vlastní, zaplať mu dvojnásobek.', e: 'nearest', kind: 'jockey' },
    { t: 'Jdi k nejbližší službě. Pokud ji někdo vlastní, zaplať mu hod kostkou × 200.', e: 'nearest', kind: 'service' },
    { t: 'Jdi na koně {37}. Projdeš-li Startem, dostaneš odměnu.', e: 'moveTo', to: 37 },
    { t: 'Přehlídka mladých koní – jdi na pole {11}. Projdeš-li Startem, dostaneš odměnu.', e: 'moveTo', to: 11 },
    { t: 'Svezeš se přívěsem – jdi na pole {25}. Projdeš-li Startem, dostaneš odměnu.', e: 'moveTo', to: 25 },
    { t: 'Jdi na pole {24}. Projdeš-li Startem, dostaneš odměnu.', e: 'moveTo', to: 24 },
    { t: 'Propustka z karantény. Kartu si nech, dokud ji nepoužiješ.', e: 'pass' },
    { t: 'Tvůj kůň utekl na Pastvinu. Jdi za ním.', e: 'moveTo', to: 20 },
    { t: 'Skvělý start! Postup o 2 pole vpřed.', e: 'moveBy', n: 2 },
    { t: 'Pokuta za překážení na dráze. Zaplať 1 000.', e: 'money', a: -1000 },
    { t: 'Vyhráváš fotofiniš! Získáváš 1 500.', e: 'money', a: 1500 },
    { t: 'Povinné očkování: zaplať 200 za každého koně, kterého vlastníš.', e: 'perHorse', a: 200 },
  ],
};

export const PLAYER_COLORS = [
  { name: 'Červená', hex: '#e53935' },
  { name: 'Modrá', hex: '#1e88e5' },
  { name: 'Zelená', hex: '#43a047' },
  { name: 'Žlutá', hex: '#f9c80e' },
  { name: 'Fialová', hex: '#8e24aa' },
  { name: 'Oranžová', hex: '#fb8c00' },
  { name: 'Růžová', hex: '#ec407a' },
  { name: 'Tyrkysová', hex: '#00acc1' },
  { name: 'Černá', hex: '#37474f' },
];
