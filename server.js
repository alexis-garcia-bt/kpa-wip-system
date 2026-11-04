/**
 * ============================================================================
 * KPA PACKAGING & HANDLING SOLUTIONS - BACKEND ARCHITECTURE (NODE.JS & EXPRESS)
 * Versión Final 11.0.0 - Soporte para Fecha de Proceso y Control de Racks
 * ============================================================================
 */

const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(__dirname));

const dbConfig = {
    host: 'blrlso7apd6u8ura9jhp-mysql.services.clever-cloud.com',
    user: 'ud8kufsf7k8ovhp8',
    password: 'fujMvI1T9ZBMUjQ8TPTC',
    database: 'blrlso7apd6u8ura9jhp',
    port: 3306,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 20000,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Usamos un pool en lugar de una conexión única para evitar fugas de memoria RAM
const db = mysql.createPool(dbConfig);
let estaConectado = true;

// Verificamos la conexión inicial del pool
db.getConnection((err, connection) => {
    if (err) {
        estaConectado = false;
        console.error(' [KPA Base de Datos]: Error al conectar con Clever Cloud:', err.message);
    } else {
        estaConectado = true;
        console.log(' [KPA Base de Datos]: Conectado exitosamente con Clever Cloud (Pool activo).');
        connection.release();
    }
});

// Endpoints de la API
app.get('/api/proyecto/:query', (req, res) => {
    const termino = req.params.query.toUpperCase();
    const querySQL = "SELECT DISTINCT id_proyecto, nombre_producto FROM inventario_kpa WHERE id_proyecto LIKE ? OR nombre_producto LIKE ? LIMIT 15";

    if (!estaConectado || !db) {
        return res.json([{ id_proyecto: termino, nombre_producto: "MATERIAL WIP KPA" }]);
    }

    db.query(querySQL, [`%${termino}%`, `%${termino}%`], (err, resultados) => {
        if (err || !resultados || resultados.length === 0) {
            return res.json([{ id_proyecto: termino, nombre_producto: "MATERIAL WIP KPA" }]);
        }
        res.json(resultados);
    });
});

// Ruta para buscar materiales e inventario procesando operador y ubicaciones
// Ruta para buscar materiales extrayendo rack y lado del texto guardado
// Ruta para buscar materiales en inventario con todo el detalle de ubicación (Nivel, Lado, Apilado) y filtro de SALIDAS
app.get('/api/materiales', (req, res) => {
    const q = req.query.p || req.query.q || '';
    const sql = `SELECT * FROM movimientos WHERE proyecto LIKE ? OR ubicacion_destino LIKE ? ORDER BY fecha_hora DESC`;
    
    if (!estaConectado || !db) return res.json([]);
    
    db.query(sql, [`%${q}%`, `%${q}%`], (err, filas) => {
        if (err) return res.json([]);
        
        const inventarioMap = new Map();

        // Agrupamos para obtener siempre el movimiento más reciente de cada proyecto
        filas.forEach(item => {
            const clave = (item.proyecto || 'GENERAL').toUpperCase().trim();
            if (!inventarioMap.has(clave)) {
                inventarioMap.set(clave, item);
            }
        });

        const activos = [];
        inventarioMap.forEach((item, clave) => {
            // SÓLO agregamos al inventario si su movimiento MÁS RECIENTE NO ES UNA SALIDA
            if (item.tipo_movimiento && item.tipo_movimiento.toUpperCase() !== 'SALIDA') {
                let rackVal = item.rack && item.rack !== 'N/A' ? item.rack : 'N/A';
                let nivelVal = item.nivel && item.nivel !== 'N/A' ? item.nivel : 'N1';
                let ladoVal = item.lado && item.lado !== 'N/A' ? item.lado : 'IZQUIERDO';
                let apiladoVal = item.apilado && item.apilado !== 'N/A' ? item.apilado : '1';

                // Si por alguna razón el rack está en N/A pero viene en la cadena de ubicación destino, lo desglosamos
                if (rackVal === 'N/A' && item.ubicacion_destino && item.ubicacion_destino.includes('RACK')) {
                    // Ejemplo: "RACK R14, Nivel: N2, Lado: IZQUIERDO, Pos: 7"
                    let partes = item.ubicacion_destino.split(',');
                    partes.forEach(part => {
                        let p = part.trim();
                        if (p.includes('RACK')) rackVal = p.replace('RACK', '').trim();
                        if (p.includes('Nivel:')) nivelVal = p.replace('Nivel:', '').trim();
                        if (p.includes('Lado:')) ladoVal = p.replace('Lado:', '').trim();
                        if (p.includes('Pos:')) apiladoVal = p.replace('Pos:', '').trim();
                    });
                }

                const operadorDinamico = item.nombre_operador && item.nombre_operador.trim() !== '' 
                    ? item.nombre_operador 
                    : 'OPERADOR GENERAL';

                activos.push({
                    ...item,
                    operador: operadorDinamico,
                    personal: operadorDinamico,
                    nombre_operador: operadorDinamico,
                    rack: rackVal,
                    nivel: nivelVal,
                    lado: ladoVal,
                    apilado: apiladoVal
                });
            }
        });

        // Devolvemos todo el inventario activo de la planta sin restricciones
        res.json(activos);
    });
});

app.get('/api/historial', (req, res) => {
    const sql = `SELECT * FROM movimientos ORDER BY fecha_hora DESC LIMIT 50`;
    if (!estaConectado || !db) return res.json([]);
    
    db.query(sql, (err, filas) => {
        if (err) return res.json([]);
        res.json(filas.map(item => {
            const operadorDinamico = item.nombre_operador && item.nombre_operador.trim() !== '' 
                ? item.nombre_operador 
                : 'OPERADOR GENERAL';
            return {
                ...item,
                operador: operadorDinamico,
                personal: operadorDinamico,
                nombre_operador: operadorDinamico
            };
        }));
    });
});


// Registro de movimientos incluyendo la fecha de proceso solicitada y manejo seguro de nulos
app.post('/api/movimientos', (req, res) => {
    if (!db) {
        return res.status(500).json({ success: false, error: 'Base de datos no conectada' });
    }

    const data = req.body || {};

    // 1. ORIGEN: Capturamos de dónde viene en las entradas o reubicaciones
    let procedenciaOrVal = data.procedencia_origen || data.origen || 'PRODUCCIÓN';
    let ubicacionOrigenVal = procedenciaOrVal;
    
    if (data.rack_origen && data.rack_origen !== 'N/A') {
        ubicacionOrigenVal = `Retirado de: RACK ${data.rack_origen}, Nivel: ${data.nivel_origen || 'N/A'}, Lado: ${data.lado_origen || 'A'}, Pos: ${data.apilado_origen || '1'}`;
    } else {
        // Si es una entrada normal, dejamos constancia de su procedencia exacta (ej. Producción, Lote G, etc.)
        ubicacionOrigenVal = `Procedencia: ${procedenciaOrVal}`;
    }

    // 2. DESTINO: Si es SALIDA, forzamos a que guarde el destino externo exacto que eligió el usuario
    const rackDestinoRaw = data.rack_destino || data.rackDestino || data.rack || 'N/A';
    
    let rackDestino = rackDestinoRaw;
    let nivelDestino = data.nivel_destino || data.nivelDestino || data.nivel || 'N1';
    let ladoDestino = data.lado_destino || data.ladoDestino || data.lado || 'IZQUIERDO';
    let posDestino = data.apilado || data.posicion || data.pos || '1';

    let ubicacionDestinoVal = '';
    if (data.tipo_movimiento === 'SALIDA') {
        // Aquí aseguramos que viaje el texto real (Basura, Embarques o Producción) sin que se sobrescriba
        ubicacionDestinoVal = `Destino Externo: ${rackDestinoRaw}`;
        rackDestino = 'N/A'; 
        nivelDestino = 'N/A';
        ladoDestino = 'N/A';
        posDestino = '1';
    } else if (rackDestino !== 'N/A') {
        ubicacionDestinoVal = `RACK ${rackDestino}, Nivel: ${nivelDestino}, Lado: ${ladoDestino}, Pos: ${posDestino}`;
    } else {
        ubicacionDestinoVal = data.ubicacion_destino || 'N/A';
    }

    const nombreOperadorVal = data.nombre_operador || data.operador || data.usuario || data.personal || 'OPERADOR GENERAL';
    const idOperadorVal = data.id_operador || data.idOperador || 1;

    let fechaProcesoVal = data.fecha_proceso;
    if (!fechaProcesoVal || fechaProcesoVal.includes('1111') || fechaProcesoVal.length < 8) {
        fechaProcesoVal = null;
    }

    const sqlInsert = `
        INSERT INTO movimientos 
        (id_material, id_operador, tipo_movimiento, proyecto, piezas, fecha_proceso, ubicacion_origen, ubicacion_destino, rack, nivel, lado, posicion, nombre_operador) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sqlInsert, [
        data.id_material || 1,
        idOperadorVal,
        data.tipo_movimiento || 'REGISTRO',
        data.proyecto || 'GENERAL',
        data.piezas || 0,
        fechaProcesoVal,
        ubicacionOrigenVal,
        ubicacionDestinoVal,
        rackDestino,
        nivelDestino,
        ladoDestino,
        posDestino,
        nombreOperadorVal
    ], (err, resultado) => {
        if (err) {
            console.error("Error al insertar en BD:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, id: resultado.insertId });
    });
});
app.get('/api/personal', (req, res) => {
    const operadoresCompletos = [
        { id_operador: 1, rol: 'ADMIN', nombre: 'ALEXIS GARCIA', turno: 'MATUTINO' },
        { id_operador: 2, rol: 'ADMIN', nombre: 'LIZETH FRANCO', turno: 'MATUTINO' },
        { id_operador: 3, rol: 'MONTACARGUISTA', nombre: 'CRISTIAN RAMIREZ', turno: 'MATUTINO' },
        { id_operador: 4, rol: 'MONTACARGUISTA', nombre: 'MARCOS BASILIO', turno: 'MATUTINO' },
        { id_operador: 5, rol: 'MONTACARGUISTA', nombre: 'PABLO MENDOZA', turno: 'MATUTINO' },
        { id_operador: 6, rol: 'MONTACARGUISTA', nombre: 'ISABEL BALDERAS', turno: 'MATUTINO' },
        { id_operador: 7, rol: 'MONTACARGUISTA', nombre: 'JOAQUIN SUAREZ', turno: 'MATUTINO' },
        { id_operador: 8, rol: 'MONTACARGUISTA', nombre: 'JUAN SANCHEZ', turno: 'MATUTINO' },
        { id_operador: 9, rol: 'MONTACARGUISTA', nombre: 'RICARDO MORENO', turno: 'MATUTINO' },
        { id_operador: 10, rol: 'LIDER', nombre: 'JOEL RIVERA', turno: 'MATUTINO' },
        { id_operador: 11, rol: 'LIDER', nombre: 'CAROLINA ROMERO', turno: 'MATUTINO' },
        { id_operador: 12, rol: 'LIDER', nombre: 'MAGDALENA ROMERO', turno: 'MATUTINO' },
        { id_operador: 13, rol: 'LIDER', nombre: 'KAREN AGUILLON', turno: 'MATUTINO' }
    ];

    const sqlPers = "SELECT * FROM operadores";
    
    if (!estaConectado || !db) {
        return res.json(operadoresCompletos);
    }

    db.query(sqlPers, (error, filas) => {
        if (error || !filas || filas.length === 0) {
            return res.json(operadoresCompletos);
        }
        
        const operadoresMapeados = filas.map(op => ({
            id_operador: op.id_operador || op.id || 1,
            rol: (op.rol || op.tipo || 'MONTACARGUISTA').toUpperCase(),
            nombre: (op.nombre || op.nombre_operador || 'OPERADOR').toUpperCase(),
            turno: op.turno || 'MATUTINO'
        }));

        res.json(operadoresMapeados.length > 0 ? operadoresMapeados : operadoresCompletos);
    });
});


app.get('/api/sugerencias', (req, res) => {
    res.json([]);
});
const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🚀 KPA BACKEND v11.0 CORRIENDO EN PUERTO: ${PUERTO}`);
});