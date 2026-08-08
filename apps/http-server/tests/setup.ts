/**
 * Boot env for the vault suite. These are throwaway values that exist only so the SEC 15.4
 * fail-fast boot guards pass; they are not secrets and never touch a real deployment.
 */
import { randomBytes } from 'node:crypto';

process.env.KEY_VAULT_MASTER_KEY ??= randomBytes(32).toString('base64');
process.env.JWT_SECRET ??= 'test-jwt-secret-not-the-vault-master';
process.env.NODE_ENV ??= 'test';
