require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const { poolPromise, sql } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Gmail SMTP Email Transporter
function getMailTransporter() {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_APP_PASS;
    if (user && pass && pass.trim().length > 0) {
        return nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true, // SSL
            auth: {
                user: user.trim(),
                pass: pass.replace(/\s+/g, '') // remove any spaces
            }
        });
    }
    return null;
}

// Send Branded HTML OTP Verification Email
async function sendOtpEmail(toEmail, otpCode, userName) {
    const transporter = getMailTransporter();
    const emailUser = (process.env.EMAIL_USER && process.env.EMAIL_USER.trim()) || 'polisewa.official@gmail.com';

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; }
                .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
                .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px 24px; text-align: center; color: #ffffff; }
                .header h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
                .header p { margin: 6px 0 0; font-size: 13.5px; opacity: 0.92; }
                .content { padding: 32px 28px; text-align: center; color: #1e293b; }
                .greeting { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
                .text { font-size: 14px; line-height: 1.6; color: #64748b; margin-bottom: 24px; }
                .otp-box { background: #eff6ff; border: 2px dashed #3b82f6; border-radius: 12px; padding: 18px 28px; display: inline-block; margin: 0 auto 20px; letter-spacing: 8px; font-size: 34px; font-weight: 800; color: #1e40af; font-family: 'SF Mono', Consolas, Monaco, monospace, sans-serif; }
                .expiry { font-size: 12.5px; color: #64748b; margin-bottom: 20px; }
                .spam-tip-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 14px 16px; margin: 24px 0 10px; text-align: left; font-size: 12.5px; color: #92400e; line-height: 1.5; }
                .footer { border-top: 1px solid #f1f5f9; padding: 20px 24px; font-size: 12px; color: #94a3b8; text-align: center; background: #f8fafc; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🎓 Polisewa</h1>
                    <p>Student Accommodation & Room Rental Platform</p>
                </div>
                <div class="content">
                    <div class="greeting">Hello ${userName || 'there'},</div>
                    <div class="text">Thank you for joining Polisewa. Please use the following 6-digit verification code to activate your account:</div>
                    <div class="otp-box">${otpCode}</div>
                    <div class="expiry">⏱️ This code is valid for <b>10 minutes</b>. Please do not share it with anyone.</div>
                    
                    <div class="spam-tip-box">
                        💡 <b>Delivery Tip:</b> If this email arrived in your <b>Spam or Junk folder</b>, please click <b>"Report not spam"</b> or <b>"Looks safe"</b> at the top of your email client. This automatically trains Google to deliver all future rental inquiries, booking alerts, and account updates straight to your Primary Inbox.
                    </div>
                </div>
                <div class="footer">
                    If you did not request this verification code, please ignore this email.<br>
                    &copy; ${new Date().getFullYear()} Polisewa. Politeknik Kuching Sarawak.
                </div>
            </div>
        </body>
        </html>
    `;

    if (!transporter) {
        console.log(`\n======================================================`);
        console.log(`📧 [EMAIL VERIFICATION - LOCAL CONSOLE MODE]`);
        console.log(`To: ${toEmail}`);
        console.log(`OTP Code: ${otpCode}`);
        console.log(`(Add EMAIL_APP_PASS in .env to send via Gmail SMTP)`);
        console.log(`======================================================\n`);
        return { success: true, simulated: true };
    }

    try {
        const info = await transporter.sendMail({
            from: `"Polisewa Support" <${emailUser}>`,
            replyTo: `"Polisewa Support" <${emailUser}>`,
            to: toEmail,
            subject: `Your Polisewa Verification Code: ${otpCode}`,
            text: `Hello ${userName || 'there'},\n\nYour Polisewa verification code is: ${otpCode}\n\nThis code will expire in 10 minutes.\n\nTip: If this email is in your Spam folder, please mark it as "Not Spam" to receive future rental updates.\n\nBest regards,\nPolisewa Team`,
            html: htmlContent
        });
        console.log(`✅ Verification email sent to ${toEmail} (Message ID: ${info.messageId})`);
        return { success: true, simulated: false };
    } catch (err) {
        console.error(`❌ Failed to send verification email to ${toEmail}:`, err.message);
        throw err;
    }
}

// Enable CORS and JSON parsing middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files from the root directory
app.use(express.static(__dirname));

// Ensure uploads directory exists and serve it as static files
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOAD_DIR));

// Multer configuration for property image uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, 'property-' + unique + ext);
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
    fileFilter: function (req, file, cb) {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only JPG, PNG, GIF, and WebP images are allowed.'));
    }
});

// Database Abstraction: Azure SQL Database (mssql) with SQLite fallback
let dbType = 'sqlite';
let mssqlPool = null;
let sqliteDb = null;

// Database Abstraction using db.js (With Automatic Failover & Local Fallback)
async function initDatabase() {
    try {
        mssqlPool = await poolPromise;
        dbType = 'mssql';
        console.log('✅ Pangkalan data Azure SQL bersedia (Auto-Failover Aktif).');
        await initMssqlTables(mssqlPool);
    } catch (err) {
        console.error('⚠️ Sambungan pangkalan data Azure SQL gagal, beralih ke SQLite tempatan:', err.message);
        initSqlite();
    }
}

function initSqlite() {
    const sqlite3 = require('sqlite3').verbose();
    dbType = 'sqlite';
    const dbPath = path.join(__dirname, 'database.sqlite');
    sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Error connecting to SQLite database:', err.message);
        } else {
            console.log('Connected to local SQLite database at:', dbPath);
            initSqliteTables();
        }
    });
}

// Seed Administrator Accounts
const DEFAULT_ADMINS = [
    {
        name: 'Abdul Khalil (Admin)',
        email: 'abdulkhalilpro@gmail.com',
        password: 'poli@sewaadministrator',
        phone: '+60123456789',
        role: 'admin',
        extra: 'System Administrator'
    },
    {
        name: 'Asyarif (Admin)',
        email: 'asyarif3005@gmail.com',
        password: '011poliadministrator123',
        phone: '+60123456789',
        role: 'admin',
        extra: 'System Administrator'
    },
    {
        name: 'Josh Alzon (Admin)',
        email: 'joshalzon981@gmail.com',
        password: 'joshadministrator*123@!',
        phone: '+60123456789',
        role: 'admin',
        extra: 'System Administrator'
    }
];

async function dropMssqlUserCheckConstraints(pool) {
    if (!pool) return;
    try {
        await pool.request().query(`
            DECLARE @sql NVARCHAR(MAX) = N'';
            SELECT @sql += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(parent_object_id)) 
                + N' DROP CONSTRAINT ' + QUOTENAME(name) + N'; '
            FROM sys.check_constraints
            WHERE parent_object_id = OBJECT_ID('users');

            IF @sql <> N''
                EXEC sp_executesql @sql;
        `);
    } catch (e) {
        console.error('Error dropping check constraints:', e.message);
    }
}
async function seedAdminAccounts() {
    for (const admin of DEFAULT_ADMINS) {
        const emailLower = admin.email.toLowerCase().trim();
        try {
            const hashedPassword = await bcrypt.hash(admin.password, 10);
            if (dbType === 'mssql' && mssqlPool) {
                const check = await mssqlPool.request()
                    .input('email', sql.NVarChar, emailLower)
                    .query('SELECT id FROM users WHERE email = @email');

                if (check.recordset.length === 0) {
                    await mssqlPool.request()
                        .input('name', sql.NVarChar, admin.name)
                        .input('email', sql.NVarChar, emailLower)
                        .input('phone', sql.NVarChar, admin.phone)
                        .input('password', sql.NVarChar, hashedPassword)
                        .input('role', sql.NVarChar, admin.role)
                        .input('extra', sql.NVarChar, admin.extra)
                        .query(`
                            INSERT INTO users (name, email, phone, password, role, extra, is_verified, otp_code, otp_expires_at)
                            VALUES (@name, @email, @phone, @password, @role, @extra, 1, '', NULL)
                        `);
                    console.log(`🛡️ Seeded administrator account: ${emailLower}`);
                } else {
                    await mssqlPool.request()
                        .input('email', sql.NVarChar, emailLower)
                        .input('name', sql.NVarChar, admin.name)
                        .input('password', sql.NVarChar, hashedPassword)
                        .input('role', sql.NVarChar, admin.role)
                        .input('extra', sql.NVarChar, admin.extra)
                        .query(`
                            UPDATE users SET name = @name, password = @password, role = @role, extra = @extra, is_verified = 1
                            WHERE email = @email
                        `);
                }
            } else if (sqliteDb) {
                sqliteDb.get(`SELECT id FROM users WHERE email = ?`, [emailLower], (err, row) => {
                    if (err) {
                        console.error(`Error checking admin ${emailLower}:`, err.message);
                        return;
                    }
                    if (!row) {
                        sqliteDb.run(
                            `INSERT INTO users (name, email, phone, password, role, extra, is_verified, otp_code, otp_expires_at) VALUES (?, ?, ?, ?, ?, ?, 1, '', '')`,
                            [admin.name, emailLower, admin.phone, hashedPassword, admin.role, admin.extra],
                            (insertErr) => {
                                if (insertErr) console.error(`Error inserting admin ${emailLower}:`, insertErr.message);
                                else console.log(`🛡️ Seeded administrator account: ${emailLower}`);
                            }
                        );
                    } else {
                        sqliteDb.run(
                            `UPDATE users SET name = ?, password = ?, role = ?, extra = ?, is_verified = 1 WHERE email = ?`,
                            [admin.name, hashedPassword, admin.role, admin.extra, emailLower],
                            (updateErr) => {
                                if (updateErr) console.error(`Error updating admin ${emailLower}:`, updateErr.message);
                            }
                        );
                    }
                });
            }
        } catch (e) {
            console.error(`Error during admin seeding (${emailLower}):`, e.message);
        }
    }
}

async function initMssqlTables(pool) {
    try {
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
            CREATE TABLE users (
                id INT IDENTITY(1,1) PRIMARY KEY,
                name NVARCHAR(255) NOT NULL,
                email NVARCHAR(255) NOT NULL UNIQUE,
                phone NVARCHAR(50) NOT NULL,
                password NVARCHAR(255) NOT NULL,
                role NVARCHAR(50) NOT NULL,
                extra NVARCHAR(MAX),
                is_verified INT DEFAULT 0,
                otp_code NVARCHAR(10),
                otp_expires_at DATETIME
            )
        `);
        await pool.request().query(`
            IF EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
            AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'is_verified')
            ALTER TABLE users ADD is_verified INT DEFAULT 0;
        `);
        await pool.request().query(`
            IF EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
            AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'otp_code')
            ALTER TABLE users ADD otp_code NVARCHAR(10);
        `);
        await pool.request().query(`
            IF EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
            AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'otp_expires_at')
            ALTER TABLE users ADD otp_expires_at DATETIME;
        `);
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='properties' AND xtype='U')
            CREATE TABLE properties (
                id INT IDENTITY(1,1) PRIMARY KEY,
                user_id INT NOT NULL FOREIGN KEY REFERENCES users(id),
                name NVARCHAR(255) NOT NULL,
                [desc] NVARCHAR(MAX),
                price NVARCHAR(100),
                phone NVARCHAR(50),
                lat FLOAT NOT NULL,
                lng FLOAT NOT NULL,
                image NVARCHAR(MAX),
                is_verified INT DEFAULT 0,
                created_at DATETIME DEFAULT GETDATE()
            )
        `);
        await pool.request().query(`
            IF EXISTS (SELECT * FROM sysobjects WHERE name='properties' AND xtype='U')
            AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('properties') AND name = 'image')
            ALTER TABLE properties ADD image NVARCHAR(MAX);
        `);
        await pool.request().query(`
            IF EXISTS (SELECT * FROM sysobjects WHERE name='properties' AND xtype='U')
            AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('properties') AND name = 'is_verified')
            ALTER TABLE properties ADD is_verified INT DEFAULT 0;
        `);
        console.log('Azure SQL tables verified and initialized successfully.');
        await seedAdminAccounts();
    } catch (err) {
        console.error('Error initializing Azure SQL tables:', err.message);
    }
}

function initSqliteTables() {
    sqliteDb.serialize(() => {
        // Ensure users table exists with correct schema
        sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL,
                extra TEXT,
                is_verified INTEGER DEFAULT 0,
                otp_code TEXT DEFAULT '',
                otp_expires_at TEXT DEFAULT ''
            )
        `);

        // Check columns and check constraint on users table
        sqliteDb.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`, (masterErr, masterRow) => {
            if (masterRow && masterRow.sql && masterRow.sql.includes("CHECK(role IN ('student', 'landlord'))")) {
                console.log('🔄 Migrating SQLite users table to support admin role...');
                sqliteDb.serialize(() => {
                    sqliteDb.run(`CREATE TABLE users_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        email TEXT UNIQUE NOT NULL,
                        phone TEXT NOT NULL,
                        password TEXT NOT NULL,
                        role TEXT NOT NULL,
                        extra TEXT,
                        is_verified INTEGER DEFAULT 0,
                        otp_code TEXT DEFAULT '',
                        otp_expires_at TEXT DEFAULT ''
                    )`);
                    sqliteDb.run(`INSERT OR IGNORE INTO users_new (id, name, email, phone, password, role, extra) SELECT id, name, email, phone, password, role, extra FROM users`);
                    sqliteDb.run(`DROP TABLE users`);
                    sqliteDb.run(`ALTER TABLE users_new RENAME TO users`, () => {
                        seedAdminAccounts();
                    });
                });
            } else {
                sqliteDb.all(`PRAGMA table_info(users)`, (err, cols) => {
                    if (cols) {
                        const colNames = cols.map(c => c.name);
                        if (!colNames.includes('is_verified')) {
                            sqliteDb.run(`ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0`, () => { });
                        }
                        if (!colNames.includes('otp_code')) {
                            sqliteDb.run(`ALTER TABLE users ADD COLUMN otp_code TEXT DEFAULT ''`, () => { });
                        }
                        if (!colNames.includes('otp_expires_at')) {
                            sqliteDb.run(`ALTER TABLE users ADD COLUMN otp_expires_at TEXT DEFAULT ''`, () => { });
                        }
                    }
                    seedAdminAccounts();
                });
            }
        });

        // Ensure properties table exists
        sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS properties (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                desc TEXT DEFAULT '',
                price TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                image TEXT DEFAULT '',
                is_verified INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `, (err) => {
            if (err) {
                console.error('Error creating properties table:', err.message);
            } else {
                sqliteDb.all(`PRAGMA table_info(properties)`, (err2, cols) => {
                    if (cols) {
                        const colNames = cols.map(c => c.name);
                        if (!colNames.includes('image')) {
                            sqliteDb.run(`ALTER TABLE properties ADD COLUMN image TEXT DEFAULT ''`, () => { });
                        }
                        if (!colNames.includes('is_verified')) {
                            sqliteDb.run(`ALTER TABLE properties ADD COLUMN is_verified INTEGER DEFAULT 0`, () => { });
                        }
                    }
                });
            }
        });
    });
}

