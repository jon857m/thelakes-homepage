import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@maptiler/sdk/dist/maptiler-sdk.css";
import "./styles.css";
import { App } from "./App";
import { AdminApp } from "./AdminApp";

const isAccountRoute = window.location.pathname.startsWith("/map/login") || window.location.pathname.startsWith("/map/admin") || window.location.pathname.startsWith("/map/business");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isAccountRoute ? <AdminApp /> : <App />}
  </StrictMode>
);
