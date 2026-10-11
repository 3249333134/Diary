import { PlanCategoryProvider } from './PlanCategories';
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./glass-layout.css";

createRoot(document.getElementById("root")!).render(<StrictMode><PlanCategoryProvider><App /></PlanCategoryProvider></StrictMode>);
