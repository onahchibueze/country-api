import { pool } from "./config/db.js";

const createTables = async () => {
  const countriesTable = `
    CREATE TABLE IF NOT EXISTS countries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      capital VARCHAR(255),
      region VARCHAR(255),
      population BIGINT NOT NULL,
      currency_code VARCHAR(10),
      exchange_rate DOUBLE,
      estimated_gdp DOUBLE,
      flag_url TEXT,
      last_refreshed_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_name (name)
    );
  `;

  const metadataTable = `
    CREATE TABLE IF NOT EXISTS metadata (
      key_name VARCHAR(100) PRIMARY KEY,
      key_value VARCHAR(255)
    );
  `;

  const insertMeta = `
    INSERT INTO metadata (key_name, key_value)
    VALUES ('last_refreshed_at', NULL)
    ON DUPLICATE KEY UPDATE key_value = VALUES(key_value);
  `;

  try {
    await pool.query(countriesTable);
    await pool.query(metadataTable);
    await pool.query(insertMeta);
    console.log("✅ Tables created successfully!");
  } catch (err) {
    console.error("❌ Error creating tables:", err.message);
  } finally {
    process.exit(0);
  }
};

createTables();
