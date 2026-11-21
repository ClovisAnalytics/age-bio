// Âge bio — interface (point d'entrée du module) : écrans, navigation par hash, composants SVG dessinés ici,
// animations sobres. Les données viennent de calc.js (lecture de l'export, Diagnostic, profil, calcul) :
// ce fichier met en forme, il ne calcule rien de santé. L'export n'est jamais conservé. Seules les prises de sang
// saisies sont gardées, dans la mémoire de l'app sur ce téléphone (localStorage, jamais envoyées ; démo : en mémoire).
// Le profil et les prises de sang ne quittent pas l'écran et n'entrent jamais dans le Diagnostic.

import {
  APP_VERSION, makeClock, openExport, readExport, diagnose, calcDiagnostic, describeProfile, UserError,
} from './calc.js';
import * as calc from './calc.js';

// ================= Contexte et état =================

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const clock = makeClock(TZ);
const query = new URLSearchParams(location.search);
const DEMO = query.has('demo') ? (query.get('demo') || 'complet') : null;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const calm = () => motion.matches;
const IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'];
const STALE_MS = 26 * 3600000;   // export « ancien » au-delà de 26 h (comme en v1)

window.__uiErrors = 0;            // compteur d'erreurs JS, lu par la vérification automatique

const state = {
  data: null,          // sortie de readExport
  diagText: '',        // Diagnostic complet (structure + calcul) : jamais de profil ni de valeur de santé
  diagProfile: null,   // profil lu par le Diagnostic (affiché dans « Plus » seulement)
  loadedAt: 0,         // instant du chargement de l'export
  week: null,          // index du dimanche affiché sur Âge bio (null : valeur officielle)
  open: new Set(),     // lignes d'indicateur dépliées
  busy: false,
  reveal: false,       // animation d'arrivée (compteur, jauge) à jouer au prochain rendu d'Âge bio
};

// ================= Formats fr-FR =================

const MINUS = '−';
const NBSP = ' ';
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfx = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const finite = x => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round1 = x => Math.round(x * 10) / 10 || 0;            // || 0 : jamais « −0 »
const int = x => nf0.format(Math.round(x));
const dec1 = x => nf1.format(Math.abs(round1(x)));
const num1 = x => `${round1(x) < 0 ? MINUS : ''}${dec1(x)}`;   // « −1,2 », « 0,0 »
const signed1 = x => `${round1(x) > 0 ? '+' : round1(x) < 0 ? MINUS : ''}${dec1(x)}`;
const yearWord = x => (Math.abs(round1(x)) >= 2 ? 'ans' : 'an');
const fmtAge = x => (x < 18 ? '<18' : nf1.format(round1(x)));
const fmtPace = x => `${num1(x)}x`;
const hm = min => {
  const t = Math.max(0, Math.round(min));
  return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')}`;
};
const pct = x => `${int(x)}${NBSP}%`;
const plural = (n, one, many = `${one}s`) => `${int(n)} ${Math.abs(n) >= 2 ? many : one}`;
// Fiabilité (score de 0 à 1) en pourcentage entier, au moins 1 % dès qu'un indicateur est mesuré.
const relPct = score => Math.max(1, Math.round(score * 100));
const relText = score => (finite(score) ? `${relPct(score)}${NBSP}%` : '—');

// Dates « AAAA-MM-JJ » (jours civils) : calcul UTC, sans fuseau.
const utc = key => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const addDays = (key, n) => new Date(utc(key) + n * 86400000).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
const weekday = key => new Date(utc(key)).getUTCDay();
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });
const longFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: TZ });
const month = key => monthFmt.format(utc(key));
const dayNum = key => {
  const d = Number(key.slice(8));
  return d === 1 ? '1er' : String(d);
};
const dayMonth = key => `${dayNum(key)} ${month(key)}`;
const longDay = key => longFmt.format(utc(key)).replace(/^(\S+) 1 /, '$1 1er ');
// « 9 – 15 nov. », « 26 oct. – 1er nov. »
function weekLabel(sunday) {
  const from = addDays(sunday, -6);
  return from.slice(0, 7) === sunday.slice(0, 7) ? `${dayNum(from)} – ${dayMonth(sunday)}` : `${dayMonth(from)} – ${dayMonth(sunday)}`;
}
// « nuit du 14 au 15 nov. »
function nightLabel(key) {
  const eve = addDays(key, -1);
  return `nuit du ${eve.slice(0, 7) === key.slice(0, 7) ? dayNum(eve) : dayMonth(eve)} au ${dayMonth(key)}`;
}
function agoText(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `il y a ${h} h` : `il y a ${Math.floor(h / 24)} j`;
}

// ================= DOM =================

const $ = id => document.getElementById(id);
function add(node, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false || k === '') continue;
    node.append(k instanceof Node ? k : String(k));
  }
  return node;
}
function setAttrs(node, props) {
  if (!props) return node;
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'on') for (const [type, fn] of Object.entries(v)) node.addEventListener(type, fn);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  return node;
}
const h = (tag, props, ...kids) => add(setAttrs(document.createElement(tag), props), kids);
// Remplace le contenu d'un nœud avec les règles de h() : null, undefined, false et '' ignorés (replaceChildren écrirait « null »).
const fill = (node, ...kids) => {
  node.replaceChildren();
  return add(node, kids);
};
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, props, ...kids) => add(setAttrs(document.createElementNS(NS, tag), props), kids);
const vars = (node, values) => {
  for (const [k, v] of Object.entries(values)) node.style.setProperty(`--${k}`, String(v));
  return node;
};
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Icônes : traits 24 × 24 dessinés pour l'app (aucune icône de marque).
const ICON = {
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  down: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  arrow: 'M4 12h15M13 6l6 6-6 6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5.5M12 7.7v.1',
  today: 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8.5 3.5v4M15.5 3.5v4M8 13.5h3v3H8z',
  orb: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 6.4v.1M16.7 8.7v.1M17.4 13.6v.1M13.7 17.4v.1M8.5 16.5v.1M6.6 11.4v.1M9 7.4v.1M12 11.9v.1',
  more: 'M4 7h16M4 12h16M4 17h16',
  sync: 'M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1M17.5 3v4h-4M6.5 21v-4h4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  lock: 'M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5M5.5 10.5h13v10h-13z',
  copy: 'M9 9h10.5v11.5H9zM5 15.5V4h11',
  moon: 'M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v5.5h14V14',
  play: 'M8 5.5v13l10.5-6.5z',
  trend: 'M3.5 16.5 9 11l4 4 7.5-7.5M15 7.5h5.5V13',
  spark: 'M12 4v4M12 16v4M4 12h4M16 12h4M6.6 6.6l2.2 2.2M15.2 15.2l2.2 2.2M6.6 17.4l2.2-2.2M15.2 8.8l2.2-2.2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0',
  heart: 'M12 20s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.4-7.5 10-7.5 10z',
  drop: 'M12 3.5c3.2 4.2 6 7.4 6 10.6a6 6 0 0 1-12 0c0-3.2 2.8-6.4 6-10.6z',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 14v5.5h14V14',
  bolt: 'M13 3 5.5 13.5H12L11 21l7.5-10.5H12z',
  dumbbell: 'M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11',
  steps: 'M8.6 3.5c1.7 0 2.7 1.9 2.7 4.4 0 2.2-.9 3.6-2.4 3.6S6.2 10 6.2 7.9c0-2.5.7-4.4 2.4-4.4zM6.6 14h4.4l-.4 2.3a2.2 2.2 0 0 1-4.3-.1zM15.5 8.5c1.7 0 2.3 1.9 2.3 4.4 0 2.1-1.1 3.6-2.6 3.6s-2.4-1.4-2.4-3.6c0-2.5 1-4.4 2.7-4.4zM13 19h4.4l-.2 1.3a2.2 2.2 0 0 1-4.3.1z',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17v.1',
};
function icon(name, cls = '') {
  return s('svg', { class: `icon icon-${name} ${cls}`.trim(), viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    s('path', { d: ICON[name] }));
}
// Repères « Lent » (cercle ouvert) et « Rapide » (disque plein et traits de vitesse).
const slowMark = () => s('svg', { class: 'pace-mark', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('circle', { cx: 12, cy: 12, r: 8 }));
const fastMark = () => s('svg', { class: 'pace-mark is-fast', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
  s('circle', { cx: 15, cy: 12, r: 7 }), s('path', { d: 'M1.5 8.5h4.5M0.5 12h4M1.5 15.5h4.5' }));

// ================= Indicateurs =================

const GROUPS = [
  { key: 'sleep', title: 'Sommeil', ids: ['M2', 'M1'] },
  { key: 'activity', title: 'Activité', ids: ['M3', 'M4', 'M5', 'M6'] },
  { key: 'fitness', title: 'Forme', ids: ['M7', 'M8'] },
];
const durParts = v => (Math.round(v) < 60 ? [int(v), 'min'] : [hm(v), '']);
// short : nom dans la liste « À venir » (une ligne par élément, même sur téléphone).
const IND = {
  M1: {
    name: 'Durée du sommeil', short: 'durée du sommeil', group: 'sleep', icon: 'moon', range: [4, 10], ends: ['4 h', '10 h'],
    fmt: v => [hm(v * 60), ''], x: x => `${nfx.format(x)} h`, src: 'Yin 2017',
    what: 'Moyenne de la durée de tes nuits valides (au moins 3 h), du coucher au lever.',
  },
  M2: {
    name: 'Régularité du sommeil', short: 'régularité du sommeil', group: 'sleep', icon: 'clock', range: [40, 100], ends: ['40 %', '100 %'],
    fmt: v => [int(v), '%'], x: x => `${nfx.format(x)} %`, src: 'Windred 2024',
    what: "Chaque nuit, écart de tes heures de coucher et de lever avec les 4 nuits précédentes, les plus récentes pesant plus : aucun écart vaut 100 %, 2 h d'écart moyen valent 0 %.",
  },
  M3: {
    name: 'Activité modérée (sem.)', short: 'activité', group: 'activity', icon: 'pulse', range: [0, 300], ends: ['0', '5 h'],
    fmt: durParts, x: x => `${nfx.format(x)} min`, src: 'Arem 2015 ; OMS 2020',
    what: "Minutes par semaine en zones cardiaques 1 à 3 (50 à 80 % de ta réserve cardiaque), pendant une activité : séance enregistrée ou au moins 15 minutes d'affilée.",
  },
  M4: {
    name: 'Activité vigoureuse (sem.)', short: 'activité', group: 'activity', icon: 'bolt', range: [0, 75], ends: ['0', '1 h 15'],
    fmt: durParts, x: x => `${nfx.format(x)} min`, src: 'Wang 2021',
    what: 'Minutes par semaine en zones cardiaques 4 et 5 (au-delà de 80 % de ta réserve cardiaque), pendant une activité.',
  },
  M5: {
    name: 'Renforcement (sem.)', short: 'renforcement', group: 'activity', icon: 'dumbbell', range: [0, 150], ends: ['0', '2 h 30'],
    fmt: durParts, x: x => `${nfx.format(x)} min`, src: 'Momma 2022',
    what: 'Durée par semaine de tes séances de renforcement, yoga, pilates, HIIT et cross training enregistrées sur le bracelet.',
  },
  M6: {
    name: 'Pas (par jour)', short: 'pas', group: 'activity', icon: 'steps', range: [0, 16000], ends: ['0', '16 k'],
    fmt: v => [int(v), 'pas'], x: x => `${nf0.format(x)} pas`, src: 'Paluch 2022',
    what: 'Moyenne de tes pas par jour valide.',
  },
  M7: {
    name: 'VO2 max', short: 'VO2 max', group: 'fitness', icon: 'heart', range: [15, 70], ends: ['15', '70'],
    fmt: v => [nf1.format(round1(v)), 'ml/kg/min'], x: x => `${nfx.format(x)} ml/kg/min`, src: 'Kodama 2009 ; Jurca 2005',
    what: "Consommation maximale d'oxygène, calculée par le bracelet après une course d'au moins 10 min en extérieur : moyenne de ses mesures.",
  },
  M8: {
    name: 'FC de repos', short: 'FC de repos', group: 'fitness', icon: 'heart', range: [40, 90], ends: ['40 bpm', '90 bpm'],
    fmt: v => [int(v), 'bpm'], x: x => `${nfx.format(x)} bpm`, src: 'Zhang 2016',
    what: 'Ta fréquence cardiaque au repos pendant la nuit : moyenne de la moitié la plus basse des mesures de chaque nuit.',
  },
};
const valText = (id, v) => IND[id].fmt(v).filter(Boolean).join(NBSP);
const GROUP_NAME = { sleep: 'Sommeil', activity: 'Activité', fitness: 'Forme', blood: 'Prise de sang' };

// Marqueurs sanguins comptés (CONFIG.BLOOD de calc.js), décrits comme les indicateurs pour réutiliser barViz.
// BLOOD_VIEW : axe de la barre, dans l'unité du modèle, affichage seulement.
const BLOOD_VIEW = { vgm: [75, 105], idr: [11, 16], leucocytes: [3, 12], lymphocytes: [10, 50], glycemie: [3.5, 8], creatinine: [40, 130], albumine: [30, 55], pal: [30, 160], crp: [0, 10] };
// Unités : celle que tu choisis pour chaque analyse (celle de ton compte rendu, mémorisée avec les prises de sang) sert
// à la saisie et à l'affichage ; les valeurs restent gardées dans l'unité du modèle. Un nombre de lymphocytes (G/L,
// /mm³) se saisit, mais s'affiche en % : c'est le % qui compte, et un nombre dépend des leucocytes de chaque bilan.
const labNfs = new Map();
const labNf = dp => {
  if (!labNfs.has(dp)) labNfs.set(dp, new Intl.NumberFormat('fr-FR', { maximumFractionDigits: dp }));
  return labNfs.get(dp);
};
const unitInfo = (id, u) => calc.bloodMarker(id)?.units.find(x => x.u === u) ?? null;
const entryUnit = id => (unitInfo(id, blood.units[id]) ? blood.units[id] : calc.refUnit(id));
const labUnit = id => (unitInfo(id, entryUnit(id)).abs !== undefined ? calc.refUnit(id) : entryUnit(id));
// Nombre dans l'unité u, avec ses décimales : « 6 800 », « 0,97 ».
const labNum = (id, v, u) => labNf(unitInfo(id, u)?.dp ?? 2).format(v);
// Valeur gardée (unité du modèle ; nombre, ou texte « <4 ») → texte dans l'unité u : « 6 800 », « < 0,5 ».
// ctx.leucocytes : lymphocytes en nombre. '' si la conversion est impossible.
function labIn(id, raw, u = labUnit(id), ctx = {}) {
  const p = calc.parseLab(raw);
  const v = p ? calc.labFromRef(id, p.v, u, ctx) : null;
  return v === null ? '' : `${p.q ? `${p.q}${NBSP}` : ''}${labNum(id, v, u)}`;
}
// Nom dans une phrase : « glycémie à jeun », sigles inchangés (« IDR »).
const inSentence = name => (/^[A-Z0-9]+$/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1));
for (const b of calc.CONFIG.BLOOD) {
  const [lo, hi] = BLOOD_VIEW[b.id] ?? [0, 100];
  IND[b.id] = {
    name: b.label, short: inSentence(b.label), group: 'blood', icon: 'drop', range: [lo, hi], src: 'Levine 2018 ; Liu 2018',
    get ends() { return [labIn(b.id, lo), labIn(b.id, hi)]; },
    get unit() { return labUnit(b.id); },
    fmt: v => [labIn(b.id, v), labUnit(b.id)], x: v => `${labIn(b.id, v)}${NBSP}${labUnit(b.id)}`,
  };
}
// Poids (Pareto) : % entiers de somme 100 (plus forts restes), cumul, rang ; du plus au moins influent.
const BLOOD_PARETO = (() => {
  const w = [...calc.bloodWeights()];
  const raw = w.map(([, x]) => x * 100);
  const pcts = raw.map(Math.floor);
  const left = 100 - pcts.reduce((a, x) => a + x, 0);
  raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).slice(0, left).forEach(([, i]) => { pcts[i] += 1; });
  let cum = 0;
  return new Map(w.map(([id], i) => [id, { rank: i + 1, pct: pcts[i], cum: (cum += pcts[i]) }]));
})();
const BLOOD_ORDER = [...BLOOD_PARETO.keys()];
const weightText = id => `${BLOOD_PARETO.get(id)?.pct ?? 0}${NBSP}%`;
// « 12 mars 2026 »
const dayMonthYear = key => `${dayMonth(key)} ${key.slice(0, 4)}`;

// ================= Pont vers le moteur =================

const profileGender = () => state.data?.profile?.gender ?? null;
const ctxAt = age => ({ age, gender: profileGender() });
function scaleOf(id, ctx) {
  try {
    const sc = calc.scaleFor(id, ctx);
    return Array.isArray(sc) && sc.length ? sc : null;
  } catch {
    return null;
  }
}
function targetOf(id, ctx) {
  try {
    const t = calc.targetFor(id, ctx);
    return finite(t) ? t : null;
  } catch {
    return null;
  }
}
function paceStateOf(x) {
  return finite(x) ? calc.paceState(x) : null;
}
function ageStateOf(gap) {
  return finite(gap) ? calc.ageState(gap) : 'ontrack';
}
// Barème : interpolation linéaire, constant au-delà (même règle que calc.js).
function interp(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}
const statusOf = (present, d) => (!present ? 'absent' : d <= -0.05 ? 'good' : d >= 0.05 ? 'bad' : 'neutral');
const impactCls = d => (round1(d) > 0 ? 'is-bad' : round1(d) < 0 ? 'is-good' : 'is-zero');

// ================= Prises de sang : mémoire de l'app, sur ce téléphone =================

// Stockage local du navigateur (origine du site) : seules les prises de sang y sont gardées, avec l'unité choisie pour
// chaque analyse ; jamais envoyées. Démo : prises de sang fictives, en mémoire seulement (le stockage n'est ni lu ni écrit).
const BLOOD_KEY = 'agebio.prises-de-sang';
const blood = { list: [], units: {}, demo: false };
// Unités lues (mémoire, sauvegarde) : analyses et unités connues seulement.
const cleanUnits = o => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {})
  .filter(([id, u]) => typeof u === 'string' && unitInfo(id, u)));
function bloodLoad() {
  if (DEMO !== null) {
    blood.demo = true;
    blood.list = calc.demoBilans(clock.dayKey(Date.now()), DEMO);
    return;
  }
  try {
    const raw = localStorage.getItem(BLOOD_KEY);
    const data = raw ? JSON.parse(raw) : null;
    blood.list = calc.cleanBilans(data?.bilans);
    blood.units = cleanUnits(data?.unites);
  } catch {
    blood.list = [];
    blood.units = {};
  }
}
function bloodSave() {
  if (blood.demo) return true;
  try {
    localStorage.setItem(BLOOD_KEY, JSON.stringify({ v: 1, bilans: blood.list, unites: blood.units }));
    navigator.storage?.persist?.().catch(() => {});   // demande au navigateur de ne pas l'effacer de lui-même
    return true;
  } catch {
    return false;
  }
}
// Après une saisie : âge bio recalculé avec les prises de sang, écrans principaux à jour.
function bloodChanged() {
  if (!state.data) return;
  state.data.calc = { ...state.data.calc, bilans: blood.list };
  state.data.result = calc.analyze(state.data.base, state.data.calc);
  renderToday();
  renderAge();
  renderPlus();
  renderMethod();
}

