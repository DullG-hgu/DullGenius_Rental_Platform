const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// === Configuration ===
const TABLES_TO_BACKUP = [
    'games',
    'rentals',
    'reviews',
    'logs',
    'app_config',
    'profiles',
    'point_transactions',
    'matches'
];

// === Helpers ===

// Simple ANSI color wrapper
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    red: "\x1b[31m",
    bgBlue: "\x1b[44m"
};

const log = {
    info: (msg) => console.log(`${colors.cyan}??${msg}${colors.reset}`),
    success: (msg) => console.log(`${colors.green}??${msg}${colors.reset}`),
    warn: (msg) => console.log(`${colors.yellow}??${msg}${colors.reset}`),
    error: (msg) => console.log(`${colors.red}??${msg}${colors.reset}`),
    header: (msg) => console.log(`\n${colors.bgBlue}${colors.bright} ${msg} ${colors.reset}\n`)
};

// Manually parse .env file
function loadEnv() {
    const envPath = path.resolve(__dirname, '../.env');
    if (!fs.existsSync(envPath)) {
        log.warn('.env file not found in root directory.');
        return {};
    }

    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
            let value = match[2] || '';
            // Remove quotes if present
            if (value.length > 0 &&
                (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
                (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
                value = value.substring(1, value.length - 1);
            }
            env[match[1]] = value.trim();
        }
    });
    return env;
}

// === Main ===

async function main() {
    log.header("Supabase Data Backup Utility");

    const env = loadEnv();

    // URL
    const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
    // Key: Try Service Role first (for full access), then generic Key, then Anon
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || env.VITE_SUPABASE_KEY || env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        log.error("Missing credentials in .env file.");
        log.info("Please ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_KEY) are set.");
        process.exit(1);
    }

    if (!env.SUPABASE_SERVICE_ROLE_KEY && !env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
        log.warn("Running with Anon/Public Key. Some tables (like profiles) may be incomplete due to RLS.");
        log.warn("For a full backup, please add SUPABASE_SERVICE_ROLE_KEY to your .env file.");
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });

    // Create Backup Directory
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = path.resolve(__dirname, `../Supabase backup/${timestamp}`);

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    log.info(`Target Directory: ${backupDir}`);

    // Fetch and Save
    let totalRecords = 0;

    for (const table of TABLES_TO_BACKUP) {
        process.stdout.write(`${colors.dim}Downloading [${table}]... ${colors.reset}`);

        try {
            const { data, error } = await supabase
                .from(table)
                .select('*');

            if (error) {
                process.stdout.write(`\n`);
                log.error(`Failed to fetch ${table}: ${error.message}`);
                continue;
            }

            if (!data) {
                process.stdout.write(`\n`);
                log.warn(`No data returned for ${table}`);
                continue;
            }

            const filePath = path.join(backupDir, `${table}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

            process.stdout.write(`${colors.green}Done (${data.length} records)${colors.reset}\n`);
            totalRecords += data.length;

        } catch (err) {
            process.stdout.write(`\n`);
            log.error(`Exception while processing ${table}: ${err.message}`);
        }
    }

    log.header("Backup Complete");
    console.log(`${colors.green}Successfully backed up ${totalRecords} records across ${TABLES_TO_BACKUP.length} tables.${colors.reset}`);
    console.log(`Location: ${colors.bright}${backupDir}${colors.reset}\n`);
}

main().catch(err => {
    log.error("Fatal Error: " + err.message);
    process.exit(1);
});
