var $i=Object.create;var St=Object.defineProperty;var Ki=Object.getOwnPropertyDescriptor;var Zi=Object.getOwnPropertyNames;var Qi=Object.getPrototypeOf,Ji=Object.prototype.hasOwnProperty;var At=(e,r)=>()=>(r||e((r={exports:{}}).exports,r),r.exports),Lt=(e,r)=>{for(var n in r)St(e,n,{get:r[n],enumerable:!0})},ea=(e,r,n,t)=>{if(r&&typeof r=="object"||typeof r=="function")for(let i of Zi(r))!Ji.call(e,i)&&i!==n&&St(e,i,{get:()=>r[i],enumerable:!(t=Ki(r,i))||t.enumerable});return e};var ve=(e,r,n)=>(n=e!=null?$i(Qi(e)):{},ea(r||!e||!e.__esModule?St(n,"default",{value:e,enumerable:!0}):n,e));var it=At((nu,jt)=>{"use strict";var Se=typeof Reflect=="object"?Reflect:null,nn=Se&&typeof Se.apply=="function"?Se.apply:function(r,n,t){return Function.prototype.apply.call(r,n,t)},rt;Se&&typeof Se.ownKeys=="function"?rt=Se.ownKeys:Object.getOwnPropertySymbols?rt=function(r){return Object.getOwnPropertyNames(r).concat(Object.getOwnPropertySymbols(r))}:rt=function(r){return Object.getOwnPropertyNames(r)};function La(e){console&&console.warn&&console.warn(e)}var on=Number.isNaN||function(r){return r!==r};function B(){B.init.call(this)}jt.exports=B;jt.exports.once=ka;B.EventEmitter=B;B.prototype._events=void 0;B.prototype._eventsCount=0;B.prototype._maxListeners=void 0;var an=10;function nt(e){if(typeof e!="function")throw new TypeError('The "listener" argument must be of type Function. Received type '+typeof e)}Object.defineProperty(B,"defaultMaxListeners",{enumerable:!0,get:function(){return an},set:function(e){if(typeof e!="number"||e<0||on(e))throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received '+e+".");an=e}});B.init=function(){(this._events===void 0||this._events===Object.getPrototypeOf(this)._events)&&(this._events=Object.create(null),this._eventsCount=0),this._maxListeners=this._maxListeners||void 0};B.prototype.setMaxListeners=function(r){if(typeof r!="number"||r<0||on(r))throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received '+r+".");return this._maxListeners=r,this};function sn(e){return e._maxListeners===void 0?B.defaultMaxListeners:e._maxListeners}B.prototype.getMaxListeners=function(){return sn(this)};B.prototype.emit=function(r){for(var n=[],t=1;t<arguments.length;t++)n.push(arguments[t]);var i=r==="error",a=this._events;if(a!==void 0)i=i&&a.error===void 0;else if(!i)return!1;if(i){var o;if(n.length>0&&(o=n[0]),o instanceof Error)throw o;var s=new Error("Unhandled error."+(o?" ("+o.message+")":""));throw s.context=o,s}var u=a[r];if(u===void 0)return!1;if(typeof u=="function")nn(u,this,n);else for(var l=u.length,c=hn(u,l),t=0;t<l;++t)nn(c[t],this,n);return!0};function un(e,r,n,t){var i,a,o;if(nt(n),a=e._events,a===void 0?(a=e._events=Object.create(null),e._eventsCount=0):(a.newListener!==void 0&&(e.emit("newListener",r,n.listener?n.listener:n),a=e._events),o=a[r]),o===void 0)o=a[r]=n,++e._eventsCount;else if(typeof o=="function"?o=a[r]=t?[n,o]:[o,n]:t?o.unshift(n):o.push(n),i=sn(e),i>0&&o.length>i&&!o.warned){o.warned=!0;var s=new Error("Possible EventEmitter memory leak detected. "+o.length+" "+String(r)+" listeners added. Use emitter.setMaxListeners() to increase limit");s.name="MaxListenersExceededWarning",s.emitter=e,s.type=r,s.count=o.length,La(s)}return e}B.prototype.addListener=function(r,n){return un(this,r,n,!1)};B.prototype.on=B.prototype.addListener;B.prototype.prependListener=function(r,n){return un(this,r,n,!0)};function Pa(){if(!this.fired)return this.target.removeListener(this.type,this.wrapFn),this.fired=!0,arguments.length===0?this.listener.call(this.target):this.listener.apply(this.target,arguments)}function ln(e,r,n){var t={fired:!1,wrapFn:void 0,target:e,type:r,listener:n},i=Pa.bind(t);return i.listener=n,t.wrapFn=i,i}B.prototype.once=function(r,n){return nt(n),this.on(r,ln(this,r,n)),this};B.prototype.prependOnceListener=function(r,n){return nt(n),this.prependListener(r,ln(this,r,n)),this};B.prototype.removeListener=function(r,n){var t,i,a,o,s;if(nt(n),i=this._events,i===void 0)return this;if(t=i[r],t===void 0)return this;if(t===n||t.listener===n)--this._eventsCount===0?this._events=Object.create(null):(delete i[r],i.removeListener&&this.emit("removeListener",r,t.listener||n));else if(typeof t!="function"){for(a=-1,o=t.length-1;o>=0;o--)if(t[o]===n||t[o].listener===n){s=t[o].listener,a=o;break}if(a<0)return this;a===0?t.shift():Oa(t,a),t.length===1&&(i[r]=t[0]),i.removeListener!==void 0&&this.emit("removeListener",r,s||n)}return this};B.prototype.off=B.prototype.removeListener;B.prototype.removeAllListeners=function(r){var n,t,i;if(t=this._events,t===void 0)return this;if(t.removeListener===void 0)return arguments.length===0?(this._events=Object.create(null),this._eventsCount=0):t[r]!==void 0&&(--this._eventsCount===0?this._events=Object.create(null):delete t[r]),this;if(arguments.length===0){var a=Object.keys(t),o;for(i=0;i<a.length;++i)o=a[i],o!=="removeListener"&&this.removeAllListeners(o);return this.removeAllListeners("removeListener"),this._events=Object.create(null),this._eventsCount=0,this}if(n=t[r],typeof n=="function")this.removeListener(r,n);else if(n!==void 0)for(i=n.length-1;i>=0;i--)this.removeListener(r,n[i]);return this};function cn(e,r,n){var t=e._events;if(t===void 0)return[];var i=t[r];return i===void 0?[]:typeof i=="function"?n?[i.listener||i]:[i]:n?Na(i):hn(i,i.length)}B.prototype.listeners=function(r){return cn(this,r,!0)};B.prototype.rawListeners=function(r){return cn(this,r,!1)};B.listenerCount=function(e,r){return typeof e.listenerCount=="function"?e.listenerCount(r):fn.call(e,r)};B.prototype.listenerCount=fn;function fn(e){var r=this._events;if(r!==void 0){var n=r[e];if(typeof n=="function")return 1;if(n!==void 0)return n.length}return 0}B.prototype.eventNames=function(){return this._eventsCount>0?rt(this._events):[]};function hn(e,r){for(var n=new Array(r),t=0;t<r;++t)n[t]=e[t];return n}function Oa(e,r){for(;r+1<e.length;r++)e[r]=e[r+1];e.pop()}function Na(e){for(var r=new Array(e.length),n=0;n<r.length;++n)r[n]=e[n].listener||e[n];return r}function ka(e,r){return new Promise(function(n,t){function i(o){e.removeListener(r,a),t(o)}function a(){typeof e.removeListener=="function"&&e.removeListener("error",i),n([].slice.call(arguments))}dn(e,r,a,{once:!0}),r!=="error"&&Da(e,i,{once:!0})})}function Da(e,r,n){typeof e.on=="function"&&dn(e,"error",r,n)}function dn(e,r,n,t){if(typeof e.on=="function")t.once?e.once(r,n):e.on(r,n);else if(typeof e.addEventListener=="function")e.addEventListener(r,function i(a){t.once&&e.removeEventListener(r,i),n(a)});else throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type '+typeof e)}});var ot=At((ou,gn)=>{gn.exports=function(r){return r!==null&&typeof r=="object"&&typeof r.addUndirectedEdgeWithKey=="function"&&typeof r.dropNode=="function"&&typeof r.multi=="boolean"}});var Mi=At((wr,xr)=>{(function(e,r){typeof define=="function"&&define.amd?define([],r):typeof wr<"u"?r():(r(),e.FileSaver={})})(wr,function(){"use strict";function e(s,u){return typeof u>"u"?u={autoBom:!1}:typeof u!="object"&&(console.warn("Deprecated: Expected third argument to be a object"),u={autoBom:!u}),u.autoBom&&/^\s*(?:text\/\S*|application\/xml|\S*\/\S*\+xml)\s*;.*charset\s*=\s*utf-8/i.test(s.type)?new Blob(["\uFEFF",s],{type:s.type}):s}function r(s,u,l){var c=new XMLHttpRequest;c.open("GET",s),c.responseType="blob",c.onload=function(){o(c.response,u,l)},c.onerror=function(){console.error("could not download file")},c.send()}function n(s){var u=new XMLHttpRequest;u.open("HEAD",s,!1);try{u.send()}catch{}return 200<=u.status&&299>=u.status}function t(s){try{s.dispatchEvent(new MouseEvent("click"))}catch{var u=document.createEvent("MouseEvents");u.initMouseEvent("click",!0,!0,window,0,0,0,80,20,!1,!1,!1,!1,0,null),s.dispatchEvent(u)}}var i=typeof window=="object"&&window.window===window?window:typeof self=="object"&&self.self===self?self:typeof global=="object"&&global.global===global?global:void 0,a=i.navigator&&/Macintosh/.test(navigator.userAgent)&&/AppleWebKit/.test(navigator.userAgent)&&!/Safari/.test(navigator.userAgent),o=i.saveAs||(typeof window!="object"||window!==i?function(){}:"download"in HTMLAnchorElement.prototype&&!a?function(s,u,l){var c=i.URL||i.webkitURL,f=document.createElement("a");u=u||s.name||"download",f.download=u,f.rel="noopener",typeof s=="string"?(f.href=s,f.origin===location.origin?t(f):n(f.href)?r(s,u,l):t(f,f.target="_blank")):(f.href=c.createObjectURL(s),setTimeout(function(){c.revokeObjectURL(f.href)},4e4),setTimeout(function(){t(f)},0))}:"msSaveOrOpenBlob"in navigator?function(s,u,l){if(u=u||s.name||"download",typeof s!="string")navigator.msSaveOrOpenBlob(e(s,l),u);else if(n(s))r(s,u,l);else{var c=document.createElement("a");c.href=s,c.target="_blank",setTimeout(function(){t(c)})}}:function(s,u,l,c){if(c=c||open("","_blank"),c&&(c.document.title=c.document.body.innerText="downloading..."),typeof s=="string")return r(s,u,l);var f=s.type==="application/octet-stream",v=/constructor/i.test(i.HTMLElement)||i.safari,g=/CriOS\/[\d]+/.test(navigator.userAgent);if((g||f&&v||a)&&typeof FileReader<"u"){var _=new FileReader;_.onloadend=function(){var T=_.result;T=g?T:T.replace(/^data:[^;]*;/,"data:attachment/file;"),c?c.location.href=T:location=T,c=null},_.readAsDataURL(s)}else{var m=i.URL||i.webkitURL,E=m.createObjectURL(s);c?c.location=E:location.href=E,c=null,setTimeout(function(){m.revokeObjectURL(E)},4e4)}});i.saveAs=o.saveAs=o,typeof xr<"u"&&(xr.exports=o)})});function ta(e,r){if(typeof e!="object"||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var t=n.call(e,r||"default");if(typeof t!="object")return t;throw new TypeError("@@toPrimitive must return a primitive value.")}return(r==="string"?String:Number)(e)}function me(e){var r=ta(e,"string");return typeof r=="symbol"?r:r+""}function W(e,r){if(!(e instanceof r))throw new TypeError("Cannot call a class as a function")}function Dr(e,r){for(var n=0;n<r.length;n++){var t=r[n];t.enumerable=t.enumerable||!1,t.configurable=!0,"value"in t&&(t.writable=!0),Object.defineProperty(e,me(t.key),t)}}function X(e,r,n){return r&&Dr(e.prototype,r),n&&Dr(e,n),Object.defineProperty(e,"prototype",{writable:!1}),e}function ge(e){return ge=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(r){return r.__proto__||Object.getPrototypeOf(r)},ge(e)}function Fr(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],function(){}))}catch{}return(Fr=function(){return!!e})()}function ra(e){if(e===void 0)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e}function na(e,r){if(r&&(typeof r=="object"||typeof r=="function"))return r;if(r!==void 0)throw new TypeError("Derived constructors may only return object or undefined");return ra(e)}function $(e,r,n){return r=ge(r),na(e,Fr()?Reflect.construct(r,n||[],ge(e).constructor):r.apply(e,n))}function Pt(e,r){return Pt=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(n,t){return n.__proto__=t,n},Pt(e,r)}function K(e,r){if(typeof r!="function"&&r!==null)throw new TypeError("Super expression must either be null or a function");e.prototype=Object.create(r&&r.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),r&&Pt(e,r)}function ia(e){if(Array.isArray(e))return e}function aa(e,r){var n=e==null?null:typeof Symbol<"u"&&e[Symbol.iterator]||e["@@iterator"];if(n!=null){var t,i,a,o,s=[],u=!0,l=!1;try{if(a=(n=n.call(e)).next,r===0){if(Object(n)!==n)return;u=!1}else for(;!(u=(t=a.call(n)).done)&&(s.push(t.value),s.length!==r);u=!0);}catch(c){l=!0,i=c}finally{try{if(!u&&n.return!=null&&(o=n.return(),Object(o)!==o))return}finally{if(l)throw i}}return s}}function Ye(e,r){(r==null||r>e.length)&&(r=e.length);for(var n=0,t=Array(r);n<r;n++)t[n]=e[n];return t}function Nt(e,r){if(e){if(typeof e=="string")return Ye(e,r);var n={}.toString.call(e).slice(8,-1);return n==="Object"&&e.constructor&&(n=e.constructor.name),n==="Map"||n==="Set"?Array.from(e):n==="Arguments"||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?Ye(e,r):void 0}}function oa(){throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function fe(e,r){return ia(e)||aa(e,r)||Nt(e,r)||oa()}var We={black:"#000000",silver:"#C0C0C0",gray:"#808080",grey:"#808080",white:"#FFFFFF",maroon:"#800000",red:"#FF0000",purple:"#800080",fuchsia:"#FF00FF",green:"#008000",lime:"#00FF00",olive:"#808000",yellow:"#FFFF00",navy:"#000080",blue:"#0000FF",teal:"#008080",aqua:"#00FFFF",darkblue:"#00008B",mediumblue:"#0000CD",darkgreen:"#006400",darkcyan:"#008B8B",deepskyblue:"#00BFFF",darkturquoise:"#00CED1",mediumspringgreen:"#00FA9A",springgreen:"#00FF7F",cyan:"#00FFFF",midnightblue:"#191970",dodgerblue:"#1E90FF",lightseagreen:"#20B2AA",forestgreen:"#228B22",seagreen:"#2E8B57",darkslategray:"#2F4F4F",darkslategrey:"#2F4F4F",limegreen:"#32CD32",mediumseagreen:"#3CB371",turquoise:"#40E0D0",royalblue:"#4169E1",steelblue:"#4682B4",darkslateblue:"#483D8B",mediumturquoise:"#48D1CC",indigo:"#4B0082",darkolivegreen:"#556B2F",cadetblue:"#5F9EA0",cornflowerblue:"#6495ED",rebeccapurple:"#663399",mediumaquamarine:"#66CDAA",dimgray:"#696969",dimgrey:"#696969",slateblue:"#6A5ACD",olivedrab:"#6B8E23",slategray:"#708090",slategrey:"#708090",lightslategray:"#778899",lightslategrey:"#778899",mediumslateblue:"#7B68EE",lawngreen:"#7CFC00",chartreuse:"#7FFF00",aquamarine:"#7FFFD4",skyblue:"#87CEEB",lightskyblue:"#87CEFA",blueviolet:"#8A2BE2",darkred:"#8B0000",darkmagenta:"#8B008B",saddlebrown:"#8B4513",darkseagreen:"#8FBC8F",lightgreen:"#90EE90",mediumpurple:"#9370DB",darkviolet:"#9400D3",palegreen:"#98FB98",darkorchid:"#9932CC",yellowgreen:"#9ACD32",sienna:"#A0522D",brown:"#A52A2A",darkgray:"#A9A9A9",darkgrey:"#A9A9A9",lightblue:"#ADD8E6",greenyellow:"#ADFF2F",paleturquoise:"#AFEEEE",lightsteelblue:"#B0C4DE",powderblue:"#B0E0E6",firebrick:"#B22222",darkgoldenrod:"#B8860B",mediumorchid:"#BA55D3",rosybrown:"#BC8F8F",darkkhaki:"#BDB76B",mediumvioletred:"#C71585",indianred:"#CD5C5C",peru:"#CD853F",chocolate:"#D2691E",tan:"#D2B48C",lightgray:"#D3D3D3",lightgrey:"#D3D3D3",thistle:"#D8BFD8",orchid:"#DA70D6",goldenrod:"#DAA520",palevioletred:"#DB7093",crimson:"#DC143C",gainsboro:"#DCDCDC",plum:"#DDA0DD",burlywood:"#DEB887",lightcyan:"#E0FFFF",lavender:"#E6E6FA",darksalmon:"#E9967A",violet:"#EE82EE",palegoldenrod:"#EEE8AA",lightcoral:"#F08080",khaki:"#F0E68C",aliceblue:"#F0F8FF",honeydew:"#F0FFF0",azure:"#F0FFFF",sandybrown:"#F4A460",wheat:"#F5DEB3",beige:"#F5F5DC",whitesmoke:"#F5F5F5",mintcream:"#F5FFFA",ghostwhite:"#F8F8FF",salmon:"#FA8072",antiquewhite:"#FAEBD7",linen:"#FAF0E6",lightgoldenrodyellow:"#FAFAD2",oldlace:"#FDF5E6",magenta:"#FF00FF",deeppink:"#FF1493",orangered:"#FF4500",tomato:"#FF6347",hotpink:"#FF69B4",coral:"#FF7F50",darkorange:"#FF8C00",lightsalmon:"#FFA07A",orange:"#FFA500",lightpink:"#FFB6C1",pink:"#FFC0CB",gold:"#FFD700",peachpuff:"#FFDAB9",navajowhite:"#FFDEAD",moccasin:"#FFE4B5",bisque:"#FFE4C4",mistyrose:"#FFE4E1",blanchedalmond:"#FFEBCD",papayawhip:"#FFEFD5",lavenderblush:"#FFF0F5",seashell:"#FFF5EE",cornsilk:"#FFF8DC",lemonchiffon:"#FFFACD",floralwhite:"#FFFAF0",snow:"#FFFAFA",lightyellow:"#FFFFE0",ivory:"#FFFFF0"};var Ir=new Int8Array(4),Xe=new Int32Array(Ir.buffer,0,1),zr=new Float32Array(Ir.buffer,0,1),sa=/^\s*rgba?\s*\(/,ua=/^\s*rgba?\s*\(\s*([0-9]*)\s*,\s*([0-9]*)\s*,\s*([0-9]*)(?:\s*,\s*(.*)?)?\)\s*$/;function Gr(e){var r=0,n=0,t=0,i=1;if(e[0]==="#")e.length===4?(r=parseInt(e.charAt(1)+e.charAt(1),16),n=parseInt(e.charAt(2)+e.charAt(2),16),t=parseInt(e.charAt(3)+e.charAt(3),16)):(r=parseInt(e.charAt(1)+e.charAt(2),16),n=parseInt(e.charAt(3)+e.charAt(4),16),t=parseInt(e.charAt(5)+e.charAt(6),16)),e.length===9&&(i=parseInt(e.charAt(7)+e.charAt(8),16)/255);else if(sa.test(e)){var a=e.match(ua);a&&(r=+a[1],n=+a[2],t=+a[3],a[4]&&(i=+a[4]))}return{r,g:n,b:t,a:i}}var Ee={};for(De in We)Ee[De]=Y(We[De]),Ee[We[De]]=Ee[De];var De;function kt(e,r,n,t,i){return Xe[0]=t<<24|n<<16|r<<8|e,i&&(Xe[0]=Xe[0]&4278190079),zr[0]}function Y(e){if(e=e.toLowerCase(),typeof Ee[e]<"u")return Ee[e];var r=Gr(e),n=r.r,t=r.g,i=r.b,a=r.a;a=a*255|0;var o=kt(n,t,i,a,!0);return Ee[e]=o,o}function Te(e,r){zr[0]=Y(e);var n=Xe[0];r&&(n=n|16777216);var t=n&255,i=n>>8&255,a=n>>16&255,o=n>>24&255;return[t,i,a,o]}var Ot={};function qe(e){if(typeof Ot[e]<"u")return Ot[e];var r=(e&16711680)>>>16,n=(e&65280)>>>8,t=e&255,i=255,a=kt(r,n,t,i,!0);return Ot[e]=a,a}function $e(e,r,n,t){return n+(r<<8)+(e<<16)}function Ke(e,r,n,t,i,a){var o=Math.floor(n/a*i),s=Math.floor(e.drawingBufferHeight/a-t/a*i),u=new Uint8Array(4);e.bindFramebuffer(e.FRAMEBUFFER,r),e.readPixels(o,s,1,1,e.RGBA,e.UNSIGNED_BYTE,u);var l=fe(u,4),c=l[0],f=l[1],v=l[2],g=l[3];return[c,f,v,g]}function x(e,r,n){return(r=me(r))in e?Object.defineProperty(e,r,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[r]=n,e}function Mr(e,r){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var t=Object.getOwnPropertySymbols(e);r&&(t=t.filter(function(i){return Object.getOwnPropertyDescriptor(e,i).enumerable})),n.push.apply(n,t)}return n}function O(e){for(var r=1;r<arguments.length;r++){var n=arguments[r]!=null?arguments[r]:{};r%2?Mr(Object(n),!0).forEach(function(t){x(e,t,n[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):Mr(Object(n)).forEach(function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))})}return e}function la(e,r){for(;!{}.hasOwnProperty.call(e,r)&&(e=ge(e))!==null;);return e}function Ft(){return Ft=typeof Reflect<"u"&&Reflect.get?Reflect.get.bind():function(e,r,n){var t=la(e,r);if(t){var i=Object.getOwnPropertyDescriptor(t,r);return i.get?i.get.call(arguments.length<3?e:n):i.value}},Ft.apply(null,arguments)}function Wr(e,r,n,t){var i=Ft(ge(1&t?e.prototype:e),r,n);return 2&t&&typeof i=="function"?function(a){return i.apply(n,a)}:i}function Xr(e){return e.normalized?1:e.size}function Qe(e){var r=0;return e.forEach(function(n){return r+=Xr(n)}),r}function Yr(e,r,n){var t=e==="VERTEX"?r.VERTEX_SHADER:r.FRAGMENT_SHADER,i=r.createShader(t);if(i===null)throw new Error("loadShader: error while creating the shader");r.shaderSource(i,n),r.compileShader(i);var a=r.getShaderParameter(i,r.COMPILE_STATUS);if(!a){var o=r.getShaderInfoLog(i);throw r.deleteShader(i),new Error(`loadShader: error while compiling the shader:
`.concat(o,`
`).concat(n))}return i}function qr(e,r){return Yr("VERTEX",e,r)}function $r(e,r){return Yr("FRAGMENT",e,r)}function Kr(e,r){var n=e.createProgram();if(n===null)throw new Error("loadProgram: error while creating the program.");var t,i;for(t=0,i=r.length;t<i;t++)e.attachShader(n,r[t]);e.linkProgram(n);var a=e.getProgramParameter(n,e.LINK_STATUS);if(!a){var o=e.getProgramInfoLog(n);throw e.deleteProgram(n),new Error("loadProgram: error while linking the program: ".concat(o))}return n}function It(e){var r=e.gl,n=e.buffer,t=e.program,i=e.vertexShader,a=e.fragmentShader;r.deleteShader(i),r.deleteShader(a),r.deleteProgram(t),r.deleteBuffer(n)}function Re(e){return e%1===0?e.toFixed(1):e.toString()}var Ur=`#define PICKING_MODE
`,ca=x(x(x(x(x(x(x(x({},WebGL2RenderingContext.BOOL,1),WebGL2RenderingContext.BYTE,1),WebGL2RenderingContext.UNSIGNED_BYTE,1),WebGL2RenderingContext.SHORT,2),WebGL2RenderingContext.UNSIGNED_SHORT,2),WebGL2RenderingContext.INT,4),WebGL2RenderingContext.UNSIGNED_INT,4),WebGL2RenderingContext.FLOAT,4);var zt=(function(){function e(r,n,t){W(this,e),x(this,"array",new Float32Array),x(this,"constantArray",new Float32Array),x(this,"capacity",0),x(this,"verticesCount",0);var i=this.getDefinition();if(this.VERTICES=i.VERTICES,this.VERTEX_SHADER_SOURCE=i.VERTEX_SHADER_SOURCE,this.FRAGMENT_SHADER_SOURCE=i.FRAGMENT_SHADER_SOURCE,this.UNIFORMS=i.UNIFORMS,this.ATTRIBUTES=i.ATTRIBUTES,this.METHOD=i.METHOD,this.CONSTANT_ATTRIBUTES="CONSTANT_ATTRIBUTES"in i?i.CONSTANT_ATTRIBUTES:[],this.CONSTANT_DATA="CONSTANT_DATA"in i?i.CONSTANT_DATA:[],this.isInstanced="CONSTANT_ATTRIBUTES"in i,this.ATTRIBUTES_ITEMS_COUNT=Qe(this.ATTRIBUTES),this.STRIDE=this.VERTICES*this.ATTRIBUTES_ITEMS_COUNT,this.renderer=t,this.normalProgram=this.getProgramInfo("normal",r,i.VERTEX_SHADER_SOURCE,i.FRAGMENT_SHADER_SOURCE,null),this.pickProgram=n?this.getProgramInfo("pick",r,Ur+i.VERTEX_SHADER_SOURCE,Ur+i.FRAGMENT_SHADER_SOURCE,n):null,this.isInstanced){var a=Qe(this.CONSTANT_ATTRIBUTES);if(this.CONSTANT_DATA.length!==this.VERTICES)throw new Error("Program: error while getting constant data (expected ".concat(this.VERTICES," items, received ").concat(this.CONSTANT_DATA.length," instead)"));this.constantArray=new Float32Array(this.CONSTANT_DATA.length*a);for(var o=0;o<this.CONSTANT_DATA.length;o++){var s=this.CONSTANT_DATA[o];if(s.length!==a)throw new Error("Program: error while getting constant data (one vector has ".concat(s.length," items instead of ").concat(a,")"));for(var u=0;u<s.length;u++)this.constantArray[o*a+u]=s[u]}this.STRIDE=this.ATTRIBUTES_ITEMS_COUNT}}return X(e,[{key:"kill",value:function(){It(this.normalProgram),this.pickProgram&&(It(this.pickProgram),this.pickProgram=null)}},{key:"getProgramInfo",value:function(n,t,i,a,o){var s=this.getDefinition(),u=t.createBuffer();if(u===null)throw new Error("Program: error while creating the WebGL buffer.");var l=qr(t,i),c=$r(t,a),f=Kr(t,[l,c]),v={};s.UNIFORMS.forEach(function(m){var E=t.getUniformLocation(f,m);E&&(v[m]=E)});var g={};s.ATTRIBUTES.forEach(function(m){g[m.name]=t.getAttribLocation(f,m.name)});var _;if("CONSTANT_ATTRIBUTES"in s&&(s.CONSTANT_ATTRIBUTES.forEach(function(m){g[m.name]=t.getAttribLocation(f,m.name)}),_=t.createBuffer(),_===null))throw new Error("Program: error while creating the WebGL constant buffer.");return{name:n,program:f,gl:t,frameBuffer:o,buffer:u,constantBuffer:_||{},uniformLocations:v,attributeLocations:g,isPicking:n==="pick",vertexShader:l,fragmentShader:c}}},{key:"bindProgram",value:function(n){var t=this,i=0,a=n.gl,o=n.buffer;this.isInstanced?(a.bindBuffer(a.ARRAY_BUFFER,n.constantBuffer),i=0,this.CONSTANT_ATTRIBUTES.forEach(function(s){return i+=t.bindAttribute(s,n,i,!1)}),a.bufferData(a.ARRAY_BUFFER,this.constantArray,a.STATIC_DRAW),a.bindBuffer(a.ARRAY_BUFFER,n.buffer),i=0,this.ATTRIBUTES.forEach(function(s){return i+=t.bindAttribute(s,n,i,!0)}),a.bufferData(a.ARRAY_BUFFER,this.array,a.DYNAMIC_DRAW)):(a.bindBuffer(a.ARRAY_BUFFER,o),i=0,this.ATTRIBUTES.forEach(function(s){return i+=t.bindAttribute(s,n,i)}),a.bufferData(a.ARRAY_BUFFER,this.array,a.DYNAMIC_DRAW)),a.bindBuffer(a.ARRAY_BUFFER,null)}},{key:"unbindProgram",value:function(n){var t=this;this.isInstanced?(this.CONSTANT_ATTRIBUTES.forEach(function(i){return t.unbindAttribute(i,n,!1)}),this.ATTRIBUTES.forEach(function(i){return t.unbindAttribute(i,n,!0)})):this.ATTRIBUTES.forEach(function(i){return t.unbindAttribute(i,n)})}},{key:"bindAttribute",value:function(n,t,i,a){var o=ca[n.type];if(typeof o!="number")throw new Error('Program.bind: yet unsupported attribute type "'.concat(n.type,'"'));var s=t.attributeLocations[n.name],u=t.gl;if(s!==-1){u.enableVertexAttribArray(s);var l=this.isInstanced?(a?this.ATTRIBUTES_ITEMS_COUNT:Qe(this.CONSTANT_ATTRIBUTES))*Float32Array.BYTES_PER_ELEMENT:this.ATTRIBUTES_ITEMS_COUNT*Float32Array.BYTES_PER_ELEMENT;if(u.vertexAttribPointer(s,n.size,n.type,n.normalized||!1,l,i),this.isInstanced&&a)if(u instanceof WebGL2RenderingContext)u.vertexAttribDivisor(s,1);else{var c=u.getExtension("ANGLE_instanced_arrays");c&&c.vertexAttribDivisorANGLE(s,1)}}return n.size*o}},{key:"unbindAttribute",value:function(n,t,i){var a=t.attributeLocations[n.name],o=t.gl;if(a!==-1&&(o.disableVertexAttribArray(a),this.isInstanced&&i))if(o instanceof WebGL2RenderingContext)o.vertexAttribDivisor(a,0);else{var s=o.getExtension("ANGLE_instanced_arrays");s&&s.vertexAttribDivisorANGLE(a,0)}}},{key:"reallocate",value:function(n){n!==this.capacity&&(this.capacity=n,this.verticesCount=this.VERTICES*n,this.array=new Float32Array(this.isInstanced?this.capacity*this.ATTRIBUTES_ITEMS_COUNT:this.verticesCount*this.ATTRIBUTES_ITEMS_COUNT))}},{key:"hasNothingToRender",value:function(){return this.verticesCount===0}},{key:"renderProgram",value:function(n,t){var i=t.gl,a=t.program;i.enable(i.BLEND),i.useProgram(a),this.setUniforms(n,t),this.drawWebGL(this.METHOD,t)}},{key:"render",value:function(n){this.hasNothingToRender()||(this.pickProgram&&(this.pickProgram.gl.viewport(0,0,n.width*n.pixelRatio/n.downSizingRatio,n.height*n.pixelRatio/n.downSizingRatio),this.bindProgram(this.pickProgram),this.renderProgram(O(O({},n),{},{pixelRatio:n.pixelRatio/n.downSizingRatio}),this.pickProgram),this.unbindProgram(this.pickProgram)),this.normalProgram.gl.viewport(0,0,n.width*n.pixelRatio,n.height*n.pixelRatio),this.bindProgram(this.normalProgram),this.renderProgram(n,this.normalProgram),this.unbindProgram(this.normalProgram))}},{key:"drawWebGL",value:function(n,t){var i=t.gl,a=t.frameBuffer;if(i.bindFramebuffer(i.FRAMEBUFFER,a),!this.isInstanced)i.drawArrays(n,0,this.verticesCount);else if(i instanceof WebGL2RenderingContext)i.drawArraysInstanced(n,0,this.VERTICES,this.capacity);else{var o=i.getExtension("ANGLE_instanced_arrays");o&&o.drawArraysInstancedANGLE(n,0,this.VERTICES,this.capacity)}}}])})();var re=(function(e){function r(){return W(this,r),$(this,r,arguments)}return K(r,e),X(r,[{key:"kill",value:function(){Wr(r,"kill",this,3)([])}},{key:"process",value:function(t,i,a){var o=i*this.STRIDE;if(a.hidden){for(var s=o+this.STRIDE;o<s;o++)this.array[o]=0;return}return this.processVisibleItem(qe(t),o,a)}}])})(zt);var ae=(function(e){function r(){var n;W(this,r);for(var t=arguments.length,i=new Array(t),a=0;a<t;a++)i[a]=arguments[a];return n=$(this,r,[].concat(i)),x(n,"drawLabel",void 0),n}return K(r,e),X(r,[{key:"kill",value:function(){Wr(r,"kill",this,3)([])}},{key:"process",value:function(t,i,a,o,s){var u=i*this.STRIDE;if(s.hidden||a.hidden||o.hidden){for(var l=u+this.STRIDE;u<l;u++)this.array[u]=0;return}return this.processVisibleItem(qe(t),u,a,o,s)}}])})(zt);function Ie(e,r){return(function(){function n(t,i,a){W(this,n),x(this,"drawLabel",r),this.programs=e.map(function(o){return new o(t,i,a)})}return X(n,[{key:"reallocate",value:function(i){this.programs.forEach(function(a){return a.reallocate(i)})}},{key:"process",value:function(i,a,o,s,u){this.programs.forEach(function(l){return l.process(i,a,o,s,u)})}},{key:"render",value:function(i){this.programs.forEach(function(a){return a.render(i)})}},{key:"kill",value:function(){this.programs.forEach(function(i){return i.kill()})}}])})()}function Gt(e,r,n,t,i){var a=i.edgeLabelSize,o=i.edgeLabelFont,s=i.edgeLabelWeight,u=i.edgeLabelColor.attribute?r[i.edgeLabelColor.attribute]||i.edgeLabelColor.color||"#000":i.edgeLabelColor.color,l=r.label;if(l){e.fillStyle=u,e.font="".concat(s," ").concat(a,"px ").concat(o);var c=n.size,f=t.size,v=n.x,g=n.y,_=t.x,m=t.y,E=(v+_)/2,T=(g+m)/2,b=_-v,p=m-g,R=Math.sqrt(b*b+p*p);if(!(R<c+f)){v+=b*c/R,g+=p*c/R,_-=b*f/R,m-=p*f/R,E=(v+_)/2,T=(g+m)/2,b=_-v,p=m-g,R=Math.sqrt(b*b+p*p);var A=e.measureText(l).width;if(A>R){var L="\u2026";for(l=l+L,A=e.measureText(l).width;A>R&&l.length>1;)l=l.slice(0,-2)+L,A=e.measureText(l).width;if(l.length<4)return}var C;b>0?p>0?C=Math.acos(b/R):C=Math.asin(p/R):p>0?C=Math.acos(b/R)+Math.PI:C=Math.asin(b/R)+Math.PI/2,e.save(),e.translate(E,T),e.rotate(C),e.fillText(l,-A/2,r.size/2+a),e.restore()}}}function we(e,r,n){if(r.label){var t=n.labelSize,i=n.labelFont,a=n.labelWeight,o=n.labelColor.attribute?r[n.labelColor.attribute]||n.labelColor.color||"#000":n.labelColor.color;e.fillStyle=o,e.font="".concat(a," ").concat(t,"px ").concat(i),e.fillText(r.label,r.x+r.size+3,r.y+t/3)}}function Je(e,r,n){var t=n.labelSize,i=n.labelFont,a=n.labelWeight;e.font="".concat(a," ").concat(t,"px ").concat(i),e.fillStyle="#FFF",e.shadowOffsetX=0,e.shadowOffsetY=0,e.shadowBlur=8,e.shadowColor="#000";var o=2;if(typeof r.label=="string"){var s=e.measureText(r.label).width,u=Math.round(s+5),l=Math.round(t+2*o),c=Math.max(r.size,t/2)+o,f=Math.asin(l/2/c),v=Math.sqrt(Math.abs(Math.pow(c,2)-Math.pow(l/2,2)));e.beginPath(),e.moveTo(r.x+v,r.y+l/2),e.lineTo(r.x+c+u,r.y+l/2),e.lineTo(r.x+c+u,r.y-l/2),e.lineTo(r.x+v,r.y-l/2),e.arc(r.x,r.y,c,f,-f),e.closePath(),e.fill()}else e.beginPath(),e.arc(r.x,r.y,r.size+o,0,Math.PI*2),e.closePath(),e.fill();e.shadowOffsetX=0,e.shadowOffsetY=0,e.shadowBlur=0,we(e,r,n)}var fa=`
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

uniform float u_correctionRatio;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  float border = u_correctionRatio * 2.0;
  float dist = length(v_diffVector) - v_radius + border;

  // No antialiasing for picking mode:
  #ifdef PICKING_MODE
  if (dist > border)
    gl_FragColor = transparent;
  else
    gl_FragColor = v_color;

  #else
  float t = 0.0;
  if (dist > border)
    t = 1.0;
  else if (dist > 0.0)
    t = dist / border;

  gl_FragColor = mix(v_color, transparent, t);
  #endif
}
`,ha=fa,da=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying float v_border;

const float bias = 255.0 / 254.0;

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * 4.0;
  vec2 diffVector = size * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4(
    (u_matrix * vec3(position, 1)).xy,
    0,
    1
  );

  v_diffVector = diffVector;
  v_radius = size / 2.0;

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,va=da,Zr=WebGLRenderingContext,jr=Zr.UNSIGNED_BYTE,Dt=Zr.FLOAT,ga=["u_sizeRatio","u_correctionRatio","u_matrix"],xe=(function(e){function r(){return W(this,r),$(this,r,arguments)}return K(r,e),X(r,[{key:"getDefinition",value:function(){return{VERTICES:3,VERTEX_SHADER_SOURCE:va,FRAGMENT_SHADER_SOURCE:ha,METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:ga,ATTRIBUTES:[{name:"a_position",size:2,type:Dt},{name:"a_size",size:1,type:Dt},{name:"a_color",size:4,type:jr,normalized:!0},{name:"a_id",size:4,type:jr,normalized:!0}],CONSTANT_ATTRIBUTES:[{name:"a_angle",size:1,type:Dt}],CONSTANT_DATA:[[r.ANGLE_1],[r.ANGLE_2],[r.ANGLE_3]]}}},{key:"processVisibleItem",value:function(t,i,a){var o=this.array,s=Y(a.color);o[i++]=a.x,o[i++]=a.y,o[i++]=a.size,o[i++]=s,o[i++]=t}},{key:"setUniforms",value:function(t,i){var a=i.gl,o=i.uniformLocations,s=o.u_sizeRatio,u=o.u_correctionRatio,l=o.u_matrix;a.uniform1f(u,t.correctionRatio),a.uniform1f(s,t.sizeRatio),a.uniformMatrix3fv(l,!1,t.matrix)}}])})(re);x(xe,"ANGLE_1",0);x(xe,"ANGLE_2",2*Math.PI/3);x(xe,"ANGLE_3",4*Math.PI/3);var ma=`
precision mediump float;

varying vec4 v_color;

void main(void) {
  gl_FragColor = v_color;
}
`,pa=ma,ya=`
attribute vec2 a_position;
attribute vec2 a_normal;
attribute float a_radius;
attribute vec3 a_barycentric;

#ifdef PICKING_MODE
attribute vec4 a_id;
#else
attribute vec4 a_color;
#endif

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_lengthToThicknessRatio;
uniform float u_widenessToThicknessRatio;

varying vec4 v_color;

const float bias = 255.0 / 254.0;

void main() {
  float minThickness = u_minEdgeThickness;

  float normalLength = length(a_normal);
  vec2 unitNormal = a_normal / normalLength;

  // These first computations are taken from edge.vert.glsl and
  // edge.clamped.vert.glsl. Please read it to get better comments on what's
  // happening:
  float pixelsThickness = max(normalLength / u_sizeRatio, minThickness);
  float webGLThickness = pixelsThickness * u_correctionRatio;
  float webGLNodeRadius = a_radius * 2.0 * u_correctionRatio / u_sizeRatio;
  float webGLArrowHeadLength = webGLThickness * u_lengthToThicknessRatio * 2.0;
  float webGLArrowHeadThickness = webGLThickness * u_widenessToThicknessRatio;

  float da = a_barycentric.x;
  float db = a_barycentric.y;
  float dc = a_barycentric.z;

  vec2 delta = vec2(
      da * (webGLNodeRadius * unitNormal.y)
    + db * ((webGLNodeRadius + webGLArrowHeadLength) * unitNormal.y + webGLArrowHeadThickness * unitNormal.x)
    + dc * ((webGLNodeRadius + webGLArrowHeadLength) * unitNormal.y - webGLArrowHeadThickness * unitNormal.x),

      da * (-webGLNodeRadius * unitNormal.x)
    + db * (-(webGLNodeRadius + webGLArrowHeadLength) * unitNormal.x + webGLArrowHeadThickness * unitNormal.y)
    + dc * (-(webGLNodeRadius + webGLArrowHeadLength) * unitNormal.x - webGLArrowHeadThickness * unitNormal.y)
  );

  vec2 position = (u_matrix * vec3(a_position + delta, 1)).xy;

  gl_Position = vec4(position, 0, 1);

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,_a=ya,Qr=WebGLRenderingContext,Br=Qr.UNSIGNED_BYTE,Ze=Qr.FLOAT,ba=["u_matrix","u_sizeRatio","u_correctionRatio","u_minEdgeThickness","u_lengthToThicknessRatio","u_widenessToThicknessRatio"],he={extremity:"target",lengthToThicknessRatio:2.5,widenessToThicknessRatio:2};function Ce(e){var r=O(O({},he),e||{});return(function(n){function t(){return W(this,t),$(this,t,arguments)}return K(t,n),X(t,[{key:"getDefinition",value:function(){return{VERTICES:3,VERTEX_SHADER_SOURCE:_a,FRAGMENT_SHADER_SOURCE:pa,METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:ba,ATTRIBUTES:[{name:"a_position",size:2,type:Ze},{name:"a_normal",size:2,type:Ze},{name:"a_radius",size:1,type:Ze},{name:"a_color",size:4,type:Br,normalized:!0},{name:"a_id",size:4,type:Br,normalized:!0}],CONSTANT_ATTRIBUTES:[{name:"a_barycentric",size:3,type:Ze}],CONSTANT_DATA:[[1,0,0],[0,1,0],[0,0,1]]}}},{key:"processVisibleItem",value:function(a,o,s,u,l){if(r.extremity==="source"){var c=[u,s];s=c[0],u=c[1]}var f=l.size||1,v=u.size||1,g=s.x,_=s.y,m=u.x,E=u.y,T=Y(l.color),b=m-g,p=E-_,R=b*b+p*p,A=0,L=0;R&&(R=1/Math.sqrt(R),A=-p*R*f,L=b*R*f);var C=this.array;C[o++]=m,C[o++]=E,C[o++]=-A,C[o++]=-L,C[o++]=v,C[o++]=T,C[o++]=a}},{key:"setUniforms",value:function(a,o){var s=o.gl,u=o.uniformLocations,l=u.u_matrix,c=u.u_sizeRatio,f=u.u_correctionRatio,v=u.u_minEdgeThickness,g=u.u_lengthToThicknessRatio,_=u.u_widenessToThicknessRatio;s.uniformMatrix3fv(l,!1,a.matrix),s.uniform1f(c,a.sizeRatio),s.uniform1f(f,a.correctionRatio),s.uniform1f(v,a.minEdgeThickness),s.uniform1f(g,r.lengthToThicknessRatio),s.uniform1f(_,r.widenessToThicknessRatio)}}])})(ae)}var eu=Ce();var Ea=`
precision mediump float;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  // We only handle antialiasing for normal mode:
  #ifdef PICKING_MODE
  gl_FragColor = v_color;
  #else
  float dist = length(v_normal) * v_thickness;

  float t = smoothstep(
    v_thickness - v_feather,
    v_thickness,
    dist
  );

  gl_FragColor = mix(v_color, transparent, t);
  #endif
}
`,et=Ea,Ta=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;
attribute float a_radius;
attribute float a_radiusCoef;

uniform mat3 u_matrix;
uniform float u_zoomRatio;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_lengthToThicknessRatio;
uniform float u_feather;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;

const float bias = 255.0 / 254.0;

void main() {
  float minThickness = u_minEdgeThickness;

  float radius = a_radius * a_radiusCoef;
  vec2 normal = a_normal * a_normalCoef;
  vec2 position = a_positionStart * (1.0 - a_positionCoef) + a_positionEnd * a_positionCoef;

  float normalLength = length(normal);
  vec2 unitNormal = normal / normalLength;

  // These first computations are taken from edge.vert.glsl. Please read it to
  // get better comments on what's happening:
  float pixelsThickness = max(normalLength, minThickness * u_sizeRatio);
  float webGLThickness = pixelsThickness * u_correctionRatio / u_sizeRatio;

  // Here, we move the point to leave space for the arrow head:
  float direction = sign(radius);
  float webGLNodeRadius = direction * radius * 2.0 * u_correctionRatio / u_sizeRatio;
  float webGLArrowHeadLength = webGLThickness * u_lengthToThicknessRatio * 2.0;

  vec2 compensationVector = vec2(-direction * unitNormal.y, direction * unitNormal.x) * (webGLNodeRadius + webGLArrowHeadLength);

  // Here is the proper position of the vertex
  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness + compensationVector, 1)).xy, 0, 1);

  v_thickness = webGLThickness / u_zoomRatio;

  v_normal = unitNormal;

  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,Ra=Ta,Jr=WebGLRenderingContext,Hr=Jr.UNSIGNED_BYTE,pe=Jr.FLOAT,wa=["u_matrix","u_zoomRatio","u_sizeRatio","u_correctionRatio","u_pixelRatio","u_feather","u_minEdgeThickness","u_lengthToThicknessRatio"],en={lengthToThicknessRatio:he.lengthToThicknessRatio};function Mt(e){var r=O(O({},en),e||{});return(function(n){function t(){return W(this,t),$(this,t,arguments)}return K(t,n),X(t,[{key:"getDefinition",value:function(){return{VERTICES:6,VERTEX_SHADER_SOURCE:Ra,FRAGMENT_SHADER_SOURCE:et,METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:wa,ATTRIBUTES:[{name:"a_positionStart",size:2,type:pe},{name:"a_positionEnd",size:2,type:pe},{name:"a_normal",size:2,type:pe},{name:"a_color",size:4,type:Hr,normalized:!0},{name:"a_id",size:4,type:Hr,normalized:!0},{name:"a_radius",size:1,type:pe}],CONSTANT_ATTRIBUTES:[{name:"a_positionCoef",size:1,type:pe},{name:"a_normalCoef",size:1,type:pe},{name:"a_radiusCoef",size:1,type:pe}],CONSTANT_DATA:[[0,1,0],[0,-1,0],[1,1,1],[1,1,1],[0,-1,0],[1,-1,-1]]}}},{key:"processVisibleItem",value:function(a,o,s,u,l){var c=l.size||1,f=s.x,v=s.y,g=u.x,_=u.y,m=Y(l.color),E=g-f,T=_-v,b=u.size||1,p=E*E+T*T,R=0,A=0;p&&(p=1/Math.sqrt(p),R=-T*p*c,A=E*p*c);var L=this.array;L[o++]=f,L[o++]=v,L[o++]=g,L[o++]=_,L[o++]=R,L[o++]=A,L[o++]=m,L[o++]=a,L[o++]=b}},{key:"setUniforms",value:function(a,o){var s=o.gl,u=o.uniformLocations,l=u.u_matrix,c=u.u_zoomRatio,f=u.u_feather,v=u.u_pixelRatio,g=u.u_correctionRatio,_=u.u_sizeRatio,m=u.u_minEdgeThickness,E=u.u_lengthToThicknessRatio;s.uniformMatrix3fv(l,!1,a.matrix),s.uniform1f(c,a.zoomRatio),s.uniform1f(_,a.sizeRatio),s.uniform1f(g,a.correctionRatio),s.uniform1f(v,a.pixelRatio),s.uniform1f(f,a.antiAliasingFeather),s.uniform1f(m,a.minEdgeThickness),s.uniform1f(E,r.lengthToThicknessRatio)}}])})(ae)}var tu=Mt();function tn(e){return Ie([Mt(e),Ce(e)])}var xa=tn(),Ut=xa,Ca=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_zoomRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_feather;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;

const float bias = 255.0 / 254.0;

void main() {
  float minThickness = u_minEdgeThickness;

  vec2 normal = a_normal * a_normalCoef;
  vec2 position = a_positionStart * (1.0 - a_positionCoef) + a_positionEnd * a_positionCoef;

  float normalLength = length(normal);
  vec2 unitNormal = normal / normalLength;

  // We require edges to be at least "minThickness" pixels thick *on screen*
  // (so we need to compensate the size ratio):
  float pixelsThickness = max(normalLength, minThickness * u_sizeRatio);

  // Then, we need to retrieve the normalized thickness of the edge in the WebGL
  // referential (in a ([0, 1], [0, 1]) space), using our "magic" correction
  // ratio:
  float webGLThickness = pixelsThickness * u_correctionRatio / u_sizeRatio;

  // Here is the proper position of the vertex
  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness, 1)).xy, 0, 1);

  // For the fragment shader though, we need a thickness that takes the "magic"
  // correction ratio into account (as in webGLThickness), but so that the
  // antialiasing effect does not depend on the zoom level. So here's yet
  // another thickness version:
  v_thickness = webGLThickness / u_zoomRatio;

  v_normal = unitNormal;

  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,Sa=Ca,rn=WebGLRenderingContext,Vr=rn.UNSIGNED_BYTE,Fe=rn.FLOAT,Aa=["u_matrix","u_zoomRatio","u_sizeRatio","u_correctionRatio","u_pixelRatio","u_feather","u_minEdgeThickness"],tt=(function(e){function r(){return W(this,r),$(this,r,arguments)}return K(r,e),X(r,[{key:"getDefinition",value:function(){return{VERTICES:6,VERTEX_SHADER_SOURCE:Sa,FRAGMENT_SHADER_SOURCE:et,METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:Aa,ATTRIBUTES:[{name:"a_positionStart",size:2,type:Fe},{name:"a_positionEnd",size:2,type:Fe},{name:"a_normal",size:2,type:Fe},{name:"a_color",size:4,type:Vr,normalized:!0},{name:"a_id",size:4,type:Vr,normalized:!0}],CONSTANT_ATTRIBUTES:[{name:"a_positionCoef",size:1,type:Fe},{name:"a_normalCoef",size:1,type:Fe}],CONSTANT_DATA:[[0,1],[0,-1],[1,1],[1,1],[0,-1],[1,-1]]}}},{key:"processVisibleItem",value:function(t,i,a,o,s){var u=s.size||1,l=a.x,c=a.y,f=o.x,v=o.y,g=Y(s.color),_=f-l,m=v-c,E=_*_+m*m,T=0,b=0;E&&(E=1/Math.sqrt(E),T=-m*E*u,b=_*E*u);var p=this.array;p[i++]=l,p[i++]=c,p[i++]=f,p[i++]=v,p[i++]=T,p[i++]=b,p[i++]=g,p[i++]=t}},{key:"setUniforms",value:function(t,i){var a=i.gl,o=i.uniformLocations,s=o.u_matrix,u=o.u_zoomRatio,l=o.u_feather,c=o.u_pixelRatio,f=o.u_correctionRatio,v=o.u_sizeRatio,g=o.u_minEdgeThickness;a.uniformMatrix3fv(s,!1,t.matrix),a.uniform1f(u,t.zoomRatio),a.uniform1f(v,t.sizeRatio),a.uniform1f(f,t.correctionRatio),a.uniform1f(c,t.pixelRatio),a.uniform1f(l,t.antiAliasingFeather),a.uniform1f(g,t.minEdgeThickness)}}])})(ae);var vn=ve(it()),at=(function(e){function r(){var n;return W(this,r),n=$(this,r),n.rawEmitter=n,n}return K(r,e),X(r)})(vn.EventEmitter);var mn=ve(ot());var pn=function(r){return r},yn=function(r){return r*r},_n=function(r){return r*(2-r)},bn=function(r){return(r*=2)<1?.5*r*r:-.5*(--r*(r-2)-1)},En=function(r){return r*r*r},Tn=function(r){return--r*r*r+1},Rn=function(r){return(r*=2)<1?.5*r*r*r:.5*((r-=2)*r*r+2)},st={linear:pn,quadraticIn:yn,quadraticOut:_n,quadraticInOut:bn,cubicIn:En,cubicOut:Tn,cubicInOut:Rn},ut={easing:"quadraticInOut",duration:150};function wn(e,r,n,t){var i=Object.assign({},ut,n),a=typeof i.easing=="function"?i.easing:st[i.easing],o=Date.now(),s={};for(var u in r){var l=r[u];s[u]={};for(var c in l)s[u][c]=e.getNodeAttribute(u,c)}var f=null,v=function(){f=null;var _=(Date.now()-o)/i.duration;if(_>=1){for(var m in r){var E=r[m];for(var T in E)e.setNodeAttribute(m,T,E[T])}typeof t=="function"&&t();return}_=a(_);for(var b in r){var p=r[b],R=s[b];for(var A in p)e.setNodeAttribute(b,A,p[A]*_+R[A]*(1-_))}f=requestAnimationFrame(v)};return v(),function(){f&&cancelAnimationFrame(f)}}function ee(){return Float32Array.of(1,0,0,0,1,0,0,0,1)}function ze(e,r,n){return e[0]=r,e[4]=typeof n=="number"?n:r,e}function Bt(e,r){var n=Math.sin(r),t=Math.cos(r);return e[0]=t,e[1]=n,e[3]=-n,e[4]=t,e}function Ht(e,r,n){return e[6]=r,e[7]=n,e}function oe(e,r){var n=e[0],t=e[1],i=e[2],a=e[3],o=e[4],s=e[5],u=e[6],l=e[7],c=e[8],f=r[0],v=r[1],g=r[2],_=r[3],m=r[4],E=r[5],T=r[6],b=r[7],p=r[8];return e[0]=f*n+v*a+g*u,e[1]=f*t+v*o+g*l,e[2]=f*i+v*s+g*c,e[3]=_*n+m*a+E*u,e[4]=_*t+m*o+E*l,e[5]=_*i+m*s+E*c,e[6]=T*n+b*a+p*u,e[7]=T*t+b*o+p*l,e[8]=T*i+b*s+p*c,e}function Ge(e,r){var n=arguments.length>2&&arguments[2]!==void 0?arguments[2]:1,t=e[0],i=e[1],a=e[3],o=e[4],s=e[6],u=e[7],l=r.x,c=r.y;return{x:l*t+c*a+s*n,y:l*i+c*o+u*n}}function xn(e,r){var n=e.height/e.width,t=r.height/r.width;return n<1&&t>1||n>1&&t<1?1:Math.min(Math.max(t,1/t),Math.max(1/n,n))}function ye(e,r,n,t,i){var a=e.angle,o=e.ratio,s=e.x,u=e.y,l=r.width,c=r.height,f=ee(),v=Math.min(l,c)-2*t,g=xn(r,n);return i?(oe(f,Ht(ee(),s,u)),oe(f,ze(ee(),o)),oe(f,Bt(ee(),a)),oe(f,ze(ee(),l/v/2/g,c/v/2/g))):(oe(f,ze(ee(),2*(v/l)*g,2*(v/c)*g)),oe(f,Bt(ee(),-a)),oe(f,ze(ee(),1/o)),oe(f,Ht(ee(),-s,-u))),f}function Vt(e,r,n){var t=Ge(e,{x:Math.cos(r.angle),y:Math.sin(r.angle)},0),i=t.x,a=t.y;return 1/Math.sqrt(Math.pow(i,2)+Math.pow(a,2))/n.width}function Wt(e){if(!e.order)return{x:[0,1],y:[0,1]};var r=1/0,n=-1/0,t=1/0,i=-1/0;return e.forEachNode(function(a,o){var s=o.x,u=o.y;s<r&&(r=s),s>n&&(n=s),u<t&&(t=u),u>i&&(i=u)}),{x:[r,n],y:[t,i]}}function Xt(e){if(!(0,mn.default)(e))throw new Error("Sigma: invalid graph instance.");e.forEachNode(function(r,n){if(!Number.isFinite(n.x)||!Number.isFinite(n.y))throw new Error("Sigma: Coordinates of node ".concat(r," are invalid. A node must have a numeric 'x' and 'y' attribute."))})}function Yt(e,r,n){var t=document.createElement(e);if(r)for(var i in r)t.style[i]=r[i];if(n)for(var a in n)t.setAttribute(a,n[a]);return t}function lt(){return typeof window.devicePixelRatio<"u"?window.devicePixelRatio:1}function ct(e,r,n){return n.sort(function(t,i){var a=r(t)||0,o=r(i)||0;return a<o?-1:a>o?1:0})}function ft(e){var r=fe(e.x,2),n=r[0],t=r[1],i=fe(e.y,2),a=i[0],o=i[1],s=Math.max(t-n,o-a),u=(t+n)/2,l=(o+a)/2;(s===0||Math.abs(s)===1/0||isNaN(s))&&(s=1),isNaN(u)&&(u=0),isNaN(l)&&(l=0);var c=function(v){return{x:.5+(v.x-u)/s,y:.5+(v.y-l)/s}};return c.applyTo=function(f){f.x=.5+(f.x-u)/s,f.y=.5+(f.y-l)/s},c.inverse=function(f){return{x:u+s*(f.x-.5),y:l+s*(f.y-.5)}},c.ratio=s,c}function ht(e){"@babel/helpers - typeof";return ht=typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?function(r){return typeof r}:function(r){return r&&typeof Symbol=="function"&&r.constructor===Symbol&&r!==Symbol.prototype?"symbol":typeof r},ht(e)}function qt(e,r){var n=r.size;if(n!==0){var t=e.length;e.length+=n;var i=0;r.forEach(function(a){e[t+i]=a,i++})}}function dt(e){e=e||{};for(var r=0,n=arguments.length<=1?0:arguments.length-1;r<n;r++){var t=r+1<1||arguments.length<=r+1?void 0:arguments[r+1];t&&Object.assign(e,t)}return e}var vt={hideEdgesOnMove:!1,hideLabelsOnMove:!1,renderLabels:!0,renderEdgeLabels:!1,enableEdgeEvents:!1,defaultNodeColor:"#999",defaultNodeType:"circle",defaultEdgeColor:"#ccc",defaultEdgeType:"line",labelFont:"Arial",labelSize:14,labelWeight:"normal",labelColor:{color:"#000"},edgeLabelFont:"Arial",edgeLabelSize:14,edgeLabelWeight:"normal",edgeLabelColor:{attribute:"color"},stagePadding:30,defaultDrawEdgeLabel:Gt,defaultDrawNodeLabel:we,defaultDrawNodeHover:Je,minEdgeThickness:1.7,antiAliasingFeather:1,dragTimeout:100,draggedEventsTolerance:3,inertiaDuration:200,inertiaRatio:3,zoomDuration:250,zoomingRatio:1.7,doubleClickTimeout:300,doubleClickZoomingRatio:2.2,doubleClickZoomingDuration:200,tapMoveTolerance:10,zoomToSizeRatioFunction:Math.sqrt,itemSizesReference:"screen",autoRescale:!0,autoCenter:!0,labelDensity:1,labelGridCellSize:100,labelRenderedSizeThreshold:6,nodeReducer:null,edgeReducer:null,zIndex:!1,minCameraRatio:null,maxCameraRatio:null,enableCameraZooming:!0,enableCameraPanning:!0,enableCameraRotation:!0,cameraPanBoundaries:null,allowInvalidContainer:!1,nodeProgramClasses:{},nodeHoverProgramClasses:{},edgeProgramClasses:{}},Fa={circle:xe},Ia={arrow:Ut,line:tt};function gt(e){if(typeof e.labelDensity!="number"||e.labelDensity<0)throw new Error("Settings: invalid `labelDensity`. Expecting a positive number.");var r=e.minCameraRatio,n=e.maxCameraRatio;if(typeof r=="number"&&typeof n=="number"&&n<r)throw new Error("Settings: invalid camera ratio boundaries. Expecting `maxCameraRatio` to be greater than `minCameraRatio`.")}function Cn(e){var r=dt({},vt,e);return r.nodeProgramClasses=dt({},Fa,r.nodeProgramClasses),r.edgeProgramClasses=dt({},Ia,r.edgeProgramClasses),r}var bu=ve(it()),Eu=ve(ot()),mt=1.5,Kt=(function(e){function r(){var n;return W(this,r),n=$(this,r),x(n,"x",.5),x(n,"y",.5),x(n,"angle",0),x(n,"ratio",1),x(n,"minRatio",null),x(n,"maxRatio",null),x(n,"enabledZooming",!0),x(n,"enabledPanning",!0),x(n,"enabledRotation",!0),x(n,"clean",null),x(n,"nextFrame",null),x(n,"previousState",null),x(n,"enabled",!0),n.previousState=n.getState(),n}return K(r,e),X(r,[{key:"enable",value:function(){return this.enabled=!0,this}},{key:"disable",value:function(){return this.enabled=!1,this}},{key:"getState",value:function(){return{x:this.x,y:this.y,angle:this.angle,ratio:this.ratio}}},{key:"hasState",value:function(t){return this.x===t.x&&this.y===t.y&&this.ratio===t.ratio&&this.angle===t.angle}},{key:"getPreviousState",value:function(){var t=this.previousState;return t?{x:t.x,y:t.y,angle:t.angle,ratio:t.ratio}:null}},{key:"getBoundedRatio",value:function(t){var i=t;return typeof this.minRatio=="number"&&(i=Math.max(i,this.minRatio)),typeof this.maxRatio=="number"&&(i=Math.min(i,this.maxRatio)),i}},{key:"validateState",value:function(t){var i={};return this.enabledPanning&&typeof t.x=="number"&&(i.x=t.x),this.enabledPanning&&typeof t.y=="number"&&(i.y=t.y),this.enabledZooming&&typeof t.ratio=="number"&&(i.ratio=this.getBoundedRatio(t.ratio)),this.enabledRotation&&typeof t.angle=="number"&&(i.angle=t.angle),this.clean?this.clean(O(O({},this.getState()),i)):i}},{key:"isAnimated",value:function(){return!!this.nextFrame}},{key:"setState",value:function(t){if(!this.enabled)return this;this.previousState=this.getState();var i=this.validateState(t);return typeof i.x=="number"&&(this.x=i.x),typeof i.y=="number"&&(this.y=i.y),typeof i.ratio=="number"&&(this.ratio=i.ratio),typeof i.angle=="number"&&(this.angle=i.angle),this.hasState(this.previousState)||this.emit("updated",this.getState()),this}},{key:"updateState",value:function(t){return this.setState(t(this.getState())),this}},{key:"animate",value:function(t){var i=this,a=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},o=arguments.length>2?arguments[2]:void 0;if(!o)return new Promise(function(g){return i.animate(t,a,g)});if(this.enabled){var s=O(O({},ut),a),u=this.validateState(t),l=typeof s.easing=="function"?s.easing:st[s.easing],c=Date.now(),f=this.getState(),v=function(){var _=(Date.now()-c)/s.duration;if(_>=1){i.nextFrame=null,i.setState(u),i.animationCallback&&(i.animationCallback.call(null),i.animationCallback=void 0);return}var m=l(_),E={};typeof u.x=="number"&&(E.x=f.x+(u.x-f.x)*m),typeof u.y=="number"&&(E.y=f.y+(u.y-f.y)*m),i.enabledRotation&&typeof u.angle=="number"&&(E.angle=f.angle+(u.angle-f.angle)*m),typeof u.ratio=="number"&&(E.ratio=f.ratio+(u.ratio-f.ratio)*m),i.setState(E),i.nextFrame=requestAnimationFrame(v)};this.nextFrame?(cancelAnimationFrame(this.nextFrame),this.animationCallback&&this.animationCallback.call(null),this.nextFrame=requestAnimationFrame(v)):v(),this.animationCallback=o}}},{key:"animatedZoom",value:function(t){return t?typeof t=="number"?this.animate({ratio:this.ratio/t}):this.animate({ratio:this.ratio/(t.factor||mt)},t):this.animate({ratio:this.ratio/mt})}},{key:"animatedUnzoom",value:function(t){return t?typeof t=="number"?this.animate({ratio:this.ratio*t}):this.animate({ratio:this.ratio*(t.factor||mt)},t):this.animate({ratio:this.ratio*mt})}},{key:"animatedReset",value:function(t){return this.animate({x:.5,y:.5,ratio:1,angle:0},t)}},{key:"copy",value:function(){return r.from(this.getState())}}],[{key:"from",value:function(t){var i=new r;return i.setState(t)}}])})(at);function ne(e,r){var n=r.getBoundingClientRect();return{x:e.clientX-n.left,y:e.clientY-n.top}}function se(e,r){var n=O(O({},ne(e,r)),{},{sigmaDefaultPrevented:!1,preventSigmaDefault:function(){n.sigmaDefaultPrevented=!0},original:e});return n}function Me(e){var r="x"in e?e:O(O({},e.touches[0]||e.previousTouches[0]),{},{original:e.original,sigmaDefaultPrevented:e.sigmaDefaultPrevented,preventSigmaDefault:function(){e.sigmaDefaultPrevented=!0,r.sigmaDefaultPrevented=!0}});return r}function za(e,r){return O(O({},se(e,r)),{},{delta:Nn(e)})}var Ga=2;function pt(e){for(var r=[],n=0,t=Math.min(e.length,Ga);n<t;n++)r.push(e[n]);return r}function Ue(e,r,n){var t={touches:pt(e.touches).map(function(i){return ne(i,n)}),previousTouches:r.map(function(i){return ne(i,n)}),sigmaDefaultPrevented:!1,preventSigmaDefault:function(){t.sigmaDefaultPrevented=!0},original:e};return t}function Nn(e){if(typeof e.deltaY<"u")return e.deltaY*-3/360;if(typeof e.detail<"u")return e.detail/-9;throw new Error("Captor: could not extract delta from event.")}var kn=(function(e){function r(n,t){var i;return W(this,r),i=$(this,r),i.container=n,i.renderer=t,i}return K(r,e),X(r)})(at),Ma=["doubleClickTimeout","doubleClickZoomingDuration","doubleClickZoomingRatio","dragTimeout","draggedEventsTolerance","inertiaDuration","inertiaRatio","zoomDuration","zoomingRatio"],Ua=Ma.reduce(function(e,r){return O(O({},e),{},x({},r,vt[r]))},{}),Dn=(function(e){function r(n,t){var i;return W(this,r),i=$(this,r,[n,t]),x(i,"enabled",!0),x(i,"draggedEvents",0),x(i,"downStartTime",null),x(i,"lastMouseX",null),x(i,"lastMouseY",null),x(i,"isMouseDown",!1),x(i,"isMoving",!1),x(i,"movingTimeout",null),x(i,"startCameraState",null),x(i,"clicks",0),x(i,"doubleClickTimeout",null),x(i,"currentWheelDirection",0),x(i,"settings",Ua),i.handleClick=i.handleClick.bind(i),i.handleRightClick=i.handleRightClick.bind(i),i.handleDown=i.handleDown.bind(i),i.handleUp=i.handleUp.bind(i),i.handleMove=i.handleMove.bind(i),i.handleWheel=i.handleWheel.bind(i),i.handleLeave=i.handleLeave.bind(i),i.handleEnter=i.handleEnter.bind(i),n.addEventListener("click",i.handleClick,{capture:!1}),n.addEventListener("contextmenu",i.handleRightClick,{capture:!1}),n.addEventListener("mousedown",i.handleDown,{capture:!1}),n.addEventListener("wheel",i.handleWheel,{capture:!1}),n.addEventListener("mouseleave",i.handleLeave,{capture:!1}),n.addEventListener("mouseenter",i.handleEnter,{capture:!1}),document.addEventListener("mousemove",i.handleMove,{capture:!1}),document.addEventListener("mouseup",i.handleUp,{capture:!1}),i}return K(r,e),X(r,[{key:"kill",value:function(){var t=this.container;t.removeEventListener("click",this.handleClick),t.removeEventListener("contextmenu",this.handleRightClick),t.removeEventListener("mousedown",this.handleDown),t.removeEventListener("wheel",this.handleWheel),t.removeEventListener("mouseleave",this.handleLeave),t.removeEventListener("mouseenter",this.handleEnter),document.removeEventListener("mousemove",this.handleMove),document.removeEventListener("mouseup",this.handleUp)}},{key:"handleClick",value:function(t){var i=this;if(this.enabled){if(this.clicks++,this.clicks===2)return this.clicks=0,typeof this.doubleClickTimeout=="number"&&(clearTimeout(this.doubleClickTimeout),this.doubleClickTimeout=null),this.handleDoubleClick(t);setTimeout(function(){i.clicks=0,i.doubleClickTimeout=null},this.settings.doubleClickTimeout),this.draggedEvents<this.settings.draggedEventsTolerance&&this.emit("click",se(t,this.container))}}},{key:"handleRightClick",value:function(t){this.enabled&&this.emit("rightClick",se(t,this.container))}},{key:"handleDoubleClick",value:function(t){if(this.enabled){t.preventDefault(),t.stopPropagation();var i=se(t,this.container);if(this.emit("doubleClick",i),!i.sigmaDefaultPrevented){var a=this.renderer.getCamera(),o=a.getBoundedRatio(a.getState().ratio/this.settings.doubleClickZoomingRatio);a.animate(this.renderer.getViewportZoomedState(ne(t,this.container),o),{easing:"quadraticInOut",duration:this.settings.doubleClickZoomingDuration})}}}},{key:"handleDown",value:function(t){if(this.enabled){if(t.button===0){this.startCameraState=this.renderer.getCamera().getState();var i=ne(t,this.container),a=i.x,o=i.y;this.lastMouseX=a,this.lastMouseY=o,this.draggedEvents=0,this.downStartTime=Date.now(),this.isMouseDown=!0}this.emit("mousedown",se(t,this.container))}}},{key:"handleUp",value:function(t){var i=this;if(!(!this.enabled||!this.isMouseDown)){var a=this.renderer.getCamera();this.isMouseDown=!1,typeof this.movingTimeout=="number"&&(clearTimeout(this.movingTimeout),this.movingTimeout=null);var o=ne(t,this.container),s=o.x,u=o.y,l=a.getState(),c=a.getPreviousState()||{x:0,y:0};this.isMoving?a.animate({x:l.x+this.settings.inertiaRatio*(l.x-c.x),y:l.y+this.settings.inertiaRatio*(l.y-c.y)},{duration:this.settings.inertiaDuration,easing:"quadraticOut"}):(this.lastMouseX!==s||this.lastMouseY!==u)&&a.setState({x:l.x,y:l.y}),this.isMoving=!1,setTimeout(function(){var f=i.draggedEvents>0;i.draggedEvents=0,f&&i.renderer.getSetting("hideEdgesOnMove")&&i.renderer.refresh()},0),this.emit("mouseup",se(t,this.container))}}},{key:"handleMove",value:function(t){var i=this;if(this.enabled){var a=se(t,this.container);if(this.emit("mousemovebody",a),(t.target===this.container||t.composedPath()[0]===this.container)&&this.emit("mousemove",a),!a.sigmaDefaultPrevented&&this.isMouseDown){this.isMoving=!0,this.draggedEvents++,typeof this.movingTimeout=="number"&&clearTimeout(this.movingTimeout),this.movingTimeout=window.setTimeout(function(){i.movingTimeout=null,i.isMoving=!1},this.settings.dragTimeout);var o=this.renderer.getCamera(),s=ne(t,this.container),u=s.x,l=s.y,c=this.renderer.viewportToFramedGraph({x:this.lastMouseX,y:this.lastMouseY}),f=this.renderer.viewportToFramedGraph({x:u,y:l}),v=c.x-f.x,g=c.y-f.y,_=o.getState(),m=_.x+v,E=_.y+g;o.setState({x:m,y:E}),this.lastMouseX=u,this.lastMouseY=l,t.preventDefault(),t.stopPropagation()}}}},{key:"handleLeave",value:function(t){this.emit("mouseleave",se(t,this.container))}},{key:"handleEnter",value:function(t){this.emit("mouseenter",se(t,this.container))}},{key:"handleWheel",value:function(t){var i=this,a=this.renderer.getCamera();if(!(!this.enabled||!a.enabledZooming)){var o=Nn(t);if(o){var s=za(t,this.container);if(this.emit("wheel",s),s.sigmaDefaultPrevented){t.preventDefault(),t.stopPropagation();return}var u=a.getState().ratio,l=o>0?1/this.settings.zoomingRatio:this.settings.zoomingRatio,c=a.getBoundedRatio(u*l),f=o>0?1:-1,v=Date.now();u!==c&&(t.preventDefault(),t.stopPropagation(),!(this.currentWheelDirection===f&&this.lastWheelTriggerTime&&v-this.lastWheelTriggerTime<this.settings.zoomDuration/5)&&(a.animate(this.renderer.getViewportZoomedState(ne(t,this.container),c),{easing:"quadraticOut",duration:this.settings.zoomDuration},function(){i.currentWheelDirection=0}),this.currentWheelDirection=f,this.lastWheelTriggerTime=v))}}}},{key:"setSettings",value:function(t){this.settings=t}}])})(kn),ja=["dragTimeout","inertiaDuration","inertiaRatio","doubleClickTimeout","doubleClickZoomingRatio","doubleClickZoomingDuration","tapMoveTolerance"],Ba=ja.reduce(function(e,r){return O(O({},e),{},x({},r,vt[r]))},{}),Ha=(function(e){function r(n,t){var i;return W(this,r),i=$(this,r,[n,t]),x(i,"enabled",!0),x(i,"isMoving",!1),x(i,"hasMoved",!1),x(i,"touchMode",0),x(i,"startTouchesPositions",[]),x(i,"lastTouches",[]),x(i,"lastTap",null),x(i,"settings",Ba),i.handleStart=i.handleStart.bind(i),i.handleLeave=i.handleLeave.bind(i),i.handleMove=i.handleMove.bind(i),n.addEventListener("touchstart",i.handleStart,{capture:!1}),n.addEventListener("touchcancel",i.handleLeave,{capture:!1}),document.addEventListener("touchend",i.handleLeave,{capture:!1,passive:!1}),document.addEventListener("touchmove",i.handleMove,{capture:!1,passive:!1}),i}return K(r,e),X(r,[{key:"kill",value:function(){var t=this.container;t.removeEventListener("touchstart",this.handleStart),t.removeEventListener("touchcancel",this.handleLeave),document.removeEventListener("touchend",this.handleLeave),document.removeEventListener("touchmove",this.handleMove)}},{key:"getDimensions",value:function(){return{width:this.container.offsetWidth,height:this.container.offsetHeight}}},{key:"handleStart",value:function(t){var i=this;if(this.enabled){t.preventDefault();var a=pt(t.touches);if(this.touchMode=a.length,this.startCameraState=this.renderer.getCamera().getState(),this.startTouchesPositions=a.map(function(g){return ne(g,i.container)}),this.touchMode===2){var o=fe(this.startTouchesPositions,2),s=o[0],u=s.x,l=s.y,c=o[1],f=c.x,v=c.y;this.startTouchesAngle=Math.atan2(v-l,f-u),this.startTouchesDistance=Math.sqrt(Math.pow(f-u,2)+Math.pow(v-l,2))}this.emit("touchdown",Ue(t,this.lastTouches,this.container)),this.lastTouches=a,this.lastTouchesPositions=this.startTouchesPositions}}},{key:"handleLeave",value:function(t){if(!(!this.enabled||!this.startTouchesPositions.length)){switch(t.cancelable&&t.preventDefault(),this.movingTimeout&&(this.isMoving=!1,clearTimeout(this.movingTimeout)),this.touchMode){case 2:if(t.touches.length===1){this.handleStart(t),t.preventDefault();break}case 1:if(this.isMoving){var i=this.renderer.getCamera(),a=i.getState(),o=i.getPreviousState()||{x:0,y:0};i.animate({x:a.x+this.settings.inertiaRatio*(a.x-o.x),y:a.y+this.settings.inertiaRatio*(a.y-o.y)},{duration:this.settings.inertiaDuration,easing:"quadraticOut"})}this.hasMoved=!1,this.isMoving=!1,this.touchMode=0;break}if(this.emit("touchup",Ue(t,this.lastTouches,this.container)),!t.touches.length){var s=ne(this.lastTouches[0],this.container),u=this.startTouchesPositions[0],l=Math.pow(s.x-u.x,2)+Math.pow(s.y-u.y,2);if(!t.touches.length&&l<Math.pow(this.settings.tapMoveTolerance,2))if(this.lastTap&&Date.now()-this.lastTap.time<this.settings.doubleClickTimeout){var c=Ue(t,this.lastTouches,this.container);if(this.emit("doubletap",c),this.lastTap=null,!c.sigmaDefaultPrevented){var f=this.renderer.getCamera(),v=f.getBoundedRatio(f.getState().ratio/this.settings.doubleClickZoomingRatio);f.animate(this.renderer.getViewportZoomedState(s,v),{easing:"quadraticInOut",duration:this.settings.doubleClickZoomingDuration})}}else{var g=Ue(t,this.lastTouches,this.container);this.emit("tap",g),this.lastTap={time:Date.now(),position:g.touches[0]||g.previousTouches[0]}}}this.lastTouches=pt(t.touches),this.startTouchesPositions=[]}}},{key:"handleMove",value:function(t){var i=this;if(!(!this.enabled||!this.startTouchesPositions.length)){t.preventDefault();var a=pt(t.touches),o=a.map(function(P){return ne(P,i.container)}),s=this.lastTouches;this.lastTouches=a,this.lastTouchesPositions=o;var u=Ue(t,s,this.container);if(this.emit("touchmove",u),!u.sigmaDefaultPrevented&&(this.hasMoved||(this.hasMoved=o.some(function(P,k){var I=i.startTouchesPositions[k];return I&&(P.x!==I.x||P.y!==I.y)})),!!this.hasMoved)){this.isMoving=!0,this.movingTimeout&&clearTimeout(this.movingTimeout),this.movingTimeout=window.setTimeout(function(){i.isMoving=!1},this.settings.dragTimeout);var l=this.renderer.getCamera(),c=this.startCameraState,f=this.renderer.getSetting("stagePadding");switch(this.touchMode){case 1:{var v=this.renderer.viewportToFramedGraph((this.startTouchesPositions||[])[0]),g=v.x,_=v.y,m=this.renderer.viewportToFramedGraph(o[0]),E=m.x,T=m.y;l.setState({x:c.x+g-E,y:c.y+_-T});break}case 2:{var b={x:.5,y:.5,angle:0,ratio:1},p=o[0],R=p.x,A=p.y,L=o[1],C=L.x,D=L.y,N=Math.atan2(D-A,C-R)-this.startTouchesAngle,F=Math.hypot(D-A,C-R)/this.startTouchesDistance,G=l.getBoundedRatio(c.ratio/F);b.ratio=G,b.angle=c.angle+N;var z=this.getDimensions(),H=this.renderer.viewportToFramedGraph((this.startTouchesPositions||[])[0],{cameraState:c}),M=Math.min(z.width,z.height)-2*f,j=M/z.width,h=M/z.height,d=G/M,y=R-M/2/j,S=A-M/2/h,w=[y*Math.cos(-b.angle)-S*Math.sin(-b.angle),S*Math.cos(-b.angle)+y*Math.sin(-b.angle)];y=w[0],S=w[1],b.x=H.x-y*d,b.y=H.y+S*d,l.setState(b);break}}}}}},{key:"setSettings",value:function(t){this.settings=t}}])})(kn);function Va(e){if(Array.isArray(e))return Ye(e)}function Wa(e){if(typeof Symbol<"u"&&e[Symbol.iterator]!=null||e["@@iterator"]!=null)return Array.from(e)}function Xa(){throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function Sn(e){return Va(e)||Wa(e)||Nt(e)||Xa()}function Ya(e,r){if(e==null)return{};var n={};for(var t in e)if({}.hasOwnProperty.call(e,t)){if(r.indexOf(t)!==-1)continue;n[t]=e[t]}return n}function $t(e,r){if(e==null)return{};var n,t,i=Ya(e,r);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);for(t=0;t<a.length;t++)n=a[t],r.indexOf(n)===-1&&{}.propertyIsEnumerable.call(e,n)&&(i[n]=e[n])}return i}var An=(function(){function e(r,n){W(this,e),this.key=r,this.size=n}return X(e,null,[{key:"compare",value:function(n,t){return n.size>t.size?-1:n.size<t.size||n.key>t.key?1:-1}}])})(),Ln=(function(){function e(){W(this,e),x(this,"width",0),x(this,"height",0),x(this,"cellSize",0),x(this,"columns",0),x(this,"rows",0),x(this,"cells",{})}return X(e,[{key:"resizeAndClear",value:function(n,t){this.width=n.width,this.height=n.height,this.cellSize=t,this.columns=Math.ceil(n.width/t),this.rows=Math.ceil(n.height/t),this.cells={}}},{key:"getIndex",value:function(n){var t=Math.floor(n.x/this.cellSize),i=Math.floor(n.y/this.cellSize);return i*this.columns+t}},{key:"add",value:function(n,t,i){var a=new An(n,t),o=this.getIndex(i),s=this.cells[o];s||(s=[],this.cells[o]=s),s.push(a)}},{key:"organize",value:function(){for(var n in this.cells){var t=this.cells[n];t.sort(An.compare)}}},{key:"getLabelsToDisplay",value:function(n,t){var i=this.cellSize*this.cellSize,a=i/n/n,o=a*t/i,s=Math.ceil(o),u=[];for(var l in this.cells)for(var c=this.cells[l],f=0;f<Math.min(s,c.length);f++)u.push(c[f].key);return u}}])})();function qa(e){var r=e.graph,n=e.hoveredNode,t=e.highlightedNodes,i=e.displayedNodeLabels,a=[];return r.forEachEdge(function(o,s,u,l){(u===n||l===n||t.has(u)||t.has(l)||i.has(u)&&i.has(l))&&a.push(o)}),a}var Pn=150,On=50,ue=Object.prototype.hasOwnProperty;function $a(e,r,n){if(!ue.call(n,"x")||!ue.call(n,"y"))throw new Error('Sigma: could not find a valid position (x, y) for node "'.concat(r,'". All your nodes must have a number "x" and "y". Maybe your forgot to apply a layout or your "nodeReducer" is not returning the correct data?'));return n.color||(n.color=e.defaultNodeColor),!n.label&&n.label!==""&&(n.label=null),n.label!==void 0&&n.label!==null?n.label=""+n.label:n.label=null,n.size||(n.size=2),ue.call(n,"hidden")||(n.hidden=!1),ue.call(n,"highlighted")||(n.highlighted=!1),ue.call(n,"forceLabel")||(n.forceLabel=!1),(!n.type||n.type==="")&&(n.type=e.defaultNodeType),n.zIndex||(n.zIndex=0),n}function Ka(e,r,n){return n.color||(n.color=e.defaultEdgeColor),n.label||(n.label=""),n.size||(n.size=.5),ue.call(n,"hidden")||(n.hidden=!1),ue.call(n,"forceLabel")||(n.forceLabel=!1),(!n.type||n.type==="")&&(n.type=e.defaultEdgeType),n.zIndex||(n.zIndex=0),n}var Fn=(function(e){function r(n,t){var i,a=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{};if(W(this,r),i=$(this,r),x(i,"elements",{}),x(i,"canvasContexts",{}),x(i,"webGLContexts",{}),x(i,"pickingLayers",new Set),x(i,"textures",{}),x(i,"frameBuffers",{}),x(i,"activeListeners",{}),x(i,"labelGrid",new Ln),x(i,"nodeDataCache",{}),x(i,"edgeDataCache",{}),x(i,"nodeProgramIndex",{}),x(i,"edgeProgramIndex",{}),x(i,"nodesWithForcedLabels",new Set),x(i,"edgesWithForcedLabels",new Set),x(i,"nodeExtent",{x:[0,1],y:[0,1]}),x(i,"nodeZExtent",[1/0,-1/0]),x(i,"edgeZExtent",[1/0,-1/0]),x(i,"matrix",ee()),x(i,"invMatrix",ee()),x(i,"correctionRatio",1),x(i,"customBBox",null),x(i,"normalizationFunction",ft({x:[0,1],y:[0,1]})),x(i,"graphToViewportRatio",1),x(i,"itemIDsIndex",{}),x(i,"nodeIndices",{}),x(i,"edgeIndices",{}),x(i,"width",0),x(i,"height",0),x(i,"pixelRatio",lt()),x(i,"pickingDownSizingRatio",2*i.pixelRatio),x(i,"displayedNodeLabels",new Set),x(i,"displayedEdgeLabels",new Set),x(i,"highlightedNodes",new Set),x(i,"hoveredNode",null),x(i,"hoveredEdge",null),x(i,"renderFrame",null),x(i,"renderHighlightedNodesFrame",null),x(i,"needToProcess",!1),x(i,"checkEdgesEventsFrame",null),x(i,"nodePrograms",{}),x(i,"nodeHoverPrograms",{}),x(i,"edgePrograms",{}),i.settings=Cn(a),gt(i.settings),Xt(n),!(t instanceof HTMLElement))throw new Error("Sigma: container should be an html element.");i.graph=n,i.container=t,i.createWebGLContext("edges",{picking:a.enableEdgeEvents}),i.createCanvasContext("edgeLabels"),i.createWebGLContext("nodes",{picking:!0}),i.createCanvasContext("labels"),i.createCanvasContext("hovers"),i.createWebGLContext("hoverNodes"),i.createCanvasContext("mouse",{style:{touchAction:"none",userSelect:"none"}}),i.resize();for(var o in i.settings.nodeProgramClasses)i.registerNodeProgram(o,i.settings.nodeProgramClasses[o],i.settings.nodeHoverProgramClasses[o]);for(var s in i.settings.edgeProgramClasses)i.registerEdgeProgram(s,i.settings.edgeProgramClasses[s]);return i.camera=new Kt,i.bindCameraHandlers(),i.mouseCaptor=new Dn(i.elements.mouse,i),i.mouseCaptor.setSettings(i.settings),i.touchCaptor=new Ha(i.elements.mouse,i),i.touchCaptor.setSettings(i.settings),i.bindEventHandlers(),i.bindGraphHandlers(),i.handleSettingsUpdate(),i.refresh(),i}return K(r,e),X(r,[{key:"registerNodeProgram",value:function(t,i,a){return this.nodePrograms[t]&&this.nodePrograms[t].kill(),this.nodeHoverPrograms[t]&&this.nodeHoverPrograms[t].kill(),this.nodePrograms[t]=new i(this.webGLContexts.nodes,this.frameBuffers.nodes,this),this.nodeHoverPrograms[t]=new(a||i)(this.webGLContexts.hoverNodes,null,this),this}},{key:"registerEdgeProgram",value:function(t,i){return this.edgePrograms[t]&&this.edgePrograms[t].kill(),this.edgePrograms[t]=new i(this.webGLContexts.edges,this.frameBuffers.edges,this),this}},{key:"unregisterNodeProgram",value:function(t){if(this.nodePrograms[t]){var i=this.nodePrograms,a=i[t],o=$t(i,[t].map(me));a.kill(),this.nodePrograms=o}if(this.nodeHoverPrograms[t]){var s=this.nodeHoverPrograms,u=s[t],l=$t(s,[t].map(me));u.kill(),this.nodePrograms=l}return this}},{key:"unregisterEdgeProgram",value:function(t){if(this.edgePrograms[t]){var i=this.edgePrograms,a=i[t],o=$t(i,[t].map(me));a.kill(),this.edgePrograms=o}return this}},{key:"resetWebGLTexture",value:function(t){var i=this.webGLContexts[t],a=this.frameBuffers[t],o=this.textures[t];o&&i.deleteTexture(o);var s=i.createTexture();return i.bindFramebuffer(i.FRAMEBUFFER,a),i.bindTexture(i.TEXTURE_2D,s),i.texImage2D(i.TEXTURE_2D,0,i.RGBA,this.width,this.height,0,i.RGBA,i.UNSIGNED_BYTE,null),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,s,0),this.textures[t]=s,this}},{key:"bindCameraHandlers",value:function(){var t=this;return this.activeListeners.camera=function(){t.scheduleRender()},this.camera.on("updated",this.activeListeners.camera),this}},{key:"unbindCameraHandlers",value:function(){return this.camera.removeListener("updated",this.activeListeners.camera),this}},{key:"getNodeAtPosition",value:function(t){var i=t.x,a=t.y,o=Ke(this.webGLContexts.nodes,this.frameBuffers.nodes,i,a,this.pixelRatio,this.pickingDownSizingRatio),s=$e.apply(void 0,Sn(o)),u=this.itemIDsIndex[s];return u&&u.type==="node"?u.id:null}},{key:"bindEventHandlers",value:function(){var t=this;this.activeListeners.handleResize=function(){t.scheduleRefresh()},window.addEventListener("resize",this.activeListeners.handleResize),this.activeListeners.handleMove=function(a){var o=Me(a),s={event:o,preventSigmaDefault:function(){o.preventSigmaDefault()}},u=t.getNodeAtPosition(o);if(u&&t.hoveredNode!==u&&!t.nodeDataCache[u].hidden){t.hoveredNode&&t.emit("leaveNode",O(O({},s),{},{node:t.hoveredNode})),t.hoveredNode=u,t.emit("enterNode",O(O({},s),{},{node:u})),t.scheduleHighlightedNodesRender();return}if(t.hoveredNode&&t.getNodeAtPosition(o)!==t.hoveredNode){var l=t.hoveredNode;t.hoveredNode=null,t.emit("leaveNode",O(O({},s),{},{node:l})),t.scheduleHighlightedNodesRender();return}if(t.settings.enableEdgeEvents){var c=t.hoveredNode?null:t.getEdgeAtPoint(s.event.x,s.event.y);c!==t.hoveredEdge&&(t.hoveredEdge&&t.emit("leaveEdge",O(O({},s),{},{edge:t.hoveredEdge})),c&&t.emit("enterEdge",O(O({},s),{},{edge:c})),t.hoveredEdge=c)}},this.activeListeners.handleMoveBody=function(a){var o=Me(a);t.emit("moveBody",{event:o,preventSigmaDefault:function(){o.preventSigmaDefault()}})},this.activeListeners.handleLeave=function(a){var o=Me(a),s={event:o,preventSigmaDefault:function(){o.preventSigmaDefault()}};t.hoveredNode&&(t.emit("leaveNode",O(O({},s),{},{node:t.hoveredNode})),t.scheduleHighlightedNodesRender()),t.settings.enableEdgeEvents&&t.hoveredEdge&&(t.emit("leaveEdge",O(O({},s),{},{edge:t.hoveredEdge})),t.scheduleHighlightedNodesRender()),t.emit("leaveStage",O({},s))},this.activeListeners.handleEnter=function(a){var o=Me(a),s={event:o,preventSigmaDefault:function(){o.preventSigmaDefault()}};t.emit("enterStage",O({},s))};var i=function(o){return function(s){var u=Me(s),l={event:u,preventSigmaDefault:function(){u.preventSigmaDefault()}},c=t.getNodeAtPosition(u);if(c)return t.emit("".concat(o,"Node"),O(O({},l),{},{node:c}));if(t.settings.enableEdgeEvents){var f=t.getEdgeAtPoint(u.x,u.y);if(f)return t.emit("".concat(o,"Edge"),O(O({},l),{},{edge:f}))}return t.emit("".concat(o,"Stage"),l)}};return this.activeListeners.handleClick=i("click"),this.activeListeners.handleRightClick=i("rightClick"),this.activeListeners.handleDoubleClick=i("doubleClick"),this.activeListeners.handleWheel=i("wheel"),this.activeListeners.handleDown=i("down"),this.activeListeners.handleUp=i("up"),this.mouseCaptor.on("mousemove",this.activeListeners.handleMove),this.mouseCaptor.on("mousemovebody",this.activeListeners.handleMoveBody),this.mouseCaptor.on("click",this.activeListeners.handleClick),this.mouseCaptor.on("rightClick",this.activeListeners.handleRightClick),this.mouseCaptor.on("doubleClick",this.activeListeners.handleDoubleClick),this.mouseCaptor.on("wheel",this.activeListeners.handleWheel),this.mouseCaptor.on("mousedown",this.activeListeners.handleDown),this.mouseCaptor.on("mouseup",this.activeListeners.handleUp),this.mouseCaptor.on("mouseleave",this.activeListeners.handleLeave),this.mouseCaptor.on("mouseenter",this.activeListeners.handleEnter),this.touchCaptor.on("touchdown",this.activeListeners.handleDown),this.touchCaptor.on("touchdown",this.activeListeners.handleMove),this.touchCaptor.on("touchup",this.activeListeners.handleUp),this.touchCaptor.on("touchmove",this.activeListeners.handleMove),this.touchCaptor.on("tap",this.activeListeners.handleClick),this.touchCaptor.on("doubletap",this.activeListeners.handleDoubleClick),this.touchCaptor.on("touchmove",this.activeListeners.handleMoveBody),this}},{key:"bindGraphHandlers",value:function(){var t=this,i=this.graph,a=new Set(["x","y","zIndex","type"]);return this.activeListeners.eachNodeAttributesUpdatedGraphUpdate=function(o){var s,u=(s=o.hints)===null||s===void 0?void 0:s.attributes;t.graph.forEachNode(function(c){return t.updateNode(c)});var l=!u||u.some(function(c){return a.has(c)});t.refresh({partialGraph:{nodes:i.nodes()},skipIndexation:!l,schedule:!0})},this.activeListeners.eachEdgeAttributesUpdatedGraphUpdate=function(o){var s,u=(s=o.hints)===null||s===void 0?void 0:s.attributes;t.graph.forEachEdge(function(c){return t.updateEdge(c)});var l=u&&["zIndex","type"].some(function(c){return u?.includes(c)});t.refresh({partialGraph:{edges:i.edges()},skipIndexation:!l,schedule:!0})},this.activeListeners.addNodeGraphUpdate=function(o){var s=o.key;t.addNode(s),t.refresh({partialGraph:{nodes:[s]},skipIndexation:!1,schedule:!0})},this.activeListeners.updateNodeGraphUpdate=function(o){var s=o.key;t.refresh({partialGraph:{nodes:[s]},skipIndexation:!1,schedule:!0})},this.activeListeners.dropNodeGraphUpdate=function(o){var s=o.key;t.removeNode(s),t.refresh({schedule:!0})},this.activeListeners.addEdgeGraphUpdate=function(o){var s=o.key;t.addEdge(s),t.refresh({partialGraph:{edges:[s]},schedule:!0})},this.activeListeners.updateEdgeGraphUpdate=function(o){var s=o.key;t.refresh({partialGraph:{edges:[s]},skipIndexation:!1,schedule:!0})},this.activeListeners.dropEdgeGraphUpdate=function(o){var s=o.key;t.removeEdge(s),t.refresh({schedule:!0})},this.activeListeners.clearEdgesGraphUpdate=function(){t.clearEdgeState(),t.clearEdgeIndices(),t.refresh({schedule:!0})},this.activeListeners.clearGraphUpdate=function(){t.clearEdgeState(),t.clearNodeState(),t.clearEdgeIndices(),t.clearNodeIndices(),t.refresh({schedule:!0})},i.on("nodeAdded",this.activeListeners.addNodeGraphUpdate),i.on("nodeDropped",this.activeListeners.dropNodeGraphUpdate),i.on("nodeAttributesUpdated",this.activeListeners.updateNodeGraphUpdate),i.on("eachNodeAttributesUpdated",this.activeListeners.eachNodeAttributesUpdatedGraphUpdate),i.on("edgeAdded",this.activeListeners.addEdgeGraphUpdate),i.on("edgeDropped",this.activeListeners.dropEdgeGraphUpdate),i.on("edgeAttributesUpdated",this.activeListeners.updateEdgeGraphUpdate),i.on("eachEdgeAttributesUpdated",this.activeListeners.eachEdgeAttributesUpdatedGraphUpdate),i.on("edgesCleared",this.activeListeners.clearEdgesGraphUpdate),i.on("cleared",this.activeListeners.clearGraphUpdate),this}},{key:"unbindGraphHandlers",value:function(){var t=this.graph;t.removeListener("nodeAdded",this.activeListeners.addNodeGraphUpdate),t.removeListener("nodeDropped",this.activeListeners.dropNodeGraphUpdate),t.removeListener("nodeAttributesUpdated",this.activeListeners.updateNodeGraphUpdate),t.removeListener("eachNodeAttributesUpdated",this.activeListeners.eachNodeAttributesUpdatedGraphUpdate),t.removeListener("edgeAdded",this.activeListeners.addEdgeGraphUpdate),t.removeListener("edgeDropped",this.activeListeners.dropEdgeGraphUpdate),t.removeListener("edgeAttributesUpdated",this.activeListeners.updateEdgeGraphUpdate),t.removeListener("eachEdgeAttributesUpdated",this.activeListeners.eachEdgeAttributesUpdatedGraphUpdate),t.removeListener("edgesCleared",this.activeListeners.clearEdgesGraphUpdate),t.removeListener("cleared",this.activeListeners.clearGraphUpdate)}},{key:"getEdgeAtPoint",value:function(t,i){var a=Ke(this.webGLContexts.edges,this.frameBuffers.edges,t,i,this.pixelRatio,this.pickingDownSizingRatio),o=$e.apply(void 0,Sn(a)),s=this.itemIDsIndex[o];return s&&s.type==="edge"?s.id:null}},{key:"process",value:function(){var t=this;this.emit("beforeProcess");var i=this.graph,a=this.settings,o=this.getDimensions();if(this.nodeExtent=Wt(this.graph),!this.settings.autoRescale){var s=o.width,u=o.height,l=this.nodeExtent,c=l.x,f=l.y;this.nodeExtent={x:[(c[0]+c[1])/2-s/2,(c[0]+c[1])/2+s/2],y:[(f[0]+f[1])/2-u/2,(f[0]+f[1])/2+u/2]}}this.normalizationFunction=ft(this.customBBox||this.nodeExtent);var v=new Kt,g=ye(v.getState(),o,this.getGraphDimensions(),this.getStagePadding());this.labelGrid.resizeAndClear(o,a.labelGridCellSize);for(var _={},m={},E={},T={},b=1,p=i.nodes(),R=0,A=p.length;R<A;R++){var L=p[R],C=this.nodeDataCache[L],D=i.getNodeAttributes(L);C.x=D.x,C.y=D.y,this.normalizationFunction.applyTo(C),typeof C.label=="string"&&!C.hidden&&this.labelGrid.add(L,C.size,this.framedGraphToViewport(C,{matrix:g})),_[C.type]=(_[C.type]||0)+1}this.labelGrid.organize();for(var N in this.nodePrograms){if(!ue.call(this.nodePrograms,N))throw new Error('Sigma: could not find a suitable program for node type "'.concat(N,'"!'));this.nodePrograms[N].reallocate(_[N]||0),_[N]=0}this.settings.zIndex&&this.nodeZExtent[0]!==this.nodeZExtent[1]&&(p=ct(this.nodeZExtent,function(V){return t.nodeDataCache[V].zIndex},p));for(var F=0,G=p.length;F<G;F++){var z=p[F];m[z]=b,T[m[z]]={type:"node",id:z},b++;var H=this.nodeDataCache[z];this.addNodeToProgram(z,m[z],_[H.type]++)}for(var M={},j=i.edges(),h=0,d=j.length;h<d;h++){var y=j[h],S=this.edgeDataCache[y];M[S.type]=(M[S.type]||0)+1}this.settings.zIndex&&this.edgeZExtent[0]!==this.edgeZExtent[1]&&(j=ct(this.edgeZExtent,function(V){return t.edgeDataCache[V].zIndex},j));for(var w in this.edgePrograms){if(!ue.call(this.edgePrograms,w))throw new Error('Sigma: could not find a suitable program for edge type "'.concat(w,'"!'));this.edgePrograms[w].reallocate(M[w]||0),M[w]=0}for(var P=0,k=j.length;P<k;P++){var I=j[P];E[I]=b,T[E[I]]={type:"edge",id:I},b++;var U=this.edgeDataCache[I];this.addEdgeToProgram(I,E[I],M[U.type]++)}return this.itemIDsIndex=T,this.nodeIndices=m,this.edgeIndices=E,this.emit("afterProcess"),this}},{key:"handleSettingsUpdate",value:function(t){var i=this,a=this.settings;if(this.camera.minRatio=a.minCameraRatio,this.camera.maxRatio=a.maxCameraRatio,this.camera.enabledZooming=a.enableCameraZooming,this.camera.enabledPanning=a.enableCameraPanning,this.camera.enabledRotation=a.enableCameraRotation,a.cameraPanBoundaries?this.camera.clean=function(c){return i.cleanCameraState(c,a.cameraPanBoundaries&&ht(a.cameraPanBoundaries)==="object"?a.cameraPanBoundaries:{})}:this.camera.clean=null,this.camera.setState(this.camera.validateState(this.camera.getState())),t){if(t.edgeProgramClasses!==a.edgeProgramClasses){for(var o in a.edgeProgramClasses)a.edgeProgramClasses[o]!==t.edgeProgramClasses[o]&&this.registerEdgeProgram(o,a.edgeProgramClasses[o]);for(var s in t.edgeProgramClasses)a.edgeProgramClasses[s]||this.unregisterEdgeProgram(s)}if(t.nodeProgramClasses!==a.nodeProgramClasses||t.nodeHoverProgramClasses!==a.nodeHoverProgramClasses){for(var u in a.nodeProgramClasses)(a.nodeProgramClasses[u]!==t.nodeProgramClasses[u]||a.nodeHoverProgramClasses[u]!==t.nodeHoverProgramClasses[u])&&this.registerNodeProgram(u,a.nodeProgramClasses[u],a.nodeHoverProgramClasses[u]);for(var l in t.nodeProgramClasses)a.nodeProgramClasses[l]||this.unregisterNodeProgram(l)}}return this.mouseCaptor.setSettings(this.settings),this.touchCaptor.setSettings(this.settings),this}},{key:"cleanCameraState",value:function(t){var i=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},a=i.tolerance,o=a===void 0?0:a,s=i.boundaries,u=O({},t),l=s||this.nodeExtent,c=fe(l.x,2),f=c[0],v=c[1],g=fe(l.y,2),_=g[0],m=g[1],E=[this.graphToViewport({x:f,y:_},{cameraState:t}),this.graphToViewport({x:v,y:_},{cameraState:t}),this.graphToViewport({x:f,y:m},{cameraState:t}),this.graphToViewport({x:v,y:m},{cameraState:t})],T=1/0,b=-1/0,p=1/0,R=-1/0;E.forEach(function(M){var j=M.x,h=M.y;T=Math.min(T,j),b=Math.max(b,j),p=Math.min(p,h),R=Math.max(R,h)});var A=b-T,L=R-p,C=this.getDimensions(),D=C.width,N=C.height,F=0,G=0;if(A>=D?b<D-o?F=b-(D-o):T>o&&(F=T-o):b>D+o?F=b-(D+o):T<-o&&(F=T+o),L>=N?R<N-o?G=R-(N-o):p>o&&(G=p-o):R>N+o?G=R-(N+o):p<-o&&(G=p+o),F||G){var z=this.viewportToFramedGraph({x:0,y:0},{cameraState:t}),H=this.viewportToFramedGraph({x:F,y:G},{cameraState:t});F=H.x-z.x,G=H.y-z.y,u.x+=F,u.y+=G}return u}},{key:"renderLabels",value:function(){if(!this.settings.renderLabels)return this;var t=this.camera.getState(),i=this.labelGrid.getLabelsToDisplay(t.ratio,this.settings.labelDensity);qt(i,this.nodesWithForcedLabels),this.displayedNodeLabels=new Set;for(var a=this.canvasContexts.labels,o=0,s=i.length;o<s;o++){var u=i[o],l=this.nodeDataCache[u];if(!this.displayedNodeLabels.has(u)&&!l.hidden){var c=this.framedGraphToViewport(l),f=c.x,v=c.y,g=this.scaleSize(l.size);if(!(!l.forceLabel&&g<this.settings.labelRenderedSizeThreshold)&&!(f<-Pn||f>this.width+Pn||v<-On||v>this.height+On)){this.displayedNodeLabels.add(u);var _=this.settings.defaultDrawNodeLabel,m=this.nodePrograms[l.type],E=m?.drawLabel||_;E(a,O(O({key:u},l),{},{size:g,x:f,y:v}),this.settings)}}}return this}},{key:"renderEdgeLabels",value:function(){if(!this.settings.renderEdgeLabels)return this;var t=this.canvasContexts.edgeLabels;t.clearRect(0,0,this.width,this.height);var i=qa({graph:this.graph,hoveredNode:this.hoveredNode,displayedNodeLabels:this.displayedNodeLabels,highlightedNodes:this.highlightedNodes});qt(i,this.edgesWithForcedLabels);for(var a=new Set,o=0,s=i.length;o<s;o++){var u=i[o],l=this.graph.extremities(u),c=this.nodeDataCache[l[0]],f=this.nodeDataCache[l[1]],v=this.edgeDataCache[u];if(!a.has(u)&&!(v.hidden||c.hidden||f.hidden)){var g=this.settings.defaultDrawEdgeLabel,_=this.edgePrograms[v.type],m=_?.drawLabel||g;m(t,O(O({key:u},v),{},{size:this.scaleSize(v.size)}),O(O(O({key:l[0]},c),this.framedGraphToViewport(c)),{},{size:this.scaleSize(c.size)}),O(O(O({key:l[1]},f),this.framedGraphToViewport(f)),{},{size:this.scaleSize(f.size)}),this.settings),a.add(u)}}return this.displayedEdgeLabels=a,this}},{key:"renderHighlightedNodes",value:function(){var t=this,i=this.canvasContexts.hovers;i.clearRect(0,0,this.width,this.height);var a=function(g){var _=t.nodeDataCache[g],m=t.framedGraphToViewport(_),E=m.x,T=m.y,b=t.scaleSize(_.size),p=t.settings.defaultDrawNodeHover,R=t.nodePrograms[_.type],A=R?.drawHover||p;A(i,O(O({key:g},_),{},{size:b,x:E,y:T}),t.settings)},o=[];this.hoveredNode&&!this.nodeDataCache[this.hoveredNode].hidden&&o.push(this.hoveredNode),this.highlightedNodes.forEach(function(v){v!==t.hoveredNode&&o.push(v)}),o.forEach(function(v){return a(v)});var s={};o.forEach(function(v){var g=t.nodeDataCache[v].type;s[g]=(s[g]||0)+1});for(var u in this.nodeHoverPrograms)this.nodeHoverPrograms[u].reallocate(s[u]||0),s[u]=0;o.forEach(function(v){var g=t.nodeDataCache[v];t.nodeHoverPrograms[g.type].process(0,s[g.type]++,g)}),this.webGLContexts.hoverNodes.clear(this.webGLContexts.hoverNodes.COLOR_BUFFER_BIT);var l=this.getRenderParams();for(var c in this.nodeHoverPrograms){var f=this.nodeHoverPrograms[c];f.render(l)}}},{key:"scheduleHighlightedNodesRender",value:function(){var t=this;this.renderHighlightedNodesFrame||this.renderFrame||(this.renderHighlightedNodesFrame=requestAnimationFrame(function(){t.renderHighlightedNodesFrame=null,t.renderHighlightedNodes(),t.renderEdgeLabels()}))}},{key:"render",value:function(){var t=this;this.emit("beforeRender");var i=function(){return t.emit("afterRender"),t};if(this.renderFrame&&(cancelAnimationFrame(this.renderFrame),this.renderFrame=null),this.resize(),this.needToProcess&&this.process(),this.needToProcess=!1,this.clear(),this.pickingLayers.forEach(function(E){return t.resetWebGLTexture(E)}),!this.graph.order)return i();var a=this.mouseCaptor,o=this.camera.isAnimated()||a.isMoving||a.draggedEvents||a.currentWheelDirection,s=this.camera.getState(),u=this.getDimensions(),l=this.getGraphDimensions(),c=this.getStagePadding();this.matrix=ye(s,u,l,c),this.invMatrix=ye(s,u,l,c,!0),this.correctionRatio=Vt(this.matrix,s,u),this.graphToViewportRatio=this.getGraphToViewportRatio();var f=this.getRenderParams();for(var v in this.nodePrograms){var g=this.nodePrograms[v];g.render(f)}if(!this.settings.hideEdgesOnMove||!o)for(var _ in this.edgePrograms){var m=this.edgePrograms[_];m.render(f)}return this.settings.hideLabelsOnMove&&o||(this.renderLabels(),this.renderEdgeLabels(),this.renderHighlightedNodes()),i()}},{key:"addNode",value:function(t){var i=Object.assign({},this.graph.getNodeAttributes(t));this.settings.nodeReducer&&(i=this.settings.nodeReducer(t,i));var a=$a(this.settings,t,i);this.nodeDataCache[t]=a,this.nodesWithForcedLabels.delete(t),a.forceLabel&&!a.hidden&&this.nodesWithForcedLabels.add(t),this.highlightedNodes.delete(t),a.highlighted&&!a.hidden&&this.highlightedNodes.add(t),this.settings.zIndex&&(a.zIndex<this.nodeZExtent[0]&&(this.nodeZExtent[0]=a.zIndex),a.zIndex>this.nodeZExtent[1]&&(this.nodeZExtent[1]=a.zIndex))}},{key:"updateNode",value:function(t){this.addNode(t);var i=this.nodeDataCache[t];this.normalizationFunction.applyTo(i)}},{key:"removeNode",value:function(t){delete this.nodeDataCache[t],delete this.nodeProgramIndex[t],this.highlightedNodes.delete(t),this.hoveredNode===t&&(this.hoveredNode=null),this.nodesWithForcedLabels.delete(t)}},{key:"addEdge",value:function(t){var i=Object.assign({},this.graph.getEdgeAttributes(t));this.settings.edgeReducer&&(i=this.settings.edgeReducer(t,i));var a=Ka(this.settings,t,i);this.edgeDataCache[t]=a,this.edgesWithForcedLabels.delete(t),a.forceLabel&&!a.hidden&&this.edgesWithForcedLabels.add(t),this.settings.zIndex&&(a.zIndex<this.edgeZExtent[0]&&(this.edgeZExtent[0]=a.zIndex),a.zIndex>this.edgeZExtent[1]&&(this.edgeZExtent[1]=a.zIndex))}},{key:"updateEdge",value:function(t){this.addEdge(t)}},{key:"removeEdge",value:function(t){delete this.edgeDataCache[t],delete this.edgeProgramIndex[t],this.hoveredEdge===t&&(this.hoveredEdge=null),this.edgesWithForcedLabels.delete(t)}},{key:"clearNodeIndices",value:function(){this.labelGrid=new Ln,this.nodeExtent={x:[0,1],y:[0,1]},this.nodeDataCache={},this.edgeProgramIndex={},this.nodesWithForcedLabels=new Set,this.nodeZExtent=[1/0,-1/0],this.highlightedNodes=new Set}},{key:"clearEdgeIndices",value:function(){this.edgeDataCache={},this.edgeProgramIndex={},this.edgesWithForcedLabels=new Set,this.edgeZExtent=[1/0,-1/0]}},{key:"clearIndices",value:function(){this.clearEdgeIndices(),this.clearNodeIndices()}},{key:"clearNodeState",value:function(){this.displayedNodeLabels=new Set,this.highlightedNodes=new Set,this.hoveredNode=null}},{key:"clearEdgeState",value:function(){this.displayedEdgeLabels=new Set,this.highlightedNodes=new Set,this.hoveredEdge=null}},{key:"clearState",value:function(){this.clearEdgeState(),this.clearNodeState()}},{key:"addNodeToProgram",value:function(t,i,a){var o=this.nodeDataCache[t],s=this.nodePrograms[o.type];if(!s)throw new Error('Sigma: could not find a suitable program for node type "'.concat(o.type,'"!'));s.process(i,a,o),this.nodeProgramIndex[t]=a}},{key:"addEdgeToProgram",value:function(t,i,a){var o=this.edgeDataCache[t],s=this.edgePrograms[o.type];if(!s)throw new Error('Sigma: could not find a suitable program for edge type "'.concat(o.type,'"!'));var u=this.graph.extremities(t),l=this.nodeDataCache[u[0]],c=this.nodeDataCache[u[1]];s.process(i,a,l,c,o),this.edgeProgramIndex[t]=a}},{key:"getRenderParams",value:function(){return{matrix:this.matrix,invMatrix:this.invMatrix,width:this.width,height:this.height,pixelRatio:this.pixelRatio,zoomRatio:this.camera.ratio,cameraAngle:this.camera.angle,sizeRatio:1/this.scaleSize(),correctionRatio:this.correctionRatio,downSizingRatio:this.pickingDownSizingRatio,minEdgeThickness:this.settings.minEdgeThickness,antiAliasingFeather:this.settings.antiAliasingFeather}}},{key:"getStagePadding",value:function(){var t=this.settings,i=t.stagePadding,a=t.autoRescale;return a&&i||0}},{key:"createLayer",value:function(t,i){var a=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{};if(this.elements[t])throw new Error('Sigma: a layer named "'.concat(t,'" already exists'));var o=Yt(i,{position:"absolute"},{class:"sigma-".concat(t)});return a.style&&Object.assign(o.style,a.style),this.elements[t]=o,"beforeLayer"in a&&a.beforeLayer?this.elements[a.beforeLayer].before(o):"afterLayer"in a&&a.afterLayer?this.elements[a.afterLayer].after(o):this.container.appendChild(o),o}},{key:"createCanvas",value:function(t){var i=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};return this.createLayer(t,"canvas",i)}},{key:"createCanvasContext",value:function(t){var i=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},a=this.createCanvas(t,i),o={preserveDrawingBuffer:!1,antialias:!1};return this.canvasContexts[t]=a.getContext("2d",o),this}},{key:"createWebGLContext",value:function(t){var i=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},a=i?.canvas||this.createCanvas(t,i);i.hidden&&a.remove();var o=O({preserveDrawingBuffer:!1,antialias:!1},i),s;s=a.getContext("webgl2",o),s||(s=a.getContext("webgl",o)),s||(s=a.getContext("experimental-webgl",o));var u=s;if(this.webGLContexts[t]=u,u.blendFunc(u.ONE,u.ONE_MINUS_SRC_ALPHA),i.picking){this.pickingLayers.add(t);var l=u.createFramebuffer();if(!l)throw new Error("Sigma: cannot create a new frame buffer for layer ".concat(t));this.frameBuffers[t]=l}return u}},{key:"killLayer",value:function(t){var i=this.elements[t];if(!i)throw new Error("Sigma: cannot kill layer ".concat(t,", which does not exist"));if(this.webGLContexts[t]){var a,o=this.webGLContexts[t];(a=o.getExtension("WEBGL_lose_context"))===null||a===void 0||a.loseContext(),delete this.webGLContexts[t]}else this.canvasContexts[t]&&delete this.canvasContexts[t];return i.remove(),delete this.elements[t],this}},{key:"getCamera",value:function(){return this.camera}},{key:"setCamera",value:function(t){this.unbindCameraHandlers(),this.camera=t,this.bindCameraHandlers()}},{key:"getContainer",value:function(){return this.container}},{key:"getGraph",value:function(){return this.graph}},{key:"setGraph",value:function(t){t!==this.graph&&(this.hoveredNode&&!t.hasNode(this.hoveredNode)&&(this.hoveredNode=null),this.hoveredEdge&&!t.hasEdge(this.hoveredEdge)&&(this.hoveredEdge=null),this.unbindGraphHandlers(),this.checkEdgesEventsFrame!==null&&(cancelAnimationFrame(this.checkEdgesEventsFrame),this.checkEdgesEventsFrame=null),this.graph=t,this.bindGraphHandlers(),this.refresh())}},{key:"getMouseCaptor",value:function(){return this.mouseCaptor}},{key:"getTouchCaptor",value:function(){return this.touchCaptor}},{key:"getDimensions",value:function(){return{width:this.width,height:this.height}}},{key:"getGraphDimensions",value:function(){var t=this.customBBox||this.nodeExtent;return{width:t.x[1]-t.x[0]||1,height:t.y[1]-t.y[0]||1}}},{key:"getNodeDisplayData",value:function(t){var i=this.nodeDataCache[t];return i?Object.assign({},i):void 0}},{key:"getEdgeDisplayData",value:function(t){var i=this.edgeDataCache[t];return i?Object.assign({},i):void 0}},{key:"getNodeDisplayedLabels",value:function(){return new Set(this.displayedNodeLabels)}},{key:"getEdgeDisplayedLabels",value:function(){return new Set(this.displayedEdgeLabels)}},{key:"getSettings",value:function(){return O({},this.settings)}},{key:"getSetting",value:function(t){return this.settings[t]}},{key:"setSetting",value:function(t,i){var a=O({},this.settings);return this.settings[t]=i,gt(this.settings),this.handleSettingsUpdate(a),this.scheduleRefresh(),this}},{key:"updateSetting",value:function(t,i){return this.setSetting(t,i(this.settings[t])),this}},{key:"setSettings",value:function(t){var i=O({},this.settings);return this.settings=O(O({},this.settings),t),gt(this.settings),this.handleSettingsUpdate(i),this.scheduleRefresh(),this}},{key:"resize",value:function(t){var i=this.width,a=this.height;if(this.width=this.container.offsetWidth,this.height=this.container.offsetHeight,this.pixelRatio=lt(),this.width===0)if(this.settings.allowInvalidContainer)this.width=1;else throw new Error("Sigma: Container has no width. You can set the allowInvalidContainer setting to true to stop seeing this error.");if(this.height===0)if(this.settings.allowInvalidContainer)this.height=1;else throw new Error("Sigma: Container has no height. You can set the allowInvalidContainer setting to true to stop seeing this error.");if(!t&&i===this.width&&a===this.height)return this;for(var o in this.elements){var s=this.elements[o];s.style.width=this.width+"px",s.style.height=this.height+"px"}for(var u in this.canvasContexts)this.elements[u].setAttribute("width",this.width*this.pixelRatio+"px"),this.elements[u].setAttribute("height",this.height*this.pixelRatio+"px"),this.pixelRatio!==1&&this.canvasContexts[u].scale(this.pixelRatio,this.pixelRatio);for(var l in this.webGLContexts){this.elements[l].setAttribute("width",this.width*this.pixelRatio+"px"),this.elements[l].setAttribute("height",this.height*this.pixelRatio+"px");var c=this.webGLContexts[l];if(c.viewport(0,0,this.width*this.pixelRatio,this.height*this.pixelRatio),this.pickingLayers.has(l)){var f=this.textures[l];f&&c.deleteTexture(f)}}return this.emit("resize"),this}},{key:"clear",value:function(){return this.emit("beforeClear"),this.webGLContexts.nodes.bindFramebuffer(WebGLRenderingContext.FRAMEBUFFER,null),this.webGLContexts.nodes.clear(WebGLRenderingContext.COLOR_BUFFER_BIT),this.webGLContexts.edges.bindFramebuffer(WebGLRenderingContext.FRAMEBUFFER,null),this.webGLContexts.edges.clear(WebGLRenderingContext.COLOR_BUFFER_BIT),this.webGLContexts.hoverNodes.clear(WebGLRenderingContext.COLOR_BUFFER_BIT),this.canvasContexts.labels.clearRect(0,0,this.width,this.height),this.canvasContexts.hovers.clearRect(0,0,this.width,this.height),this.canvasContexts.edgeLabels.clearRect(0,0,this.width,this.height),this.emit("afterClear"),this}},{key:"refresh",value:function(t){var i=this,a=t?.skipIndexation!==void 0?t?.skipIndexation:!1,o=t?.schedule!==void 0?t.schedule:!1,s=!t||!t.partialGraph;if(s)this.clearEdgeIndices(),this.clearNodeIndices(),this.graph.forEachNode(function(R){return i.addNode(R)}),this.graph.forEachEdge(function(R){return i.addEdge(R)});else{for(var u,l,c=((u=t.partialGraph)===null||u===void 0?void 0:u.nodes)||[],f=0,v=c?.length||0;f<v;f++){var g=c[f];if(this.updateNode(g),a){var _=this.nodeProgramIndex[g];if(_===void 0)throw new Error('Sigma: node "'.concat(g,`" can't be repaint`));this.addNodeToProgram(g,this.nodeIndices[g],_)}}for(var m=(t==null||(l=t.partialGraph)===null||l===void 0?void 0:l.edges)||[],E=0,T=m.length;E<T;E++){var b=m[E];if(this.updateEdge(b),a){var p=this.edgeProgramIndex[b];if(p===void 0)throw new Error('Sigma: edge "'.concat(b,`" can't be repaint`));this.addEdgeToProgram(b,this.edgeIndices[b],p)}}}return(s||!a)&&(this.needToProcess=!0),o?this.scheduleRender():this.render(),this}},{key:"scheduleRender",value:function(){var t=this;return this.renderFrame||(this.renderFrame=requestAnimationFrame(function(){t.render()})),this}},{key:"scheduleRefresh",value:function(t){return this.refresh(O(O({},t),{},{schedule:!0}))}},{key:"getViewportZoomedState",value:function(t,i){var a=this.camera.getState(),o=a.ratio,s=a.angle,u=a.x,l=a.y,c=this.settings,f=c.minCameraRatio,v=c.maxCameraRatio;typeof v=="number"&&(i=Math.min(i,v)),typeof f=="number"&&(i=Math.max(i,f));var g=i/o,_={x:this.width/2,y:this.height/2},m=this.viewportToFramedGraph(t),E=this.viewportToFramedGraph(_);return{angle:s,x:(m.x-E.x)*(1-g)+u,y:(m.y-E.y)*(1-g)+l,ratio:i}}},{key:"viewRectangle",value:function(){var t=this.viewportToFramedGraph({x:0,y:0}),i=this.viewportToFramedGraph({x:this.width,y:0}),a=this.viewportToFramedGraph({x:0,y:this.height});return{x1:t.x,y1:t.y,x2:i.x,y2:i.y,height:i.y-a.y}}},{key:"framedGraphToViewport",value:function(t){var i=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},a=!!i.cameraState||!!i.viewportDimensions||!!i.graphDimensions,o=i.matrix?i.matrix:a?ye(i.cameraState||this.camera.getState(),i.viewportDimensions||this.getDimensions(),i.graphDimensions||this.getGraphDimensions(),i.padding||this.getStagePadding()):this.matrix,s=Ge(o,t);return{x:(1+s.x)*this.width/2,y:(1-s.y)*this.height/2}}},{key:"viewportToFramedGraph",value:function(t){var i=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},a=!!i.cameraState||!!i.viewportDimensions||!i.graphDimensions,o=i.matrix?i.matrix:a?ye(i.cameraState||this.camera.getState(),i.viewportDimensions||this.getDimensions(),i.graphDimensions||this.getGraphDimensions(),i.padding||this.getStagePadding(),!0):this.invMatrix,s=Ge(o,{x:t.x/this.width*2-1,y:1-t.y/this.height*2});return isNaN(s.x)&&(s.x=0),isNaN(s.y)&&(s.y=0),s}},{key:"viewportToGraph",value:function(t){var i=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};return this.normalizationFunction.inverse(this.viewportToFramedGraph(t,i))}},{key:"graphToViewport",value:function(t){var i=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};return this.framedGraphToViewport(this.normalizationFunction(t),i)}},{key:"getGraphToViewportRatio",value:function(){var t={x:0,y:0},i={x:1,y:1},a=Math.sqrt(Math.pow(t.x-i.x,2)+Math.pow(t.y-i.y,2)),o=this.graphToViewport(t),s=this.graphToViewport(i),u=Math.sqrt(Math.pow(o.x-s.x,2)+Math.pow(o.y-s.y,2));return u/a}},{key:"getBBox",value:function(){return this.nodeExtent}},{key:"getCustomBBox",value:function(){return this.customBBox}},{key:"setCustomBBox",value:function(t){return this.customBBox=t,this.scheduleRender(),this}},{key:"kill",value:function(){this.emit("kill"),this.removeAllListeners(),this.unbindCameraHandlers(),window.removeEventListener("resize",this.activeListeners.handleResize),this.mouseCaptor.kill(),this.touchCaptor.kill(),this.unbindGraphHandlers(),this.clearIndices(),this.clearState(),this.nodeDataCache={},this.edgeDataCache={},this.highlightedNodes.clear(),this.renderFrame&&(cancelAnimationFrame(this.renderFrame),this.renderFrame=null),this.renderHighlightedNodesFrame&&(cancelAnimationFrame(this.renderHighlightedNodesFrame),this.renderHighlightedNodesFrame=null);for(var t=this.container;t.firstChild;)t.removeChild(t.firstChild);for(var i in this.nodePrograms)this.nodePrograms[i].kill();for(var a in this.nodeHoverPrograms)this.nodeHoverPrograms[a].kill();for(var o in this.edgePrograms)this.edgePrograms[o].kill();this.nodePrograms={},this.nodeHoverPrograms={},this.edgePrograms={};for(var s in this.elements)this.killLayer(s);this.canvasContexts={},this.webGLContexts={},this.elements={}}},{key:"scaleSize",value:function(){var t=arguments.length>0&&arguments[0]!==void 0?arguments[0]:1,i=arguments.length>1&&arguments[1]!==void 0?arguments[1]:this.camera.ratio;return t/this.settings.zoomToSizeRatioFunction(i)*(this.getSetting("itemSizesReference")==="positions"?i*this.graphToViewportRatio:1)}},{key:"getCanvases",value:function(){var t={};for(var i in this.elements)this.elements[i]instanceof HTMLCanvasElement&&(t[i]=this.elements[i]);return t}}])})(at),In=Fn;var Gn=WebGLRenderingContext,Nu=Gn.UNSIGNED_BYTE,ku=Gn.FLOAT;var Za=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;
