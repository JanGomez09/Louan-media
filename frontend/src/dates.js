// Fechas de día completo como texto "AAAA-MM-DD", calculadas con la hora local del dispositivo.
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`; // m: 1-12
export const keyOf = (date) => ymd(date.getFullYear(), date.getMonth() + 1, date.getDate());
export const parse = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return { y, m, d };
};
const utc = ({ y, m, d }) => Date.UTC(y, m - 1, d);
export const daysBetween = (a, b) => Math.round((utc(parse(b)) - utc(parse(a))) / 864e5);
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** ¿El evento cae en ese día? Los que se repiten cada año cuentan desde su año original. */
export function occursOn(ev, key) {
  if (ev.date === key) return true;
  if (!ev.yearly) return false;
  const o = parse(ev.date);
  const c = parse(key);
  if (c.y <= o.y) return false;
  if (o.m === 2 && o.d === 29 && !isLeap(c.y)) return c.m === 2 && c.d === 28; // 29 de febrero → 28
  return o.m === c.m && o.d === c.d;
}

/** Próxima fecha (hoy incluido) en que ocurre el evento, o null si ya pasó y no se repite. */
export function nextOccurrence(ev, todayKey) {
  if (ev.date >= todayKey) return ev.date;
  if (!ev.yearly) return null;
  const o = parse(ev.date);
  const t = parse(todayKey);
  for (let y = t.y; y <= t.y + 1; y++) {
    const d = o.m === 2 && o.d === 29 && !isLeap(y) ? 28 : o.d;
    const k = ymd(y, o.m, d);
    if (k >= todayKey) return k;
  }
  return null;
}

export const yearsSince = (ev, key) => parse(key).y - parse(ev.date).y;
