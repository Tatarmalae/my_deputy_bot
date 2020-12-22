const config = require('config');
const mysql = require('mysql2');

const SPHINX = config.get('SPHINX');
const DB = config.get('DB');
const METADATA = config.get('METADATA');

let pool = {};

pool.connectSphinx = mysql.createPool(SPHINX);
pool.connectSphinx.getConnection(async (err, connection) => {
  connection.query(`SET NAMES utf8mb4`);
  if (err) throw err;
  connection.release();
});

pool.connectDB = mysql.createPool(DB);
pool.connectDB.getConnection((err, connection) => {
  if (err) throw err;
  connection.release();
});

pool.connectMetaData = mysql.createPool(METADATA);
pool.connectMetaData.getConnection(async (err, connection) => {
  connection.query(`SET NAMES utf8mb4`);
  if (err) throw err;
  connection.release();
});

module.exports = pool;