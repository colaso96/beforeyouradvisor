import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PrivacyPolicyPage, TermsOfServicePage } from "./LegalPage";
import "./styles.css";

const path = window.location.pathname.replace(/\/+$/, "") || "/";
let page = <App />;

if (path === "/privacy" || path === "/privacy-policy") {
  page = <PrivacyPolicyPage />;
} else if (path === "/terms" || path === "/terms-of-service") {
  page = <TermsOfServicePage />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {page}
  </React.StrictMode>,
);