// ================= Vocabulaire =================

function gapPhrase(gap) {
  const r = round1(gap);
  if (r === 0) return 'Pile ton âge civil';
  const g = profileGender();
  const word = r < 0 ? (g === 0 || g === 1 ? 'plus jeune' : 'de moins') : g === 0 ? 'plus vieille' : g === 1 ? 'plus vieux' : 'de plus';
  return `${dec1(r)} ${yearWord(r)} ${word}`;
}
const PACE_WORD = { reversing: 'âge bio en baisse', slowing: 'lent', steady: 'au rythme du temps', accelerated: 'rapide' };
function paceTitle(v) {
  const r = round1(v);
  return r < 0 ? 'Tu rajeunis' : r < 1 ? 'Sur la bonne voie' : r < 2 ? 'Au rythme du temps' : "Ça s'accélère";
}
function paceSentence(v) {
  const r = round1(v);
  if (r < 0) return "À ce rythme, ton âge bio baisse : tes 30 derniers jours font nettement mieux que tes 6 mois.";
  if (r < 1) return 'Ton rythme est lent : tu vieillis moins vite que le temps.';
  if (r === 1) return 'Ton rythme suit le temps : tes 30 derniers jours valent tes 6 derniers mois.';
  if (r < 2) return 'Ton rythme dépasse le temps : tes 30 derniers jours font moins bien que tes 6 mois.';
  return "Ton rythme s'emballe : tes 30 derniers jours font nettement moins bien que tes 6 mois.";
}
function changeSentence(m) {
  if (!m.prev || !finite(m.prev.bio)) return m.official ? 'Premier calcul de ton âge bio.' : 'Premier dimanche calculé.';
  const d = round1(m.bio - m.prev.bio);
  const when = m.official ? 'cette semaine' : 'cette semaine-là';
  if (d === 0) return `Ton âge bio n'a pas bougé ${when}.`;
  return `Ton âge bio a ${d < 0 ? 'baissé' : 'augmenté'} de ${dec1(d)} ${yearWord(d)} ${when}.`;
}
function verdict(ind) {
  if (!ind.present) return null;
  if (!finite(ind.delta30) || !finite(ind.value30)) {
    return { title: 'Moyenne sur 6 mois', text: 'Pas de comparaison sur 30 jours pour l\'instant.' };
  }
  const diff = ind.delta30 - ind.delta;
  if (diff <= -0.25) return { title: 'Gros progrès', text: 'Tes 30 derniers jours font nettement mieux que ta moyenne sur 6 mois : continue, ton âge bio baissera avec le temps.' };
  if (diff <= -0.05) return { title: 'En progrès', text: 'Tes 30 derniers jours font mieux que ta moyenne sur 6 mois.' };
  if (diff < 0.05) return { title: 'Stable', text: 'Tes 30 derniers jours ressemblent à ta moyenne sur 6 mois.' };
  if (diff < 0.25) return { title: 'En recul', text: 'Tes 30 derniers jours font un peu moins bien que ta moyenne sur 6 mois.' };
  return { title: 'À travailler', text: 'Tes 30 derniers jours font nettement moins bien que ta moyenne sur 6 mois : ton âge bio risque de monter.' };
}
// Valeur provisoire : moyenne de peu de mesures, sans comparaison sur 30 jours.
const POINT_WORD = { M1: 'nuit', M2: 'nuit', M8: 'nuit', M3: 'jour', M4: 'jour', M5: 'jour', M6: 'jour' };
function provisionalVerdict(ind) {
  if (!ind.present) return null;
  return { title: 'Valeur provisoire', text: `Moyenne de ${plural(ind.points ?? 0, POINT_WORD[ind.id] ?? 'mesure')}.` };
}
// Indicateur absent : « Disponible dans 4 jours valides. » ou la raison (« Après une course d'au moins 10 min… »).
function absentText(ind) {
  if (!ind.reason) return 'Pas assez de mesures.';
  return ind.wait ? `Disponible ${ind.reason}.` : `${capital(ind.reason)}.`;
}
const capital = t => t.charAt(0).toUpperCase() + t.slice(1);
const LEVER_LABEL = {
  M1: '+30 min de sommeil par nuit', M2: '+10 points de régularité', M3: "+30 min d'activité modérée par semaine",
  M4: "+10 min d'activité vigoureuse par semaine", M5: '+20 min de renforcement par semaine', M6: '+1 000 pas par jour',
};

// ================= Modèle de l'écran Âge bio =================

function officialIndex(r) {
  const curve = r.curve ?? [];
  const i = r.official ? curve.findIndex(p => p.key === r.official.key) : -1;
  return i >= 0 ? i : curve.length - 1;
}
function pointIndicators(pt, off) {
  return IDS.map(id => {
    const ref = off?.indicators?.find(x => x.id === id) ?? {};
    const v = pt.values?.[id];
    const d = pt.deltas?.[id];
    const present = finite(v) && ref.present !== false;
    return {
      id, group: IND[id].group, present, estimated: Boolean(ref.estimated) && !ref.present, reason: ref.reason, wait: ref.wait,
      value6m: finite(v) ? v : null, value30: null, delta: finite(d) ? d : 0, delta30: null,
      target: null, status: statusOf(present, finite(d) ? d : 0),
    };
  });
}
// Libellé de la moyenne affichée : « Moy. 6 mois » (fenêtre de 182 jours), « Moyenne » pour une valeur provisoire
// de moins de 30 jours de données ; [court, long].
const capOf = m => (m.provisional && !m.recent ? ['Moyenne', 'moyenne'] : ['Moy. 6 mois', 'moyenne 6 mois']);
function ageModel() {
  const r = state.data.result;
  if (!r.lastKey) return { kind: 'nodata' };
  if (!finite(r.civil)) return { kind: 'profile' };
  const off = r.official ?? null;
  if (!off) {
    // Pas encore de valeur officielle : valeur provisoire du jour (dès une nuit ou un jour valide), sinon attente.
    const p = r.provisional ?? null;
    if (!p || !finite(p.bio)) return { kind: 'waiting' };
    return {
      kind: 'value', provisional: true, official: false, recent: Boolean(p.pace), off: null, curve: [], idx: 0, offIdx: 0, prev: null,
      key: p.key, bio: p.bio, gap: p.gap, civil: p.civil, pace: p.pace?.value ?? null, prevPace: null,
      calibrating: true, indicators: p.indicators ?? [], reliability: p.reliability ?? null, blood: p.blood ?? null,
      ageState: ageStateOf(p.gap), paceState: paceStateOf(p.pace?.value), paused: false,
    };
  }
  const curve = Array.isArray(r.curve) ? r.curve : [];
  const offIdx = officialIndex(r);
  const idx = state.week !== null && state.week >= 0 && state.week < curve.length ? state.week : offIdx;
  const pt = curve[idx];
  const isOff = !pt || idx === offIdx;
  const prev = idx > 0 ? curve[idx - 1] : null;
  const base = isOff
    ? {
      key: off.key, bio: off.bio, gap: off.gap, civil: off.civil, pace: off.pace?.value,
      prevPace: finite(off.pace?.prev) ? off.pace.prev : finite(prev?.pace) ? prev.pace : null,
      calibrating: Boolean(off.calibrating), indicators: off.indicators ?? [], reliability: off.reliability ?? null,
      blood: off.blood ?? null,
    }
    : {
      key: pt.key, bio: pt.bio, gap: finite(pt.gap) ? pt.gap : pt.bio - pt.civil, civil: pt.civil, pace: pt.pace,
      prevPace: finite(prev?.pace) ? prev.pace : null, calibrating: Boolean(pt.calibrating), indicators: pointIndicators(pt, off),
      reliability: finite(pt.reliability) ? { score: pt.reliability } : null, blood: pt.blood ?? null,
    };
  return {
    kind: 'value', official: isOff, off, curve, idx, offIdx, prev, ...base,
    ageState: ageStateOf(base.gap), paceState: paceStateOf(base.pace),
    paused: isOff && Boolean(off.paused),
  };
}

// ================= Composants =================

function topbar({ title, sub = '', back = false, right = null, subId = null }) {
  return h('header', { class: 'topbar' },
    back ? h('button', { class: 'icon-btn', type: 'button', 'data-back': true, 'aria-label': 'Retour' }, icon('back')) : h('span', { class: 'topbar-slot' }),
    h('div', { class: 'topbar-center' },
      h('h1', { class: 'topbar-title', tabindex: '-1' }, title),
      sub ? h('p', { class: 'topbar-sub', id: subId }, sub) : null),
    right ?? h('span', { class: 'topbar-slot' }));
}
const infoBtn = (sheet, label) => h('button', { class: 'icon-btn', type: 'button', 'data-sheet': sheet, 'aria-label': label }, icon('info'));
const chip = (text, cls = '') => h('span', { class: `chip ${cls}`.trim() }, text);
// legend : true = moyennes 6 mois et 30 jours ; 'avg' = une seule moyenne (valeur provisoire récente).
const secHead = (title, id, legend = false, extra = null) => h('div', { class: 'sec-head' },
  h('h2', { class: 'sec-title', id }, title),
  legend === 'avg' ? h('p', { class: 'legend', 'aria-hidden': 'true' }, h('span', { class: 'tri tri-down' }), 'Moyenne')
    : legend ? h('p', { class: 'legend', 'aria-hidden': 'true' },
      h('span', { class: 'tri tri-down' }), 'Moy. 6 mois', h('span', { class: 'legend-sep' }), h('span', { class: 'tri tri-up' }), 'Moy. 30 j') : null,
  extra);
const linkCta = (text, href, attrs = {}) => h('a', { class: 'link-cta', href, ...attrs }, h('span', null, text), icon('arrow'));
const note = (text, cls = '') => h('p', { class: `note ${cls}`.trim() }, text);

// Visuellement caché, lu par les lecteurs d'écran : tableau équivalent à un graphique.
function srTable(caption, head, rows) {
  return h('table', { class: 'visually-hidden' }, h('caption', null, caption),
    h('thead', null, h('tr', null, head.map(t => h('th', { scope: 'col' }, t)))),
    h('tbody', null, rows.map(r => h('tr', null, r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : h('td', null, c)))))));
}

// Anneau (cadran) : départ à 12 h, sens horaire, remplissage animé 0 → v.
function ring(size, stroke, frac, cls = '') {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = s('circle', { class: 'ring-arc', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, 'stroke-dasharray': `${c.toFixed(2)} ${c.toFixed(2)}`, transform: `rotate(-90 ${size / 2} ${size / 2})` });
  const svg = s('svg', { class: `ring ${cls}`.trim(), viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true', focusable: 'false' },
    s('circle', { class: 'ring-track', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke }), arc);
  const f = finite(frac) ? clamp(frac, 0, 1) : 0;
  if (f <= 0.001) arc.style.display = 'none';
  const target = c * (1 - f);
  if (calm()) arc.style.strokeDashoffset = String(target);
  else {
    arc.style.strokeDashoffset = String(c);
    nextFrame().then(() => { arc.style.strokeDashoffset = String(target); });
  }
  return svg;
}

// Générateur reproductible (mulberry32) : particules et contour de l'orbe toujours identiques.
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
// Contour organique : n points légèrement décalés, lissés en courbes de Bézier (Catmull-Rom fermée).
function blobPath(cx, cy, R, n, rand, wobble) {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI + (rand() - 0.5) * 0.18;
    const r = R * (1 + (rand() * 2 - 1) * wobble);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  const p = i => pts[(i + n) % n];
  const f = v => v.toFixed(1);
  let d = `M${f(p(0)[0])} ${f(p(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}
let uid = 0;
// Orbe : cœur sombre, bord teinté selon l'état, particules plus denses vers le bord, lente rotation.
function orbSvg({ dots = 120, seed = 20261115 } = {}) {
  const id = `o${++uid}`;
  const rand = rng(seed);
  const C = 150;
  const R = 138;
  const blob = blobPath(C, C, R, 9, rand, 0.03);
  const layer = (count, big) => {
    const g = s('g', { class: big ? 'orb-dots orb-dots-b' : 'orb-dots orb-dots-a' });
    for (let i = 0; i < count; i++) {
      const a = rand() * 2 * Math.PI;
      const u = rand();
      const d = R * (big ? 0.97 - 0.52 * u ** 1.4 : 0.985 - 0.56 * u ** 2.3);
      const r = big ? 1.8 + 2.6 * rand() : 0.6 + 1.7 * rand() ** 2;
      const near = clamp((d / R - 0.42) / 0.56, 0, 1);
      const op = big ? 0.12 + 0.3 * near : 0.25 + 0.75 * near;
      const dot = s('circle', { cx: (C + d * Math.cos(a)).toFixed(1), cy: (C + d * Math.sin(a)).toFixed(1), r: r.toFixed(2), opacity: op.toFixed(2) });
      if (!big && i % 9 === 0) {
        dot.setAttribute('class', 'tw');
        dot.style.animationDelay = `${(-rand() * 6).toFixed(2)}s`;
      }
      g.append(dot);
    }
    return g;
  };
  return s('svg', { class: 'orb-svg', viewBox: '0 0 300 300', 'aria-hidden': 'true', focusable: 'false' },
    s('defs', null,
      s('radialGradient', { id: `${id}c`, cx: '50%', cy: '47%', r: '53%' },
        s('stop', { offset: '0', class: 'oc0' }), s('stop', { offset: '0.55', class: 'oc1' }),
        s('stop', { offset: '0.84', class: 'oc2' }), s('stop', { offset: '1', class: 'oc3' })),
      s('linearGradient', { id: `${id}r`, x1: '0.2', y1: '0', x2: '0.6', y2: '1' },
        s('stop', { offset: '0', class: 'or0' }), s('stop', { offset: '1', class: 'or1' })),
      s('radialGradient', { id: `${id}g`, cx: '50%', cy: '50%', r: '50%' },
        s('stop', { offset: '0.78', class: 'og0' }), s('stop', { offset: '0.9', class: 'og1' }), s('stop', { offset: '1', class: 'og2' })),
      s('clipPath', { id: `${id}k` }, s('path', { d: blob }))),
    s('circle', { class: 'orb-glow', cx: C, cy: C, r: 150, fill: `url(#${id}g)` }),
    s('path', { class: 'orb-base', d: blob }),
    s('path', { class: 'orb-body', d: blob, fill: `url(#${id}c)` }),
    s('g', { 'clip-path': `url(#${id}k)` }, layer(Math.round(dots * 0.3), true), layer(dots, false)),
    s('path', { class: 'orb-rim', d: blob, fill: 'none', stroke: `url(#${id}r)` }));
}
function orbFigure(m, { size = 'lg', label = 'Âge bio', count = false } = {}) {
  const value = h('span', { class: 'orb-value num' }, fmtAge(m.bio));
  const fig = h('div', {
    class: `orb orb-${size} is-${m.ageState}${m.paused ? ' is-paused' : ''}`,
    role: 'img',
    'aria-label': `Âge bio${m.provisional ? ' provisoire' : ''} : ${fmtAge(m.bio)} ans, ${gapPhrase(m.gap).toLowerCase()}${finite(m.civil) ? ` (âge civil ${nf1.format(round1(m.civil))} ans)` : ''}`,
  },
  orbSvg({ dots: size === 'lg' ? 120 : 46, seed: size === 'lg' ? 20261115 : 7 }),
  h('span', { class: 'orb-center', 'aria-hidden': 'true' }, value,
    h('span', { class: 'orb-label' }, label),
    size === 'lg' ? h('span', { class: 'orb-gap' }, gapPhrase(m.gap)) : null));
  if (count && !calm() && finite(m.bio) && m.bio >= 18) countUp(value, m.bio);
  return fig;
}
// Compteur 0 → valeur en 800 ms (révélation après une synchro).
function countUp(node, target) {
  const t0 = performance.now();
  const step = now => {
    const k = clamp((now - t0) / 800, 0, 1);
    const e = 1 - (1 - k) ** 3;
    node.textContent = nf1.format(round1(target * e));
    if (k < 1) requestAnimationFrame(step);
  };
  node.textContent = nf1.format(0);
  requestAnimationFrame(step);
}

// Jauge du rythme −1x…3x : 81 traits (0,05x), majeurs aux entiers, repère blanc, traînée depuis la semaine précédente.
function gauge(m, { animate = false } = {}) {
  const v = clamp(m.pace, -1, 3);
  const frac = x => (clamp(x, -1, 3) + 1) / 4;
  const f = frac(v);
  const fp = finite(m.prevPace) ? frac(m.prevPace) : null;
  const ticks = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    let cls = i % 20 === 0 ? 'tick major' : 'tick';
    let k = null;
    if (fp !== null && Math.abs(fp - f) > 0.006) {
      const lo = Math.min(fp, f);
      const hi = Math.max(fp, f);
      if (t >= lo - 1e-9 && t <= hi + 1e-9) {
        cls += ' trail';
        k = 1 - Math.abs(t - f) / (hi - lo);
      }
    }
    const tick = h('i', { class: cls });
    if (k !== null) vars(tick, { k: k.toFixed(3) });
    ticks.push(tick);
  }
  const marker = h('i', { class: 'gauge-marker' });
  const value = h('span', { class: 'gauge-value num' }, fmtPace(m.pace));
  const track = h('div', { class: 'gauge-track' }, ticks, marker);
  const box = h('div', {
    class: 'gauge', role: 'meter', 'aria-labelledby': 'pace-title', 'aria-valuemin': '-1', 'aria-valuemax': '3',
    'aria-valuenow': String(round1(m.pace)), 'aria-valuetext': `${num1(m.pace)} fois : ${PACE_WORD[m.paceState] ?? ''}${fp !== null ? ` ; semaine précédente ${num1(m.prevPace)} fois` : ''}`,
  },
  h('div', { class: 'gauge-top', 'aria-hidden': 'true' },
    h('span', { class: 'gauge-end is-slow' }, slowMark(), 'Lent'), value,
    h('span', { class: 'gauge-end is-fast' }, 'Rapide', fastMark())),
  h('div', { 'aria-hidden': 'true' }, track),
  h('div', { class: 'gauge-axis', 'aria-hidden': 'true' }, h('span', null, `${MINUS}1,0x`), h('span', null, '1,0x'), h('span', null, '3,0x')));
  const from = animate && fp !== null ? fp : animate ? 0.5 : f;
  vars(marker, { f: from });
  vars(value, { f });
  if (from !== f) nextFrame().then(() => vars(marker, { f }));
  // « Lent » et « Rapide » s'effacent si la valeur les chevauche.
  nextFrame().then(() => {
    const vr = value.getBoundingClientRect();
    for (const end of box.querySelectorAll('.gauge-end')) {
      const er = end.getBoundingClientRect();
      end.classList.toggle('is-covered', vr.width > 0 && vr.left < er.right + 6 && vr.right > er.left - 6);
    }
  });
  return box;
}

