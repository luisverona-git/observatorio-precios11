// Registra una accion en la bitacora inmutable (usa el cliente de la transaccion si se entrega)
export async function audit(db, userId, accion, entidad, idEntidad, previo = null, nuevo = null) {
  await db.query(
    `INSERT INTO log_auditoria (id_usuario, accion, entidad, id_entidad, valor_previo, valor_nuevo)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId ?? null, accion, entidad, String(idEntidad ?? ''), previo ? JSON.stringify(previo) : null, nuevo ? JSON.stringify(nuevo) : null]);
}
