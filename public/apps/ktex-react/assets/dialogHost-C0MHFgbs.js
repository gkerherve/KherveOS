import{n as e,t}from"./jsx-runtime-CJ4swFs5.js";import{t as n}from"./react-B2YxQ349.js";var r=n(),i=e(),a=t(),o=`
.kmb-veil { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center;
  justify-content: center; background: transparent; }
.kmb { min-width: 340px; max-width: min(720px, 92vw); max-height: 86vh; display: flex;
  flex-direction: column; border: 1px solid var(--border); border-radius: 6px;
  background: var(--chrome); color: var(--text); box-shadow: 0 8px 28px rgba(0,0,0,0.3);
  font: 13px var(--ui-font); }
.kmb-title { padding: 7px 12px; border-bottom: 1px solid var(--hairline); font-weight: 600; }
.kmb-body { display: flex; gap: 14px; padding: 16px 18px 10px; overflow: auto; }
.kmb-text { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; line-height: 1.4; }
.kmb-rich { white-space: normal; }
.kmb-rich td { vertical-align: top; padding: 3px 6px; }
.kmb-icon { flex: none; width: 34px; height: 34px; border-radius: 50%; display: flex;
  align-items: center; justify-content: center; color: #fff; font: bold 20px var(--ui-font); }
.kmb-icon.information, .kmb-icon.question { background: #2b78d7; }
.kmb-icon.warning { background: #d98a00; }
.kmb-icon.critical { background: #c0392b; }
.kmb-buttons { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px 12px; }
.kmb-buttons button { min-width: 82px; padding: 4px 12px; border: 1px solid var(--border);
  border-radius: 4px; background: var(--base); color: var(--text); font: inherit; }
.kmb-buttons button.default { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.kmb-buttons button:disabled { color: var(--placeholder); }
.kmb-bar { height: 10px; margin: 4px 18px 6px; border: 1px solid var(--border); border-radius: 3px;
  overflow: hidden; background: var(--base); }
.kmb-bar div { width: 30%; height: 100%; background: var(--accent);
  animation: kmb-busy 1.2s linear infinite; }
@keyframes kmb-busy { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
`,s=1e3;function c(){return++s}var l=null,u=null,d=null,f=1,p=[];function m(){let[e,t]=(0,r.useState)(p.splice(0));return(0,r.useEffect)(()=>{l=e=>t(t=>[...t,e]),u=(e,n)=>t(t=>t.map(t=>t.id===e?{...t,progress:{label:n}}:t)),d=e=>t(t=>t.filter(t=>t.id!==e)),p.length&&t(e=>[...e,...p.splice(0)])},[]),(0,a.jsx)(a.Fragment,{children:e.map(e=>(0,a.jsx)(g,{box:e,close:t=>{d?.(e.id),e.resolve(t)}},e.id))})}var h={information:`i`,warning:`!`,critical:`×`,question:`?`};function g({box:e,close:t}){let n=(0,r.useRef)(null),i=e.buttons??[{label:`OK`,default:!0}];return(0,r.useEffect)(()=>{(n.current?.querySelector(`button.default`)??n.current?.querySelector(`button`))?.focus()},[]),(0,a.jsx)(`div`,{className:`kmb-veil`,style:e.z?{zIndex:e.z}:void 0,onKeyDown:e=>{e.key===`Escape`&&(e.stopPropagation(),t(null))},children:(0,a.jsxs)(`div`,{ref:n,className:`kmb`,role:`dialog`,"aria-modal":`true`,"aria-label":e.title,style:e.minWidth?{minWidth:e.minWidth}:void 0,children:[(0,a.jsx)(`div`,{className:`kmb-title`,children:e.title}),(0,a.jsxs)(`div`,{className:`kmb-body`,children:[e.icon&&(0,a.jsx)(`div`,{className:`kmb-icon ${e.icon}`,children:h[e.icon]}),e.html===void 0?(0,a.jsx)(`div`,{className:`kmb-text`,children:e.progress?e.progress.label:e.text}):(0,a.jsx)(`div`,{className:`kmb-text kmb-rich`,dangerouslySetInnerHTML:{__html:e.html}})]}),e.progress&&(0,a.jsx)(`div`,{className:`kmb-bar`,children:(0,a.jsx)(`div`,{})}),(0,a.jsx)(`div`,{className:`kmb-buttons`,children:i.map(e=>(0,a.jsx)(`button`,{type:`button`,className:e.default?`default`:``,disabled:e.disabled,onClick:()=>t(e.label),children:e.label},e.label))})]})})}function _(){if(l||document.getElementById(`kmb-root`))return;let e=document.createElement(`style`);e.textContent=o,document.head.appendChild(e);let t=document.createElement(`div`);t.id=`kmb-root`,document.body.appendChild(t),(0,i.createRoot)(t).render((0,a.jsx)(m,{}))}function v(e){e.z=c(),_(),l?l(e):p.push(e)}function y(e){return new Promise(t=>v({...e,id:f++,resolve:t}))}var b=(e,t)=>y({title:e,text:t,icon:`information`}).then(()=>void 0),x=(e,t)=>y({title:e,text:t,icon:`warning`}).then(()=>void 0),S=(e,t)=>y({title:e,text:t,icon:`critical`}).then(()=>void 0);async function C(e,t){return await y({title:e,text:t,icon:`question`,buttons:[{label:`Yes`,default:!0},{label:`No`}]})===`Yes`}function w(e,t,n=450){let r=f++,i=()=>{},a=new Promise(e=>{i=e});return v({id:r,title:e,minWidth:n,progress:{label:t},buttons:[{label:`Cancel`}],resolve:e=>{e!==`__closed__`&&i()}}),{setLabel:e=>u?.(r,e),close:()=>d?.(r),cancelled:a}}function T(e){return e.replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`})[e])}function E(e,t={}){return new Promise(n=>{let r=document.createElement(`div`);r.className=t.modeless?`dlg-backdrop dlg-modeless`:`dlg-backdrop`,r.style.zIndex=String(c()),document.body.appendChild(r);let a=(0,i.createRoot)(r),o=e=>{a.unmount(),r.remove(),n(e)};r.addEventListener(`keydown`,e=>{e.key===`Escape`&&o(null)}),a.render(e(o))})}export{y as a,x as c,b as i,S as n,w as o,T as r,C as s,E as t};