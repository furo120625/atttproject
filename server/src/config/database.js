const mysql = require('mysql2');
const connection = require('./connection');
module.exports = mysql.createPool({...connection, waitForConnections: true, connectionLimit: 10,
    supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z'});
