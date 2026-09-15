require('dotenv').config();
const sql = require('mssql');

const primaryConfig = {
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE || 'polisewa',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    options: {
        encrypt: process.env.DB_ENCRYPT !== 'false', // Default true for Azure SQL
        trustServerCertificate: process.env.DB_TRUST_CERT === 'true' || false,
        connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT, 10) || 30000,
        requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT, 10) || 30000,
        enableArithAbort: true
    },
    pool: {
        max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
        min: parseInt(process.env.DB_POOL_MIN, 10) || 0,
        idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000,
        acquireTimeoutMillis: 30000
    }
};

const secondaryConfig = process.env.DB_SERVER_2 ? {
    server: process.env.DB_SERVER_2,
    database: process.env.DB_DATABASE_2 || process.env.DB_DATABASE || 'polisewa2',
    user: process.env.DB_USER_2 || process.env.DB_USER,
    password: process.env.DB_PASSWORD_2 || process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT_2 || process.env.DB_PORT, 10) || 1433,
    options: {
        encrypt: true,
        trustServerCertificate: process.env.DB_TRUST_CERT === 'true' || false,
        connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT, 10) || 30000,
        requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT, 10) || 30000,
        enableArithAbort: true
    },
    pool: {
        max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
        min: parseInt(process.env.DB_POOL_MIN, 10) || 0,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 30000
    }
} : null;

let activeConfig = primaryConfig;
let poolInstance = null;
let connectingPromise = null;

async function connectToConfig(cfg, label) {
    console.log(`🔌 [MSSQL] Establishing connection to ${label} (${cfg.server}/${cfg.database})...`);
    const pool = new sql.ConnectionPool(cfg);

    pool.on('error', (err) => {
        console.error(`⚠️ [MSSQL Pool Error / Failover on ${label}]:`, err.message);
        if (!pool.connected && !pool.connecting) {
            console.log('🔄 [MSSQL] Connection pool closed or broken. Resetting pool for auto-reconnect...');
            poolInstance = null;
        }
    });

    await pool.connect();
    console.log(`✅ [MSSQL] Connected to ${label} "${cfg.database}" on server "${cfg.server}" successfully.`);
    return pool;
}

/**
 * Retrieves the active MSSQL connection pool or establishes a new connection
 * with automatic failover between Primary (DB_SERVER) and Secondary (DB_SERVER_2) databases.
 * @returns {Promise<sql.ConnectionPool>}
 */
async function getPool() {
    if (poolInstance && poolInstance.connected) {
        return poolInstance;
    }

    if (connectingPromise) {
        return connectingPromise;
    }

    connectingPromise = (async () => {
        try {
            // Attempt 1: Connect to Primary Database
            try {
                const pool = await connectToConfig(primaryConfig, 'Primary Azure SQL');
                activeConfig = primaryConfig;
                poolInstance = pool;
                return poolInstance;
            } catch (primaryErr) {
                console.warn('⚠️ [MSSQL] Primary Database connection failed:', primaryErr.message);

                // Attempt 2: Auto-failover to Secondary Database if configured
                if (secondaryConfig && secondaryConfig.server) {
                    console.log(`🔄 [MSSQL] Attempting automatic failover to 2nd Database (${secondaryConfig.server})...`);
                    const pool2 = await connectToConfig(secondaryConfig, 'Secondary Azure SQL (Failover)');
                    activeConfig = secondaryConfig;
                    poolInstance = pool2;
                    return poolInstance;
                }
                throw primaryErr;
            }
        } catch (err) {
            console.error('❌ [MSSQL] All Azure SQL connection attempts failed:', err.message);
            poolInstance = null;
            throw err;
        } finally {
            connectingPromise = null;
        }
    })();

    return connectingPromise;
}

/**
 * Standard Thenable poolPromise for direct usage:
 * `const pool = await poolPromise;`
 * Guarantees automatic reconnection on subsequent queries if failover occurs.
 */
const poolPromise = {
    then(onFulfilled, onRejected) {
        return getPool().then(onFulfilled, onRejected);
    },
    catch(onRejected) {
        return getPool().catch(onRejected);
    }
};

/**
 * Closes the connection pool gracefully (e.g., during app shutdown)
 */
async function closePool() {
    if (poolInstance) {
        try {
            await poolInstance.close();
            console.log('🔒 [MSSQL] Connection pool closed gracefully.');
        } catch (err) {
            console.error('Error closing MSSQL pool:', err.message);
        } finally {
            poolInstance = null;
            connectingPromise = null;
        }
    }
}

function getActiveServer() {
    return activeConfig ? activeConfig.server : (process.env.DB_SERVER || 'Unknown');
}

module.exports = {
    sql,
    poolPromise,
    getPool,
    closePool,
    getActiveServer,
    dbConfig: primaryConfig
};