attribute float a_sourceRadius;
attribute float a_targetRadius;
attribute float a_sourceRadiusCoef;
attribute float a_targetRadiusCoef;

uniform mat3 u_matrix;
uniform float u_zoomRatio;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_lengthToThicknessRatio;
uniform float u_feather;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;

const float bias = 255.0 / 254.0;

void main() {
  float minThickness = u_minEdgeThickness;

  vec2 normal = a_normal * a_normalCoef;
  vec2 position = a_positionStart * (1.0 - a_positionCoef) + a_positionEnd * a_positionCoef;

  float normalLength = length(normal);
  vec2 unitNormal = normal / normalLength;

  // These first computations are taken from edge.vert.glsl. Please read it to
  // get better comments on what's happening:
  float pixelsThickness = max(normalLength, minThickness * u_sizeRatio);
  float webGLThickness = pixelsThickness * u_correctionRatio / u_sizeRatio;

  // Here, we move the point to leave space for the arrow heads:
  // Source arrow head
  float sourceRadius = a_sourceRadius * a_sourceRadiusCoef;
  float sourceDirection = sign(sourceRadius);
  float webGLSourceRadius = sourceDirection * sourceRadius * 2.0 * u_correctionRatio / u_sizeRatio;
  float webGLSourceArrowHeadLength = webGLThickness * u_lengthToThicknessRatio * 2.0;
  vec2 sourceCompensationVector =
    vec2(-sourceDirection * unitNormal.y, sourceDirection * unitNormal.x)
    * (webGLSourceRadius + webGLSourceArrowHeadLength);
    
  // Target arrow head
  float targetRadius = a_targetRadius * a_targetRadiusCoef;
  float targetDirection = sign(targetRadius);
  float webGLTargetRadius = targetDirection * targetRadius * 2.0 * u_correctionRatio / u_sizeRatio;
  float webGLTargetArrowHeadLength = webGLThickness * u_lengthToThicknessRatio * 2.0;
  vec2 targetCompensationVector =
  vec2(-targetDirection * unitNormal.y, targetDirection * unitNormal.x)
    * (webGLTargetRadius + webGLTargetArrowHeadLength);

  // Here is the proper position of the vertex
  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness + sourceCompensationVector + targetCompensationVector, 1)).xy, 0, 1);

  v_thickness = webGLThickness / u_zoomRatio;

  v_normal = unitNormal;

  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,Qa=Za,Mn=WebGLRenderingContext,zn=Mn.UNSIGNED_BYTE,le=Mn.FLOAT,Ja=["u_matrix","u_zoomRatio","u_sizeRatio","u_correctionRatio","u_pixelRatio","u_feather","u_minEdgeThickness","u_lengthToThicknessRatio"],eo={lengthToThicknessRatio:he.lengthToThicknessRatio};function Un(e){var r=O(O({},eo),e||{});return(function(n){function t(){return W(this,t),$(this,t,arguments)}return K(t,n),X(t,[{key:"getDefinition",value:function(){return{VERTICES:6,VERTEX_SHADER_SOURCE:Qa,FRAGMENT_SHADER_SOURCE:et,METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:Ja,ATTRIBUTES:[{name:"a_positionStart",size:2,type:le},{name:"a_positionEnd",size:2,type:le},{name:"a_normal",size:2,type:le},{name:"a_color",size:4,type:zn,normalized:!0},{name:"a_id",size:4,type:zn,normalized:!0},{name:"a_sourceRadius",size:1,type:le},{name:"a_targetRadius",size:1,type:le}],CONSTANT_ATTRIBUTES:[{name:"a_positionCoef",size:1,type:le},{name:"a_normalCoef",size:1,type:le},{name:"a_sourceRadiusCoef",size:1,type:le},{name:"a_targetRadiusCoef",size:1,type:le}],CONSTANT_DATA:[[0,1,-1,0],[0,-1,1,0],[1,1,0,1],[1,1,0,1],[0,-1,1,0],[1,-1,0,-1]]}}},{key:"processVisibleItem",value:function(a,o,s,u,l){var c=l.size||1,f=s.x,v=s.y,g=u.x,_=u.y,m=Y(l.color),E=g-f,T=_-v,b=s.size||1,p=u.size||1,R=E*E+T*T,A=0,L=0;R&&(R=1/Math.sqrt(R),A=-T*R*c,L=E*R*c);var C=this.array;C[o++]=f,C[o++]=v,C[o++]=g,C[o++]=_,C[o++]=A,C[o++]=L,C[o++]=m,C[o++]=a,C[o++]=b,C[o++]=p}},{key:"setUniforms",value:function(a,o){var s=o.gl,u=o.uniformLocations,l=u.u_matrix,c=u.u_zoomRatio,f=u.u_feather,v=u.u_pixelRatio,g=u.u_correctionRatio,_=u.u_sizeRatio,m=u.u_minEdgeThickness,E=u.u_lengthToThicknessRatio;s.uniformMatrix3fv(l,!1,a.matrix),s.uniform1f(c,a.zoomRatio),s.uniform1f(_,a.sizeRatio),s.uniform1f(g,a.correctionRatio),s.uniform1f(v,a.pixelRatio),s.uniform1f(f,a.antiAliasingFeather),s.uniform1f(m,a.minEdgeThickness),s.uniform1f(E,r.lengthToThicknessRatio)}}])})(ae)}var Du=Un();function to(e){return Ie([Un(e),Ce(e),Ce(O(O({},e),{},{extremity:"source"}))])}var Fu=to();var jn=WebGLRenderingContext,Iu=jn.UNSIGNED_BYTE,zu=jn.FLOAT;var Bn=WebGLRenderingContext,Gu=Bn.UNSIGNED_BYTE,Mu=Bn.FLOAT;var Hu=ve(ot());function Xn(e,r,n){return we(e,r,n)}function ro(e,r,n){var t=n.labelSize,i=n.labelFont,a=n.labelWeight;e.font="".concat(a," ").concat(t,"px ").concat(i),e.fillStyle="#FFF",e.shadowOffsetX=0,e.shadowOffsetY=0,e.shadowBlur=8,e.shadowColor="#000";var o=2;if(typeof r.label=="string"){var s=e.measureText(r.label).width,u=Math.round(s+5),l=Math.round(t+2*o),c=Math.max(r.size,t/2)+o;e.beginPath(),e.moveTo(r.x+c,r.y+l/2),e.lineTo(r.x+c+u,r.y+l/2),e.lineTo(r.x+c+u,r.y-l/2),e.lineTo(r.x+c,r.y-l/2),e.lineTo(r.x+c,r.y-c),e.lineTo(r.x-c,r.y-c),e.lineTo(r.x-c,r.y+c),e.lineTo(r.x+c,r.y+c),e.moveTo(r.x+c,r.y+l/2),e.closePath(),e.fill()}else{var f=r.size+o;e.fillRect(r.x-f,r.y-f,f*2,f*2)}e.shadowOffsetX=0,e.shadowOffsetY=0,e.shadowBlur=0,Xn(e,r,n)}function no(e,r){if(!(e instanceof r))throw new TypeError("Cannot call a class as a function")}function io(e,r){if(typeof e!="object"||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var t=n.call(e,r||"default");if(typeof t!="object")return t;throw new TypeError("@@toPrimitive must return a primitive value.")}return(r==="string"?String:Number)(e)}function Yn(e){var r=io(e,"string");return typeof r=="symbol"?r:r+""}function Hn(e,r){for(var n=0;n<r.length;n++){var t=r[n];t.enumerable=t.enumerable||!1,t.configurable=!0,"value"in t&&(t.writable=!0),Object.defineProperty(e,Yn(t.key),t)}}function ao(e,r,n){return r&&Hn(e.prototype,r),n&&Hn(e,n),Object.defineProperty(e,"prototype",{writable:!1}),e}function yt(e){return yt=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(r){return r.__proto__||Object.getPrototypeOf(r)},yt(e)}function qn(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],function(){}))}catch{}return(qn=function(){return!!e})()}function Qt(e){if(e===void 0)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e}function oo(e,r){if(r&&(typeof r=="object"||typeof r=="function"))return r;if(r!==void 0)throw new TypeError("Derived constructors may only return object or undefined");return Qt(e)}function so(e,r,n){return r=yt(r),oo(e,qn()?Reflect.construct(r,n||[],yt(e).constructor):r.apply(e,n))}function Jt(e,r){return Jt=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(n,t){return n.__proto__=t,n},Jt(e,r)}function uo(e,r){if(typeof r!="function"&&r!==null)throw new TypeError("Super expression must either be null or a function");e.prototype=Object.create(r&&r.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),r&&Jt(e,r)}function Vn(e,r,n){return(r=Yn(r))in e?Object.defineProperty(e,r,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[r]=n,e}var lo=`
precision mediump float;

varying vec4 v_color;

void main(void) {
  gl_FragColor = v_color;
}
`,co=lo,fo=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_cameraAngle;
uniform float u_correctionRatio;

varying vec4 v_color;

const float bias = 255.0 / 254.0;
const float sqrt_8 = sqrt(8.0);

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * sqrt_8;
  float angle = a_angle + u_cameraAngle; 
  vec2 diffVector = size * vec2(cos(angle), sin(angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4(
    (u_matrix * vec3(position, 1)).xy,
    0,
    1
  );

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,ho=fo,$n=WebGLRenderingContext,Wn=$n.UNSIGNED_BYTE,Zt=$n.FLOAT,vo=["u_sizeRatio","u_correctionRatio","u_cameraAngle","u_matrix"],Ae=Math.PI,go=(function(e){uo(r,e);function r(){var n;no(this,r);for(var t=arguments.length,i=new Array(t),a=0;a<t;a++)i[a]=arguments[a];return n=so(this,r,[].concat(i)),Vn(Qt(n),"drawHover",ro),Vn(Qt(n),"drawLabel",Xn),n}return ao(r,[{key:"getDefinition",value:function(){return{VERTICES:6,VERTEX_SHADER_SOURCE:ho,FRAGMENT_SHADER_SOURCE:co,METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:vo,ATTRIBUTES:[{name:"a_position",size:2,type:Zt},{name:"a_size",size:1,type:Zt},{name:"a_color",size:4,type:Wn,normalized:!0},{name:"a_id",size:4,type:Wn,normalized:!0}],CONSTANT_ATTRIBUTES:[{name:"a_angle",size:1,type:Zt}],CONSTANT_DATA:[[Ae/4],[3*Ae/4],[-Ae/4],[3*Ae/4],[-Ae/4],[-3*Ae/4]]}}},{key:"processVisibleItem",value:function(t,i,a){var o=this.array,s=Y(a.color);o[i++]=a.x,o[i++]=a.y,o[i++]=a.size,o[i++]=s,o[i++]=t}},{key:"setUniforms",value:function(t,i){var a=i.gl,o=i.uniformLocations,s=o.u_sizeRatio,u=o.u_correctionRatio,l=o.u_cameraAngle,c=o.u_matrix;a.uniform1f(s,t.sizeRatio),a.uniform1f(l,t.cameraAngle),a.uniform1f(u,t.correctionRatio),a.uniformMatrix3fv(c,!1,t.matrix)}}]),r})(re);function mo(e){if(Array.isArray(e))return e}function po(e,r){var n=e==null?null:typeof Symbol<"u"&&e[Symbol.iterator]||e["@@iterator"];if(n!=null){var t,i,a,o,s=[],u=!0,l=!1;try{if(a=(n=n.call(e)).next,r===0){if(Object(n)!==n)return;u=!1}else for(;!(u=(t=a.call(n)).done)&&(s.push(t.value),s.length!==r);u=!0);}catch(c){l=!0,i=c}finally{try{if(!u&&n.return!=null&&(o=n.return(),Object(o)!==o))return}finally{if(l)throw i}}return s}}function tr(e,r){(r==null||r>e.length)&&(r=e.length);for(var n=0,t=Array(r);n<r;n++)t[n]=e[n];return t}function ei(e,r){if(e){if(typeof e=="string")return tr(e,r);var n={}.toString.call(e).slice(8,-1);return n==="Object"&&e.constructor&&(n=e.constructor.name),n==="Map"||n==="Set"?Array.from(e):n==="Arguments"||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?tr(e,r):void 0}}function yo(){throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function _o(e,r){return mo(e)||po(e,r)||ei(e,r)||yo()}function bo(e,r){if(!(e instanceof r))throw new TypeError("Cannot call a class as a function")}function Eo(e,r){if(typeof e!="object"||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var t=n.call(e,r||"default");if(typeof t!="object")return t;throw new TypeError("@@toPrimitive must return a primitive value.")}return(r==="string"?String:Number)(e)}function ti(e){var r=Eo(e,"string");return typeof r=="symbol"?r:r+""}function Kn(e,r){for(var n=0;n<r.length;n++){var t=r[n];t.enumerable=t.enumerable||!1,t.configurable=!0,"value"in t&&(t.writable=!0),Object.defineProperty(e,ti(t.key),t)}}function To(e,r,n){return r&&Kn(e.prototype,r),n&&Kn(e,n),Object.defineProperty(e,"prototype",{writable:!1}),e}function bt(e){return bt=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(r){return r.__proto__||Object.getPrototypeOf(r)},bt(e)}function ri(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],function(){}))}catch{}return(ri=function(){return!!e})()}function rr(e){if(e===void 0)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e}function Ro(e,r){if(r&&(typeof r=="object"||typeof r=="function"))return r;if(r!==void 0)throw new TypeError("Derived constructors may only return object or undefined");return rr(e)}function wo(e,r,n){return r=bt(r),Ro(e,ri()?Reflect.construct(r,n||[],bt(e).constructor):r.apply(e,n))}function nr(e,r){return nr=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(n,t){return n.__proto__=t,n},nr(e,r)}function xo(e,r){if(typeof r!="function"&&r!==null)throw new TypeError("Super expression must either be null or a function");e.prototype=Object.create(r&&r.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),r&&nr(e,r)}function Le(e,r,n){return(r=ti(r))in e?Object.defineProperty(e,r,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[r]=n,e}function Co(e){if(Array.isArray(e))return tr(e)}function So(e){if(typeof Symbol<"u"&&e[Symbol.iterator]!=null||e["@@iterator"]!=null)return Array.from(e)}function Ao(){throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function er(e){return Co(e)||So(e)||ei(e)||Ao()}function Zn(e,r){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var t=Object.getOwnPropertySymbols(e);r&&(t=t.filter(function(i){return Object.getOwnPropertyDescriptor(e,i).enumerable})),n.push.apply(n,t)}return n}function Qn(e){for(var r=1;r<arguments.length;r++){var n=arguments[r]!=null?arguments[r]:{};r%2?Zn(Object(n),!0).forEach(function(t){Le(e,t,n[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):Zn(Object(n)).forEach(function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))})}return e}var Lo="relative",Po={drawLabel:void 0,drawHover:void 0,borders:[{size:{value:.1},color:{attribute:"borderColor"}},{size:{fill:!0},color:{attribute:"color"}}]},Oo="#000000";function No(e){var r=e.borders,n=Re(r.filter(function(i){var a=i.size;return"fill"in a}).length),t=`
precision highp float;

varying vec2 v_diffVector;
varying float v_radius;

#ifdef PICKING_MODE
varying vec4 v_color;
#else
// For normal mode, we use the border colors defined in the program:
`.concat(r.flatMap(function(i,a){var o=i.size;return"attribute"in o?["varying float v_borderSize_".concat(a+1,";")]:[]}).join(`
`),`
`).concat(r.flatMap(function(i,a){var o=i.color;return"attribute"in o?["varying vec4 v_borderColor_".concat(a+1,";")]:"value"in o?["uniform vec4 u_borderColor_".concat(a+1,";")]:[]}).join(`
`),`
#endif

uniform float u_correctionRatio;

const float bias = 255.0 / 254.0;
const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  float dist = length(v_diffVector);
  float aaBorder = 2.0 * u_correctionRatio;
  float v_borderSize_0 = v_radius;
  vec4 v_borderColor_0 = transparent;

  // No antialiasing for picking mode:
  #ifdef PICKING_MODE
  if (dist > v_radius)
    gl_FragColor = transparent;
  else {
    gl_FragColor = v_color;
    gl_FragColor.a *= bias;
  }
  #else
  // Sizes:
`).concat(r.flatMap(function(i,a){var o=i.size;if("fill"in o)return[];o=o;var s="attribute"in o?"v_borderSize_".concat(a+1):Re(o.value),u=(o.mode||Lo)==="pixels"?"u_correctionRatio":"v_radius";return["  float borderSize_".concat(a+1," = ").concat(u," * ").concat(s,";")]}).join(`
`),`
  // Now, let's split the remaining space between "fill" borders:
  float fillBorderSize = (v_radius - (`).concat(r.flatMap(function(i,a){var o=i.size;return"fill"in o?[]:["borderSize_".concat(a+1)]}).join(" + "),") ) / ").concat(n,`;
`).concat(r.flatMap(function(i,a){var o=i.size;return"fill"in o?["  float borderSize_".concat(a+1," = fillBorderSize;")]:[]}).join(`
`),`

  // Finally, normalize all border sizes, to start from the full size and to end with the smallest:
  float adjustedBorderSize_0 = v_radius;
`).concat(r.map(function(i,a){return"  float adjustedBorderSize_".concat(a+1," = adjustedBorderSize_").concat(a," - borderSize_").concat(a+1,";")}).join(`
`),`

  // Colors:
  vec4 borderColor_0 = transparent;
`).concat(r.map(function(i,a){var o=i.color,s=[];return"attribute"in o?s.push("  vec4 borderColor_".concat(a+1," = v_borderColor_").concat(a+1,";")):"transparent"in o?s.push("  vec4 borderColor_".concat(a+1," = vec4(0.0, 0.0, 0.0, 0.0);")):s.push("  vec4 borderColor_".concat(a+1," = u_borderColor_").concat(a+1,";")),s.push("  borderColor_".concat(a+1,".a *= bias;")),s.push("  if (borderSize_".concat(a+1," <= 1.0 * u_correctionRatio) { borderColor_").concat(a+1," = borderColor_").concat(a,"; }")),s.join(`
`)}).join(`
`),`
  if (dist > adjustedBorderSize_0) {
    gl_FragColor = borderColor_0;
  } else `).concat(r.map(function(i,a){return"if (dist > adjustedBorderSize_".concat(a,` - aaBorder) {
    gl_FragColor = mix(borderColor_`).concat(a+1,", borderColor_").concat(a,", (dist - adjustedBorderSize_").concat(a,` + aaBorder) / aaBorder);
  } else if (dist > adjustedBorderSize_`).concat(a+1,`) {
    gl_FragColor = borderColor_`).concat(a+1,`;
  } else `)}).join(""),` { /* Nothing to add here */ }
  #endif
}
`);return t}function ko(e){var r=e.borders,n=`
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec2 v_diffVector;
varying float v_radius;

#ifdef PICKING_MODE
attribute vec4 a_id;
varying vec4 v_color;
#else
`.concat(r.flatMap(function(t,i){var a=t.size;return"attribute"in a?["attribute float a_borderSize_".concat(i+1,";"),"varying float v_borderSize_".concat(i+1,";")]:[]}).join(`
`),`
`).concat(r.flatMap(function(t,i){var a=t.color;return"attribute"in a?["attribute vec4 a_borderColor_".concat(i+1,";"),"varying vec4 v_borderColor_".concat(i+1,";")]:[]}).join(`
`),`
#endif

const float bias = 255.0 / 254.0;
const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * 4.0;
  vec2 diffVector = size * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4(
    (u_matrix * vec3(position, 1)).xy,
    0,
    1
  );

  v_radius = size / 2.0;
  v_diffVector = diffVector;

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
`).concat(r.flatMap(function(t,i){var a=t.size;return"attribute"in a?["  v_borderSize_".concat(i+1," = a_borderSize_").concat(i+1,";")]:[]}).join(`
`),`
`).concat(r.flatMap(function(t,i){var a=t.color;return"attribute"in a?["  v_borderColor_".concat(i+1," = a_borderColor_").concat(i+1,";")]:[]}).join(`
`),`
  #endif
}
`);return n}var ni=WebGLRenderingContext,Jn=ni.UNSIGNED_BYTE,_t=ni.FLOAT;function ii(e){var r,n=Qn(Qn({},Po),e||{}),t=n.borders,i=n.drawLabel,a=n.drawHover,o=["u_sizeRatio","u_correctionRatio","u_matrix"].concat(er(t.flatMap(function(s,u){var l=s.color;return"value"in l?["u_borderColor_".concat(u+1)]:[]})));return r=(function(s){xo(u,s);function u(){var l;bo(this,u);for(var c=arguments.length,f=new Array(c),v=0;v<c;v++)f[v]=arguments[v];return l=wo(this,u,[].concat(f)),Le(rr(l),"drawLabel",i),Le(rr(l),"drawHover",a),l}return To(u,[{key:"getDefinition",value:function(){return{VERTICES:3,VERTEX_SHADER_SOURCE:ko(n),FRAGMENT_SHADER_SOURCE:No(n),METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:o,ATTRIBUTES:[{name:"a_position",size:2,type:_t},{name:"a_id",size:4,type:Jn,normalized:!0},{name:"a_size",size:1,type:_t}].concat(er(t.flatMap(function(c,f){var v=c.color;return"attribute"in v?[{name:"a_borderColor_".concat(f+1),size:4,type:Jn,normalized:!0}]:[]})),er(t.flatMap(function(c,f){var v=c.size;return"attribute"in v?[{name:"a_borderSize_".concat(f+1),size:1,type:_t}]:[]}))),CONSTANT_ATTRIBUTES:[{name:"a_angle",size:1,type:_t}],CONSTANT_DATA:[[u.ANGLE_1],[u.ANGLE_2],[u.ANGLE_3]]}}},{key:"processVisibleItem",value:function(c,f,v){var g=this.array;g[f++]=v.x,g[f++]=v.y,g[f++]=c,g[f++]=v.size,t.forEach(function(_){var m=_.color;"attribute"in m&&(g[f++]=Y(v[m.attribute]||m.defaultValue||Oo))}),t.forEach(function(_){var m=_.size;"attribute"in m&&(g[f++]=v[m.attribute]||m.defaultValue)})}},{key:"setUniforms",value:function(c,f){var v=f.gl,g=f.uniformLocations,_=g.u_sizeRatio,m=g.u_correctionRatio,E=g.u_matrix;v.uniform1f(m,c.correctionRatio),v.uniform1f(_,c.sizeRatio),v.uniformMatrix3fv(E,!1,c.matrix),t.forEach(function(T,b){var p=T.color;if("value"in p){var R=g["u_borderColor_".concat(b+1)],A=Te(p.value),L=_o(A,4),C=L[0],D=L[1],N=L[2],F=L[3];v.uniform4f(R,C/255,D/255,N/255,F/255)}})}}]),u})(re),Le(r,"ANGLE_1",0),Le(r,"ANGLE_2",2*Math.PI/3),Le(r,"ANGLE_3",4*Math.PI/3),r}var Qu=ii();function Do(e){if(Array.isArray(e))return e}function Fo(e,r){var n=e==null?null:typeof Symbol<"u"&&e[Symbol.iterator]||e["@@iterator"];if(n!=null){var t,i,a,o,s=[],u=!0,l=!1;try{if(a=(n=n.call(e)).next,r===0){if(Object(n)!==n)return;u=!1}else for(;!(u=(t=a.call(n)).done)&&(s.push(t.value),s.length!==r);u=!0);}catch(c){l=!0,i=c}finally{try{if(!u&&n.return!=null&&(o=n.return(),Object(o)!==o))return}finally{if(l)throw i}}return s}}function ir(e,r){(r==null||r>e.length)&&(r=e.length);for(var n=0,t=Array(r);n<r;n++)t[n]=e[n];return t}function ci(e,r){if(e){if(typeof e=="string")return ir(e,r);var n={}.toString.call(e).slice(8,-1);return n==="Object"&&e.constructor&&(n=e.constructor.name),n==="Map"||n==="Set"?Array.from(e):n==="Arguments"||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?ir(e,r):void 0}}function Io(){throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function ai(e,r){return Do(e)||Fo(e,r)||ci(e,r)||Io()}function zo(e,r){if(!(e instanceof r))throw new TypeError("Cannot call a class as a function")}function Go(e,r){if(typeof e!="object"||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var t=n.call(e,r||"default");if(typeof t!="object")return t;throw new TypeError("@@toPrimitive must return a primitive value.")}return(r==="string"?String:Number)(e)}function fi(e){var r=Go(e,"string");return typeof r=="symbol"?r:r+""}function oi(e,r){for(var n=0;n<r.length;n++){var t=r[n];t.enumerable=t.enumerable||!1,t.configurable=!0,"value"in t&&(t.writable=!0),Object.defineProperty(e,fi(t.key),t)}}function Mo(e,r,n){return r&&oi(e.prototype,r),n&&oi(e,n),Object.defineProperty(e,"prototype",{writable:!1}),e}function Oe(e){return Oe=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(r){return r.__proto__||Object.getPrototypeOf(r)},Oe(e)}function hi(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],function(){}))}catch{}return(hi=function(){return!!e})()}function Uo(e){if(e===void 0)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e}function jo(e,r){if(r&&(typeof r=="object"||typeof r=="function"))return r;if(r!==void 0)throw new TypeError("Derived constructors may only return object or undefined");return Uo(e)}function Bo(e,r,n){return r=Oe(r),jo(e,hi()?Reflect.construct(r,n||[],Oe(e).constructor):r.apply(e,n))}function Ho(e,r){for(;!{}.hasOwnProperty.call(e,r)&&(e=Oe(e))!==null;);return e}function ar(){return ar=typeof Reflect<"u"&&Reflect.get?Reflect.get.bind():function(e,r,n){var t=Ho(e,r);if(t){var i=Object.getOwnPropertyDescriptor(t,r);return i.get?i.get.call(arguments.length<3?e:n):i.value}},ar.apply(null,arguments)}function Vo(e,r,n,t){var i=ar(Oe(1&t?e.prototype:e),r,n);return 2&t&&typeof i=="function"?function(a){return i.apply(n,a)}:i}function or(e,r){return or=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(n,t){return n.__proto__=t,n},or(e,r)}function Wo(e,r){if(typeof r!="function"&&r!==null)throw new TypeError("Super expression must either be null or a function");e.prototype=Object.create(r&&r.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),r&&or(e,r)}function Pe(e,r,n){return(r=fi(r))in e?Object.defineProperty(e,r,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[r]=n,e}function Xo(e){if(Array.isArray(e))return ir(e)}function Yo(e){if(typeof Symbol<"u"&&e[Symbol.iterator]!=null||e["@@iterator"]!=null)return Array.from(e)}function qo(){throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function je(e){return Xo(e)||Yo(e)||ci(e)||qo()}function si(e,r){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var t=Object.getOwnPropertySymbols(e);r&&(t=t.filter(function(i){return Object.getOwnPropertyDescriptor(e,i).enumerable})),n.push.apply(n,t)}return n}function ui(e){for(var r=1;r<arguments.length;r++){var n=arguments[r]!=null?arguments[r]:{};r%2?si(Object(n),!0).forEach(function(t){Pe(e,t,n[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):si(Object(n)).forEach(function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))})}return e}function $o(e){var r=e.slices,n=e.offset,t=`
precision highp float;

varying vec2 v_diffVector;
varying float v_radius;

#ifdef PICKING_MODE
varying vec4 v_color;
#else
// For normal mode, we use the border colors defined in the program:
`.concat(r.flatMap(function(i,a){var o=i.value;return"attribute"in o?["varying float v_sliceValue_".concat(a+1,";")]:[]}).join(`
`),`
`).concat(r.map(function(i,a){var o=i.color;return"attribute"in o?"varying vec4 v_sliceColor_".concat(a+1,";"):"uniform vec4 u_sliceColor_".concat(a+1,";")}).join(`
`),`
#endif

uniform vec4 u_defaultColor;
uniform float u_cameraAngle;
uniform float u_correctionRatio;

`).concat("attribute"in n?`varying float v_offset;
`:"",`
`).concat("value"in n?`uniform float u_offset;
`:"",`

const float bias = 255.0 / 254.0;
const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  float aaBorder = u_correctionRatio * 2.0;;
  float dist = length(v_diffVector);
  float offset = `).concat("attribute"in n?"v_offset":"u_offset",`;
  float angle = atan(v_diffVector.y / v_diffVector.x);
  if (v_diffVector.x < 0.0 && v_diffVector.y < 0.0) angle += `).concat(Math.PI,`;
  else if (v_diffVector.x < 0.0) angle += `).concat(Math.PI,`;
  else if (v_diffVector.y < 0.0) angle += `).concat(2*Math.PI,`;
  angle = angle - u_cameraAngle + offset;
  angle = mod(angle, `).concat(2*Math.PI,`);

  // No antialiasing for picking mode:
  #ifdef PICKING_MODE
  if (dist > v_radius)
    gl_FragColor = transparent;
  else {
    gl_FragColor = v_color;
    gl_FragColor.a *= bias;
  }
  #else
  // Colors:
`).concat(r.map(function(i,a){var o=i.color,s=[];return"attribute"in o?s.push("  vec4 sliceColor_".concat(a+1," = v_sliceColor_").concat(a+1,";")):"transparent"in o?s.push("  vec4 sliceColor_".concat(a+1," = vec4(0.0, 0.0, 0.0, 0.0);")):s.push("  vec4 sliceColor_".concat(a+1," = u_sliceColor_").concat(a+1,";")),s.push("  sliceColor_".concat(a+1,".a *= bias;")),s.join(`
`)}).join(`
`),`
  vec4 color = u_defaultColor;
  color.a *= bias;

  // Sizes:
`).concat(r.map(function(i,a){var o=i.value;return"  float sliceValue_".concat(a+1," = ").concat("attribute"in o?"v_sliceValue_".concat(a+1):Re(o.value),";")}).join(`
`),`

  // Angles and final color:
  float total = `).concat(r.map(function(i,a){return"sliceValue_".concat(a+1)}).join(" + "),`;
  float angle_0 = 0.0;
  if (total > 0.0) {
`).concat(r.map(function(i,a){return"    float angle_".concat(a+1," = angle_").concat(a," + sliceValue_").concat(a+1," * ").concat(2*Math.PI," / total;")}).join(`
`),`
    `).concat(r.map(function(i,a){return"if (angle < angle_".concat(a+1,") color = sliceColor_").concat(a+1,";")}).join(`
    else `),`
  }

  if (dist < v_radius - aaBorder) {
    gl_FragColor = color;
  } else if (dist < v_radius) {
    gl_FragColor = mix(transparent, color, (v_radius - dist) / aaBorder);
  }
  #endif
}
`);return t}function Ko(e){var r=e.slices,n=e.offset,t=`
attribute vec4 a_id;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec2 v_diffVector;
varying float v_radius;

`.concat("attribute"in n?`attribute float a_offset;
`:"",`
`).concat("attribute"in n?`varying float v_offset;
`:"",`

#ifdef PICKING_MODE
varying vec4 v_color;
#else
`).concat(r.flatMap(function(i,a){var o=i.value;return"attribute"in o?["attribute float a_sliceValue_".concat(a+1,";"),"varying float v_sliceValue_".concat(a+1,";")]:[]}).join(`
`),`
`).concat(r.flatMap(function(i,a){var o=i.color;return"attribute"in o?["attribute vec4 a_sliceColor_".concat(a+1,";"),"varying vec4 v_sliceColor_".concat(a+1,";")]:[]}).join(`
`),`
#endif

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * 4.0;
  vec2 diffVector = size * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4(
    (u_matrix * vec3(position, 1)).xy,
    0,
    1
  );

  v_radius = size / 2.0;
  v_diffVector = diffVector;
  `).concat("attribute"in n?`v_offset = a_offset;
`:"",`

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
`).concat(r.flatMap(function(i,a){var o=i.value;return"attribute"in o?["  v_sliceValue_".concat(a+1," = a_sliceValue_").concat(a+1,";")]:[]}).join(`
`),`
`).concat(r.flatMap(function(i,a){var o=i.color;return"attribute"in o?["  v_sliceColor_".concat(a+1," = a_sliceColor_").concat(a+1,";")]:[]}).join(`
`),`
  #endif
}
`);return t}var sr="#000000",Zo={drawLabel:void 0,drawHover:void 0,defaultColor:sr,offset:{value:0}},di=WebGLRenderingContext,li=di.UNSIGNED_BYTE,Be=di.FLOAT;function Qo(e){var r,n=ui(ui({},Zo),e),t=n.slices,i=n.offset,a=n.drawHover,o=n.drawLabel,s=["u_sizeRatio","u_correctionRatio","u_cameraAngle","u_matrix","u_defaultColor"].concat(je("value"in i?["u_offset"]:[]),je(t.flatMap(function(u,l){var c=u.color;return"value"in c?["u_sliceColor_".concat(l+1)]:[]})));return r=(function(u){function l(){var c;zo(this,l);for(var f=arguments.length,v=new Array(f),g=0;g<f;g++)v[g]=arguments[g];return c=Bo(this,l,[].concat(v)),Pe(c,"drawLabel",o),Pe(c,"drawHover",a),c}return Wo(l,u),Mo(l,[{key:"getDefinition",value:function(){return{VERTICES:3,VERTEX_SHADER_SOURCE:Ko(n),FRAGMENT_SHADER_SOURCE:$o(n),METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:s,ATTRIBUTES:[{name:"a_position",size:2,type:Be},{name:"a_id",size:4,type:li,normalized:!0},{name:"a_size",size:1,type:Be}].concat(je("attribute"in i?[{name:"a_offset",size:1,type:Be}]:[]),je(t.flatMap(function(f,v){var g=f.color;return"attribute"in g?[{name:"a_sliceColor_".concat(v+1),size:4,type:li,normalized:!0}]:[]})),je(t.flatMap(function(f,v){var g=f.value;return"attribute"in g?[{name:"a_sliceValue_".concat(v+1),size:1,type:Be}]:[]}))),CONSTANT_ATTRIBUTES:[{name:"a_angle",size:1,type:Be}],CONSTANT_DATA:[[l.ANGLE_1],[l.ANGLE_2],[l.ANGLE_3]]}}},{key:"getProgramInfo",value:function(f,v,g,_,m){var E=4;"attribute"in i&&(E+=1),E+=t.reduce(function(b,p){var R=p.color,A=p.value;return"attribute"in R&&(b+=1),"attribute"in A&&(b+=1),b},0);var T=v.getParameter(v.MAX_VERTEX_ATTRIBS);if(E>T)throw new Error("createNodePiechartProgram: Too many slices. The node program requires ".concat(E," vertex attributes, but the current WebGL context only supports ").concat(T,". Please reduce the number of slices."));return Vo(l,"getProgramInfo",this,3)([f,v,g,_,m])}},{key:"processVisibleItem",value:function(f,v,g){var _=this.array;_[v++]=g.x,_[v++]=g.y,_[v++]=f,_[v++]=g.size,"attribute"in i&&(_[v++]=g[i.attribute]||0),t.forEach(function(m){var E=m.color;"attribute"in E&&(_[v++]=Y(g[E.attribute]||E.defaultValue||sr))}),t.forEach(function(m){var E=m.value;"attribute"in E&&(_[v++]=g[E.attribute]||0)})}},{key:"setUniforms",value:function(f,v){var g=v.gl,_=v.uniformLocations,m=_.u_sizeRatio,E=_.u_correctionRatio,T=_.u_cameraAngle,b=_.u_matrix,p=_.u_defaultColor;g.uniform1f(E,f.correctionRatio),g.uniform1f(m,f.sizeRatio),g.uniform1f(T,f.cameraAngle),g.uniformMatrix3fv(b,!1,f.matrix),"value"in i&&g.uniform1f(_.u_offset,i.value);var R=Te(n.defaultColor||sr),A=ai(R,4),L=A[0],C=A[1],D=A[2],N=A[3];g.uniform4f(p,L/255,C/255,D/255,N/255),t.forEach(function(F,G){var z=F.color;if("value"in z){var H=_["u_sliceColor_".concat(G+1)],M=Te(z.value),j=ai(M,4),h=j[0],d=j[1],y=j[2],S=j[3];g.uniform4f(H,h/255,d/255,y/255,S/255)}})}}])})(re),Pe(r,"ANGLE_1",0),Pe(r,"ANGLE_2",2*Math.PI/3),Pe(r,"ANGLE_3",4*Math.PI/3),r}var xi={};Lt(xi,{NodeImageProgram:()=>Es,NodePictogramProgram:()=>Ts,createNodeImageProgram:()=>_r});var _i=ve(it());function ur(e,r){(r==null||r>e.length)&&(r=e.length);for(var n=0,t=Array(r);n<r;n++)t[n]=e[n];return t}function Jo(e){if(Array.isArray(e))return ur(e)}function es(e){if(typeof Symbol<"u"&&e[Symbol.iterator]!=null||e["@@iterator"]!=null)return Array.from(e)}function ts(e,r){if(e){if(typeof e=="string")return ur(e,r);var n={}.toString.call(e).slice(8,-1);return n==="Object"&&e.constructor&&(n=e.constructor.name),n==="Map"||n==="Set"?Array.from(e):n==="Arguments"||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?ur(e,r):void 0}}function rs(){throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function vr(e){return Jo(e)||es(e)||ts(e)||rs()}function gr(e,r){if(!(e instanceof r))throw new TypeError("Cannot call a class as a function")}function ns(e,r){if(typeof e!="object"||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var t=n.call(e,r||"default");if(typeof t!="object")return t;throw new TypeError("@@toPrimitive must return a primitive value.")}return(r==="string"?String:Number)(e)}function bi(e){var r=ns(e,"string");return typeof r=="symbol"?r:r+""}function vi(e,r){for(var n=0;n<r.length;n++){var t=r[n];t.enumerable=t.enumerable||!1,t.configurable=!0,"value"in t&&(t.writable=!0),Object.defineProperty(e,bi(t.key),t)}}function mr(e,r,n){return r&&vi(e.prototype,r),n&&vi(e,n),Object.defineProperty(e,"prototype",{writable:!1}),e}function Ne(e){return Ne=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(r){return r.__proto__||Object.getPrototypeOf(r)},Ne(e)}function Ei(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],function(){}))}catch{}return(Ei=function(){return!!e})()}function ie(e){if(e===void 0)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e}function is(e,r){if(r&&(typeof r=="object"||typeof r=="function"))return r;if(r!==void 0)throw new TypeError("Derived constructors may only return object or undefined");return ie(e)}function Ti(e,r,n){return r=Ne(r),is(e,Ei()?Reflect.construct(r,n||[],Ne(e).constructor):r.apply(e,n))}function as(e,r){for(;!{}.hasOwnProperty.call(e,r)&&(e=Ne(e))!==null;);return e}function lr(){return lr=typeof Reflect<"u"&&Reflect.get?Reflect.get.bind():function(e,r,n){var t=as(e,r);if(t){var i=Object.getOwnPropertyDescriptor(t,r);return i.get?i.get.call(arguments.length<3?e:n):i.value}},lr.apply(null,arguments)}function gi(e,r,n,t){var i=lr(Ne(1&t?e.prototype:e),r,n);return 2&t&&typeof i=="function"?function(a){return i.apply(n,a)}:i}function cr(e,r){return cr=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(n,t){return n.__proto__=t,n},cr(e,r)}function Ri(e,r){if(typeof r!="function"&&r!==null)throw new TypeError("Super expression must either be null or a function");e.prototype=Object.create(r&&r.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),r&&cr(e,r)}function Z(e,r,n){return(r=bi(r))in e?Object.defineProperty(e,r,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[r]=n,e}function os(e,r){if(e==null)return{};var n={};for(var t in e)if({}.hasOwnProperty.call(e,t)){if(r.includes(t))continue;n[t]=e[t]}return n}function ss(e,r){if(e==null)return{};var n,t,i=os(e,r);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);for(t=0;t<a.length;t++)n=a[t],r.includes(n)||{}.propertyIsEnumerable.call(e,n)&&(i[n]=e[n])}return i}function mi(e,r){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var t=Object.getOwnPropertySymbols(e);r&&(t=t.filter(function(i){return Object.getOwnPropertyDescriptor(e,i).enumerable})),n.push.apply(n,t)}return n}function te(e){for(var r=1;r<arguments.length;r++){var n=arguments[r]!=null?arguments[r]:{};r%2?mi(Object(n),!0).forEach(function(t){Z(e,t,n[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):mi(Object(n)).forEach(function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))})}return e}function us(e){var r=e.texturesCount,n=`
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying vec4 v_texture;
varying float v_textureIndex;

uniform sampler2D u_atlas[`.concat(r,`];
uniform float u_correctionRatio;
uniform float u_cameraAngle;
uniform float u_percentagePadding;
uniform bool u_colorizeImages;
uniform bool u_keepWithinCircle;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

const float radius = 0.5;

void main(void) {
  float border = 2.0 * u_correctionRatio;
  float dist = length(v_diffVector);
  vec4 color = gl_FragColor;

  float c = cos(-u_cameraAngle);
  float s = sin(-u_cameraAngle);
  vec2 diffVector = mat2(c, s, -s, c) * (v_diffVector);

  // No antialiasing for picking mode:
  #ifdef PICKING_MODE
  border = 0.0;
  color = v_color;

  #else
  // First case: No image to display
  if (v_texture.w <= 0.0) {
    if (!u_colorizeImages) {
      color = v_color;
    }
  }

  // Second case: Image loaded into the texture
  else {
    float paddingRatio = 1.0 + 2.0 * u_percentagePadding;
    float coef = u_keepWithinCircle ? 1.0 : `).concat(Math.SQRT2,`;
    vec2 coordinateInTexture = diffVector * vec2(paddingRatio, -paddingRatio) / v_radius / 2.0 * coef + vec2(0.5, 0.5);
    int index = int(v_textureIndex + 0.5); // +0.5 avoid rounding errors

    bool noTextureFound = false;
    vec4 texel;

    `).concat(vr(new Array(r)).map(function(t,i){return"if (index == ".concat(i,") texel = texture2D(u_atlas[").concat(i,"], (v_texture.xy + coordinateInTexture * v_texture.zw), -1.0);")}).join(`
    else `)+`else {
      texel = texture2D(u_atlas[0], (v_texture.xy + coordinateInTexture * v_texture.zw), -1.0);
      noTextureFound = true;
    }`,`

    if (noTextureFound) {
      color = v_color;
    } else {
      // Colorize all visible image pixels:
      if (u_colorizeImages) {
        color = mix(gl_FragColor, v_color, texel.a);
      }

      // Colorize background pixels, keep image pixel colors:
      else {
        color = vec4(mix(v_color, texel, texel.a).rgb, max(texel.a, v_color.a));
      }

      // Erase pixels "in the padding":
      if (abs(diffVector.x) > v_radius / paddingRatio || abs(diffVector.y) > v_radius / paddingRatio) {
        color = u_colorizeImages ? gl_FragColor : v_color;
      }
    }
  }
  #endif

  // Crop in a circle when u_keepWithinCircle is truthy:
  if (u_keepWithinCircle) {
    if (dist < v_radius - border) {
      gl_FragColor = color;
    } else if (dist < v_radius) {
      gl_FragColor = mix(transparent, color, (v_radius - dist) / border);
    }
  }

  // Crop in a square else:
  else {
    float squareHalfSize = v_radius * `).concat(Math.SQRT1_2*Math.cos(Math.PI/12),`;
    if (abs(diffVector.x) > squareHalfSize || abs(diffVector.y) > squareHalfSize) {
      gl_FragColor = transparent;
    } else {
      gl_FragColor = color;
    }
  }
}
`);return n}var ls=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;
attribute vec4 a_texture;
attribute float a_textureIndex;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying vec4 v_texture;
varying float v_textureIndex;

