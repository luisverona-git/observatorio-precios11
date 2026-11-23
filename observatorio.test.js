import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { start, stop, api, T, pool, BASE, productoId, sucursalId, precioActual, manana, enDias, ayer } from './helpers.js';

const RUN = Date.now().toString(36); // datos unicos por ejecucion
let ids = {};

before(async () => {
  await start({ limits: { api: 100000, login: 100000 } });
  ids.papa = await productoId('Papa');
  ids.tomate = await productoId('Tomate');
  ids.zapallo = await productoId('Zapallo');
  ids.choclo = await productoId('Choclo');
  ids.zanahoria = await productoId('Zanahoria');
  ids.palta = await productoId('Palta Hass');
  ids.arroz1 = await productoId('Arroz grado 1', '1 kg');
  ids.arroz500 = await productoId('Arroz grado 1', '500 g');
  ids.feria = await sucursalId('Feria');
  ids.pepe = await sucursalId('Don Pepe');
  ids.super = await sucursalId('Supermercado');
});
after(async () => { await stop(); await pool.end(); });

describe('R1 Catálogo de productos', () => {
  test('CP-01 lista productos con categoría y rango de precios', async () => {
    const r = await api('GET', '/productos');
    assert.equal(r.status, 200);
    assert.ok(r.data.length >= 13);
    const p = r.data.find((x) => x.nombre === 'Papa');
    assert.ok(p.categoria && p.precio_min > 0 && p.precio_max >= p.precio_min);
  });
  test('CP-02 el administrador crea un producto con categoría normalizada', async () => {
    const r = await api('POST', '/admin/productos', { token: await T.admin(), body: { id_categoria: 4, nombre: 'Fideos ' + RUN, marca: 'Carozzi', formato: '400 g', contenido: 400, unidad_medida: 'g' } });
    assert.equal(r.status, 201);
    ids.fideos = r.data.id_producto;
  });
  test('CP-03 rechaza producto duplicado (mismo nombre, marca y formato)', async () => {
    const r = await api('POST', '/admin/productos', { token: await T.admin(), body: { id_categoria: 4, nombre: 'FIDEOS ' + RUN, marca: 'carozzi', formato: '400 G', contenido: 400, unidad_medida: 'g' } });
    assert.equal(r.status, 409);
  });
  test('CP-04 un arroz de 1 kg y uno de 500 g son productos distintos con precio por unidad', async () => {
    assert.notEqual(ids.arroz1, ids.arroz500);
    const r = await api('GET', `/productos/${ids.arroz500}/precios`);
    const x = r.data.resultados[0];
    assert.equal(r.data.producto.unidad_base, 'kg');
    assert.equal(x.precio_unitario, Math.round(x.valor_final / 0.5));
  });
  test('CP-05 un usuario sin rol de administrador no puede editar el catálogo', async () => {
    const body = { id_categoria: 4, nombre: 'Hack ' + RUN, formato: '1 kg', contenido: 1, unidad_medida: 'kg' };
    assert.equal((await api('POST', '/admin/productos', { token: await T.comercio(), body })).status, 403);
    assert.equal((await api('POST', '/admin/productos', { body })).status, 401);
  });
  test('CP-06 valida datos del producto (unidad inválida, contenido negativo)', async () => {
    const t = await T.admin();
    assert.equal((await api('POST', '/admin/productos', { token: t, body: { id_categoria: 1, nombre: 'X' + RUN, formato: 'f', contenido: 1, unidad_medida: 'litros' } })).status, 400);
    assert.equal((await api('POST', '/admin/productos', { token: t, body: { id_categoria: 1, nombre: 'Y' + RUN, formato: 'f', contenido: -3, unidad_medida: 'kg' } })).status, 400);
  });
});

describe('R2 Registro de comercios y sucursales', () => {
  test('CP-07 el administrador registra comercio y sucursal con ubicación', async () => {
    const t = await T.admin();
    const c = await api('POST', '/admin/comercios', { token: t, body: { rut: '77.' + String(Date.now()).slice(-6, -3) + '.' + String(Date.now()).slice(-3) + '-5', razon_social: 'Botillería Test ' + RUN, tipo: 'almacen' } });
    assert.equal(c.status, 201);
    const s = await api('POST', '/admin/sucursales', { token: t, body: { id_comercio: c.data.id_comercio, nombre: 'Sucursal Test ' + RUN, direccion: 'Calle 1 #100', sector: 'Sector Norte', lat: -33.49, lng: -70.66 } });
    assert.equal(s.status, 201);
    ids.sucTest = s.data.id_sucursal; ids.comTest = c.data.id_comercio;
    const lista = await api('GET', '/admin/sucursales', { token: t });
    const x = lista.data.find((z) => z.id_sucursal === ids.sucTest);
    assert.equal(x.lat, -33.49); assert.equal(x.lng, -70.66);
  });
  test('CP-08 valida RUT, coordenadas y tipo de comercio', async () => {
    const t = await T.admin();
    assert.equal((await api('POST', '/admin/comercios', { token: t, body: { rut: 'abc', razon_social: 'X', tipo: 'almacen' } })).status, 400);
    assert.equal((await api('POST', '/admin/comercios', { token: t, body: { rut: '76.111.111-1', razon_social: 'Dup', tipo: 'almacen' } })).status, 409);
    assert.equal((await api('POST', '/admin/sucursales', { token: t, body: { id_comercio: ids.comTest, nombre: 'Z', direccion: 'd', sector: 's', lat: 200, lng: 0 } })).status, 400);
  });
  test('CP-09 una sucursal inactiva deja de aparecer en el mapa y el comparador', async () => {
    const t = await T.admin();
    const antes = (await api('GET', '/sucursales')).data.length;
    await api('PUT', `/admin/sucursales/${ids.sucTest}/activa`, { token: t, body: { activa: false } });
    const despues = (await api('GET', '/sucursales')).data.length;
    assert.ok(despues <= antes);
    assert.ok(!(await api('GET', '/sucursales')).data.some((s) => s.id_sucursal === ids.sucTest));
  });
});