// Barre segmentée d'un indicateur : 10 segments colorés par l'impact du barème (ambre = vieillit, vert = rajeunit).
function segClass(d) {
  const a = Math.abs(d);
  if (a < 0.05) return 'n';
  return `${d > 0 ? 'w' : 'g'}${a < 0.3 ? 1 : a < 0.7 ? 2 : a < 1.3 ? 3 : 4}`;
}
function barViz(ind, ctx, { open = false, cap = 'Moy. 6 mois' } = {}) {
  const meta = IND[ind.id];
  const [lo, hi] = meta.range;
  const pos = v => (finite(v) ? clamp((v - lo) / (hi - lo), 0, 1) : null);
  const scale = scaleOf(ind.id, ctx);
  const segs = Array.from({ length: 10 }, (_, i) => (scale ? segClass(interp(scale, lo + ((i + 0.5) * (hi - lo)) / 10)) : 'n'));
  const p6 = pos(ind.value6m);
  const p30 = ind.present ? pos(ind.value30) : null;
  const [main, unit] = ind.display ?? meta.fmt(ind.value6m);   // display : prise de sang telle que saisie (« < 4 »)
  const endCls = c => (c[0] === 'w' ? 'is-bad' : c[0] === 'g' ? 'is-good' : '');
  const half = (txt, u) => Math.ceil((txt.length * 9 + (u ? u.length * 6.5 + 4 : 0)) / 2) + 2;
  const viz = h('span', { class: `viz${open ? ' is-open' : ''}` },
    h('span', { class: 'viz-top' },
      h('span', { class: 'viz-cap' }, cap),
      h('span', { class: 'viz-val' }, h('b', { class: 'num' }, main), unit ? h('small', null, unit) : null),
      p6 !== null ? h('i', { class: `mk mk6${ind.present ? '' : ' is-hollow'}` }) : null),
    h('span', { class: 'viz-bar' }, segs.map(c => h('i', { class: `seg s-${c}` })),
      h('span', { class: 'viz-ends' }, h('span', { class: endCls(segs[0]) }, meta.ends[0]), h('span', { class: endCls(segs[9]) }, meta.ends[1]))),
    h('span', { class: 'viz-bot' },
      p30 !== null ? h('i', { class: 'mk mk30' }) : null,
      p30 !== null ? h('span', { class: 'viz-val30' }, h('b', { class: 'num' }, valText(ind.id, ind.value30)), h('small', null, 'Moy. 30 j')) : null));
  vars(viz, { p6: p6 ?? 0, p30: p30 ?? 0, h6: `${half(main, unit)}px`, h30: `${p30 !== null ? half(valText(ind.id, ind.value30), 'Moy. 30 j') : 0}px` });
  return viz;
}
function impactEl(ind) {
  if (!ind.present) {
    return h('span', { class: 'impact is-zero' }, h('b', { class: 'num' }, '—'), h('small', null, ind.estimated ? 'non compté' : ''));
  }
  return h('span', { class: `impact ${impactCls(ind.delta)}` }, h('b', { class: 'num' }, signed1(ind.delta)), h('small', null, yearWord(ind.delta)));
}
function rowLabel(ind, cap = 'moyenne 6 mois') {
  const name = IND[ind.id].name;
  if (!ind.present && !(ind.estimated && finite(ind.value6m))) return `${name} : ${absentText(ind)}`;
  const parts = [`${name} : ${cap} ${valText(ind.id, ind.value6m)}`];
  if (ind.present && finite(ind.value30)) parts.push(`moyenne 30 jours ${valText(ind.id, ind.value30)}`);
  parts.push(ind.present ? `impact ${signed1(ind.delta)} ${yearWord(ind.delta)} sur ton âge bio` : 'valeur estimée, non comptée dans ton âge bio');
  return parts.join(', ');
}
function indRow(ind, m) {
  const id = ind.id;
  const ctx = ctxAt(m.civil);
  const estimated = !ind.present && ind.estimated && finite(ind.value6m);
  const absent = !ind.present && !estimated;
  const open = state.open.has(id);
  const moreId = `more-${id}`;
  const [capShort, capLong] = capOf(m);
  const head = h('button', { class: 'ind-head', type: 'button', 'aria-expanded': String(open), 'aria-controls': moreId, 'aria-label': rowLabel(ind, capLong) },
    h('span', { class: 'ind-top', 'aria-hidden': 'true' },
      h('span', { class: 'ind-name' }, IND[id].name),
      absent ? chip(ind.wait ? 'Bientôt' : 'Non mesuré') : estimated ? chip('Estimée') : null,
      icon('down', 'ind-chev')),
    absent
      ? h('span', { class: 'ind-body', 'aria-hidden': 'true' }, h('span', { class: 'ind-reason' }, absentText(ind)), impactEl(ind))
      : h('span', { class: 'ind-body', 'aria-hidden': 'true' }, barViz(ind, ctx, { open, cap: capShort }), impactEl(ind)));
  const target = targetOf(id, ctx);
  const v = m.provisional ? (finite(ind.value30) ? verdict(ind) : provisionalVerdict(ind)) : m.official ? verdict(ind) : null;
  const more = h('div', { class: 'ind-more', id: moreId },
    h('div', { class: 'ind-more-in' },
      v ? h('h4', { class: 'ind-verdict' }, v.title) : null,
      h('p', { class: 'ind-text' }, v ? v.text : estimated ? capital(ind.reason ?? 'estimation sans effort, non comptée') + '.' : absent ? IND[id].what : `Moyenne des 6 mois qui finissent le ${dayMonth(m.key)}.`),
      finite(target) && !absent ? h('p', { class: 'ind-target' }, `Neutre pour ton profil : ${valText(id, target)}.`) : null,
      linkCta(m.provisional ? 'Voir le détail' : 'Voir la tendance', `#indicateur/${id}`)));
  more.inert = !open;
  const row = h('div', { class: `ind-row${open ? ' is-open' : ''}${absent ? ' is-absent' : ''}`, 'data-id': id }, head, more);
  head.addEventListener('click', () => {
    const now = !row.classList.contains('is-open');
    row.classList.toggle('is-open', now);
    row.querySelector('.viz')?.classList.toggle('is-open', now);
    head.setAttribute('aria-expanded', String(now));
    more.inert = !now;
    if (now) state.open.add(id);
    else state.open.delete(id);
  });
  return row;
}

// Graphique en ligne (SVG fait main) : grille, référence, série, dernier point en pastille.
function lineChart({ xs, ys, yLo, yHi, yTicks, yFmt, ref = null, refCls = 'ref', hollow = () => false, lastText, xLabels = [], label, w = 340, h: H = 188, series2 = null, cls = '' }) {
  const L = 40;
  const R = 14;
  const T = 14;
  const B = 26;
  const xMax = Math.max(1, ...xs);
  const X = x => L + (x / xMax) * (w - L - R);
  const Y = y => T + ((yHi - y) / (yHi - yLo)) * (H - T - B);
  const svg = s('svg', { class: `chart ${cls}`.trim(), viewBox: `0 0 ${w} ${H}`, role: 'img', 'aria-label': label, focusable: 'false' });
  for (const t of yTicks) {
    svg.append(s('line', { class: 'grid', x1: L, x2: w - R, y1: Y(t).toFixed(1), y2: Y(t).toFixed(1) }),
      s('text', { class: 'axis', x: L - 8, y: (Y(t) + 3.5).toFixed(1), 'text-anchor': 'end' }, yFmt(t)));
  }
  if (finite(ref)) svg.append(s('line', { class: refCls, x1: L, x2: w - R, y1: Y(ref).toFixed(1), y2: Y(ref).toFixed(1) }));
  const path = (vals, c) => {
    const pts = xs.map((x, i) => [x, vals[i]]).filter(([, y]) => finite(y));
    if (pts.length > 1) svg.append(s('path', { class: c, d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(clamp(y, yLo, yHi)).toFixed(1)}`).join('') }));
    return pts;
  };
  if (series2) path(series2, 'line2');
  const pts = path(ys, 'line');
  xs.forEach((x, i) => {
    if (!finite(ys[i]) || i === xs.length - 1) return;
    if (hollow(i)) svg.append(s('circle', { class: 'dot is-hollow', cx: X(x).toFixed(1), cy: Y(clamp(ys[i], yLo, yHi)).toFixed(1), r: 2.6 }));
  });
  if (pts.length) {
    const [lx, ly] = pts[pts.length - 1];
    const cx = X(lx);
    const cy = Y(clamp(ly, yLo, yHi));
    svg.append(s('circle', { class: 'dot is-last', cx: cx.toFixed(1), cy: cy.toFixed(1), r: 4 }));
    if (lastText) {
      const tw = lastText.length * 7 + 12;
      const bx = clamp(cx - tw / 2, L, w - R - tw);
      const by = cy - 30 < T ? cy + 10 : cy - 28;
      svg.append(s('rect', { class: 'pill', x: bx.toFixed(1), y: by.toFixed(1), width: tw, height: 19, rx: 5 }),
        s('text', { class: 'pill-text', x: (bx + tw / 2).toFixed(1), y: (by + 13.5).toFixed(1), 'text-anchor': 'middle' }, lastText));
    }
  }
  for (const { x, text } of xLabels) {
    const px = X(x);
    svg.append(s('text', { class: 'axis', x: px.toFixed(1), y: H - 6, 'text-anchor': px < L + 14 ? 'start' : px > w - R - 14 ? 'end' : 'middle' }, text));
  }
  return svg;
}
function monthLabels(firstKey, lastKey) {
  const out = [];
  let [y, mo] = firstKey.split('-').map(Number);
  for (let guard = 0; guard < 40; guard++) {
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
    const key = `${y}-${String(mo).padStart(2, '0')}-01`;
    if (key > lastKey) break;
    out.push({ x: dayDiff(firstKey, key), text: month(key).replace('.', '') });
  }
  return out.length > 6 ? out.filter((_, i) => i % 2 === 0) : out;
}
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= raw) ?? raw;
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = a; t <= b + step / 2; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { lo: a, hi: b, ticks };
}

// Graphiques de tendance (rythme, âge bio, indicateur) à partir de result.curve.
function paceChart(curve, { big = false } = {}) {
  const pts = curve.filter(p => finite(p.pace));
  if (pts.length < 2) return null;
  const first = pts[0].key;
  return lineChart({
    xs: pts.map(p => dayDiff(first, p.key)), ys: pts.map(p => p.pace), yLo: -1, yHi: 3, yTicks: [-1, 0, 1, 2, 3],
    yFmt: t => `${t < 0 ? MINUS : ''}${nf1.format(Math.abs(t))}x`, ref: 1, refCls: 'ref ref-solid',
    lastText: fmtPace(pts[pts.length - 1].pace), xLabels: monthLabels(first, pts[pts.length - 1].key),
    label: `Tendance du rythme sur ${plural(pts.length, 'dimanche')} : de ${fmtPace(pts[0].pace)} à ${fmtPace(pts[pts.length - 1].pace)}`,
    h: big ? 220 : 188, cls: 'chart-pace',
  });
}
function ageChart(curve, { big = false } = {}) {
  const pts = curve.filter(p => finite(p.bio));
  if (!pts.length) return null;
  const first = pts[0].key;
  const vals = pts.flatMap(p => [p.bio, p.civil]).filter(finite);
  const t = niceTicks(Math.min(...vals) - 0.3, Math.max(...vals) + 0.3, 4);
  return lineChart({
    xs: pts.map(p => dayDiff(first, p.key)), ys: pts.map(p => p.bio), series2: pts.map(p => p.civil),
    yLo: t.lo, yHi: t.hi, yTicks: t.ticks, yFmt: x => nfx.format(x), hollow: i => Boolean(pts[i].calibrating),
    lastText: fmtAge(pts[pts.length - 1].bio), xLabels: monthLabels(first, pts[pts.length - 1].key),
    label: `Courbe de l'âge bio sur ${plural(pts.length, 'dimanche')} : de ${fmtAge(pts[0].bio)} à ${fmtAge(pts[pts.length - 1].bio)} ans ; pointillé : âge civil`,
    h: big ? 220 : 188, cls: 'chart-age',
  });
}
const curveTable = curve => srTable("Âge bio et rythme, un point par dimanche", ['Dimanche', 'Âge bio', 'Écart', 'Rythme'],
  curve.map(p => [dayMonth(p.key), `${fmtAge(p.bio)} ans`, `${signed1(finite(p.gap) ? p.gap : p.bio - p.civil)} an`, finite(p.pace) ? fmtPace(p.pace) : '—']));

// ================= Écran Âge bio =================

function renderAge() {
  const view = $('v-age');
  const m = ageModel();
  const r = state.data.result;
  let sub = '';
  if (m.kind === 'value') {
    if (m.provisional) sub = 'Valeur provisoire';
    else if (!m.official) sub = `Dimanche ${dayMonth(m.key)}`;
    else if (m.paused) sub = 'Mises à jour en pause';
    else if (finite(m.off.nextUpdateDays)) sub = m.off.nextUpdateDays <= 1 ? 'Prochaine mise à jour demain' : `Prochaine mise à jour dans ${m.off.nextUpdateDays} j`;
  } else if (m.kind === 'waiting') sub = 'En attente de données';
  const kids = [topbar({ title: 'Âge bio', sub, right: infoBtn('age', "Comprendre l'âge bio") })];
  if (m.kind === 'nodata' || m.kind === 'profile') kids.push(ageEmpty(m.kind));
  else if (m.kind === 'waiting') kids.push(ageWaiting(r));
  else {
    const reveal = state.reveal;
    state.reveal = false;
    kids.push(h('div', { class: 'hero' }, m.provisional ? dayHead(m) : weekNav(m), orbFigure(m, { count: reveal }), heroMeta(m)),
      m.official || m.provisional ? upcomingList(r, m) : null,
      paceSection(m, reveal), m.provisional ? null : callout(m),
      ...GROUPS.map(g => indSection(g, m)),
      bloodSection(m),
      m.official || m.provisional ? leversSection(r) : null,
      trendSection(r.curve ?? []),
      note('Estimation personnelle, pas un avis médical.', 'page-foot'));
  }
  fill(view, kids);
  renderCompact(m);
}
function ageEmpty(kind) {
  const text = kind === 'nodata'
    ? "Aucune donnée d'activité dans cet export : synchronise le bracelet dans Gadgetbridge, puis relance l'export."
    : 'Date de naissance absente ou par défaut : renseigne ton profil dans Gadgetbridge (Paramètres → À propos de vous), synchronise, relance l\'export.';
  return h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, icon(kind === 'nodata' ? 'pulse' : 'user')),
    h('p', { class: 'empty-title' }, kind === 'nodata' ? 'Pas encore de données' : 'Profil à compléter'),
    h('p', { class: 'empty-text' }, text),
    kind === 'profile' ? linkCta('Voir le profil lu', '#plus', { 'data-tab': true }) : null);
}
// Ni nuit ni jour valide exploitable : l'âge bio attend sa première mesure.
function ageWaiting(r) {
  return h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, icon('orb')),
    h('p', { class: 'empty-title' }, 'Ton âge bio arrive'),
    h('p', { class: 'empty-text' }, "Dès ta première nuit valide (3 h de sommeil) ou journée valide (16 h avec le bracelet)."),
    note(`${plural(r.validNights ?? 0, 'nuit valide', 'nuits valides')} et ${plural(r.validDays ?? 0, 'jour valide', 'jours valides')} dans cet export.`));
}
// En-tête de la valeur provisoire, à la place de la navigation par semaine : jour du calcul.
function dayHead(m) {
  const label = m.key === clock.dayKey(Date.now()) ? "Aujourd'hui" : `Au ${dayMonth(m.key)}`;
  return h('div', { class: 'week' }, h('p', { class: 'week-label' }, label));
}
function weekNav(m) {
  const n = m.curve.length;
  const prevKey = m.idx > 0 ? m.curve[m.idx - 1].key : null;
  const nextKey = m.idx < n - 1 ? m.curve[m.idx + 1].key : null;
  return h('nav', { class: 'week', 'aria-label': 'Semaine affichée' },
    h('button', { class: 'icon-btn', type: 'button', 'data-week': '-1', disabled: !prevKey, 'aria-label': prevKey ? `Semaine précédente, ${weekLabel(prevKey)}` : 'Pas de semaine précédente' }, icon('back')),
    h('p', { class: 'week-label', 'aria-live': 'polite' }, h('span', { class: 'visually-hidden' }, 'Semaine du '), weekLabel(m.key)),
    h('button', { class: 'icon-btn', type: 'button', 'data-week': '1', disabled: !nextKey, 'aria-label': nextKey ? `Semaine suivante, ${weekLabel(nextKey)}` : 'Pas de semaine suivante' }, icon('next')));
}
// Sous l'orbe, une ligne discrète : âge civil · intervalle · fiabilité (touche : sa fiche) ; « En pause » en pastille.
function heroMeta(m) {
  const off = m.off;
  const items = [];
  if (m.paused) items.push(chip('En pause', 'chip-warn'));
  if (finite(m.civil)) items.push(h('span', null, `Âge civil ${nf1.format(round1(m.civil))}`));
  if (m.official && finite(off.interval?.lo) && finite(off.interval?.hi)) {
    items.push(h('button', { class: 'meta-btn', type: 'button', 'data-sheet': 'age', 'aria-label': `Précision : intervalle à 95 % de ${fmtAge(off.interval.lo)} à ${fmtAge(off.interval.hi)} ans` },
      `${fmtAge(off.interval.lo)} – ${fmtAge(off.interval.hi)}`));
  }
  if (finite(m.reliability?.score)) {
    const text = `Fiabilité ${relText(m.reliability.score)}`;
    items.push(m.official || m.provisional
      ? h('button', { class: 'meta-btn', type: 'button', 'data-sheet': 'fiabilite', 'aria-label': `${text} : en savoir plus` }, text)
      : h('span', null, text));
  } else if (m.calibrating) {
    items.push(h('span', null, m.official && finite(off.validDays) ? `Calibrage ${int(Math.min(off.validDays, 90))}/90 j` : 'Calibrage'));
  }
  const pv = state.data.result.preview;
  const preview = m.official && pv && finite(pv.bio) && pv.key !== off.key
    ? h('button', { class: 'preview', type: 'button', 'data-sheet': 'apercu', 'aria-label': `Aperçu du jour : ${fmtAge(pv.bio)} ans${finite(pv.pace?.value) ? `, rythme ${num1(pv.pace.value)} fois` : ''}. La valeur officielle arrive dimanche.` },
      chip('Aperçu du jour', 'chip-preview'),
      h('span', { class: 'preview-val' }, h('b', { class: 'num' }, fmtAge(pv.bio)), ' ans',
        finite(pv.pace?.value) ? [h('span', { class: 'dot-sep' }, '·'), h('b', { class: 'num' }, fmtPace(pv.pace.value))] : null),
      h('span', { class: `preview-delta ${impactCls(pv.bio - off.bio)}` }, `${signed1(pv.bio - off.bio)} ${yearWord(pv.bio - off.bio)} depuis dimanche`))
    : null;
  return h('div', { class: 'hero-meta' }, items.length ? h('p', { class: 'hero-line' }, items) : null, preview);
}
// « À venir » : ce qui n'est pas encore disponible, une ligne par élément (quand, ou comment), le plus proche d'abord.
const UPCOMING = { official: 'Valeur officielle', pace: 'Rythme de vieillissement' };
// « durée du sommeil », « activité », « renforcement » → « Durée du sommeil, activité et renforcement » (sans doublon).
const listFr = names => {
  const u = [...new Set(names)];
  return capital(u.length > 1 ? `${u.slice(0, -1).join(', ')} et ${u[u.length - 1]}` : u[0]);
};
function upcomingList(r, m) {
  const items = (r.upcoming ?? []).map(u => ({
    what: UPCOMING[u.id] ?? u.id,
    when: u.date ? `le ${dayMonth(u.date)}` : `dans ${plural(u.count, ...u.unit)}`,
    at: u.date ?? addDays(r.lastKey, u.count),
  }));
  // Indicateurs absents, regroupés par raison (« dans 4 jours valides » : activité et renforcement).
  const groups = new Map();
  for (const ind of m.indicators ?? []) {
    if (ind.present || ind.estimated || !ind.reason || !IND[ind.id]) continue;
    if (!groups.has(ind.reason)) groups.set(ind.reason, { names: [], wait: ind.wait });
    groups.get(ind.reason).names.push(IND[ind.id].short);
  }
  for (const [reason, g] of groups) {
    items.push({ what: listFr(g.names), when: reason, at: g.wait ? addDays(r.lastKey, g.wait) : '9999' });
  }
  if (!items.length) return null;
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return h('section', { class: 'soon', 'aria-label': 'À venir' },
    h('ul', { class: 'soon-list' }, items.map(x => h('li', null, icon('lock'), h('span', { class: 'soon-what' }, x.what), h('span', { class: 'soon-when' }, x.when)))));
}
function paceSection(m, animate) {
  if (!finite(m.pace)) return null;
  return h('section', { class: 'pace', 'aria-labelledby': 'pace-title' },
    h('div', { class: 'pace-head' },
      h('h2', { class: 'pace-title', id: 'pace-title' }, 'Rythme de vieillissement'),
      h('button', { class: 'icon-btn icon-btn-sm', type: 'button', 'data-sheet': 'rythme', 'aria-label': 'Comprendre le rythme de vieillissement' }, icon('info'))),
    gauge(m, { animate }));
}
function callout(m) {
  const r = state.data.result;
  if (m.paused) {
    const u = r.unlock ?? {};
    return h('div', { class: 'callout callout-pause' },
      h('h3', { class: 'callout-title' }, 'Mises à jour en pause'),
      h('p', { class: 'callout-text' }, `Il faut ${u.needed ?? 21} nuits valides sur les 31 derniers jours ; tu en as ${u.nightsIn31 ?? m.off.nightsIn31 ?? '—'} : encore ${plural(u.nightsToGo ?? 0, 'nuit')}.`));
  }
  const pace = finite(m.pace);
  return h('div', { class: 'callout' },
    h('h3', { class: 'callout-title' }, pace ? paceTitle(m.pace) : 'Cette semaine'),
    h('p', { class: 'callout-text' }, pace ? `${changeSentence(m)} ${paceSentence(m.pace)}` : changeSentence(m)),
    m.official ? null : h('button', { class: 'link-cta', type: 'button', 'data-week': 'latest' }, h('span', null, 'Revenir à cette semaine'), icon('arrow')));
}
function indSection(g, m) {
  const list = g.ids.map(id => m.indicators.find(x => x.id === id) ?? { id, present: false, reason: '', delta: 0 });
  return h('section', { class: 'section ind-section', 'aria-labelledby': `sec-${g.key}` },
    secHead(g.title, `sec-${g.key}`, m.provisional && !m.recent ? 'avg' : true),
    h('div', { class: 'card ind-card' }, list.map(ind => indRow(ind, m))));
}
// Prise de sang : marqueurs comptés connus au jour affiché (valeurs des 12 derniers mois), du plus influent au moins
// influent ; en sous-titre, les absents à demander au prochain bilan, dans le même ordre ; âge par organe.
// Sans valeur, une invitation à saisir.
const influence = id => calc.bloodInfluence(id);
const byInfluence = (a, b) => influence(b.id ?? b) - influence(a.id ?? a);
// « a, b et c », sans majuscule (après deux-points).
const joinFr = names => (names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names[0] ?? '');
const COUNT_WORD = { 2: 'deux', 3: 'trois', 4: 'quatre', 5: 'cinq' };
function bloodSection(m) {
  const b = m.blood;
  const known = (b?.items ?? []).filter(x => x.value !== null).sort(byInfluence);
  const head = secHead('Prise de sang', 'sec-blood', false, b?.latest ? h('span', { class: 'sec-aside' }, `au ${dayMonthYear(b.latest)}`) : null);
  if (!known.length) {
    const any = blood.list.length > 0;
    const top = [...calc.BLOOD_COUNTED].sort(byInfluence).slice(0, 3).map(id => IND[id].short);
    return h('section', { class: 'section', 'aria-labelledby': 'sec-blood' }, head,
      h('a', { class: 'card blood-cta', href: any ? '#sang' : '#bilan/nouveau' },
        h('span', { class: 'list-icon' }, icon('drop')),
        h('span', { class: 'list-main' },
          h('span', { class: 'list-label' }, any ? 'Aucune prise de sang de moins de 12 mois' : 'Ajoute ta prise de sang'),
          h('span', { class: 'list-sub' }, `${any ? 'Une prise de sang compte 12 mois.' : '9 analyses courantes affinent ton âge bio.'} Les plus influentes : ${joinFr(top)}.`)),
        icon('next', 'list-chev')));
  }
  // Absents, du plus influent au moins influent (5 au plus) ; ceux qui pèsent plus que chacune des analyses présentes.
  const missing = b.items.filter(x => x.value === null).sort(byInfluence);
  const strongest = Math.max(...known.map(x => influence(x.id)));
  const ahead = Math.min(5, missing.filter(x => influence(x.id) > strongest).length);
  const next = missing.length
    ? h('p', { class: 'blood-next' },
      `À demander au prochain bilan, de la plus influente à la moins influente : ${joinFr(missing.slice(0, 5).map(x => `${IND[x.id].short} (poids ${weightText(x.id)})`))}${missing.length > 5 ? '…' : ''}.`,
      ahead ? ` ${ahead === 1 ? 'La première pèse' : `Les ${COUNT_WORD[ahead] ?? ahead} premières pèsent`} plus que chacune de tes analyses actuelles.` : '')
    : null;
  return h('section', { class: 'section', 'aria-labelledby': 'sec-blood' }, head, next,
    h('div', { class: 'card ind-card' }, known.map(x => bloodRow(x, m, b.latest))),
    organsCard(b, m),
    linkCta('Mes prises de sang', '#sang'));
}
function bloodRow(x, m, latest) {
  const meta = IND[x.id];
  const shown = labIn(x.id, x.raw);
  const ind = { id: x.id, present: x.present, estimated: false, value6m: x.value, value30: null, delta: x.delta, display: [shown, meta.unit] };
  const label = `${meta.name} : ${shown} ${meta.unit}, prise de sang du ${dayMonthYear(x.date)}, ${x.present ? `impact ${signed1(x.delta)} ${yearWord(x.delta)} sur ton âge bio` : `non comptée, ${x.reason}`}`;
  return h('div', { class: `ind-row is-static${x.present ? '' : ' is-absent'}`, role: 'group', 'aria-label': label },
    h('div', { class: 'ind-head', 'aria-hidden': 'true' },
      h('span', { class: 'ind-top' }, h('span', { class: 'ind-name' }, meta.name),
        x.present ? null : chip('Non comptée'),
        x.date !== latest ? h('span', { class: 'blood-date' }, dayMonthYear(x.date)) : null),
      h('span', { class: 'ind-body' }, barViz(ind, ctxAt(m.civil)), impactEl(ind)),
      x.present ? null : h('span', { class: 'ind-reason blood-reason' }, `${capital(x.reason)}.`)));
}
// Âge par organe : âge civil + impact des marqueurs de l'organe (classement de Levine 2018). Grossier.
function organsCard(b, m) {
  if (!b.systems.length || !finite(m.civil)) return null;
  return h('div', { class: 'card organs' },
    h('p', { class: 'card-title' }, 'Âge par organe'),
    h('ul', { class: 'organ-list' }, b.systems.map(sy => h('li', { class: 'organ' },
      h('span', { class: 'organ-main' }, h('span', { class: 'organ-name' }, sy.label), h('span', { class: 'organ-sub' }, sy.ids.map(id => IND[id].name).join(', '))),
      h('span', { class: 'organ-age' }, h('b', { class: 'num' }, fmtAge(m.civil + sy.delta)), h('small', null, 'ans')),
      h('span', { class: `organ-gap num ${impactCls(sy.delta)}` }, signed1(sy.delta))))),
    note("Grossier : âge civil + impact des seules analyses de l'organe, une à quatre par organe."));
}
function leversSection(r) {
  const levers = (r.levers ?? []).filter(l => finite(l.gain) && l.gain > 0.05);
  const items = levers.length
    ? levers.map(l => {
      const meta = IND[l.id] ?? { name: l.id, icon: 'spark' };
      return h('a', { class: 'lever', href: `#indicateur/${l.id}`, 'aria-label': `${l.label || LEVER_LABEL[l.id] || meta.name} : environ ${MINUS}${dec1(l.gain)} ${yearWord(l.gain)} d'âge bio` },
        h('span', { class: 'lever-icon' }, icon(meta.icon)),
        h('span', { class: 'lever-main' },
          h('span', { class: 'lever-label' }, l.label || LEVER_LABEL[l.id] || meta.name),
          h('span', { class: 'lever-sub' }, meta.name, finite(l.from) && finite(l.to) && IND[l.id] ? ` · ${valText(l.id, l.from)} → ${valText(l.id, l.to)}` : '')),
        h('span', { class: 'lever-gain' }, h('b', { class: 'num' }, `${MINUS}${dec1(l.gain)}`), h('small', null, yearWord(l.gain))),
        icon('next', 'lever-chev'));
    })
    : [h('p', { class: 'lever-none' }, "Aucun pas réaliste ne ferait gagner plus d'un mois.")];
  return h('section', { class: 'section', id: 'levers', 'aria-labelledby': 'levers-title' },
    secHead('Ce qui joue le plus', 'levers-title'),
    h('div', { class: 'card levers' }, items));
}
function trendSection(curve) {
  if (!curve.length) return null;
  const pc = paceChart(curve);
  const ac = ageChart(curve);
  return h('section', { class: 'section', 'aria-labelledby': 'trend-title' },
    secHead('Tendance', 'trend-title'),
    pc ? h('a', { class: 'card chart-card', href: '#tendance', 'aria-label': 'Tendance du rythme : ouvrir le détail' },
      h('span', { class: 'card-head' }, h('span', { class: 'card-title' }, 'Tendance du rythme'), icon('next')), pc) : null,
    ac ? h('a', { class: 'card chart-card', href: '#tendance', 'aria-label': "Courbe de l'âge bio : ouvrir le détail" },
      h('span', { class: 'card-head' }, h('span', { class: 'card-title' }, "Courbe de l'âge bio"), icon('next')), ac,
      h('span', { class: 'chart-legend', 'aria-hidden': 'true' }, legendItem('lg-line', 'Âge bio'), legendItem('lg-dash', 'Âge civil'), legendItem('lg-hollow', 'Calibrage'))) : null,
    curveTable(curve));
}

