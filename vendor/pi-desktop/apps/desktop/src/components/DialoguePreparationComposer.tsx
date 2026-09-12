type Props = {draft:string;queued:boolean;failed:boolean;cancelling?:boolean;onDraft:(text:string)=>void;onQueue:()=>void;onEdit:()=>void};
/** Separate ownership until the real new session and runtime can receive text. */
export function DialoguePreparationComposer({draft,queued,failed,cancelling,onDraft,onQueue,onEdit}:Props){
  return <section className="dialogue-preparation-composer no-drag" aria-label="新世界描述草稿">
    <label htmlFor="dialogue-preparation-draft">描述你想创建的世界</label>
    <textarea id="dialogue-preparation-draft" value={draft} readOnly={queued||cancelling} placeholder="可以先输入，准备好后再发送…"
      onChange={event=>onDraft(event.target.value)} />
    <div className="dialogue-preparation-actions">
      <span role="status">{queued?"已排队，世界准备好后自动发送。":failed?"描述已保留。":"文字仅保存在这个新世界的草稿中。"}</span>
      {queued?<button type="button" disabled={cancelling} onClick={onEdit}>修改描述</button>:<button type="button" disabled={failed||cancelling||!draft.trim()} onClick={onQueue}>准备好后发送</button>}
    </div>
  </section>;
}