describe('R3 Registro de precios y ofertas', () => {
  test('CP-10 el fiscalizador publica un precio y el anterior queda en el historial', async () => {
    const act = await precioActual(ids.papa, ids.feria);
    const nuevo = act.valor_normal + 10;
    const antes = (await api('GET', `/productos/${ids.papa}/historial?sucursal=${ids.feria}&dias=730&agrupar=week`)).data.serie.reduce((a, x) => a + x.observaciones, 0);
    const r = await api('POST', '/precios', { token: await T.fisc(), body: { id_producto: ids.papa, id_sucursal: ids.feria, valor_normal: nuevo } });
    assert.equal(r.status, 201); assert.equal(r.data.estado, 'vigente');
    assert.equal((await precioActual(ids.papa, ids.feria)).valor_normal, nuevo);
    const despues = (await api('GET', `/productos/${ids.papa}/historial?sucursal=${ids.feria}&dias=730&agrupar=week`)).data.serie.reduce((a, x) => a + x.observaciones, 0);
    assert.equal(despues, antes + 1);
  });
  test('CP-11 registra oferta con vigencia y condiciones, y se muestra como oferta activa', async () => {
    const act = await precioActual(ids.zapallo, ids.feria);
    const r = await api('POST', '/precios', { token: await T.fisc(), body: { id_producto: ids.zapallo, id_sucursal: ids.feria, valor_normal: act.valor_normal + 10,
      valor_oferta: act.valor_normal - 50, vigencia_desde: ayer(), vigencia_hasta: enDias(7), condiciones: 'Compra mínima 3 kg, pago con tarjeta' } });
    assert.equal(r.status, 201);
    const x = await precioActual(ids.zapallo, ids.feria);
    assert.equal(x.oferta_activa, true); assert.equal(x.valor_final, x.valor_oferta);
    assert.match(x.condiciones, /Compra mínima/);
  });
  test('CP-12 el comercio solo registra precios de su propio local', async () => {
    const t = await T.comercio();
    const act = await precioActual(ids.choclo, ids.pepe);
    assert.equal((await api('POST', '/precios', { token: t, body: { id_producto: ids.choclo, id_sucursal: ids.feria, valor_normal: 400 } })).status, 403);
    assert.equal((await api('POST', '/precios', { token: t, body: { id_producto: ids.choclo, id_sucursal: ids.pepe, valor_normal: act.valor_normal + 10 } })).status, 201);
  });
  test('CP-13 el locatario de un puesto solo registra precios de su sucursal', async () => {
    const t = await T.puesto();
    const act = await precioActual(ids.tomate, ids.feria);
    assert.equal((await api('POST', '/precios', { token: t, body: { id_producto: ids.tomate, id_sucursal: ids.pepe, valor_normal: 1500 } })).status, 403);
    assert.equal((await api('POST', '/precios', { token: t, body: { id_producto: ids.tomate, id_sucursal: ids.feria, valor_normal: act.valor_normal + 10 } })).status, 201);
  });
  test('CP-14 vecinos y anónimos no pueden registrar precios', async () => {
    const body = { id_producto: ids.papa, id_sucursal: ids.feria, valor_normal: 900 };
    assert.equal((await api('POST', '/precios', { token: await T.vecino(), body })).status, 403);
    assert.equal((await api('POST', '/precios', { body })).status, 401);
  });
  test('CP-15 valores de borde: cero, negativo, texto y exceso de rango son rechazados', async () => {
    const t = await T.fisc();
    for (const v of [0, -5, 'abc', 1000001, 10.5, null]) {
      const r = await api('POST', '/precios', { token: t, body: { id_producto: ids.papa, id_sucursal: ids.feria, valor_normal: v } });
      assert.equal(r.status, 400, `valor ${v} debió dar 400`);
    }
  });
  test('CP-16 reglas de oferta: sin vigencia, mayor al normal o ya vencida', async () => {
    const t = await T.fisc();
    const base = { id_producto: ids.papa, id_sucursal: ids.feria, valor_normal: 1000 };
    assert.equal((await api('POST', '/precios', { token: t, body: { ...base, valor_oferta: 800 } })).status, 400);
    assert.equal((await api('POST', '/precios', { token: t, body: { ...base, valor_oferta: 1200, vigencia_desde: ayer(), vigencia_hasta: enDias(3) } })).status, 400);
    assert.equal((await api('POST', '/precios', { token: t, body: { ...base, valor_oferta: 800, vigencia_desde: enDias(-10), vigencia_hasta: ayer() } })).status, 400);
    assert.equal((await api('POST', '/precios', { token: t, body: { ...base, valor_oferta: 800, vigencia_desde: enDias(5), vigencia_hasta: enDias(2) } })).status, 400);
    assert.equal((await api('POST', '/precios', { token: t, body: { ...base, vigencia_desde: '2026-13-45' } })).status, 400);
  });
  test('CP-17 rechaza un precio duplicado del vigente', async () => {
    const act = await precioActual(ids.zanahoria, ids.feria);
    const r = await api('POST', '/precios', { token: await T.fisc(), body: { id_producto: ids.zanahoria, id_sucursal: ids.feria, valor_normal: act.valor_normal, valor_oferta: act.valor_oferta, vigencia_desde: act.vigencia_desde, vigencia_hasta: act.vigencia_hasta } });
    assert.equal(r.status, 409);
  });
  test('CP-18 texto con comillas/SQL en condiciones se guarda como texto y no rompe la base', async () => {
    const act = await precioActual(ids.palta, ids.feria);
    const cond = "'; DROP TABLE precio; -- <script>alert(1)</script>";
    const r = await api('POST', '/precios', { token: await T.fisc(), body: { id_producto: ids.palta, id_sucursal: ids.feria, valor_normal: act.valor_normal + 10, condiciones: cond } });
    assert.equal(r.status, 201);
    assert.equal((await precioActual(ids.palta, ids.feria)).condiciones, cond);
    assert.equal((await api('GET', '/productos')).status, 200);
  });
});