// En-tête compact (défilement) : écart | mini-orbe | rythme.
let compactObserver = null;
function renderCompact(m) {
  const box = $('compact');
  compactObserver?.disconnect();
  box.classList.remove('is-on');
  if (m.kind !== 'value') {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(
    h('span', { class: 'compact-side' }, h('b', { class: `num is-${m.ageState}` }, round1(m.gap) === 0 ? '0,0' : dec1(m.gap)),
      h('span', null, round1(m.gap) === 0 ? 'Âge civil' : gapPhrase(m.gap).replace(/^[\d,]+ /, ''))),
    h('span', { class: 'compact-orb' }, orbFigure(m, { size: 'sm' })),
    m.provisional
      ? h('span', { class: 'compact-side' }, h('b', { class: 'num' }, relText(m.reliability?.score)), h('span', null, 'Fiabilité'))
      : h('span', { class: 'compact-side' }, h('b', { class: 'num' }, finite(m.pace) ? fmtPace(m.pace) : '—'), h('span', null, 'Rythme')));
  const orb = $('v-age').querySelector('.orb-lg');
  if (!orb || !('IntersectionObserver' in window)) return;
  compactObserver = new IntersectionObserver(([e]) => {
    box.classList.toggle('is-on', !e.isIntersecting && e.boundingClientRect.top < 0 && document.body.dataset.screen === 'age');
  }, { threshold: 0, rootMargin: '-70px 0px 0px 0px' });
  compactObserver.observe(orb);
}

// ================= Écran Aujourd'hui =================

function syncLine() {
  const d = state.data;
  if (!d) return '';
  const parts = [`Synchronisé ${agoText(Date.now() - state.loadedAt)}`];
  if (d.lastDataMs) parts.push(`données jusqu'au ${dateFmt.format(d.lastDataMs)}, ${clock.time(d.lastDataMs)}`);
  return parts.join(' · ');
}
function staleBanner() {
  const d = state.data;
  if (DEMO !== null || !d?.lastDataMs || Date.now() - d.lastDataMs <= STALE_MS) return null;
  return h('p', { class: 'banner banner-warn', role: 'note' }, icon('alert'),
    h('span', null, `Export ancien (dernière donnée ${agoText(Date.now() - d.lastDataMs)}) : dans Gadgetbridge, synchronise puis lance « Run AutoExport now ».`));
}
function renderToday() {
  const r = state.data.result;
  const last = r.sleep?.last ?? null;
  const off = r.official ?? null;
  const band = (x, a, b) => (!finite(x) ? '' : x < a ? 'is-bad' : x < b ? 'is-mid' : 'is-good');
  // soon : date de déblocage écrite en petit dans le cadran, à la place de la valeur.
  const dial = ({ label, main, unit, frac, cls, href, aria, soon = null }) => h('a', { class: `dial ${cls}`, href, 'aria-label': aria },
    h('span', { class: 'dial-ring' }, ring(92, 6, frac),
      soon ? h('span', { class: 'dial-val is-soon' }, soon)
        : h('span', { class: 'dial-val' }, h('b', { class: 'num' }, main), unit ? h('small', null, unit) : null)),
    h('span', { class: 'dial-label' }, label, icon('next')));
  const pace = off?.pace?.value ?? r.provisional?.pace?.value;
  const paceDate = finite(pace) ? null : (r.upcoming ?? []).find(u => u.id === 'pace')?.date ?? null;
  const dials = h('div', { class: 'dials' },
    dial({ label: 'Sommeil', main: last ? int(last.performance) : '—', unit: last ? '%' : '', frac: last ? last.performance / 100 : 0, cls: 'dial-sleep', href: '#sommeil', aria: last ? `Sommeil : performance ${pct(last.performance)} la dernière nuit` : 'Sommeil : aucune nuit valide' }),
    dial({ label: 'Régularité', main: finite(last?.regularity) ? int(last.regularity) : '—', unit: finite(last?.regularity) ? '%' : '', frac: finite(last?.regularity) ? last.regularity / 100 : 0, cls: `dial-reg ${band(last?.regularity, 70, 85)}`, href: '#sommeil', aria: finite(last?.regularity) ? `Régularité : ${pct(last.regularity)} la dernière nuit` : 'Régularité : pas encore calculée' }),
    dial({ label: 'Rythme', main: finite(pace) ? fmtPace(pace) : '—', unit: '', frac: finite(pace) ? (clamp(pace, -1, 3) + 1) / 4 : 0, cls: 'dial-pace', href: '#age',
      soon: paceDate ? dayMonth(paceDate) : null,
      aria: finite(pace) ? `Rythme de vieillissement : ${num1(pace)} fois` : paceDate ? `Rythme de vieillissement : disponible le ${dayMonth(paceDate)}` : 'Rythme : pas encore disponible' }));
  fill($('v-aujourdhui'),
    topbar({ title: "Aujourd'hui", sub: syncLine(), subId: 'today-sub' }),
    staleBanner(),
    dials,
    ageCard(r),
    lastNightSection(r),
    weekSection(r));
}
function ageCard(r) {
  const off = r.official ?? null;
  if (!r.lastKey || !finite(r.civil)) {
    return h('a', { class: 'card age-card', href: '#age', 'data-tab': true },
      h('span', { class: 'age-card-main' }, h('span', { class: 'card-kicker' }, 'Âge bio'),
        h('span', { class: 'age-card-meta' }, r.lastKey ? 'Profil à compléter dans Gadgetbridge' : 'Pas encore de données')), icon('next', 'card-chev'));
  }
  // Sans valeur officielle : la valeur provisoire, sinon l'attente d'une première nuit ou journée valide.
  const p = off ? null : r.provisional ?? null;
  if (!off && !finite(p?.bio)) {
    return h('a', { class: 'card age-card', href: '#age', 'data-tab': true },
      h('span', { class: 'age-card-lock' }, ring(56, 4, 0), icon('moon')),
      h('span', { class: 'age-card-main' }, h('span', { class: 'card-kicker' }, 'Âge bio'),
        h('span', { class: 'age-card-big' }, 'En attente'),
        h('span', { class: 'age-card-meta' }, 'Dès ta première nuit ou journée valide')), icon('next', 'card-chev'));
  }
  const v = off ?? p;
  const m = { bio: v.bio, gap: v.gap, civil: v.civil, ageState: ageStateOf(v.gap), paused: Boolean(off?.paused) };
  const pv = r.preview;
  const meta = !off
    ? `Provisoire · fiabilité ${relText(p.reliability?.score)}`
    : off.paused
      ? `En pause : encore ${plural(r.unlock?.nightsToGo ?? 0, 'nuit')}`
      : [finite(off.nextUpdateDays) ? (off.nextUpdateDays <= 1 ? 'Mise à jour demain' : `Mise à jour dans ${off.nextUpdateDays} j`) : '',
        pv && finite(pv.bio) && pv.key !== off.key ? `aperçu ${fmtAge(pv.bio)}` : ''].filter(Boolean).join(' · ');
  return h('a', { class: 'card age-card', href: '#age', 'data-tab': true, 'aria-label': `Âge bio${off ? '' : ' provisoire'} ${fmtAge(v.bio)} ans, ${gapPhrase(v.gap).toLowerCase()}. ${meta}` },
    h('span', { class: 'age-card-orb', 'aria-hidden': 'true' }, orbFigure(m, { size: 'xs', label: '' })),
    h('span', { class: 'age-card-main', 'aria-hidden': 'true' },
      h('span', { class: 'card-kicker' }, 'Âge bio'),
      h('span', { class: 'age-card-big' }, h('b', { class: 'num' }, fmtAge(v.bio)), h('small', null, 'ans')),
      h('span', { class: `age-card-gap is-${m.ageState}` }, gapPhrase(v.gap)),
      meta ? h('span', { class: 'age-card-meta' }, meta) : null),
    icon('next', 'card-chev'));
}
function statGrid(items, cls = '') {
  return h('dl', { class: `stats ${cls}`.trim() }, items.map(([k, v, c = '']) => h('div', { class: `stat ${c}`.trim() }, h('dt', null, k), h('dd', { class: 'num' }, v))));
}
const kvList = items => h('dl', { class: 'kv' }, items.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
const legendItem = (cls, text) => h('span', { class: 'lg' }, h('i', { class: cls }), text);
function lastNightSection(r) {
  const last = r.sleep?.last;
  const reg = finite(last?.regularity) ? ` · régularité ${pct(last.regularity)}` : '';
  const card = last
    ? h('a', { class: 'card night-card', href: '#sommeil', 'aria-label': `Dernière nuit, ${nightLabel(last.key)} : ${hm(last.sleepMin)}, performance ${pct(last.performance)}${reg}. Ouvrir le détail du sommeil` },
      h('span', { class: 'night-top', 'aria-hidden': 'true' },
        h('span', { class: 'night-icon' }, icon('moon')),
        h('span', { class: 'night-main' }, h('b', { class: 'num night-dur' }, hm(last.sleepMin)),
          h('span', { class: 'night-span' }, `${clock.time(last.bed)} → ${clock.time(last.wake)} · performance ${pct(last.performance)}${reg}`)),
        icon('next', 'card-chev')))
    : h('div', { class: 'card' }, h('p', { class: 'empty-text' }, 'Aucune nuit valide (il faut au moins 3 h de sommeil).'));
  return h('section', { class: 'section', 'aria-labelledby': 'night-title' },
    secHead('Dernière nuit', 'night-title', false, last ? h('span', { class: 'sec-aside' }, capital(nightLabel(last.key))) : null),
    card);
}
function weekSection(r) {
  const days = r.week ?? [];
  if (!days.length) return null;
  const done = days.filter(d => !d.partial);
  const mean = xs => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);
  const lastOf = f => [...done].reverse().find(d => finite(f(d)));
  const row = (label, iconName, f, fmt, better = 1) => {
    const lastDay = lastOf(f);
    const avg = mean(done.map(f).filter(finite));
    if (!lastDay || !finite(avg)) return null;
    const v = f(lastDay);
    const diff = v - avg;
    const tol = Math.abs(avg) * 0.03;
    const dir = diff > tol ? 'up' : diff < -tol ? 'down' : 'flat';
    const good = dir === 'flat' ? '' : (dir === 'up') === (better > 0) ? 'is-good' : 'is-bad';
    return h('li', { class: 'dash-row' },
      h('span', { class: 'dash-icon' }, icon(iconName)),
      h('span', { class: 'dash-main' }, h('span', { class: 'dash-label' }, label), h('span', { class: 'dash-sub' }, `${capital(weekdayFmt.format(utc(lastDay.key)))} ${dayNum(lastDay.key)} · moy. 7 j ${fmt(avg)}`)),
      h('span', { class: `dash-val ${good}` }, h('b', { class: 'num' }, fmt(v)),
        h('span', { class: `trend-mark is-${dir}`, role: 'img', 'aria-label': dir === 'up' ? 'au-dessus de la moyenne' : dir === 'down' ? 'sous la moyenne' : 'dans la moyenne' })));
  };
  const rows = [
    row('Pas', 'steps', d => (d.present ? d.steps : null), int, 1),
    row('Sommeil', 'moon', d => d.sleepMin, hm, 1),
    row('Activité modérée', 'pulse', d => (d.present ? d.mod : null), v => `${int(v)} min`, 1),
    row('FC de repos', 'heart', d => d.rest, v => `${int(v)} bpm`, -1),
  ].filter(Boolean);
  const head = h('tr', null, ['Jour', 'Pas', 'Sommeil', 'Mod./vig.', 'FC repos'].map(t => h('th', { scope: 'col' }, t)));
  const body = days.map(d => h('tr', { class: d.valid ? '' : 'is-invalid' },
    h('th', { scope: 'row' }, `${capital(weekdayFmt.format(utc(d.key)))} ${dayNum(d.key)}${d.partial ? '*' : d.present && !d.valid ? '°' : ''}`),
    h('td', null, d.present ? int(d.steps) : '—'),
    h('td', null, finite(d.sleepMin) ? hm(d.sleepMin) : '—'),
    h('td', null, d.present ? `${int(d.mod)} / ${int(d.vig)}` : '—'),
    h('td', null, finite(d.rest) ? int(d.rest) : '—')));
  return h('section', { class: 'section', 'aria-labelledby': 'week-title' },
    secHead('7 derniers jours', 'week-title'),
    rows.length ? h('ul', { class: 'card dash' }, rows) : null,
    h('div', { class: 'card table-card' },
      h('p', { class: 'card-title' }, 'Jour par jour'),
      h('div', { class: 'scroll-x', tabindex: '0', role: 'region', 'aria-label': 'Tableau des 7 derniers jours' },
        h('table', { class: 'week-table' }, h('thead', null, head), h('tbody', null, body))),
      note('* jour en cours · ° jour non valide (moins de 16 h de FC), ignoré du calcul. Sommeil et FC de repos : nuit finissant ce jour.')));
}

// ================= Détail Sommeil =================

const SLEEP_BANDS = { perf: [70, 85], reg: [70, 85] };
function bandOf(x, [a, b]) {
  return !finite(x) ? -1 : x < a ? 0 : x < b ? 1 : 2;
}
function renderSleep() {
  const r = state.data.result;
  const sl = r.sleep ?? {};
  const last = sl.last;
  const view = $('v-sommeil');
  const head = topbar({ title: 'Sommeil', sub: last ? nightLabel(last.key) : '', back: true, right: infoBtn('sommeil', 'Comprendre les scores de sommeil') });
  if (!last) {
    view.replaceChildren(head, h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, icon('moon')), h('p', { class: 'empty-title' }, 'Aucune nuit valide'), h('p', { class: 'empty-text' }, 'Il faut au moins 3 h de sommeil dans une nuit. Porte le bracelet la nuit, puis synchronise.')));
    return;
  }
  const perfBand = bandOf(last.performance, SLEEP_BANDS.perf);
  const big = h('div', { class: 'sleep-ring', role: 'img', 'aria-label': `Performance du sommeil : ${pct(last.performance)} (${['faible', 'suffisante', 'optimale'][perfBand]})` },
    ring(258, 12, last.performance / 100, 'ring-sleep'),
    h('span', { class: 'sleep-ring-center', 'aria-hidden': 'true' },
      h('span', { class: 'sleep-ring-val' }, h('b', { class: 'num' }, int(last.performance)), h('small', null, '%')),
      h('span', { class: 'sleep-ring-label' }, 'Performance', h('br'), 'du sommeil'),
      h('span', { class: 'band3' }, [0, 1, 2].map(i => h('i', { class: i === perfBand ? `on b${i}` : '' })))));
  const line = (label, iconName, x, band, why) => {
    const b = bandOf(x, band);
    return h('li', { class: 'sleep-line' },
      h('span', { class: 'sleep-line-icon' }, icon(iconName)),
      h('span', { class: 'sleep-line-label' }, label, !finite(x) && why ? h('small', null, why) : null),
      h('span', { class: 'band3', role: 'img', 'aria-label': b < 0 ? 'non calculé' : ['faible', 'suffisant', 'optimal'][b] }, [0, 1, 2].map(i => h('i', { class: i === b ? `on b${i}` : '' }))),
      h('span', { class: 'sleep-line-val num' }, finite(x) ? pct(x) : '—'));
  };
  const lines = h('div', { class: 'callout callout-list' },
    h('ul', { class: 'sleep-lines' },
      line('Régularité', 'clock', last.regularity, SLEEP_BANDS.reg, 'il faut 2 nuits valides juste avant')),
    h('p', { class: 'band-legend', 'aria-hidden': 'true' }, h('i', { class: 'b0' }), 'Faible', h('i', { class: 'b1' }), 'Suffisant', h('i', { class: 'b2' }), 'Optimal'));
  const a = sl.avg7;
  const week = (r.week ?? []).filter(d => !d.partial || finite(d.sleepMin));
  const maxMin = Math.max(600, ...week.map(d => d.sleepMin ?? 0));
  const bars = h('div', { class: 'bars', role: 'img', 'aria-label': `Durée des 7 dernières nuits : ${week.map(d => `${dayNum(d.key)} ${finite(d.sleepMin) ? hm(d.sleepMin) : 'aucune'}`).join(', ')}` },
    vars(h('i', { class: 'bars-need', 'aria-hidden': 'true' }), { y: (480 / maxMin).toFixed(3) }),
    week.map(d => h('span', { class: 'bar-col', 'aria-hidden': 'true' },
      vars(h('i', { class: `bar ${finite(d.sleepMin) ? (d.sleepMin >= 420 ? 'is-good' : d.sleepMin >= 360 ? 'is-mid' : 'is-bad') : 'is-none'}` }), { v: finite(d.sleepMin) ? (d.sleepMin / maxMin).toFixed(3) : 0 }),
      h('span', { class: 'bar-day' }, weekdayFmt.format(utc(d.key)).replace('.', '').slice(0, 2)))));
  fill(view, head,
    h('div', { class: 'hero hero-sleep' }, big),
    lines,
    h('div', { class: 'card' }, statGrid([
      ['Durée', hm(last.sleepMin)],
      ['Coucher → lever', `${clock.time(last.bed)} → ${clock.time(last.wake)}`],
    ], 'stats-2')),
    a ? h('section', { class: 'section', 'aria-labelledby': 'avg-title' },
      secHead(a.count > 1 ? `Moyenne des ${a.count} dernières nuits` : 'Moyenne', 'avg-title'),
      h('div', { class: 'card' }, statGrid([
        ['Performance', pct(a.performance)], ['Durée', hm(a.sleepMin)],
        ['Régularité', finite(a.regularity) ? pct(a.regularity) : '—'],
      ]))) : null,
    week.length ? h('section', { class: 'section', 'aria-labelledby': 'nights-title' },
      secHead('7 dernières nuits', 'nights-title', false, h('span', { class: 'sec-aside' }, 'trait : 8 h')),
      h('div', { class: 'card' }, bars)) : null);
}

