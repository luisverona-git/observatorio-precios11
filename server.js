import 'dotenv/config';
import { createApp } from './app.js';
import { initDb } from './init.js';
import { programarVencimientos } from './services/vencimientos.js';

const PORT = process.env.PORT || 3000;

async function main() {
  const sembrado = await initDb();
  console.log(`Base de datos lista${sembrado ? ' (datos de demostración cargados)' : ''}.`);
  programarVencimientos();
  createApp().listen(PORT, '0.0.0.0', () => console.log(`Observatorio de Precios escuchando en el puerto ${PORT}`));
}
main().catch((e) => { console.error('No se pudo iniciar:', e.message); process.exit(1); });
