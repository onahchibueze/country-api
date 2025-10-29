import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import countryRoutes from "./routes/countryRoutes.js";
import { getStatus } from "./controllers/countryController.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.get("/status", getStatus);
app.use("/countries", countryRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
