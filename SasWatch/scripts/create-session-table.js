// Script to create the session table for connect-pg-simple
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/subtracker?schema=public'
});

async function createSessionTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS session (
                sid varchar NOT NULL COLLATE "default",
                sess json NOT NULL,
                expire timestamp(6) NOT NULL,
                CONSTRAINT session_pkey PRIMARY KEY (sid)
            ) WITH (OIDS=FALSE);
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
        `);
        
        console.log('Session table created successfully');
    } catch (error) {
        console.error('Error creating session table:', error.message);
    } finally {
        await pool.end();
    }
}

createSessionTable();

