"""Offline acceptance tests. Chromium policies block navigation and WebGL here.
Uses set_content, a test-only localStorage shim, and the real shipped CPU 3D fallback.
No network or policy changes. Native browser WebGL/localStorage are NOT certified.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,time
import sys
PHASE=sys.argv[1] if len(sys.argv)>1 else 'mobile'
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text()
checks=[]; errors=[]; requests=[]
counts={}
def write_report():
    report={'environment':{'renderer':'shipped CPU perspective-3D fallback; browser WebGL unavailable','storage':'Map-backed test shim; native storage not certified','navigation':'Playwright set_content, no network or policy changes','world':counts},'passed':sum(x['passed'] for x in checks),'checks':checks,'errors':errors,'requests':requests,'not_verified':['Browser-native WebGL rendering','Native browser storage across restarts','Native pointer lock','Physical Android/iOS devices','Native file downloads']}
    (ROOT/f'test-report-{PHASE}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
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
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    if PHASE=='persistence':
        fixture=json.loads((ROOT/'tests'/'saved-fixture.json').read_text())
        page=mount(browser,fixture['storage'])
        actual=page.evaluate('workshop.getState()')
        check('Save serialization roundtrip (test-only storage shim)',actual['state']==fixture['state']['state'] and actual['config']==fixture['state']['config'])
    else:
        page=mount(browser,mobile=True)
        page.wait_for_timeout(500)
        check('Mobile viewport has no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        check('Mobile touch controls are visible',page.locator('#joystick').is_visible() and page.locator('#touchJump').is_visible())
        check('Mobile Agent launch is not covered by hotbar',page.evaluate("""()=>{const e=document.getElementById('agentLaunch'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}"""))
        page.screenshot(path=str(ROOT/'preview-mobile.png'))
        box=page.locator('#joystick').bounding_box();start=page.evaluate('workshop.runtime.p.z')
        cdp=page.context.new_cdp_session(page)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':box['x']+46,'y':box['y']+12,'id':1}]})
        page.wait_for_timeout(350)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        end=page.evaluate('workshop.runtime.p.z')
        check('Touch joystick moves the player',end<start-.1,{'before':start,'after':end})
        page.locator('#agentLaunch').click();page.wait_for_timeout(100)
        check('Mobile Agent can be opened over the world',page.locator('#agent').is_visible())
        page.screenshot(path=str(ROOT/'preview-mobile-agent.png'))
    check('No application JavaScript errors in '+PHASE,not errors,errors)
    check('No external network requests in '+PHASE,not requests,requests)
    write_report()
    print(PHASE+' REPORT SAVED',flush=True)
    page.evaluate('workshop.runtime.dispose()')
    browser.close()