// Initialize Database Connection
initDatabase();

// --- ROUTES ---

// Upload single property image (legacy/fallback)
app.post('/api/properties/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image file provided.' });
    const url = '/uploads/' + req.file.filename;
    res.status(201).json({
        message: 'Image uploaded.',
        imageUrl: url,
        imageUrls: [url]
    });
});

// Upload multiple property images
app.post('/api/properties/upload-images', upload.array('images', 10), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No image files provided.' });
    }
    const imageUrls = req.files.map(f => '/uploads/' + f.filename);
    res.status(201).json({
        message: `${imageUrls.length} images uploaded.`,
        imageUrls: imageUrls
    });
});

// SIGN UP Endpoint (Generates OTP & sends verification email)
app.post('/api/signup', async (req, res) => {
    const { name, email, phone, password, role, extra } = req.body;
    if (!name || !email || !phone || !password || !role) {
        return res.status(400).json({ error: 'All primary fields (name, email, phone, password, role) are required.' });
    }

    const emailLower = email.toLowerCase().trim();
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        if (dbType === 'mssql') {
            const checkUser = await mssqlPool.request()
                .input('email', sql.NVarChar, emailLower)
                .query('SELECT * FROM users WHERE email = @email');

            if (checkUser.recordset.length > 0) {
                const existing = checkUser.recordset[0];
                if (existing.is_verified === 1) {
                    return res.status(409).json({ error: 'An account with this email address already exists. Please Sign In.' });
                }
                await mssqlPool.request()
                    .input('id', sql.Int, existing.id)
                    .input('name', sql.NVarChar, name)
                    .input('phone', sql.NVarChar, phone)
                    .input('password', sql.NVarChar, hashedPassword)
                    .input('role', sql.NVarChar, role)
                    .input('extra', sql.NVarChar, extra || '')
                    .input('otp_code', sql.NVarChar, otpCode)
                    .input('otp_expires_at', sql.DateTime, new Date(otpExpiresAt))
                    .query(`
                        UPDATE users
                        SET name = @name, phone = @phone, password = @password, role = @role, extra = @extra, otp_code = @otp_code, otp_expires_at = @otp_expires_at, is_verified = 0
                        WHERE id = @id
                    `);
            } else {
                await mssqlPool.request()
                    .input('name', sql.NVarChar, name)
                    .input('email', sql.NVarChar, emailLower)
                    .input('phone', sql.NVarChar, phone)
                    .input('password', sql.NVarChar, hashedPassword)
                    .input('role', sql.NVarChar, role)
                    .input('extra', sql.NVarChar, extra || '')
                    .input('otp_code', sql.NVarChar, otpCode)
                    .input('otp_expires_at', sql.DateTime, new Date(otpExpiresAt))
                    .query(`
                        INSERT INTO users (name, email, phone, password, role, extra, is_verified, otp_code, otp_expires_at)
                        VALUES (@name, @email, @phone, @password, @role, @extra, 0, @otp_code, @otp_expires_at)
                    `);
            }
        } else {
            const existing = await new Promise((resolve, reject) => {
                sqliteDb.get(`SELECT * FROM users WHERE email = ?`, [emailLower], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            if (existing) {
                if (existing.is_verified === 1) {
                    return res.status(409).json({ error: 'An account with this email address already exists. Please Sign In.' });
                }
                await new Promise((resolve, reject) => {
                    sqliteDb.run(
                        `UPDATE users SET name = ?, phone = ?, password = ?, role = ?, extra = ?, otp_code = ?, otp_expires_at = ?, is_verified = 0 WHERE id = ?`,
                        [name, phone, hashedPassword, role, extra || '', otpCode, otpExpiresAt, existing.id],
                        (err) => { if (err) reject(err); else resolve(); }
                    );
                });
            } else {
                await new Promise((resolve, reject) => {
                    sqliteDb.run(
                        `INSERT INTO users (name, email, phone, password, role, extra, is_verified, otp_code, otp_expires_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
                        [name, emailLower, phone, hashedPassword, role, extra || '', otpCode, otpExpiresAt],
                        (err) => { if (err) reject(err); else resolve(); }
                    );
                });
            }
        }

        // Send OTP via email
        try {
            await sendOtpEmail(emailLower, otpCode, name);
        } catch (emailErr) {
            console.error('Email send failure:', emailErr.message);
        }

        return res.status(200).json({
            message: 'Verification code sent to your email.',
            needsVerification: true,
            email: emailLower
        });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// VERIFY OTP Endpoint
app.post('/api/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) {
        return res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
    }

    const emailLower = email.toLowerCase().trim();
    const cleanOtp = String(otp).trim();

    try {
        let user = null;
        if (dbType === 'mssql') {
            const result = await mssqlPool.request()
                .input('email', sql.NVarChar, emailLower)
                .query('SELECT * FROM users WHERE email = @email');
            user = result.recordset[0];
        } else {
            user = await new Promise((resolve, reject) => {
                sqliteDb.get(`SELECT * FROM users WHERE email = ?`, [emailLower], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        }

        if (!user) {
            return res.status(404).json({ error: 'User account not found.' });
        }

        if (user.is_verified === 1) {
            const { password: _, otp_code: __, otp_expires_at: ___, ...userData } = user;
            return res.status(200).json({
                message: 'Account already verified! Logged in successfully.',
                user: userData
            });
        }

        if (!user.otp_code || user.otp_code !== cleanOtp) {
            return res.status(400).json({ error: 'Invalid verification code. Please check your email and try again.' });
        }

        if (user.otp_expires_at && new Date(user.otp_expires_at) < new Date()) {
            return res.status(400).json({ error: 'Verification code has expired. Please click Resend Code.' });
        }

        // Activate user
        if (dbType === 'mssql') {
            await mssqlPool.request()
                .input('id', sql.Int, user.id)
                .query(`UPDATE users SET is_verified = 1, otp_code = '', otp_expires_at = NULL WHERE id = @id`);
        } else {
            await new Promise((resolve, reject) => {
                sqliteDb.run(
                    `UPDATE users SET is_verified = 1, otp_code = '', otp_expires_at = '' WHERE id = ?`,
                    [user.id],
                    (err) => { if (err) reject(err); else resolve(); }
                );
            });
        }

        const { password: _, otp_code: __, otp_expires_at: ___, ...userData } = user;
        userData.is_verified = 1;

        return res.status(200).json({
            message: 'Email verified successfully! Welcome to Polisewa.',
            user: userData
        });
    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// RESEND OTP Endpoint
app.post('/api/resend-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const emailLower = email.toLowerCase().trim();
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    try {
        let user = null;
        if (dbType === 'mssql') {
            const result = await mssqlPool.request()
                .input('email', sql.NVarChar, emailLower)
                .query('SELECT * FROM users WHERE email = @email');
            user = result.recordset[0];
        } else {
            user = await new Promise((resolve, reject) => {
                sqliteDb.get(`SELECT * FROM users WHERE email = ?`, [emailLower], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        }

        if (!user) {
            return res.status(404).json({ error: 'No account found with this email address.' });
        }

        if (user.is_verified === 1) {
            return res.status(400).json({ error: 'This account is already verified. Please sign in.' });
        }

        if (dbType === 'mssql') {
            await mssqlPool.request()
                .input('id', sql.Int, user.id)
                .input('otp_code', sql.NVarChar, otpCode)
                .input('otp_expires_at', sql.DateTime, new Date(otpExpiresAt))
                .query(`UPDATE users SET otp_code = @otp_code, otp_expires_at = @otp_expires_at WHERE id = @id`);
        } else {
            await new Promise((resolve, reject) => {
                sqliteDb.run(
                    `UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?`,
                    [otpCode, otpExpiresAt, user.id],
                    (err) => { if (err) reject(err); else resolve(); }
                );
            });
        }

        try {
            await sendOtpEmail(emailLower, otpCode, user.name);
        } catch (emailErr) {
            console.error('Email resend error:', emailErr.message);
        }

        return res.status(200).json({ message: 'A new 6-digit verification code has been sent to your email.' });
    } catch (err) {
        console.error('Resend OTP error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// SIGN IN Endpoint (Checks verification)
app.post('/api/signin', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    const emailLower = email.toLowerCase().trim();
    try {
        let user = null;
        if (dbType === 'mssql') {
            const result = await mssqlPool.request()
                .input('email', sql.NVarChar, emailLower)
                .query('SELECT * FROM users WHERE email = @email');
            user = result.recordset[0];
        } else {
            user = await new Promise((resolve, reject) => {
                sqliteDb.get(`SELECT * FROM users WHERE email = ?`, [emailLower], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        }

        // If user is a designated administrator, handle auto-creation / auto-sync
        const defaultAdmin = DEFAULT_ADMINS.find(a => a.email.toLowerCase().trim() === emailLower);
        if (defaultAdmin) {
            const isDefaultPass = (password === defaultAdmin.password);
            let passwordMatch = false;

            if (user) {
                passwordMatch = await bcrypt.compare(password, user.password);
            }

            if (isDefaultPass || passwordMatch) {
                const freshHash = await bcrypt.hash(defaultAdmin.password, 10);
                if (!user) {
                    // Auto-create missing admin in DB on the fly
                    if (dbType === 'mssql') {
                        await dropMssqlUserCheckConstraints(mssqlPool);
                        const insertRes = await mssqlPool.request()
                            .input('name', sql.NVarChar, defaultAdmin.name)
                            .input('email', sql.NVarChar, emailLower)
                            .input('phone', sql.NVarChar, defaultAdmin.phone)
                            .input('password', sql.NVarChar, freshHash)
                            .input('role', sql.NVarChar, defaultAdmin.role)
                            .input('extra', sql.NVarChar, defaultAdmin.extra)
                            .query(`
                                INSERT INTO users (name, email, phone, password, role, extra, is_verified, otp_code, otp_expires_at)
                                OUTPUT INSERTED.*
                                VALUES (@name, @email, @phone, @password, @role, @extra, 1, '', NULL)
                            `);
                        user = insertRes.recordset[0];
                    } else {
                        user = await new Promise((resolve, reject) => {
                            sqliteDb.run(
                                `INSERT INTO users (name, email, phone, password, role, extra, is_verified, otp_code, otp_expires_at) VALUES (?, ?, ?, ?, ?, ?, 1, '', '')`,
                                [defaultAdmin.name, emailLower, defaultAdmin.phone, freshHash, defaultAdmin.role, defaultAdmin.extra],
                                function (err) {
                                    if (err) reject(err);
                                    else {
                                        sqliteDb.get(`SELECT * FROM users WHERE id = ?`, [this.lastID], (errG, row) => {
                                            if (errG) reject(errG);
                                            else resolve(row);
                                        });
                                    }
                                }
                            );
                        });
                    }
                } else if (isDefaultPass && !passwordMatch) {
                    // Update password in DB if default password was entered
                    if (dbType === 'mssql') {
                        await dropMssqlUserCheckConstraints(mssqlPool);
                        await mssqlPool.request()
                            .input('id', sql.Int, user.id)
                            .input('password', sql.NVarChar, freshHash)
                            .input('role', sql.NVarChar, 'admin')
                            .query(`UPDATE users SET password = @password, role = @role, is_verified = 1 WHERE id = @id`);
                    } else {
                        sqliteDb.run(`UPDATE users SET password = ?, role = 'admin', is_verified = 1 WHERE id = ?`, [freshHash, user.id]);
                    }
                    user.role = 'admin';
                    user.is_verified = 1;
                }

                const { password: _, otp_code: __, otp_expires_at: ___, ...userData } = user;
                return res.status(200).json({
                    message: 'Welcome Administrator!',
                    user: userData
                });
            }
        }
        if (!user) {
            return res.status(401).json({ error: 'Invalid email address or password.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email address or password.' });
        }

        // If user account is not verified, trigger OTP send and ask to verify
        if (user.is_verified === 0) {
            const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
            const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

            if (dbType === 'mssql') {
                await mssqlPool.request()
                    .input('id', sql.Int, user.id)
                    .input('otp_code', sql.NVarChar, otpCode)
                    .input('otp_expires_at', sql.DateTime, new Date(otpExpiresAt))
                    .query(`UPDATE users SET otp_code = @otp_code, otp_expires_at = @otp_expires_at WHERE id = @id`);
            } else {
                sqliteDb.run(`UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?`, [otpCode, otpExpiresAt, user.id]);
            }

            try {
                await sendOtpEmail(emailLower, otpCode, user.name);
            } catch (e) { }

            return res.status(403).json({
                error: 'Your email address is not verified yet. We have sent a verification code to your email.',
                needsVerification: true,
                email: emailLower
            });
        }

        const { password: _, otp_code: __, otp_expires_at: ___, ...userData } = user;
        res.status(200).json({
            message: 'Logged in successfully!',
            user: userData
        });
    } catch (err) {
        console.error('Signin error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// VERIFY USER SESSION (Check if account still exists and is active in database)
app.get('/api/auth/verify', async (req, res) => {
    const rawUserId = req.query.user_id;
    const email = req.query.email ? String(req.query.email).toLowerCase().trim() : null;
    const userId = rawUserId ? parseInt(rawUserId, 10) : null;

    if (!userId || isNaN(userId)) {
        return res.status(400).json({ valid: false, error: 'Valid user_id is required.' });
    }

    try {
        let user = null;
        if (dbType === 'mssql') {
            const userRes = await mssqlPool.request()
                .input('user_id', sql.Int, userId)
                .query('SELECT id, name, email, phone, role, extra, is_verified FROM users WHERE id = @user_id');
            if (userRes.recordset.length > 0) {
                user = userRes.recordset[0];
            }
        } else {
            user = await new Promise((resolve, reject) => {
                sqliteDb.get('SELECT id, name, email, phone, role, extra, is_verified FROM users WHERE id = ?', [userId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                });
            });
        }

        if (!user) {
            return res.status(401).json({ valid: false, error: 'Account no longer exists or has been deleted.' });
        }

        if (email && user.email.toLowerCase().trim() !== email) {
            return res.status(401).json({ valid: false, error: 'Account session mismatch.' });
        }

        const { password: _, otp_code: __, otp_expires_at: ___, ...userData } = user;
        res.status(200).json({
            valid: true,
            user: userData
        });
    } catch (err) {
        console.error('Session verify error:', err);
        res.status(500).json({ valid: false, error: 'Database error: ' + err.message });
    }
});

// GET ALL PROPERTIES (Filtered by approval status: Public sees only approved, Landlords see approved + own pending, Admins see all)
app.get('/api/properties', async (req, res) => {
    const rawUserId = req.query.user_id;
    const userId = rawUserId ? parseInt(rawUserId, 10) : null;

    try {
        res.setHeader('Access-Control-Expose-Headers', 'X-User-Deleted');
        if (dbType === 'mssql') {
            let role = 'guest';
            if (userId && !isNaN(userId)) {
                const userRes = await mssqlPool.request()
                    .input('user_id', sql.Int, userId)
                    .query('SELECT role FROM users WHERE id = @user_id');
                if (userRes.recordset.length > 0) {
                    role = userRes.recordset[0].role;
                } else {
                    res.setHeader('X-User-Deleted', 'true');
                }
            }

            let query = `
                SELECT 
                    p.id, 
                    p.user_id, 
                    p.name, 
                    p.[desc], 
                    p.price, 
                    p.phone, 
                    p.lat, 
                    p.lng, 
                    p.image,
                    ISNULL(p.is_verified, 0) AS is_verified,
                    u.name AS landlord_name,
                    u.role AS landlord_role
                FROM properties p
                JOIN users u ON p.user_id = u.id
            `;

            const request = mssqlPool.request();
            if (role === 'admin') {
                // Admin sees all listings (approved + pending)
            } else if (userId && !isNaN(userId) && (role === 'landlord' || role === 'student')) {
                // Landlord or user sees all approved listings + their own pending listings
                query += ` WHERE (p.is_verified = 1 OR p.user_id = @user_id)`;
                request.input('user_id', sql.Int, userId);
            } else {
                // Public guest sees only approved listings
                query += ` WHERE p.is_verified = 1`;
            }

            const result = await request.query(query);
            res.status(200).json(result.recordset);
        } else {
            const fetchProperties = (role) => {
                let sqlQuery = `SELECT properties.*, users.name as landlord_name, users.role as landlord_role FROM properties JOIN users ON properties.user_id = users.id`;
                const params = [];

                if (role === 'admin') {
                    // Admin sees all listings (approved + pending)
                } else if (userId && !isNaN(userId) && (role === 'landlord' || role === 'student')) {
                    // Landlord or user sees approved + their own pending listings
                    sqlQuery += ` WHERE (properties.is_verified = 1 OR properties.user_id = ?)`;
                    params.push(userId);
                } else {
                    // Public guest sees only approved listings
                    sqlQuery += ` WHERE properties.is_verified = 1`;
                }

                sqliteDb.all(sqlQuery, params, (err, rows) => {
                    if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
                    res.json(rows);
                });
            };

            if (userId && !isNaN(userId)) {
                sqliteDb.get(`SELECT role FROM users WHERE id = ?`, [userId], (errUser, userRow) => {
                    if (!userRow) {
                        res.setHeader('X-User-Deleted', 'true');
                    }
                    const role = (!errUser && userRow) ? userRow.role : 'guest';
                    fetchProperties(role);
                });
            } else {
                fetchProperties('guest');
            }
        }
    } catch (err) {
        console.error('Fetch properties error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

function hasValidPhotos(image) {
    if (!image) return false;
    try {
        const parsed = typeof image === 'string' ? JSON.parse(image) : image;
        if (Array.isArray(parsed)) {
            return parsed.filter(Boolean).length > 0;
        }
        if (typeof parsed === 'string') {
            return parsed.trim().length > 0;
        }
    } catch (e) {
        if (typeof image === 'string') {
            return image.trim().length > 0;
        }
    }
    return false;
}

// CREATE PROPERTY (Max 2 per landlord, unlimited for admin)
app.post('/api/properties', async (req, res) => {
    const { user_id, name, desc, price, phone, lat, lng, image } = req.body;
    const trimmedName = name ? String(name).trim() : '';
    const trimmedDesc = desc ? String(desc).trim() : '';
    const trimmedPrice = price ? String(price).trim() : '';
    const trimmedPhone = phone ? String(phone).trim() : '';

    if (!user_id || !trimmedName || !trimmedDesc || !trimmedPrice || !trimmedPhone || !hasValidPhotos(image) || lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'All fields (Property Name, Description, Monthly Rent, Contact Phone Number, and at least 1 Photo) are mandatory.' });
    }

    try {
        if (dbType === 'mssql') {
            const userRes = await mssqlPool.request()
                .input('user_id', sql.Int, user_id)
                .query('SELECT role FROM users WHERE id = @user_id');
            if (userRes.recordset.length === 0) {
                return res.status(401).json({ error: 'User account not found or has been deleted.' });
            }
            const isAdmin = userRes.recordset.length > 0 && userRes.recordset[0].role === 'admin';
            const initialVerified = isAdmin ? 1 : 0;

            if (!isAdmin) {
                const countRes = await mssqlPool.request()
                    .input('user_id', sql.Int, user_id)
                    .query('SELECT COUNT(*) as count FROM properties WHERE user_id = @user_id');
                if (countRes.recordset[0].count >= 2) {
                    return res.status(400).json({ error: 'Maximum 2 properties allowed per landlord.' });
                }
            }

            const result = await mssqlPool.request()
                .input('user_id', sql.Int, user_id)
                .input('name', sql.NVarChar, trimmedName)
                .input('desc', sql.NVarChar, trimmedDesc)
                .input('price', sql.NVarChar, trimmedPrice)
                .input('phone', sql.NVarChar, trimmedPhone)
                .input('lat', sql.Float, lat)
                .input('lng', sql.Float, lng)
                .input('image', sql.NVarChar, image || '')
                .input('is_verified', sql.Int, initialVerified)
                .query(`
                    INSERT INTO properties (user_id, name, [desc], price, phone, lat, lng, image, is_verified)
                    OUTPUT INSERTED.id
                    VALUES (@user_id, @name, @desc, @price, @phone, @lat, @lng, @image, @is_verified)
                `);

            res.status(201).json({
                id: result.recordset[0].id,
                is_verified: initialVerified,
                message: isAdmin
                    ? 'Property created and published.'
                    : 'Property submitted! It is pending admin approval and will appear on the map once approved.'
            });
        } else {
            sqliteDb.get(`SELECT role FROM users WHERE id = ?`, [user_id], (errUser, userRow) => {
                if (errUser) return res.status(500).json({ error: 'Database error: ' + errUser.message });
                if (!userRow) return res.status(401).json({ error: 'User account not found or has been deleted.' });
                const isAdmin = userRow && userRow.role === 'admin';
                const initialVerified = isAdmin ? 1 : 0;

                const insertProperty = () => {
                    const sqlQuery = `INSERT INTO properties (user_id, name, desc, price, phone, lat, lng, image, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    sqliteDb.run(sqlQuery, [user_id, trimmedName, trimmedDesc, trimmedPrice, trimmedPhone, lat, lng, image || '', initialVerified], function (err2) {
                        if (err2) return res.status(500).json({ error: 'Database error: ' + err2.message });
                        res.status(201).json({
                            id: this.lastID,
                            is_verified: initialVerified,
                            message: isAdmin
                                ? 'Property created and published.'
                                : 'Property submitted! It is pending admin approval and will appear on the map once approved.'
                        });
                    });
                };

                if (!isAdmin) {
                    sqliteDb.get(`SELECT COUNT(*) as count FROM properties WHERE user_id = ?`, [user_id], (err, row) => {
                        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
                        if (row.count >= 2) {
                            return res.status(400).json({ error: 'Maximum 2 properties allowed per landlord.' });
                        }
                        insertProperty();
                    });
                } else {
                    insertProperty();
                }
            });
        }
    } catch (err) {
        console.error('Create property error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// UPDATE PROPERTY (Owner or Admin)
app.put('/api/properties/:id', async (req, res) => {
    const { id } = req.params;
    const { user_id, name, desc, price, phone, image } = req.body;
    const trimmedName = name ? String(name).trim() : '';
    const trimmedDesc = desc ? String(desc).trim() : '';
    const trimmedPrice = price ? String(price).trim() : '';
    const trimmedPhone = phone ? String(phone).trim() : '';

    if (!user_id || !trimmedName || !trimmedDesc || !trimmedPrice || !trimmedPhone || !hasValidPhotos(image)) {
        return res.status(400).json({ error: 'All fields (Property Name, Description, Monthly Rent, Contact Phone Number, and at least 1 Photo) are mandatory.' });
    }

    try {
        if (dbType === 'mssql') {
            const userRes = await mssqlPool.request()
                .input('user_id', sql.Int, user_id)
                .query('SELECT role FROM users WHERE id = @user_id');
            const isAdmin = userRes.recordset.length > 0 && userRes.recordset[0].role === 'admin';

            const query = isAdmin
                ? `UPDATE properties SET name = @name, [desc] = @desc, price = @price, phone = @phone, image = @image WHERE id = @id`
                : `UPDATE properties SET name = @name, [desc] = @desc, price = @price, phone = @phone, image = @image WHERE id = @id AND user_id = @user_id`;

            const reqObj = mssqlPool.request()
                .input('id', sql.Int, id)
                .input('name', sql.NVarChar, trimmedName)
                .input('desc', sql.NVarChar, trimmedDesc)
                .input('price', sql.NVarChar, trimmedPrice)
                .input('phone', sql.NVarChar, trimmedPhone)
                .input('image', sql.NVarChar, image || '');
            if (!isAdmin) reqObj.input('user_id', sql.Int, user_id);

            const result = await reqObj.query(query);
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ error: 'Property not found or user is not authorized to edit it.' });
            }
            res.status(200).json({ message: 'Property updated successfully.' });
        } else {
            sqliteDb.get(`SELECT role FROM users WHERE id = ?`, [user_id], (errUser, userRow) => {
                if (errUser) return res.status(500).json({ error: 'Database error: ' + errUser.message });
                const isAdmin = userRow && userRow.role === 'admin';

                const sqlQuery = isAdmin
                    ? `UPDATE properties SET name = ?, desc = ?, price = ?, phone = ?, image = ? WHERE id = ?`
                    : `UPDATE properties SET name = ?, desc = ?, price = ?, phone = ?, image = ? WHERE id = ? AND user_id = ?`;
                const params = isAdmin
                    ? [trimmedName, trimmedDesc, trimmedPrice, trimmedPhone, image || '', id]
                    : [trimmedName, trimmedDesc, trimmedPrice, trimmedPhone, image || '', id, user_id];

                sqliteDb.run(sqlQuery, params, function (err) {
                    if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
                    if (this.changes === 0) return res.status(404).json({ error: 'Property not found or not owned by you.' });
                    res.json({ message: 'Property updated successfully.' });
                });
            });
        }
    } catch (err) {
        console.error('Update property error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// DELETE PROPERTY (Owner or Admin)
app.delete('/api/properties/:id', async (req, res) => {
    const { id } = req.params;
    const user_id = (req.body && req.body.user_id) ? req.body.user_id : req.query.user_id;
    if (!user_id) return res.status(400).json({ error: 'user_id is required.' });

    try {
        if (dbType === 'mssql') {
            const userRes = await mssqlPool.request()
                .input('user_id', sql.Int, user_id)
                .query('SELECT role FROM users WHERE id = @user_id');
            const isAdmin = userRes.recordset.length > 0 && userRes.recordset[0].role === 'admin';

            // Delete associated images
            const propRes = await mssqlPool.request().input('id', sql.Int, id).query('SELECT image FROM properties WHERE id = @id');
            if (propRes.recordset.length > 0 && propRes.recordset[0].image) {
                try {
                    const parsed = JSON.parse(propRes.recordset[0].image);
                    const urls = Array.isArray(parsed) ? parsed : [parsed];
                    urls.forEach(u => {
                        const fp = path.join(UPLOAD_DIR, path.basename(u));
                        try { fs.unlinkSync(fp); } catch (e) { }
                    });
                } catch (e) {
                    const fp = path.join(UPLOAD_DIR, path.basename(propRes.recordset[0].image));
                    try { fs.unlinkSync(fp); } catch (e) { }
                }
            }

            const deleteQuery = isAdmin
                ? `DELETE FROM properties WHERE id = @id`
                : `DELETE FROM properties WHERE id = @id AND user_id = @user_id`;
            const reqObj = mssqlPool.request().input('id', sql.Int, id);
            if (!isAdmin) reqObj.input('user_id', sql.Int, user_id);

            const result = await reqObj.query(deleteQuery);
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ error: 'Property not found or user is not authorized to delete it.' });
            }
            res.status(200).json({ message: 'Property deleted successfully.' });
        } else {
            sqliteDb.get(`SELECT role FROM users WHERE id = ?`, [user_id], (errUser, userRow) => {
                if (errUser) return res.status(500).json({ error: 'Database error: ' + errUser.message });
                const isAdmin = userRow && userRow.role === 'admin';

                sqliteDb.get(`SELECT image FROM properties WHERE id = ?`, [id], (errImg, propRow) => {
                    if (propRow && propRow.image) {
                        try {
                            const parsed = JSON.parse(propRow.image);
                            const urls = Array.isArray(parsed) ? parsed : [parsed];
                            urls.forEach(u => {
                                const fp = path.join(UPLOAD_DIR, path.basename(u));
                                try { fs.unlinkSync(fp); } catch (e) { }
                            });
                        } catch (e) {
                            const fp = path.join(UPLOAD_DIR, path.basename(propRow.image));
                            try { fs.unlinkSync(fp); } catch (e) { }
                        }
                    }

                    const sqlQuery = isAdmin
                        ? `DELETE FROM properties WHERE id = ?`
                        : `DELETE FROM properties WHERE id = ? AND user_id = ?`;
                    const params = isAdmin ? [id] : [id, user_id];

                    sqliteDb.run(sqlQuery, params, function (err) {
                        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
                        if (this.changes === 0) return res.status(404).json({ error: 'Property not found or not owned by you.' });
                        res.json({ message: 'Property deleted successfully.' });
                    });
                });
            });
        }
    } catch (err) {
        console.error('Delete property error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// TOGGLE PROPERTY VERIFICATION (Admin only)
app.patch('/api/properties/:id/verify', async (req, res) => {
    const { id } = req.params;
    const { admin_id, is_verified } = req.body;
    if (!admin_id) return res.status(401).json({ error: 'Admin authentication required.' });

    const newStatus = (is_verified === 1 || is_verified === true || is_verified === '1') ? 1 : 0;

    try {
        if (dbType === 'mssql') {
            const adminCheck = await mssqlPool.request()
                .input('admin_id', sql.Int, admin_id)
                .query('SELECT role FROM users WHERE id = @admin_id');
            if (adminCheck.recordset.length === 0 || adminCheck.recordset[0].role !== 'admin') {
                return res.status(403).json({ error: 'Unauthorized. Admin privileges required.' });
            }

            await mssqlPool.request()
                .input('id', sql.Int, id)
                .input('is_verified', sql.Int, newStatus)
                .query('UPDATE properties SET is_verified = @is_verified WHERE id = @id');

            res.status(200).json({
                message: newStatus === 1 ? 'Listing marked as Polisewa Verified!' : 'Listing verification removed.',
                is_verified: newStatus
            });
        } else {
            sqliteDb.get(`SELECT role FROM users WHERE id = ?`, [admin_id], (err, admin) => {
                if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
                if (!admin || admin.role !== 'admin') {
                    return res.status(403).json({ error: 'Unauthorized. Admin privileges required.' });
                }

                sqliteDb.run(`UPDATE properties SET is_verified = ? WHERE id = ?`, [newStatus, id], function (updateErr) {
                    if (updateErr) return res.status(500).json({ error: 'Database error: ' + updateErr.message });
                    res.json({
                        message: newStatus === 1 ? 'Listing approved and visible on public map!' : 'Listing hidden from public map (Pending approval).',
                        is_verified: newStatus
                    });
                });
            });
        }
    } catch (err) {
        console.error('Verify property error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// ADMIN: GET PLATFORM STATISTICS
app.get('/api/admin/stats', async (req, res) => {
    const admin_id = req.query.admin_id;
    if (!admin_id) return res.status(401).json({ error: 'Admin ID required.' });

    try {
        if (dbType === 'mssql') {
            const adminCheck = await mssqlPool.request()
                .input('admin_id', sql.Int, admin_id)
                .query('SELECT role FROM users WHERE id = @admin_id');
            if (adminCheck.recordset.length === 0 || adminCheck.recordset[0].role !== 'admin') {
                return res.status(403).json({ error: 'Unauthorized. Admin privileges required.' });
            }

            const statsRes = await mssqlPool.request().query(`
                SELECT
                    (SELECT COUNT(*) FROM properties) AS totalProperties,
                    (SELECT COUNT(*) FROM properties WHERE is_verified = 1) AS verifiedProperties,
                    (SELECT COUNT(*) FROM users WHERE role = 'student') AS totalStudents,
                    (SELECT COUNT(*) FROM users WHERE role = 'landlord') AS totalLandlords,
                    (SELECT COUNT(*) FROM users WHERE role = 'admin') AS totalAdmins,
                    (SELECT COUNT(*) FROM users) AS totalUsers
            `);
            res.status(200).json(statsRes.recordset[0]);
        } else {
            sqliteDb.get(`SELECT role FROM users WHERE id = ?`, [admin_id], (err, admin) => {
                if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
                if (!admin || admin.role !== 'admin') {
                    return res.status(403).json({ error: 'Unauthorized. Admin privileges required.' });
                }

                sqliteDb.get(`
                    SELECT
                        (SELECT COUNT(*) FROM properties) AS totalProperties,
                        (SELECT COUNT(*) FROM properties WHERE is_verified = 1) AS verifiedProperties,
                        (SELECT COUNT(*) FROM users WHERE role = 'student') AS totalStudents,
                        (SELECT COUNT(*) FROM users WHERE role = 'landlord') AS totalLandlords,
                        (SELECT COUNT(*) FROM users WHERE role = 'admin') AS totalAdmins,
                        (SELECT COUNT(*) FROM users) AS totalUsers
                `, [], (errStats, stats) => {
                    if (errStats) return res.status(500).json({ error: 'Database error: ' + errStats.message });
                    res.json(stats);
                });
            });
        }
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// ADMIN: GET ALL REGISTERED USERS
app.get('/api/admin/users', async (req, res) => {
    const admin_id = req.query.admin_id;
    if (!admin_id) return res.status(401).json({ error: 'Admin ID required.' });

    try {
        if (dbType === 'mssql') {
            const adminCheck = await mssqlPool.request()
                .input('admin_id', sql.Int, admin_id)
                .query('SELECT role FROM users WHERE id = @admin_id');
            if (adminCheck.recordset.length === 0 || adminCheck.recordset[0].role !== 'admin') {
                return res.status(403).json({ error: 'Unauthorized. Admin privileges required.' });
            }

            const usersRes = await mssqlPool.request().query(`
                SELECT 
                    u.id, 
                    u.name, 
                    u.email, 
                    u.phone, 
                    u.role, 
                    u.extra, 
                    u.is_verified,
                    (SELECT COUNT(*) FROM properties p WHERE p.user_id = u.id) AS property_count
                FROM users u
                ORDER BY u.id DESC
            `);
            res.status(200).json(usersRes.recordset);
        } else {
            sqliteDb.get(`SELECT role FROM users WHERE id = ?`, [admin_id], (err, admin) => {
                if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
                if (!admin || admin.role !== 'admin') {
                    return res.status(403).json({ error: 'Unauthorized. Admin privileges required.' });
                }

                sqliteDb.all(`
                    SELECT 
                        u.id, 
                        u.name, 
                        u.email, 
                        u.phone, 
                        u.role, 
                        u.extra, 
                        u.is_verified,
                        (SELECT COUNT(*) FROM properties p WHERE p.user_id = u.id) AS property_count
                    FROM users u
                    ORDER BY u.id DESC
                `, [], (errUsers, rows) => {
                    if (errUsers) return res.status(500).json({ error: 'Database error: ' + errUsers.message });
                    res.json(rows);
                });
            });
        }
    } catch (err) {
        console.error('Admin users error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// ADMIN: DELETE USER ACCOUNT
app.delete('/api/admin/users/:id', async (req, res) => {
    const { id } = req.params;
    const admin_id = (req.body && req.body.admin_id) ? req.body.admin_id : req.query.admin_id;
    if (!admin_id) return res.status(401).json({ error: 'Admin ID required.' });

    try {
        if (dbType === 'mssql') {
            const adminCheck = await mssqlPool.request()
                .input('admin_id', sql.Int, admin_id)
                .query('SELECT role FROM users WHERE id = @admin_id');
            if (adminCheck.recordset.length === 0 || adminCheck.recordset[0].role !== 'admin') {
                return res.status(403).json({ error: 'Unauthorized. Admin privileges required.' });
            }

            const imgRes = await mssqlPool.request()
                .input('user_id', sql.Int, id)
                .query('SELECT image FROM properties WHERE user_id = @user_id');
            imgRes.recordset.forEach(row => {
                if (row.image) {
                    try {
                        const parsed = JSON.parse(row.image);
                        const urls = Array.isArray(parsed) ? parsed : [parsed];
                        urls.forEach(u => {
                            const fp = path.join(UPLOAD_DIR, path.basename(u));
                            try { fs.unlinkSync(fp); } catch (e) { }
                        });
                    } catch (e) {
                        const fp = path.join(UPLOAD_DIR, path.basename(row.image));
                        try { fs.unlinkSync(fp); } catch (e) { }
                    }
                }
            });

            await mssqlPool.request().input('user_id', sql.Int, id).query('DELETE FROM properties WHERE user_id = @user_id');
            await mssqlPool.request().input('id', sql.Int, id).query('DELETE FROM users WHERE id = @id');

            res.status(200).json({ message: 'User account and all associated properties removed.' });
        } else {
            sqliteDb.get(`SELECT role FROM users WHERE id = ?`, [admin_id], (err, admin) => {
                if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
                if (!admin || admin.role !== 'admin') {
                    return res.status(403).json({ error: 'Unauthorized. Admin privileges required.' });
                }

                sqliteDb.all(`SELECT image FROM properties WHERE user_id = ?`, [id], (errImgs, rows) => {
                    if (rows) {
                        rows.forEach(row => {
                            if (row.image) {
                                try {
                                    const parsed = JSON.parse(row.image);
                                    const urls = Array.isArray(parsed) ? parsed : [parsed];
                                    urls.forEach(u => {
                                        const fp = path.join(UPLOAD_DIR, path.basename(u));
                                        try { fs.unlinkSync(fp); } catch (e) { }
                                    });
                                } catch (e) {
                                    const fp = path.join(UPLOAD_DIR, path.basename(row.image));
                                    try { fs.unlinkSync(fp); } catch (e) { }
                                }
                            }
                        });
                    }

                    sqliteDb.run(`DELETE FROM properties WHERE user_id = ?`, [id], (errDelProp) => {
                        if (errDelProp) return res.status(500).json({ error: 'Database error: ' + errDelProp.message });
                        sqliteDb.run(`DELETE FROM users WHERE id = ?`, [id], (errDelUser) => {
                            if (errDelUser) return res.status(500).json({ error: 'Database error: ' + errDelUser.message });
                            res.json({ message: 'User account and all associated properties removed.' });
                        });
                    });
                });
            });
        }
    } catch (err) {
        console.error('Admin delete user error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// ADMIN: TOGGLE USER EMAIL VERIFICATION
app.patch('/api/admin/users/:id/verify', async (req, res) => {
    const { id } = req.params;
    const { admin_id, is_verified } = req.body;
    if (!admin_id) return res.status(401).json({ error: 'Admin ID required.' });

    const newStatus = (is_verified === 1 || is_verified === true || is_verified === '1') ? 1 : 0;

    try {
        if (dbType === 'mssql') {
            const adminCheck = await mssqlPool.request()
                .input('admin_id', sql.Int, admin_id)
                .query('SELECT role FROM users WHERE id = @admin_id');
            if (adminCheck.recordset.length === 0 || adminCheck.recordset[0].role !== 'admin') {
                return res.status(403).json({ error: 'Unauthorized. Admin privileges required.' });
            }

            await mssqlPool.request()
                .input('id', sql.Int, id)
                .input('is_verified', sql.Int, newStatus)
                .query('UPDATE users SET is_verified = @is_verified WHERE id = @id');

            res.status(200).json({ message: `User verification updated to ${newStatus === 1 ? 'Verified' : 'Unverified'}.`, is_verified: newStatus });
        } else {
            sqliteDb.get(`SELECT role FROM users WHERE id = ?`, [admin_id], (err, admin) => {
                if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
                if (!admin || admin.role !== 'admin') {
                    return res.status(403).json({ error: 'Unauthorized. Admin privileges required.' });
                }

                sqliteDb.run(`UPDATE users SET is_verified = ? WHERE id = ?`, [newStatus, id], function (errUpdate) {
                    if (errUpdate) return res.status(500).json({ error: 'Database error: ' + errUpdate.message });
                    res.json({ message: `User verification updated to ${newStatus === 1 ? 'Verified' : 'Unverified'}.`, is_verified: newStatus });
                });
            });
        }
    } catch (err) {
        console.error('Admin user verify error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// DELETE USER ACCOUNT (Self)
app.delete('/api/user', async (req, res) => {
    const { user_id, password } = req.body;
    if (!user_id || !password) return res.status(400).json({ error: 'user_id and password are required.' });

    try {
        if (dbType === 'mssql') {
            const userRes = await mssqlPool.request()
                .input('user_id', sql.Int, user_id)
                .query('SELECT * FROM users WHERE id = @user_id');
            const user = userRes.recordset[0];
            if (!user) return res.status(404).json({ error: 'User not found.' });

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return res.status(401).json({ error: 'Incorrect password.' });

            const imgRes = await mssqlPool.request()
                .input('user_id', sql.Int, user_id)
                .query('SELECT image FROM properties WHERE user_id = @user_id');
            imgRes.recordset.forEach(row => {
                if (row.image) {
                    try {
                        const parsed = JSON.parse(row.image);
                        const urls = Array.isArray(parsed) ? parsed : [parsed];
                        urls.forEach(u => {
                            const fp = path.join(UPLOAD_DIR, path.basename(u));
                            try { fs.unlinkSync(fp); } catch (e) { }
                        });
                    } catch (e) {
                        const fp = path.join(UPLOAD_DIR, path.basename(row.image));
                        try { fs.unlinkSync(fp); } catch (e) { }
                    }
                }
            });

            await mssqlPool.request()
                .input('user_id', sql.Int, user_id)
                .query('DELETE FROM properties WHERE user_id = @user_id');

            await mssqlPool.request()
                .input('user_id', sql.Int, user_id)
                .query('DELETE FROM users WHERE id = @user_id');

            res.status(200).json({ message: 'Account and all associated data deleted permanently.' });
        } else {
            sqliteDb.get(`SELECT * FROM users WHERE id = ?`, [user_id], async (err, user) => {
                if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
                if (!user) return res.status(404).json({ error: 'User not found.' });

                try {
                    const isMatch = await bcrypt.compare(password, user.password);
                    if (!isMatch) return res.status(401).json({ error: 'Incorrect password.' });
                } catch (e) {
                    return res.status(500).json({ error: 'Server error.' });
                }

                sqliteDb.all(`SELECT image FROM properties WHERE user_id = ?`, [user_id], (err2, rows) => {
                    if (err2) return res.status(500).json({ error: 'Database error: ' + err2.message });
                    if (rows) {
                        rows.forEach(row => {
                            if (row.image) {
                                try {
                                    const parsed = JSON.parse(row.image);
                                    const urls = Array.isArray(parsed) ? parsed : [parsed];
                                    urls.forEach(u => {
                                        const fp = path.join(UPLOAD_DIR, path.basename(u));
                                        try { fs.unlinkSync(fp); } catch (e) { }
                                    });
                                } catch (e) {
                                    const fp = path.join(UPLOAD_DIR, path.basename(row.image));
                                    try { fs.unlinkSync(fp); } catch (e) { }
                                }
                            }
                        });
                    }

                    sqliteDb.run(`DELETE FROM properties WHERE user_id = ?`, [user_id], (err3) => {
                        if (err3) return res.status(500).json({ error: 'Database error: ' + err3.message });
                        sqliteDb.run(`DELETE FROM users WHERE id = ?`, [user_id], (err4) => {
                            if (err4) return res.status(500).json({ error: 'Database error: ' + err4.message });
                            res.json({ message: 'Account and all associated data deleted permanently.' });
                        });
                    });
                });
            });
        }
    } catch (err) {
        console.error('Delete account error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// Fallback to serve index.html for undefined frontend routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start listening on all network interfaces
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Polisewa server running on port ${PORT}`);
    console.log(`Access endpoint: http://localhost:${PORT}`);
});