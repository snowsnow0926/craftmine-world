import { contextBridge } from "electron";
import { installHeadlessInputGuard } from "../shared/craftmine-headless-input";

contextBridge.executeInMainWorld({ func: installHeadlessInputGuard });
