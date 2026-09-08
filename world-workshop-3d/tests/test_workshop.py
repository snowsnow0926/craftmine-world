"""Offline acceptance tests. Chromium policies block navigation and WebGL here.
Uses set_content, a test-only localStorage shim, and the real shipped CPU 3D fallback.
No network or policy changes. Native browser WebGL/localStorage are NOT certified.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,time
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text()
checks=[]; errors=[]; requests=[]
counts={}
def write_report():
    report={'environment':{'renderer':'shipped CPU perspective-3D fallback; browser WebGL unavailable','storage':'Map-backed test shim; native storage not certified','navigation':'Playwright set_content, no network or policy changes','world':counts},'passed':sum(x['passed'] for x in checks),'checks':checks,'errors':errors,'requests':requests,'not_verified':['Browser-native WebGL rendering','Native browser storage across restarts','Native pointer lock','Physical Android/iOS devices','Native file downloads']}
    (ROOT/'test-report-core.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
def check(name,value,details=None):
    checks.append({'name':name,'passed':bool(value),'details':details})
    print(('PASS ' if value else 'FAIL ')+name,details if not value else '',flush=True)
    write_report()
    if not value: raise AssertionError(name+': '+str(details))
def mount(browser,initial=None,mobile=False):
    page=browser.new_page(viewport={'width':390,'height':844} if mobile else {'width':1440,'height':1000},device_scale_factor=1,is_mobile=mobile,has_touch=mobile)
    page.set_default_timeout(5000)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    page.on('request',lambda r:requests.append(r.url))
    page.evaluate('''values=>{const memory=new Map(Object.entries(values||{}));window.__storage=memory;Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)}});}''',initial or {})
    page.set_content(HTML,wait_until='load')
    page.wait_for_function('!!window.workshop')
    return page

def apply(page):
    page.wait_for_function('!!workshop.getState().pending')
    page.evaluate('workshop.applyPending()')
    page.wait_for_function('!workshop.getState().pending')
    page.wait_for_timeout(120)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage'])
    page=mount(browser)
    builtin_examples=page.evaluate('Object.fromEntries(["harvest","sakura","night"].map(k=>[k,workshop.builtin(k)]))')
    check('3D runtime boots without errors',page.evaluate('!!workshop.runtime && document.getElementById("errorScreen").hidden'))
    counts=page.evaluate('({chunks:workshop.runtime.meshes.size,trees:workshop.runtime.trees.size,vertices:[...workshop.runtime.meshes.values()].reduce((n,m)=>n+m.count,0),software:workshop.runtime.software})')
    check('Chunked world and tree entities generated',counts['chunks']==36 and counts['trees']>=50,counts)
    check('DDA raycast finds the tree in front of spawn',page.evaluate('workshop.runtime.target?.treeId==="tree-001"'))
    page.wait_for_timeout(700)
    page.screenshot(path=str(ROOT/'preview-desktop.png'))
    check('Desktop layout fits viewport',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    # Keyboard event path, without requesting unavailable pointer lock.
    page.evaluate('workshop.runtime.input=true;document.getElementById("world").focus();')
    before=page.evaluate('({...workshop.runtime.p})');page.keyboard.down('KeyD');page.wait_for_timeout(320);page.keyboard.up('KeyD');after=page.evaluate('({...workshop.runtime.p})')
    check('D moves to camera-right through real keyboard handler',after['x']>before['x']+.3,{'before':before,'after':after})
    page.keyboard.down('KeyA');page.wait_for_timeout(320);page.keyboard.up('KeyA');back=page.evaluate('({...workshop.runtime.p})')
    check('A moves to camera-left',back['x']<after['x']-.3)
    # Deterministic physics: pause RAF simulation, advance at 60 Hz.
    phy=page.evaluate('''()=>{const r=workshop.runtime;r.setActive(false);const reset=()=>{r.keys.clear();r.input=true;r.fly=false;r.p={x:-5,y:6,z:20,yaw:0,pitch:0};r.vy=0;r.grounded=true;};reset();r.keys.add('KeyW');for(let i=0;i<30;i++)r.update(1/60,i*17);const forward=r.p.z;reset();r.keys.add('KeyW');r.keys.add('KeyD');for(let i=0;i<30;i++)r.update(1/60,i*17);const diagonal=Math.hypot(r.p.x+5,r.p.z-20);reset();r.keys.add('Space');let peak=6;for(let i=0;i<110;i++){if(i===3)r.keys.delete('Space');r.update(1/60,i*17);peak=Math.max(peak,r.p.y);}const landed=r.p.y;reset();r.put(-4,6,20,3);r.put(-4,7,20,3);r.keys.add('KeyD');for(let i=0;i<40;i++)r.update(1/60,i*17);const wall=r.p.x;r.put(-4,6,20,0);r.put(-4,7,20,0);r.pauseInput();r.respawn(false);return{forward,diagonal,peak,landed,wall};}''')
    check('W moves forward (negative Z)',phy['forward']<18,phy)
    check('Diagonal movement is normalized',abs(phy['diagonal']-2.25)<.12,phy)
    check('Jump rises and lands on terrain',phy['peak']>7 and abs(phy['landed']-6)<.05,phy)
    check('Solid two-block wall prevents walking through',phy['wall']<-4.28,phy)
    page.evaluate('workshop.runtime.setActive(true);workshop.runtime.pauseInput();workshop.runtime.respawn(false)')
    # Raycasting / placement / undo use shipped runtime, not a stand-in.
    edits=page.evaluate('''()=>{const r=workshop.runtime;r.p.pitch=-.7;r.update(.016,0);const target=r.target;r.placeBlock();const placed=Object.keys(r.edits).length;const block=r.get(target.x,target.y+1,target.z);r.undoBlock();return{placed,block,after:Object.keys(r.edits).length};}''')
    check('Placing and undoing a real voxel',edits['placed']==1 and edits['after']==0 and edits['block']==6,edits)
    inside=page.evaluate('''()=>{const r=workshop.runtime;r.target={x:Math.floor(r.p.x),y:5,z:Math.floor(r.p.z),normal:[0,1,0]};const n=Object.keys(r.edits).length;r.placeBlock();return Object.keys(r.edits).length===n;}''')
    check('Cannot place a block inside the player',inside)
    page.evaluate('workshop.runtime.respawn(false);workshop.runtime.update(.016,0);workshop.runtime.interact()')
    check('Harvest is gated before its rule is installed',page.evaluate('workshop.runtime.wood===0 && workshop.runtime.collected.length===0'))
    page.evaluate('workshop.openAgent(workshop.runtime.target)')
    page.locator('#prompt').fill('让树木可以被砍，每次掉落3份木材')
    page.locator('#sendBtn').click();page.wait_for_function('!!workshop.getState().pending')
    check('Candidate does not mutate running config',page.evaluate('!workshop.getState().config.harvest && workshop.getState().pending.patch.yield===3'))
    check('Agent carries object context', 'tree-001' in page.locator('#contextTarget').text_content())
    # Latest progress between request and apply must survive.
    page.evaluate('''()=>{const r=workshop.runtime;r.p.x-=.35;r.setBlock(-6,6,18,6);r.wood=4;}''')
    snapshot=page.evaluate('workshop.runtime.snapshot()')
    apply(page)
    after=page.evaluate('workshop.getState()')
    check('Apply updates harvest and yield',after['config']['harvest'] and after['config']['yield']==3)
    check('Apply preserves latest position, inventory and hand edits',after['state']==snapshot,{'before':snapshot,'after':after['state']})
    page.evaluate('workshop.runtime.respawn(false);workshop.runtime.update(.016,0);workshop.runtime.interact()')
    check('Harvest removes tree and grants configured reward',page.evaluate('workshop.runtime.collected.includes("tree-001")&&workshop.runtime.wood===7&&workshop.runtime.get(-9,7,10)===0'))
    page.evaluate('workshop.runtime.target={treeId:"tree-001"};workshop.runtime.interact()')
    check('A collected tree cannot reward twice',page.evaluate('workshop.runtime.wood===7'))
    page.locator('[data-mode="assets"]').click();page.locator('[data-style="sakura"]').click();page.locator('#bindBtn').click();apply(page)
    check('Asset binding preserves gameplay and harvested tree',page.evaluate('workshop.getState().config.treeStyle==="sakura" && workshop.getState().config.harvest && workshop.runtime.wood===7 && workshop.runtime.get(-9,7,10)===0 && workshop.runtime.get(-6,6,18)===6'))
    page.evaluate('workshop.startJob({bridge:true},"河上木桥")');apply(page)
    check('Bridge geometry is present and has collision',page.evaluate('workshop.runtime.get(8,5,-3)===6 && workshop.runtime.collision(8.5,5.2,-2.5)'))
    page.evaluate('workshop.runtime.respawn(false);document.getElementById("enterCard").hidden=true;document.getElementById("resumePill").hidden=true;document.getElementById("toast").classList.remove("visible");')
    page.wait_for_timeout(500);page.screenshot(path=str(ROOT/'preview-updated-world.png'))
    before=page.evaluate('workshop.runtime.snapshot()')
    page.evaluate('workshop.startJob({night:true},"夜晚")');apply(page)
    check('Night update retains world edits and inventory',page.evaluate('workshop.getState().config.night') and page.evaluate('workshop.runtime.snapshot()')==before)
    page.locator('#historyBtn').click();page.locator('#modalContent [data-rollback="1"]').click();apply(page)
    check('Config rollback keeps play progress and hand edits',page.evaluate('!workshop.getState().config.harvest && workshop.runtime.wood===7 && workshop.runtime.get(-6,6,18)===6 && workshop.runtime.collected.includes("tree-001")'))
    # Scope validation and rejection.
    validation=page.evaluate('''()=>{const result={};const bad=f=>{try{f();return false;}catch{return true;}};result.bounds=bad(()=>workshop.validateState({...workshop.runtime.snapshot(),player:{x:100,y:6,z:0,yaw:0,pitch:0}}));result.code=bad(()=>workshop.validatePackage({...workshop.builtin('harvest'),script:'alert(1)'}));result.permissions=bad(()=>workshop.validatePackage({...workshop.builtin('harvest'),permissions:['network']}));result.old=bad(()=>workshop.validatePackage({...workshop.builtin('harvest'),runtime:'demo-iso@1'}));result.yield=bad(()=>workshop.validateConfig({yield:500}));result.proto=bad(()=>workshop.validateConfig(JSON.parse('{"__proto__":{"polluted":true}}')));return result;}''')
    check('Unsafe/invalid packages and parameters are rejected',all(validation.values()),validation)
    page.evaluate('workshop.openAgent({treeId:"tree-002",name:"原木",x:-18,y:7,z:15})')
    page.select_option('#scope','selected');page.locator('#prompt').fill('让这棵树可以被砍，每次掉落5份木材');page.locator('#sendBtn').click();apply(page)
    check('Selected-tree rules do not enable global harvest',page.evaluate('!workshop.getState().config.harvest && workshop.getState().config.treeRules["tree-002"].yield===5 && !workshop.runtime.harvestEnabled("tree-003")'))
    page.select_option('#scope','all')
    # Capture exported JSON via a test-only download sink (browser download policy is not bypassed).
    page.evaluate('''()=>{window.__downloads=[];URL.createObjectURL=b=>{window.__downloads.push(b);return 'blob:local-test';};HTMLAnchorElement.prototype.click=function(){};}''')
    page.locator('#packageBtn').click();page.locator('#packageName').fill('森林测试卡带');page.locator('#exportPackageBtn').click()
    package=page.evaluate('async()=>JSON.parse(await window.__downloads.at(-1).text())')
    check('World cartridge includes real hand-built content',package['kind']=='world' and len(package['world']['edits'])==1 and package['world']['collected']==['tree-001'],package)
    check('World cartridge excludes player personal progress','player' not in package['world'] and 'wood' not in package['world'])
    (ROOT/'sample-world.cartridge.json').write_text(json.dumps(package,ensure_ascii=False,indent=2))
    page.evaluate('workshop.exportSave()');saveExport=page.evaluate('async()=>JSON.parse(await window.__downloads.at(-1).text())')
    check('Full save export includes position and inventory',saveExport['state']['wood']==7 and len(saveExport['state']['edits'])==1)
    previous=page.evaluate('workshop.runtime.snapshot()')
    page.evaluate('workshop.previewInstall(workshop.builtin("night"))');page.locator('#confirmInstallBtn').click();apply(page)
    check('World cartridge creates a fresh world and archives old one',page.evaluate('workshop.getState().config.night && workshop.runtime.wood===0 && Object.keys(workshop.runtime.edits).length===0 && workshop.getState().archives.length===1'))
    page.evaluate('workshop.restoreArchive(0)')
    check('Archive restore recovers the complete old world',page.evaluate('workshop.runtime.snapshot()')==previous)
    page.evaluate('workshop.save()');stored=page.evaluate('Object.fromEntries(window.__storage)')
    state=page.evaluate('workshop.getState()')
    (ROOT/'tests'/'saved-fixture.json').write_text(json.dumps({'storage':stored,'state':state},ensure_ascii=False))
    page.locator('[data-mode="develop"]').click();page.wait_for_timeout(100);page.screenshot(path=str(ROOT/'preview-develop.png'))
    page.locator('[data-mode="assets"]').click();page.wait_for_timeout(100);page.screenshot(path=str(ROOT/'preview-assets.png'))
    page.locator('#libraryBtn').click();page.wait_for_timeout(100);page.screenshot(path=str(ROOT/'preview-cartridges.png'));page.locator('#closeModal').click()
    check('No application JavaScript errors in core tests',not errors,errors)
    check('No external network requests in core tests',not requests,requests)
    for kind,v in builtin_examples.items():
        (ROOT/f'sample-{kind}.cartridge.json').write_text(json.dumps(v,ensure_ascii=False,indent=2))
    write_report()
    print('CORE REPORT SAVED',flush=True)
    page.evaluate('workshop.runtime.dispose()')
    browser.close()
print('CORE',len(checks),'CHECKS COMPLETED')