describe('R4 Buscador y comparador', () => {
  test('CP-19 "ingredientes para cazuela" entrega papa, zapallo, choclo, zanahoria y carne', async () => {
    const r = await api('GET', '/productos?q=' + encodeURIComponent('ingredientes para cazuela'));
    const n = r.data.map((x) => x.nombre);
    for (const e of ['Papa', 'Zapallo', 'Choclo', 'Zanahoria', 'Carne molida']) assert.ok(n.includes(e), 'falta ' + e);
  });
  test('CP-20 tolera faltas de ortografía y modismos', async () => {
    assert.ok((await api('GET', '/productos?q=zanaoria')).data.some((x) => x.nombre === 'Zanahoria'));
    assert.ok((await api('GET', '/productos?q=marraqueta')).data.some((x) => x.nombre === 'Pan marraqueta'));
    assert.ok((await api('GET', '/productos?q=PÁLTA')).data.some((x) => x.nombre === 'Palta Hass'));
  });
  test('CP-21 búsqueda sin resultados devuelve lista vacía; filtra por categoría', async () => {
    assert.deepEqual((await api('GET', '/productos?q=xyzqwerty')).data, []);
    const c = await api('GET', '/productos?categoria=3');
    assert.ok(c.data.length >= 1 && c.data.every((p) => p.categoria === 'Panadería'));
  });
  test('CP-22 ordena por precio ascendente', async () => {
    const r = await api('GET', `/productos/${ids.papa}/precios?orden=precio`);
    const v = r.data.resultados.map((x) => x.valor_final);
    assert.deepEqual(v, [...v].sort((a, b) => a - b));
  });
  test('CP-23 ordena por distancia usando PostGIS y exige ubicación', async () => {
    assert.equal((await api('GET', `/productos/${ids.papa}/precios?orden=distancia`)).status, 400);
    const r = await api('GET', `/productos/${ids.papa}/precios?orden=distancia&lat=-33.4868&lng=-70.6704`);
    const m = r.data.resultados.map((x) => x.metros);
    assert.deepEqual(m, [...m].sort((a, b) => a - b));
    assert.equal(r.data.resultados[0].sucursal, 'Almacén Don Pepe');
  });
  test('CP-24 ordena por vigencia y filtra por tipo de comercio', async () => {
    assert.equal((await api('GET', `/productos/${ids.papa}/precios?orden=vigencia`)).status, 200);
    const f = await api('GET', `/productos/${ids.papa}/precios?tipo=feria`);
    assert.ok(f.data.resultados.length >= 1 && f.data.resultados.every((x) => x.tipo === 'feria'));
  });
  test('CP-25 parámetros inválidos son rechazados (orden, id, coordenadas)', async () => {
    assert.equal((await api('GET', `/productos/${ids.papa}/precios?orden=hack`)).status, 400);
    assert.equal((await api('GET', '/productos/abc/precios')).status, 400);
    assert.equal((await api('GET', '/productos/99999/precios')).status, 404);
    assert.equal((await api('GET', `/productos/${ids.papa}/precios?orden=distancia&lat=999&lng=0`)).status, 400);
  });
  test('CP-26 la canasta calcula el total por local solo donde están todos los productos', async () => {
    const r = await api('POST', '/canasta/comparar', { body: { productos: [ids.papa, ids.zapallo] } });
    assert.equal(r.status, 200); assert.ok(r.data.length >= 2);
    const t = r.data.map((x) => x.total);
    assert.deepEqual(t, [...t].sort((a, b) => a - b));
    assert.equal((await api('POST', '/canasta/comparar', { body: { productos: [] } })).status, 400);
  });
});

