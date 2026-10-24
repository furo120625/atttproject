const path = require('path');
const fs = require('fs');
require('dotenv').config({path: path.resolve(__dirname, '../../.env'), quiet: true});
const options = {host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'seruchat', charset: 'utf8mb4'};
if (process.env.DB_SSL === '1') {
    options.ssl = {rejectUnauthorized: true, ...(process.env.DB_SSL_CA_FILE ? {ca: fs.readFileSync(path.resolve(process.env.DB_SSL_CA_FILE), 'utf8')} : {})};
}
if (process.env.NODE_ENV === 'production' && !['localhost', '127.0.0.1', '::1'].includes(options.host) && !options.ssl) {
    throw new Error('Remote production MySQL requires DB_SSL=1 and a trusted certificate.');
}
module.exports = options;
