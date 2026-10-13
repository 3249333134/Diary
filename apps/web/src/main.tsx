import {I18nProvider} from 'react-aria-components';
import { PlanCategoryProvider } from './PlanCategories';
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./glass-layout.css";
import "./plan-workspace.css";

createRoot(document.getElementById("root")!).render(<StrictMode><I18nProvider locale="zh-CN"><PlanCategoryProvider><App /></PlanCategoryProvider></I18nProvider></StrictMode>);