// ================= Détail d'un indicateur =================

function renderIndicator(id) {
  const view = $('v-indicateur');
  const r = state.data.result;
  const off = r.official ?? null;
  const src = off ?? r.provisional ?? null;   // valeur officielle, sinon provisoire
  const pm = { provisional: !off, recent: Boolean(src?.pace) };
  const [capShort] = capOf(pm);
  const meta = IND[id];
  const head = topbar({ title: meta.name, sub: `${GROUP_NAME[meta.group]} · ${off ? 'moyenne 6 mois' : 'valeur provisoire'}`, back: true, right: infoBtn(id, `Comprendre : ${meta.name}`) });
  const ind = src?.indicators?.find(x => x.id === id) ?? null;
  if (!src || !ind) {
    view.replaceChildren(head, h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, icon(meta.icon)),
      h('p', { class: 'empty-title' }, 'Pas encore de valeur'),
      h('p', { class: 'empty-text' }, `${meta.what} Il s'affichera avec ton âge bio, dès ta première nuit ou journée valide.`)));
    return;
  }
  const ctx = ctxAt(src.civil);
  const estimated = !ind.present && ind.estimated && finite(ind.value6m);
  const absent = !ind.present && !estimated;
  const target = targetOf(id, ctx);
  const v = off || finite(ind.value30) ? verdict(ind) : provisionalVerdict(ind);
  const kids = [head];
  if (absent) {
    kids.push(h('div', { class: 'card ind-hero' }, h('p', { class: 'ind-hero-chip' }, chip(ind.wait ? 'Bientôt' : 'Non mesuré')), h('p', { class: 'ind-text' }, absentText(ind))));
  } else {
    const [main, unit] = meta.fmt(ind.value6m);
    kids.push(h('div', { class: 'card ind-hero' },
      h('div', { class: 'ind-hero-row' },
        h('div', { class: 'ind-hero-val' }, h('span', { class: 'cap' }, h('span', { class: `tri ${estimated ? 'tri-hollow' : 'tri-down'}` }), estimated ? 'Estimation' : capShort),
          h('span', { class: 'big' }, h('b', { class: 'num' }, main), unit ? h('small', null, unit) : null)),
        ind.present && finite(ind.value30) ? h('div', { class: 'ind-hero-val is-30' }, h('span', { class: 'cap' }, h('span', { class: 'tri tri-up' }), 'Moy. 30 j'),
          h('span', { class: 'big' }, h('b', { class: 'num' }, meta.fmt(ind.value30)[0]), meta.fmt(ind.value30)[1] ? h('small', null, meta.fmt(ind.value30)[1]) : null)) : null,
        h('div', { class: `ind-hero-impact ${ind.present ? impactCls(ind.delta) : 'is-zero'}` },
          h('span', { class: 'cap' }, 'Impact'),
          h('span', { class: 'big' }, h('b', { class: 'num' }, ind.present ? signed1(ind.delta) : '—'), h('small', null, ind.present ? yearWord(ind.delta) : 'non compté')))),
      h('div', { class: 'ind-hero-bar', 'aria-hidden': 'true' }, barViz(ind, ctx, { open: true, cap: capShort })),
      v ? h('h2', { class: 'ind-verdict' }, v.title) : null,
      h('p', { class: 'ind-text' }, v ? v.text : ind.reason ? `${capital(ind.reason)}.` : ''),
      finite(target) ? h('p', { class: 'ind-target' }, `Neutre pour ton profil : ${valText(id, target)}${ind.present && finite(ind.delta30) ? ` · impact sur 30 jours : ${signed1(ind.delta30)} ${yearWord(ind.delta30)}` : ''}.`) : null));
  }
  // Tendance hebdomadaire (un point par dimanche) : valeur moyenne sur 6 mois de l'indicateur.
  const curve = (r.curve ?? []).filter(p => finite(p.values?.[id]));
  if (curve.length >= 2) {
    const first = curve[0].key;
    const ys = curve.map(p => p.values[id]);
    const t = niceTicks(Math.min(...ys, finite(target) ? target : Infinity), Math.max(...ys, finite(target) ? target : -Infinity), 4);
    kids.push(h('section', { class: 'section', 'aria-labelledby': 'ind-trend' },
      secHead('Tendance hebdomadaire', 'ind-trend', false, finite(target) ? h('span', { class: 'sec-aside' }, 'pointillé : neutre') : null),
      h('div', { class: 'card chart-card' }, lineChart({
        xs: curve.map(p => dayDiff(first, p.key)), ys, yLo: t.lo, yHi: t.hi, yTicks: t.ticks,
        yFmt: x => (id === 'M1' ? `${nfx.format(x)} h` : id === 'M6' && x >= 1000 ? `${nfx.format(x / 1000)} k` : nfx.format(x)),
        ref: target, refCls: 'ref', lastText: valText(id, ys[ys.length - 1]), xLabels: monthLabels(first, curve[curve.length - 1].key),
        label: `${meta.name}, moyenne 6 mois chaque dimanche : de ${valText(id, ys[0])} à ${valText(id, ys[ys.length - 1])}`, cls: 'chart-ind',
      })),
      srTable(`${meta.name} chaque dimanche`, ['Dimanche', 'Moyenne 6 mois', 'Impact'], curve.map(p => [dayMonth(p.key), valText(id, p.values[id]), finite(p.deltas?.[id]) ? `${signed1(p.deltas[id])} an` : '—']))));
  }
  // Barème effectif pour le profil : impact en années selon la valeur.
  const scale = scaleOf(id, ctx);
  if (scale && !absent) kids.push(scaleSection(id, scale, ind, capShort));
  const lever = (r.levers ?? []).find(l => l.id === id && finite(l.gain) && l.gain > 0.05);
  if (lever) {
    kids.push(h('div', { class: 'card lever-card' }, h('span', { class: 'lever-icon' }, icon('spark')),
      h('p', null, h('b', null, `Et si : ${lever.label || LEVER_LABEL[id]}`), h('br'),
        `${finite(lever.from) && finite(lever.to) ? `${valText(id, lever.from)} → ${valText(id, lever.to)} : ` : ''}environ ${MINUS}${dec1(lever.gain)} ${yearWord(lever.gain)} d'âge bio (estimation).`)));
  }
  kids.push(h('section', { class: 'section', 'aria-labelledby': 'ind-how' }, secHead('Mesure', 'ind-how'),
    h('div', { class: 'card prose-card' },
      h('p', null, meta.what),
      h('p', { class: 'muted' }, `Source : ${meta.src}. Barèmes et méthode : `, h('a', { href: '#methode' }, 'Méthode'), '.'))));
  fill(view, kids);
}
function scaleSection(id, scale, ind, cap = 'Moy. 6 mois') {
  const meta = IND[id];
  const [lo, hi] = meta.range;
  const xsAll = [lo, ...scale.map(p => p[0]).filter(x => x > lo && x < hi), hi];
  const ys = xsAll.map(x => interp(scale, x));
  const yMax = Math.max(0.5, ...ys);
  const yMin = Math.min(-0.5, ...ys);
  const w = 340;
  const H = 170;
  const L = 40;
  const R = 14;
  const T = 12;
  const B = 26;
  const X = x => L + ((x - lo) / (hi - lo)) * (w - L - R);
  const Y = y => T + ((yMax - y) / (yMax - yMin)) * (H - T - B);
  const svg = s('svg', { class: 'chart chart-scale', viewBox: `0 0 ${w} ${H}`, role: 'img', 'aria-label': `Barème de ${meta.name} pour ton profil : ${scale.map(([x, y]) => `${meta.x(x)} donne ${signed1(y)} an`).join(' ; ')}`, focusable: 'false' });
  const yt = niceTicks(yMin, yMax, 4).ticks.filter(t => t >= yMin - 1e-9 && t <= yMax + 1e-9);
  for (const t of yt) {
    svg.append(s('line', { class: t === 0 ? 'ref ref-solid' : 'grid', x1: L, x2: w - R, y1: Y(t).toFixed(1), y2: Y(t).toFixed(1) }),
      s('text', { class: 'axis', x: L - 8, y: (Y(t) + 3.5).toFixed(1), 'text-anchor': 'end' }, signed1(t)));
  }
  const d = xsAll.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(ys[i]).toFixed(1)}`).join('');
  // Aire entre la courbe et 0 : ambre au-dessus (l'indicateur vieillit), vert en dessous (il rajeunit).
  const cid = `sc${++uid}`;
  const area = `${d}L${X(hi).toFixed(1)} ${Y(0).toFixed(1)}L${X(lo).toFixed(1)} ${Y(0).toFixed(1)}Z`;
  svg.append(s('defs', null,
    s('clipPath', { id: `${cid}p` }, s('rect', { x: L, y: T, width: w - L - R, height: Math.max(0, Y(0) - T) })),
    s('clipPath', { id: `${cid}n` }, s('rect', { x: L, y: Y(0), width: w - L - R, height: Math.max(0, H - B - Y(0)) }))),
  s('path', { class: 'area-bad', d: area, 'clip-path': `url(#${cid}p)` }),
  s('path', { class: 'area-good', d: area, 'clip-path': `url(#${cid}n)` }),
  s('path', { class: 'line', d }));
  const mark = (v, cls) => {
    if (!finite(v)) return;
    const x = clamp(v, lo, hi);
    svg.append(s('line', { class: `scale-mk ${cls}`, x1: X(x).toFixed(1), x2: X(x).toFixed(1), y1: T, y2: H - B }),
      s('circle', { class: `dot ${cls}`, cx: X(x).toFixed(1), cy: Y(interp(scale, x)).toFixed(1), r: 4 }));
  };
  mark(ind.value30, 'is-30');
  mark(ind.value6m, 'is-6m');
  svg.append(s('text', { class: 'axis', x: L, y: H - 6, 'text-anchor': 'start' }, meta.ends[0]), s('text', { class: 'axis', x: w - R, y: H - 6, 'text-anchor': 'end' }, meta.ends[1]));
  return h('section', { class: 'section', 'aria-labelledby': 'ind-scale' },
    secHead('Barème pour ton profil', 'ind-scale', false, h('span', { class: 'sec-aside' }, 'impact en années')),
    h('div', { class: 'card chart-card' }, svg,
      h('span', { class: 'chart-legend', 'aria-hidden': 'true' }, legendItem('lg-dot is-6m', cap), finite(ind.value30) && ind.present ? legendItem('lg-dot is-30', 'Moy. 30 j') : null)),
    note(`Points : ${scale.map(([x, y]) => `${meta.x(x)} → ${signed1(y)}`).join(' ; ')}. Constant au-delà.`));
}