describe('R5 Geolocalización', () => {
  test('CP-27 los locales traen coordenadas y datos del local', async () => {
    const r = await api('GET', '/sucursales');
    assert.ok(r.data.length >= 4);
    for (const s of r.data) assert.ok(typeof s.lat === 'number' && typeof s.lng === 'number' && s.direccion && s.comercio);
  });
  test('CP-28 filtros por categoría, tipo de comercio y sector', async () => {
    const pan = await api('GET', '/sucursales?categoria=3');
    assert.ok(pan.data.some((s) => s.nombre.includes('Espiga')) && !pan.data.some((s) => s.nombre.includes('Feria')));
    assert.ok((await api('GET', '/sucursales?tipo=feria')).data.every((s) => s.tipo === 'feria'));
    assert.ok((await api('GET', '/sucursales?sector=' + encodeURIComponent('Sector Norte'))).data.every((s) => s.sector === 'Sector Norte'));
  });
  test('CP-29 el detalle del local lista sus precios vigentes', async () => {
    const r = await api('GET', `/sucursales/${ids.feria}`);
    assert.equal(r.status, 200); assert.ok(r.data.precios.length >= 5);
    assert.equal((await api('GET', '/sucursales/999999')).status, 404);
  });
});

describe('R6 Historial de precios', () => {
  test('CP-30 el historial semanal conserva varias semanas con valores y fechas', async () => {
    const r = await api('GET', `/productos/${ids.papa}/historial?agrupar=week&dias=90`);
    assert.equal(r.status, 200);
    const periodos = new Set(r.data.serie.map((x) => x.periodo));
    assert.ok(periodos.size >= 5);
    assert.ok(r.data.serie.every((x) => x.valor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.periodo)));
    assert.match(r.data.unidad, /CLP/);
  });
  test('CP-31 agrupación mensual y validación de parámetros', async () => {
    assert.equal((await api('GET', `/productos/${ids.papa}/historial?agrupar=month`)).data.agrupacion, 'mensual');
    assert.equal((await api('GET', `/productos/${ids.papa}/historial?agrupar=year`)).status, 400);
    assert.equal((await api('GET', `/productos/${ids.papa}/historial?dias=1`)).status, 400);
  });
});

describe('R7 Indicadores del observatorio', () => {
  test('CP-32 el panel muestra promedio, mínimo, máximo, variación, ofertas y período', async () => {
    const r = await api('GET', '/admin/indicadores?dias=30', { token: await T.admin() });
    assert.equal(r.status, 200);
    assert.equal(r.data.periodo.dias, 30); assert.ok(r.data.periodo.desde && r.data.periodo.hasta);
    assert.ok('categoria' in r.data.filtros && r.data.unidades);
    for (const k of ['productos_monitoreados', 'ofertas_vigentes', 'cobertura_pct', 'alertas_pendientes']) assert.ok(k in r.data.kpis);
    for (const p of r.data.productos) assert.ok(p.minimo <= p.promedio && p.promedio <= p.maximo);
    assert.ok(r.data.productos.some((p) => p.variacion_pct !== null));
  });
  test('CP-33 respeta el filtro de categoría y es solo para administradores', async () => {
    const r = await api('GET', '/admin/indicadores?categoria=3', { token: await T.admin() });
    assert.ok(r.data.productos.every((p) => p.categoria === 'Panadería'));
    assert.equal((await api('GET', '/admin/indicadores', { token: await T.vecino() })).status, 403);
    assert.equal((await api('GET', '/admin/indicadores')).status, 401);
  });
});

