



require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const util = require('util');

const app = express();
const PORT = 10004;

// --- MIDDLEWARES ---
app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE", "PUT"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(__dirname));

app.use(session({
    secret: process.env.SESSION_SECRET || 'monSecretTresSecurise',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// --- CONFIGURATION DB (AIVEN) ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 26246,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 20000
};

let db;
let dbQuery;

function handleDisconnect() {
    db = mysql.createConnection(dbConfig);
    dbQuery = util.promisify(db.query).bind(db);

    db.connect((err) => {
        if (err) {
            console.error("❌ ERREUR CONNEXION :", err.message);
            setTimeout(handleDisconnect, 5000);
        } else {
            console.log("✅ Connecté à MySQL (Aiven)");
            initialiserBase();
        }
    });
}

function initialiserBase() {
    const sqlFactures = `CREATE TABLE IF NOT EXISTS factures (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom_client VARCHAR(255),
        tel_client VARCHAR(50),
        adresse_client VARCHAR(255),
        n_compte VARCHAR(100),
        centre VARCHAR(100),
        police VARCHAR(100),
        ordre VARCHAR(100),
        cle VARCHAR(50),
        code VARCHAR(100),
        code_regroupement VARCHAR(100),
        periode VARCHAR(50),
        date_limite VARCHAR(50),
        ancien DECIMAL(10,2),
        nouveau DECIMAL(10,2),
        prix DECIMAL(10,2)
    )`;

    const sqlHistorique = `CREATE TABLE IF NOT EXISTS historique_factures (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id INT,
        ancien DECIMAL(10,2),
        nouveau DECIMAL(10,2),
        prix DECIMAL(10,2),
        date_saisie TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;

    db.query(sqlFactures, (err) => {
        if (err) console.error("❌ Erreur table factures:", err);
        else console.log("✅ Table factures vérifiée/créée.");
    });
    db.query(sqlHistorique, (err) => {
        if (err) console.error("❌ Erreur table historique:", err);
        else console.log("✅ Table historique vérifiée/créée.");
    });
}

handleDisconnect();

// --- ROUTES ---

// 1. Routes globales
app.get('/api/factures', (req, res) => {
    db.query('SELECT * FROM factures', (err, results) => {
        if (err) res.status(500).send(err.message);
        else res.json(results);
    });
});

app.post('/api/factures', (req, res) => {
    const data = req.body;
    db.query('INSERT INTO factures SET ?', data, (err, result) => {
        if (err) res.status(500).send(err.message);
        else res.status(201).send('Facture ajoutée');
    });
});

// Route DELETE globale placée AVANT les routes avec /:id
app.delete('/api/factures', (req, res) => {
    db.query('TRUNCATE TABLE factures', (err, result) => {
        if (err) res.status(500).send(err.message);
        else res.status(200).send('Base de données réinitialisée');
    });
});


// 2. Routes spécifiques avec sous-dossier (DOIVENT être placées AVANT les routes /:id simples)

app.get('/api/factures/:id/historique', async (req, res) => {
    try {
        const rows = await dbQuery(
            "SELECT ancien, nouveau, prix, date_saisie FROM historique_factures WHERE client_id = ? ORDER BY date_saisie DESC",
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur serveur");
    }
});

app.delete('/api/factures/:id/historique', async (req, res) => {
    try {
        await dbQuery('DELETE FROM historique_factures WHERE client_id = ?', [req.params.id]);
        res.status(200).send('Historique effacé');
    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur lors de la suppression");
    }
});


// 3. Routes avec paramètre dynamique simple /:id (placées après les routes spécifiques)

app.get('/api/factures/:id', (req, res) => {
    const id = req.params.id;
    db.query('SELECT * FROM factures WHERE id = ?', [id], (err, results) => {
        if (err) {
            console.error("Erreur SQL :", err);
            return res.status(500).send(err.message);
        }
        if (results.length === 0) {
            return res.status(404).send('Facture non trouvée');
        }
        res.json(results[0]);
    });
});

app.put('/api/factures/:id', async (req, res) => {
    try {
        const oldData = await dbQuery('SELECT ancien, nouveau, prix FROM factures WHERE id = ?', [req.params.id]);

        if (oldData.length > 0) {
            const old = oldData[0];
            await dbQuery(
                'INSERT INTO historique_factures (client_id, ancien, nouveau, prix) VALUES (?, ?, ?, ?)',
                [req.params.id, old.ancien, old.nouveau, old.prix]
            );
        }

        const data = {
            nom_client: req.body.nom_client,
            tel_client: req.body.tel_client,
            adresse_client: req.body.adresse_client,
            n_compte: req.body.n_compte,
            centre: req.body.centre,
            police: req.body.police,
            ordre: req.body.ordre,
            cle: req.body.cle,
            code: req.body.code,
            code_regroupement: req.body.code_regroupement,
            periode: req.body.periode,
            date_limite: req.body.date_limite,
            ancien: req.body.ancien,
            nouveau: req.body.nouveau,
            prix: req.body.prix
        };

        await dbQuery('UPDATE factures SET ? WHERE id = ?', [data, req.params.id]);
        res.status(200).send('Facture mise à jour');
    } catch (err) {
        console.error("Erreur serveur :", err);
        res.status(500).send("Erreur lors de la mise à jour");
    }
});

app.delete('/api/factures/:id', (req, res) => {
    db.query('DELETE FROM factures WHERE id = ?', [req.params.id], (err, result) => {
        if (err) res.status(500).send(err.message);
        else res.status(200).send('Facture supprimée');
    });
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