const float bias = 255.0 / 254.0;
const float marginRatio = 1.05;

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * 4.0;
  vec2 diffVector = size * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector * marginRatio;
  gl_Position = vec4(
    (u_matrix * vec3(position, 1)).xy,
    0,
    1
  );

  v_diffVector = diffVector;
  v_radius = size / 2.0 / marginRatio;

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;

  // Pass the texture coordinates:
  v_textureIndex = a_textureIndex;
  v_texture = a_texture;
  #endif

  v_color.a *= bias;
}
`,cs=ls;function _e(){_e=function(){return r};var e,r={},n=Object.prototype,t=n.hasOwnProperty,i=Object.defineProperty||function(h,d,y){h[d]=y.value},a=typeof Symbol=="function"?Symbol:{},o=a.iterator||"@@iterator",s=a.asyncIterator||"@@asyncIterator",u=a.toStringTag||"@@toStringTag";function l(h,d,y){return Object.defineProperty(h,d,{value:y,enumerable:!0,configurable:!0,writable:!0}),h[d]}try{l({},"")}catch{l=function(d,y,S){return d[y]=S}}function c(h,d,y,S){var w=d&&d.prototype instanceof T?d:T,P=Object.create(w.prototype),k=new M(S||[]);return i(P,"_invoke",{value:F(h,y,k)}),P}function f(h,d,y){try{return{type:"normal",arg:h.call(d,y)}}catch(S){return{type:"throw",arg:S}}}r.wrap=c;var v="suspendedStart",g="suspendedYield",_="executing",m="completed",E={};function T(){}function b(){}function p(){}var R={};l(R,o,function(){return this});var A=Object.getPrototypeOf,L=A&&A(A(j([])));L&&L!==n&&t.call(L,o)&&(R=L);var C=p.prototype=T.prototype=Object.create(R);function D(h){["next","throw","return"].forEach(function(d){l(h,d,function(y){return this._invoke(d,y)})})}function N(h,d){function y(w,P,k,I){var U=f(h[w],h,P);if(U.type!=="throw"){var V=U.arg,Q=V.value;return Q&&typeof Q=="object"&&t.call(Q,"__await")?d.resolve(Q.__await).then(function(q){y("next",q,k,I)},function(q){y("throw",q,k,I)}):d.resolve(Q).then(function(q){V.value=q,k(V)},function(q){return y("throw",q,k,I)})}I(U.arg)}var S;i(this,"_invoke",{value:function(w,P){function k(){return new d(function(I,U){y(w,P,I,U)})}return S=S?S.then(k,k):k()}})}function F(h,d,y){var S=v;return function(w,P){if(S===_)throw Error("Generator is already running");if(S===m){if(w==="throw")throw P;return{value:e,done:!0}}for(y.method=w,y.arg=P;;){var k=y.delegate;if(k){var I=G(k,y);if(I){if(I===E)continue;return I}}if(y.method==="next")y.sent=y._sent=y.arg;else if(y.method==="throw"){if(S===v)throw S=m,y.arg;y.dispatchException(y.arg)}else y.method==="return"&&y.abrupt("return",y.arg);S=_;var U=f(h,d,y);if(U.type==="normal"){if(S=y.done?m:g,U.arg===E)continue;return{value:U.arg,done:y.done}}U.type==="throw"&&(S=m,y.method="throw",y.arg=U.arg)}}}function G(h,d){var y=d.method,S=h.iterator[y];if(S===e)return d.delegate=null,y==="throw"&&h.iterator.return&&(d.method="return",d.arg=e,G(h,d),d.method==="throw")||y!=="return"&&(d.method="throw",d.arg=new TypeError("The iterator does not provide a '"+y+"' method")),E;var w=f(S,h.iterator,d.arg);if(w.type==="throw")return d.method="throw",d.arg=w.arg,d.delegate=null,E;var P=w.arg;return P?P.done?(d[h.resultName]=P.value,d.next=h.nextLoc,d.method!=="return"&&(d.method="next",d.arg=e),d.delegate=null,E):P:(d.method="throw",d.arg=new TypeError("iterator result is not an object"),d.delegate=null,E)}function z(h){var d={tryLoc:h[0]};1 in h&&(d.catchLoc=h[1]),2 in h&&(d.finallyLoc=h[2],d.afterLoc=h[3]),this.tryEntries.push(d)}function H(h){var d=h.completion||{};d.type="normal",delete d.arg,h.completion=d}function M(h){this.tryEntries=[{tryLoc:"root"}],h.forEach(z,this),this.reset(!0)}function j(h){if(h||h===""){var d=h[o];if(d)return d.call(h);if(typeof h.next=="function")return h;if(!isNaN(h.length)){var y=-1,S=function w(){for(;++y<h.length;)if(t.call(h,y))return w.value=h[y],w.done=!1,w;return w.value=e,w.done=!0,w};return S.next=S}}throw new TypeError(typeof h+" is not iterable")}return b.prototype=p,i(C,"constructor",{value:p,configurable:!0}),i(p,"constructor",{value:b,configurable:!0}),b.displayName=l(p,u,"GeneratorFunction"),r.isGeneratorFunction=function(h){var d=typeof h=="function"&&h.constructor;return!!d&&(d===b||(d.displayName||d.name)==="GeneratorFunction")},r.mark=function(h){return Object.setPrototypeOf?Object.setPrototypeOf(h,p):(h.__proto__=p,l(h,u,"GeneratorFunction")),h.prototype=Object.create(C),h},r.awrap=function(h){return{__await:h}},D(N.prototype),l(N.prototype,s,function(){return this}),r.AsyncIterator=N,r.async=function(h,d,y,S,w){w===void 0&&(w=Promise);var P=new N(c(h,d,y,S),w);return r.isGeneratorFunction(d)?P:P.next().then(function(k){return k.done?k.value:P.next()})},D(C),l(C,u,"Generator"),l(C,o,function(){return this}),l(C,"toString",function(){return"[object Generator]"}),r.keys=function(h){var d=Object(h),y=[];for(var S in d)y.push(S);return y.reverse(),function w(){for(;y.length;){var P=y.pop();if(P in d)return w.value=P,w.done=!1,w}return w.done=!0,w}},r.values=j,M.prototype={constructor:M,reset:function(h){if(this.prev=0,this.next=0,this.sent=this._sent=e,this.done=!1,this.delegate=null,this.method="next",this.arg=e,this.tryEntries.forEach(H),!h)for(var d in this)d.charAt(0)==="t"&&t.call(this,d)&&!isNaN(+d.slice(1))&&(this[d]=e)},stop:function(){this.done=!0;var h=this.tryEntries[0].completion;if(h.type==="throw")throw h.arg;return this.rval},dispatchException:function(h){if(this.done)throw h;var d=this;function y(U,V){return P.type="throw",P.arg=h,d.next=U,V&&(d.method="next",d.arg=e),!!V}for(var S=this.tryEntries.length-1;S>=0;--S){var w=this.tryEntries[S],P=w.completion;if(w.tryLoc==="root")return y("end");if(w.tryLoc<=this.prev){var k=t.call(w,"catchLoc"),I=t.call(w,"finallyLoc");if(k&&I){if(this.prev<w.catchLoc)return y(w.catchLoc,!0);if(this.prev<w.finallyLoc)return y(w.finallyLoc)}else if(k){if(this.prev<w.catchLoc)return y(w.catchLoc,!0)}else{if(!I)throw Error("try statement without catch or finally");if(this.prev<w.finallyLoc)return y(w.finallyLoc)}}}},abrupt:function(h,d){for(var y=this.tryEntries.length-1;y>=0;--y){var S=this.tryEntries[y];if(S.tryLoc<=this.prev&&t.call(S,"finallyLoc")&&this.prev<S.finallyLoc){var w=S;break}}w&&(h==="break"||h==="continue")&&w.tryLoc<=d&&d<=w.finallyLoc&&(w=null);var P=w?w.completion:{};return P.type=h,P.arg=d,w?(this.method="next",this.next=w.finallyLoc,E):this.complete(P)},complete:function(h,d){if(h.type==="throw")throw h.arg;return h.type==="break"||h.type==="continue"?this.next=h.arg:h.type==="return"?(this.rval=this.arg=h.arg,this.method="return",this.next="end"):h.type==="normal"&&d&&(this.next=d),E},finish:function(h){for(var d=this.tryEntries.length-1;d>=0;--d){var y=this.tryEntries[d];if(y.finallyLoc===h)return this.complete(y.completion,y.afterLoc),H(y),E}},catch:function(h){for(var d=this.tryEntries.length-1;d>=0;--d){var y=this.tryEntries[d];if(y.tryLoc===h){var S=y.completion;if(S.type==="throw"){var w=S.arg;H(y)}return w}}throw Error("illegal catch attempt")},delegateYield:function(h,d,y){return this.delegate={iterator:j(h),resultName:d,nextLoc:y},this.method==="next"&&(this.arg=e),E}},r}function pi(e,r,n,t,i,a,o){try{var s=e[a](o),u=s.value}catch(l){return void n(l)}s.done?r(u):Promise.resolve(u).then(t,i)}function pr(e){return function(){var r=this,n=arguments;return new Promise(function(t,i){var a=e.apply(r,n);function o(u){pi(a,t,i,o,s,"next",u)}function s(u){pi(a,t,i,o,s,"throw",u)}o(void 0)})}}var yr={size:{mode:"max",value:512},objectFit:"cover",correctCentering:!1,maxTextureSize:4096,debounceTimeout:500,crossOrigin:"anonymous"},fs=1;function fr(e){var r=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},n=r.crossOrigin;return new Promise(function(t,i){var a=new Image;a.addEventListener("load",function(){t(a)},{once:!0}),a.addEventListener("error",function(o){i(o.error)},{once:!0}),n&&a.setAttribute("crossOrigin",n),a.src=e})}function hs(e){return hr.apply(this,arguments)}function hr(){return hr=pr(_e().mark(function e(r){var n,t,i,a,o,s,u,l,c,f,v,g,_,m=arguments;return _e().wrap(function(T){for(;;)switch(T.prev=T.next){case 0:if(n=m.length>1&&m[1]!==void 0?m[1]:{},t=n.size,i=n.crossOrigin,i!=="use-credentials"){T.next=7;break}return T.next=4,fetch(r,{credentials:"include"});case 4:a=T.sent,T.next=10;break;case 7:return T.next=9,fetch(r);case 9:a=T.sent;case 10:return T.next=12,a.text();case 12:if(o=T.sent,s=new DOMParser().parseFromString(o,"image/svg+xml"),u=s.documentElement,l=u.getAttribute("width"),c=u.getAttribute("height"),!(!l||!c)){T.next=19;break}throw new Error("loadSVGImage: cannot use `size` if target SVG has no definite dimensions.");case 19:return typeof t=="number"&&(u.setAttribute("width",""+t),u.setAttribute("height",""+t)),f=new XMLSerializer().serializeToString(s),v=new Blob([f],{type:"image/svg+xml"}),g=URL.createObjectURL(v),_=fr(g),_.finally(function(){return URL.revokeObjectURL(g)}),T.abrupt("return",_);case 26:case"end":return T.stop()}},e)})),hr.apply(this,arguments)}function ds(e){return dr.apply(this,arguments)}function dr(){return dr=pr(_e().mark(function e(r){var n,t,i,a,o,s,u=arguments;return _e().wrap(function(c){for(;;)switch(c.prev=c.next){case 0:if(t=u.length>1&&u[1]!==void 0?u[1]:{},i=t.size,a=t.crossOrigin,o=((n=r.split(/[#?]/)[0].split(".").pop())===null||n===void 0?void 0:n.trim().toLowerCase())==="svg",!(o&&i)){c.next=16;break}return c.prev=3,c.next=6,hs(r,{size:i,crossOrigin:a});case 6:s=c.sent,c.next=14;break;case 9:return c.prev=9,c.t0=c.catch(3),c.next=13,fr(r,{crossOrigin:a});case 13:s=c.sent;case 14:c.next=19;break;case 16:return c.next=18,fr(r,{crossOrigin:a});case 18:s=c.sent;case 19:return c.abrupt("return",s);case 20:case"end":return c.stop()}},e,null,[[3,9]])})),dr.apply(this,arguments)}function vs(e,r,n){var t=n.objectFit,i=n.size,a=n.correctCentering,o=t==="contain"?Math.max(e.width,e.height):Math.min(e.width,e.height),s=i.mode==="auto"?o:i.mode==="force"?i.value:Math.min(i.value,o),u=(e.width-o)/2,l=(e.height-o)/2;if(a){var c=r.getCorrectionOffset(e,o);u=c.x,l=c.y}return{sourceX:u,sourceY:l,sourceSize:o,destinationSize:s}}function gs(e,r,n){for(var t=r.canvas,i=t.width,a=t.height,o=[],s=n.x,u=n.y,l=n.rowHeight,c=n.maxRowWidth,f={},v=0,g=e.length;v<g;v++){var _=e[v],m=_.key,E=_.image,T=_.sourceSize,b=_.sourceX,p=_.sourceY,R=_.destinationSize,A=R+fs;u+A>a||s+A>i&&u+A+l>a||(s+A>i&&(c=Math.max(c,s),s=0,u+=l,l=A),o.push({key:m,image:E,sourceX:b,sourceY:p,sourceSize:T,destinationX:s,destinationY:u,destinationSize:R}),f[m]={x:s,y:u,size:R},s+=A,l=Math.max(l,A))}c=Math.max(c,s);for(var L=c,C=u+l,D=0,N=o.length;D<N;D++){var F=o[D],G=F.image,z=F.sourceSize,H=F.sourceX,M=F.sourceY,j=F.destinationSize,h=F.destinationX,d=F.destinationY;r.drawImage(G,H,M,z,z,h,d,j,j)}return{atlas:f,texture:r.getImageData(0,0,L,C),cursor:{x:s,y:u,rowHeight:l,maxRowWidth:c}}}function ms(e,r,n){var t=e.atlas,i=e.textures,a=e.cursor,o={atlas:te({},t),textures:vr(i.slice(0,-1)),cursor:te({},a)},s=[];for(var u in r){var l,c=r[u];if(c.status==="ready"){var f=(l=t[u])===null||l===void 0?void 0:l.textureIndex;typeof f!="number"&&s.push(te({key:u},c))}}for(var v=function(){var _=gs(s,n,o.cursor),m=_.atlas,E=_.texture,T=_.cursor;o.cursor=T;var b=[];s.forEach(function(p){m[p.key]?o.atlas[p.key]=te(te({},m[p.key]),{},{textureIndex:o.textures.length}):b.push(p)}),o.textures.push(E),s=b,s.length&&(o.cursor={x:0,y:0,rowHeight:0,maxRowWidth:0},n.clearRect(0,0,n.canvas.width,n.canvas.height))};s.length;)v();return o}var ps=(function(){function e(){gr(this,e),this.canvas=document.createElement("canvas"),this.context=this.canvas.getContext("2d",{willReadFrequently:!0})}return mr(e,[{key:"getCorrectionOffset",value:function(n,t){this.canvas.width=t,this.canvas.height=t,this.context.clearRect(0,0,t,t),this.context.drawImage(n,0,0,t,t);for(var i=this.context.getImageData(0,0,t,t).data,a=new Uint8ClampedArray(i.length/4),o=0;o<i.length;o++)a[o]=i[o*4+3];for(var s=0,u=0,l=0,c=0;c<t;c++)for(var f=0;f<t;f++){var v=a[c*t+f];l+=v,s+=v*f,u+=v*c}var g=s/l,_=u/l;return{x:g-t/2,y:_-t/2}}}]),e})(),Et=(function(e){Ri(r,e);function r(){var n,t=arguments.length>0&&arguments[0]!==void 0?arguments[0]:{};return gr(this,r),n=Ti(this,r),Z(ie(n),"canvas",document.createElement("canvas")),Z(ie(n),"ctx",n.canvas.getContext("2d",{willReadFrequently:!0})),Z(ie(n),"corrector",new ps),Z(ie(n),"imageStates",{}),Z(ie(n),"textures",[n.ctx.getImageData(0,0,1,1)]),Z(ie(n),"lastTextureCursor",{x:0,y:0,rowHeight:0,maxRowWidth:0}),Z(ie(n),"atlas",{}),n.options=te(te({},yr),t),n.canvas.width=n.options.maxTextureSize,n.canvas.height=n.options.maxTextureSize,n}return mr(r,[{key:"scheduleGenerateTexture",value:function(){var t=this;typeof this.frameId!="number"&&(typeof this.options.debounceTimeout=="number"?this.frameId=window.setTimeout(function(){t.generateTextures(),t.frameId=void 0},this.options.debounceTimeout):this.generateTextures())}},{key:"generateTextures",value:function(){var t=ms({atlas:this.atlas,textures:this.textures,cursor:this.lastTextureCursor},this.imageStates,this.ctx),i=t.atlas,a=t.textures,o=t.cursor;this.atlas=i,this.textures=a,this.lastTextureCursor=o,this.emit(r.NEW_TEXTURE_EVENT,{atlas:i,textures:a})}},{key:"registerImage",value:(function(){var n=pr(_e().mark(function i(a){var o,s;return _e().wrap(function(l){for(;;)switch(l.prev=l.next){case 0:if(!this.imageStates[a]){l.next=2;break}return l.abrupt("return");case 2:return this.imageStates[a]={status:"loading"},l.prev=3,o=this.options.size,l.next=7,ds(a,{size:o.mode==="force"?o.value:void 0,crossOrigin:this.options.crossOrigin||void 0});case 7:s=l.sent,this.imageStates[a]=te({status:"ready",image:s},vs(s,this.corrector,this.options)),this.scheduleGenerateTexture(),l.next=15;break;case 12:l.prev=12,l.t0=l.catch(3),this.imageStates[a]={status:"error"};case 15:case"end":return l.stop()}},i,this,[[3,12]])}));function t(i){return n.apply(this,arguments)}return t})()},{key:"getAtlas",value:function(){return this.atlas}},{key:"getTextures",value:function(){return this.textures}}]),r})(_i.EventEmitter);Z(Et,"NEW_TEXTURE_EVENT","newTexture");var ys=["drawHover","drawLabel","drawingMode","keepWithinCircle","padding","colorAttribute","imageAttribute"],wi=WebGLRenderingContext,yi=wi.UNSIGNED_BYTE,He=wi.FLOAT,_s=te(te({},yr),{},{drawingMode:"background",keepWithinCircle:!0,drawLabel:void 0,drawHover:void 0,padding:0,colorAttribute:"color",imageAttribute:"image"}),bs=["u_sizeRatio","u_correctionRatio","u_cameraAngle","u_percentagePadding","u_matrix","u_colorizeImages","u_keepWithinCircle","u_atlas"];function _r(e){var r,n=document.createElement("canvas").getContext("webgl"),t=Math.min(n.getParameter(n.MAX_TEXTURE_SIZE),yr.maxTextureSize);n.canvas.remove();var i=te(te(te({},_s),{maxTextureSize:t}),e||{}),a=i.drawHover,o=i.drawLabel,s=i.drawingMode,u=i.keepWithinCircle,l=i.padding,c=i.colorAttribute,f=i.imageAttribute,v=ss(i,ys),g=new Et(v);return r=(function(_){Ri(m,_);function m(E,T,b){var p;return gr(this,m),p=Ti(this,m,[E,T,b]),Z(ie(p),"drawLabel",o),Z(ie(p),"drawHover",a),Z(ie(p),"textureManagerCallback",null),p.textureManagerCallback=function(R){var A=R.atlas,L=R.textures,C=L.length!==p.textures.length;p.atlas=A,p.textureImages=L,C&&p.upgradeShaders(),p.bindTextures(),p.latestRenderParams&&p.render(p.latestRenderParams),p.renderer&&p.renderer.refresh&&p.renderer.refresh()},g.on(Et.NEW_TEXTURE_EVENT,p.textureManagerCallback),p.atlas=g.getAtlas(),p.textureImages=g.getTextures(),p.textures=p.textureImages.map(function(){return E.createTexture()}),p.bindTextures(),p}return mr(m,[{key:"getDefinition",value:function(){return{VERTICES:3,VERTEX_SHADER_SOURCE:cs,FRAGMENT_SHADER_SOURCE:us({texturesCount:g.getTextures().length}),METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:bs,ATTRIBUTES:[{name:"a_position",size:2,type:He},{name:"a_size",size:1,type:He},{name:"a_color",size:4,type:yi,normalized:!0},{name:"a_id",size:4,type:yi,normalized:!0},{name:"a_texture",size:4,type:He},{name:"a_textureIndex",size:1,type:He}],CONSTANT_ATTRIBUTES:[{name:"a_angle",size:1,type:He}],CONSTANT_DATA:[[m.ANGLE_1],[m.ANGLE_2],[m.ANGLE_3]]}}},{key:"upgradeShaders",value:function(){var T=this.getDefinition(),b=this.normalProgram,p=b.program,R=b.buffer,A=b.vertexShader,L=b.fragmentShader,C=b.gl;C.deleteProgram(p),C.deleteBuffer(R),C.deleteShader(A),C.deleteShader(L),this.normalProgram=this.getProgramInfo("normal",C,T.VERTEX_SHADER_SOURCE,T.FRAGMENT_SHADER_SOURCE,null)}},{key:"kill",value:function(){var T,b=(T=this.normalProgram)===null||T===void 0?void 0:T.gl;if(b)for(var p=0;p<this.textures.length;p++)b.deleteTexture(this.textures[p]);this.textureManagerCallback&&(g.off(Et.NEW_TEXTURE_EVENT,this.textureManagerCallback),this.textureManagerCallback=null),gi(m,"kill",this,3)([])}},{key:"bindTextures",value:function(){for(var T=this.normalProgram.gl,b=0;b<this.textureImages.length;b++){if(b>=this.textures.length){var p=T.createTexture();p&&this.textures.push(p)}T.activeTexture(T.TEXTURE0+b),T.bindTexture(T.TEXTURE_2D,this.textures[b]),T.texImage2D(T.TEXTURE_2D,0,T.RGBA,T.RGBA,T.UNSIGNED_BYTE,this.textureImages[b]),T.generateMipmap(T.TEXTURE_2D)}}},{key:"renderProgram",value:function(T,b){if(!b.isPicking)for(var p=b.gl,R=0;R<this.textureImages.length;R++)p.activeTexture(p.TEXTURE0+R),p.bindTexture(p.TEXTURE_2D,this.textures[R]);gi(m,"renderProgram",this,3)([T,b])}},{key:"processVisibleItem",value:function(T,b,p){var R=this.array,A=Y(p[c]),L=p[f],C=L?this.atlas[L]:void 0;if(typeof L=="string"&&!C&&g.registerImage(L),R[b++]=p.x,R[b++]=p.y,R[b++]=p.size,R[b++]=A,R[b++]=T,C&&typeof C.textureIndex=="number"){var D=this.textureImages[C.textureIndex],N=D.width,F=D.height;R[b++]=C.x/N,R[b++]=C.y/F,R[b++]=C.size/N,R[b++]=C.size/F,R[b++]=C.textureIndex}else R[b++]=0,R[b++]=0,R[b++]=0,R[b++]=0,R[b++]=0}},{key:"setUniforms",value:function(T,b){var p=b.gl,R=b.uniformLocations,A=R.u_sizeRatio,L=R.u_correctionRatio,C=R.u_matrix,D=R.u_atlas,N=R.u_colorizeImages,F=R.u_keepWithinCircle,G=R.u_cameraAngle,z=R.u_percentagePadding;this.latestRenderParams=T,p.uniform1f(L,T.correctionRatio),p.uniform1f(A,u?T.sizeRatio:T.sizeRatio/Math.SQRT2),p.uniform1f(G,T.cameraAngle),p.uniform1f(z,l),p.uniformMatrix3fv(C,!1,T.matrix),p.uniform1iv(D,vr(new Array(this.textureImages.length)).map(function(H,M){return M})),p.uniform1i(N,s==="color"?1:0),p.uniform1i(F,u?1:0)}}]),m})(re),Z(r,"ANGLE_1",0),Z(r,"ANGLE_2",2*Math.PI/3),Z(r,"ANGLE_3",4*Math.PI/3),Z(r,"textureManager",g),r}var Es=_r(),Ts=_r({keepWithinCircle:!1,size:{mode:"force",value:256},drawingMode:"color",correctCentering:!0});var Gi={};Lt(Gi,{DEFAULT_EDGE_CURVATURE:()=>Rr,DEFAULT_EDGE_CURVE_PROGRAM_OPTIONS:()=>Fi,DEFAULT_INDEX_PARALLEL_EDGES_OPTIONS:()=>Ii,EdgeCurvedArrowProgram:()=>Gs,EdgeCurvedDoubleArrowProgram:()=>Ms,createDrawCurvedEdgeLabel:()=>Di,createEdgeCurveProgram:()=>Rt,default:()=>zs,indexParallelEdgesIndex:()=>Is});function Rs(e,r){if(typeof e!="object"||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var t=n.call(e,r||"default");if(typeof t!="object")return t;throw new TypeError("@@toPrimitive must return a primitive value.")}return(r==="string"?String:Number)(e)}function Li(e){var r=Rs(e,"string");return typeof r=="symbol"?r:r+""}function Pi(e,r,n){return(r=Li(r))in e?Object.defineProperty(e,r,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[r]=n,e}function Ci(e,r){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var t=Object.getOwnPropertySymbols(e);r&&(t=t.filter(function(i){return Object.getOwnPropertyDescriptor(e,i).enumerable})),n.push.apply(n,t)}return n}function ke(e){for(var r=1;r<arguments.length;r++){var n=arguments[r]!=null?arguments[r]:{};r%2?Ci(Object(n),!0).forEach(function(t){Pi(e,t,n[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):Ci(Object(n)).forEach(function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))})}return e}function ws(e,r){if(!(e instanceof r))throw new TypeError("Cannot call a class as a function")}function Si(e,r){for(var n=0;n<r.length;n++){var t=r[n];t.enumerable=t.enumerable||!1,t.configurable=!0,"value"in t&&(t.writable=!0),Object.defineProperty(e,Li(t.key),t)}}function xs(e,r,n){return r&&Si(e.prototype,r),n&&Si(e,n),Object.defineProperty(e,"prototype",{writable:!1}),e}function Tt(e){return Tt=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(r){return r.__proto__||Object.getPrototypeOf(r)},Tt(e)}function Oi(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],function(){}))}catch{}return(Oi=function(){return!!e})()}function Ni(e){if(e===void 0)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e}function Cs(e,r){if(r&&(typeof r=="object"||typeof r=="function"))return r;if(r!==void 0)throw new TypeError("Derived constructors may only return object or undefined");return Ni(e)}function Ss(e,r,n){return r=Tt(r),Cs(e,Oi()?Reflect.construct(r,n||[],Tt(e).constructor):r.apply(e,n))}function Er(e,r){return Er=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(n,t){return n.__proto__=t,n},Er(e,r)}function As(e,r){if(typeof r!="function"&&r!==null)throw new TypeError("Super expression must either be null or a function");e.prototype=Object.create(r&&r.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),r&&Er(e,r)}function Tr(e,r){(r==null||r>e.length)&&(r=e.length);for(var n=0,t=Array(r);n<r;n++)t[n]=e[n];return t}function Ls(e){if(Array.isArray(e))return Tr(e)}function Ps(e){if(typeof Symbol<"u"&&e[Symbol.iterator]!=null||e["@@iterator"]!=null)return Array.from(e)}function Os(e,r){if(e){if(typeof e=="string")return Tr(e,r);var n={}.toString.call(e).slice(8,-1);return n==="Object"&&e.constructor&&(n=e.constructor.name),n==="Map"||n==="Set"?Array.from(e):n==="Arguments"||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?Tr(e,r):void 0}}function Ns(){throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function br(e){return Ls(e)||Ps(e)||Os(e)||Ns()}function ki(e,r,n,t){var i=Math.pow(1-e,2)*r.x+2*(1-e)*e*n.x+Math.pow(e,2)*t.x,a=Math.pow(1-e,2)*r.y+2*(1-e)*e*n.y+Math.pow(e,2)*t.y;return{x:i,y:a}}function ks(e,r,n){for(var t=20,i=0,a=e,o=0;o<t;o++){var s=ki((o+1)/t,e,r,n);i+=Math.sqrt(Math.pow(a.x-s.x,2)+Math.pow(a.y-s.y,2)),a=s}return i}function Di(e){var r=e.curvatureAttribute,n=e.defaultCurvature,t=e.keepLabelUpright,i=t===void 0?!0:t;return function(a,o,s,u,l){var c=l.edgeLabelSize,f=o[r]||n,v=l.edgeLabelFont,g=l.edgeLabelWeight,_=l.edgeLabelColor.attribute?o[l.edgeLabelColor.attribute]||l.edgeLabelColor.color||"#000":l.edgeLabelColor.color,m=o.label;if(m){a.fillStyle=_,a.font="".concat(g," ").concat(c,"px ").concat(v);var E=!i||s.x<u.x,T=E?s.x:u.x,b=E?s.y:u.y,p=E?u.x:s.x,R=E?u.y:s.y,A=(T+p)/2,L=(b+R)/2,C=p-T,D=R-b,N=Math.sqrt(Math.pow(C,2)+Math.pow(D,2)),F=E?1:-1,G=A+D*f*F,z=L-C*f*F,H=o.size*.7+5,M={x:z-b,y:-(G-T)},j=Math.sqrt(Math.pow(M.x,2)+Math.pow(M.y,2)),h={x:R-z,y:-(p-G)},d=Math.sqrt(Math.pow(h.x,2)+Math.pow(h.y,2));T+=H*M.x/j,b+=H*M.y/j,p+=H*h.x/d,R+=H*h.y/d,G+=H*D/N,z-=H*C/N;var y={x:G,y:z},S={x:T,y:b},w={x:p,y:R},P=ks(S,y,w);if(!(P<s.size+u.size)){var k=a.measureText(m).width,I=P-s.size-u.size;if(k>I){var U="\u2026";for(m=m+U,k=a.measureText(m).width;k>I&&m.length>1;)m=m.slice(0,-2)+U,k=a.measureText(m).width;if(m.length<4)return}for(var V={},Q=0,q=m.length;Q<q;Q++){var xt=m[Q];V[xt]||(V[xt]=a.measureText(xt).width*(1+f*.35))}for(var be=.5-k/P/2,Ct=0,Wi=m.length;Ct<Wi;Ct++){var Nr=m[Ct],kr=ki(be,S,y,w),Xi=2*(1-be)*(G-T)+2*be*(p-G),Yi=2*(1-be)*(z-b)+2*be*(R-z),qi=Math.atan2(Yi,Xi);a.save(),a.translate(kr.x,kr.y),a.rotate(qi),a.fillText(Nr,0,0),a.restore(),be+=V[Nr]/P}}}}}function Ds(e){var r=e.arrowHead,n=r?.extremity==="target"||r?.extremity==="both",t=r?.extremity==="source"||r?.extremity==="both",i=`
precision highp float;

