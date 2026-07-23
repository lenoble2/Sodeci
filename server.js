



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


app.get('/modif.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'modif.html'));
});


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
        const clientId = req.params.id;

        // Si l'ID est un identifiant local (généré par le front-end, ex: timestamp ou texte)
        if (clientId.toString().length > 10 || isNaN(clientId)) {
            return res.status(200).send('Facture mise à jour localement');
        }

        const oldData = await dbQuery('SELECT ancien, nouveau, prix FROM factures WHERE id = ?', [clientId]);
        if (oldData.length > 0) {                                   
            const old = oldData[0];
            await dbQuery(                                              
                'INSERT INTO historique_factures (client_id, ancien, nouveau, prix) VALUES (?, ?, ?, ?)',                       
                [clientId, old.ancien, old.nouveau, old.prix]                                                          
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

        await dbQuery('UPDATE factures SET ? WHERE id = ?', [data, clientId]);                                     
        res.status(200).send('Facture mise à jour');        
    } catch (err) {                                             
        console.error("Erreur serveur ou base de données injoignable :", err);                 
        res.status(200).send('Sauvegardé localement');                                                      
    }
});


app.delete('/api/factures/:id', (req, res) => {
    db.query('DELETE FROM factures WHERE id = ?', [req.params.id], (err, result) => {
        if (err) res.status(500).send(err.message);
        else res.status(200).send('Facture supprimée');
    });
});



// Route pour enregistrer ou synchroniser un client (gérant l'auto-incrémentation propre des ID locaux)
app.post('/api/factures/sync', async (req, res) => {
    try {
        const clientData = req.body;

        // 1. Récupérer le plus grand ID actuel dans la base de données MySQL
        const [rows] = await dbQuery('SELECT MAX(id) as maxId FROM factures');
        let nextId = (rows && rows.maxId ? parseInt(rows.maxId) : 0) + 1;

        // Si le client a un ID local ou temporaire, on vérifie s'il existe déjà
        if (clientData.id) {
            const [exist] = await dbQuery('SELECT id FROM factures WHERE id = ?', [clientData.id]);
            if (exist.length > 0) {
                // Si l'ID est déjà pris en ligne, on lui attribue le nouveau nextId libre
                clientData.id = nextId;
            }
        } else {
            clientData.id = nextId;
        }

        // Insertion ou mise à jour avec l'ID sécurisé
        const query = `
            INSERT INTO factures (id, nom_client, tel_client, adresse_client, n_compte, centre, police, ordre, cle, code, code_regroupement, periode, date_limite, ancien, nouveau, prix) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            nom_client=VALUES(nom_client), tel_client=VALUES(tel_client), adresse_client=VALUES(adresse_client), 
            n_compte=VALUES(n_compte), centre=VALUES(centre), police=VALUES(police), ordre=VALUES(ordre), 
            cle=VALUES(cle), code=VALUES(code), code_regroupement=VALUES(code_regroupement), 
            periode=VALUES(periode), date_limite=VALUES(date_limite), ancien=VALUES(ancien), 
            nouveau=VALUES(nouveau), prix=VALUES(prix)
        `;

        await dbQuery(query, [
            clientData.id, clientData.nom_client, clientData.tel_client, clientData.adresse_client, 
            clientData.n_compte, clientData.centre, clientData.police, clientData.ordre, 
            clientData.cle, clientData.code, clientData.code_regroupement, clientData.periode, 
            clientData.date_limite, clientData.ancien, clientData.nouveau, clientData.prix
        ]);

        res.status(200).json({ success: true, assignedId: clientData.id });
    } catch (err) {
        console.error("Erreur lors de la synchronisation :", err);
        res.status(500).send("Erreur serveur lors de la synchronisation");
    }
});




app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
