import {useTranslation} from "react-i18next";
import {useCraftmineWorlds} from "../../hooks/use-craftmine-worlds";
import {craftmineLang} from "../../lib/craftmine-worlds";
import {enterCraftmineMode} from "../../lib/craftmine-mode";
import {WorldListPanel} from "./WorldListPanel";
import {CopyWorldButton} from "./CopyWorldButton";
import {createCopiedWorldSession,useAppStore} from "../../stores/app-store";

/** Legacy projects keep their original runtime, source and save identities. */
export function AdvancedWorldSaves() {
  const {i18n}=useTranslation();
  const lang=craftmineLang(i18n.language);
  const controller=useCraftmineWorlds(lang);
  const sessionId=useAppStore(state=>state.activeSessionId);
  return <details className="settings-card" data-advanced-world-saves>
    <summary>{lang==="zh"?"高级存档管理":"Advanced save management"}</summary>
    <p>{lang==="zh"?"旧作品、版本和未完成的世界保留在这里。打开旧作品不会转换其底座。":"Legacy projects and unfinished worlds remain here. Opening a project keeps its original runtime."}</p>
    <WorldListPanel controller={controller} lang={lang} onOpenWorld={()=>enterCraftmineMode("play",{explicit:true})}/>
    <CopyWorldButton bridge={controller.bridge} worldId={controller.activeWorldId} sessionId={sessionId} onCopied={async(worldId,sourceSessionId)=>{
      const created=await createCopiedWorldSession(worldId,sourceSessionId);enterCraftmineMode("play",{explicit:true});return created;
    }}/>
  </details>;
}