// ================= Tendance (détail) =================

function renderTrend() {
  const curve = state.data.result.curve ?? [];
  const view = $('v-tendance');
  const head = topbar({ title: 'Tendance', sub: 'Un point par dimanche', back: true, right: infoBtn('rythme', 'Comprendre le rythme') });
  if (!curve.length) {
    view.replaceChildren(head, h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, icon('trend')), h('p', { class: 'empty-title' }, 'Pas encore de tendance'), h('p', { class: 'empty-text' }, 'La courbe démarre au premier dimanche où ton âge bio est débloqué.')));
    return;
  }
  const pc = paceChart(curve, { big: true });
  const ac = ageChart(curve, { big: true });
  const last = curve[curve.length - 1];
  const first = curve[0];
  const table = h('table', { class: 'data-table' },
    h('caption', { class: 'visually-hidden' }, 'Âge bio et rythme, un point par dimanche'),
    h('thead', null, h('tr', null, ['Dimanche', 'Âge bio', 'Écart', 'Rythme'].map(t => h('th', { scope: 'col' }, t)))),
    h('tbody', null, [...curve].reverse().map(p => h('tr', { class: p.calibrating ? 'is-calibrating' : '' },
      h('th', { scope: 'row' }, dayMonth(p.key)),
      h('td', { class: 'num' }, fmtAge(p.bio)),
      h('td', { class: `num ${impactCls(finite(p.gap) ? p.gap : p.bio - p.civil)}` }, signed1(finite(p.gap) ? p.gap : p.bio - p.civil)),
      h('td', { class: 'num' }, finite(p.pace) ? fmtPace(p.pace) : '—')))));
  fill(view, head,
    h('p', { class: 'page-lede' }, `${plural(curve.length, 'dimanche')} depuis le ${dayMonth(first.key)} : âge bio ${fmtAge(first.bio)} → ${fmtAge(last.bio)} ans.`),
    pc ? h('section', { class: 'section', 'aria-labelledby': 't-pace' }, secHead('Rythme de vieillissement', 't-pace'), h('div', { class: 'card chart-card' }, pc),
      note('Trait blanc : 1,0x, le rythme du temps. En dessous, ton âge bio avance moins vite que le calendrier.')) : null,
    ac ? h('section', { class: 'section', 'aria-labelledby': 't-age' }, secHead('Âge bio', 't-age'), h('div', { class: 'card chart-card' }, ac,
      h('span', { class: 'chart-legend', 'aria-hidden': 'true' }, legendItem('lg-line', 'Âge bio'), legendItem('lg-dash', 'Âge civil'), legendItem('lg-hollow', 'Calibrage')))) : null,
    h('section', { class: 'section', 'aria-labelledby': 't-table' }, secHead('Semaine par semaine', 't-table'),
      h('div', { class: 'card table-card' }, h('div', { class: 'scroll-x', tabindex: '0', role: 'region', 'aria-label': 'Tableau semaine par semaine' }, table),
        note('Lignes en gris : calibrage (moins de 90 jours valides dans la fenêtre).'))));
}

// ================= Prises de sang : suivi, saisie, sauvegarde =================

function renderBlood() {
  const list = blood.list;
  const kids = [
    topbar({ title: 'Prises de sang', sub: blood.demo ? 'Démonstration : rien n\'est gardé' : 'Gardées sur ce téléphone', back: true }),
    h('p', { class: 'page-lede' }, "Dans la mémoire de l'app, sur ce téléphone : jamais envoyées, jamais dans le Diagnostic. Les 9 analyses de ton âge bio, de la plus à la moins influente, dans les unités de ton compte rendu ; une prise de sang compte 12 mois."),
    h('a', { class: 'btn btn-primary btn-block', href: '#bilan/nouveau' }, icon('plus'), 'Ajouter une prise de sang'),
  ];
  if (list.length) {
    // Suivi : une ligne par analyse (par poids), une colonne par prise de sang (les 6 plus récentes).
    const cols = list.slice(0, 6);
    const rows = BLOOD_ORDER.filter(id => cols.some(c => c.valeurs[id] !== undefined));
    const table = h('table', { class: 'data-table blood-table' },
      h('caption', { class: 'visually-hidden' }, 'Valeurs de tes prises de sang, de la plus récente à la plus ancienne'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Analyse'), cols.map(c => h('th', { scope: 'col' }, dayMonthYear(c.date))))),
      h('tbody', null, rows.map(id => h('tr', null,
        h('th', { scope: 'row' }, IND[id].name, h('small', null, labUnit(id))),
        cols.map(c => h('td', null, c.valeurs[id] !== undefined ? labIn(id, c.valeurs[id]) : '—'))))));
    kids.push(
      rows.length ? h('section', { class: 'section', 'aria-labelledby': 'b-follow' },
        secHead('Suivi', 'b-follow'),
        h('div', { class: 'card table-card' }, h('div', { class: 'scroll-x', tabindex: '0', role: 'region', 'aria-label': 'Tableau des prises de sang' }, table))) : null,
      h('section', { class: 'section', 'aria-labelledby': 'b-list' }, secHead('Historique', 'b-list'),
        h('div', { class: 'card list' }, list.map(b => {
          const ids = BLOOD_ORDER.filter(id => b.valeurs[id] !== undefined);
          const covered = ids.reduce((a, id) => a + BLOOD_PARETO.get(id).pct, 0);
          return h('a', { class: 'list-row', href: `#bilan/${b.date}` }, h('span', { class: 'list-icon' }, icon('drop')),
            h('span', { class: 'list-main' }, h('span', { class: 'list-label' }, capital(dayMonthYear(b.date))),
              h('span', { class: 'list-sub' }, `${ids.length} analyse${ids.length > 1 ? 's' : ''} sur ${BLOOD_ORDER.length} · ${covered}${NBSP}% du poids`)),
            icon('next', 'list-chev'));
        }))));
  } else {
    kids.push(note('Aucune prise de sang pour l\'instant. Garde ton compte rendu sous la main : la saisie prend deux minutes.'));
  }
  kids.push(h('section', { class: 'section', 'aria-labelledby': 'b-save' }, secHead('Sauvegarde', 'b-save'),
    h('div', { class: 'card' },
      h('p', { class: 'card-text' }, "Effacer les données de Chrome ou désinstaller l'app efface tes prises de sang. Garde une copie dans un fichier, sur ton téléphone."),
      h('button', { class: 'btn btn-secondary', type: 'button', 'data-action': 'blood-export', disabled: !list.length }, icon('download'), 'Sauvegarder dans un fichier'),
      h('button', { class: 'btn btn-secondary', type: 'button', 'data-action': 'blood-import' }, icon('upload'), 'Restaurer un fichier'),
      note('Fichier dans Téléchargements. Ne le dépose jamais en ligne ni dans le dossier du site.'))));
  fill($('v-sang'), kids);
}

// Exemple d'une analyse dans chacune de ses unités, puis le piège de saisie :
// « Exemple : 5,4 mmol/L = 0,97 g/L = 97 mg/dL. »
function exampleLine(id) {
  const b = calc.bloodMarker(id);
  const show = x => `${labNum(id, x.ex, x.u)}${NBSP}${x.u}`;
  const same = b.units.filter(x => x.abs === undefined).map(show);
  const abs = b.units.filter(x => x.abs !== undefined).map(show);
  const l = calc.bloodMarker('leucocytes').units[0];
  const text = `Exemple : ${same.join(' = ')}${abs.length ? ` ; en nombre, environ ${abs.join(' = ')} (avec ${show(l)} de leucocytes)` : ''}.`;
  return b.tip ? `${text} ${capital(b.tip)}.` : text;
}
const placeholderOf = (id, u) => `ex. ${labNum(id, unitInfo(id, u).ex, u)}`;

// Saisie : date, puis les 9 analyses de l'âge bio (toutes facultatives), de la plus à la moins influente : une case
// vide en haut de liste, c'est l'analyse à demander en priorité. Chaque valeur se saisit dans l'unité du compte rendu
// (choix mémorisé) ; une valeur qui n'a de sens que dans une autre unité fait basculer l'unité, avec un message.
function renderBilanForm(param) {
  const editing = param === 'nouveau' ? null : blood.list.find(b => b.date === param) ?? null;
  const today = clock.dayKey(Date.now());
  const stored = editing?.valeurs ?? {};
  const leuco0 = calc.parseLab(stored.leucocytes)?.v ?? null;
  const switched = new Map();   // unités basculées d'elles-mêmes : id → { to, text }
  const manual = new Set();     // unités choisies à la main pendant cette saisie
  // Unité de départ : la dernière choisie ; un nombre de lymphocytes sans leucocytes dans ce bilan : le %.
  const startUnit = id => {
    const u = entryUnit(id);
    return unitInfo(id, u).abs !== undefined && stored[id] !== undefined && !(leuco0 > 0) ? calc.refUnit(id) : u;
  };
  const field = id => {
    const b = calc.bloodMarker(id);
    const w = BLOOD_PARETO.get(id);
    const u0 = startUnit(id);
    const text0 = stored[id] !== undefined ? labIn(id, stored[id], u0, { leucocytes: leuco0 }).replace(NBSP, ' ') : '';
    const units = b.units.length > 1
      ? h('span', { class: 'units', role: 'radiogroup', 'aria-label': `Unité de ${inSentence(b.label)}` },
        b.units.map(x => h('label', { class: 'unit-opt' },
          h('input', { type: 'radio', name: `u-${id}`, value: x.u, checked: x.u === u0 }),
          h('span', null, x.u))))
      : h('span', { class: 'field-unit' }, b.units[0].u);
    return h('div', { class: 'field bf', 'data-id': id },
      h('div', { class: 'bf-head' },
        h('span', { class: 'bf-rank num', 'aria-hidden': 'true' }, w.rank),
        h('label', { class: 'bf-name', for: `f-${id}` }, b.label, h('span', { class: 'visually-hidden' }, `, poids ${w.pct} %`)),
        h('span', { class: 'bf-weight', 'aria-hidden': 'true' }, h('b', { class: 'num' }, `${w.pct}${NBSP}%`), h('small', null, `cumul ${w.cum}${NBSP}%`))),
      h('p', { class: 'bf-aka' }, b.aka),
      h('div', { class: 'field-box' },
        h('input', {
          class: 'field-input num', id: `f-${id}`, name: id, type: 'text', inputmode: b.text ? 'text' : 'decimal', autocomplete: 'off',
          autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'next', value: text0, 'data-initial': text0, 'data-unit0': u0,
          placeholder: placeholderOf(id, u0), 'aria-describedby': `x-${id} i-${id} e-${id}`,
        }),
        units),
      h('p', { class: 'bf-ex', id: `x-${id}` }, exampleLine(id)),
      h('p', { class: 'field-info', id: `i-${id}`, role: 'status', hidden: true }),
      h('p', { class: 'field-error', id: `e-${id}`, hidden: true }));
  };
  const form = h('form', { class: 'blood-form', novalidate: true },
    h('div', { class: 'card' },
      h('div', { class: 'field' },
        h('label', { class: 'field-label', for: 'f-date' }, 'Date du prélèvement'),
        h('span', { class: 'field-box' }, h('input', { class: 'field-input', id: 'f-date', name: 'date', type: 'date', required: true, max: today, value: editing?.date ?? today, 'aria-describedby': 'e-date' })),
        h('p', { class: 'field-error', id: 'e-date', hidden: true }))),
    note(`Les 9 analyses de ton âge bio, de la plus à la moins influente. Poids : part de l'analyse dans les écarts d'âge bio dus à la prise de sang ; les 3 premières font ${BLOOD_PARETO.get(BLOOD_ORDER[2]).cum}${NBSP}%. Remplis ce qui figure sur ton compte rendu, dans son unité : une case vide en haut de liste, c'est l'analyse à demander en priorité au prochain bilan.`),
    h('div', { class: 'card field-set', role: 'group', 'aria-labelledby': 'fs-blood' },
      h('p', { class: 'card-title', id: 'fs-blood' }, 'Analyses, par poids'),
      BLOOD_ORDER.map(field)),
    h('p', { class: 'field-error form-error', id: 'e-form', hidden: true }),
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Enregistrer'),
    editing ? h('button', { class: 'btn btn-danger btn-block', type: 'button', 'data-action': 'blood-delete' }, 'Supprimer cette prise de sang') : null);

  const unitSel = id => form.querySelector(`input[name="u-${id}"]:checked`)?.value ?? calc.refUnit(id);
  const setUnit = (id, u) => {
    for (const r of form.querySelectorAll(`input[name="u-${id}"]`)) r.checked = r.value === u;
    $(`f-${id}`).placeholder = placeholderOf(id, u);
  };
  // Leucocytes saisis, dans l'unité du modèle : un nombre de lymphocytes se ramène en % avec eux.
  const leucoNow = () => {
    const p = calc.parseLab(form.elements.namedItem('leucocytes').value);
    return p ? calc.labToRef('leucocytes', p.v, unitSel('leucocytes')) : null;
  };
  // Valeur dans une unité improbable : bascule vers la seule unité où elle a du sens.
  const autoUnit = id => {
    const text = $(`f-${id}`).value.trim();
    const alt = text && !manual.has(id) ? calc.guessLabUnit(id, text, unitSel(id), { leucocytes: leucoNow() }) : null;
    if (alt) {
      setUnit(id, alt);
      switched.set(id, { to: alt, text });
    } else if (!text || switched.get(id)?.text !== text) switched.delete(id);
  };
  // Message sous la case : unité basculée ; lymphocytes en nombre : le % calculé.
  const refresh = id => {
    const msgs = [];
    const s = switched.get(id);
    if (s) msgs.push(`${s.text} ressemble à des ${s.to} : unité changée.`);
    if (id === 'lymphocytes' && unitInfo(id, unitSel(id)).abs !== undefined) {
      const p = calc.parseLab($(`f-${id}`).value);
      const l = leucoNow();
      const v = p && l ? calc.labToRef(id, p.v, unitSel(id), { leucocytes: l }) : null;
      if (p) msgs.push(v !== null ? `Soit ${labNum(id, v, '%')}${NBSP}% des leucocytes.` : 'Saisis aussi les leucocytes : le % se calcule avec eux.');
    }
    const el = $(`i-${id}`);
    el.textContent = msgs.join(' ');
    el.hidden = !msgs.length;
  };
  const clearError = id => {
    $(`e-${id}`).hidden = true;
    $(`f-${id}`).removeAttribute('aria-invalid');
  };
  form.addEventListener('change', e => {
    const id = e.target.closest('.bf')?.dataset.id;
    if (!id) return;
    if (e.target.type === 'radio') {
      manual.add(id);
      switched.delete(id);
      setUnit(id, e.target.value);
    } else autoUnit(id);
    clearError(id);
    refresh(id);
    if (id === 'leucocytes') {
      autoUnit('lymphocytes');
      refresh('lymphocytes');
    }
  });
  form.addEventListener('input', e => {
    const id = e.target.closest('.bf')?.dataset.id;
    if (id === 'lymphocytes' || id === 'leucocytes') refresh('lymphocytes');
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    saveBilan(form, editing, { unitSel, switched });
  });
  fill($('v-bilan'),
    topbar({ title: editing ? 'Prise de sang' : 'Nouvelle prise de sang', sub: editing ? dayMonthYear(editing.date) : 'Gardée sur ce téléphone', back: true }),
    form);
}
function saveBilan(form, editing, { unitSel, switched }) {
  const errs = new Map();
  const today = clock.dayKey(Date.now());
  const date = form.elements.namedItem('date').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) errs.set('date', 'Choisis la date du prélèvement, aujourd\'hui ou avant.');
  else if (blood.list.some(b => b.date === date && b !== editing)) errs.set('date', "Une prise de sang existe déjà à cette date : ouvre-la depuis l'historique.");
  const valeurs = {};
  const used = new Set();   // analyses saisies ou modifiées : leur unité devient la préférée
  const ctx = {};
  const same = id => {
    const input = form.elements.namedItem(id);
    return input.value.trim() === input.dataset.initial && unitSel(id) === input.dataset.unit0;
  };
  // Leucocytes d'abord : un nombre de lymphocytes se ramène en % avec eux.
  for (const id of ['leucocytes', ...BLOOD_ORDER.filter(x => x !== 'leucocytes')]) {
    const text = form.elements.namedItem(id).value.trim();
    if (!text) continue;
    const abs = unitInfo(id, unitSel(id)).abs !== undefined;
    if (editing?.valeurs[id] !== undefined && same(id) && (!abs || same('leucocytes'))) {
      valeurs[id] = editing.valeurs[id];   // inchangée : valeur gardée telle quelle (l'affichage arrondit)
    } else {
      const r = calc.checkLab(id, text, unitSel(id), ctx);
      if (r.error) {
        errs.set(id, r.error);
        continue;
      }
      valeurs[id] = r.value;
      used.add(id);
    }
    if (id === 'leucocytes') ctx.leucocytes = calc.parseLab(valeurs[id])?.v;
  }
  if (!errs.size && !Object.keys(valeurs).length) errs.set('form', 'Saisis au moins une valeur.');
  for (const el of form.querySelectorAll('.field-error')) el.hidden = true;
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  if (errs.size) {
    for (const [id, msg] of errs) {
      const el = $(`e-${id}`);
      el.textContent = msg;
      el.hidden = false;
      $(`f-${id}`)?.setAttribute('aria-invalid', 'true');
    }
    const first = [...errs.keys()][0];
    if (first === 'form') $('e-form').scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' });
    else $(`f-${first}`).focus();
    toast(errs.size > 1 ? `${errs.size} champs à corriger.` : 'Un champ à corriger.', true);
    return;
  }
  // Analyses retirées de l'app (CONFIG.BLOOD_KEPT) : valeurs déjà saisies gardées telles quelles.
  const kept = Object.fromEntries(Object.entries(editing?.valeurs ?? {}).filter(([id]) => !calc.bloodMarker(id)));
  blood.list = calc.cleanBilans([...blood.list.filter(b => b !== editing), { date, valeurs: { ...kept, ...valeurs } }]);
  for (const id of used) blood.units[id] = unitSel(id);
  const saved = bloodSave();
  bloodChanged();
  const fixed = [...switched].filter(([id, s]) => used.has(id) && unitSel(id) === s.to).map(([id, s]) => `${IND[id].short} en ${s.to}`);
  const msg = !saved ? "Gardée jusqu'à la fermeture de l'app : le navigateur refuse l'enregistrement." : blood.demo ? "Démo : gardée jusqu'à la fermeture de l'app." : 'Prise de sang enregistrée sur ce téléphone.';
  toast(`${msg}${fixed.length ? ` Unité corrigée : ${joinFr(fixed)}.` : ''}`, !saved);
  goBack('#sang');
}
function deleteBilan(date) {
  const b = blood.list.find(x => x.date === date);
  if (!b || !confirm(`Supprimer la prise de sang du ${dayMonthYear(date)} de ce téléphone ?`)) return;
  blood.list = blood.list.filter(x => x !== b);
  const saved = bloodSave();
  bloodChanged();
  toast(saved ? 'Prise de sang supprimée.' : "Suppression perdue à la fermeture : le navigateur refuse l'enregistrement.", !saved);
  goBack('#sang');
}
// Sauvegarde : fichier JSON téléchargé sur le téléphone (rien n'est envoyé).
function bloodExport() {
  if (!blood.list.length) return;
  const json = JSON.stringify({ app: 'Âge bio', v: 1, bilans: blood.list, unites: blood.units }, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = h('a', { href: url, download: `prises-de-sang-${clock.dayKey(Date.now())}.json`, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast('Sauvegarde enregistrée dans Téléchargements, sur ce téléphone.');
}
// Restauration : ajoute les prises de sang du fichier (même date : celle du fichier l'emporte).
async function bloodImport(file) {
  try {
    if (file.size > 1e6) throw new Error('fichier trop gros');
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw new Error('fichier illisible'); }
    const incoming = calc.cleanBilans(Array.isArray(data) ? data : data?.bilans);
    if (!incoming.length) throw new Error('aucune prise de sang lisible dans ce fichier');
    const byDate = new Map(blood.list.map(b => [b.date, b]));
    for (const b of incoming) byDate.set(b.date, b);
    blood.list = calc.cleanBilans([...byDate.values()]);
    blood.units = { ...blood.units, ...cleanUnits(data?.unites) };
    const saved = bloodSave();
    bloodChanged();
    if (route?.screen === 'sang') renderBlood();
    toast(saved ? `${plural(incoming.length, 'prise de sang restaurée', 'prises de sang restaurées')}.` : "Restaurées jusqu'à la fermeture de l'app : le navigateur refuse l'enregistrement.", !saved);
  } catch (e) {
    toast(`Restauration impossible : ${e?.message ?? e}.`, true);
  }
}

// ================= Plus, Méthode, Diagnostic =================

function renderPlus() {
  const d = state.data;
  const r = d.result;
  const profile = describeProfile(d.profile ?? state.diagProfile, clock);
  const row = (href, iconName, label, sub, attrs = {}) => h('a', { class: 'list-row', href, ...attrs },
    h('span', { class: 'list-icon' }, icon(iconName)),
    h('span', { class: 'list-main' }, h('span', { class: 'list-label' }, label), sub ? h('span', { class: 'list-sub' }, sub) : null),
    icon('next', 'list-chev'));
  const period = r.firstKey && r.lastKey ? `Du ${clock.date(utc(r.firstKey) + 43200000)} au ${clock.date(utc(r.lastKey) + 43200000)}` : '—';
  $('v-plus').replaceChildren(
    topbar({ title: 'Plus' }),
    h('section', { class: 'section', 'aria-labelledby': 'p-sync' }, secHead('Synchronisation', 'p-sync'),
      h('div', { class: 'card' },
        kvList([
          ['Synchronisé', `${capital(agoText(Date.now() - state.loadedAt))}${DEMO !== null ? ' (démonstration)' : ''}`],
          ['Dernière donnée', d.lastDataMs ? clock.dateTime(d.lastDataMs) : '—'],
          ['Période', period],
          ['Jours valides', int(r.validDays ?? 0)],
          ['Nuits valides', int(r.validNights ?? 0)],
        ]),
        staleBanner(),
        h('button', { class: 'btn btn-secondary', type: 'button', 'data-action': 'pick' }, icon('upload'), 'Charger un autre export'))),
    h('section', { class: 'section', 'aria-labelledby': 'p-blood' }, secHead('Prise de sang', 'p-blood'),
      h('div', { class: 'card list' },
        row('#sang', 'drop', 'Prises de sang', blood.list.length
          ? `${plural(blood.list.length, 'enregistrée', 'enregistrées')} · gardées sur ce téléphone`
          : 'Ajoute ton dernier bilan · gardé sur ce téléphone'))),
    h('section', { class: 'section', 'aria-labelledby': 'p-profile' }, secHead('Profil', 'p-profile'),
      h('details', { class: `card profile${profile.alert ? ' is-warn' : ''}` },
        h('summary', null, h('span', { class: 'list-icon' }, icon('lock')),
          h('span', { class: 'list-main' }, h('span', { class: 'list-label' }, profile.title), h('span', { class: 'list-sub' }, 'Privé · affiché sur ce téléphone seulement')),
          icon('down', 'list-chev')),
        h('div', { class: 'profile-body' },
          profile.alert ? h('p', { class: 'alert' }, profile.alert) : null,
          h('dl', { class: 'kv' }, profile.items.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
          note('Jamais copié avec le diagnostic. Se corrige dans Gadgetbridge → Paramètres → À propos de vous, puis nouvel export.')))),
    h('section', { class: 'section', 'aria-labelledby': 'p-learn' }, secHead('Comprendre', 'p-learn'),
      h('div', { class: 'card list' },
        row('#methode', 'doc', 'Méthode et barèmes', 'Calcul, cadence, sources'),
        h('button', { class: 'list-row', type: 'button', 'data-sheet': 'age' }, h('span', { class: 'list-icon' }, icon('orb')),
          h('span', { class: 'list-main' }, h('span', { class: 'list-label' }, "L'âge bio"), h('span', { class: 'list-sub' }, 'Provisoire, officiel, calibrage')), icon('next', 'list-chev')),
        h('button', { class: 'list-row', type: 'button', 'data-sheet': 'rythme' }, h('span', { class: 'list-icon' }, icon('trend')),
          h('span', { class: 'list-main' }, h('span', { class: 'list-label' }, 'Le rythme de vieillissement'), h('span', { class: 'list-sub' }, 'De −1,0x à 3,0x')), icon('next', 'list-chev')))),
    h('section', { class: 'section', 'aria-labelledby': 'p-help' }, secHead('Aide', 'p-help'),
      h('div', { class: 'card list' },
        row('#diagnostic', 'pulse', 'Diagnostic', 'Structure de l\'export, à transmettre tel quel'),
        h('div', { class: 'list-row is-static' }, h('span', { class: 'list-icon' }, icon('play')),
          h('span', { class: 'list-main' }, h('span', { class: 'list-label' }, 'Démonstration'),
            h('span', { class: 'list-sub demo-links' }, h('a', { href: '?demo' }, 'complète'), ' · ', h('a', { href: '?demo=nouveau' }, 'nouveau'), ' · ', h('a', { href: '?demo=pause' }, 'en pause')))))),
    h('footer', { class: 'app-foot' },
      h('p', null, `Âge bio ${APP_VERSION} · calculé sur cet appareil, rien n'est envoyé.`)));
}
function renderMethod() {
  const age = finite(state.data?.result?.civil) ? state.data.result.civil : 40;
  const ctx = ctxAt(age);
  const g = profileGender();
  $('method-ctx').textContent = state.data && finite(state.data.result?.civil)
    ? `Barèmes effectifs pour ton profil (${int(Math.floor(age))} ans${g === 0 ? ', femme' : g === 1 ? ', homme' : ''}) : interpolation linéaire entre les points, valeur constante au-delà.`
    : 'Barèmes pour un profil de référence de 40 ans : interpolation linéaire entre les points, valeur constante au-delà.';
  $('method-scales').replaceChildren(...IDS.map(id => {
    const meta = IND[id];
    const sc = scaleOf(id, ctx);
    const t = targetOf(id, ctx);
    const text = sc ? sc.map(([x, y]) => `${meta.x(x)} → ${signed1(y)}`).join(' ; ') : 'barème indisponible sans date de naissance';
    return h('li', null, h('strong', null, `${id} ${meta.name}`), ` : ${text}.`, finite(t) ? ` Neutre : ${valText(id, t)}.` : '', ' ', h('span', { class: 'muted' }, meta.src));
  }));
  // Prise de sang : poids, barème (coefficient PhenoAge, neutre NHANES IV, bornes) et unités de chaque analyse, du plus
  // au moins influent ; valeurs dans l'unité du modèle, conversions à la suite.
  const coefFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });
  const convFmt = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 4 });
  const refText = (id, v) => `${labNum(id, v, calc.refUnit(id))}${NBSP}${calc.refUnit(id)}`;
  const unitsText = id => {
    const us = calc.bloodMarker(id).units;
    const ref = us[0].u;
    const conv = us.slice(1).filter(x => x.abs === undefined)
      .map(x => (x.k >= 1 ? `1 ${x.u} = ${convFmt.format(x.k)} ${ref}` : `1 ${ref} = ${convFmt.format(1 / x.k)} ${x.u}`));
    const abs = us.some(x => x.abs !== undefined) ? ` ; en nombre (${us.filter(x => x.abs !== undefined).map(x => x.u).join(', ')}), % = lymphocytes ÷ leucocytes × 100` : '';
    return `${us.map(x => x.u).join(', ')}${conv.length ? ` (${conv.join(' ; ')})` : ''}${abs}`;
  };
  $('method-blood').replaceChildren(...BLOOD_ORDER.map(id => {
    const c = calc.bloodMarker(id).counted;
    const w = BLOOD_PARETO.get(id);
    const sc = scaleOf(id, ctx);
    const text = sc ? sc.map(([x, y]) => `${refText(id, x)} → ${signed1(y)}`).join(' ; ') : '';
    const per = c.log ? 'par unité de ln(CRP)' : `par ${calc.refUnit(id)}`;
    return h('li', null, h('strong', null, `${w.rank}. ${IND[id].name}`), ` (poids ${w.pct}${NBSP}%, cumul ${w.cum}${NBSP}% ; ${calc.CONFIG.BLOOD_SYSTEMS[c.system].toLowerCase()}) : ${text}. Neutre : ${refText(id, c.neutral)} ; coefficient ${coefFmt.format(c.coef).replace('-', MINUS)} ${per}. Unités : ${unitsText(id)}.`);
  }));
  const version = calc.CONFIG?.METHOD_VERSION ?? calc.CONFIG?.VERSION ?? null;
  $('method-version').textContent = `Âge bio ${APP_VERSION}${version ? ` · méthode ${version}` : ''} · constantes et sources dans CONFIG (calc.js).`;
}
function renderDiag() {
  $('diag-text').textContent = state.diagText || 'Aucun export chargé.';
  $('copy').disabled = !state.diagText;
}
async function copyDiagnostic() {
  const pre = $('diag-text');
  try {
    await navigator.clipboard.writeText(pre.textContent);
    toast('Diagnostic copié : colle-le dans la conversation.');
  } catch {
    const range = document.createRange();
    range.selectNodeContents(pre);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast('Copie automatique impossible : le texte est sélectionné, copie-le à la main.');
  }
}