describe('R8 Usuarios, roles y permisos', () => {
  test('CP-34 el registro ciudadano siempre crea rol vecino (no se puede elevar privilegios)', async () => {
    const email = `v${RUN}@test.cl`;
    const r = await api('POST', '/auth/registro', { body: { nombre: 'Vecino Nuevo', email, password: 'Clave1234', rol: 'admin', id_rol: 1 } });
    assert.equal(r.status, 201);
    const l = await api('POST', '/auth/login', { body: { email, password: 'Clave1234' } });
    assert.equal(l.data.usuario.rol, 'vecino');
    assert.equal((await api('GET', '/admin/usuarios', { token: l.data.token })).status, 403);
  });
  test('CP-35 contraseñas débiles y correos inválidos son rechazados; correo duplicado da 409', async () => {
    assert.equal((await api('POST', '/auth/registro', { body: { nombre: 'A', email: 'a@b.cl', password: '1234' } })).status, 400);
    assert.equal((await api('POST', '/auth/registro', { body: { nombre: 'A', email: 'no-es-correo', password: 'Clave1234' } })).status, 400);
    assert.equal((await api('POST', '/auth/registro', { body: { nombre: 'A', email: 'vecino@pac.demo', password: 'Clave1234' } })).status, 409);
  });
  test('CP-36 login incorrecto da el mismo mensaje para usuario inexistente y clave errónea', async () => {
    const a = await api('POST', '/auth/login', { body: { email: 'vecino@pac.demo', password: 'mala' } });
    const b = await api('POST', '/auth/login', { body: { email: 'noexiste@pac.demo', password: 'mala' } });
    assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.data.error, b.data.error);
  });
  test('CP-37 las funciones internas exigen autenticación y rol adecuado', async () => {
    for (const [m, p] of [['GET', '/admin/usuarios'], ['GET', '/admin/auditoria'], ['GET', '/alertas'], ['GET', '/precios/mios'], ['POST', '/vencimientos/ejecutar']]) {
      assert.equal((await api(m, p)).status, 401, `${m} ${p} sin token`);
    }
    assert.equal((await api('GET', '/admin/usuarios', { token: await T.fisc() })).status, 403);
    assert.equal((await api('GET', '/precios/mios', { token: await T.vecino() })).status, 403);
    assert.equal((await api('GET', '/productos')).status, 200); // el portal público no exige login
  });
  test('CP-38 el admin crea usuarios con rol y alcance; valida asignaciones', async () => {
    const t = await T.admin();
    assert.equal((await api('POST', '/admin/usuarios', { token: t, body: { email: `c${RUN}@t.cl`, nombre: 'C', password: 'Clave1234', rol: 'comercio' } })).status, 400);
    const ok = await api('POST', '/admin/usuarios', { token: t, body: { email: `c${RUN}@t.cl`, nombre: 'C', password: 'Clave1234', rol: 'comercio', id_comercio: ids.comTest } });
    assert.equal(ok.status, 201);
    assert.equal((await api('PUT', `/admin/usuarios/${ok.data.id_usuario}/activo`, { token: t, body: { activo: false } })).status, 200);
    const l = await api('POST', '/auth/login', { body: { email: `c${RUN}@t.cl`, password: 'Clave1234' } });
    assert.equal(l.status, 401); // usuario desactivado no puede ingresar
  });
  test('CP-39 un token manipulado o vencido se trata como anónimo', async () => {
    assert.equal((await api('GET', '/auth/me', { token: 'abc.def.ghi' })).status, 401);
    const t = await T.admin();
    assert.equal((await api('GET', '/auth/me', { token: t.slice(0, -3) + 'xxx' })).status, 401);
  });
  test('CP-40 las contraseñas se guardan con hash scrypt (no en texto plano)', async () => {
    const { rows } = await pool.query("SELECT password_hash FROM usuario WHERE email='admin@pac.demo'");
    assert.match(rows[0].password_hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    assert.ok(!rows[0].password_hash.includes('Observatorio'));
  });
});

describe('R9 Validación de información (revisión, anomalías, vigencia)', () => {
  test('CP-41 un precio absurdo queda retenido, no se publica y genera alerta', async () => {
    const act = await precioActual(ids.papa, ids.pepe);
    const r = await api('POST', '/precios', { token: await T.fisc(), body: { id_producto: ids.papa, id_sucursal: ids.pepe, valor_normal: 15000 } });
    assert.equal(r.status, 202); assert.equal(r.data.estado, 'retenido'); assert.ok(r.data.id_alerta && r.data.motivo);
    assert.equal((await precioActual(ids.papa, ids.pepe)).valor_normal, act.valor_normal); // sigue el anterior
    ids.alertaRetenida = r.data.id_alerta;
  });
  test('CP-42 el admin aprueba la alerta y el precio pasa a vigente', async () => {
    const r = await api('POST', `/alertas/${ids.alertaRetenida}/aprobar`, { token: await T.admin() });
    assert.equal(r.status, 200);
    assert.equal((await precioActual(ids.papa, ids.pepe)).valor_normal, 15000);
    assert.equal((await api('POST', `/alertas/${ids.alertaRetenida}/aprobar`, { token: await T.admin() })).status, 409); // ya resuelta
  });
  test('CP-43 el admin rechaza una alerta y el precio no se publica', async () => {
    const r = await api('POST', '/precios', { token: await T.fisc(), body: { id_producto: ids.papa, id_sucursal: ids.pepe, valor_normal: 3 } });
    assert.equal(r.status, 202);
    assert.equal((await api('POST', `/alertas/${r.data.id_alerta}/rechazar`, { token: await T.admin() })).status, 200);
    assert.equal((await precioActual(ids.papa, ids.pepe)).valor_normal, 15000);
    const { rows } = await pool.query('SELECT estado FROM precio WHERE id_precio = $1', [r.data.id_precio]);
    assert.equal(rows[0].estado, 'rechazado');
    // restaurar un valor razonable para no afectar otras pruebas
    await pool.query("UPDATE precio SET estado='inactivo' WHERE id_producto=$1 AND id_sucursal=$2 AND estado='vigente'", [ids.papa, ids.pepe]);
    await pool.query("INSERT INTO precio (id_producto,id_sucursal,id_usuario,valor_normal,fuente,estado) SELECT $1,$2,id_usuario,1100,'formulario','vigente' FROM usuario WHERE email='admin@pac.demo'", [ids.papa, ids.pepe]);
  });
  test('CP-44 solo el administrador resuelve alertas', async () => {
    assert.equal((await api('POST', '/alertas/1/aprobar', { token: await T.fisc() })).status, 403);
    assert.equal((await api('POST', '/alertas/1/aprobar', { token: await T.comercio() })).status, 403);
    assert.equal((await api('POST', '/alertas/999999/aprobar', { token: await T.admin() })).status, 404);
  });
  test('CP-45 las ofertas vencidas dejan de mostrarse como activas y se conserva su historial', async () => {
    const act = await precioActual(ids.zapallo, ids.feria);
    assert.equal(act.oferta_activa, true);
    await pool.query('UPDATE precio SET vigencia_hasta = CURRENT_DATE - 1 WHERE id_precio = $1', [act.id_precio]);
    // incluso antes de correr la tarea, la vista ya no la muestra como oferta
    let x = await precioActual(ids.zapallo, ids.feria);
    assert.equal(x.oferta_activa, false); assert.equal(x.valor_final, x.valor_normal);
    const r = await api('POST', '/vencimientos/ejecutar', { token: await T.admin() });
    assert.ok(r.data.ofertas_desactivadas >= 1);
    const { rows } = await pool.query('SELECT estado_oferta, valor_oferta FROM precio WHERE id_precio = $1', [act.id_precio]);
    assert.equal(rows[0].estado_oferta, 'vencida'); assert.ok(rows[0].valor_oferta > 0); // historial conservado
  });
  test('CP-46 los reportes ciudadanos llegan al fiscalizador, que los cierra', async () => {
    const r = await api('POST', '/reportes', { token: await T.vecino(), body: { id_producto: ids.papa, id_sucursal: ids.feria, valor_observado: 1200, comentario: 'En el local cobran más' } });
    assert.equal(r.status, 201);
    const lista = await api('GET', '/alertas', { token: await T.fisc() });
    assert.ok(lista.data.every((a) => a.tipo === 'reporte') && lista.data.some((a) => a.id_alerta === r.data.id_alerta));
    assert.equal((await api('POST', `/alertas/${r.data.id_alerta}/cerrar`, { token: await T.fisc() })).status, 200);
    assert.equal((await api('POST', '/reportes', { body: { id_producto: ids.papa, id_sucursal: ids.feria } })).status, 401);
  });
});