varying vec4 v_color;
varying float v_thickness;
varying float v_feather;
varying vec2 v_cpA;
varying vec2 v_cpB;
varying vec2 v_cpC;
`.concat(n?`
varying float v_targetSize;
varying vec2 v_targetPoint;`:"",`
`).concat(t?`
varying float v_sourceSize;
varying vec2 v_sourcePoint;`:"",`
`).concat(r?`
uniform float u_lengthToThicknessRatio;
uniform float u_widenessToThicknessRatio;`:"",`

float det(vec2 a, vec2 b) {
  return a.x * b.y - b.x * a.y;
}

vec2 getDistanceVector(vec2 b0, vec2 b1, vec2 b2) {
  float a = det(b0, b2), b = 2.0 * det(b1, b0), d = 2.0 * det(b2, b1);
  float f = b * d - a * a;
  vec2 d21 = b2 - b1, d10 = b1 - b0, d20 = b2 - b0;
  vec2 gf = 2.0 * (b * d21 + d * d10 + a * d20);
  gf = vec2(gf.y, -gf.x);
  vec2 pp = -f * gf / dot(gf, gf);
  vec2 d0p = b0 - pp;
  float ap = det(d0p, d20), bp = 2.0 * det(d10, d0p);
  float t = clamp((ap + bp) / (2.0 * a + b + d), 0.0, 1.0);
  return mix(mix(b0, b1, t), mix(b1, b2, t), t);
}