// ================= Fiches (feuille du bas) =================

const SHEETS = {
  age: () => {
    const r = state.data?.result;
    const off = r?.official;
    const p = off ? null : r?.provisional;
    const kids = [h('p', null, "Ton âge bio estime l'âge de ton corps d'après 8 indicateurs de sommeil, d'activité et de forme mesurés par ton bracelet, et d'après ta dernière prise de sang si tu l'as saisie. Chacun ajoute ou retire des années à ton âge civil.")];
    if (off) {
      kids.push(kvList([
        ['Âge bio', `${fmtAge(off.bio)} ans`], ['Âge civil', `${nf1.format(round1(off.civil))} ans`], ['Écart', `${signed1(off.gap)} ${yearWord(off.gap)}`],
        ...(finite(off.interval?.lo) ? [['Intervalle à 95 %', `${fmtAge(off.interval.lo)} à ${fmtAge(off.interval.hi)} ans`]] : []),
        ...(finite(off.reliability?.score) ? [['Fiabilité', relText(off.reliability.score)]] : []),
        ['Calculé le', longDay(off.key)], ['Jours valides', `${int(off.validDays ?? 0)} sur 182`],
      ]));
    } else if (p) {
      kids.push(kvList([
        ['Âge bio provisoire', `${fmtAge(p.bio)} ans`], ['Âge civil', `${nf1.format(round1(p.civil))} ans`], ['Écart', `${signed1(p.gap)} ${yearWord(p.gap)}`],
        ['Fiabilité', relText(p.reliability?.score)], ['Calculé le', longDay(p.key)],
      ]));
    }
    kids.push(h('h3', null, 'Provisoire'),
      h('p', null, "Avant la valeur officielle, ton âge bio est calculé chaque jour sur tes données disponibles ; la fiabilité dit à quel point il peut encore bouger."),
      h('h3', null, 'Officiel, chaque dimanche'),
      h('p', null, 'Dès 21 nuits valides sur les 31 derniers jours ; en dessous, il se met en pause. Pendant les 90 premiers jours valides (calibrage), il bouge davantage. L\'aperçu du jour annonce la valeur de dimanche.'),
      linkCta('Méthode complète', '#methode'));
    return { title: "L'âge bio", kids };
  },
  apercu: () => SHEETS.age(),
  fiabilite: () => {
    const r = state.data?.result;
    const src = r?.official ?? r?.provisional ?? null;
    const rel = src?.reliability ?? null;
    const row = (v, t) => h('li', null, h('b', { class: 'num' }, v), h('span', null, t));
    const kids = [];
    if (finite(rel?.score)) {
      // Indicateurs continus pas encore mesurés (ils comptent 0 dans la fiabilité).
      const pending = (calc.CONFIG?.RELIABILITY_IDS ?? [])
        .filter(id => !src.indicators?.find(x => x.id === id)?.present)
        .map(id => IND[id].name.replace(/ \(.*\)$/, '').toLowerCase());
      kids.push(h('div', { class: 'rel-head' },
        h('span', { class: 'dial-ring rel-ring', role: 'img', 'aria-label': `Fiabilité ${relText(rel.score)}` }, ring(92, 6, rel.score),
          h('span', { class: 'dial-val', 'aria-hidden': 'true' }, h('b', { class: 'num' }, int(relPct(rel.score))), h('small', null, '%'))),
        kvList([
          ['Valeur', r.official ? 'officielle' : 'provisoire'],
          ['Nuits valides', int(rel.validNights ?? 0)],
          ['Jours valides', int(rel.validDays ?? 0)],
          ['Indicateurs', `${int(rel.measured ?? 0)} sur ${int(rel.of ?? 6)}`],
        ])),
      pending.length ? h('p', { class: 'note' }, `Pas encore mesurés : ${pending.join(', ')}.`) : null);
    }
    kids.push(
      h('p', null, "Quantité de données derrière ton âge bio : plus elle est basse, plus la valeur peut bouger."),
      h('ul', { class: 'scale-list' },
        row('≈ 4 %', 'première nuit'),
        row('≈ 28 %', 'une semaine'),
        row('≈ 48 %', '21 nuits : valeur officielle'),
        row('100 %', '90 jours')),
      linkCta('Méthode complète', '#methode'));
    return { title: 'Fiabilité', kids };
  },
  rythme: () => {
    const off = state.data?.result?.official;
    const soon = (state.data?.result?.upcoming ?? []).find(u => u.id === 'pace');
    const row = (v, t) => h('li', null, h('b', { class: 'num' }, v), h('span', null, t));
    return {
      title: 'Rythme de vieillissement',
      kids: [
        soon ? h('p', { class: 'notice' }, `Disponible le ${dayMonth(soon.date)} : il faut plus de 30 jours de données pour comparer tes 30 derniers jours au reste.`) : null,
        h('p', null, 'Le rythme compare tes 30 derniers jours à tes 6 derniers mois. Il dit à quelle vitesse ton âge bio avancerait si tes habitudes récentes duraient six mois.'),
        h('ul', { class: 'scale-list' },
          row(`${MINUS}1,0x`, 'ou moins : ton âge bio baisse nettement'),
          row('0,0x', 'ton âge bio reste stable, même si le temps passe'),
          row('1,0x', 'il avance au rythme du temps'),
          row('2,0x', 'ou plus : il avance plus vite que le temps')),
        h('h3', null, 'Calcul'),
        h('p', null, `Rythme = 1 + 2 × (écart sur 30 jours − écart sur 182 jours), borné de ${MINUS}1 à 3.`),
        off && finite(off.pace?.g30) && finite(off.pace?.g182)
          ? statGrid([['Écart 30 j', `${signed1(off.pace.g30)} an`], ['Écart 182 j', `${signed1(off.pace.g182)} an`], ['Rythme', fmtPace(off.pace.value)]])
          : null,
        state.data?.result?.curve?.length ? linkCta('Voir la tendance', '#tendance') : null,
      ],
    };
  },
  sommeil: () => ({
    title: 'Scores de sommeil',
    kids: [
      h('p', null, 'Performance = durée de la nuit ÷ besoin de 8 h. Régularité : écart de tes heures de coucher et de lever avec les 4 nuits précédentes.'),
      h('ul', { class: 'scale-list' },
        h('li', null, h('b', null, 'Performance'), h('span', null, 'faible < 70 % · optimale ≥ 85 %')),
        h('li', null, h('b', null, 'Régularité'), h('span', null, 'faible < 70 % · optimale ≥ 85 %'))),
      h('p', null, 'Durée : du coucher au lever, éveils compris (le bracelet ne transmet pas le détail). Une nuit compte à partir de 3 h.'),
      linkCta('Méthode complète', '#methode'),
    ],
  }),
};
for (const id of IDS) {
  SHEETS[id] = () => {
    const meta = IND[id];
    const off = state.data?.result?.official ?? state.data?.result?.provisional;
    const ind = off?.indicators?.find(x => x.id === id);
    const ctx = ctxAt(finite(off?.civil) ? off.civil : 40);
    const sc = scaleOf(id, ctx);
    const t = targetOf(id, ctx);
    return {
      title: meta.name,
      kids: [
        h('p', null, meta.what),
        ind?.reason && !ind.present ? h('p', { class: 'notice' }, ind.estimated ? `${capital(ind.reason)}.` : absentText(ind)) : null,
        finite(t) ? h('p', null, `Neutre pour ton profil (impact nul) : ${valText(id, t)}.`) : null,
        sc ? [h('h3', null, 'Barème'), h('ul', { class: 'scale-list' }, sc.map(([x, y]) => h('li', null, h('b', { class: 'num' }, meta.x(x)), h('span', { class: impactCls(y) }, `${signed1(y)} ${yearWord(y)}`))))] : null,
        h('p', { class: 'muted' }, `Source : ${meta.src}.`),
        linkCta('Voir le détail', `#indicateur/${id}`),
      ],
    };
  };
}
let sheetOpen = null;
let sheetReturn = null;
function openSheet(id) {
  const make = SHEETS[id];
  if (!make) return;
  const { title, kids } = make();
  $('sheet-title').textContent = title;
  $('sheet-body').replaceChildren(...[kids].flat(Infinity).filter(Boolean));
  $('sheet-body').scrollTop = 0;
  const root = $('sheet-root');
  if (!sheetOpen) sheetReturn = document.activeElement;
  sheetOpen = id;
  root.hidden = false;
  for (const el of [$('main'), $('tabbar'), $('demo-banner')]) el.inert = true;
  document.documentElement.classList.add('has-sheet');
  requestAnimationFrame(() => root.classList.add('is-open'));
  $('sheet').focus({ preventScroll: true });
}
function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = null;
  const root = $('sheet-root');
  root.classList.remove('is-open');
  $('sheet').style.transform = '';
  for (const el of [$('main'), $('tabbar'), $('demo-banner')]) el.inert = false;
  document.documentElement.classList.remove('has-sheet');
  setTimeout(() => { if (!sheetOpen) root.hidden = true; }, calm() ? 0 : 280);
  if (sheetReturn && document.contains(sheetReturn)) sheetReturn.focus({ preventScroll: true });
  sheetReturn = null;
}
// Glisser la feuille vers le bas pour la fermer.
function wireSheetDrag() {
  const sheet = $('sheet');
  let y0 = null;
  let dy = 0;
  const start = e => {
    if (!e.target.closest('.sheet-grip, .sheet-head') || e.target.closest('button')) return;
    y0 = e.clientY;
    dy = 0;
    sheet.classList.add('is-dragging');
    sheet.setPointerCapture?.(e.pointerId);
  };
  const move = e => {
    if (y0 === null) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (y0 === null) return;
    y0 = null;
    sheet.classList.remove('is-dragging');
    if (dy > 90) closeSheetNav();
    else sheet.style.transform = '';
  };
  sheet.addEventListener('pointerdown', start);
  sheet.addEventListener('pointermove', move);
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

// ================= Navigation (routes par hash, History API) =================

const SCREENS = ['synchro', 'aujourdhui', 'age', 'plus', 'indicateur', 'sommeil', 'tendance', 'methode', 'diagnostic', 'sang', 'bilan'];
const TABS = ['aujourdhui', 'age', 'plus'];
const PARENT = { indicateur: 'age', sommeil: 'aujourdhui', tendance: 'age', methode: 'plus', diagnostic: 'plus', sang: 'plus', bilan: 'sang' };
const scrollMemo = new Map();
let route = null;
let depthShown = 0;
let pendingHash = '';

const safeDecode = t => {
  try { return decodeURIComponent(t); } catch { return t; }
};
function parseHash(hash) {
  const raw = safeDecode(String(hash || '').replace(/^#/, ''));
  const [path, q = ''] = raw.split('?');
  const [screen = '', param = ''] = path.split('/');
  return { screen, param, sheet: new URLSearchParams(q).get('fiche') };
}
function resolve({ screen, param, sheet }) {
  let sc = SCREENS.includes(screen) ? screen : state.data ? 'age' : 'synchro';
  if (!state.data && sc !== 'synchro' && sc !== 'methode' && !(sc === 'diagnostic' && state.diagText)) sc = 'synchro';
  if (state.data && sc === 'synchro' && !state.busy && !state.error) sc = 'age';
  let p = '';
  if (sc === 'indicateur') {
    p = IDS.includes(String(param).toUpperCase()) ? String(param).toUpperCase() : '';
    if (!p) sc = 'age';
  }
  if (sc === 'bilan') {
    p = param === 'nouveau' || blood.list.some(b => b.date === param) ? param : '';
    if (!p) sc = 'sang';
  }
  let sh = sheet && SHEETS[sheet] ? sheet : null;
  if (sh && !state.data && sh !== 'rythme' && sh !== 'sommeil') sh = null;
  return { screen: sc, param: p, sheet: sh, key: `${sc}/${p}` };
}
const hashOf = r => `#${r.screen}${r.param ? `/${r.param}` : ''}${r.sheet ? `?fiche=${r.sheet}` : ''}`;
function go(hash, { replace = false } = {}) {
  const depth = history.state?.depth ?? 0;
  if (replace) history.replaceState({ depth }, '', hash);
  else history.pushState({ depth: depth + 1 }, '', hash);
  syncRoute();
}
function goBack(fallback) {
  if ((history.state?.depth ?? 0) > 0) history.back();
  else go(fallback, { replace: true });
}
function closeSheetNav() {
  if (!route?.sheet) return closeSheet();
  goBack(hashOf({ ...route, sheet: null }));
}
function syncRoute({ dir: forced = null } = {}) {
  const want = resolve(parseHash(location.hash));
  const wantHash = hashOf(want);
  if (safeDecode(location.hash) !== wantHash) history.replaceState({ depth: history.state?.depth ?? 0 }, '', wantHash);
  const depth = history.state?.depth ?? 0;
  const dir = forced ?? (!route ? 'none' : depth > depthShown ? 'push' : depth < depthShown ? 'pop' : 'fade');
  depthShown = depth;
  if (!route || route.key !== want.key) showScreen(want, route, dir);
  if (want.sheet !== (route?.sheet ?? null) || (want.sheet && sheetOpen !== want.sheet)) {
    if (want.sheet) openSheet(want.sheet);
    else closeSheet();
  }
  route = want;
}
const viewOf = screen => $(`v-${screen}`);
function renderScreen(r) {
  if (!state.data && r.screen !== 'methode' && r.screen !== 'diagnostic') return;
  switch (r.screen) {
    case 'indicateur': renderIndicator(r.param); break;
    case 'sommeil': renderSleep(); break;
    case 'tendance': renderTrend(); break;
    case 'methode': renderMethod(); break;
    case 'diagnostic': renderDiag(); break;
    case 'sang': renderBlood(); break;
    case 'bilan': renderBilanForm(r.param); break;
    default: break;
  }
}
let finishMove = null;
function showScreen(next, prev, dir) {
  finishMove?.();
  const toEl = viewOf(next.screen);
  const fromEl = prev ? viewOf(prev.screen) : [...document.querySelectorAll('.view')].find(v => !v.hidden && v !== toEl) ?? null;
  renderScreen(next);
  if (prev) scrollMemo.set(prev.key, scrollY);
  const body = document.body;
  body.dataset.screen = next.screen;
  body.classList.toggle('has-tabs', TABS.includes(next.screen));
  $('tabbar').hidden = !state.data;
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.tab === next.screen) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (next.screen !== 'age') $('compact').classList.remove('is-on');
  const y = TABS.includes(next.screen) ? scrollMemo.get(next.key) ?? 0 : 0;
  if (fromEl === toEl || !fromEl || dir === 'none' || calm()) {
    if (fromEl && fromEl !== toEl) fromEl.hidden = true;
    toEl.hidden = false;
    scrollTo(0, y);
  } else {
    const y0 = scrollY;
    const html = document.documentElement;
    html.classList.add('is-moving');
    fromEl.classList.add('is-frozen', `out-${dir}`);
    fromEl.style.top = `${-y0}px`;
    toEl.hidden = false;
    toEl.classList.add(`in-${dir}`);
    scrollTo(0, y);
    let done = false;
    finishMove = () => {
      if (done) return;
      done = true;
      finishMove = null;
      fromEl.hidden = true;
      fromEl.classList.remove('is-frozen', `out-${dir}`);
      fromEl.style.top = '';
      toEl.classList.remove(`in-${dir}`);
      html.classList.remove('is-moving');
    };
    setTimeout(finishMove, dir === 'fade' ? 230 : 400);
  }
  if (prev) toEl.querySelector('h1')?.focus({ preventScroll: true });
}

// ================= Synchro : lecture, analyse, révélation =================

const SYNC = { circ: 0, arc: null };
function buildSyncRing() {
  const C = 110;
  const R = 96;
  SYNC.circ = 2 * Math.PI * R;
  const dots = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    dots.push(s('circle', { cx: (C + R * Math.cos(a)).toFixed(2), cy: (C + R * Math.sin(a)).toFixed(2), r: i % 8 === 0 ? 2.1 : 1.3 }));
  }
  SYNC.arc = s('circle', { class: 'sync-arc', cx: C, cy: C, r: R, 'stroke-dasharray': `${SYNC.circ.toFixed(2)} ${SYNC.circ.toFixed(2)}`, transform: `rotate(-90 ${C} ${C})` });
  SYNC.arc.style.strokeDashoffset = String(SYNC.circ);
  $('sync-ring').replaceChildren(
    s('svg', { class: 'sync-svg', viewBox: '0 0 220 220', focusable: 'false' }, s('g', { class: 'sync-dots' }, dots), s('circle', { class: 'sync-track', cx: C, cy: C, r: R }), SYNC.arc),
    h('span', { class: 'sync-center' }, h('span', { id: 'sync-word', class: 'sync-word' }, 'Âge bio')));
}
function syncMode(mode) {
  const v = $('v-synchro');
  v.dataset.mode = mode;   // idle | busy | error
  $('sync-actions').hidden = mode === 'busy';
  $('sync-lede').hidden = mode !== 'idle';
  $('sync-steps').hidden = mode === 'idle';
}
function syncProgress(p) {
  SYNC.arc.style.strokeDashoffset = String(SYNC.circ * (1 - clamp(p, 0, 1)));
  $('sync-word').textContent = `${Math.round(p * 100)}${NBSP}%`;
}
function setStep(i, text, status) {
  const list = $('sync-steps');
  while (list.children.length <= i) list.append(h('li', { class: 'step' }, h('span', { class: 'step-mark', 'aria-hidden': 'true' }), h('span', { class: 'step-text' })));
  const li = list.children[i];
  li.className = `step is-${status}`;
  li.querySelector('.step-mark').replaceChildren(status === 'done' ? icon('check') : status === 'error' ? icon('close') : '');
  li.querySelector('.step-text').textContent = text;
  $('live').textContent = text;
}
function setStatus(text, isError = false) {
  const st = $('sync-status');
  st.textContent = text;
  st.classList.toggle('is-error', isError);
}
let demoSql = null;
async function demoExport(scenario) {
  if (typeof initSqlJs !== 'function') throw new UserError("Le moteur SQLite (sql-wasm.js) n'a pas pu être chargé : recharge la page.");
  demoSql ??= initSqlJs({ locateFile: f => f });
  const SQL = await demoSql;
  const now = Date.now();
  const db = calc.buildDemo(SQL, now, TZ, scenario);
  const one = sql => db.exec(sql)[0]?.values?.[0]?.[0] ?? 0;
  return { db, meta: { size: one('PRAGMA page_count') * one('PRAGMA page_size'), lastModified: now, b18: 1, b19: 1, walFixed: false, timeZone: TZ } };
}
async function loadExport(file, { demo = null } = {}) {
  if (state.busy) return;
  state.busy = true;
  state.error = null;
  const target = pendingHash || (route && TABS.includes(route.screen) ? `#${route.screen}` : '#age');
  pendingHash = '';
  closeSheet();
  syncMode('busy');
  setStatus('Rien ne quitte ce téléphone.');
  $('sync-steps').replaceChildren();
  syncProgress(0.04);
  if (route?.screen !== 'synchro') go('#synchro', { replace: true });
  const minStep = calm() ? 0 : 260;
  let db = null;
  try {
    setStep(0, demo ? 'Construction des données de démonstration…' : 'Lecture du fichier…', 'active');
    await nextFrame();
    const opened = demo ? await demoExport(demo) : await openExport(file);
    db = opened.db;
    setStep(0, demo ? 'Données de démonstration prêtes' : 'Fichier lu', 'done');
    syncProgress(0.34);
    setStep(1, 'Analyse des jours et des nuits…', 'active');
    await wait(minStep);
    await nextFrame();
    const now = Date.now();
    const diag = diagnose(db, opened.meta, clock, now);
    state.diagText = diag.text;
    state.diagProfile = diag.profile;
    if (diag.missing.length) {
      throw Object.assign(new UserError(`Export non reconnu (table absente : ${diag.missing.join(', ')}). Copie le diagnostic et transmets-le.`), { diag: true });
    }
    let data;
    try {
      data = readExport(db, clock, now, { bilans: blood.list });
    } catch (e) {
      throw Object.assign(e instanceof UserError ? e : new UserError(`Calcul impossible : ${e?.message ?? e}. Copie le diagnostic et transmets-le.`), { diag: true });
    }
    state.diagText = `${diag.text}\n${calcDiagnostic(data)}`;
    const r = data.result;
    setStep(1, `${plural(data.info?.days ?? r.validDays ?? 0, 'jour')}, ${plural(r.validNights ?? 0, 'nuit valide', 'nuits valides')}`, 'done');
    syncProgress(0.67);
    setStep(2, 'Calcul de ton âge bio…', 'active');
    await wait(minStep);
    state.data = data;
    state.loadedAt = Date.now();
    state.week = null;
    state.open = new Set();
    const off = r.official;
    const pv = r.provisional;
    setStep(2, off ? `Âge bio : ${fmtAge(off.bio)} ans` : pv ? `Âge bio provisoire : ${fmtAge(pv.bio)} ans` : finite(r.civil) ? "Âge bio : en attente d'une nuit valide" : 'Calcul terminé', 'done');
    syncProgress(1);
    $('demo-banner').hidden = DEMO === null;
    await wait(calm() ? 0 : 320);
    state.reveal = true;
    renderAll();
    go(target, { replace: true });
    syncMode('idle');
    document.documentElement.dataset.ready = '1';
  } catch (e) {
    if (!(e instanceof UserError)) demoSql = null;
    state.error = e;
    showSyncError(e);
    document.documentElement.dataset.ready = 'error';
  } finally {
    db?.close();   // libère la base : rien n'est conservé
    state.busy = false;
  }
}
function showSyncError(e) {
  syncMode('error');
  const msg = e instanceof UserError ? e.message : `Lecture impossible : ${e?.message ?? e}`;
  const list = $('sync-steps');
  const active = [...list.children].findIndex(li => li.classList.contains('is-active'));
  if (active >= 0) setStep(active, list.children[active].querySelector('.step-text').textContent.replace(/…$/, ''), 'error');
  SYNC.arc.style.strokeDashoffset = '0';
  $('sync-word').textContent = '!';
  setStatus(msg, true);
  $('sync-go').textContent = 'Réessayer';
  const actions = $('sync-actions');
  actions.querySelector('.sync-diag')?.remove();
  actions.append(h('p', { class: 'sync-diag' },
    state.diagText ? linkCta('Voir le diagnostic', '#diagnostic') : null,
    state.data ? linkCta('Revenir à mes données', '#age') : null));
}
function pickFile() {
  if (state.busy) return;
  $('file').click();
}

// ================= Rendu global, erreurs, démarrage =================

function renderAll() {
  if (!state.data) return;
  renderToday();
  renderAge();
  renderPlus();
  renderMethod();
  renderDiag();
  if (route && ['indicateur', 'sommeil', 'tendance', 'sang'].includes(route.screen)) renderScreen(route);
}
let toastTimer = 0;
function toast(text, isError = false) {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('is-error', isError);
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('is-on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('is-on');
    setTimeout(() => { t.hidden = true; }, 250);
  }, 4200);
}
function onError(message) {
  window.__uiErrors += 1;
  toast(`Erreur inattendue : ${message}`, true);
}

