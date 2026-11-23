export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (m) => new HttpError(400, m);
export const forbidden = (m = 'No tienes permisos para esta acción.') => new HttpError(403, m);
export const notFound = (m = 'No encontrado.') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);

export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Texto en minusculas, sin tildes ni signos
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function int(v, name, { min = -Infinity, max = Infinity, opt = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (opt) return null;
    throw bad(`${name} es obligatorio.`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} debe ser un número entero entre ${min} y ${max}.`);
  return n;
}
export function num(v, name, { min = -Infinity, max = Infinity, opt = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (opt) return null;
    throw bad(`${name} es obligatorio.`);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} debe ser un número entre ${min} y ${max}.`);
  return n;
}
export function str(v, name, { min = 1, max = 200, opt = false } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (opt) return null;
    throw bad(`${name} es obligatorio.`);
  }
  const s = String(v).trim();
  if (s.length < min || s.length > max) throw bad(`${name} debe tener entre ${min} y ${max} caracteres.`);
  return s;
}
export function date(v, name, { opt = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (opt) return null;
    throw bad(`${name} es obligatoria.`);
  }
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad(`${name} debe tener formato AAAA-MM-DD.`);
  return s;
}
export const oneOf = (v, name, list) => {
  if (!list.includes(v)) throw bad(`${name} debe ser uno de: ${list.join(', ')}.`);
  return v;
};
export const today = () => new Date().toISOString().slice(0, 10);
