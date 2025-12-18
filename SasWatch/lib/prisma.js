// Prisma Client Setup
// Singleton pattern for optimal connection pooling

const { PrismaClient } = require('@prisma/client');

const prismaClientSingleton = () => {
    // Limit connection pool to prevent memory exhaustion on Railway
    // Default pool is based on (num_cpus * 2 + 1) which can be too high
    const databaseUrl = process.env.DATABASE_URL || '';
    
    // Add connection pool parameters if not already present
    let connectionUrl = databaseUrl;
    if (databaseUrl && !databaseUrl.includes('connection_limit')) {
        const separator = databaseUrl.includes('?') ? '&' : '?';
        connectionUrl = `${databaseUrl}${separator}connection_limit=5&pool_timeout=30`;
    }
    
    return new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        datasources: connectionUrl !== databaseUrl ? {
            db: {
                url: connectionUrl
            }
        } : undefined
    });
};

// Prevent multiple instances in development (hot reload)
const globalForPrisma = global;

const prisma = globalForPrisma.prisma || prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

module.exports = prisma;