function wire() {
  for (const el of document.querySelectorAll('[data-icon]')) el.prepend(icon(el.dataset.icon));
  for (const el of document.querySelectorAll('[data-back]')) if (!el.firstChild) el.append(icon('back'));
  buildSyncRing();
  $('sync-go').addEventListener('click', pickFile);
  $('fab-sync').addEventListener('click', pickFile);
  $('copy').addEventListener('click', copyDiagnostic);
  $('file').addEventListener('change', e => {
    const input = e.target;
    const file = input.files?.[0];
    if (file) loadExport(file).finally(() => { input.value = ''; });   // permet de recharger le même fichier
  });
  $('file-blood').addEventListener('change', e => {
    const input = e.target;
    const file = input.files?.[0];
    if (file) bloodImport(file).finally(() => { input.value = ''; });
  });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-back],[data-sheet],[data-close],[data-week],[data-scroll],[data-action],a[href^="#"]');
    if (!t) return;
    if (t.matches('[data-back]')) {
      e.preventDefault();
      goBack(`#${PARENT[route?.screen] ?? (state.data ? 'age' : 'synchro')}`);
    } else if (t.matches('[data-sheet]')) {
      e.preventDefault();
      go(hashOf({ ...route, sheet: t.dataset.sheet }), { replace: Boolean(route?.sheet) });
    } else if (t.matches('[data-close]')) {
      e.preventDefault();
      closeSheetNav();
    } else if (t.matches('[data-week]')) {
      e.preventDefault();
      const m = ageModel();
      if (m.kind !== 'value' || m.provisional) return;
      const want = t.dataset.week === 'latest' ? m.offIdx : clamp(m.idx + Number(t.dataset.week), 0, m.curve.length - 1);
      state.week = want === m.offIdx ? null : want;
      const keep = scrollY;
      renderAge();
      scrollTo(0, keep);
      $('v-age').querySelector(`[data-week="${t.dataset.week}"]:not([disabled])`)?.focus({ preventScroll: true });
    } else if (t.matches('[data-scroll]')) {
      e.preventDefault();
      if (route?.sheet) closeSheetNav();
      document.getElementById(t.dataset.scroll)?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
    } else if (t.matches('[data-action="pick"]')) {
      e.preventDefault();
      pickFile();
    } else if (t.matches('[data-action="blood-export"]')) {
      e.preventDefault();
      bloodExport();
    } else if (t.matches('[data-action="blood-import"]')) {
      e.preventDefault();
      $('file-blood').click();
    } else if (t.matches('[data-action="blood-delete"]')) {
      e.preventDefault();
      deleteBilan(route?.param);
    } else {
      e.preventDefault();
      const href = t.getAttribute('href');
      if (t.matches('[data-tab]') && route && `#${route.screen}` === href && TABS.includes(route.screen)) {
        scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' });
        return;
      }
      go(href, { replace: t.matches('[data-tab]') });
    }
  });
  addEventListener('popstate', () => syncRoute());
  addEventListener('hashchange', () => syncRoute());
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (sheetOpen) closeSheetNav();
    else if (route && PARENT[route.screen]) goBack(`#${PARENT[route.screen]}`);
  });
  wireSheetDrag();
  addEventListener('error', e => onError(e.message || 'erreur de script'));
  addEventListener('unhandledrejection', e => onError(e.reason?.message ?? String(e.reason)));
  // « Synchronisé il y a … » reste juste tant que l'app est ouverte.
  setInterval(() => {
    const sub = $('today-sub');
    if (sub && state.data) sub.textContent = syncLine();
  }, 30000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* l'app reste utilisable en ligne */ });
  }
}

function boot() {
  history.scrollRestoration = 'manual';
  bloodLoad();
  wire();
  $('sync-go').disabled = false;
  syncMode('idle');
  setStatus('');
  const asked = parseHash(location.hash);
  pendingHash = SCREENS.includes(asked.screen) && asked.screen !== 'synchro' ? hashOf({ ...asked, sheet: asked.sheet && SHEETS[asked.sheet] ? asked.sheet : null }) : '';
  history.replaceState({ depth: 0 }, '', asked.screen === 'methode' ? location.hash : '#synchro');
  syncRoute();
  if (DEMO !== null) {
    window.__ui = { state, go };
    $('demo-banner').hidden = false;
    loadExport(null, { demo: DEMO });
  } else {
    document.documentElement.dataset.ready = 'idle';
  }
}

boot();
