import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { clearStaleApiBaseOverride } from "./config/apiBase.js";
import App from "./App.jsx";
import "./index.css";

clearStaleApiBaseOverride();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
