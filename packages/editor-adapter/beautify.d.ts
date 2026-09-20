export {};
declare global {
  var DiagramBeautify: { plan(nodes: Array<{id:string;x:number;y:number;width:number;height:number;ancestors?:string[];locked?:boolean;decoration?:boolean}>, edges:Array<{id:string;source?:string;target?:string;locked?:boolean}>):Array<{id:string;axis:string;distance:number;exitX:number;exitY:number;entryX:number;entryY:number}> };
}
