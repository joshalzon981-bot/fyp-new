require('dotenv').config();
const sql = require('mssql');

const dbConfig = {
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

let poolInstance = null;
let connectingPromise = null;

/**
 * Retrieves the active MSSQL connection pool or establishes a new connection
 * with automatic failover and reconnection resilience.
 * @returns {Promise<sql.ConnectionPool>}
 */
async function getPool() {
    // Return existing connected pool if healthy
    if (poolInstance && poolInstance.connected) {
        return poolInstance;
    }

    // If a connection attempt is already in flight, reuse that promise
    if (connectingPromise) {
        return connectingPromise;
    }

    console.log(`🔌 [MSSQL] Establishing connection to ${dbConfig.server}/${dbConfig.database}...`);

    connectingPromise = (async () => {
        try {
            const pool = new sql.ConnectionPool(dbConfig);

            // Pool error event listener (captures background/failover disconnects without crashing Node process)
            pool.on('error', (err) => {
                console.error('⚠️ [MSSQL Pool Error / Failover]:', err.message);
                if (!pool.connected && !pool.connecting) {
                    console.log('🔄 [MSSQL] Connection pool closed or broken. Resetting pool for auto-reconnect...');
                    poolInstance = null;
                }
            });

            await pool.connect();
            console.log(`✅ [MSSQL] Connected to database "${dbConfig.database}" on server "${dbConfig.server}" successfully.`);
            poolInstance = pool;
            return poolInstance;
        } catch (err) {
            console.error('❌ [MSSQL] Connection failed:', err.message);
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

module.exports = {
    sql,
    poolPromise,
    getPool,
    closePool,
    dbConfig
};
