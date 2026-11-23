import http from 'node:http';
import { createApp } from '../src/app.js';
import { initDb, pool } from '../src/init.js';

export const PASS = process.env.DEMO_PASSWORD || 'Observatorio2026';
export let BASE = '';
let server;

export async function start(opts) {
  await initDb();
  server = http.createServer(createApp(opts));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  return BASE;
}
export async function stop() { await new Promise((r) => server.close(r)); }
export { pool };

export async function api(method, path, { token, body, raw } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo JSON */ }
  return { status: res.status, data, headers: res.headers };
}

const cache = {};
export async function login(email) {
  if (cache[email]) return cache[email];
  const r = await api('POST', '/auth/login', { body: { email, password: PASS } });
  if (r.status !== 200) throw new Error(`Login fallido para ${email}: ${r.status}`);
  cache[email] = r.data.token;
  return cache[email];
}
export const T = {
  admin: () => login('admin@pac.demo'), fisc: () => login('fisc@pac.demo'), comercio: () => login('comercio@pac.demo'),
  puesto: () => login('puesto@pac.demo'), vecino: () => login('vecino@pac.demo')
};

export async function productoId(nombre, formato) {
  const r = await api('GET', '/productos?q=' + encodeURIComponent(nombre));
  const p = r.data.find((x) => x.nombre === nombre && (!formato || x.formato === formato));
  if (!p) throw new Error('Producto no encontrado: ' + nombre);
  return p.id_producto;
}
export async function sucursalId(nombre) {
  const r = await api('GET', '/sucursales');
  const s = r.data.find((x) => x.nombre.includes(nombre));
  if (!s) throw new Error('Sucursal no encontrada: ' + nombre);
  return s.id_sucursal;
}
export async function precioActual(idProd, idSuc) {
  const r = await api('GET', `/productos/${idProd}/precios`);
  return r.data.resultados.find((x) => x.id_sucursal === idSuc);
}
export const manana = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
export const enDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
export const ayer = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);
