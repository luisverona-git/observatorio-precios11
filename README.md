# Observatorio de Precios del comercio local · Pedro Aguirre Cerda

Plataforma municipal (DIDESE) para **consultar, comparar y administrar precios y ofertas** del comercio local.
Proyecto integrado TIHI43 · Unidad 3 (implementación). Autor: Luis Jeampool Verona Chavez.

**Tecnología:** Node.js 22 + Express · PostgreSQL 16 con PostGIS y pg_trgm · portal web mobile-first (HTML/CSS/JS sin frameworks) · Leaflet + OpenStreetMap · ExcelJS y PDFKit para reportes.

## Qué incluye (lista de verificación de 16 requerimientos)
Catálogo normalizado · comercios y sucursales geolocalizadas · precios y ofertas con vigencia e historial · buscador tolerante a modismos y errores · comparador por precio/distancia/vigencia · mapa con lista alternativa · historial con gráficos · panel de indicadores · 5 roles y permisos · validación (precios sospechosos retenidos, duplicados, ofertas vencidas se desactivan solas) · carga masiva CSV/Excel con vista previa e informe de errores · portal responsive · accesibilidad · transparencia · reportes Excel/PDF · auditoría inmutable · seguridad y respaldo.

> No incluido en esta entrega (planificado en la Unidad 2, sprints 5-6): API B2B para cadenas, ingesta por foto (OCR) y búsqueda semántica con IA (embeddings). La búsqueda actual usa sinónimos/modismos y similitud de texto.

## Ejecutar en tu computador
```bash
# 1) PostgreSQL con PostGIS instalado (ej.: Docker)
docker run -d --name obs-db -e POSTGRES_USER=obs -e POSTGRES_PASSWORD=obs -e POSTGRES_DB=observatorio -p 5432:5432 postgis/postgis:16-3.4
# 2) Proyecto
cp .env.example .env
npm install
npm start            # crea las tablas y carga datos de demostración la primera vez
# abrir http://localhost:3000
```
Cuentas demo (contraseña = `DEMO_PASSWORD`, por defecto `Observatorio2026` en local):
`admin@pac.demo` · `fisc@pac.demo` · `comercio@pac.demo` · `puesto@pac.demo` · `vecino@pac.demo`

## Despliegue gratuito paso a paso
1. **Base de datos en la nube (gratis).**
   - *Neon* (recomendado): crea un proyecto en neon.tech y copia la *connection string*. PostGIS y pg_trgm vienen disponibles.
   - *Supabase*: crea el proyecto → Connect → **Session pooler** (Render gratis solo usa IPv4; la conexión directa de Supabase es IPv6). Si la contraseña tiene símbolos, codifícala en la URL.
2. **GitHub:** sube este proyecto (el `.gitignore` excluye `.env` y `node_modules`).
3. **Render:** *New → Blueprint* → elige el repositorio (usa `render.yaml`, plan **Free**). Cuando lo pida, pega `DATABASE_URL`. `JWT_SECRET` y `DEMO_PASSWORD` se generan solos (míralos en *Environment*).
4. Espera el *build* y abre `https://TU-SERVICIO.onrender.com/api/health` → debe responder `{"status":"ok","db":"ok"}`.
5. Primer arranque: crea el esquema y los datos de demostración automáticamente.

**Limitaciones del plan gratuito:** el servicio se duerme tras ~15 min sin tráfico (la primera visita tarda 30-60 s). Los datos **sí se conservan** porque la base está fuera de Render.

## Pruebas
```bash
DATABASE_URL=postgres://... npm test     # 79 pruebas: API (67) + interfaz con jsdom (12)
```
Usa una base de datos **de pruebas** (se crean registros). Mapa de pruebas ↔ requerimientos: informe final.

## Respaldo y restauración
```bash
DATABASE_URL=... npm run backup                                   # genera backups/*.dump (pg_dump)
ORIGEN_URL=... DESTINO_URL=... bash scripts/restore-test.sh backups/archivo.dump   # restaura y compara filas
```
Neon y Supabase además hacen respaldos automáticos propios (según plan).

## Roles y permisos
| Rol | Puede |
|---|---|
| Vecino (público/registrado) | Buscar, comparar, mapa, historial, canasta; reportar precios (registrado) |
| Local / puesto | Registrar precios de **su** sucursal |
| Comercio | Registrar precios y cargas masivas de **sus** sucursales |
| Fiscalizador | Registrar precios en terreno (cualquier local); cerrar reportes ciudadanos |
| Administrador DIDESE | Todo: catálogo, comercios, usuarios, aprobar/rechazar, indicadores, reportes, auditoría |

## Seguridad
Contraseñas con scrypt · sesiones JWT de 8 h · consultas SQL parametrizadas · límite de intentos de login (10/15 min) y de solicitudes · cabeceras seguras (Helmet + CSP) · bitácora inmutable (trigger en la base) · validación de entradas · errores sin detalles internos · HTTPS provisto por Render.

## Estructura
```
db/schema.sql      Modelo relacional (14 tablas, 28 índices, vista, triggers)
src/               Servidor Express: routes/, services/, middleware/
public/            Portal web (index.html, css, js)
scripts/           migrate.js, backup.sh, restore-test.sh
tests/             Pruebas automatizadas (API + interfaz)
render.yaml        Despliegue en Render
```