describe('R10 Carga masiva', () => {
  const csv = (rows) => 'producto_id,sucursal_id,precio_normal,precio_oferta,vigencia_desde,vigencia_hasta,condiciones\n' + rows.join('\n') + '\n';
  test('CP-47 la plantilla CSV se descarga con las columnas esperadas', async () => {
    const res = await api('GET', '/carga/plantilla.csv', { token: await T.comercio(), raw: true });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /producto_id,sucursal_id,precio_normal/);
  });
  test('CP-48 la vista previa informa filas válidas y errores por fila sin guardar', async () => {
    const sin = await pool.query('SELECT COUNT(*)::int n FROM precio');
    const contenido = csv([
      `${ids.tomate},${ids.pepe},1600,,,,`,                       // ok
      `${ids.papa},${ids.pepe},abc,,,,`,                           // precio invalido
      `${ids.papa},${ids.feria},1000,,,,`,                         // sucursal ajena (comercio)
      `999999,${ids.pepe},1000,,,,`,                               // producto inexistente
      `${ids.zapallo},${ids.pepe},1000,900,${ayer()},${enDias(5)},Compra mínima`, // ok con oferta
      `${ids.tomate},${ids.pepe},1700,,,,`                         // duplicada en archivo
    ]);
    const r = await api('POST', '/carga/previsualizar', { token: await T.comercio(), body: { nombre: 'test.csv', formato: 'csv', contenido } });
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 6); assert.equal(r.data.validas, 2); assert.equal(r.data.con_error, 4);
    assert.deepEqual(r.data.errores.map((e) => e.fila).sort(), [3, 4, 5, 7]);
    const con = await pool.query('SELECT COUNT(*)::int n FROM precio');
    assert.equal(con.rows[0].n, sin.rows[0].n); // no guardó nada
  });
  test('CP-49 al confirmar, los precios quedan retenidos y siguen el flujo de aprobación', async () => {
    const act = await precioActual(ids.tomate, ids.pepe);
    const contenido = csv([`${ids.tomate},${ids.pepe},${act.valor_normal + 20},,,,Por caja`]);
    const r = await api('POST', '/carga/confirmar', { token: await T.comercio(), body: { nombre: 'lote.csv', formato: 'csv', contenido } });
    assert.equal(r.status, 202); assert.equal(r.data.enviadas_a_aprobacion, 1);
    assert.equal((await precioActual(ids.tomate, ids.pepe)).valor_normal, act.valor_normal); // aún no publicado
    const al = (await api('GET', '/alertas', { token: await T.admin() })).data.find((a) => a.tipo === 'carga_masiva' && a.valor_normal === act.valor_normal + 20);
    assert.ok(al);
    assert.equal((await api('POST', `/alertas/${al.id_alerta}/aprobar`, { token: await T.admin() })).status, 200);
    assert.equal((await precioActual(ids.tomate, ids.pepe)).valor_normal, act.valor_normal + 20);
  });
  test('CP-50 acepta archivos Excel (.xlsx)', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Precios');
    ws.addRow(['producto_id', 'sucursal_id', 'precio_normal', 'precio_oferta', 'vigencia_desde', 'vigencia_hasta', 'condiciones']);
    ws.addRow([ids.choclo, ids.pepe, 7000, '', '', '', '']); // anomalo respecto del resto -> retenido igualmente
    ws.addRow([ids.zanahoria, ids.pepe, 'x', '', '', '', '']);
    const base64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const r = await api('POST', '/carga/previsualizar', { token: await T.comercio(), body: { nombre: 'p.xlsx', formato: 'xlsx', contenido: base64 } });
    assert.equal(r.status, 200); assert.equal(r.data.validas, 1); assert.equal(r.data.con_error, 1);
  });
  test('CP-51 archivos inválidos: sin columnas, vacío, mal formado, sin permisos', async () => {
    const t = await T.comercio();
    const p = (contenido, tok = t) => api('POST', '/carga/previsualizar', { token: tok, body: { formato: 'csv', contenido } });
    assert.equal((await p('a,b\n1,2\n')).status, 400);
    assert.equal((await p('producto_id,sucursal_id,precio_normal,precio_oferta,vigencia_desde,vigencia_hasta,condiciones\n')).status, 400);
    assert.equal((await p('a,b\n"1,2,3\n')).status, 400);
    assert.equal((await p(csv([`${ids.papa},${ids.pepe},1000,,,,`]), await T.vecino())).status, 403);
    assert.equal((await p(csv([`${ids.papa},${ids.pepe},1000,,,,`]), await T.fisc())).status, 403);
  });
});

