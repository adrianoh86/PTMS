import sql from "mssql";
const required = ["DB_SERVER","DB_NAME","DB_USER","DB_PASSWORD"] as const;
for (const key of required) { if (!process.env[key]) throw new Error("Missing environment variable: " + key); }
export const dbConfig: sql.config = {
 server: process.env.DB_SERVER!, port: Number(process.env.DB_PORT || 1433), database: process.env.DB_NAME!,
 user: process.env.DB_USER!, password: process.env.DB_PASSWORD!,
 options: { encrypt: process.env.DB_ENCRYPT !== "false", trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true" },
 pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }, connectionTimeout: 15000, requestTimeout: 30000
};
let poolPromise: Promise<sql.ConnectionPool> | undefined;
export function getPool(): Promise<sql.ConnectionPool> {
 if (!poolPromise) poolPromise = new sql.ConnectionPool(dbConfig).connect().catch(err => { poolPromise = undefined; throw err; });
 return poolPromise;
}
