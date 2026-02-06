import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

import "../../renderer/styles.css";
import "../../renderer/styles.v2.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

