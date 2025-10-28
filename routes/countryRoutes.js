import express from "express";

import {
  refreshCountries,
  getCountries,
  getCountryByName,
  deleteCountry,
  getSummaryImage,
  getStatus,
} from "../controllers/countryController.js";
import { pool } from "../config/db.js";

const router = express.Router();

router.post("/refresh", refreshCountries);
router.get("/", getCountries);
router.get("/image", getSummaryImage);
router.get("/status", getStatus);
router.get("/:name", getCountryByName);
router.delete("/:name", deleteCountry);
router.post("/", async (req, res) => {
  try {
    const {
      name,
      capital,
      region,
      population,
      currency_code,
      exchange_rate,
      estimated_gdp,
      flag_url,
    } = req.body;

    const errors = {};

    if (!name || typeof name !== "string" || !name.trim()) {
      errors.name = "is required";
    }

    if (
      population === undefined ||
      population === null ||
      isNaN(population) ||
      Number(population) <= 0
    ) {
      errors.population = "is required and must be a positive number";
    }

    if (
      !currency_code ||
      typeof currency_code !== "string" ||
      !currency_code.trim()
    ) {
      errors.currency_code = "is required";
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors,
      });
    }

    await pool.query(
      `INSERT INTO countries (name, capital, region, population, currency_code, exchange_rate, estimated_gdp, flag_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       capital=VALUES(capital),
       region=VALUES(region),
       population=VALUES(population),
       currency_code=VALUES(currency_code),
       exchange_rate=VALUES(exchange_rate),
       estimated_gdp=VALUES(estimated_gdp),
       flag_url=VALUES(flag_url)`,
      [
        name.trim(),
        capital || null,
        region || null,
        Number(population),
        currency_code.trim(),
        exchange_rate || null,
        estimated_gdp || null,
        flag_url || null,
      ]
    );

    res.status(201).json({ message: "Country added or updated successfully" });
  } catch (err) {
    console.error("Manual insert error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