describe('R11-R13 Portal responsive, accesibilidad y transparencia', () => {
  test('CP-52 el portal se sirve con viewport móvil y estilos responsivos', async () => {
    const html = await (await fetch(BASE + '/')).text();
    assert.match(html, /name="viewport"/); assert.match(html, /lang="es"/);
    const css = await (await fetch(BASE + '/css/app.css')).text();
    assert.match(css, /@media/); assert.match(css, /min-height:\s*44px/);
  });
  test('CP-53 criterios de accesibilidad presentes en el HTML (enlace de salto, etiquetas, región en vivo)', async () => {
    const html = await (await fetch(BASE + '/')).text();
    assert.match(html, /class="skip"/); assert.match(html, /aria-live/); assert.match(html, /<main/); assert.match(html, /aria-label="Navegación principal"/);
    const css = await (await fetch(BASE + '/css/app.css')).text();
    assert.match(css, /:focus-visible/); assert.match(css, /prefers-color-scheme: dark/);
  });
  test('CP-54 cada precio muestra comercio, sucursal, fuente, fecha, vigencia y condiciones', async () => {
    const r = await api('GET', `/productos/${ids.papa}/precios`);
    for (const x of r.data.resultados) {
      for (const k of ['comercio', 'sucursal', 'fuente', 'fecha_observacion', 'vigencia_hasta', 'condiciones']) assert.ok(k in x, 'falta ' + k);
      assert.ok(x.fuente && x.fecha_observacion);
    }
  });
  test('CP-55 explica el método de recolección y advierte sobre el stock', async () => {
    const r = await api('GET', '/transparencia');
    assert.match(r.data.metodo, /fiscalizadores/); assert.match(r.data.advertencia, /stock/);
  });
});

describe('R14 Reportes', () => {
  test('CP-56 exporta Excel con metadatos (fecha, período, unidades, fuente) y datos iguales al panel', async () => {
    const t = await T.admin();
    const panel = (await api('GET', '/admin/indicadores?dias=30&categoria=1', { token: t })).data;
    const res = await api('GET', '/admin/reportes/indicadores.xlsx?dias=30&categoria=1', { token: t, raw: true });
    assert.equal(res.status, 200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const ws = wb.getWorksheet('Indicadores');
    assert.equal(ws.rowCount - 1, panel.productos.length);
    assert.equal(ws.getRow(2).getCell(1).value, panel.productos[0].nombre);
    assert.equal(ws.getRow(2).getCell(4).value, panel.productos[0].promedio);
    const meta = wb.getWorksheet('Metadatos').getSheetValues().flat().filter(Boolean).join(' ');
    assert.match(meta, /Fecha de generación/); assert.match(meta, /Período analizado/); assert.match(meta, /Unidades/); assert.match(meta, /Fuente/);
  });
  test('CP-57 exporta PDF válido y solo para administradores', async () => {
    const res = await api('GET', '/admin/reportes/indicadores.pdf', { token: await T.admin(), raw: true });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.slice(0, 5).toString(), '%PDF-'); assert.ok(buf.length > 1500);
    assert.equal((await api('GET', '/admin/reportes/indicadores.pdf', { token: await T.fisc(), raw: true })).status, 403);
    assert.equal((await api('GET', '/admin/reportes/indicadores.xlsx?dias=2', { token: await T.admin() })).status, 400);
  });
});

