// Âge bio — moteur : lecture de l'export Gadgetbridge (sql.js), Diagnostic, profil, calcul, base de démonstration.
// Le fichier choisi est lu en mémoire, analysé puis libéré : rien n'est conservé, rien n'est envoyé.
// Le Diagnostic décrit la structure et la couverture des données, jamais une valeur de santé
// (ni pas, ni FC, ni durée de sommeil, ni âge) : il peut être transmis tel quel.
// Calcul : fonctions pures (instants en ms UTC, fuseau en paramètre) ; toutes les constantes sont dans CONFIG, avec leur source.
// Preuves : C confirmé (source primaire), D déduit (raisonnement indiqué), S source secondaire.
// WP = white paper WHOOP « The WHOOP Healthspan Feature », révisé le 4/9/2025 (p. = page imprimée).
// GB = code de Gadgetbridge, commit 3c30da08 : https://codeberg.org/Freeyourgadget/Gadgetbridge

const G = 10;   // années par unité de ln(HR) : t = 10 × ln(HR), « roughly 10% increase in risk » par année (C, WP p. 12)

export const CONFIG = {
  METHOD_VERSION: '2.0',

  // ---------- Lecture ----------
  HR_VALID: [30, 220],          // FC valide si 30 ≤ HEART_RATE ≤ 220 (0, 255 et négatifs = pas de mesure)
  SECONDS_BELOW: 1e11,          // horodatage maximal < 1e11 → secondes, sinon millisecondes
  QUARTER_MS: 900000,           // agrégation par quart d'heure UTC (exact pour tous les fuseaux, décalés de 15 min au plus fin)

  // ---------- Jours et nuits ----------
  VALID_DAY_QUARTERS: 64,       // jour valide : ≥ 64 quarts d'heure contenant une FC valide (16 h)
  NIGHT_FROM_HOUR: 18,          // nuit D : sessions commençant entre D-1 18:00…
  NIGHT_TO_HOUR: 6,             // …et D 06:00 (exclu)
  CHAIN_GAP_MIN: 60,            // chaînage : session commençant moins de 60 min après la fin de la précédente
  VALID_NIGHT_MIN: 180,         // nuit valide : sommeil effectif ≥ 3 h
  // Unité des durées de sommeil quand la détection automatique ne conclut pas.
  // Source : SleepStagesParser (« total sleep duration in minutes ») ; à confirmer sur l'export réel.
  SLEEP_DURATION_UNIT: 'min',

  // ---------- Fenêtres ----------
  AGE_WINDOW_DAYS: 182,         // 6 mois (C, WP p. 18 : « based on the last 6 months of WHOOP data »)
  PACE_WINDOW_DAYS: 30,         // moyennes 30 jours « sustained for the next 6 months » (C, WP p. 19)
  MIN_POINTS: 7,                // indicateur avec moins de 7 points dans la fenêtre = absent (v1, inchangé ; sauf M7)

  // ---------- Cadence, déblocage, calibrage ----------
  UPDATE_WEEKDAY: 0,            // dimanche (C : « every Sunday morning—right after your Saturday night sleep gets processed », forum WHOOP, 09/05/2025)
  UNLOCK_NIGHTS: 21,            // déblocage : 21 nuits valides… (C : « at least 21 recoveries in each 31-day period », The Locker, 08/05/2025)
  UNLOCK_SPAN: 31,              // …parmi les 31 clés de nuit S−30 … S
  CALIBRATION_DAYS: 90,         // calibrage complet à 90 jours valides (C : « full calibration happening at 90 days »)
  PACE_BOUNDS: [-1, 3],         // C, WP p. 19

  // ---------- M2 Régularité ----------
  // Nuit D comparée aux nuits valides D−1 … D−4 (C : « compared to the previous 4 days », WP p. 21),
  // poids 4, 3, 2, 1 (D : « greater weighting for more recent days », Grosicki 2025), renormalisés sur les nuits présentes.
  REG_WEIGHTS: [4, 3, 2, 1],
  REG_MIN_PREV: 2,              // au moins 2 de ces nuits valides, sinon pas de valeur
  REG_ZERO_AT_MIN: 120,         // écart moyen (|Δ coucher| + |Δ lever|) / 2 de 120 min → 0 % (v1, inchangé)

  // ---------- M3, M4 Zones cardiaques en % de la réserve ----------
  HRMAX: [208, 0.7],            // FCmax = 208 − 0,7 × âge (Tanaka 2001 ; formule WHOOP non publiée)
  HRR_ZONE13: 0.5,              // zones 1-3 : [50 % ; 80 %[ de la réserve (C, The Locker 31/03/2026 ; le WP dit 40 %)
  HRR_ZONE45: 0.8,              // zones 4-5 : ≥ 80 % de la réserve (C, WP p. 23)
  HRR_REST_DAYS: 14,            // FC de repos des zones : nuits des 14 jours précédant le jour (C, The Locker 21/11/2024)
  // Minutes comptées seulement pendant une activité (C : « in activities logged on WHOOP », WP p. 23) : séance
  // enregistrée (fin > début, tout type) ou épisode soutenu d'au moins 15 min ≥ seuil 50 %, trous de 2 min au plus
  // (D : équivalent de la détection automatique d'activités). Un épisode est compté dans son jour local.
  EPISODE_MIN: 15,
  EPISODE_GAP_MAX: 2,

  // ---------- M5 Renforcement ----------
  // Codes ACTIVITY_KIND (GB ActivityKind.java) des séances Xiaomi (GB XiaomiWorkoutType.fromCode) comptées comme
  // renforcement : ceux de la v1, plus yoga, Pilates, HIIT et cross training (C : tableau 1 du WP, « Strength Activity
  // Time » : pilates, yoga, HIIT, functional fitness…). Relu le 15/11/2026 au commit 3c30da08.
  STRENGTH_KINDS: {
    0x00200000: 'STRENGTH_TRAINING (Xiaomi 308 strength)',
    0x0400006a: 'CORE_TRAINING (Xiaomi 303 core training)',
    0x04000080: 'DUMBBELL (Xiaomi 313 dumbbell)',
    0x04000100: 'BARBELL (Xiaomi 314 barbell)',
    0x04000109: 'WEIGHTLIFTING (Xiaomi 315 Weightlifting)',
    0x0400010a: 'DEADLIFT (Xiaomi 316 Deadlift)',
    0x04000070: 'SIT_UPS (Xiaomi 318 sit-ups)',
    0x04000063: 'FUNCTIONAL_TRAINING (Xiaomi 319 Functional training)',
    0x040000f3: 'UPPER_BODY (Xiaomi 320 upper body)',
    0x040000ff: 'LOWER_BODY (Xiaomi 321 lower body)',
    0x0400010c: 'ABS (Xiaomi 322 Abs)',
    0x0400010d: 'BACK (Xiaomi 323 Back)',
    0x00004000: 'YOGA (Xiaomi 12 yoga)',
    0x04000009: 'PILATES (Xiaomi 305 Pilates)',
    0x04000045: 'HIIT (Xiaomi 16 HIIT ; résumé de sous-type 0x10)',
    0x0400006f: 'CROSS_TRAINING (Xiaomi 309 Cross training)',
  },

  // ---------- M8 FC de repos nocturne ----------
  // Nuit valide : moyenne de la moitié la plus basse des FC minute valides pendant ses sessions, s'il y a au moins
  // 60 minutes à FC valide (D : WHOOP prend une moyenne pondérée de la nuit principale, tirée vers le sommeil lent,
  // Grosicki 2025 ; la moitié basse l'approche sans stades). Un échantillon = une minute (pas de 60 s).
  REST_MIN_SAMPLES: 60,
  REST_LOW_FRACTION: 0.5,

  // ---------- Scores de sommeil ----------
  SLEEP_NEED_MIN: 480,          // besoin de sommeil : 8 h (v1)

  // ---------- Barèmes : [valeur, Δ en années], interpolation linéaire, constant au-delà ----------
  GOMPERTZ_YEARS: G,
  SCALES: {
    M1: [[4, 1.75], [7, 0], [8, -0.3], [9, -0.3], [9.5, 0]],                   // h/nuit — C formes WP p. 22 ; S pentes
    M2: [[52, 3], [70, 0], [85, -2.5]],                                         // % — C neutre 70 % ; S ≈ 0,17 an/point
    M3: [[0, 1.4], [100, 0], [180, -0.6], [300, -1.0], [600, -1.8]],            // min/sem, base ≤ 30 ans — C cible 100 ; S pentes
    M4: [[0, 0.5], [10, 0], [35, -0.1], [75, -0.3]],                            // min/sem, base ≤ 30 ans — C cible 10 ; S effet faible
    M5: [[0, 1.6], [40, 0], [90, -1.3], [120, -1.3]],                           // min/sem — C neutre 40, plateau 2 h ; S pente
    M6: [[3500, 2.6], [5800, 0.87], [8000, 0], [9600, -0.3], [12000, -0.6]],   // pas/j, base < 60 ans — C 8 000 ; S −0,3 à 9 599
  },
  // Cibles M3 et M4 décroissantes avec l'âge (C : 100 → 70 min et 10 → 7 min) ; interpolation de 30 à 80 ans (D) :
  // abscisses du barème de base × cible / cible jeune adulte.
  TARGET_AGES: [30, 80],
  M3_TARGET: [100, 70],
  M4_TARGET: [10, 7],
  M6_SENIOR_AGE: 60,            // dès 60 ans… (Paluch 2022 ; âge de bascule WHOOP inconnu)
  M6_SENIOR_FACTOR: 0.7,        // …abscisses de M6 × 0,7 : 8 000 → 5 600 pas (C, WP p. 25)
  // M8 : neutre N par sexe (C : ~60 bpm H, ~64 bpm F, WP p. 27 ; « autre » ou inconnu : 62, moyenne), barème
  // [[N − 15, −1,8], [N, 0], [N + 25, 3]] (S : ≈ 0,12 an/bpm).
  M8_NEUTRAL: { male: 60, female: 64, other: 62 },
  M8_SCALE: [[-15, -1.8], [0, 0], [25, 3]],
  // M7 : Δ = 10 × ln(0,87) / 3,5 = −0,398 an par ml/kg/min au-dessus de la cible (Kodama 2009 : HR 0,87 par MET),
  // borné à ±3 ans. Cible = fig. 4 du WP (C) interpolée sur l'âge ; « autre » ou inconnu : moyenne H/F (choix).
  VO2_PER_UNIT: (G * Math.log(0.87)) / 3.5,
  VO2_BOUNDS: [-3, 3],
  VO2_TARGET_AGES: [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  VO2_TARGETS: {
    female: [40, 40, 38, 36, 34, 32, 30, 29, 27, 26, 25, 23, 22, 21, 20, 19, 18],
    male: [46, 46, 44, 42, 40, 37, 36, 34, 32, 30, 29, 27, 26, 25, 23, 22, 21],
  },

  // ---------- M7, voie 1 : VO2 max du bracelet, comptée ----------
  // RAW_SUMMARY_DATA = fichier de résumé reçu du bracelet (GB : XiaomiActivityFileId.from, WorkoutSummaryParser,
  // XiaomiSimpleActivityParser, XiaomiActivityParser.fixAndWrap). Octets 0-3 : horodatage u32 LE (s) ; 4 : fuseau ;
  // 5 : version ; 6 : drapeaux (type = bit 7, sous-type = (b & 0x7F) >> 2, détail = b & 3) ; 7 : 0 ; puis en-tête de
  // validité, corps little-endian et CRC32 final. Ancien format (#3916, avant le 26/07/2024) : sans octet 7 ni CRC,
  // reconnu au CRC invalide → positions décalées de −1. Positions comptées depuis le début du fichier (format actuel) :
  // début de séance (u32, s), FC moyenne / max / min (u8), VO2 max (u8, ml/kg/min, 0 = absente).
  // Clé : « sous-type/version ». Seuls ces couples sont lus.
  VO2_LAYOUTS: {
    '22/2': { start: 16, hr: [58, 59, 60], vo2: 91 },    // 0x16 course, marche, randonnée, trail (getOutdoorWalkingV2Parser)
    '22/4': { start: 17, hr: [59, 60, 61], vo2: 92 },
    '22/5': { start: 19, hr: [73, 74, 75], vo2: 106 },
    '22/6': { start: 19, hr: [73, 74, 75], vo2: 106 },
    '22/9': { start: 23, hr: [77, 78, 79], vo2: 115 },
    '23/4': { start: 16, hr: [52, 53, 54], vo2: 85 },    // 0x17 vélo extérieur (getOutdoorCyclingParser ; v7 non gérée)
    '23/5': { start: 16, hr: [56, 57, 58], vo2: 89 },
    '23/6': { start: 17, hr: [57, 58, 59], vo2: 90 },
    '23/8': { start: 18, hr: [58, 59, 60], vo2: 96 },
    '3/5': { start: 12, hr: [44, 45, 46], vo2: 51 },     // 0x03 tapis (getTreadmillParser)
    '3/10': { start: 16, hr: [56, 57, 58], vo2: 64 },
    '3/11': { start: 17, hr: [57, 58, 59], vo2: 65 },
    '1/3': { start: 12, hr: [48, 49, 50], vo2: 75 },     // 0x01 course, v3 (getOutdoorV3Parser avec pas)
    '2/3': { start: 12, hr: [48, 49, 50], vo2: 75 },     // 0x02 marche, v3
    '6/3': { start: 12, hr: [42, 43, 44], vo2: 69 },     // 0x06 vélo, v3 (getOutdoorV3Parser sans pas)
  },
  // Dispositions sans champ VO2 : sous-types 0x07 vélo d'intérieur, 0x08 libre (musculation comprise), 0x09 piscine,
  // 0x0B elliptique, 0x0D rameur, 0x0E corde, 0x10 HIIT ; couples 0x16 v1, 0x01 v4, 0x02 v4, 0x03 v9, 0x06 v4.
  VO2_NONE_SUBTYPES: [0x07, 0x08, 0x09, 0x0b, 0x0d, 0x0e, 0x10],
  VO2_NONE_PAIRS: ['22/1', '1/4', '2/4', '3/9', '6/4'],
  // Contrôles d'alignement (D) : début de séance du corps à moins d'un jour de l'horodatage du
  // fichier ; 30 ≤ FC moyenne ≤ FC max ≤ 220 et FC min ≤ moyenne. Sinon la VO2 n'est pas lue.
  VO2_START_TOLERANCE_S: 86400,
  VO2_PLAUSIBLE: [15, 90],      // valeur retenue si 15 ≤ VO2 ≤ 90 ml/kg/min
  VO2_MIN_POINTS: 1,            // présente dès 1 mesure dans la fenêtre (D : la VO2 max varie lentement) ; valeur = moyenne
  VO2_ERROR: 3.5,               // erreur retenue pour la précision : 3,5 ml/kg/min = 1 MET (D)

  // ---------- M7, voie 2 : estimation sans effort, affichée et non comptée ----------
  // Jurca R et al., Assessing cardiorespiratory fitness without performing exercise testing, Am J Prev Med
  // 2005;29(3):185-193, tableau 5 p. 189, modèle NASA (VO2 max mesurée) : MET = 18,07 + 2,77 × homme − 0,10 × âge
  // − 0,17 × IMC − 0,03 × FC de repos + SR-PA ; R = 0,81, SEE = 1,45 MET. Relu dans l'article le 15/11/2026.
  // « Autre » ou inconnu : moyenne des modèles homme et femme (homme = 0,5). Non comptée : elle recouvre M8 et M3/M4
  // (seule information nouvelle : l'IMC) et σ ≈ 2,3 ans. Biais connu : la FC de repos de Jurca est
  // mesurée couché après 5 min ; la nôtre, nocturne, est plus basse (estimation un peu haute).
  JURCA: { intercept: 18.07, male: 2.77, age: -0.10, bmi: -0.17, rest: -0.03, pa: [0, 0.32, 1.06, 1.76, 3.03], see: 1.45 },
  // Niveau SR-PA (tableau 1 p. 187, échelle NASA) tiré de nos mesures (D, choix) : « aerobic exercise such as run/walk »
  // = minutes en zones 1 à 5 pendant les activités (M3 + M4) : SR-PA-4 au-delà de 180 min/sem, SR-PA-3 dès 60,
  // SR-PA-2 dès 20 ; SR-PA-1 (« some regular participation in modest physical activities ») si M5 ≥ 20 min/sem ou
  // M6 ≥ 7 000 pas/j ; sinon SR-PA-0.
  JURCA_AEROBIC: [20, 60, 180],
  JURCA_MODEST: { strength: 20, steps: 7000 },
  MET_ML: 3.5,                  // 1 MET = 3,5 ml/kg/min

  // ---------- Statut, précision, leviers ----------
  STATUS_EPS: 0.05,             // 'good' si Δ ≤ −0,05 an, 'bad' si Δ ≥ 0,05 an
  INTERVAL_Z: 1.96,             // intervalle à 95 % : âge bio ± 1,96 × écart-type total
  // Leviers « et si », comportements seulement : pas réaliste pour chaque indicateur, gain = Δ(actuel) − Δ(actuel + pas).
  LEVERS: [
    { id: 'M1', step: 0.5, below: 8, label: '30 min de sommeil en plus par nuit' },
    { id: 'M2', step: 10, max: 100, label: '10 points de régularité du sommeil en plus' },
    { id: 'M3', step: 30, label: '30 min/sem de plus en zones 1 à 3' },
    { id: 'M4', step: 10, label: '10 min/sem de plus en zones 4 et 5' },
    { id: 'M5', step: 20, label: '20 min/sem de renforcement en plus' },
    { id: 'M6', step: 1000, label: '1 000 pas de plus par jour' },
  ],
  LEVER_MIN_GAIN: 0.05,
};

export const IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9'];
export const GROUPS = { M1: 'sleep', M2: 'sleep', M3: 'activity', M4: 'activity', M5: 'activity', M6: 'activity', M7: 'fitness', M8: 'fitness', M9: 'fitness' };

const MIN_MS = 60000;
const DAY_MS = 86400000;
const STRENGTH = new Set(Object.keys(CONFIG.STRENGTH_KINDS).map(Number));
const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

// ================= Outils =================

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Écart-type d'échantillon (n − 1) ; 0 sous 2 valeurs.
export function stdev(values) {
  const n = values.length;
  if (n < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
}
export const round1 = x => Math.round(x * 10) / 10;

// Barème : interpolation linéaire entre les points, constant au-delà des extrémités.
export function interp(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

// Unité d'une colonne d'horodatage d'après sa valeur maximale.
export const detectUnit = max => (max < CONFIG.SECONDS_BELOW ? 's' : 'ms');

// Dates « AAAA-MM-JJ » (jours civils, sans fuseau).
const utcOf = key => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (key, n) => new Date(utcOf(key) + n * DAY_MS).toISOString().slice(0, 10);
export const dayDiff = (from, to) => Math.round((utcOf(to) - utcOf(from)) / DAY_MS);
export const weekday = key => new Date(utcOf(key)).getUTCDay();   // 0 = dimanche
// Dernier dimanche ≤ key, premier dimanche ≥ key.
export const sundayOnOrBefore = key => addDays(key, -((weekday(key) - CONFIG.UPDATE_WEEKDAY + 7) % 7));
export const sundayOnOrAfter = key => addDays(key, (CONFIG.UPDATE_WEEKDAY - weekday(key) + 7) % 7);
// Jours jusqu'à la prochaine mise à jour (dimanche suivant), de 1 à 7.
export const daysToNextUpdate = key => (CONFIG.UPDATE_WEEKDAY - weekday(key) + 7) % 7 || 7;

// Âge en années décimales au jour `key`.
export const decimalAge = (birthKey, key) => dayDiff(birthKey, key) / 365.2425;
// Âge en années révolues.
export function fullYears(birthKey, key) {
  const [by, bm, bd] = birthKey.split('-').map(Number);
  const [ty, tm, td] = key.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

// Calendrier du fuseau `timeZone` ; formateurs créés une seule fois.
export function makeCalendar(timeZone) {
  const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const keyFmt = new Intl.DateTimeFormat('fr-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const wall = t => {
    const p = {};
    for (const { type, value } of partsFmt.formatToParts(new Date(t))) p[type] = Number(value);
    return p;
  };
  // Décalage du fuseau à l'instant t (heure locale − UTC, en ms).
  const offset = t => {
    const p = wall(t);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
  };
  return {
    timeZone,
    dayKey: t => keyFmt.format(new Date(t)),           // jour local « AAAA-MM-JJ »
    hour: t => wall(t).hour,                            // heure locale 0-23
    // Instant (ms UTC) de l'heure locale hour:minute du jour `key` ; gère les changements d'heure.
    at(key, hour = 0, minute = 0) {
      const [y, m, d] = key.split('-').map(Number);
      const w = Date.UTC(y, m - 1, d, hour, minute);
      return w - offset(w - offset(w));
    },
    // Minutes « horloge » de l'instant t comptées depuis 00:00 du jour `key` (négatives la veille).
    wallMinutes(t, key) {
      const p = wall(t);
      return (Date.UTC(p.year, p.month - 1, p.day) - utcOf(key)) / MIN_MS + p.hour * 60 + p.minute + p.second / 60;
    },
  };
}

// Répartit des objets { t } triés par t entre les jours locaux : Map(jour → liste), sans formater chaque instant.
function groupByDay(items, cal) {
  const out = new Map();
  if (!items.length) return out;
  let key = cal.dayKey(items[0].t);
  let end = cal.at(addDays(key, 1));
  let list = [];
  out.set(key, list);
  for (const x of items) {
    if (x.t >= end) {
      key = cal.dayKey(x.t);
      end = cal.at(addDays(key, 1));
      list = out.get(key) ?? [];
      out.set(key, list);
    }
    list.push(x);
  }
  return out;
}

// ================= Jours =================

// quarters : [{ q, n, steps, hr }] — q = quart d'heure UTC (floor(secondes / 900)), n = échantillons,
// hr = minutes à FC valide. Un jour sans échantillon est absent de la Map (jamais 0).
export function buildDays(quarters, cal) {
  const days = new Map();
  const list = [...quarters].sort((a, b) => a.q - b.q);
  if (!list.length) return days;
  let key = cal.dayKey(list[0].q * CONFIG.QUARTER_MS);
  let end = cal.at(addDays(key, 1));
  let day = null;
  for (const x of list) {
    const t = x.q * CONFIG.QUARTER_MS;
    while (t >= end) {
      key = addDays(key, 1);
      end = cal.at(addDays(key, 1));
      day = null;
    }
    if (!day) {
      day = { key, samples: 0, steps: 0, hrMinutes: 0, quarters: 0, valid: false };
      days.set(key, day);
    }
    day.samples += x.n ?? 0;
    day.steps += x.steps ?? 0;
    day.hrMinutes += x.hr ?? 0;
    if (x.hr > 0) day.quarters++;
  }
  for (const d of days.values()) d.valid = d.quarters >= CONFIG.VALID_DAY_QUARTERS;
  return days;
}

// ================= Nuits =================

// Unité des durées de sommeil : TOTAL_DURATION comparé à la durée de la session.
// 'min', 's', ou null si aucune session ne permet de conclure.
export function detectDurationUnit(sessions) {
  const ratios = sessions
    .filter(s => s.total > 0 && s.end > s.start)
    .map(s => s.total / ((s.end - s.start) / MIN_MS));
  const m = median(ratios);
  if (m === null) return null;
  if (m >= 0.2 && m <= 1.5) return 'min';
  if (m >= 12 && m <= 90) return 's';
  return null;
}

// Nuit à laquelle appartient une session commençant à t : D si t ∈ [D-1 18:00 ; D 06:00[, sinon null.
function nightOf(t, cal) {
  const h = cal.hour(t);
  if (h >= CONFIG.NIGHT_FROM_HOUR) return addDays(cal.dayKey(t), 1);
  if (h < CONFIG.NIGHT_TO_HOUR) return cal.dayKey(t);
  return null;
}

// sessions : [{ start, end, intoBed, total, deep, light, rem, awake }] — instants en ms, durées brutes.
// Renvoie { nights: Map(jour D → nuit), naps }. Siestes ignorées.
export function buildNights(sessions, cal, unit = CONFIG.SLEEP_DURATION_UNIT) {
  const toMin = unit === 's' ? 1 / 60 : 1;
  const list = sessions
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  // Sessions qui se chevauchent : la plus longue est gardée.
  const kept = [];
  for (const s of list) {
    const last = kept[kept.length - 1];
    if (last && s.start < last.end) {
      if (s.end - s.start > last.end - last.start) kept[kept.length - 1] = s;
    } else {
      kept.push(s);
    }
  }
  const nights = new Map();
  let naps = 0;
  let prev = null;   // dernière session rattachée à une nuit
  for (const s of kept) {
    let key = nightOf(s.start, cal);
    if (key === null && prev && s.start - prev.end < CONFIG.CHAIN_GAP_MIN * MIN_MS) key = prev.key;   // chaînage
    if (key === null) {
      naps++;
      prev = null;
      continue;
    }
    if (!nights.has(key)) nights.set(key, { key, sessions: [] });
    nights.get(key).sessions.push(s);
    prev = { end: s.end, key };
  }
  for (const n of nights.values()) finishNight(n, toMin);
  return { nights, naps };
}

// Coucher, lever, sommeil effectif, stades et validité d'une nuit.
function finishNight(n, toMin) {
  const first = n.sessions[0];
  const last = n.sessions[n.sessions.length - 1];
  // Coucher = INTO_BED_TIME de la première session s'il est renseigné (et pas après son début), sinon son début.
  n.bed = first.intoBed > 0 && first.intoBed <= first.start ? first.intoBed : first.start;
  n.wake = last.end;
  let sleep = 0;
  let deep = 0;
  let rem = 0;
  let staged = true;
  let span = false;
  for (const s of n.sessions) {
    const stages = (s.deep || 0) + (s.light || 0) + (s.rem || 0);
    if (stages > 0) {
      // Sommeil effectif = DEEP + LIGHT + REM si cette somme est > 0…
      sleep += stages * toMin;
      deep += (s.deep || 0) * toMin;
      rem += (s.rem || 0) * toMin;
      continue;
    }
    staged = false;
    const net = ((s.total || 0) - (s.awake || 0)) * toMin;
    if (net > 0) {
      sleep += net;                          // …sinon TOTAL − AWAKE…
    } else {
      sleep += (s.end - s.start) / MIN_MS;   // …sinon durée de la session (export sans durées)
      span = true;
    }
  }
  n.sleepMin = sleep;
  n.deepMin = staged ? deep : null;
  n.remMin = staged ? rem : null;
  n.source = staged ? 'stages' : span ? 'span' : 'total';
  n.valid = sleep >= CONFIG.VALID_NIGHT_MIN;
}

// Coucher en minutes depuis 12:00 de la veille (23:30 → 690 ; 00:30 → 750) ; lever en minutes depuis 00:00 du jour D.
export const bedMinutes = (night, cal) => cal.wallMinutes(night.bed, addDays(night.key, -1)) - 720;
export const wakeMinutes = (night, cal) => cal.wallMinutes(night.wake, night.key);

// Régularité de chaque nuit valide (M2) : Map(jour D → %). Nuit D comparée à chacune des nuits valides D−1 … D−4,
// poids 4, 3, 2, 1 renormalisés sur les nuits présentes (au moins 2) ; écart d'une nuit = (|Δ coucher| + |Δ lever|) / 2.
export function regularities(nights, cal) {
  const valid = new Map();
  for (const n of nights.values()) {
    if (n.valid) valid.set(n.key, { bed: bedMinutes(n, cal), wake: wakeMinutes(n, cal) });
  }
  const out = new Map();
  for (const [key, n] of valid) {
    let weights = 0;
    let gaps = 0;
    let count = 0;
    CONFIG.REG_WEIGHTS.forEach((w, i) => {
      const p = valid.get(addDays(key, -(i + 1)));
      if (!p) return;
      count++;
      weights += w;
      gaps += (w * (Math.abs(n.bed - p.bed) + Math.abs(n.wake - p.wake))) / 2;
    });
    if (count < CONFIG.REG_MIN_PREV) continue;
    out.set(key, clamp(100 - ((gaps / weights) * 100) / CONFIG.REG_ZERO_AT_MIN, 0, 100));
  }
  return out;
}

// ================= FC de repos =================

// HR_RESTING du bracelet (tableau « 7 derniers jours » seulement, pour la comparaison avec Gadgetbridge).
// summaries : [{ t, rest }] — plusieurs lignes par jour : la plus récente du jour avec HR_RESTING > 0.
export function restingByDay(summaries, cal) {
  const best = new Map();
  for (const s of summaries) {
    if (!(s.rest > 0)) continue;
    const key = cal.dayKey(s.t);
    if (!best.has(key) || s.t > best.get(key).t) best.set(key, s);
  }
  return new Map([...best].map(([key, s]) => [key, s.rest]));
}

// FC de repos nocturne d'une nuit (M8) : moyenne de la moitié la plus basse des FC valides lues pendant ses sessions,
// s'il y en a au moins CONFIG.REST_MIN_SAMPLES (une par minute) ; sinon null.
export function nightRestingHr(hrs) {
  const [lo, hi] = CONFIG.HR_VALID;
  const ok = Float64Array.from(hrs.filter(h => h >= lo && h <= hi)).sort();
  if (ok.length < CONFIG.REST_MIN_SAMPLES) return null;
  const k = Math.ceil(ok.length * CONFIG.REST_LOW_FRACTION);
  let sum = 0;
  for (let i = 0; i < k; i++) sum += ok[i];
  return sum / k;
}

// Nuits dont readExport lit la FC minute par minute (toutes les nuits valides).
export const nightsNeedingRest = base => base.nightList.filter(n => n.valid);

// ================= Séances (M5, M3/M4, M7) =================

export const isStrength = kind => STRENGTH.has(kind);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
// CRC-32 (IEEE 802.3, celui de java.util.zip.CRC32 utilisé par GB CheckSums.getCRC32).
export function crc32(bytes, from = 0, to = bytes.length) {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// Lecture d'un RAW_SUMMARY_DATA (Uint8Array). Renvoie { status, subtype, version, legacy, vo2Raw, vo2 } ;
// status : 'illisible' (pas un résumé de séance), 'sans-vo2' (disposition sans champ VO2), 'non-documentée'
// (couple absent de CONFIG.VO2_LAYOUTS), 'désaligné' (contrôles d'alignement en échec), 'lu'.
// vo2Raw : octet lu (0 = absente) ; vo2 : valeur retenue (plausible) ou null.
export function decodeSummary(bytes) {
  const out = { status: 'illisible', subtype: null, version: null, legacy: false, vo2Raw: null, vo2: null };
  if (!(bytes instanceof Uint8Array) || bytes.length < 13) return out;
  const flags = bytes[6];
  if (((flags >> 7) & 1) !== 1 || (flags & 3) !== 1) return out;   // type 1 = séance, détail 1 = résumé
  out.subtype = (flags & 0x7f) >> 2;
  out.version = bytes[5];
  out.legacy = crc32(bytes, 0, bytes.length - 4) !== u32(bytes, bytes.length - 4);
  const key = `${out.subtype}/${out.version}`;
  const layout = CONFIG.VO2_LAYOUTS[key];
  if (!layout) {
    out.status = CONFIG.VO2_NONE_SUBTYPES.includes(out.subtype) || CONFIG.VO2_NONE_PAIRS.includes(key) ? 'sans-vo2' : 'non-documentée';
    return out;
  }
  const shift = out.legacy ? -1 : 0;
  const end = bytes.length - (out.legacy ? 0 : 4);
  if (layout.vo2 + shift >= end) {
    out.status = 'désaligné';
    return out;
  }
  const start = u32(bytes, layout.start + shift);
  const [avg, max, min] = layout.hr.map(i => bytes[i + shift]);
  const [lo, hi] = CONFIG.HR_VALID;
  const aligned = Math.abs(start - u32(bytes, 0)) <= CONFIG.VO2_START_TOLERANCE_S
    && avg >= lo && avg <= max && max <= hi && min <= avg;
  if (!aligned) {
    out.status = 'désaligné';
    return out;
  }
  out.status = 'lu';
  out.vo2Raw = bytes[layout.vo2 + shift];
  const [vlo, vhi] = CONFIG.VO2_PLAUSIBLE;
  out.vo2 = out.vo2Raw >= vlo && out.vo2Raw <= vhi ? out.vo2Raw : null;
  return out;
}

// Intervalles [début, fin[ fusionnés et triés.
function mergeIntervals(list) {
  const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
// t appartient-il à l'un des intervalles fusionnés ? (recherche dichotomique)
function inIntervals(intervals, t) {
  let lo = 0;
  let hi = intervals.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (intervals[mid][0] <= t) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= 0 && t < intervals[hi][1];
}

// workouts : [{ start, end, kind, raw }] → { byDay: Map(jour → { count, strengthMin, undated }),
// intervals (séances avec fin > début, tout type), vo2: Map(jour → [VO2 retenues]), measured }.
// undated : séance de renforcement sans durée exploitable (fin ≤ début).
export function workoutsOf(workouts, cal) {
  const byDay = new Map();
  const vo2 = new Map();
  const spans = [];
  for (const w of workouts) {
    if (!(w.start > 0)) continue;
    const key = cal.dayKey(w.start);
    if (!byDay.has(key)) byDay.set(key, { count: 0, strengthMin: 0, undated: 0 });
    const d = byDay.get(key);
    d.count++;
    if (w.end > w.start) spans.push([w.start, w.end]);
    if (w.raw) {
      const v = decodeSummary(w.raw).vo2;
      if (v !== null) {
        if (!vo2.has(key)) vo2.set(key, []);
        vo2.get(key).push(v);
      }
    }
    if (!isStrength(w.kind)) continue;
    if (w.end > w.start) d.strengthMin += (w.end - w.start) / MIN_MS;
    else d.undated++;
  }
  return { byDay, intervals: mergeIntervals(spans), vo2 };
}

// ================= Barèmes =================

export const hrMax = age => CONFIG.HRMAX[0] - CONFIG.HRMAX[1] * age;
// Seuils en bpm pour un âge et une FC de repos : bas = 50 %, haut = 80 % de la réserve cardiaque.
export function hrZones(age, rest) {
  const max = hrMax(age);
  return { max, rest, low: rest + CONFIG.HRR_ZONE13 * (max - rest), high: rest + CONFIG.HRR_ZONE45 * (max - rest) };
}
// Neutre de FC de repos (M8) et repli des zones : 60 H (1), 64 F (0), 62 autre ou inconnu.
export const restNeutral = gender => (gender === 1 ? CONFIG.M8_NEUTRAL.male : gender === 0 ? CONFIG.M8_NEUTRAL.female : CONFIG.M8_NEUTRAL.other);

// Cible VO2 max (fig. 4 du WP) interpolée sur l'âge ; sexe « autre » ou inconnu : moyenne H/F. null sans âge.
export function vo2Target(age, gender) {
  if (!Number.isFinite(age)) return null;
  const pts = col => CONFIG.VO2_TARGET_AGES.map((a, i) => [a, CONFIG.VO2_TARGETS[col][i]]);
  if (gender === 1) return interp(pts('male'), age);
  if (gender === 0) return interp(pts('female'), age);
  return (interp(pts('male'), age) + interp(pts('female'), age)) / 2;
}

// Cible d'une zone pour l'âge : de la valeur jeune adulte (≤ 30 ans) à la valeur âgée (≥ 80 ans), linéaire entre.
const zoneTarget = ([young, old], age) => {
  const [a0, a1] = CONFIG.TARGET_AGES;
  const f = Number.isFinite(age) ? clamp((age - a0) / (a1 - a0), 0, 1) : 0;
  return young - (young - old) * f;
};
const scaleX = (points, f) => points.map(([x, y]) => [x * f, y]);

// Barème effectif [[valeur, Δ]…] d'un indicateur pour ctx = { age, gender } ; null pour M9 (et M7 sans âge).
export function scaleFor(id, ctx = {}) {
  const age = Number.isFinite(ctx.age) ? ctx.age : null;
  switch (id) {
    case 'M1':
    case 'M2':
    case 'M5':
      return CONFIG.SCALES[id];
    case 'M3':
      return scaleX(CONFIG.SCALES.M3, zoneTarget(CONFIG.M3_TARGET, age) / CONFIG.M3_TARGET[0]);
    case 'M4':
      return scaleX(CONFIG.SCALES.M4, zoneTarget(CONFIG.M4_TARGET, age) / CONFIG.M4_TARGET[0]);
    case 'M6':
      return age !== null && age >= CONFIG.M6_SENIOR_AGE ? scaleX(CONFIG.SCALES.M6, CONFIG.M6_SENIOR_FACTOR) : CONFIG.SCALES.M6;
    case 'M7': {
      const t = vo2Target(age, ctx.gender);
      if (t === null) return null;
      const k = CONFIG.VO2_PER_UNIT;   // < 0
      const [lo, hi] = CONFIG.VO2_BOUNDS;
      return [[t + hi / k, hi], [t, 0], [t + lo / k, lo]];   // = clamp(k × (v − t), lo, hi)
    }
    case 'M8': {
      const n = restNeutral(ctx.gender);
      return CONFIG.M8_SCALE.map(([x, y]) => [n + x, y]);
    }
    default:
      return null;
  }
}

// Valeur neutre (Δ = 0) pour ce profil : premier point du barème à Δ = 0 (M1 : 7 h ; M9 : null).
export function targetFor(id, ctx = {}) {
  const s = scaleFor(id, ctx);
  const p = s?.find(([, y]) => y === 0);
  return p ? p[0] : null;
}

// Contribution Δ (années) d'un indicateur ; ctx = { age, gender }.
export function delta(id, value, ctx = {}) {
  const s = scaleFor(id, ctx);
  return s && Number.isFinite(value) ? interp(s, value) : 0;
}

export const paceFrom = (g30, g182) => clamp(1 + 2 * (g30 - g182), ...CONFIG.PACE_BOUNDS);
// États au dixième, comme l'affichage (C, WP p. 18-19).
export function paceState(x) {
  const r = round1(x);
  if (r < 0) return 'reversing';
  if (r < 1) return 'slowing';
  return r === 1 ? 'steady' : 'accelerated';
}
export function ageState(gap) {
  const r = round1(gap);
  return r < 0 ? 'younger' : r > 0 ? 'older' : 'ontrack';
}

// Estimation de Jurca 2005 (ml/kg/min) ; niveau SR-PA 0 à 4. null si une entrée manque.
export function jurcaVo2({ age, gender, bmi, rest, level }) {
  if (![age, bmi, rest, level].every(Number.isFinite)) return null;
  const J = CONFIG.JURCA;
  const male = gender === 1 ? 1 : gender === 0 ? 0 : 0.5;
  const met = J.intercept + J.male * male + J.age * age + J.bmi * bmi + J.rest * rest + J.pa[level];
  return met * CONFIG.MET_ML;
}
// Niveau SR-PA (0 à 4) depuis les minutes en zones (M3 + M4, min/sem), le renforcement et les pas.
export function jurcaLevel({ aerobic, strength = 0, steps = 0 }) {
  const [a2, a3, a4] = CONFIG.JURCA_AEROBIC;
  if (aerobic > a4) return 4;
  if (aerobic >= a3) return 3;
  if (aerobic >= a2) return 2;
  return strength >= CONFIG.JURCA_MODEST.strength || steps >= CONFIG.JURCA_MODEST.steps ? 1 : 0;
}

// ================= Analyse =================

// Étape 1 : jours, nuits, régularités, FC de repos du bracelet, séances.
// input : { timeZone, lastDataMs, quarters, summaries, sessions, workouts }
export function prepare(input) {
  const cal = makeCalendar(input.timeZone);
  const days = buildDays(input.quarters ?? [], cal);
  const unitDetected = detectDurationUnit(input.sessions ?? []);
  const unit = unitDetected ?? CONFIG.SLEEP_DURATION_UNIT;
  const { nights, naps } = buildNights(input.sessions ?? [], cal, unit);
  const w = workoutsOf(input.workouts ?? [], cal);
  return {
    cal,
    days,
    nights,
    naps,
    unit,
    unitDetected,
    dayList: [...days.values()].sort(byKey),
    nightList: [...nights.values()].sort(byKey),
    reg: regularities(nights, cal),
    rest: restingByDay(input.summaries ?? [], cal),
    workouts: w.byDay,
    intervals: w.intervals,
    vo2: w.vo2,
    lastKey: Number.isFinite(input.lastDataMs) ? cal.dayKey(input.lastDataMs) : null,
  };
}

// Plus basse FC utile au calcul des zones (bpm, entier) : readExport ne lit que les minutes au-dessus.
// Seuil bas = FCr + 50 % (FCmax − FCr), croissant en FCr et en FCmax : borne avec la plus basse FC de repos
// possible (nuits ou neutre) et la FCmax de l'âge le plus élevé (jour de la dernière donnée). null sans zones.
export function zoneFloor(base, opts = {}) {
  const birth = opts.profile?.birth;
  if (!birth || !base.lastKey || opts.hasHr === false) return null;
  let rest = restNeutral(opts.profile.gender ?? null);
  for (const v of (opts.nightRest ?? new Map()).values()) rest = Math.min(rest, v);
  return Math.floor(hrZones(decimalAge(birth, base.lastKey), rest).low);
}

// Minutes en zones 1-3 et 4-5 d'un jour, pendant les activités seulement. samples : FC du jour triées
// [{ t, hr }] ; inWorkout(t) ; low, high : seuils en bpm. Une minute est comptée une fois.
export function activityZoneMinutes(samples, inWorkout, low, high) {
  const minuteOf = t => Math.floor(t / MIN_MS);
  const q = samples.filter(s => s.hr >= low);
  const counted = new Set();
  let z13 = 0;
  let z45 = 0;
  let i = 0;
  while (i < q.length) {
    let j = i;
    while (j + 1 < q.length && minuteOf(q[j + 1].t) - minuteOf(q[j].t) <= CONFIG.EPISODE_GAP_MAX + 1) j++;
    const sustained = minuteOf(q[j].t) - minuteOf(q[i].t) + 1 >= CONFIG.EPISODE_MIN;
    for (let k = i; k <= j; k++) {
      const s = q[k];
      const m = minuteOf(s.t);
      if (counted.has(m) || !(sustained || inWorkout(s.t))) continue;
      counted.add(m);
      if (s.hr >= high) z45++;
      else z13++;
    }
    i = j + 1;
  }
  return { z13, z45 };
}

// Moteur des zones : FCr de chaque jour (moyenne des nuits des 14 jours précédents, sinon repli), minutes par jour.
function zoneEngine(base, m, active) {
  const samples = groupByDay(active, base.cal);
  const cache = new Map();
  const ZERO = { z13: 0, z45: 0 };
  const fcr14 = key => {
    const vals = [];
    for (let i = 1; i <= CONFIG.HRR_REST_DAYS; i++) {
      const v = m.nightRest.get(addDays(key, -i));
      if (v !== undefined) vals.push(v);
    }
    return mean(vals);
  };
  return {
    fcr14,
    // Minutes du jour `key` ; fallback : FCr de repli (moyenne de la fenêtre), sinon le neutre du sexe.
    minutes(key, fallback = null) {
      const list = samples.get(key);
      if (!list) return ZERO;
      const own = fcr14(key);
      const rest = own ?? fallback ?? restNeutral(m.gender);
      const id = `${key}|${rest}`;
      if (!cache.has(id)) {
        const z = hrZones(m.ageAt(key), rest);
        cache.set(id, { ...activityZoneMinutes(list, t => inIntervals(base.intervals, t), z.low, z.high), fallback: own === null });
      }
      return cache.get(id);
    },
  };
}

// Contexte d'analyse : profil, FC de repos nocturnes, moteur des zones.
// opts : { profile: { birth, gender, height, weight }, hasHr, nightRest: Map(nuit → bpm), active: [{ t, hr }] triés }
export function buildModel(base, opts = {}) {
  const p = opts.profile ?? null;
  const birth = p?.birth ?? null;
  const height = Number.isFinite(p?.height) && p.height > 0 ? p.height : null;
  const weight = Number.isFinite(p?.weight) && p.weight > 0 ? p.weight : null;
  const m = {
    base,
    birth,
    gender: Number.isInteger(p?.gender) ? p.gender : null,
    bmi: height && weight ? weight / (height / 100) ** 2 : null,
    hasHr: opts.hasHr !== false,
    nightRest: opts.nightRest ?? new Map(),
    ageAt: key => (birth ? decimalAge(birth, key) : null),
    zones: null,
  };
  if (birth && m.hasHr) m.zones = zoneEngine(base, m, opts.active ?? []);
  return m;
}

// Moyenne et erreur type d'une liste de valeurs.
const statOf = values => ({ n: values.length, value: mean(values), se: values.length ? stdev(values) / Math.sqrt(values.length) : null });

// Les 9 indicateurs sur la fenêtre de n jours finissant au jour endKey ; nuits de n clés finissant à nightEndKey.
// Renvoie { startKey, endKey, nightStartKey, nightEndKey, validDays, validNights, restMean, ind, gap }.
// ind[id] = { id, value, points, delta, present, estimated, reason, se } (+ undated pour M5, level pour M7 estimée).
export function windowIndicators(m, endKey, n, nightEndKey = endKey) {
  const base = m.base;
  const startKey = addDays(endKey, -(n - 1));
  const nightStartKey = addDays(nightEndKey, -(n - 1));
  const days = base.dayList.filter(d => d.valid && d.key >= startKey && d.key <= endKey);
  const nights = base.nightList.filter(x => x.valid && x.key >= nightStartKey && x.key <= nightEndKey);
  const nd = days.length;
  const nn = nights.length;
  const ctx = { age: m.ageAt(endKey), gender: m.gender };
  const ind = {};
  const put = (id, { n: points, value, se }, reason, minPoints = CONFIG.MIN_POINTS) => {
    ind[id] = points >= minPoints && value !== null && Number.isFinite(value)
      ? { id, value, points, delta: delta(id, value, ctx), present: true, estimated: false, reason: null, se }
      : { id, value: null, points, delta: 0, present: false, estimated: false, reason, se: null };
  };
  const fewDays = `${plural(nd, 'jour valide', 'jours valides')}, 7 requis`;
  const weekly = values => {
    const s = statOf(values);
    return { n: s.n, value: s.value === null ? null : s.value * 7, se: s.se === null ? null : s.se * 7 };
  };

  put('M1', statOf(nights.map(x => x.sleepMin / 60)), `${plural(nn, 'nuit valide', 'nuits valides')}, 7 requises`);

  const regs = nights.map(x => base.reg.get(x.key)).filter(v => v !== undefined);
  put('M2', statOf(regs), `${plural(regs.length, 'nuit précédée', 'nuits précédées')} d'au moins 2 nuits valides sur les 4 précédentes, 7 requises`);

  // FC de repos nocturnes de la fenêtre : M8, et repli des zones pour les jours sans nuit dans les 14 jours précédents.
  const rests = nights.map(x => m.nightRest.get(x.key)).filter(v => v !== undefined);
  const restMean = mean(rests);

  if (m.zones) {
    const z = days.map(d => m.zones.minutes(d.key, restMean));
    put('M3', weekly(z.map(x => x.z13)), fewDays);
    put('M4', weekly(z.map(x => x.z45)), fewDays);
  } else {
    const why = m.hasHr ? 'date de naissance inconnue (zones cardiaques)' : 'FC absente de l\'export';
    put('M3', { n: 0, value: null }, why);
    put('M4', { n: 0, value: null }, why);
  }

  let sessions = 0;
  let undated = 0;
  for (const [key, w] of base.workouts) {
    if (key < startKey || key > endKey) continue;
    sessions += w.count;
    undated += w.undated;
  }
  if (sessions === 0) {
    put('M5', { n: 0, value: null }, 'aucune séance enregistrée sur la période (0 et « non enregistré » indiscernables)');
  } else {
    put('M5', weekly(days.map(d => base.workouts.get(d.key)?.strengthMin ?? 0)), fewDays);
  }
  ind.M5.undated = undated;

  put('M6', statOf(days.map(d => d.steps)), fewDays);

  put('M8', statOf(rests), m.hasHr
    ? `${plural(rests.length, 'nuit', 'nuits')} avec FC de repos nocturne (au moins ${CONFIG.REST_MIN_SAMPLES} min de FC valide), 7 requises`
    : 'FC absente de l\'export');

  // M7, voie 1 : VO2 max du bracelet (moyenne des mesures de la fenêtre, présente dès 1 mesure).
  const vo2 = [];
  for (const [key, list] of base.vo2) if (key >= startKey && key <= endKey) vo2.push(...list);
  if (vo2.length && ctx.age !== null) {
    put('M7', { n: vo2.length, value: mean(vo2), se: CONFIG.VO2_ERROR }, '', CONFIG.VO2_MIN_POINTS);
  } else {
    // M7, voie 2 : estimation de Jurca, affichée et non comptée.
    const missing = [];
    if (ctx.age === null) missing.push('date de naissance');
    if (m.bmi === null) missing.push('taille et poids du profil');
    if (!ind.M8.present) missing.push('FC de repos nocturne');
    if (!(ind.M3.present && ind.M4.present && ind.M6.present)) missing.push('7 jours valides avec zones cardiaques');
    if (missing.length) {
      ind.M7 = { id: 'M7', value: null, points: 0, delta: 0, present: false, estimated: false, se: null,
        reason: `aucune mesure du bracelet sur la période et estimation impossible (${missing.join(', ')})` };
    } else {
      const level = jurcaLevel({ aerobic: ind.M3.value + ind.M4.value, strength: ind.M5.present ? ind.M5.value : 0, steps: ind.M6.value });
      ind.M7 = {
        id: 'M7', value: jurcaVo2({ age: ctx.age, gender: m.gender, bmi: m.bmi, rest: ind.M8.value, level }),
        points: 0, delta: 0, present: false, estimated: true, se: null, level,
        reason: 'estimée : recouvre la FC de repos et l\'activité, déjà comptées ; enregistre une course ou une marche en extérieur pour une mesure du bracelet',
      };
    }
  }

  ind.M9 = { id: 'M9', value: null, points: 0, delta: 0, present: false, estimated: false, se: null,
    reason: 'masse maigre non mesurée : ni balance à impédance ni DEXA dans Gadgetbridge' };

  const gap = IDS.reduce((a, id) => a + ind[id].delta, 0);
  return { startKey, endKey, nightStartKey, nightEndKey, validDays: nd, validNights: nn, restMean, ind: Object.fromEntries(IDS.map(id => [id, ind[id]])), gap };
}

// Valeur au jour X (dimanche ou aperçu) : jours X−182 … X−1, nuits X−181 … X ; rythme sur 30 jours.
function evaluate(m, X) {
  const dayEnd = addDays(X, -1);
  const w182 = windowIndicators(m, dayEnd, CONFIG.AGE_WINDOW_DAYS, X);
  const w30 = windowIndicators(m, dayEnd, CONFIG.PACE_WINDOW_DAYS, X);
  const civil = m.ageAt(dayEnd);
  // G30 : un indicateur absent sur 30 jours reprend sa contribution sur 182 jours.
  const g30 = IDS.reduce((a, id) => a + (w30.ind[id].present ? w30.ind[id].delta : w182.ind[id].delta), 0);
  const pace = paceFrom(g30, w182.gap);
  return { key: X, civil, bio: civil + w182.gap, gap: w182.gap, g30, pace, w182, w30, calibrating: w182.validDays < CONFIG.CALIBRATION_DAYS };
}

// Indicateurs de la sortie (lus par l'interface).
function indicatorsOf(e, ctx) {
  return IDS.map(id => {
    const a = e.w182.ind[id];
    const b = e.w30.ind[id];
    const shown30 = b.present || (b.estimated && b.value !== null);
    return {
      id,
      group: GROUPS[id],
      present: a.present,
      estimated: a.estimated,
      reason: a.reason,
      value6m: a.value,
      value30: shown30 ? b.value : null,
      delta: a.delta,
      delta30: shown30 ? b.delta : null,
      target: targetFor(id, ctx),
      status: !a.present ? 'absent' : a.delta <= -CONFIG.STATUS_EPS ? 'good' : a.delta >= CONFIG.STATUS_EPS ? 'bad' : 'neutral',
    };
  });
}

// Précision : écart-type de chaque valeur présente converti en années par la pente locale du barème
// (différence finie centrée de ± l'écart-type), somme quadratique ; intervalle à 95 % au dixième.
function precisionOf(e, ctx) {
  let sum = 0;
  for (const id of IDS) {
    const x = e.w182.ind[id];
    if (!x.present || !(x.se > 0)) continue;
    const years = Math.abs(delta(id, x.value + x.se, ctx) - delta(id, x.value - x.se, ctx)) / 2;
    sum += years ** 2;
  }
  const sd = Math.sqrt(sum);
  return { lo: round1(e.bio - CONFIG.INTERVAL_Z * sd), hi: round1(e.bio + CONFIG.INTERVAL_Z * sd), sd };
}

// Leviers « et si » (M1 à M6 présents) : gain en années pour un pas réaliste, trié, gains > 0,05 an.
function leversOf(e, ctx) {
  const out = [];
  for (const L of CONFIG.LEVERS) {
    const x = e.w182.ind[L.id];
    if (!x.present) continue;
    if (L.below !== undefined && x.value >= L.below) continue;
    const to = L.max !== undefined ? Math.min(L.max, x.value + L.step) : x.value + L.step;
    const gain = delta(L.id, x.value, ctx) - delta(L.id, to, ctx);
    if (gain > CONFIG.LEVER_MIN_GAIN) out.push({ id: L.id, label: L.label, from: x.value, to, gain });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

// Scores d'une nuit.
function nightScores(base, x) {
  return {
    key: x.key,
    bed: x.bed,
    wake: x.wake,
    sleepMin: x.sleepMin,
    source: x.source,
    performance: Math.min(100, (x.sleepMin / CONFIG.SLEEP_NEED_MIN) * 100),
    regularity: base.reg.get(x.key) ?? null,
    // Efficacité : sans durées transmises (source « span »), le sommeil vaut la session entière : non calculable.
    efficiency: x.source === 'span' ? null : Math.min(100, (x.sleepMin / ((x.wake - x.bed) / MIN_MS)) * 100),
    restorative: x.deepMin === null ? null : ((x.deepMin + x.remMin) / x.sleepMin) * 100,
  };
}

// Étape 2 : valeur officielle du dimanche, aperçu, courbe, leviers, sommeil, 7 derniers jours.
// opts : { profile: { birth, gender, height, weight }, hasHr, nightRest: Map, active: [{ t, hr }] }
export function analyze(base, opts = {}) {
  const m = buildModel(base, opts);
  const nightRest = m.nightRest;
  const out = {
    lastKey: base.lastKey,
    firstKey: base.dayList[0]?.key ?? null,
    lastCompleteKey: null,
    unit: base.unit,
    unitDetected: base.unitDetected,
    naps: base.naps,
    validDays: base.dayList.filter(d => d.valid).length,
    validNights: base.nightList.filter(n => n.valid).length,
    civil: null,
    unlock: { nightsIn31: 0, needed: CONFIG.UNLOCK_NIGHTS, nightsToGo: CONFIG.UNLOCK_NIGHTS, everUnlocked: false },
    official: null,
    preview: null,
    levers: [],
    curve: [],
    sleep: { last: null, avg7: null },
    week: [],
  };
  if (!base.lastKey) return out;
  const L = base.lastKey;
  out.lastCompleteKey = addDays(L, -1);
  out.civil = m.ageAt(out.lastCompleteKey);

  // ---- Déblocage : nuits valides parmi les 31 clés finissant au jour X ----
  const validNights = new Set(base.nightList.filter(n => n.valid).map(n => n.key));
  const nightsIn31 = X => {
    let k = 0;
    for (let i = 0; i < CONFIG.UNLOCK_SPAN; i++) if (validNights.has(addDays(X, -i))) k++;
    return k;
  };
  const unlocked = X => nightsIn31(X) >= CONFIG.UNLOCK_NIGHTS;
  const nowCount = nightsIn31(L);
  const lastSunday = sundayOnOrBefore(L);
  const first = [out.firstKey, base.nightList[0]?.key].filter(Boolean).sort()[0] ?? L;
  const sundays = [];
  for (let k = sundayOnOrAfter(first); k <= lastSunday; k = addDays(k, 7)) if (unlocked(k)) sundays.push(k);
  out.unlock = {
    nightsIn31: nowCount,
    needed: CONFIG.UNLOCK_NIGHTS,
    nightsToGo: Math.max(0, CONFIG.UNLOCK_NIGHTS - nowCount),
    everUnlocked: sundays.length > 0,
  };

  if (m.birth) {
    // ---- Courbe : un point par dimanche débloqué ----
    const evals = sundays.map(S => evaluate(m, S));
    out.curve = evals.map(e => ({
      key: e.key,
      civil: e.civil,
      bio: e.bio,
      gap: e.gap,
      pace: e.pace,
      calibrating: e.calibrating,
      values: Object.fromEntries(IDS.map(id => [id, e.w182.ind[id].value])),
      deltas: Object.fromEntries(IDS.map(id => [id, e.w182.ind[id].delta])),
    }));

    // ---- Valeur officielle : dernier dimanche débloqué ≤ dernier dimanche (en pause s'il est plus ancien) ----
    let shown = null;
    if (evals.length) {
      const e = evals[evals.length - 1];
      const prev = evals.length > 1 ? evals[evals.length - 2].pace : null;
      const ctx = { age: e.civil, gender: m.gender };
      shown = e;
      out.official = {
        key: e.key,
        lastSunday,
        paused: e.key !== lastSunday,
        nightsIn31: nightsIn31(lastSunday),
        calibrating: e.calibrating,
        validDays: e.w182.validDays,
        civil: e.civil,
        bio: e.bio,
        gap: e.gap,
        ageState: ageState(e.gap),
        pace: { value: e.pace, state: paceState(e.pace), g30: e.g30, g182: e.gap, prev },
        nextUpdateDays: daysToNextUpdate(L),
        interval: precisionOf(e, ctx),
        window: e.w182,
        window30: e.w30,
        indicators: indicatorsOf(e, ctx),
      };
    }

    // ---- Aperçu quotidien (MIEUX) : jours jusqu'à L−1, nuits jusqu'à L, mêmes règles de déblocage ----
    if (unlocked(L)) {
      const e = L === shown?.key ? shown : evaluate(m, L);
      out.preview = { key: L, bio: e.bio, gap: e.gap, ageState: ageState(e.gap), pace: { value: e.pace, state: paceState(e.pace) } };
      shown ??= e;
    }

    // ---- Leviers : sur la valeur officielle (sinon l'aperçu) ----
    if (shown) out.levers = leversOf(shown, { age: shown.civil, gender: m.gender });
  }

  // ---- Sommeil : dernière nuit valide, moyenne des 7 dernières ----
  const valid = base.nightList.filter(n => n.valid && n.key <= L);
  const last7 = valid.slice(-7).map(x => nightScores(base, x));
  const avg = field => mean(last7.map(s => s[field]).filter(v => v !== null));
  out.sleep = {
    last: last7.length ? last7[last7.length - 1] : null,
    avg7: last7.length ? {
      count: last7.length,
      performance: avg('performance'),
      sleepMin: avg('sleepMin'),
      regularity: avg('regularity'),
      efficiency: avg('efficiency'),
      restorative: avg('restorative'),
    } : null,
  };

  // ---- 7 derniers jours (le dernier est en cours) ; mod / vig = minutes en zones 1-3 / 4-5 pendant les activités ----
  const fallback = mean(base.nightList
    .filter(n => n.valid && n.key > addDays(L, -CONFIG.AGE_WINDOW_DAYS) && n.key <= L)
    .map(n => nightRest.get(n.key))
    .filter(v => v !== undefined));
  for (let i = 6; i >= 0; i--) {
    const key = addDays(L, -i);
    const d = base.days.get(key);
    const night = base.nights.get(key);
    const z = d && m.zones ? m.zones.minutes(key, fallback) : null;
    out.week.push({
      key,
      partial: i === 0,
      present: Boolean(d),
      steps: d ? d.steps : null,
      mod: z ? z.z13 : null,
      vig: z ? z.z45 : null,
      quarters: d ? d.quarters : 0,
      valid: Boolean(d?.valid),
      sleepMin: night ? night.sleepMin : null,
      sleepSource: night ? night.source : null,
      // Pour comparer avec Gadgetbridge : HR_RESTING du bracelet d'abord, sinon la FC de repos nocturne.
      rest: base.rest.get(key) ?? nightRest.get(key) ?? null,
    });
  }
  return out;
}

// ================= Export Gadgetbridge : tables et codes =================

export const APP_VERSION = '2.0.2';

// Tables lues (schéma Gadgetbridge 160, GBDaoGenerator.java).
const T_ACT = 'XIAOMI_ACTIVITY_SAMPLE';
const T_SLEEP = 'XIAOMI_SLEEP_TIME_SAMPLE';
const T_STAGE = 'XIAOMI_SLEEP_STAGE_SAMPLE';
const T_DAILY = 'XIAOMI_DAILY_SUMMARY_SAMPLE';
const T_MANUAL = 'XIAOMI_MANUAL_SAMPLE';
const T_WORKOUT = 'BASE_ACTIVITY_SUMMARY';
const T_FILE = 'XIAOMI_ACTIVITY_FILE';
const T_USER = 'USER';
const T_ATTR = 'USER_ATTRIBUTES';
// [table, colonnes d'horodatage]
const TABLES = [
  [T_ACT, ['TIMESTAMP']],
  [T_SLEEP, ['TIMESTAMP', 'WAKEUP_TIME', 'INTO_BED_TIME']],
  [T_STAGE, ['TIMESTAMP']],
  [T_DAILY, ['TIMESTAMP']],
  [T_MANUAL, ['TIMESTAMP']],
  [T_WORKOUT, ['START_TIME', 'END_TIME']],
  ['DEVICE', []],
  [T_FILE, ['TIMESTAMP']],
  [T_USER, []],                                  // BIRTHDAY n'est pas listé : sa plage de dates révélerait l'âge
  [T_ATTR, ['VALID_FROM_UTC', 'VALID_TO_UTC']],
];
const REQUIRED = [T_ACT, T_SLEEP];   // sans elles : « Export non reconnu »
const DAYS = 14;                    // jours détaillés dans le Diagnostic
const VO2 = /vo2|oxygen/i;
const STAGE_DURATIONS = ['DEEP_SLEEP_DURATION', 'LIGHT_SLEEP_DURATION', 'REM_SLEEP_DURATION'];
// Fichiers Xiaomi (XiaomiActivityFileId.java, XiaomiActivityParser.java) : « TYPE/SUBTYPE/DETAIL_TYPE ».
const FILE_KINDS = {
  '0/0/0': 'activité minute', '0/0/1': 'résumé du jour', '0/3/0': 'stades de sommeil',
  '0/6/0': 'mesures manuelles', '0/8/0': 'sommeil', '0/8/1': 'sommeil',
};
// Profil Gadgetbridge (Paramètres → À propos de vous) : codes et valeurs par défaut d'après
// ActivityUser.java et about_user.xml.
const GENDER = { 0: 'femme', 1: 'homme', 2: 'autre' };
// Sexe par défaut : 0 tant que l'écran n'a jamais été ouvert, 2 (« autre ») une fois ouvert.
const PROFILE_DEFAULT = { birth: '2000-01-01', genders: [0, 2], height: 175, weight: 70 };
const PLAUSIBLE = { age: [10, 110], height: [100, 250], weight: [25, 300] };   // bornes de vraisemblance (choix)

// ================= Outils de lecture =================

// Calendrier de calc.js + formats d'affichage français.
export function makeClock(timeZone) {
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { timeZone, dateStyle: 'short' });
  const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { timeZone, dateStyle: 'short', timeStyle: 'short' });
  const timeFmt = new Intl.DateTimeFormat('fr-FR', { timeZone, timeStyle: 'short' });
  return {
    ...makeCalendar(timeZone),
    date: t => dateFmt.format(new Date(t)),
    dateTime: t => dateTimeFmt.format(new Date(t)),
    time: t => timeFmt.format(new Date(t)),
  };
}
const dmy = key => key.split('-').reverse().join('/');
const dm = key => key.slice(5).split('-').reverse().join('/');

const nf = new Intl.NumberFormat('fr-FR');
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MINUS = '−';
const fmt = x => (Number.isFinite(x) ? nf.format(x) : '?');
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : 0);
const yesNo = b => (b ? 'oui' : 'non');
const sizeMo = bytes => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(bytes / 1e6)} Mo`;
const code = v => (v === null ? 'NULL' : Number.isInteger(v) && v > 9 ? `${v} (0x${v.toString(16)})` : String(v));
// Nombre signé à une décimale : « +1,3 », « −0,4 », « 0,0 ».
const signed1 = x => {
  const r = Math.round(x * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? MINUS : ''}${nf1.format(Math.abs(r))}`;
};
const years = x => `${signed1(x)} ${Math.abs(Math.round(x * 10) / 10) >= 2 ? 'ans' : 'an'}`;
const hm = min => {
  const total = Math.round(min);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}`;
};
const pc = x => `${nf0.format(x)} %`;
// « 0 nuit », « 1 nuit », « 2 nuits » (le singulier vaut aussi pour 0 en français).
const plural = (n, word, many = `${word}s`) => `${fmt(n)} ${Math.abs(n) >= 2 ? many : word}`;

function ago(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ${String(min % 60).padStart(2, '0')}` : `${Math.floor(h / 24)} j`;
}

// Liste « a, b, c » coupée en lignes de `width` caractères au plus, alignées sous le préfixe.
function wrap(prefix, items, width = 78) {
  const pad = ' '.repeat(prefix.length);
  const lines = [];
  let line = prefix;
  items.forEach((item, i) => {
    const piece = item + (i < items.length - 1 ? ',' : '');
    if (line !== prefix && line.length + 1 + piece.length > width) {
      lines.push(line);
      line = pad + piece;
    } else {
      line += (line === prefix ? '' : ' ') + piece;
    }
  });
  lines.push(line);
  return lines.join('\n');
}

// SQL
const q = name => `"${String(name).replace(/"/g, '""')}"`;   // identifiant entre guillemets
const stageSum = cols => `(${cols.map(c => `COALESCE(${q(c)}, 0)`).join(' + ')})`;
function rows(db, sql, params = []) {
  const st = db.prepare(sql);
  try {
    st.bind(params);
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally {
    st.free();
  }
}
const one = (db, sql, params) => rows(db, sql, params)[0] ?? {};
const columnsOf = (db, t) => new Set(rows(db, `PRAGMA table_info(${q(t)})`).map(c => c.name));

// Appareils ayant des échantillons, du plus actif sur 30 jours au moins actif.
function listDevices(db, hasDeviceId, actUnit) {
  if (!hasDeviceId) return [];
  const hi = one(db, `SELECT MAX(TIMESTAMP) AS hi FROM ${q(T_ACT)} WHERE TIMESTAMP > 0`).hi;
  if (!(hi > 0)) return [];
  const from30 = actUnit === 's' ? hi - 30 * 86400 : hi - 30 * DAY_MS;
  const recent = new Map(rows(db, `SELECT DEVICE_ID AS id, COUNT(*) AS n FROM ${q(T_ACT)} WHERE TIMESTAMP >= ? GROUP BY DEVICE_ID`, [from30])
    .map(r => [r.id, r.n]));
  return rows(db, `SELECT DEVICE_ID AS id, COUNT(*) AS n FROM ${q(T_ACT)} GROUP BY DEVICE_ID`)
    .map(r => ({ ...r, n30: recent.get(r.id) ?? 0 }))
    .sort((a, b) => b.n30 - a.n30 || b.n - a.n);
}

const SQLITE_MAGIC = [...'SQLite format 3\0'].map(c => c.charCodeAt(0));
const isSqlite = b => b.length >= 100 && SQLITE_MAGIC.every((v, i) => b[i] === v);
const isZip = b => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

// ================= Lecture de l'export =================

export class UserError extends Error {}
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
let sqlReady = null;   // moteur sql.js, initialisé au premier usage

function sqlEngine() {
  if (typeof initSqlJs !== 'function') {
    throw new UserError("Le moteur SQLite (sql-wasm.js) n'a pas pu être chargé : recharge la page.");
  }
  sqlReady ??= initSqlJs({ locateFile: f => f });
  return sqlReady;
}

// Lit le fichier, vérifie l'en-tête SQLite, neutralise le mode WAL dans la copie en mémoire, ouvre la base.
export async function openExport(file) {
  const [SQL, buffer] = await Promise.all([sqlEngine(), file.arrayBuffer()]);
  const bytes = new Uint8Array(buffer);
  if (isZip(bytes)) {
    throw new UserError("Ce fichier est une archive ZIP : choisis l'export « base de données » de Gadgetbridge (fichier SQLite), pas l'export ZIP complet.");
  }
  if (!isSqlite(bytes)) throw new UserError("Ce fichier n'est pas une base SQLite.");
  const meta = { size: file.size, lastModified: file.lastModified, b18: bytes[18], b19: bytes[19], walFixed: false, timeZone: TZ };
  if (bytes[18] === 2 && bytes[19] === 2) {   // journal WAL → lecture classique ; le fichier lui-même n'est pas modifié
    bytes[18] = 1;
    bytes[19] = 1;
    meta.walFixed = true;
  }
  return { db: new SQL.Database(bytes), meta };
}

// ================= Profil (tables USER et USER_ATTRIBUTES) =================

// Gadgetbridge recopie le profil dans la base au prochain enregistrement de données (DBHelper.getUser) :
// USER (seul le premier utilisateur sert) et USER_ATTRIBUTES (une ligne par version du profil).
// Valeurs personnelles : affichées sur le téléphone, jamais dans le Diagnostic.
export function readProfile(db, todayKey, now) {
  const columns = t => columnsOf(db, t);
  const pick = (have, names) => names.map(c => (have.has(c) ? q(c) : `NULL AS ${q(c)}`)).join(', ');
  const userCols = columns(T_USER);
  const attrCols = columns(T_ATTR);
  if (!userCols.size && !attrCols.size) return null;

  const users = userCols.size ? one(db, `SELECT COUNT(*) AS n FROM ${q(T_USER)}`).n : 0;
  const user = users ? one(db, `SELECT ${pick(userCols, ['_id', 'BIRTHDAY', 'GENDER'])} FROM ${q(T_USER)} ORDER BY rowid LIMIT 1`) : {};
  // BIRTHDAY : date greenDAO (ms) à minuit local du jour de naissance, négative avant 1970.
  // + 12 h puis date UTC : le bon jour, quel que soit le fuseau du téléphone lors de l'enregistrement.
  const birth = Number.isFinite(user.BIRTHDAY) ? new Date(user.BIRTHDAY + 12 * 3600000).toISOString().slice(0, 10) : null;

  // Versions du profil, de la plus ancienne à la plus récente ; la version en cours a VALID_TO_UTC vide.
  const ms = v => (Number.isFinite(v) && v > 0 ? (v < CONFIG.SECONDS_BELOW ? v * 1000 : v) : null);
  const mine = attrCols.has('USER_ID') && user._id != null;
  const versions = attrCols.size
    ? rows(db, `SELECT ${pick(attrCols, ['HEIGHT_CM', 'WEIGHT_KG', 'VALID_FROM_UTC', 'VALID_TO_UTC'])} FROM ${q(T_ATTR)}${mine ? ' WHERE USER_ID = ?' : ''} ORDER BY rowid`,
      mine ? [user._id] : [])
      .map(r => ({ height: r.HEIGHT_CM, weight: r.WEIGHT_KG, from: ms(r.VALID_FROM_UTC), to: ms(r.VALID_TO_UTC) }))
      .sort((a, b) => (a.from ?? 0) - (b.from ?? 0))
    : [];
  let i = versions.findLastIndex(v => (v.from ?? 0) <= now && (v.to === null || v.to > now));
  const current = i >= 0;
  if (!current) i = versions.length - 1;   // aucune version valide maintenant : la plus récente
  const v = versions[i] ?? {};
  while (i > 0 && versions[i - 1].weight === v.weight) i--;   // début de la période à ce poids

  return {
    users,
    versions: versions.length,
    current,
    first: versions[0]?.from ?? null,
    birth,
    age: birth ? fullYears(birth, todayKey) : null,
    gender: Number.isInteger(user.GENDER) ? user.GENDER : null,
    height: Number.isFinite(v.height) ? v.height : null,
    weight: Number.isFinite(v.weight) ? v.weight : null,
    weightSince: versions[i]?.from ?? null,
  };
}

const within = (x, [lo, hi]) => Number.isFinite(x) && x >= lo && x <= hi;
export function profileChecks(p) {
  return {
    birth: within(p.age, PLAUSIBLE.age),
    gender: GENDER[p.gender] !== undefined,
    height: within(p.height, PLAUSIBLE.height),
    weight: within(p.weight, PLAUSIBLE.weight),
    defaults: p.birth === PROFILE_DEFAULT.birth && PROFILE_DEFAULT.genders.includes(p.gender)
      && p.height === PROFILE_DEFAULT.height && p.weight === PROFILE_DEFAULT.weight,
  };
}

// Contenu du bloc « Profil » : valeurs en clair, à comparer avec l'écran de Gadgetbridge.
export function describeProfile(p, clock) {
  if (!p) {
    return {
      title: 'Profil Gadgetbridge : introuvable',
      items: [],
      alert: `Tables ${T_USER} et ${T_ATTR} absentes ou illisibles : copie le diagnostic et transmets-le.`,
    };
  }
  const c = profileChecks(p);
  const items = [
    ['Date de naissance', p.birth ? `${dmy(p.birth)} (${fmt(p.age)} ans)` : 'non renseignée'],
    ['Sexe', p.gender === null ? 'non renseigné' : GENDER[p.gender] ?? `code inconnu (${p.gender})`],
    ['Taille', p.height === null ? 'non renseignée' : `${fmt(p.height)} cm`],
    ['Poids', p.weight === null ? 'non renseigné' : `${fmt(p.weight)} kg${p.weightSince ? `, depuis le ${clock.date(p.weightSince)}` : ''}`],
    ['Historique', p.versions
      ? `${fmt(p.versions)} version${p.versions > 1 ? 's' : ''} du profil${p.first ? ` depuis le ${clock.date(p.first)}` : ''}`
      : 'aucune version enregistrée'],
  ];
  let alert = '';
  if (c.defaults) {
    alert = "Ce sont les valeurs par défaut de Gadgetbridge : renseigne ton profil (Paramètres → À propos de vous), synchronise, relance l'export puis recharge-le ici.";
  } else if (p.birth === PROFILE_DEFAULT.birth) {
    alert = 'Le 01/01/2000 est la date de naissance par défaut de Gadgetbridge : vérifie-la.';
  } else if (!(c.birth && c.gender && c.height && c.weight)) {
    alert = 'Une valeur manque ou paraît invraisemblable : vérifie-la dans Gadgetbridge (Paramètres → À propos de vous).';
  }
  const title = c.defaults ? 'Profil Gadgetbridge : jamais renseigné' : alert ? 'Profil Gadgetbridge : à vérifier' : 'Profil lu dans Gadgetbridge';
  return { title, items, alert };
}

// ================= Données du calcul =================

// Lit l'export pour calc.js : agrégats par quart d'heure, résumés journaliers, sessions de sommeil, séances (avec leur
// résumé binaire RAW_SUMMARY_DATA, d'où la VO2 max du bracelet), FC minute des nuits valides (M8), minutes au-dessus
// du plus bas seuil des zones cardiaques (M3, M4), profil.
export function readExport(db, clock, now) {
  const tables = new Set(rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map(r => r.name));
  const missing = REQUIRED.filter(t => !tables.has(t));
  if (missing.length) throw new UserError(`Export non reconnu (table absente : ${missing.join(', ')}).`);
  const cols = {};
  for (const t of [T_ACT, T_SLEEP, T_DAILY, T_WORKOUT]) cols[t] = tables.has(t) ? columnsOf(db, t) : new Set();
  const has = (t, c) => cols[t].has(c);
  // Unité de chaque colonne d'horodatage, détectée sur les données.
  const unitOf = (t, c, fallback) => {
    if (!has(t, c)) return fallback;
    const hi = one(db, `SELECT MAX(${q(c)}) AS hi FROM ${q(t)} WHERE ${q(c)} > 0`).hi;
    return hi > 0 ? detectUnit(hi) : fallback;
  };
  const toMs = (v, unit) => (Number.isFinite(v) && v > 0 ? (unit === 's' ? v * 1000 : v) : null);
  if (!has(T_ACT, 'TIMESTAMP')) throw new UserError(`Export non reconnu (colonne ${T_ACT}.TIMESTAMP absente).`);

  // Appareil retenu : le plus de lignes d'activité sur 30 jours.
  const actUnit = unitOf(T_ACT, 'TIMESTAMP', 's');
  const fromMs = t => (actUnit === 's' ? Math.floor(t / 1000) : t);
  const devices = listDevices(db, has(T_ACT, 'DEVICE_ID'), actUnit);
  const dev = devices[0]?.id ?? null;
  const scope = t => (dev !== null && has(t, 'DEVICE_ID') ? { sql: 'DEVICE_ID = ?', p: [dev] } : { sql: '1 = 1', p: [] });
  const sa = scope(T_ACT);
  const lastDataMs = toMs(one(db, `SELECT MAX(TIMESTAMP) AS hi FROM ${q(T_ACT)} WHERE ${sa.sql}`, sa.p).hi, actUnit);

  // Profil : date de naissance (âge civil, zones cardiaques), sexe, taille et poids (estimation de la VO2 max).
  let profile = null;
  try { profile = readProfile(db, clock.dayKey(now), now); } catch { profile = null; }
  const checks = profile ? profileChecks(profile) : null;
  const usable = Boolean(profile?.birth) && !checks.defaults && within(profile.age, PLAUSIBLE.age);
  const calcProfile = usable ? {
    birth: profile.birth,
    gender: profile.gender,
    height: checks.height ? profile.height : null,
    weight: checks.weight ? profile.weight : null,
  } : null;

  // Agrégats par quart d'heure UTC : échantillons, pas, minutes à FC valide.
  const hasHr = has(T_ACT, 'HEART_RATE');
  const [lo, hi] = CONFIG.HR_VALID;
  const ok = hasHr ? `(HEART_RATE BETWEEN ${lo} AND ${hi})` : '0';
  const steps = has(T_ACT, 'STEPS') ? '(CASE WHEN STEPS > 0 THEN STEPS ELSE 0 END)' : '0';
  const quarters = rows(db,
    `SELECT TIMESTAMP / ${actUnit === 's' ? 900 : 900000} AS q, COUNT(*) AS n, SUM(${steps}) AS steps, SUM(${ok}) AS hr
     FROM ${q(T_ACT)} WHERE ${sa.sql} AND TIMESTAMP > 0 GROUP BY q`, sa.p);

  // Résumés journaliers : HR_RESTING (plusieurs lignes par jour).
  let summaries = [];
  if (has(T_DAILY, 'TIMESTAMP') && has(T_DAILY, 'HR_RESTING')) {
    const s = scope(T_DAILY);
    const u = unitOf(T_DAILY, 'TIMESTAMP', 'ms');
    summaries = rows(db, `SELECT TIMESTAMP AS t, HR_RESTING AS rest FROM ${q(T_DAILY)} WHERE ${s.sql} AND HR_RESTING > 0`, s.p)
      .map(r => ({ t: toMs(r.t, u), rest: r.rest }))
      .filter(r => r.t !== null);
  }

  // Sessions de sommeil.
  const pick = (t, names) => names.map(c => (has(t, c) ? q(c) : `NULL AS ${q(c)}`)).join(', ');
  const ss = scope(T_SLEEP);
  const uStart = unitOf(T_SLEEP, 'TIMESTAMP', 'ms');
  const uWake = unitOf(T_SLEEP, 'WAKEUP_TIME', uStart);
  const uBed = unitOf(T_SLEEP, 'INTO_BED_TIME', uStart);
  const sessions = rows(db, `SELECT ${pick(T_SLEEP, ['TIMESTAMP', 'WAKEUP_TIME', 'INTO_BED_TIME', 'TOTAL_DURATION',
    'DEEP_SLEEP_DURATION', 'LIGHT_SLEEP_DURATION', 'REM_SLEEP_DURATION', 'AWAKE_DURATION'])} FROM ${q(T_SLEEP)} WHERE ${ss.sql}`, ss.p)
    .map(r => ({
      start: toMs(r.TIMESTAMP, uStart),
      end: toMs(r.WAKEUP_TIME, uWake),
      intoBed: toMs(r.INTO_BED_TIME, uBed) ?? 0,
      total: r.TOTAL_DURATION ?? 0,
      deep: r.DEEP_SLEEP_DURATION ?? 0,
      light: r.LIGHT_SLEEP_DURATION ?? 0,
      rem: r.REM_SLEEP_DURATION ?? 0,
      awake: r.AWAKE_DURATION ?? 0,
    }));

  // Séances, avec leur résumé binaire (VO2 max du bracelet, décodée par calc.js : decodeSummary).
  let workouts = [];
  if (has(T_WORKOUT, 'START_TIME') && has(T_WORKOUT, 'ACTIVITY_KIND')) {
    const s = scope(T_WORKOUT);
    const u1 = unitOf(T_WORKOUT, 'START_TIME', 'ms');
    const u2 = unitOf(T_WORKOUT, 'END_TIME', u1);
    const end = has(T_WORKOUT, 'END_TIME') ? 'END_TIME' : 'NULL';
    const raw = has(T_WORKOUT, 'RAW_SUMMARY_DATA') ? 'RAW_SUMMARY_DATA' : 'NULL';
    workouts = rows(db, `SELECT START_TIME AS s, ${end} AS e, ACTIVITY_KIND AS k, ${raw} AS r FROM ${q(T_WORKOUT)} WHERE ${s.sql}`, s.p)
      .map(r => ({ start: toMs(r.s, u1), end: toMs(r.e, u2) ?? 0, kind: r.k, raw: r.r instanceof Uint8Array ? r.r : null }));
  }

  const base = prepare({ timeZone: clock.timeZone, lastDataMs, quarters, summaries, sessions, workouts });

  // FC de repos nocturne (M8, et FC de repos des zones) : FC minute par minute pendant les sessions de chaque nuit
  // valide ; calc.js en garde la moyenne de la moitié la plus basse (au moins 60 minutes).
  const nightRest = new Map();
  const need = hasHr ? nightsNeedingRest(base) : [];
  if (need.length) {
    const st = db.prepare(`SELECT HEART_RATE FROM ${q(T_ACT)}
      WHERE ${sa.sql} AND TIMESTAMP >= ? AND TIMESTAMP < ? AND HEART_RATE BETWEEN ${lo} AND ${hi}`);
    try {
      for (const n of need) {
        const hrs = [];
        for (const s of n.sessions) {
          st.bind([...sa.p, fromMs(s.start), fromMs(s.end)]);
          while (st.step()) hrs.push(st.get()[0]);
          st.reset();
        }
        const v = nightRestingHr(hrs);
        if (v !== null) nightRest.set(n.key, v);
      }
    } finally {
      st.free();
    }
  }

  // Zones cardiaques (M3, M4) : seules les minutes au-dessus du plus bas seuil possible sont lues, dans l'ordre.
  const opts = { profile: calcProfile, hasHr, nightRest };
  const floor = zoneFloor(base, opts);
  const active = [];
  if (floor !== null) {
    const st = db.prepare(`SELECT TIMESTAMP, HEART_RATE FROM ${q(T_ACT)}
      WHERE ${sa.sql} AND TIMESTAMP > 0 AND HEART_RATE BETWEEN ? AND ${hi} ORDER BY TIMESTAMP`);
    try {
      st.bind([...sa.p, Math.max(lo, floor)]);
      while (st.step()) {
        const [t, hr] = st.get();
        active.push({ t: toMs(t, actUnit), hr });
      }
    } finally {
      st.free();
    }
  }

  const calc = { ...opts, active };   // options d'analyse
  const result = analyze(base, calc);
  const nights = base.nightList;
  const info = {
    days: base.days.size,
    nights: nights.length,
    sources: ['stages', 'total', 'span'].map(s => nights.filter(n => n.source === s).length),
    unit: base.unit,
    unitDetected: base.unitDetected,
    restDays: base.rest.size,
    restNights: nightRest.size,
    needRest: need.length,
    workouts: workouts.length,
    timed: workouts.filter(w => w.end > w.start).length,
    strength: workouts.filter(w => isStrength(w.kind) && w.end > w.start).length,
    strengthUndated: workouts.filter(w => isStrength(w.kind) && !(w.end > w.start)).length,
    vo2: [...base.vo2.values()].reduce((a, list) => a + list.length, 0),
    profileUsable: usable,
    body: Boolean(calcProfile?.height && calcProfile?.weight),
    zones: floor !== null,
  };
  return { result, base, profile, usable, lastDataMs, info, calc };
}

// ================= Diagnostic =================

export function diagnose(db, meta, clock, now) {
  const out = [];
  const say = (...lines) => out.push(...lines);
  const warnings = [];
  const attempt = (label, fn) => {
    try { fn(); } catch (e) { warnings.push(`${label} : ${e.message}`); }
  };
  const section = (title, fn) => {
    say('', title);
    try { fn(); } catch (e) { say(`  ⚠ section interrompue : ${e.message}`); }
  };
  const [HR_LO, HR_HI] = CONFIG.HR_VALID;

  // ---- Structure ----
  const tables = rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map(r => r.name);
  const has = new Set(tables);
  const count = {};
  for (const t of tables) {
    try { count[t] = one(db, `SELECT COUNT(*) AS n FROM ${q(t)}`).n; } catch { count[t] = NaN; }
  }
  const cols = {};
  for (const [t] of TABLES) if (has.has(t)) cols[t] = rows(db, `PRAGMA table_info(${q(t)})`);
  const hasCol = (t, c) => Boolean(cols[t]?.some(x => x.name === c));
  const missing = REQUIRED.filter(t => !has.has(t));

  // ---- Horodatages : plage et unité de chaque colonne de temps ----
  const span = {};
  for (const [t, timeCols] of TABLES) {
    for (const c of timeCols) {
      if (!hasCol(t, c)) continue;
      attempt(`${t}.${c}`, () => {
        const r = one(db, `SELECT MIN(${q(c)}) AS lo, MAX(${q(c)}) AS hi, COUNT(*) AS k FROM ${q(t)} WHERE ${q(c)} > 0`);
        if (r.k > 0) span[`${t}.${c}`] = { ...r, unit: detectUnit(r.hi) };
      });
    }
  }
  const ACT_TS = `${T_ACT}.TIMESTAMP`;
  const SLEEP_TS = `${T_SLEEP}.TIMESTAMP`;
  const WAKE_TS = `${T_SLEEP}.WAKEUP_TIME`;
  const inSeconds = col => (span[col]?.unit ?? (col === ACT_TS || col === `${T_FILE}.TIMESTAMP` ? 's' : 'ms')) === 's';
  const toMs = (v, col) => (inSeconds(col) ? v * 1000 : v);
  const fromMs = (t, col) => (inSeconds(col) ? Math.floor(t / 1000) : t);

  // ---- Appareil retenu : le plus de lignes d'activité sur 30 jours ----
  let devices = [];
  let dev = null;
  attempt('appareils', () => {
    if (!span[ACT_TS]) return;
    devices = listDevices(db, hasCol(T_ACT, 'DEVICE_ID'), inSeconds(ACT_TS) ? 's' : 'ms');
    dev = devices.length ? devices[0].id : null;
  });
  // Restriction à l'appareil retenu, si la table a une colonne DEVICE_ID.
  const scope = t => (dev !== null && hasCol(t, 'DEVICE_ID') ? { sql: 'DEVICE_ID = ?', p: [dev] } : { sql: '1 = 1', p: [] });
  const countIn = (t, cond = '1 = 1') => {
    if (!has.has(t)) return 0;
    const s = scope(t);
    return one(db, `SELECT COUNT(*) AS k FROM ${q(t)} WHERE ${s.sql} AND (${cond})`, s.p).k;
  };

  // ---- Dernière donnée de l'appareil retenu ----
  let lastMs = null;
  attempt('dernière donnée', () => {
    if (!span[ACT_TS]) return;
    const s = scope(T_ACT);
    const hi = one(db, `SELECT MAX(TIMESTAMP) AS hi FROM ${q(T_ACT)} WHERE ${s.sql}`, s.p).hi;
    if (hi > 0) lastMs = toMs(hi, ACT_TS);
  });

  // ---- Les 14 derniers jours locaux, jusqu'au jour de la dernière donnée ----
  const days = [];
  if (lastMs !== null) {
    const lastKey = clock.dayKey(lastMs);
    for (let i = DAYS - 1; i >= 0; i--) {
      const key = addDays(lastKey, -i);
      const start = clock.at(key);
      const end = clock.at(addDays(key, 1));
      days.push({
        key, start, end, minutes: Math.round((end - start) / 60000),
        nightFrom: clock.at(addDays(key, -1), CONFIG.NIGHT_FROM_HOUR), nightTo: clock.at(key, CONFIG.NIGHT_TO_HOUR), dayTo: clock.at(key, CONFIG.NIGHT_FROM_HOUR),
        samples: new Set(), hr: new Set(), quarters: new Set(), nights: [], stages: 0, summary: false, rest: false,
      });
    }
  }
  const from = days.length ? days[0].nightFrom : 0;

  // Échantillons minute : couverture, FC valide (testée en SQL : aucune valeur lue), pas de temps médian.
  const validMinutes = new Set();
  let sampling = null;
  let scanned = 0;
  attempt('échantillons des 14 jours', () => {
    if (!days.length) return;
    const s = scope(T_ACT);
    const ok = hasCol(T_ACT, 'HEART_RATE') ? `(HEART_RATE BETWEEN ${HR_LO} AND ${HR_HI})` : '0';
    const list = rows(db, `SELECT TIMESTAMP AS t, ${ok} AS ok FROM ${q(T_ACT)} WHERE ${s.sql} AND TIMESTAMP >= ? ORDER BY TIMESTAMP`,
      [...s.p, fromMs(from, ACT_TS)]);
    const gaps = [];
    let prev = null;
    let i = 0;
    for (const r of list) {
      const t = toMs(r.t, ACT_TS);
      const minute = Math.floor(t / 60000);
      if (prev !== null) gaps.push((t - prev) / 1000);
      prev = t;
      if (r.ok) validMinutes.add(minute);
      while (i < days.length && t >= days[i].end) i++;
      if (i < days.length && t >= days[i].start) {
        days[i].samples.add(minute);
        if (r.ok) {
          days[i].hr.add(minute);
          days[i].quarters.add(Math.floor(t / CONFIG.QUARTER_MS));
        }
      }
    }
    sampling = median(gaps);
    scanned = list.length;
  });

  // Sessions de sommeil : nuit D = début entre D-1 18:00 et D 06:00 (sans chaînage) ; sinon sieste.
  let naps = 0;
  const sleepHr = { valid: 0, total: 0 };
  attempt('sessions de sommeil', () => {
    if (!days.length || !hasCol(T_SLEEP, 'WAKEUP_TIME')) return;
    const s = scope(T_SLEEP);
    const durCols = [...STAGE_DURATIONS, 'TOTAL_DURATION'].filter(c => hasCol(T_SLEEP, c));
    const dur = durCols.length ? `(${stageSum(durCols)} > 0)` : '0';
    const sessions = rows(db, `SELECT TIMESTAMP AS s, WAKEUP_TIME AS e, ${dur} AS d FROM ${q(T_SLEEP)} WHERE ${s.sql} AND TIMESTAMP >= ? ORDER BY TIMESTAMP`,
      [...s.p, fromMs(from, SLEEP_TS)])
      .map(r => ({ s: toMs(r.s, SLEEP_TS), e: toMs(r.e ?? 0, WAKE_TS), d: Boolean(r.d) }));
    for (const x of sessions) {
      const night = days.find(d => x.s >= d.nightFrom && x.s < d.nightTo);
      if (night) night.nights.push(x);
      else if (days.some(d => x.s >= d.nightTo && x.s < d.dayTo)) naps++;
    }
    for (const d of days) {
      for (const x of d.nights) {
        const a = Math.floor(x.s / 60000);
        const b = Math.min(Math.floor(x.e / 60000), a + 1440);
        for (let m = a; m < b; m++) {
          sleepHr.total++;
          if (validMinutes.has(m)) sleepHr.valid++;
        }
      }
    }
  });

  // Stades enregistrés pendant les sessions de nuit.
  attempt('stades', () => {
    if (!days.length || !has.has(T_STAGE)) return;
    const s = scope(T_STAGE);
    const col = `${T_STAGE}.TIMESTAMP`;
    const ts = rows(db, `SELECT TIMESTAMP AS t FROM ${q(T_STAGE)} WHERE ${s.sql} AND TIMESTAMP >= ?`, [...s.p, fromMs(from, col)])
      .map(r => toMs(r.t, col));
    for (const d of days) d.stages = ts.filter(t => d.nights.some(x => t >= x.s && t <= x.e)).length;
  });

  // Résumés journaliers : présence, et HR_RESTING > 0 (testé en SQL, valeur jamais lue).
  attempt('résumés journaliers', () => {
    if (!days.length || !has.has(T_DAILY)) return;
    const s = scope(T_DAILY);
    const col = `${T_DAILY}.TIMESTAMP`;
    const ok = hasCol(T_DAILY, 'HR_RESTING') ? '(HR_RESTING > 0)' : '0';
    for (const r of rows(db, `SELECT TIMESTAMP AS t, ${ok} AS ok FROM ${q(T_DAILY)} WHERE ${s.sql} AND TIMESTAMP >= ?`, [...s.p, fromMs(from, col)])) {
      const d = days.find(x => x.key === clock.dayKey(toMs(r.t, col)));
      if (d) {
        d.summary = true;
        d.rest ||= Boolean(r.ok);
      }
    }
  });

  // VO2 max : toute table ou colonne qui en parle, et clés du JSON SUMMARY_DATA des séances.
  const vo2 = [];
  attempt('recherche de la VO2 max', () => {
    for (const t of tables) {
      if (VO2.test(t) && count[t] > 0) vo2.push(`table ${t} (${fmt(count[t])} lignes)`);
      for (const c of rows(db, `PRAGMA table_info(${q(t)})`)) {
        if (!VO2.test(c.name)) continue;
        const k = one(db, `SELECT COUNT(*) AS k FROM ${q(t)} WHERE ${q(c.name)} > 0`).k;
        if (k > 0) vo2.push(`${t}.${c.name} (${fmt(k)} valeurs > 0)`);
      }
    }
    if (!hasCol(T_WORKOUT, 'SUMMARY_DATA')) return;
    const s = scope(T_WORKOUT);
    const keys = new Map();
    for (const r of rows(db, `SELECT SUMMARY_DATA AS j FROM ${q(T_WORKOUT)} WHERE ${s.sql} AND SUMMARY_DATA IS NOT NULL AND SUMMARY_DATA <> ''`, s.p)) {
      try {
        for (const k of Object.keys(JSON.parse(r.j))) if (VO2.test(k)) keys.set(k, (keys.get(k) ?? 0) + 1);
      } catch { /* JSON illisible : ignoré */ }
    }
    for (const [k, n] of keys) vo2.push(`SUMMARY_DATA « ${k} » (${fmt(n)} séances)`);
  });

  // Résumés binaires des séances (RAW_SUMMARY_DATA, décodés par calc.js) : effectifs par sous-type, version et format,
  // disposition, nombre de VO2 non nulles et retenues. Comptages seulement : aucune valeur n'est lue dans le rapport.
  const blobs = new Map();
  attempt('résumés de séance', () => {
    if (!hasCol(T_WORKOUT, 'RAW_SUMMARY_DATA')) return;
    const s = scope(T_WORKOUT);
    const st = db.prepare(`SELECT RAW_SUMMARY_DATA FROM ${q(T_WORKOUT)} WHERE ${s.sql} AND RAW_SUMMARY_DATA IS NOT NULL`);
    try {
      st.bind(s.p);
      while (st.step()) {
        const raw = st.get()[0];
        const d = decodeSummary(raw instanceof Uint8Array ? raw : null);
        const id = d.status === 'illisible'
          ? 'illisibles'
          : `0x${d.subtype.toString(16).padStart(2, '0')} v${d.version} ${d.legacy ? 'ancien format' : 'format actuel'}`;
        if (!blobs.has(id)) blobs.set(id, { k: 0, status: d.status, read: 0, misaligned: 0, nonzero: 0, kept: 0 });
        const b = blobs.get(id);
        b.k++;
        if (d.status === 'lu') b.read++;
        if (d.status === 'désaligné') b.misaligned++;
        if (d.vo2Raw > 0) b.nonzero++;
        if (d.vo2 !== null) b.kept++;
      }
    } finally {
      st.free();
    }
  });

  // Unité des durées de sommeil : TOTAL_DURATION comparé à WAKEUP_TIME − TIMESTAMP.
  // Seul le verdict est affiché : le rapport lui-même révélerait l'efficacité du sommeil.
  const sleepUnit = () => {
    if (!hasCol(T_SLEEP, 'TOTAL_DURATION') || !hasCol(T_SLEEP, 'WAKEUP_TIME')) return 'colonnes absentes';
    const ratios = rows(db, `SELECT TIMESTAMP AS s, WAKEUP_TIME AS e, TOTAL_DURATION AS d FROM ${q(T_SLEEP)} WHERE TOTAL_DURATION > 0 AND WAKEUP_TIME > 0 AND TIMESTAMP > 0`)
      .map(r => r.d / ((toMs(r.e, WAKE_TS) - toMs(r.s, SLEEP_TS)) / 60000))
      .filter(x => Number.isFinite(x) && x > 0);
    const m = median(ratios);
    const verdict = m === null ? 'indéterminée' : m >= 0.2 && m <= 1.5 ? 'minutes' : m >= 12 && m <= 90 ? 'secondes' : 'indéterminée';
    return `${verdict} (${fmt(ratios.length)} sessions comparées ; à confirmer contre l'écran sommeil de Gadgetbridge)`;
  };

  // Profil : lu pour des contrôles oui/non ; ses valeurs ne figurent jamais dans le rapport.
  let profile = null;
  attempt('profil', () => { profile = readProfile(db, clock.dayKey(now), now); });

  // ================= Rapport =================
  say(`DIAGNOSTIC — Âge bio ${APP_VERSION}`);
  say(`Généré le ${clock.dateTime(now)} · fuseau ${meta.timeZone} · SQLite ${one(db, 'SELECT sqlite_version() AS v').v}`);
  say('Structure et couverture uniquement : aucune valeur de santé.');

  section('FICHIER', () => {
    say(`  Taille : ${sizeMo(meta.size)} · modifié le ${clock.dateTime(meta.lastModified)}`);
    say(`  Octets 18-19 : ${meta.b18} et ${meta.b19}${meta.walFixed ? ' (journal WAL : remis à 1 en mémoire ; fichier intact)' : ''}`);
    say(`  PRAGMA user_version : ${one(db, 'PRAGMA user_version').user_version}`);
    say(`  Tables : ${fmt(tables.length)}, dont ${fmt(tables.filter(t => count[t] > 0).length)} non vides`);
    if (missing.length) say(`  EXPORT NON RECONNU : table(s) absente(s) : ${missing.join(', ')}`);
  });

  section(`APPAREILS (lignes ${T_ACT} : total / 30 derniers jours)`, () => {
    const info = new Map();
    if (has.has('DEVICE')) {
      const sel = ['_id', 'NAME', 'MODEL', 'TYPE_NAME', 'IDENTIFIER'].map(c => (hasCol('DEVICE', c) ? q(c) : `NULL AS ${q(c)}`)).join(', ');
      for (const d of rows(db, `SELECT ${sel} FROM DEVICE`)) info.set(d._id, d);
    }
    // Identifiant : seulement ses 2 derniers octets.
    const label = (id, d = {}) => `#${id} ${d.NAME ?? '?'} · modèle ${d.MODEL || '—'} · ${d.TYPE_NAME ?? '?'} · …${String(d.IDENTIFIER ?? '?').slice(-5)}`;
    for (const d of devices) say(`  ${label(d.id, info.get(d.id))} · ${fmt(d.n)} / ${fmt(d.n30)}${d.id === dev ? '  ← retenu' : ''}`);
    for (const [id, d] of info) if (!devices.some(x => x.id === id)) say(`  ${label(id, d)} · aucun échantillon`);
    if (!devices.length && !info.size) say('  aucun appareil');
    say(lastMs === null ? '  Dernière donnée : aucune' : `  Dernière donnée : ${clock.dateTime(lastMs)} (il y a ${ago(now - lastMs)})`);
  });

  section('TABLES LUES (schéma Gadgetbridge 160)', () => {
    for (const [t, timeCols] of TABLES) {
      if (!has.has(t)) {
        say(`  ${t} : ABSENTE`);
        continue;
      }
      say(`  ${t} — ${fmt(count[t])} lignes`);
      say(wrap('    Colonnes : ', cols[t].map(c => `${c.name} ${c.type || '?'}`)));
      for (const c of timeCols) {
        const col = `${t}.${c}`;
        const s = span[col];
        if (!hasCol(t, c)) say(`    ${c} : colonne absente`);
        else if (!s) say(`    ${c} : aucune valeur > 0`);
        else {
          const empty = count[t] - s.k;
          say(`    ${c} : du ${clock.date(toMs(s.lo, col))} au ${clock.date(toMs(s.hi, col))} · ${s.unit === 's' ? 'secondes' : 'millisecondes'}${empty > 0 ? ` · ${fmt(empty)} à 0 ou vides` : ''}`);
        }
      }
    }
  });

  section('AUTRES TABLES NON VIDES (lignes)', () => {
    const others = tables.filter(t => count[t] > 0 && !TABLES.some(([x]) => x === t));
    say(others.length ? wrap('  ', others.map(t => `${t} (${fmt(count[t])})`)) : '  aucune');
  });

  section('UNITÉS ET ÉCHANTILLONNAGE', () => {
    say('  Horodatages : unité indiquée pour chaque colonne ci-dessus (max < 1e11 → secondes).');
    say(sampling === null
      ? `  Pas de temps médian de ${T_ACT} : indéterminé`
      : `  Pas de temps médian de ${T_ACT} : ${fmt(sampling)} s (${DAYS} derniers jours, ${fmt(scanned)} échantillons)`);
    // Fréquence réelle des mesures de FC : avec « Une fois par minute », l'écart médian vaut 1 min.
    const sampled = days.reduce((n, d) => n + d.samples.size, 0);
    const withHr = days.reduce((n, d) => n + d.hr.size, 0);
    const hrMinutes = [...validMinutes];
    const hrGap = median(hrMinutes.slice(1).map((m, i) => m - hrMinutes[i]));
    say(`  FC valide : ${sampled ? `${pct(withHr, sampled)} % des minutes échantillonnées` : 'aucune minute échantillonnée'}`);
    say(`  Écart médian entre deux FC valides : ${hrGap === null ? 'indéterminé' : `${fmt(hrGap)} min`} (attendu : 1 min)`);
    say(`  Durées de sommeil : ${sleepUnit()}`);
  });

  section('SOMMEIL ET SÉANCES (appareil retenu)', () => {
    if (has.has(T_SLEEP)) {
      const stageCols = STAGE_DURATIONS.filter(c => hasCol(T_SLEEP, c));
      const parts = [`${fmt(countIn(T_SLEEP))} sessions`];
      if (hasCol(T_SLEEP, 'IS_AWAKE')) parts.push(`IS_AWAKE = 1 : ${fmt(countIn(T_SLEEP, 'IS_AWAKE = 1'))}`);
      if (stageCols.length) parts.push(`durées par stade > 0 : ${fmt(countIn(T_SLEEP, `${stageSum(stageCols)} > 0`))}`);
      if (hasCol(T_SLEEP, 'TOTAL_DURATION')) parts.push(`TOTAL_DURATION > 0 : ${fmt(countIn(T_SLEEP, 'TOTAL_DURATION > 0'))}`);
      if (hasCol(T_SLEEP, 'INTO_BED_TIME')) parts.push(`INTO_BED_TIME > 0 : ${fmt(countIn(T_SLEEP, 'INTO_BED_TIME > 0'))}`);
      say(wrap('  Sommeil : ', parts));
    }
    if (has.has(T_WORKOUT)) {
      const parts = [`${fmt(countIn(T_WORKOUT))} séances`];
      if (hasCol(T_WORKOUT, 'SUMMARY_DATA')) parts.push(`SUMMARY_DATA renseigné : ${fmt(countIn(T_WORKOUT, "SUMMARY_DATA IS NOT NULL AND SUMMARY_DATA <> ''"))}`);
      if (hasCol(T_WORKOUT, 'RAW_SUMMARY_DATA')) parts.push(`RAW_SUMMARY_DATA renseigné : ${fmt(countIn(T_WORKOUT, 'RAW_SUMMARY_DATA IS NOT NULL'))}`);
      if (hasCol(T_WORKOUT, 'START_TIME') && hasCol(T_WORKOUT, 'END_TIME')) parts.push(`fin > début : ${fmt(countIn(T_WORKOUT, 'END_TIME > START_TIME'))}`);
      say(wrap('  Séances : ', parts));
    }
  });

  section('CODES (valeur → effectif, appareil retenu)', () => {
    for (const [t, c] of [[T_STAGE, 'STAGE'], [T_WORKOUT, 'ACTIVITY_KIND'], [T_MANUAL, 'TYPE']]) {
      if (!hasCol(t, c)) {
        say(`  ${c} : ${has.has(t) ? `colonne absente de ${t}` : `table ${t} absente`}`);
        continue;
      }
      const s = scope(t);
      // Séances : nombre avec une durée exploitable (fin > début) et marque « renfo » pour CONFIG.STRENGTH_KINDS.
      const withEnd = c === 'ACTIVITY_KIND' && hasCol(t, 'START_TIME') && hasCol(t, 'END_TIME');
      const list = rows(db, `SELECT ${q(c)} AS v, COUNT(*) AS k${withEnd ? ', SUM(END_TIME > START_TIME) AS ok' : ''} FROM ${q(t)} WHERE ${s.sql} GROUP BY ${q(c)} ORDER BY ${q(c)}`, s.p);
      const item = r => `${code(r.v)} → ${fmt(r.k)}${withEnd ? ` (fin > début : ${fmt(r.ok ?? 0)}${isStrength(r.v) ? ', renfo' : ''})` : ''}`;
      say(wrap(`  ${c} (${t}) : `, list.length ? list.map(item) : ['aucune ligne']));
    }
  });

  section(`FICHIERS REÇUS DU BRACELET (${T_FILE} : type/sous-type/détail, version → effectif)`, () => {
    const need = ['TYPE', 'SUBTYPE', 'DETAIL_TYPE', 'VERSION'];
    if (!has.has(T_FILE) || !need.every(c => hasCol(T_FILE, c))) {
      say(`  ${has.has(T_FILE) ? 'colonnes absentes' : 'table absente'}`);
      return;
    }
    const s = scope(T_FILE);
    const list = rows(db, `SELECT TYPE AS a, SUBTYPE AS b, DETAIL_TYPE AS c, VERSION AS v, COUNT(*) AS k FROM ${q(T_FILE)} WHERE ${s.sql} GROUP BY a, b, c, v ORDER BY a, b, c, v`, s.p);
    if (!list.length) say('  aucun fichier');
    for (const r of list) {
      const id = `${r.a}/${r.b}/${r.c}`;
      const label = FILE_KINDS[id] ?? (r.a === 1 ? `séance (${['détails', 'résumé', 'trace GPS'][r.c] ?? '?'})` : '?');
      say(`  ${id.padEnd(7)} v${String(r.v).padEnd(3)} ${label.padEnd(18)} → ${fmt(r.k)}`);
    }
  });

  section(`RÉSUMÉS DE SÉANCE (${T_WORKOUT}.RAW_SUMMARY_DATA : sous-type, version, format → effectifs)`, () => {
    if (!hasCol(T_WORKOUT, 'RAW_SUMMARY_DATA')) {
      say(`  ${has.has(T_WORKOUT) ? 'colonne absente' : 'table absente'}`);
      return;
    }
    if (!blobs.size) say('  aucun résumé');
    const LAYOUT = { lu: 'disposition documentée', 'désaligné': 'disposition documentée', 'sans-vo2': 'sans champ VO2', 'non-documentée': 'disposition non documentée : VO2 non lue' };
    for (const [id, b] of [...blobs].sort(([a], [z]) => a.localeCompare(z))) {
      if (b.status === 'illisible') {
        say(`  ${id} (pas un résumé de séance lisible) → ${fmt(b.k)}`);
        continue;
      }
      const parts = [`${id} → ${fmt(b.k)}`, LAYOUT[b.status]];
      if (b.status === 'lu' || b.status === 'désaligné') {
        parts.push(`alignés ${fmt(b.read)}`, `désalignés ${fmt(b.misaligned)}`, `VO2 non nulle ${fmt(b.nonzero)}`, `retenue (${CONFIG.VO2_PLAUSIBLE.join(' à ')}) ${fmt(b.kept)}`);
      }
      say(wrap('  ', parts));
    }
    say('  Format actuel : octet 7 = 0 et CRC32 final ; ancien format (avant le 26/07/2024) : positions − 1.');
  });

  section(`${DAYS} DERNIERS JOURS (appareil retenu)`, () => {
    if (!days.length) {
      say("  aucune donnée d'activité");
      return;
    }
    const widths = [5, 4, 6, 7, 5, 7, 7, 7, 9];
    const row = cells => `  ${cells[0].padEnd(11)} ${cells.slice(1).map((c, i) => c.padStart(widths[i])).join(' ')}`;
    say(row(['Jour', 'Éch%', 'FC%', '¼h FC', 'Valide', 'Nuit', 'Durées', 'Stades', 'Résumé', 'FC repos']));
    for (const d of days) {
      say(row([
        d === days[days.length - 1] ? `${d.key}*` : d.key,
        String(pct(d.samples.size, d.minutes)),
        String(pct(d.hr.size, d.minutes)),
        String(d.quarters.size),
        yesNo(d.quarters.size >= CONFIG.VALID_DAY_QUARTERS),
        String(d.nights.length),
        d.nights.length ? yesNo(d.nights.some(x => x.d)) : '—',
        d.nights.length ? yesNo(d.stages > 0) : '—',
        yesNo(d.summary),
        yesNo(d.rest),
      ]));
    }
    say(
      '  * jour de la dernière donnée, sans doute incomplet.',
      '  Éch% : minutes ayant un échantillon. FC% : minutes avec une FC valide (30 à 220).',
      `  ¼h FC : quarts d'heure contenant une FC valide (jour valide si ≥ ${CONFIG.VALID_DAY_QUARTERS}).`,
      '  Nuit : sessions de sommeil commençant entre la veille 18:00 et le jour 06:00.',
      '  Durées : durées de sommeil (stades ou total) > 0. Stades : échantillons de',
      `  stades pendant ces sessions. Résumé : ligne de ${T_DAILY}`,
      '  ce jour-là. FC repos : HR_RESTING > 0 ce jour-là.',
      `  Sessions hors nuit (siestes) : ${fmt(naps)}`,
      `  FC valide pendant les sessions de nuit : ${sleepHr.total ? `${pct(sleepHr.valid, sleepHr.total)} % des minutes` : 'aucune session'}`,
    );
  });

  section('PRÉSENCE', () => {
    const stageCols = STAGE_DURATIONS.filter(c => hasCol(T_SLEEP, c));
    const stageRows = countIn(T_STAGE);
    const stageSessions = stageCols.length ? countIn(T_SLEEP, `${stageSum(stageCols)} > 0`) : 0;
    say(`  Stades de sommeil : ${yesNo(stageRows > 0 || stageSessions > 0)} (${fmt(stageRows)} échantillons de stades, ${fmt(stageSessions)} sessions avec durées par stade)`);
    say(`  HR_RESTING > 0 : ${hasCol(T_DAILY, 'HR_RESTING') ? yesNo(countIn(T_DAILY, 'HR_RESTING > 0') > 0) : 'colonne absente'}`);
    say(`  FC nocturne minute par minute : ${sleepHr.total ? `${pct(sleepHr.valid, sleepHr.total)} % des minutes de sommeil (${DAYS} dernières nuits)` : 'aucune session de nuit'}`);
    const kept = [...blobs.values()].reduce((a, b) => a + b.kept, 0);
    say(`  VO2 max du bracelet (RAW_SUMMARY_DATA) : ${kept ? `${plural(kept, 'séance')} avec une VO2 retenue` : 'aucune VO2 retenue'}`);
    say(`  VO2 max ailleurs : ${vo2.length ? vo2.join(' ; ') : 'non trouvée (aucune table ni colonne VO2 ; aucune clé VO2 dans SUMMARY_DATA, que Gadgetbridge vide)'}`);
    const workouts = countIn(T_WORKOUT);
    say(`  Séances : ${yesNo(workouts > 0)} (${fmt(workouts)})`);
  });

  section('PROFIL GADGETBRIDGE (contrôles oui/non, aucune valeur)', () => {
    if (!profile) {
      say(has.has(T_USER) || has.has(T_ATTR) ? '  illisible : voir AVERTISSEMENTS' : `  tables ${T_USER} et ${T_ATTR} absentes`);
      return;
    }
    const c = profileChecks(profile);
    say(`  Utilisateurs : ${fmt(profile.users)} · versions du profil : ${fmt(profile.versions)} · version en cours : ${yesNo(profile.current)}`);
    say(`  Vraisemblable : date de naissance ${yesNo(c.birth)}, sexe ${yesNo(c.gender)}, taille ${yesNo(c.height)}, poids ${yesNo(c.weight)}`);
    say(`  Identique aux valeurs par défaut de Gadgetbridge : ${yesNo(c.defaults)}`);
    say(`  Bornes : âge ${PLAUSIBLE.age.join(' à ')} ans ; sexe codé 0, 1 ou 2 ; taille ${PLAUSIBLE.height.join(' à ')} cm ; poids ${PLAUSIBLE.weight.join(' à ')} kg.`);
  });

  if (warnings.length) section('AVERTISSEMENTS', () => warnings.forEach(w => say(`  ⚠ ${w}`)));
  return { text: out.join('\n'), missing, lastMs, profile };
}

// Section « CALCUL » du Diagnostic : comptages et oui/non seulement, aucune valeur de santé.
export function calcDiagnostic(data) {
  const { result: r, info } = data;
  const lines = ['', `CALCUL (méthode ${CONFIG.METHOD_VERSION} ; comptages seulement)`];
  lines.push(`  Jours avec données : ${fmt(info.days)} · valides : ${fmt(r.validDays)} · nuits : ${fmt(info.nights)} · valides : ${fmt(r.validNights)}`);
  lines.push(`  Sommeil tiré de : stades ${fmt(info.sources[0])}, TOTAL − AWAKE ${fmt(info.sources[1])}, session entière ${fmt(info.sources[2])} (nuits)`);
  lines.push(`  Unité des durées de sommeil : ${info.unit === 's' ? 'secondes' : 'minutes'} (${info.unitDetected ? 'détectée' : 'par défaut, à confirmer'})`);
  lines.push(`  FC de repos nocturne (M8, zones) : ${fmt(info.restNights)} / ${plural(info.needRest, 'nuit valide', 'nuits valides')} (au moins ${CONFIG.REST_MIN_SAMPLES} min de FC) · HR_RESTING du bracelet sur ${plural(info.restDays, 'jour')} (tableau 7 jours)`);
  lines.push(`  Séances : ${fmt(info.workouts)} · avec durée (zones) : ${fmt(info.timed)} · renforcement avec durée : ${fmt(info.strength)} · sans durée : ${fmt(info.strengthUndated)} · VO2 du bracelet retenues : ${fmt(info.vo2)}`);
  lines.push(`  Profil utilisable : ${yesNo(info.profileUsable)} · zones cardiaques : ${yesNo(info.zones)} · taille et poids (VO2 estimée) : ${yesNo(info.body)}`);
  const u = r.unlock;
  if (u) lines.push(`  Déblocage : ${fmt(u.nightsIn31)} nuits valides sur les ${CONFIG.UNLOCK_SPAN} dernières (${u.needed} requises) · déjà débloqué : ${yesNo(u.everUnlocked)}`);
  const o = r.official;
  if (o) {
    lines.push(`  Valeur officielle : dimanche ${dmy(o.key)}${o.paused ? `, en pause (dernier dimanche ${dmy(o.lastSunday)} : ${fmt(o.nightsIn31)} nuits sur ${CONFIG.UNLOCK_SPAN})` : ''} · calibrage : ${yesNo(o.calibrating)} · mise à jour dans ${plural(o.nextUpdateDays, 'jour')}`);
    lines.push(wrap('  Indicateurs (182 j) : ', o.indicators.map(x => `${x.id} ${x.present ? 'oui' : x.estimated ? 'estimé' : 'non'}`)));
  } else {
    lines.push(`  Valeur officielle : aucune${data.usable ? '' : ' (profil inutilisable)'}`);
  }
  lines.push(`  Aperçu quotidien : ${yesNo(r.preview)} · points de courbe : ${fmt(r.curve?.length ?? 0)} · leviers : ${fmt(r.levers?.length ?? 0)}`);
  return lines.join('\n');
}

// ================= Base de démonstration (synthétique : aucune donnée réelle) =================

const MIN = 60000;
const DAY = 86400000;
const PK = 'PRIMARY KEY (TIMESTAMP, DEVICE_ID) ON CONFLICT REPLACE';

// [table, colonnes, WITHOUT ROWID] — colonnes et types du schéma 160.
export const SCHEMA = [
  ['XIAOMI_ACTIVITY_SAMPLE', `TIMESTAMP INTEGER NOT NULL, DEVICE_ID INTEGER NOT NULL, USER_ID INTEGER NOT NULL,
    RAW_INTENSITY INTEGER NOT NULL, STEPS INTEGER NOT NULL, RAW_KIND INTEGER NOT NULL, HEART_RATE INTEGER NOT NULL,
    STRESS INTEGER, SPO2 INTEGER, DISTANCE_CM INTEGER, ACTIVE_CALORIES INTEGER, ENERGY INTEGER, ${PK}`, true],
  ['XIAOMI_SLEEP_TIME_SAMPLE', `TIMESTAMP INTEGER NOT NULL, DEVICE_ID INTEGER NOT NULL, USER_ID INTEGER NOT NULL,
    WAKEUP_TIME INTEGER, IS_AWAKE INTEGER, TOTAL_DURATION INTEGER, DEEP_SLEEP_DURATION INTEGER,
    LIGHT_SLEEP_DURATION INTEGER, REM_SLEEP_DURATION INTEGER, AWAKE_DURATION INTEGER, INTO_BED_TIME INTEGER, ${PK}`, true],
  ['XIAOMI_SLEEP_STAGE_SAMPLE', `TIMESTAMP INTEGER NOT NULL, DEVICE_ID INTEGER NOT NULL, USER_ID INTEGER NOT NULL,
    STAGE INTEGER, ${PK}`, true],
  ['XIAOMI_DAILY_SUMMARY_SAMPLE', `TIMESTAMP INTEGER NOT NULL, DEVICE_ID INTEGER NOT NULL, USER_ID INTEGER NOT NULL,
    TIMEZONE INTEGER, STEPS INTEGER, HR_RESTING INTEGER, HR_MAX INTEGER, HR_MAX_TS INTEGER, HR_MIN INTEGER,
    HR_MIN_TS INTEGER, HR_AVG INTEGER, STRESS_AVG INTEGER, STRESS_MAX INTEGER, STRESS_MIN INTEGER, STANDING INTEGER,
    CALORIES INTEGER, SPO2_MAX INTEGER, SPO2_MAX_TS INTEGER, SPO2_MIN INTEGER, SPO2_MIN_TS INTEGER, SPO2_AVG INTEGER,
    TRAINING_LOAD_DAY INTEGER, TRAINING_LOAD_WEEK INTEGER, TRAINING_LOAD_LEVEL INTEGER, VITALITY_INCREASE_LIGHT INTEGER,
    VITALITY_INCREASE_MODERATE INTEGER, VITALITY_INCREASE_HIGH INTEGER, VITALITY_CURRENT INTEGER,
    ACTIVE_CALORIES INTEGER, RECOVERY_HOURS INTEGER, ${PK}`, true],
  ['XIAOMI_MANUAL_SAMPLE', `TIMESTAMP INTEGER NOT NULL, DEVICE_ID INTEGER NOT NULL, USER_ID INTEGER NOT NULL,
    TYPE INTEGER, VALUE INTEGER, ${PK}`, true],
  ['BASE_ACTIVITY_SUMMARY', `_id INTEGER PRIMARY KEY AUTOINCREMENT, NAME TEXT, START_TIME INTEGER NOT NULL,
    END_TIME INTEGER, OVERRIDE_ACTIVITY_KIND INTEGER, ACTIVITY_KIND INTEGER NOT NULL, BASE_LONGITUDE INTEGER,
    BASE_LATITUDE INTEGER, BASE_ALTITUDE INTEGER, GPX_TRACK TEXT, RAW_DETAILS_PATH TEXT, HEADER_PHOTO TEXT,
    DEVICE_ID INTEGER NOT NULL, USER_ID INTEGER NOT NULL, SUMMARY_DATA TEXT, RAW_SUMMARY_DATA BLOB`, false],
  ['DEVICE', `_id INTEGER PRIMARY KEY AUTOINCREMENT, NAME TEXT NOT NULL, MANUFACTURER TEXT NOT NULL,
    IDENTIFIER TEXT NOT NULL UNIQUE, TYPE INTEGER NOT NULL, TYPE_NAME TEXT, MODEL TEXT, ALIAS TEXT, PARENT_FOLDER TEXT`, false],
  ['XIAOMI_ACTIVITY_FILE', `DEVICE_ID INTEGER NOT NULL, TIMESTAMP INTEGER NOT NULL, TYPE INTEGER NOT NULL,
    SUBTYPE INTEGER NOT NULL, DETAIL_TYPE INTEGER NOT NULL, TIMEZONE INTEGER, VERSION INTEGER, FILE_PATH TEXT,
    PRIMARY KEY (DEVICE_ID, TIMESTAMP, TYPE, SUBTYPE, DETAIL_TYPE) ON CONFLICT REPLACE`, true],
  ['USER', '_id INTEGER PRIMARY KEY AUTOINCREMENT, NAME TEXT NOT NULL, BIRTHDAY INTEGER NOT NULL, GENDER INTEGER NOT NULL', false],
  ['USER_ATTRIBUTES', `_id INTEGER PRIMARY KEY AUTOINCREMENT, HEIGHT_CM INTEGER NOT NULL, WEIGHT_KG INTEGER NOT NULL,
    SLEEP_GOAL_HPD INTEGER, STEPS_GOAL_SPD INTEGER, VALID_FROM_UTC INTEGER, VALID_TO_UTC INTEGER, SLEEP_GOAL_MPD INTEGER,
    USER_ID INTEGER NOT NULL`, false],
];

// Codes ACTIVITY_KIND (Gadgetbridge ActivityKind.java, commit 3c30da08).
export const WEIGHTLIFTING = 0x04000109;    // séance « Musculation » du bracelet (Xiaomi 315)
export const OUTDOOR_RUNNING = 0x040000b1;  // Xiaomi 1
export const YOGA = 0x00004000;             // Xiaomi 12
export const HIIT = 0x04000045;             // Xiaomi 16

// Base en mémoire : instants en ms ; XIAOMI_ACTIVITY_SAMPLE en secondes (ou en ms).
export class Fixture {
  constructor(SQL, { tables = SCHEMA.map(([name]) => name), activityUnit = 's', device = 1 } = {}) {
    this.db = new SQL.Database();
    this.unit = activityUnit;
    this.dev = device;
    this.statements = new Map();
    this.db.run('PRAGMA user_version = 160');
    for (const [name, cols, noRowid] of SCHEMA) {
      if (tables.includes(name)) this.db.run(`CREATE TABLE "${name}" (${cols})${noRowid ? ' WITHOUT ROWID' : ''}`);
    }
    if (tables.includes('DEVICE')) {
      this.db.run(`INSERT INTO DEVICE (_id, NAME, MANUFACTURER, IDENTIFIER, TYPE, TYPE_NAME, MODEL)
        VALUES (?, 'Bracelet de démonstration', 'Xiaomi', '00:00:00:00:AB:CD', 0, 'MIBAND7PRO', 'M2141B1')`, [device]);
    }
    this.db.run('BEGIN');
  }

  run(sql, params) {
    if (!this.statements.has(sql)) this.statements.set(sql, this.db.prepare(sql));
    this.statements.get(sql).run(params);
  }

  minute(t, hr = 0, steps = 0) {
    this.run(`INSERT INTO XIAOMI_ACTIVITY_SAMPLE (TIMESTAMP, DEVICE_ID, USER_ID, RAW_INTENSITY, STEPS, RAW_KIND, HEART_RATE)
      VALUES (?, ?, 1, 0, ?, 0, ?)`, [this.unit === 's' ? Math.floor(t / 1000) : t, this.dev, steps, hr]);
  }

  summary(t, rest) {
    this.run('INSERT INTO XIAOMI_DAILY_SUMMARY_SAMPLE (TIMESTAMP, DEVICE_ID, USER_ID, HR_RESTING) VALUES (?, ?, 1, ?)', [t, this.dev, rest]);
  }

  sleep({ start, end, intoBed = 0, isAwake = 0, total = 0, deep = 0, light = 0, rem = 0, awake = 0 }) {
    this.run(`INSERT INTO XIAOMI_SLEEP_TIME_SAMPLE (TIMESTAMP, DEVICE_ID, USER_ID, WAKEUP_TIME, IS_AWAKE, TOTAL_DURATION,
      DEEP_SLEEP_DURATION, LIGHT_SLEEP_DURATION, REM_SLEEP_DURATION, AWAKE_DURATION, INTO_BED_TIME)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`, [start, this.dev, end, isAwake, total, deep, light, rem, awake, intoBed]);
  }

  // raw : RAW_SUMMARY_DATA (Uint8Array) ; par défaut un octet, comme un résumé illisible.
  workout({ start, end, kind, raw = null }) {
    this.run(`INSERT INTO BASE_ACTIVITY_SUMMARY (START_TIME, END_TIME, ACTIVITY_KIND, DEVICE_ID, USER_ID, RAW_SUMMARY_DATA)
      VALUES (?, ?, ?, ?, 1, ?)`, [start, end, kind, this.dev, raw ?? new Uint8Array([0])]);
  }

  user({ birthday, gender, name = 'Test' }) {
    this.run('INSERT INTO USER (NAME, BIRTHDAY, GENDER) VALUES (?, ?, ?)', [name, birthday, gender]);
  }

  attributes({ height, weight, from = null, to = null, user = 1 }) {
    this.run(`INSERT INTO USER_ATTRIBUTES (HEIGHT_CM, WEIGHT_KG, STEPS_GOAL_SPD, VALID_FROM_UTC, VALID_TO_UTC, USER_ID)
      VALUES (?, ?, 8000, ?, ?, ?)`, [height, weight, from, to, user]);
  }

  done() {
    for (const st of this.statements.values()) st.free();
    this.statements.clear();
    this.db.run('COMMIT');
    return this.db;
  }
}

// Résumé binaire de séance au format de Gadgetbridge (CONFIG.VO2_LAYOUTS) : en-tête de fichier (horodatage, fuseau,
// version, drapeaux type 1 / sous-type / détail 1, octet 7 = 0), début de séance, FC moyenne / max / min et VO2 max
// à leur position, CRC32 final. legacy : ancien format (sans octet 7 ni CRC). startShift : décalage (s) du début de
// séance du corps, pour simuler un désalignement.
export function summaryBlob({ start, subtype = 0x16, version = 5, vo2 = 0, hr = [142, 168, 96], legacy = false, startShift = 0 }) {
  const layout = CONFIG.VO2_LAYOUTS[`${subtype}/${version}`];
  const size = (layout ? layout.vo2 + 1 : 40) + 24;
  const b = new Uint8Array(size);
  const put32 = (i, v) => {
    for (let k = 0; k < 4; k++) b[i + k] = (v >>> (8 * k)) & 255;
  };
  const ts = Math.floor(start / 1000);
  put32(0, ts);
  b[4] = 4;   // fuseau, en quarts d'heure
  b[5] = version;
  b[6] = 0x80 | (subtype << 2) | 1;
  b[7] = 0;
  if (layout) {
    put32(layout.start, ts + startShift);
    layout.hr.forEach((i, k) => { b[i] = hr[k]; });
    b[layout.vo2] = vo2;
  }
  put32(size - 4, crc32(b, 0, size - 4));
  if (!legacy) return b;
  const old = new Uint8Array(size - 5);
  old.set(b.subarray(0, 7), 0);
  old.set(b.subarray(8, size - 4), 7);
  return old;
}

// Nuit D : coucher [h, m] la veille (ou le jour D si h < 12), lever [h, m] le jour D ; durées en minutes.
// source : 'stages' (durées par stade), 'total' (TOTAL et AWAKE seulement), 'span' (aucune durée).
// hr : FC minute par minute pendant la session (nombre ou fonction de l'instant), sinon aucune.
export function addNight(fx, cal, key, { bed = [23, 0], wake = [7, 0], sleepMin = 480, awakeMin = 0, intoBedMin = 0, source = 'stages', hr = null }) {
  const start = bed[0] >= 12 ? cal.at(addDays(key, -1), bed[0], bed[1]) : cal.at(key, bed[0], bed[1]);
  const end = cal.at(key, wake[0], wake[1]);
  const deep = Math.round(sleepMin * 0.2);
  const rem = Math.round(sleepMin * 0.22);
  const staged = source === 'stages';
  fx.sleep({
    start,
    end,
    intoBed: intoBedMin ? start - intoBedMin * MIN : 0,
    total: source === 'span' ? 0 : sleepMin + awakeMin,
    deep: staged ? deep : 0,
    light: staged ? sleepMin - deep - rem : 0,
    rem: staged ? rem : 0,
    awake: source === 'span' ? 0 : awakeMin,
  });
  if (hr !== null) {
    for (let t = start; t < end; t += MIN) fx.minute(t, typeof hr === 'function' ? hr(t) : hr, 0);
  }
  return { start, end };
}

// Générateur pseudo-aléatoire reproductible (mulberry32) et loi normale (Box-Muller).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (rand, mu, sigma) => mu + sigma * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const bound = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ================= Mode démo (index.html?demo, ?demo=nouveau, ?demo=pause) =================

export const DEMO_SCENARIOS = ['complet', 'nouveau', 'pause'];

// Base de démonstration jusqu'à `now`. Scénarios :
// - 'complet' : 200 jours ; séances de renforcement (musculation, HIIT, yoga) et de course (VO2 du bracelet dans
//   certaines), marches soutenues hors séance, efforts trop courts (non comptés), nuits avec et sans stades, quelques
//   jours non valides ; habitudes un peu meilleures sur les 30 derniers jours (rythme < 1).
// - 'nouveau' : 10 nuits, pas encore débloqué.
// - 'pause' : débloqué, puis moins de 21 nuits valides sur les 31 derniers jours (bracelet souvent retiré la nuit).
export function buildDemo(SQL, now, timeZone, scenario = 'complet') {
  const name = scenario || 'complet';
  if (!DEMO_SCENARIOS.includes(name)) throw new Error(`Scénario de démonstration inconnu : ${name}`);
  const cal = makeCalendar(timeZone);
  const rand = rng(20261115 + DEMO_SCENARIOS.indexOf(name));
  const fx = new Fixture(SQL);
  const birth = '1984-06-15';
  const today = cal.dayKey(now);
  const span = { complet: 200, nouveau: 10, pause: 130 }[name];
  fx.user({ birthday: cal.at(birth), gender: 1, name: 'Démo' });
  fx.attributes({ height: 178, weight: 76, from: now - (span + 5) * DAY });
  const age = decimalAge(birth, today);
  const recentFrom = addDays(today, -30);

  // ---- Nuits : FC minute par minute ; une nuit qui ne serait pas finie à `now` n'est pas créée ----
  const restOf = key => (key >= recentFrom ? 55.5 : 56.5);
  const last = cal.at(today, 9, 30) <= now ? today : addDays(today, -1);
  for (let i = span - 1; i >= 0; i--) {
    const key = addDays(last, -i);
    if (name === 'pause' && key > addDays(today, -31) && i % 3 !== 0) continue;   // ≈ 1 nuit sur 3 le dernier mois
    if (name === 'complet' && i > 0 && rand() < 0.04) continue;                  // nuit non enregistrée
    const rest = restOf(key) + normal(rand, 0, 1);
    const bedMin = Math.round(normal(rand, 23 * 60 + 10, key >= recentFrom ? 22 : 28));
    const awakeMin = Math.round(15 + rand() * 10);
    // Lever au plus tard à 09:25 (la nuit du jour est finie quand `now` ≥ 09:30).
    const sleepMin = Math.min(Math.round(bound(normal(rand, key >= recentFrom ? 432 : 420, 25), 300, 540)), 9 * 60 + 25 + 24 * 60 - bedMin - awakeMin);
    const wakeMin = bedMin + sleepMin + awakeMin - 24 * 60;
    const r = rand();
    addNight(fx, cal, key, {
      bed: [Math.floor(bedMin / 60) % 24, bedMin % 60],
      wake: [Math.floor(wakeMin / 60), wakeMin % 60],
      sleepMin,
      awakeMin,
      intoBedMin: 15,
      source: i === 0 || r >= 0.16 ? 'stages' : r < 0.08 ? 'span' : 'total',
      hr: () => Math.round(rest + Math.abs(normal(rand, 0, 4))),
    });
  }

  // ---- Journées : FC de jour, pas, séances, efforts soutenus ----
  const z = hrZones(age, 56);
  const hrIn = (lo, hi) => Math.round(lo + rand() * (hi - lo));
  const effort = (t0, minutes, hrAt) => {
    for (let m = 0; m < minutes; m++) fx.minute(t0 + m * MIN, hrAt(m), m % 2 ? 0 : 160);
  };
  let vo2 = 43.5;
  for (let i = span; i >= 1; i--) {
    const key = addDays(today, -i);
    const recent = key >= recentFrom;
    const wd = weekday(key);
    if (name === 'complet' && rand() < 0.02) continue;          // bracelet non porté de la journée
    const partial = name === 'complet' && rand() < 0.04;        // journée trop peu portée : non valide
    const [h0, h1] = partial ? [9, 13] : [7, 23];
    for (let t = cal.at(key, h0, 15); t < cal.at(key, h1); t += 15 * MIN) fx.minute(t, hrIn(66, 80), 0);
    fx.minute(cal.at(key, 12, 7), hrIn(70, 85), Math.round(bound(normal(rand, recent ? 7900 : 7400, 1300), 2500, 16000)));
    fx.summary(cal.at(key, 22), Math.round(restOf(key) + 2));
    if (name === 'nouveau' && i > 7) continue;
    vo2 += 0.012;
    // Course (mardi, samedi) : échauffement, zones 2-3, fin en zone 4-5 ; VO2 du bracelet dans environ 1 course sur 3.
    if ((wd === 2 || wd === 6) && rand() < 0.85) {
      const start = cal.at(key, 7, 40);
      const minutes = 30 + Math.floor(rand() * 16);
      effort(start, minutes, m => (m < 5 ? hrIn(105, 118) : m >= minutes - 6 ? hrIn(z.high + 2, z.high + 9) : hrIn(z.low + 10, z.high - 6)));
      const v = rand() < 0.35 ? Math.round(vo2 + normal(rand, 0, 0.6)) : 0;
      fx.workout({ start, end: start + minutes * MIN, kind: OUTDOOR_RUNNING, raw: summaryBlob({ start, vo2: v, hr: [144, Math.round(z.high + 9), 104] }) });
    }
    // Musculation (lundi) : FC surtout sous la zone 1, quelques séries au-dessus.
    if (wd === 1 && rand() < (recent ? 0.95 : 0.8)) {
      const start = cal.at(key, 18, 30);
      const minutes = 40 + Math.floor(rand() * 16);
      effort(start, minutes, m => (m % 6 < 2 ? hrIn(z.low + 1, z.low + 12) : hrIn(92, 112)));
      fx.workout({ start, end: start + minutes * MIN, kind: WEIGHTLIFTING, raw: summaryBlob({ start, subtype: 0x08, version: 8 }) });
    }
    // HIIT (jeudi, une semaine sur deux environ) : renforcement et zones 4-5.
    if (wd === 4 && rand() < 0.5) {
      const start = cal.at(key, 19);
      effort(start, 20, m => (m % 4 < 2 ? hrIn(z.high + 1, z.high + 10) : hrIn(z.low + 5, z.high - 3)));
      fx.workout({ start, end: start + 20 * MIN, kind: HIIT, raw: summaryBlob({ start, subtype: 0x10, version: 5 }) });
    }
    // Yoga (dimanche, une fois sur deux) : renforcement, FC sous les zones.
    if (wd === 0 && rand() < 0.5) {
      const start = cal.at(key, 10);
      effort(start, 45, () => hrIn(74, 92));
      fx.workout({ start, end: start + 45 * MIN, kind: YOGA, raw: summaryBlob({ start, subtype: 0x08, version: 8 }) });
    }
    // Marche rapide (mercredi), sans séance enregistrée : épisode soutenu, compté.
    if (wd === 3 && rand() < 0.85) effort(cal.at(key, 12, 20), 25 + Math.floor(rand() * 11), () => hrIn(z.low + 3, z.low + 12));
    // Escaliers : effort de moins de 15 min hors séance, non compté.
    if (rand() < 0.3) effort(cal.at(key, 16, 5), 6 + Math.floor(rand() * 5), () => hrIn(z.low + 4, z.low + 14));
  }

  // ---- Jour en cours : une FC par quart d'heure jusqu'à maintenant ----
  for (let t = cal.at(today, 7, 45); t < now - 5 * MIN; t += 15 * MIN) fx.minute(t, 66, 0);
  fx.minute(now - 5 * MIN, 68, 120);
  return fx.done();
}
