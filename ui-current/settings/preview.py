from pathlib import Path
import re,json
ROOT=Path(__file__).resolve().parents[2]
settings=(ROOT/'packages/server/dist/assets/Settings-C2gay-IT.js').read_text()
registry=(ROOT/'packages/server/dist/assets/componentRegistry-bNm8U2v7.js').read_text()
def fn(text,name):
 start=text.index('function '+name+'(');end=text.find('function ',start+9)
 return text[start:end]
card=settings[settings.index('const ts='):settings.index('const ds=')]
form=fn(settings,'K').split('const Z=')[0]
class_names=dict(re.findall(r'(\w+)="(_[^\"]+)"',registry))
field_map=re.search(r'H=\{([^}]+)\}',registry).group(1)
fields='EVSH='+json.dumps({key:class_names[value] for key,value in (pair.split(':') for pair in field_map.split(','))})+';'

html='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'''+''.join('<link rel="stylesheet" href="/'+str(p.relative_to(ROOT))+'">' for p in (ROOT/'packages/server/dist/assets').glob('*.css'))+'''<style>body{margin:0;background:#111113;color:#eee}.preview{max-width:900px;margin:auto;padding:20px;display:flex;flex-direction:column;gap:24px}.preview>div{width:100%;box-sizing:border-box}.radix-themes{--default-font-family:Arial}p{margin:0}</style></head><body><div class="radix-themes dark" id="preview-root"></div><script type="module">
import {j as t,r as g,m as dom} from '/packages/server/dist/assets/vendor-react-BYv-AQ32.js';
import {b as M,p as c,h as D,o as w,u as C,R as Theme} from '/packages/server/dist/assets/vendor-radix-B-Qd10_a.js';
import {W as Ft,Y as _e} from '/packages/server/dist/assets/vendor-icons-DHujlvtW.js';
let stored=JSON.parse(sessionStorage.getItem('settings-fixture')||'{"vehicleSolarCurrentLimits":{"friday":22,"edith":16},"vehicleCurrentLimits":{"friday":32},"maxGridImportKw":null,"chargingEnabled":true}');
window.saved=[];window.failNext=false;window.queryFailure=new URL(location.href).searchParams.has("fail");const listeners=new Set();
const broadcast=()=>listeners.forEach(fn=>fn({...stored}));
function he(){const [data,setData]=g.useState(window.queryFailure?undefined:{...stored});const [failure,setFailure]=g.useState(window.queryFailure);g.useEffect(()=>{listeners.add(setData);return()=>listeners.delete(setData)},[]);return{data,isError:failure,refetch:async()=>{setFailure(false);setData({...stored})}}}
function ge(){const [saveStatus,status]=g.useState({state:'idle',tick:0});return{saveStatus,mutate:async changes=>{status(s=>({...s,state:'saving'}));await new Promise(r=>setTimeout(r,150));if(window.failNext){window.failNext=false;status(s=>({...s,state:'error',message:'Save failed. Please retry.'}));return}window.saved.push(changes);stored={...stored,...changes};sessionStorage.setItem('settings-fixture',JSON.stringify(stored));broadcast();status(s=>({state:'saved',tick:s.tick+1}))}}}
'''+card+form+'const '+fields+'''function x({label,help,children}){return t.jsxs('div',{className:EVSH.row,children:[t.jsxs('div',{className:EVSH.copy,children:[t.jsx(c,{weight:'medium',className:EVSH.label,children:label}),t.jsx(c,{color:'gray',className:EVSH.help,children:help})]}),t.jsx('div',{className:EVSH.control,children})]})}
'''+fn(registry,'wi').replace('function wi(', 'function I(').replace('h.use','g.use').replace('e.jsx','t.jsx').replace('H.','EVSH.').replace('e.jsxs','t.jsxs').replace('jsx(l,','jsx(c,')+settings[settings.index('function Ds('):settings.index('function _s(')]+'''
const vehicles=[{id:'friday',name:'F.R.I.D.A.Y.'},{id:'edith',name:'E.D.I.T.H.'}];
dom.createRoot(document.getElementById('preview-root')).render(t.jsx(Theme,{appearance:'dark',accentColor:'cyan',radius:'large',children:t.jsx('main',{className:'preview',children:t.jsx(Ds,{vehicles})})}));
</script></body></html>'''
# NumberInput's parameter named t shadows JSX t; retain its original e/h/l aliases.
original=fn(registry,'wi').replace('function wi(', 'function I(').replace('H.','EVSH.')
start=html.index('function I(');end=html.index('function Ds(',start)
html=html[:start]+'const e=t,h=g,l=c;\n'+original+html[end:]
path=ROOT/'validation/results/settings-preview.html';path.parent.mkdir(exist_ok=True);path.write_text(html);print(path)
