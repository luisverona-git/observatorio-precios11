import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool, q, tx } from './db.js';
import { hashPassword } from './middleware/auth.js';
import { norm } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  const sql = fs.readFileSync(path.resolve(__dirname, '../db/schema.sql'), 'utf8');
  await q(sql);
  for (const r of ['admin', 'fiscalizador', 'comercio', 'sucursal', 'vecino']) {
    await q('INSERT INTO rol (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [r]);
  }
}

// PRNG determinista para que los datos de ejemplo sean siempre los mismos
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

export async function seedSiVacio() {
  const { rows } = await q('SELECT COUNT(*)::int AS n FROM producto');
  if (rows[0].n > 0) return false;

  const demoPass = process.env.DEMO_PASSWORD || (process.env.NODE_ENV === 'production' ? crypto.randomBytes(9).toString('base64url') : 'Observatorio2026');
  if (process.env.NODE_ENV === 'production' && !process.env.DEMO_PASSWORD) console.log(`[seed] Contraseña de las cuentas demo (aleatoria): ${demoPass}`);
  const hash = hashPassword(demoPass);

  await tx(async (db) => {
    const cats = {};
    for (const c of ['Verduras y frutas', 'Carnes', 'Panadería', 'Abarrotes', 'Lácteos y huevos']) {
      const r = await db.query('INSERT INTO categoria (nombre) VALUES ($1) RETURNING id_categoria', [c]);
      cats[c] = r.rows[0].id_categoria;
    }
    // [nombre, marca, formato, contenido, unidad, categoria, precio base en feria]
    const prods = [
      ['Papa', null, 'granel 1 kg', 1, 'kg', 'Verduras y frutas', 890], ['Zapallo', null, 'granel 1 kg', 1, 'kg', 'Verduras y frutas', 790],
      ['Choclo', null, 'unidad', 1, 'un', 'Verduras y frutas', 350], ['Zanahoria', null, 'granel 1 kg', 1, 'kg', 'Verduras y frutas', 790],
      ['Tomate', null, 'granel 1 kg', 1, 'kg', 'Verduras y frutas', 1500], ['Palta Hass', null, 'granel 1 kg', 1, 'kg', 'Verduras y frutas', 4990],
      ['Carne molida', null, 'bandeja 500 g', 500, 'g', 'Carnes', 3200], ['Pan marraqueta', null, 'kilo', 1, 'kg', 'Panadería', 1900],
      ['Arroz grado 1', 'Tucapel', '1 kg', 1, 'kg', 'Abarrotes', 1450], ['Arroz grado 1', 'Tucapel', '500 g', 500, 'g', 'Abarrotes', 790],
      ['Aceite vegetal', 'Chef', '1 L', 1, 'l', 'Abarrotes', 2790], ['Leche entera', 'Colún', '1 L', 1, 'l', 'Lácteos y huevos', 1150],
      ['Huevos', null, 'cartón 12 un', 12, 'un', 'Lácteos y huevos', 3600]
    ];
    const pid = {};
    for (const [n, m, f, c, u, cat, base] of prods) {
      const clave = norm(`${n}|${m || ''}|${f}`).replace(/ /g, '');
      const r = await db.query(
        `INSERT INTO producto (id_categoria,nombre,marca,formato,contenido,unidad_medida,clave,busqueda) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_producto`,
        [cats[cat], n, m, f, c, u, clave, norm(`${n} ${m || ''}`)]);
      pid[`${n}|${f}`] = { id: r.rows[0].id_producto, base };
    }
    const sin = { cazuela: ['Papa', 'Zapallo', 'Choclo', 'Zanahoria', 'Carne molida'], marraqueta: ['Pan marraqueta'], hallulla: ['Pan marraqueta'],
      'pan batido': ['Pan marraqueta'], pan: ['Pan marraqueta'], ensalada: ['Tomate', 'Palta Hass'], 'ensalada chilena': ['Tomate'], palta: ['Palta Hass'], bencina: [] };
    for (const [t, ns] of Object.entries(sin)) for (const n of ns) {
      const p = Object.entries(pid).find(([k]) => k.startsWith(n + '|'));
      await db.query('INSERT INTO sinonimo (termino, id_producto) VALUES ($1,$2) ON CONFLICT DO NOTHING', [t, p[1].id]);
    }

    const com = {};
    for (const [rut, razon, tipo] of [['76.111.111-1', 'Feria Libre Lo Valledor', 'feria'], ['76.222.222-2', 'Almacén Don Pepe', 'almacen'],
      ['76.333.333-3', 'Supermercado Centro', 'supermercado'], ['76.444.444-4', 'Panadería La Espiga', 'panaderia']]) {
      const r = await db.query('INSERT INTO comercio (rut,razon_social,tipo) VALUES ($1,$2,$3) RETURNING id_comercio', [rut, razon, tipo]);
      com[tipo] = r.rows[0].id_comercio;
    }
    // Coordenadas aproximadas dentro de la comuna (datos de demostracion)
    const sucs = {};
    for (const [key, ctipo, nombre, dir, sector, lat, lng, mult] of [
      ['feria', 'feria', 'Feria Lo Valledor · Puesto 14', 'Feria Lo Valledor, Puesto 14', 'Sector Sur', -33.5095, -70.6718, 1.0],
      ['pepe', 'almacen', 'Almacén Don Pepe', 'Av. Pedro Aguirre Cerda 4120', 'Sector Norte', -33.4868, -70.6704, 1.22],
      ['super', 'supermercado', 'Supermercado Centro', 'Av. Departamental 1850', 'Sector Centro', -33.4957, -70.6612, 1.35],
      ['espiga', 'panaderia', 'Panadería La Espiga', 'Calle Santa Rosa 6200', 'Sector Centro', -33.4905, -70.6635, 1.0]]) {
      const r = await db.query(
        `INSERT INTO sucursal (id_comercio,nombre,direccion,sector,ubicacion) VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($6,$5),4326)::geography) RETURNING id_sucursal`,
        [com[ctipo], nombre, dir, sector, lat, lng]);
      sucs[key] = { id: r.rows[0].id_sucursal, mult };
    }

    const usr = {};
    for (const [email, nombre, rol, idCom, idSuc] of [
      ['admin@pac.demo', 'Admin DIDESE', 'admin', null, null], ['fisc@pac.demo', 'Fiscalizador Demo', 'fiscalizador', null, null],
      ['comercio@pac.demo', 'Dueño Almacén Don Pepe', 'comercio', com.almacen, null], ['puesto@pac.demo', 'Locatario Puesto 14', 'sucursal', com.feria, sucs.feria.id],
      ['vecino@pac.demo', 'Vecino Demo', 'vecino', null, null]]) {
      const r = await db.query(
        `INSERT INTO usuario (email,nombre,password_hash,id_rol,id_comercio,id_sucursal) VALUES ($1,$2,$3,(SELECT id_rol FROM rol WHERE nombre=$4),$5,$6) RETURNING id_usuario`,
        [email, nombre, hash, rol, idCom, idSuc]);
      usr[rol] = r.rows[0].id_usuario;
    }

    // Que vende cada local (el supermercado vende todo; la panaderia solo pan)
    const vende = { feria: ['Papa', 'Zapallo', 'Choclo', 'Zanahoria', 'Tomate', 'Palta Hass', 'Huevos'],
      pepe: ['Papa', 'Zapallo', 'Choclo', 'Tomate', 'Carne molida', 'Pan marraqueta', 'Arroz grado 1', 'Aceite vegetal', 'Leche entera', 'Huevos'],
      super: Object.keys(pid).map((k) => k.split('|')[0]).filter((v, i, a) => a.indexOf(v) === i), espiga: ['Pan marraqueta'] };
    const rand = rng(42);
    const SEMANAS = 8;
    for (const [sk, nombres] of Object.entries(vende)) {
      for (const [key, p] of Object.entries(pid)) {
        if (!nombres.includes(key.split('|')[0])) continue;
        let valor = Math.round((p.base * sucs[sk].mult) / 10) * 10;
        for (let w = SEMANAS; w >= 0; w--) {
          const deriva = 1 + (rand() - 0.45) * 0.08; // pequeña variacion semanal
          const esActual = w === 0;
          const v = Math.max(50, Math.round((valor * deriva) / 10) * 10);
          valor = v;
          const diasAtras = w * 7 + Math.floor(rand() * 3);
          const oferta = esActual && rand() < 0.2;
          const vOferta = oferta ? Math.round((v * 0.85) / 10) * 10 : null;
          await db.query(
            `INSERT INTO precio (id_producto,id_sucursal,id_usuario,valor_normal,valor_oferta,vigencia_desde,vigencia_hasta,condiciones,fuente,
                                 fecha_observacion,estado,estado_oferta,creado)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - make_interval(days => $10), $11, $12, now() - make_interval(days => $10))`,
            [p.id, sucs[sk].id, sk === 'feria' ? usr.fiscalizador : usr.admin, v, vOferta,
              oferta ? new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) : null,
              oferta ? new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) : null,
              oferta ? 'Compra mínima 2 kg' : null, sk === 'feria' ? 'terreno' : 'formulario', diasAtras,
              esActual ? 'vigente' : 'inactivo', oferta ? 'activa' : 'ninguna']);
        }
      }
    }
    await db.query(`INSERT INTO log_auditoria (accion, entidad, id_entidad, valor_nuevo) VALUES ('SEED','sistema','-', $1)`,
      [JSON.stringify({ nota: 'Datos de demostración (ficticios) cargados al iniciar' })]);
  });
  return true;
}

export async function initDb() {
  await migrate();
  return seedSiVacio();
}
export { pool };