float distToQuadraticBezierCurve(vec2 p, vec2 b0, vec2 b1, vec2 b2) {
  return length(getDistanceVector(b0 - p, b1 - p, b2 - p));
}

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  float dist = distToQuadraticBezierCurve(gl_FragCoord.xy, v_cpA, v_cpB, v_cpC);
  float thickness = v_thickness;
`).concat(n?`
  float distToTarget = length(gl_FragCoord.xy - v_targetPoint);
  float targetArrowLength = v_targetSize + thickness * u_lengthToThicknessRatio;
  if (distToTarget < targetArrowLength) {
    thickness = (distToTarget - v_targetSize) / (targetArrowLength - v_targetSize) * u_widenessToThicknessRatio * thickness;
  }`:"",`
`).concat(t?`
  float distToSource = length(gl_FragCoord.xy - v_sourcePoint);
  float sourceArrowLength = v_sourceSize + thickness * u_lengthToThicknessRatio;
  if (distToSource < sourceArrowLength) {
    thickness = (distToSource - v_sourceSize) / (sourceArrowLength - v_sourceSize) * u_widenessToThicknessRatio * thickness;
  }`:"",`

  float halfThickness = thickness / 2.0;
  if (dist < halfThickness) {
    #ifdef PICKING_MODE
    gl_FragColor = v_color;
    #else
    float t = smoothstep(
      halfThickness - v_feather,
      halfThickness,
      dist
    );

    gl_FragColor = mix(v_color, transparent, t);
    #endif
  } else {
    gl_FragColor = transparent;
  }
}
`);return i}function Fs(e){var r=e.arrowHead,n=r?.extremity==="target"||r?.extremity==="both",t=r?.extremity==="source"||r?.extremity==="both",i=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute float a_direction;
attribute float a_thickness;
attribute vec2 a_source;
attribute vec2 a_target;
attribute float a_current;
attribute float a_curvature;
`.concat(n?`attribute float a_targetSize;
`:"",`
`).concat(t?`attribute float a_sourceSize;
`:"",`

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform vec2 u_dimensions;
uniform float u_minEdgeThickness;
uniform float u_feather;

varying vec4 v_color;
varying float v_thickness;
varying float v_feather;
varying vec2 v_cpA;
varying vec2 v_cpB;
varying vec2 v_cpC;
`).concat(n?`
varying float v_targetSize;
varying vec2 v_targetPoint;`:"",`
`).concat(t?`
varying float v_sourceSize;
varying vec2 v_sourcePoint;`:"",`
`).concat(r?`
uniform float u_widenessToThicknessRatio;`:"",`

const float bias = 255.0 / 254.0;
const float epsilon = 0.7;

vec2 clipspaceToViewport(vec2 pos, vec2 dimensions) {
  return vec2(
    (pos.x + 1.0) * dimensions.x / 2.0,
    (pos.y + 1.0) * dimensions.y / 2.0
  );
}

vec2 viewportToClipspace(vec2 pos, vec2 dimensions) {
  return vec2(
    pos.x / dimensions.x * 2.0 - 1.0,
    pos.y / dimensions.y * 2.0 - 1.0
  );
}

void main() {
  float minThickness = u_minEdgeThickness;

  // Selecting the correct position
  // Branchless "position = a_source if a_current == 1.0 else a_target"
  vec2 position = a_source * max(0.0, a_current) + a_target * max(0.0, 1.0 - a_current);
  position = (u_matrix * vec3(position, 1)).xy;

  vec2 source = (u_matrix * vec3(a_source, 1)).xy;
  vec2 target = (u_matrix * vec3(a_target, 1)).xy;

  vec2 viewportPosition = clipspaceToViewport(position, u_dimensions);
  vec2 viewportSource = clipspaceToViewport(source, u_dimensions);
  vec2 viewportTarget = clipspaceToViewport(target, u_dimensions);

  vec2 delta = viewportTarget.xy - viewportSource.xy;
  float len = length(delta);
  vec2 normal = vec2(-delta.y, delta.x) * a_direction;
  vec2 unitNormal = normal / len;
  float boundingBoxThickness = len * a_curvature;

  float curveThickness = max(minThickness, a_thickness / u_sizeRatio);
  v_thickness = curveThickness * u_pixelRatio;
  v_feather = u_feather;

  v_cpA = viewportSource;
  v_cpB = 0.5 * (viewportSource + viewportTarget) + unitNormal * a_direction * boundingBoxThickness;
  v_cpC = viewportTarget;

  vec2 viewportOffsetPosition = (
    viewportPosition +
    unitNormal * (boundingBoxThickness / 2.0 + sign(boundingBoxThickness) * (`).concat(r?"curveThickness * u_widenessToThicknessRatio":"curveThickness",` + epsilon)) *
    max(0.0, a_direction) // NOTE: cutting the bounding box in half to avoid overdraw
  );

  position = viewportToClipspace(viewportOffsetPosition, u_dimensions);
  gl_Position = vec4(position, 0, 1);
    
`).concat(n?`
  v_targetSize = a_targetSize * u_pixelRatio / u_sizeRatio;
  v_targetPoint = viewportTarget;
`:"",`
`).concat(t?`
  v_sourceSize = a_sourceSize * u_pixelRatio / u_sizeRatio;
  v_sourcePoint = viewportSource;
`:"",`

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`);return i}var Rr=.25,Fi={arrowHead:null,curvatureAttribute:"curvature",defaultCurvature:Rr},Ii={edgeIndexAttribute:"parallelIndex",edgeMinIndexAttribute:"parallelMinIndex",edgeMaxIndexAttribute:"parallelMaxIndex"};function Is(e,r){var n=ke(ke({},Ii),r||{}),t={},i={},a={},o=0;e.forEachNode(function(L){t[L]=++o+""}),e.forEachEdge(function(L,C,D,N){var F=t[D],G=t[N],z=[F,G].join("-");i[L]=z,a[z]=[F,G].sort().join("-")});var s={},u={};e.forEachEdge(function(L){var C=i[L],D=a[C];s[C]=s[C]||[],s[C].push(L),u[D]=u[D]||[],u[D].push(L)});for(var l in s){var c=s[l],f=c.length,v=u[a[l]].length;if(f===1&&v===1){var g=c[0];e.setEdgeAttribute(g,n.edgeIndexAttribute,null),e.setEdgeAttribute(g,n.edgeMaxIndexAttribute,null)}else if(f===1){var _=c[0];e.setEdgeAttribute(_,n.edgeIndexAttribute,1),e.setEdgeAttribute(_,n.edgeMaxIndexAttribute,1)}else if(f===v)for(var m=(f-1)/2,E=-m,T=0;T<f;T++){var b=c[T],p=-(f-1)/2+T;e.setEdgeAttribute(b,n.edgeIndexAttribute,p),e.setEdgeAttribute(b,n.edgeMinIndexAttribute,E),e.setEdgeAttribute(b,n.edgeMaxIndexAttribute,m)}else for(var R=0;R<f;R++){var A=c[R];e.setEdgeAttribute(A,n.edgeIndexAttribute,R+1),e.setEdgeAttribute(A,n.edgeMaxIndexAttribute,f)}}}var zi=WebGLRenderingContext,Ai=zi.UNSIGNED_BYTE,de=zi.FLOAT;function Rt(e){var r=ke(ke({},Fi),e||{}),n=r,t=n.arrowHead,i=n.curvatureAttribute,a=n.drawLabel,o=t?.extremity==="target"||t?.extremity==="both",s=t?.extremity==="source"||t?.extremity==="both",u=["u_matrix","u_sizeRatio","u_dimensions","u_pixelRatio","u_feather","u_minEdgeThickness"].concat(br(t?["u_lengthToThicknessRatio","u_widenessToThicknessRatio"]:[]));return(function(l){As(c,l);function c(){var f;ws(this,c);for(var v=arguments.length,g=new Array(v),_=0;_<v;_++)g[_]=arguments[_];return f=Ss(this,c,[].concat(g)),Pi(Ni(f),"drawLabel",a||Di(r)),f}return xs(c,[{key:"getDefinition",value:function(){return{VERTICES:6,VERTEX_SHADER_SOURCE:Fs(r),FRAGMENT_SHADER_SOURCE:Ds(r),METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:u,ATTRIBUTES:[{name:"a_source",size:2,type:de},{name:"a_target",size:2,type:de}].concat(br(o?[{name:"a_targetSize",size:1,type:de}]:[]),br(s?[{name:"a_sourceSize",size:1,type:de}]:[]),[{name:"a_thickness",size:1,type:de},{name:"a_curvature",size:1,type:de},{name:"a_color",size:4,type:Ai,normalized:!0},{name:"a_id",size:4,type:Ai,normalized:!0}]),CONSTANT_ATTRIBUTES:[{name:"a_current",size:1,type:de},{name:"a_direction",size:1,type:de}],CONSTANT_DATA:[[0,1],[0,-1],[1,1],[0,-1],[1,1],[1,-1]]}}},{key:"processVisibleItem",value:function(v,g,_,m,E){var T,b=E.size||1,p=_.x,R=_.y,A=m.x,L=m.y,C=Y(E.color),D=(T=E[i])!==null&&T!==void 0?T:Rr,N=this.array;N[g++]=p,N[g++]=R,N[g++]=A,N[g++]=L,o&&(N[g++]=m.size),s&&(N[g++]=_.size),N[g++]=b,N[g++]=D,N[g++]=C,N[g++]=v}},{key:"setUniforms",value:function(v,g){var _=g.gl,m=g.uniformLocations,E=m.u_matrix,T=m.u_pixelRatio,b=m.u_feather,p=m.u_sizeRatio,R=m.u_dimensions,A=m.u_minEdgeThickness;if(_.uniformMatrix3fv(E,!1,v.matrix),_.uniform1f(T,v.pixelRatio),_.uniform1f(p,v.sizeRatio),_.uniform1f(b,v.antiAliasingFeather),_.uniform2f(R,v.width*v.pixelRatio,v.height*v.pixelRatio),_.uniform1f(A,v.minEdgeThickness),t){var L=m.u_lengthToThicknessRatio,C=m.u_widenessToThicknessRatio;_.uniform1f(L,t.lengthToThicknessRatio),_.uniform1f(C,t.widenessToThicknessRatio)}}}]),c})(ae)}var zs=Rt(),Gs=Rt({arrowHead:he}),Ms=Rt({arrowHead:ke(ke({},he),{},{extremity:"both"})});var Vi={};Lt(Vi,{DEFAULT_TO_IMAGE_OPTIONS:()=>Ve,downloadAsImage:()=>Or,downloadAsJPEG:()=>qs,downloadAsPNG:()=>Ys,drawOnCanvas:()=>Hi,toBlob:()=>Pr,toFile:()=>Xs});var Bi=ve(Mi()),Ve={layers:null,width:null,height:null,fileName:"graph",format:"png",sigmaSettings:{},cameraState:null,backgroundColor:"transparent",withTempRenderer:null};function ce(){ce=function(){return r};var e,r={},n=Object.prototype,t=n.hasOwnProperty,i=Object.defineProperty||function(h,d,y){h[d]=y.value},a=typeof Symbol=="function"?Symbol:{},o=a.iterator||"@@iterator",s=a.asyncIterator||"@@asyncIterator",u=a.toStringTag||"@@toStringTag";function l(h,d,y){return Object.defineProperty(h,d,{value:y,enumerable:!0,configurable:!0,writable:!0}),h[d]}try{l({},"")}catch{l=function(d,y,S){return d[y]=S}}function c(h,d,y,S){var w=d&&d.prototype instanceof T?d:T,P=Object.create(w.prototype),k=new M(S||[]);return i(P,"_invoke",{value:F(h,y,k)}),P}function f(h,d,y){try{return{type:"normal",arg:h.call(d,y)}}catch(S){return{type:"throw",arg:S}}}r.wrap=c;var v="suspendedStart",g="suspendedYield",_="executing",m="completed",E={};function T(){}function b(){}function p(){}var R={};l(R,o,function(){return this});var A=Object.getPrototypeOf,L=A&&A(A(j([])));L&&L!==n&&t.call(L,o)&&(R=L);var C=p.prototype=T.prototype=Object.create(R);function D(h){["next","throw","return"].forEach(function(d){l(h,d,function(y){return this._invoke(d,y)})})}function N(h,d){function y(w,P,k,I){var U=f(h[w],h,P);if(U.type!=="throw"){var V=U.arg,Q=V.value;return Q&&typeof Q=="object"&&t.call(Q,"__await")?d.resolve(Q.__await).then(function(q){y("next",q,k,I)},function(q){y("throw",q,k,I)}):d.resolve(Q).then(function(q){V.value=q,k(V)},function(q){return y("throw",q,k,I)})}I(U.arg)}var S;i(this,"_invoke",{value:function(w,P){function k(){return new d(function(I,U){y(w,P,I,U)})}return S=S?S.then(k,k):k()}})}function F(h,d,y){var S=v;return function(w,P){if(S===_)throw Error("Generator is already running");if(S===m){if(w==="throw")throw P;return{value:e,done:!0}}for(y.method=w,y.arg=P;;){var k=y.delegate;if(k){var I=G(k,y);if(I){if(I===E)continue;return I}}if(y.method==="next")y.sent=y._sent=y.arg;else if(y.method==="throw"){if(S===v)throw S=m,y.arg;y.dispatchException(y.arg)}else y.method==="return"&&y.abrupt("return",y.arg);S=_;var U=f(h,d,y);if(U.type==="normal"){if(S=y.done?m:g,U.arg===E)continue;return{value:U.arg,done:y.done}}U.type==="throw"&&(S=m,y.method="throw",y.arg=U.arg)}}}function G(h,d){var y=d.method,S=h.iterator[y];if(S===e)return d.delegate=null,y==="throw"&&h.iterator.return&&(d.method="return",d.arg=e,G(h,d),d.method==="throw")||y!=="return"&&(d.method="throw",d.arg=new TypeError("The iterator does not provide a '"+y+"' method")),E;var w=f(S,h.iterator,d.arg);if(w.type==="throw")return d.method="throw",d.arg=w.arg,d.delegate=null,E;var P=w.arg;return P?P.done?(d[h.resultName]=P.value,d.next=h.nextLoc,d.method!=="return"&&(d.method="next",d.arg=e),d.delegate=null,E):P:(d.method="throw",d.arg=new TypeError("iterator result is not an object"),d.delegate=null,E)}function z(h){var d={tryLoc:h[0]};1 in h&&(d.catchLoc=h[1]),2 in h&&(d.finallyLoc=h[2],d.afterLoc=h[3]),this.tryEntries.push(d)}function H(h){var d=h.completion||{};d.type="normal",delete d.arg,h.completion=d}function M(h){this.tryEntries=[{tryLoc:"root"}],h.forEach(z,this),this.reset(!0)}function j(h){if(h||h===""){var d=h[o];if(d)return d.call(h);if(typeof h.next=="function")return h;if(!isNaN(h.length)){var y=-1,S=function w(){for(;++y<h.length;)if(t.call(h,y))return w.value=h[y],w.done=!1,w;return w.value=e,w.done=!0,w};return S.next=S}}throw new TypeError(typeof h+" is not iterable")}return b.prototype=p,i(C,"constructor",{value:p,configurable:!0}),i(p,"constructor",{value:b,configurable:!0}),b.displayName=l(p,u,"GeneratorFunction"),r.isGeneratorFunction=function(h){var d=typeof h=="function"&&h.constructor;return!!d&&(d===b||(d.displayName||d.name)==="GeneratorFunction")},r.mark=function(h){return Object.setPrototypeOf?Object.setPrototypeOf(h,p):(h.__proto__=p,l(h,u,"GeneratorFunction")),h.prototype=Object.create(C),h},r.awrap=function(h){return{__await:h}},D(N.prototype),l(N.prototype,s,function(){return this}),r.AsyncIterator=N,r.async=function(h,d,y,S,w){w===void 0&&(w=Promise);var P=new N(c(h,d,y,S),w);return r.isGeneratorFunction(d)?P:P.next().then(function(k){return k.done?k.value:P.next()})},D(C),l(C,u,"Generator"),l(C,o,function(){return this}),l(C,"toString",function(){return"[object Generator]"}),r.keys=function(h){var d=Object(h),y=[];for(var S in d)y.push(S);return y.reverse(),function w(){for(;y.length;){var P=y.pop();if(P in d)return w.value=P,w.done=!1,w}return w.done=!0,w}},r.values=j,M.prototype={constructor:M,reset:function(h){if(this.prev=0,this.next=0,this.sent=this._sent=e,this.done=!1,this.delegate=null,this.method="next",this.arg=e,this.tryEntries.forEach(H),!h)for(var d in this)d.charAt(0)==="t"&&t.call(this,d)&&!isNaN(+d.slice(1))&&(this[d]=e)},stop:function(){this.done=!0;var h=this.tryEntries[0].completion;if(h.type==="throw")throw h.arg;return this.rval},dispatchException:function(h){if(this.done)throw h;var d=this;function y(U,V){return P.type="throw",P.arg=h,d.next=U,V&&(d.method="next",d.arg=e),!!V}for(var S=this.tryEntries.length-1;S>=0;--S){var w=this.tryEntries[S],P=w.completion;if(w.tryLoc==="root")return y("end");if(w.tryLoc<=this.prev){var k=t.call(w,"catchLoc"),I=t.call(w,"finallyLoc");if(k&&I){if(this.prev<w.catchLoc)return y(w.catchLoc,!0);if(this.prev<w.finallyLoc)return y(w.finallyLoc)}else if(k){if(this.prev<w.catchLoc)return y(w.catchLoc,!0)}else{if(!I)throw Error("try statement without catch or finally");if(this.prev<w.finallyLoc)return y(w.finallyLoc)}}}},abrupt:function(h,d){for(var y=this.tryEntries.length-1;y>=0;--y){var S=this.tryEntries[y];if(S.tryLoc<=this.prev&&t.call(S,"finallyLoc")&&this.prev<S.finallyLoc){var w=S;break}}w&&(h==="break"||h==="continue")&&w.tryLoc<=d&&d<=w.finallyLoc&&(w=null);var P=w?w.completion:{};return P.type=h,P.arg=d,w?(this.method="next",this.next=w.finallyLoc,E):this.complete(P)},complete:function(h,d){if(h.type==="throw")throw h.arg;return h.type==="break"||h.type==="continue"?this.next=h.arg:h.type==="return"?(this.rval=this.arg=h.arg,this.method="return",this.next="end"):h.type==="normal"&&d&&(this.next=d),E},finish:function(h){for(var d=this.tryEntries.length-1;d>=0;--d){var y=this.tryEntries[d];if(y.finallyLoc===h)return this.complete(y.completion,y.afterLoc),H(y),E}},catch:function(h){for(var d=this.tryEntries.length-1;d>=0;--d){var y=this.tryEntries[d];if(y.tryLoc===h){var S=y.completion;if(S.type==="throw"){var w=S.arg;H(y)}return w}}throw Error("illegal catch attempt")},delegateYield:function(h,d,y){return this.delegate={iterator:j(h),resultName:d,nextLoc:y},this.method==="next"&&(this.arg=e),E}},r}function Us(e,r){if(typeof e!="object"||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var t=n.call(e,r||"default");if(typeof t!="object")return t;throw new TypeError("@@toPrimitive must return a primitive value.")}return(r==="string"?String:Number)(e)}function js(e){var r=Us(e,"string");return typeof r=="symbol"?r:r+""}function Bs(e,r,n){return(r=js(r))in e?Object.defineProperty(e,r,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[r]=n,e}function Ui(e,r){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var t=Object.getOwnPropertySymbols(e);r&&(t=t.filter(function(i){return Object.getOwnPropertyDescriptor(e,i).enumerable})),n.push.apply(n,t)}return n}function J(e){for(var r=1;r<arguments.length;r++){var n=arguments[r]!=null?arguments[r]:{};r%2?Ui(Object(n),!0).forEach(function(t){Bs(e,t,n[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):Ui(Object(n)).forEach(function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))})}return e}function ji(e,r,n,t,i,a,o){try{var s=e[a](o),u=s.value}catch(l){return void n(l)}s.done?r(u):Promise.resolve(u).then(t,i)}function wt(e){return function(){var r=this,n=arguments;return new Promise(function(t,i){var a=e.apply(r,n);function o(u){ji(a,t,i,o,s,"next",u)}function s(u){ji(a,t,i,o,s,"throw",u)}o(void 0)})}}function Hi(e){return Cr.apply(this,arguments)}function Cr(){return Cr=wt(ce().mark(function e(r){var n,t,i,a,o,s,u,l,c,f,v,g,_,m,E,T,b,p,R,A=arguments;return ce().wrap(function(C){for(;;)switch(C.prev=C.next){case 0:if(n=A.length>1&&A[1]!==void 0?A[1]:{},t=J(J({},Ve),n),i=t.layers,a=t.backgroundColor,o=t.width,s=t.height,u=t.cameraState,l=t.sigmaSettings,c=t.withTempRenderer,f=r.getDimensions(),v=window.devicePixelRatio||1,g=typeof o!="number"?f.width:o,_=typeof s!="number"?f.height:s,m=document.createElement("DIV"),m.style.width="".concat(g,"px"),m.style.height="".concat(_,"px"),m.style.position="absolute",m.style.right="101%",m.style.bottom="101%",document.body.appendChild(m),E=new In(r.getGraph(),m,J(J({},r.getSettings()),l)),E.getCamera().setState(u||r.getCamera().getState()),E.setCustomBBox(r.getCustomBBox()),E.refresh(),T=document.createElement("CANVAS"),T.setAttribute("width",g*v+""),T.setAttribute("height",_*v+""),b=T.getContext("2d"),b.fillStyle=a,b.fillRect(0,0,g*v,_*v),!c){C.next=26;break}return C.next=26,c(E);case 26:return p=E.getCanvases(),R=i?i.filter(function(D){return!!p[D]}):Object.keys(p),R.forEach(function(D){b.drawImage(p[D],0,0,g*v,_*v,0,0,g*v,_*v)}),E.kill(),m.remove(),C.abrupt("return",T);case 32:case"end":return C.stop()}},e)})),Cr.apply(this,arguments)}function Hs(e,r){if(e==null)return{};var n={};for(var t in e)if({}.hasOwnProperty.call(e,t)){if(r.includes(t))continue;n[t]=e[t]}return n}function Vs(e,r){if(e==null)return{};var n,t,i=Hs(e,r);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);for(t=0;t<a.length;t++)n=a[t],r.includes(n)||{}.propertyIsEnumerable.call(e,n)&&(i[n]=e[n])}return i}var Ws=["format"];function Pr(e){return Sr.apply(this,arguments)}function Sr(){return Sr=wt(ce().mark(function e(r){var n,t,i,a,o,s=arguments;return ce().wrap(function(l){for(;;)switch(l.prev=l.next){case 0:return n=s.length>1&&s[1]!==void 0?s[1]:{},t=J(J({},Ve),n),i=t.format,a=Vs(t,Ws),l.next=4,Hi(r,a);case 4:return o=l.sent,l.abrupt("return",new Promise(function(c,f){o.toBlob(function(v){v?c(v):f(new Error('No actual blob was obtained by canvas.toBlob(..., "image/'.concat(i,'")')))},"image/".concat(i))}));case 6:case"end":return l.stop()}},e)})),Sr.apply(this,arguments)}function Xs(e){return Ar.apply(this,arguments)}function Ar(){return Ar=wt(ce().mark(function e(r){var n,t,i,a,o,s=arguments;return ce().wrap(function(l){for(;;)switch(l.prev=l.next){case 0:return n=s.length>1&&s[1]!==void 0?s[1]:{},t=J(J({},Ve),n),i=t.fileName,a=t.format,l.next=4,Pr(r,n);case 4:return o=l.sent,l.abrupt("return",new File([o],"".concat(i,".").concat(a)));case 6:case"end":return l.stop()}},e)})),Ar.apply(this,arguments)}function Or(e){return Lr.apply(this,arguments)}function Lr(){return Lr=wt(ce().mark(function e(r){var n,t,i,a,o,s=arguments;return ce().wrap(function(l){for(;;)switch(l.prev=l.next){case 0:return n=s.length>1&&s[1]!==void 0?s[1]:{},t=J(J({},Ve),n),i=t.fileName,a=t.format,l.next=4,Pr(r,n);case 4:o=l.sent,Bi.default.saveAs(o,"".concat(i,".").concat(a));case 6:case"end":return l.stop()}},e)})),Lr.apply(this,arguments)}function Ys(e){var r=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};return Or(e,J(J({},r),{},{format:"png"}))}function qs(e){var r=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};return Or(e,J(J({},r),{},{format:"jpeg"}))}export{Kt as Camera,ae as EdgeProgram,tt as EdgeRectangleProgram,Dn as MouseCaptor,go as NodeSquareProgram,Fn as Sigma,wn as animateNodes,Ie as createEdgeCompoundProgram,ii as createNodeBorderProgram,Qo as createNodePiechartProgram,Je as drawDiscNodeHover,Gi as edgeCurve,Vi as exportImage,Y as floatColor,xi as nodeImage};
