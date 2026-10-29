/**
 * ============================================================================
 * KPA LOGISTICS SYSTEM - BACKEND ARCHITECTURE (NODE.JS & EXPRESS)
 * Versión Final 11.0.0 - Soporte para Fecha de Proceso y Control de Racks
 * ============================================================================
 */

const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const dbConfig = {
    host: 'bblrso7apd6u8ura9jhp-mysql.services.clever-cloud.com',
    user: 'ud8kufsf7k8ovhp8',
    password: 'fujMvII1T9ZDMUJQ8TPTC',
    database: 'bblrso7apd6u8ura9jhp',
    port: 3306,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 20000
};

let db = null;
let estaConectado = false;

function conectarDB() {
    db = mysql.createConnection(dbConfig);
    db.connect((err) => {
        if (err) {
            estaConectado = false;
            setTimeout(conectarDB, 10000);
        } else {
            estaConectado = true;
            console.log('✅ [KPA Base de Datos]: Conectado exitosamente con Clever Cloud.');
        }
    });

    db.on('error', (err) => {
        estaConectado = false;
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
            setTimeout(conectarDB, 10000);
        }
    });
}

conectarDB();

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

// Registro de movimientos incluyendo la fecha de proceso solicitada
app.post('/api/wip', (req, res) => {
    const data = req.body;
    
    const sqlInsert = `INSERT INTO movimientos 
        (id_material, id_operador, tipo_movimiento, ubicacion_origen, ubicacion_destino, fecha_hora) 
        VALUES (?, ?, ?, ?, ?, NOW())`;

    const idMaterialVal = 1; 
    const idOperadorVal = 1; 
    const ubicacionOrigenVal = data.rack_origen !== 'N/A' ? `${data.rack_origen}-${data.nivel_origen}` : 'INICIO';
    const ubicacionDestinoVal = `${data.rack_destino}-${data.nivel_destino} (${data.lado}, Pos:${data.apilado}, Pzas:${data.piezas}, F.Proceso:${data.fecha_proceso})`;

    if (!estaConectado || !db) {
        return res.json({ success: true, id: 'LOCAL-' + Date.now() });
    }

    db.query(sqlInsert, [
        idMaterialVal,
        idOperadorVal,
        data.tipo_movimiento,
        ubicacionOrigenVal,
        ubicacionDestinoVal
    ], (error, resultado) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.json({ success: true, id: resultado.insertId });
    });
});

app.get('/api/movimientos', (req, res) => {
    const sqlGet = "SELECT * FROM movimientos ORDER BY fecha_hora DESC LIMIT 100";
    if (!estaConectado || !db) return res.json([]);
    db.query(sqlGet, (error, filas) => {
        if (error) return res.json([]);
        res.json(filas);
    });
});

app.get('/api/ubicacion/:proyecto', (req, res) => {
    const sqlUbic = "SELECT * FROM movimientos ORDER BY fecha_hora DESC LIMIT 20";
    if (!estaConectado || !db) return res.json([]);
    db.query(sqlUbic, (error, filas) => {
        if (error) return res.json([]);
        res.json(filas);
    });
});

app.get('/api/personal', (req, res) => {
    const sqlPers = "SELECT * FROM operadores";
    if (!estaConectado || !db) {
        return res.json([
            { id_operador: 1, rol: 'ADMIN', nombre: 'ALEXIS GARCIA' },
            { id_operador: 2, rol: 'ADMIN', nombre: 'LIZETH FRANCO' },
            { id_operador: 3, rol: 'MONTACARGUISTA', nombre: 'CRISTIAN RAMIREZ' },
            { id_operador: 4, rol: 'MONTACARGUISTA', nombre: 'MARCOS BASILIO' },
            { id_operador: 5, rol: 'MONTACARGUISTA', nombre: 'PABLO MENDOZA' },
            { id_operador: 6, rol: 'MONTACARGUISTA', nombre: 'ISABEL BALDERAS' },
            { id_operador: 7, rol: 'MONTACARGUISTA', nombre: 'JOAQUIN SUAREZ' },
            { id_operador: 8, rol: 'MONTACARGUISTA', nombre: 'JUAN SANCHEZ' },
            { id_operador: 9, rol: 'MONTACARGUISTA', nombre: 'RICARDO MORENO' },
            { id_operador: 10, rol: 'LIDER', nombre: 'JOEL RIVERA' },
            { id_operador: 11, rol: 'LIDER', nombre: 'CAROLINA ROMERO' },
            { id_operador: 12, rol: 'LIDER', nombre: 'MAGDALENA ROMERO' },
            { id_operador: 13, rol: 'LIDER', nombre: 'KAREN AGUILLON' },
            
        ]);
    }
    db.query(sqlPers, (error, filas) => {
        if (error || !filas || filas.length === 0) {
            return res.json([
                { id_operador: 1, rol: 'MONTACARGUISTA', nombre: 'CRISTIAN RAMIREZ' },
                { id_operador: 2, rol: 'MONTACARGUISTA', nombre: 'MARCOS BASILIO' },
                { id_operador: 3, rol: 'LIDER', nombre: 'JOEL RIVERA' },
                { id_operador: 4, rol: 'ADMIN', nombre: 'ALEXIS GARCIA' }
            ]);
        }
        res.json(filas);
    });
});
app.get('/', (req, res) => {
    res.send('Servidor KPA WIP funcionando al 100% en la nube 🚀');
})
const PUERTO = 3000;
app.listen(PUERTO, () => {
    console.log(`🚀 KPA BACKEND v11.0 CORRIENDO EN: http://localhost:${PUERTO}`);
});