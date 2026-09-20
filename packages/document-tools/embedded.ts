import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {inflateSync} from 'node:zlib';
import {validate,LIMITS} from '../document-core/index.ts';
const signature=Buffer.from('89504e470d0a1a0a','hex');
function crc(bytes:Buffer){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const body=Buffer.concat([Buffer.from(type),data]),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE(crc(body),out.length-4);return out;}
export function embedSource(data:Buffer,format:'png'|'svg',xml:string){
 const checked=validate(xml);if(!checked.ok)throw Error('源图稿无效');const content=encodeURIComponent(checked.xml!);
 if(format==='svg'){const d=new DOMParser().parseFromString(data.toString(),'image/svg+xml');d.documentElement!.setAttribute('content',content);return Buffer.from(new XMLSerializer().serializeToString(d));}
 if(!data.subarray(0,8).equals(signature))throw Error('PNG 无效');
 return Buffer.concat([data.subarray(0,8),chunk('tEXt',Buffer.from('mxfile\0'+content,'latin1')),data.subarray(8)]);
}
export function extractSource(data:Buffer){
 if(data.length>LIMITS.fileBytes)throw Error('文件超过 20 MiB');
 let content='';
 if(data.subarray(0,8).equals(signature)){
  for(let pos=8;pos+12<=data.length;){const len=data.readUInt32BE(pos);if(pos+len+12>data.length)throw Error('PNG 数据损坏');const type=data.toString('ascii',pos+4,pos+8),body=data.subarray(pos+8,pos+8+len);
   if(['tEXt','zTXt'].includes(type)&&body.subarray(0,7).toString('ascii')==='mxfile\0'){
    if(crc(data.subarray(pos+4,pos+8+len))!==data.readUInt32BE(pos+8+len))throw Error('PNG 校验失败');
    content=type==='tEXt'?body.subarray(7).toString('latin1'):inflateSync(body.subarray(8),{maxOutputLength:LIMITS.xmlBytes}).toString('utf8');break;
   }pos+=len+12;
  }
 }else{
  const text=data.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('SVG 含不支持的声明');
  const d=new DOMParser().parseFromString(text,'image/svg+xml');if(d.documentElement?.tagName!=='svg')throw Error('只支持含源图稿的 PNG/SVG');content=d.documentElement.getAttribute('content')||'';
 }
 if(!content)throw Error('图片没有内嵌源图稿；普通截图请使用 AI 识别');
 const result=validate(content.startsWith('<')?content:decodeURIComponent(content));if(!result.ok)throw Error(result.errors.map(e=>e.message).join('\n'));return result;
}
