const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
export class AssetPanel {
  constructor(host){
    this.host=host;this.key='';this.busy=false;this.target=null;this.preview=null;this.generation=0;
    $('asset-import-button').onclick=()=>this.choose(null);$('asset-file').onchange=()=>this.importFile();$('asset-search').oninput=()=>this.list();$('asset-dialog-close').onclick=()=>this.close();
    $('asset-dialog').oncancel=e=>{e.preventDefault();this.close();};$('asset-dialog').onclose=()=>{if(!$('asset-dialog').open)this.close();};
    addEventListener('message',event=>{
      const s=this.preview,m=event.data;if(!s||event.source!==s.frame.contentWindow||event.origin!=='null'||m?.channel!=='craftmine-asset/1'||m.nonce!==s.nonce)return;
      if(m.type==='ready')s.frame.contentWindow.postMessage({channel:'craftmine-asset-host/1',nonce:s.nonce,type:'load',asset:s.asset},'*');
      if(m.type==='loaded'||m.type==='error'){clearTimeout(s.timer);$('asset-dialog-status').textContent=m.type==='error'?m.message:'预览已载入 · 可旋转和缩放';$('asset-dialog-status').dataset.error=String(m.type==='error');$('asset-dialog-notes').textContent=(m.warnings||[]).join('\n');s.frame.dataset.loaded=String(m.type==='loaded');}
    });
  }
  choose(entry){if(this.busy)return;this.target=entry?{id:entry.id,baseVersion:entry.latest,name:entry.name}:null;$('asset-file').click();}
  async importFile(){
    const file=$('asset-file').files[0];if(!file||this.busy)return;this.busy=true;$('asset-import-button').disabled=true;this.list();$('asset-import-status').textContent='正在检查文件并实际绘制素材…';
    try{
      let input;if(file.name.toLowerCase().endsWith('.json')){if(file.size>12_000_000)throw Error('素材包超过 12 MB');if(this.target)throw Error('素材包携带固定版本，请用“导入素材”恢复它');input=JSON.parse(await file.text());}
      else{if(file.size>8*1024*1024)throw Error('素材文件超过 8 MB');const ext=file.name.toLowerCase().split('.').at(-1),mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',glb:'model/gltf-binary'}[ext];if(!mime)throw Error('请选择 PNG、JPEG、GLB 或导出的素材包');input={id:this.target?.id||null,baseVersion:this.target?.baseVersion||null,name:this.target?.name||file.name.replace(/\.[^.]+$/,'').slice(0,80),filename:file.name,mime,data:encode(new Uint8Array(await file.arrayBuffer()))};}
      const result=await this.host.api('/api/assets/import',input);await this.host.refresh();$('asset-import-status').textContent=`素材已保存为 v${result.version}，旧版本继续保留。`;await this.open(result.id,result.version);
    }catch(error){$('asset-import-status').textContent=error.message;}
    finally{this.busy=false;this.target=null;$('asset-file').value='';$('asset-import-button').disabled=false;this.list();}
  }
  render(project){this.project=project;const key=JSON.stringify(project.assets||[]);if(key!==this.key){this.key=key;this.list();}}
  list(){
    const entries=this.project?.assets||[],query=$('asset-search').value.trim().toLowerCase(),out=$('asset-list');out.replaceChildren();$('asset-count').textContent=entries.length+' 项本地素材';
    const matches=entries.filter(e=>(e.name+' '+e.versions.map(v=>v.filename).join(' ')).toLowerCase().includes(query));if(!matches.length)out.append(node('p',query?'没有匹配的素材。':'导入一张图片或一个 GLB 模型，先查看效果，再用于创作。','empty'));
    for(const entry of [...matches].reverse()){
      const card=node('article',undefined,'asset-card');card.dataset.assetId=entry.id;const heading=node('div',undefined,'module-heading');heading.append(node('span',entry.kind==='image'?'▧':'◇','module-icon'),node('h3',entry.name),node('small',entry.kind==='image'?'图片':'3D 模型'));card.append(heading);
      const select=node('select');select.setAttribute('aria-label',entry.name+' 的素材版本');for(const version of [...entry.versions].reverse()){const option=node('option',`v${version.version}${version.version===entry.latest?' · 最新':''}`);option.value=String(version.version);select.append(option);}
      const info=node('p',undefined,'asset-info'),update=()=>{const v=entry.versions.find(v=>v.version===Number(select.value));info.textContent=`${v.filename} · ${Math.ceil(v.bytes/1024)} KB\n`+(entry.kind==='image'?`${v.meta.width} × ${v.meta.height}`:`${v.meta.triangles.toLocaleString()} 个三角面 · ${v.meta.images} 张贴图`);};select.onchange=update;update();
      const actions=node('div',undefined,'module-actions'),button=(text,action)=>{const b=node('button',text,'subtle');b.type='button';b.onclick=()=>Promise.resolve(action()).catch(e=>this.host.toast(e.message));return b;};
      const next=button('导入新版本',()=>this.choose(entry));next.disabled=this.busy;actions.append(select,button('预览',()=>this.open(entry.id,Number(select.value))),next,button('导出素材包',async()=>{const asset=await this.host.api('/api/assets/read?id='+entry.id+'&version='+select.value);this.host.download(asset,`${entry.name}-v${select.value}.craftasset.json`);}));card.append(info,actions);out.append(card);
    }
  }
  async open(id,version){
    this.close();const generation=++this.generation;$('asset-dialog-title').textContent='正在打开素材';$('asset-dialog-status').textContent='正在读取已保存的版本…';$('asset-dialog-status').dataset.error='false';$('asset-dialog-notes').textContent='';$('asset-dialog').showModal();
    try{
      const asset=await this.host.api('/api/assets/read?id='+id+'&version='+version);if(generation!==this.generation||!$('asset-dialog').open)return;
      $('asset-dialog-title').textContent=asset.name+' · v'+asset.version;
      const frame=document.createElement('iframe'),nonce=crypto.randomUUID();frame.title='素材独立预览';frame.setAttribute('sandbox','allow-scripts');frame.src='/asset-viewer#'+nonce;
      const s={frame,nonce,asset,timer:setTimeout(()=>{if(this.preview===s){$('asset-dialog-status').textContent='素材预览载入超时，可关闭后重试';$('asset-dialog-status').dataset.error='true';frame.remove();this.preview=null;}},20000)};this.preview=s;$('asset-dialog-frame').append(frame);
    }catch(error){if(generation===this.generation){$('asset-dialog-status').textContent=error.message;$('asset-dialog-status').dataset.error='true';}}
  }
  close(){this.generation++;if(this.preview){clearTimeout(this.preview.timer);this.preview.frame.remove();this.preview=null;}$('asset-dialog-frame').replaceChildren();if($('asset-dialog').open)$('asset-dialog').close();}
}