describe('R15 Auditoría', () => {
  test('CP-58 registra creaciones, aprobaciones y cambios con usuario, fecha y valores', async () => {
    const r = await api('GET', '/admin/auditoria?limite=300', { token: await T.admin() });
    assert.equal(r.status, 200);
    const acciones = new Set(r.data.map((l) => l.accion));
    for (const a of ['CREAR', 'RETENER', 'APROBAR', 'RECHAZAR', 'CARGAR']) assert.ok(acciones.has(a), 'falta acción ' + a);
    const c = r.data.find((l) => l.entidad === 'precio' && l.accion === 'CREAR');
    assert.ok(c.usuario && c.fecha && c.valor_nuevo);
  });
  test('CP-59 la bitácora es inmutable: UPDATE, DELETE y TRUNCATE son rechazados por la base', async () => {
    await assert.rejects(pool.query("UPDATE log_auditoria SET accion='X'"), /solo insercion/);
    await assert.rejects(pool.query('DELETE FROM log_auditoria'), /solo insercion/);
    await assert.rejects(pool.query('TRUNCATE log_auditoria'), /solo insercion/);
  });
  test('CP-60 la consulta de la bitácora está restringida', async () => {
    assert.equal((await api('GET', '/admin/auditoria', { token: await T.fisc() })).status, 403);
    assert.equal((await api('GET', '/admin/auditoria', { token: await T.comercio() })).status, 403);
    assert.equal((await api('GET', '/admin/auditoria')).status, 401);
  });
});

describe('R16 Seguridad y rendimiento', () => {
  test('CP-61 cabeceras de seguridad (CSP, nosniff, sin x-powered-by, anti-clickjacking)', async () => {
    const r = await api('GET', '/health');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  });
  test('CP-62 errores no filtran detalles internos (JSON inválido, ruta inexistente, id malformado)', async () => {
    const mal = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{malo' });
    assert.equal(mal.status, 400); assert.ok(!(await mal.text()).includes('at '));
    assert.equal((await api('GET', '/nada')).status, 404);
    assert.equal((await api('PUT', '/admin/usuarios/no-uuid/activo', { token: await T.admin(), body: { activo: true } })).status, 400);
  });
  test('CP-63 inyección SQL en la búsqueda y en el login no rompe ni evade la autenticación', async () => {
    const s = await api('GET', '/productos?q=' + encodeURIComponent("'; DROP TABLE producto;--"));
    assert.equal(s.status, 200);
    const l = await api('POST', '/auth/login', { body: { email: "admin@pac.demo' OR '1'='1", password: "' OR '1'='1" } });
    assert.equal(l.status, 401);
    assert.equal((await api('GET', '/productos')).data.length >= 13, true);
  });
  test('CP-64 límite de intentos de login (fuerza bruta) devuelve 429', async () => {
    const http = await import('node:http');
    const { createApp } = await import('../src/app.js');
    const srv = http.createServer(createApp({ limits: { login: 3, api: 1000 } }));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const codes = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'vecino@pac.demo', password: 'mala' }) });
      codes.push(r.status);
    }
    await new Promise((r) => srv.close(r));
    assert.deepEqual(codes.slice(0, 3), [401, 401, 401]); assert.ok(codes.includes(429), codes.join());
  });
  test('CP-65 estrés: 120 consultas concurrentes del comparador responden 200 con p95 < 1,5 s', async () => {
    const tiempos = []; let ok = 0;
    await Promise.all(Array.from({ length: 120 }, async (_, i) => {
      const t0 = performance.now();
      const r = await api('GET', `/productos/${[ids.papa, ids.tomate, ids.zapallo][i % 3]}/precios?orden=distancia&lat=-33.49&lng=-70.66`);
      tiempos.push(performance.now() - t0); if (r.status === 200) ok++;
    }));
    tiempos.sort((a, b) => a - b);
    const p95 = tiempos[Math.floor(tiempos.length * 0.95)];
    assert.equal(ok, 120); assert.ok(p95 < 1500, `p95 = ${Math.round(p95)} ms`);
  });
  test('CP-66 concurrencia: dos publicaciones simultáneas del mismo precio no dejan dos vigentes ni dan error 500', async () => {
    const act = await precioActual(ids.zanahoria, ids.super);
    const body = { id_producto: ids.zanahoria, id_sucursal: ids.super, valor_normal: act.valor_normal + 30 };
    const t = await T.admin();
    const rs = await Promise.all([api('POST', '/precios', { token: t, body }), api('POST', '/precios', { token: t, body }), api('POST', '/precios', { token: t, body })]);
    assert.ok(rs.every((r) => [201, 409].includes(r.status)), rs.map((r) => r.status).join());
    const { rows } = await pool.query("SELECT COUNT(*)::int n FROM precio WHERE id_producto=$1 AND id_sucursal=$2 AND estado='vigente'", [ids.zanahoria, ids.super]);
    assert.equal(rows[0].n, 1);
  });
  test('CP-67 salud del servicio: /api/health verifica la base de datos', async () => {
    const r = await api('GET', '/health');
    assert.equal(r.status, 200); assert.equal(r.data.db, 'ok');
  });
});
