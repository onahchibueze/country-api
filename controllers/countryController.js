import axios from "axios";
import fs from "fs";
import path from "path";
import { pool } from "../config/db.js";
import { createCanvas } from "@napi-rs/canvas";

const cachePath = path.resolve("cache/summary.png");

const computeGDP = (population, exchangeRate) => {
  const multiplier = Math.floor(Math.random() * 1001) + 1000;
  return (population * multiplier) / exchangeRate;
};

export const refreshCountries = async (req, res) => {
  let countriesRes, ratesRes;

  try {
    countriesRes = await axios.get(
      "https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies",
      { timeout: 15000 }
    );
  } catch (err) {
    console.error("Failed fetching countries:", err.message || err);
    return res.status(503).json({
      error: "External data source unavailable",
      details: "Could not fetch data from restcountries.com",
    });
  }

  try {
    ratesRes = await axios.get("https://open.er-api.com/v6/latest/USD", {
      timeout: 15000,
    });
  } catch (err) {
    console.error("Failed fetching exchange rates:", err.message || err);
    return res.status(503).json({
      error: "External data source unavailable",
      details: "Could not fetch data from open.er-api.com",
    });
  }

  const countriesData = countriesRes.data;
  const rates = ratesRes.data?.rates || {};
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    for (const c of countriesData) {
      const name = c.name || null;
      const capital = c.capital || null;
      const region = c.region || null;
      const population = typeof c.population === "number" ? c.population : 0;
      const currencies = Array.isArray(c.currencies) ? c.currencies : [];

      let currency_code = null;
      let exchange_rate = null;
      let estimated_gdp = null;

      if (currencies.length === 0) {
        currency_code = null;
        exchange_rate = null;
        estimated_gdp = 0;
      } else {
        currency_code = currencies[0]?.code || null;

        if (
          currency_code &&
          Object.prototype.hasOwnProperty.call(rates, currency_code)
        ) {
          exchange_rate = Number(rates[currency_code]);

          if (!exchange_rate || exchange_rate === 0) {
            exchange_rate = null;
            estimated_gdp = null;
          } else {
            estimated_gdp = computeGDP(population, exchange_rate);
          }
        } else {
          exchange_rate = null;
          estimated_gdp = null;
        }
      }

      await conn.query(
        `INSERT INTO countries
          (name, capital, region, population, currency_code, exchange_rate, estimated_gdp, flag_url, last_refreshed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          capital = VALUES(capital),
          region = VALUES(region),
          population = VALUES(population),
          currency_code = VALUES(currency_code),
          exchange_rate = VALUES(exchange_rate),
          estimated_gdp = VALUES(estimated_gdp),
          flag_url = VALUES(flag_url),
          last_refreshed_at = NOW()`,
        [
          name,
          capital,
          region,
          population,
          currency_code,
          exchange_rate,
          estimated_gdp,
          c.flag || null,
        ]
      );
    }

    await conn.query(
      `INSERT INTO metadata (key_name, key_value)
       VALUES ('last_refreshed_at', NOW())
       ON DUPLICATE KEY UPDATE key_value = NOW()`
    );

    await conn.commit();
    await generatedSummaryImage();

    const [countRows] = await conn.query(
      "SELECT COUNT(*) AS total FROM countries"
    );
    const total = countRows[0]?.total || 0;

    conn.release();

    return res.json({
      message: "Countries refreshed successfully",
      total_countries: total,
    });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rbErr) {
      console.error("Rollback failed:", rbErr);
    }
    conn.release();
    console.error("Refresh failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getCountries = async (req, res) => {
  try {
    const { region, currency, sort } = req.query;
    let query = "SELECT * FROM countries";
    const params = [];
    const filters = [];

    if (region) {
      filters.push("region = ?");
      params.push(region);
    }
    if (currency) {
      filters.push("currency_code = ?");
      params.push(currency);
    }

    if (filters.length) query += " WHERE " + filters.join(" AND ");

    if (sort === "gdp_desc") query += " ORDER BY estimated_gdp DESC";
    else if (sort === "gdp_asc") query += " ORDER BY estimated_gdp ASC";

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("getCountries error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getCountryByName = async (req, res) => {
  try {
    const name = req.params.name;
    const [rows] = await pool.query(
      "SELECT * FROM countries WHERE LOWER(name) = LOWER(?)",
      [name]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Country not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("getCountryByName error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getStatus = async (req, res) => {
  try {
    const [count] = await pool.query("SELECT COUNT(*) AS total FROM countries");
    const [meta] = await pool.query(
      "SELECT key_value FROM metadata WHERE key_name='last_refreshed_at'"
    );
    const lastRefresh = meta[0]?.key_value
      ? new Date(meta[0].key_value).toISOString()
      : null;
    res.json({
      total_countries: count[0].total,
      last_refreshed_at: lastRefresh,
    });
  } catch (err) {
    console.error("getStatus error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

const generatedSummaryImage = async () => {
  const [top5] = await pool.query(
    "SELECT name, estimated_gdp FROM countries ORDER BY estimated_gdp DESC LIMIT 5"
  );
  const [meta] = await pool.query(
    "SELECT key_value FROM metadata WHERE key_name='last_refreshed_at'"
  );
  const lastRefresh = meta[0]?.key_value
    ? new Date(meta[0].key_value).toISOString()
    : "N/A";
  const [countRows] = await pool.query(
    "SELECT COUNT(*) AS total FROM countries"
  );
  const total = countRows[0]?.total || 0;

  const width = 800;
  const height = 480;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#000000";
  ctx.font = "28px Sans";
  ctx.fillText("Country Summary Report", 24, 48);

  ctx.font = "20px Sans";
  ctx.fillText(`Total Countries: ${total}`, 24, 88);
  ctx.fillText(`Last Refresh: ${lastRefresh}`, 24, 118);

  ctx.fillText("Top 5 by Estimated GDP:", 24, 160);
  ctx.font = "18px Sans";
  top5.forEach((r, i) => {
    const gdpText =
      r.estimated_gdp === null ? "N/A" : Number(r.estimated_gdp).toFixed(2);
    ctx.fillText(`${i + 1}. ${r.name} — ${gdpText}`, 40, 190 + i * 30);
  });

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, canvas.toBuffer("image/png"));
};

export const getSummaryImage = async (req, res) => {
  try {
    if (!fs.existsSync(cachePath))
      return res.status(404).json({ error: "Summary image not found" });
    return res.sendFile(cachePath);
  } catch (err) {
    console.error("getSummaryImage error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteCountry = async (req, res) => {
  try {
    const name = req.params.name;
    const [result] = await pool.query(
      "DELETE FROM countries WHERE LOWER(name) = LOWER(?)",
      [name]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Country not found" });
    res.json({ message: "Country deleted successfully" });
  } catch (err) {
    console.error("deleteCountry error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
